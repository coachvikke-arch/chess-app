/* useBotGame — the whole state machine for one bot match.
 *
 * Responsibilities, in the order they matter:
 *
 *  1. OWN THE CHESS INSTANCE. A single `Chess` object is created once per game
 *     and passed to <ChessBoard game={…}>, which is how the rest of this app
 *     drives a controlled board (Play Arena, tournaments, live class). This is
 *     why no extra move-validation logic is needed: `game.move()` IS the app's
 *     existing validation.
 *
 *  2. NEVER MOVE OUT OF TURN. `humanTurn` gates the board's `interactive` prop,
 *     so the player physically cannot drag a piece while the bot is thinking —
 *     enforced by the board being non-interactive, not by a late guard.
 *
 *  3. TERMINAL STATES ONCE. `finish()` is guarded by a ref so a checkmate
 *     detected by the move handler AND by the engine response cannot both fire
 *     the result modal.
 *
 *  4. HUMAN-LIKE DELAY. The engine may answer in 80ms, but a bot that replies
 *     instantly feels like a machine. The chosen move is applied after a random
 *     delay inside the bot's `thinkingTime` band, with a hard timeout fallback.
 *
 *  5. CANCELLATION. Every async step is tied to a generation counter, so a
 *     rematch or an unmount mid-search discards the stale reply instead of
 *     playing a move into a fresh game.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { chooseBotMove, cancelSearch, isLegalMove } from '../services/BotEngineService';
import { createBotSpeaker } from '../services/BotDialogueService';

/** Terminal statuses. `status` stays 'playing' until one of these is reached. */
export const TERMINAL = new Set(['checkmate', 'stalemate', 'draw', 'timeout', 'resignation', 'abandoned']);

let gameSeq = 0;

/** Random delay inside the bot's configured band. */
function thinkDelay(bot) {
  const min = Math.max(0, bot?.thinkingTime?.min ?? 400);
  const max = Math.max(min, bot?.thinkingTime?.max ?? 900);
  return min + Math.floor(Math.random() * (max - min + 1));
}

/**
 * Classify a finished position.
 * Returns `{ status, result }` from the HUMAN's point of view.
 */
function classify(game, humanColor, cause = null) {
  if (cause === 'resignation') return { status: 'resignation', result: 'loss' };
  /* `game.turn()` returns 'w'/'b' while `humanColor` is 'white'/'black', so
     these MUST be compared as `humanColor[0]`. Comparing the full word never
     matches, which silently reported every checkmate and flagfall as a win. */
  if (cause === 'timeout') {
    const loser = game.turn();
    return { status: 'timeout', result: loser === humanColor[0] ? 'loss' : 'win' };
  }
  if (game.isCheckmate()) {
    /* The side to move is the one that got mated. */
    const loser = game.turn();
    return { status: 'checkmate', result: loser === humanColor[0] ? 'loss' : 'win' };
  }
  if (game.isStalemate()) return { status: 'stalemate', result: 'draw' };
  if (game.isInsufficientMaterial()) return { status: 'draw', result: 'draw', reason: 'Insufficient material' };
  if (game.isThreefoldRepetition()) return { status: 'draw', result: 'draw', reason: 'Threefold repetition' };
  if (game.isDraw()) return { status: 'draw', result: 'draw', reason: 'Fifty-move rule' };
  return { status: 'playing', result: null };
}

/** Readable label for a terminal status. */
export function statusLabel(status) {
  switch (status) {
    case 'checkmate': return 'Checkmate';
    case 'stalemate': return 'Stalemate';
    case 'timeout': return 'Time';
    case 'resignation': return 'Resignation';
    case 'abandoned': return 'Abandoned';
    case 'draw': return 'Draw';
    default: return 'Playing';
  }
}

export function useBotGame({
  bot,
  playerColor = 'white',
  timeControlSeconds = 0,
  chatEnabled = true,
  onFinish,
}) {
  const humanColor = playerColor === 'black' ? 'black' : 'white';
  const botColor = humanColor === 'white' ? 'black' : 'white';

  /* ── Chess instance ─────────────────────────────────────────────────── */
  const gameRef = useRef(null);
  const [gameVersion, setGameVersion] = useState(0);
  const newGame = useCallback(() => {
    gameRef.current = new Chess();
    gameSeq += 1;
    return gameSeq;
  }, []);
  if (gameRef.current === null) newGame();

  const [fen, setFen] = useState(() => gameRef.current.fen());
  const [history, setHistory] = useState([]);
  const [turn, setTurn] = useState('w');
  const [lastMove, setLastMove] = useState(null);
  const [captured, setCaptured] = useState({ w: [], b: [] });

  const [status, setStatus] = useState('playing');
  const [result, setResult] = useState(null);
  const [reason, setReason] = useState(null);
  const [botThinking, setBotThinking] = useState(false);
  const [engineError, setEngineError] = useState('');
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [gameId, setGameId] = useState(() => `g${gameSeq}-${Math.random().toString(36).slice(2, 9)}`);

  /* Bot Chat: one original line per event, throttled by BotDialogueService.
   * `chatLine` is empty when the player has the chat turned off. */
  const [chatLine, setChatLine] = useState('');
  const speakerRef = useRef(null);
  if (speakerRef.current === null) {
    speakerRef.current = bot ? createBotSpeaker(bot, { enabled: chatEnabled }) : null;
  }

  /* Generation counter: every async continuation checks it, so anything that
   * resolves after a reset/unmount is discarded rather than played. */
  const genRef = useRef(gameSeq);
  const finishedRef = useRef(false);
  const moveCountRef = useRef(0);
  const lastLossCpRef = useRef(0);
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;

  /* Keep the speaker in step with the bot and the chat toggle. */
  useEffect(() => {
    speakerRef.current = bot ? createBotSpeaker(bot, { enabled: chatEnabled }) : null;
    setChatLine('');
    if (bot && chatEnabled) setChatLine(speakerRef.current?.greet() || '');
  }, [bot?.id, chatEnabled]);

  const humanTurn = turn === humanColor[0] && status === 'playing' && !botThinking;

  /* ── Terminate ──────────────────────────────────────────────────────── */
  const finish = useCallback(
    (cause = null) => {
      if (finishedRef.current) return;
      const outcome = classify(gameRef.current, humanColor, cause);
      if (outcome.status === 'playing') return;
      finishedRef.current = true;
      cancelSearch();
      setBotThinking(false);
      setStatus(outcome.status);
      setResult(outcome.result);
      setReason(outcome.reason || statusLabel(outcome.status));
      if (outcome.result && speakerRef.current) {
        setChatLine(speakerRef.current.finish(outcome.result) || '');
      }
      if (onFinishRef.current) {
        onFinishRef.current({
          result: outcome.result,
          status: outcome.status,
          reason: outcome.reason || statusLabel(outcome.status),
          gameId: gameIdRef.current,
          plies: moveCountRef.current,
          durationMs: Date.now() - startedAtRef.current,
          fen: gameRef.current.fen(),
          history: gameRef.current.history({ verbose: true }),
        });
      }
    },
    [humanColor],
  );

  /* Refs so `finish` stays stable while still reading current values. */
  const gameIdRef = useRef(gameId);
  const startedAtRef = useRef(startedAt);
  useEffect(() => {
    gameIdRef.current = gameId;
    startedAtRef.current = startedAt;
  }, [gameId, startedAt]);

  /* ── Sync position state from the chess instance ────────────────────── */
  const sync = useCallback(() => {
    const g = gameRef.current;
    const moves = g.history({ verbose: true });
    const last = moves.length ? moves[moves.length - 1] : null;

    setFen(g.fen());
    setHistory(moves);
    setTurn(g.turn());
    setGameVersion((v) => v + 1);
    setLastMove(last ? { from: last.from, to: last.to } : null);

    /* Captured trays, derived from the verbose history rather than tracked
     * incrementally so a rematch/replay can never desync them. */
    const trays = { w: [], b: [] };
    for (const m of moves) {
      if (m.captured) trays[m.color].push(m.captured);
    }
    setCaptured(trays);

    moveCountRef.current = moves.length;

    const outcome = classify(g, humanColor);
    if (outcome.status !== 'playing') finish(null);
  }, [humanColor, finish]);

  /* ── Human move (from <ChessBoard onMove>) ───────────────────────────── */
  const onHumanMove = useCallback(
    (move) => {
      if (finishedRef.current) return;
      /* Defensive: the board is non-interactive out of turn, but a scripted
       * or replayed event must not be able to inject a move. */
      if (move.color !== humanColor[0]) return;
      sync();
      /* We do not know how much the human gave away without spending an engine
       * call per ply, so the human's moves get mood/capture reactions only. */
      const line = speakerRef.current?.react({
        actor: 'human',
        move,
        gameAfter: gameRef.current,
        lossCp: 0,
      });
      if (line) setChatLine(line);
    },
    [humanColor, sync],
  );

  /* ── Bot turn ───────────────────────────────────────────────────────── */
  const botMoveRef = useRef(null);

  useEffect(() => {
    if (status !== 'playing' || finishedRef.current) return undefined;
    if (turn !== botColor[0]) return undefined;
    if (!bot) return undefined;

    const gen = genRef.current;
    let cancelled = false;
    const timers = [];

    const runBotTurn = async () => {
      setBotThinking(true);
      setEngineError('');

      /* Realistic pause before the move appears. */
      const delay = thinkDelay(bot);
      const arrived = await new Promise((resolve) => {
        const t = setTimeout(() => resolve(true), delay);
        timers.push(t);
      });
      if (cancelled || !arrived || gen !== genRef.current || finishedRef.current) return;

      let chosen = null;
      try {
        chosen = await chooseBotMove(bot, gameRef.current);
      } catch (err) {
        chosen = null;
        if (!cancelled && gen === genRef.current) {
          setEngineError(err?.message || 'The chess engine failed to respond.');
        }
      }
      if (cancelled || gen !== genRef.current || finishedRef.current) return;

      if (!chosen) {
        /* No legal move at all: the position is already terminal. */
        setBotThinking(false);
        finish(null);
        return;
      }

      /* Final legality gate before touching the board. */
      const g = gameRef.current;
      if (!isLegalMove(g, chosen.from, chosen.to, chosen.promotion)) {
        setEngineError('That move was not legal, so a safer move was played instead.');
        const legal = g.moves({ verbose: true });
        if (!legal.length) {
          setBotThinking(false);
          finish(null);
          return;
        }
        const safe = legal[Math.floor(Math.random() * legal.length)];
        chosen = { from: safe.from, to: safe.to, promotion: safe.promotion || 'q', san: safe.san };
      }

      let played = null;
      try {
        played = g.move({ from: chosen.from, to: chosen.to, promotion: chosen.promotion });
      } catch {
        played = null;
      }
      if (!played) {
        /* Last-ditch rescue: any legal move, so the game never deadlocks. */
        const legal = g.moves({ verbose: true });
        if (!legal.length) {
          setBotThinking(false);
          finish(null);
          return;
        }
        played = g.move(legal[0]);
      }

      botMoveRef.current = played;
      /* How much the bot gave away on this move, straight from the MultiPV pass
       * it already paid for. Drives its "Oops. I missed that." reactions. */
      lastLossCpRef.current = Number.isFinite(chosen?.lossCp) ? chosen.lossCp : 0;
      setBotThinking(false);
      sync();
      const line = speakerRef.current?.react({
        actor: 'bot',
        move: played,
        gameAfter: gameRef.current,
        lossCp: lastLossCpRef.current,
      });
      if (line) setChatLine(line);
    };

    runBotTurn();

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [turn, status, bot, botColor, sync, finish]);

  /* ── Player actions ─────────────────────────────────────────────────── */
  const resign = useCallback(() => {
    if (status !== 'playing') return;
    finish('resignation');
  }, [status, finish]);

  /** Bot ran out of time on its own clock. */
  const flagBot = useCallback(() => {
    if (status !== 'playing') return;
    finish('timeout');
  }, [status, finish]);

  /**
   * Player ran out of time.
   *
   * `finish('timeout')` classifies by SIDE TO MOVE, which is exactly who
   * flagged — a player can only be flagged on their own turn. So this is the
   * same path as flagBot, kept as a named export because the two callers read
   * very differently and a future increment/flag-by-caller-data change should
   * not silently alter this one.
   */
  const flagPlayer = useCallback(() => {
    if (status !== 'playing') return;
    finish('timeout');
  }, [status, finish]);

  /**
   * Rematch: same bot, same clock, fresh position. Colours optionally swap so
   * the player does not always get the same side.
   */
  const rematch = useCallback(
    ({ swapColors = false } = {}) => {
      cancelSearch();
      newGame();
      genRef.current = gameSeq;
      finishedRef.current = false;
      moveCountRef.current = 0;
      botMoveRef.current = null;
      setStatus('playing');
      setResult(null);
      setReason(null);
      setBotThinking(false);
      setEngineError('');
      setStartedAt(Date.now());
      setGameId(`g${gameSeq}-${Math.random().toString(36).slice(2, 9)}`);
      setLastMove(null);
      setCaptured({ w: [], b: [] });
      lastLossCpRef.current = 0;
      speakerRef.current?.reset();
      /* Re-greet on rematch so the bot acknowledges the new game. */
      if (speakerRef.current && chatEnabled) {
        setChatLine(speakerRef.current.greet() || '');
      } else {
        setChatLine('');
      }
      sync();
    },
    [newGame, sync, chatEnabled],
  );

  /* Abandon cleanly when leaving the screen: no stale reply, no stray search. */
  useEffect(() => {
    return () => {
      cancelSearch();
    };
  }, []);

  /* ── Derived ────────────────────────────────────────────────────────── */
  const check = useMemo(() => {
    try {
      return gameRef.current.inCheck();
    } catch {
      return false;
    }
  }, [fen, gameVersion]);

  const player = useMemo(
    () => ({
      color: humanColor,
      name: 'You',
      isBot: false,
    }),
    [humanColor],
  );

  return {
    /* position */
    game: gameRef.current,
    fen,
    history,
    turn,
    lastMove,
    captured,
    check,

    /* flow */
    status,
    result,
    reason,
    gameId,
    startedAt,
    durationMs: Date.now() - startedAt,

    /* sides */
    humanColor,
    botColor,
    player,
    humanTurn,
    botThinking,

    /* errors */
    engineError,

    /* bot chat */
    chatLine,

    /* actions */
    onHumanMove,
    resign,
    flagBot,
    flagPlayer,
    rematch,

    /* helpers */
    isTerminal: TERMINAL.has(status),
    timeControlSeconds,
  };
}

export default useBotGame;