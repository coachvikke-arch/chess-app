import { useCallback, useEffect, useRef, useState } from 'react';
import Button from '../Button';
import { Chess } from 'chess.js';
import ChessBoard from '../ChessBoard';
import StudentAvatar from '../StudentAvatar';
import { useAuth } from '../../context/AuthContext';
import { useLiveClass } from '../../context/LiveClassContext';
import { useFittedSquare, CLASSROOM_BOARD_MIN, PAIRED_BOARD_MAX, framedWidth } from '../../hooks/useBoardWidth';
import { listLiveSessions, fetchGame, sendMove, resignGame, abortGame, offerDraw, respondDraw } from '../../utils/online';
import { onGameUpdate, on } from '../../services/socket';
import { searchBest, warmEngine } from '../../utils/engine';
import { botLevelConfig } from '../../utils/botLevels';
import { revealAfterCheckmate } from '../../effects/moveEffect';

const REASON_LABELS = {
  checkmate: 'Checkmate',
  resignation: 'Resignation',
  timeout: 'Timeout',
  stalemate: 'Stalemate',
  repetition: 'Repetition',
  'fifty-move': 'Fifty-move rule',
  insufficient: 'Insufficient material',
  agreement: 'Agreement',
};

function resultLabel(result, reason) {
  const why = REASON_LABELS[reason] || '';
  if (result === 'white') return why ? `🏆 White wins · ${why}` : '🏆 White wins';
  if (result === 'black') return why ? `🏆 Black wins · ${why}` : '🏆 Black wins';
  if (result === 'draw') return why ? `🤝 Draw · ${why}` : '🤝 Draw';
  if (result === 'abandoned') return why ? `🤝 Draw · ${why}` : '🤝 Draw by agreement';
    if (result === 'aborted') return '❌ Paired game ended';
  return 'Game over';
}

/* Remaining time for one colour, ticked client-side from the last
   server-authoritative values. The payload's whiteMs/blackMs are computed by
   the server at send time; between updates the side to move keeps counting
   down locally, both sides freeze when the game is finished, and nothing ever
   goes below zero. Returns null when the payload carried no clock at all. */
function remainingMs(clock, color, nowTs) {
  const base = color === 'white' ? clock.whiteMs : clock.blackMs;
  if (base == null) return null;
  if (!clock.finished && clock.turn === color && clock.at) {
    return Math.max(0, Math.round(base - (nowTs - clock.at)));
  }
  return Math.round(base);
}

/* m:ss, the way a real chess clock reads. */
function formatClock(ms) {
  if (ms == null) return null;
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/* Captured-material glyphs and piece values, mirroring the Analysis board's
   tray so both tables read identically. A captured piece is drawn in the
   OPPONENT's colour: White's captures are the black glyphs. */
const CAPTURE_GLYPH = {
  w: { p: '♙', n: '♘', b: '♗', r: '♖', q: '♕', k: '♔' },
  b: { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' },
};
const CAPTURE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const WHITE_GLYPHS = new Set(['♔', '♙', '♘', '♗', '♖', '♕']);

/* Big-board size for the focus overlay: the board sits in its own card next
   to a ~340px details card on wide screens (stacked below it on narrow
   ones), so the width budget subtracts the side card there. Re-measured on
   resize; floored so tiny landscape phones still get a playable board with
   the overlay's own scroll as fallback. */
function useFocusBoardSize(active) {
  const calc = () => {
    if (typeof window === 'undefined') return { size: 320, frameless: false };
    const w = window.innerWidth;
    const h = window.innerHeight;
    const sideBySide = w > 900;
    /* Phones (and phone-width tablets, which get the same full-screen view)
       drop the decorative frame entirely: its band + notation is ~70px around
       the square, which is most of what kept the board small. Frameless it can
       grow to nearly the full screen width. */
    const frameless = w <= 768;
    const availH = h * 0.9 - 110;
    let availW;
    if (sideBySide) {
      /* Wide screens: the board card sits beside a ~360px details card. */
      availW = w * 0.9 - 360;
    } else if (frameless) {
      /* Bare board: backdrop (8) + focus-card (10) padding each side + slack. */
      availW = w - 2 * 8 - 2 * 10 - 6;
    } else {
      /* Framed (tablets 640–900): subtract the themed frame band — the same
         (inner - 30) / 1.164 identity the classroom boards use. */
      availW = (w - 2 * 16 - 2 * 18 - 30 - 6) / 1.164;
    }
    return { size: Math.max(200, Math.floor(Math.min(availW, availH))), frameless };
  };
  const [state, setState] = useState(calc);
  useEffect(() => {
    if (!active) return undefined;
    const update = () => setState(calc());
    update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, [active]);
  return state;
}

/**
 * Player vs Player board that takes over the classroom's single main board slot
 * when the viewer was paired by the instructor — no separate board, no Play
 * Arena navigation. It finds the viewer's active classroom game for this class,
 * keeps it in sync over the socket, decrements both clocks live and lets the
 * player move, resign or offer a draw (the opponent accepts or declines - a
 * draw is an offer, never an instant finish). If `fallback` is provided it renders
 * that content instead (e.g. the Shared Board) for anyone who isn't playing.
 */
export default function PvPPlayBoard({ classId, fallback, onOpened, onEnded, instructorView = false }) {
  const { user } = useAuth();
  const { participants } = useLiveClass();
  const me = user ? Number(user.id) : null;
  /* Same hook family + min as the shared board, but it fits BOTH axes: the card
     below is capped to the viewport and the board stage is a shrinking flex
     child, so the board is as large as fits the screen without ever scrolling
     the page. Move handling below is untouched. */
  const { areaRef, fitRef, size: boardSize } = useFittedSquare({ max: PAIRED_BOARD_MAX, min: CLASSROOM_BOARD_MIN });

  /* Cap the card to the viewport (minus its own top offset and a small bottom
     margin) so the whole game fits on screen with no page scroll. The board
     stage is a flex child, so when the card is height-bound the board shrinks to
     fit instead of overflowing. A callback ref (not a plain useRef) because the
     card is not rendered until the game resolves. */
  const [cardNode, setCardNode] = useState(null);
  const cardRef = useCallback((node) => setCardNode(node), []);
  useEffect(() => {
    if (!cardNode) return undefined;
    const fit = () => {
      const top = cardNode.getBoundingClientRect().top + window.scrollY;
      const maxH = Math.max(320, window.innerHeight - top - 12);
      cardNode.style.maxHeight = `${Math.round(maxH)}px`;
    };
    fit();
    window.addEventListener('resize', fit);
    window.addEventListener('orientationchange', fit);
    return () => {
      window.removeEventListener('resize', fit);
      window.removeEventListener('orientationchange', fit);
    };
  }, [cardNode]);

  const gameRef = useRef(new Chess());
  const [, rereset] = useState(0);
  const [game, setGame] = useState(null); // my participant payload
  const [resolved, setResolved] = useState(false); // discovery finished (not a player vs loading)
  /* Live clocks, ticked from the server's authoritative remaining times.
   Every game payload carries whiteMs/blackMs as of send time; `at` stamps the
   local receipt so the side to move counts down between updates. A 500ms tick
   re-renders the two clock labels - cheap, one interval for the whole card. */
  const [clock, setClock] = useState({ turn: 'white', whiteMs: null, blackMs: null, at: 0, finished: true });
  const [nowTs, setNowTs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowTs(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  const [busy, setBusy] = useState(false);
  const [ended, setEnded] = useState(null); // { result }
  /* A checkmate result waits for the mating animation before it is shown. */
  const [resultHidden, setResultHidden] = useState(false);
  const resultRevealCancelRef = useRef(null);
  const endedGameRef = useRef(null);
  /* Only a finish we watched happen deserves the animation wait; opening an
     already-finished game must show its result at once. */
  const seenActiveGameRef = useRef(null);
  /* View-only collapse: hides this card and hands the slot back to the
     classroom (fallback). Purely local — the game keeps running on the server,
     nothing is resigned or aborted. */
  const [hidden, setHidden] = useState(false);
  const movesEndRef = useRef(null);
  const focusMovesEndRef = useRef(null);
  /* Whether the viewer is "pinned" to the bottom of each move list. True by
     default so the newest move is followed; flipping false on any scroll up
     stops the list from yanking a reader back down when the next move lands.
     Re-pinning only happens by scrolling back to the bottom. */
  const pinnedRef = useRef({ main: true, focus: true });
  const onMovesScroll = useCallback((key) => (e) => {
    const el = e.target;
    pinnedRef.current[key] = el.scrollTop + el.clientHeight >= el.scrollHeight - 24;
  }, []);
  /* Click a row in the score sheet: reveal it in its own list without changing
     the live position (the board, not the score sheet, is where the game is
     navigated). nearest = no jump when it is already visible. */
  const scrollMoveIntoView = useCallback((e) => {
    try { e.currentTarget.scrollIntoView({ block: 'nearest' }); } catch { /* ignore */ }
  }, []);
  /* Focus overlay (expanded board): same game instance + state, just a bigger
     second view of it — closing never touches the game, so live play continues. */
  const [expanded, setExpanded] = useState(false);
  const [closing, setClosing] = useState(false);
  const closeTimerRef = useRef(null);
  /* Phone-only auto full-screen is one-shot per game id: closing it manually,
     re-rendering or a polling update can never reopen it. A NEW pairing (new
     id) opens again. */
  const autoFullscreenGameRef = useRef(null);
  const { size: focusSize, frameless: focusFrameless } = useFocusBoardSize(expanded);

  const openExpand = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setClosing(false);
    setExpanded(true);
  }, []);

  const closeExpand = useCallback(() => {
    setClosing(true);
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      setExpanded(false);
      setClosing(false);
    }, 200);
  }, []);

  /* A paired student on a phone should land straight on a playable board
     instead of hunting for it inside the room. Marking the game id even when
     the viewport is too wide keeps this a single decision per game: resizing
     to a phone later never pops the overlay unexpectedly. */
  useEffect(() => {
    if (!game || game.status !== 'active' || instructorView) return;
    if (autoFullscreenGameRef.current === game.id) return;
    autoFullscreenGameRef.current = game.id;
    if (typeof window === 'undefined' || !window.matchMedia) return;
    if (!window.matchMedia('(max-width: 768px)').matches) return;
    openExpand();
  }, [game, instructorView, openExpand]);

  useEffect(() => () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    if (resultRevealCancelRef.current) {
      resultRevealCancelRef.current();
      resultRevealCancelRef.current = null;
    }
  }, []);

  /* Escape closes the overlay; page scroll locks while it is open. */
  useEffect(() => {
    if (!expanded) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') closeExpand();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [expanded, closeExpand]);

  const force = () => rereset((x) => x + 1);

  const apply = useCallback((row) => {
    if (!row) return;
    const g = gameRef.current;
    try {
      const current = g.pgn();
      if (row.pgn !== current) g.loadPgn(row.pgn || '', { strict: false });
    } catch {
      /* keep local */
    }
    const c = row.clock || {};
    setClock({
      turn: c.turn || row.turn || 'white',
      whiteMs: Number.isFinite(Number(c.whiteMs)) ? Number(c.whiteMs) : null,
      blackMs: Number.isFinite(Number(c.blackMs)) ? Number(c.blackMs) : null,
      at: Date.now(),
      finished: row.status === 'finished',
    });
    if (row.status === 'finished' && row.result) {
      setEnded({ result: row.result, reason: row.resultReason || null });
      if (endedGameRef.current !== row.id) {
        endedGameRef.current = row.id;
        const liveFinish = seenActiveGameRef.current === row.id;
        if (resultRevealCancelRef.current) { resultRevealCancelRef.current(); resultRevealCancelRef.current = null; }
        if (liveFinish && (row.resultReason || '') === 'checkmate') {
          let to = null;
          try {
            const hist = g.history({ verbose: true });
            to = hist.length ? hist[hist.length - 1].to : null;
          } catch { /* ignore */ }
          setResultHidden(true);
          resultRevealCancelRef.current = revealAfterCheckmate(
            { to, key: `pvp:${row.id}:${g.fen()}` },
            () => {
              resultRevealCancelRef.current = null;
              setResultHidden(false);
            },
          );
        } else {
          setResultHidden(false);
        }
      }
    } else if (row.status !== 'finished') {
      seenActiveGameRef.current = row.id;
      if (resultRevealCancelRef.current) { resultRevealCancelRef.current(); resultRevealCancelRef.current = null; }
      endedGameRef.current = null;
      setResultHidden(false);
    }
    setGame(row);
    force();
  }, []);

  const findMyGame = useCallback(async () => {
    try {
      if (!classId || me == null || instructorView) return;
      const sessions = await listLiveSessions(classId);
      const mine = (sessions || []).find(
        (s) => s.type === 'online' && s.status === 'active' && (Number(s.whiteId) === me || Number(s.blackId) === me)
      );
      if (!mine) return;
      const row = await fetchGame(mine.gameId);
      if (row && Number(row.classId ?? null) === Number(classId) && Number(row.meId) === me) apply(row);
    } catch {
      /* transient */
    } finally {
      setResolved(true);
    }
  }, [classId, me, apply]);

  /* live sync + first discovery */
  useEffect(() => {
    if (!classId || me == null || instructorView) return undefined;
    findMyGame();
    const off = onGameUpdate(({ forAdmin, forStudent }) => {
      const row = forAdmin && Number(forAdmin.meId) === me
        ? forAdmin
        : forStudent && Number(forStudent.meId) === me
          ? forStudent
          : null;
      if (row && Number(row.classId ?? null) === Number(classId)) apply(row);
    });
    return () => off();
  }, [classId, me, apply, findMyGame]);

  /* if a pairing starts while the viewer is already in the room, discover it */
  useEffect(() => {
    if (!classId || me == null || instructorView) return undefined;
    const off = on('pvp-started', (payload) => {
      if (payload && Number(payload.classId ?? null) === Number(classId)) findMyGame();
    });
    return () => off();
  }, [classId, me, findMyGame]);

  /* Computer vs Students: this board is the student's OWN bot game (per-student
     row), so THIS client drives the bot's moves locally — independent of the
     instructor's grid. Serialized: only one engine search runs at a time and
     it re-checks the live turn before every move. */
  const botBusyRef = useRef(false);

  /* Reply generator for the computer side. Tries the real engine first
     (correct strength for game.botLevel); if that fails or hangs, plays an
     instant reply from the bundled pure-JS engine so the computer ALWAYS
     answers the student within this browser — no blocker, no dead turn. */
  const findBotReply = useCallback(async (fen, cfg) => {
    // primary path: the real Stockfish worker at the configured strength.
    // Bounded by a timeout race so a hung/misbehaving worker can never stall
    // the student's turn (the fallback engine below answers in <1s).
    if (window.stockfishAvailable !== false) {
      const engineTimeout = new Promise((_, reject) => setTimeout(() => reject(new Error('engine search timed out')), 5000));
      try {
        const res = await Promise.race([
          searchBest(fen, {
            skillLevel: cfg.skillLevel,
            maxDepth: cfg.maxDepth,
            timeMs: cfg.timeMs,
          }),
          engineTimeout,
        ]);
        if (res && res.from && res.to) return res;
      } catch (err) {
        console.warn('[PvPPlayBoard] engine failed, using fallback engine:', err && err.message ? err.message : String(err));
      }
    }
    // guaranteed path: bundled pure-JS engine scaled to the same level config
    try {
      const module = await import('../../utils/jsChessEngine');
      const history = [];
      try {
        const hist = gameRef.current ? gameRef.current.history({ verbose: true }) : [];
        for (const h of hist) if (h && h.before) history.push(h.before);
      } catch { /* ignore */ }
      const res = await module.bestMove(fen, {
        skillLevel: cfg.skillLevel,
        maxDepth: cfg.maxDepth,
        timeMs: cfg.timeMs,
        history,
      });
      if (res && res.from && res.to) {
        // re-validate against chess.js before playing
        const g = new Chess(fen);
        try {
          g.move({ from: res.from, to: res.to, promotion: res.promotion || 'q' });
          return res;
        } catch {
          /* fall through to last resort */
        }
      }
    } catch (err) {
      console.error('[PvPPlayBoard] fallback engine failed:', err && err.message ? err.message : String(err));
    }
    // last resort: any legal move so the computer never leaves the turn hanging
    const legal = new Chess(fen).moves({ verbose: true });
    if (!legal.length) return null;
    const reply = legal[0];
    return { from: reply.from, to: reply.to, promotion: reply.promotion || null };
  }, []);

  useEffect(() => {
    if (!game || game.status !== 'active' || !game.isBot || busy || ended) return undefined;
    const myColor = game.myColor || 'white';
    if (game.botColor && game.botColor !== myColor && game.turn === game.botColor) {
      if (botBusyRef.current) return undefined;
      botBusyRef.current = true;
      (async () => {
        try {
          const cfg = botLevelConfig(game.botLevel);
          const res = await findBotReply(game.fen, cfg);
          if (busy || ended || !gameRef.current || gameRef.current.fen() !== game.fen) return;
          if (game.turn !== game.botColor) return;
          if (!res?.from || !res?.to) return;
          const nxt = await sendMove(game.id, {
            from: res.from, to: res.to, promotion: res.promotion || 'q'
          });
          apply(nxt);
        } catch (err) {
          console.error('[PvPPlayBoard] bot auto-reply failed:', err && err.message ? err.message : String(err));
        }
        finally { botBusyRef.current = false; }
      })();
    }
    return undefined;
  }, [game, busy, ended, apply, findBotReply]);

  /* Pre-boot the Stockfish worker as soon as a computer game appears, so the
     first bot move doesn't pay for (or stall on) worker startup. Failures are
     fine: the bundled fallback engine covers every reply. */
  useEffect(() => {
    if (game && game.isBot) {
      try { warmEngine().catch(() => { /* covered by fallback engine */ }); } catch { /* ignore */ }
    }
  }, [game, game?.isBot]); // eslint-disable-line react-hooks/exhaustive-deps

  const onMove = useCallback(
    (move) => {
      if (busy || ended || !game) return;
      setBusy(true);
      sendMove(game.id, { from: move.from, to: move.to, promotion: move.promotion || 'q' })
        .then(apply)
        .catch(() => {
          try { gameRef.current.undo(); } catch { /* ignore */ }
          force();
        })
        .finally(() => setBusy(false));
    },
    [busy, ended, game, apply]
  );

  const handleResign = useCallback(async () => {
    if (!game || busy || ended) return;
    setBusy(true);
    try { apply(await resignGame(game.id)); } catch { /* ignore */ } finally { setBusy(false); }
  }, [game, busy, ended, apply]);

  /* Abort a mispaired board, and only then: available while fewer than two
     half-moves exist (the starting position, or White's first move alone).
     The moment Black replies, both sides have moved and the button is gone on
     both clients - the game has a real result coming and must be resigned or
     drawn, never vanished. The server enforces the same < 2 rule, so a forged
     request past it is refused rather than trusted. */
  const handleAbort = useCallback(async () => {
    if (!game || busy || ended) return;
    setBusy(true);
    try { apply(await abortGame(game.id)); } catch { /* ignore */ } finally { setBusy(false); }
  }, [game, busy, ended, apply]);

  const handleOfferDraw = useCallback(async () => {
    /* An offer, not a finish: play continues and the opponent answers. Offering
       twice is harmless (the second is a no-op on the server), but the button
       is already replaced by the pending state below, so this guard is only
       for double-taps racing the response. */
    if (!game || busy || ended || game.drawOffer) return;
    setBusy(true);
    try { apply(await offerDraw(game.id)); } catch { /* ignore */ } finally { setBusy(false); }
  }, [game, busy, ended, apply]);

  const handleRespondDraw = useCallback(async (accept) => {
    if (!game || busy || ended) return;
    setBusy(true);
    try { apply(await respondDraw(game.id, accept)); } catch { /* ignore */ } finally { setBusy(false); }
  }, [game, busy, ended, apply]);

  const handleBackToClassroom = useCallback(() => {
    if (!ended && game?.status !== 'finished') return;
    if (resultRevealCancelRef.current) { resultRevealCancelRef.current(); resultRevealCancelRef.current = null; }
    endedGameRef.current = null;
    seenActiveGameRef.current = null;
    setResultHidden(false);
    setGame(null);
    setEnded(null);
    setBusy(false);
  }, [ended, game?.status]);

  /* Close button: hide the card and hand the slot back to the classroom
     (fallback). A live game is only hidden after a confirmation that says it
     keeps running; the game is never resigned or aborted here. */
  const handleHide = useCallback(() => {
    const inProgress = Boolean(game) && game.status === 'active' && !ended;
    if (inProgress && typeof window !== 'undefined') {
      if (!window.confirm('Hide this game? It will continue.')) return;
    }
    setHidden(true);
  }, [game, ended]);

  /* A brand-new pairing re-opens the card even if the previous one was hidden. */
  useEffect(() => {
    setHidden(false);
  }, [game?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (game && onOpened) onOpened(game);
  }, [game?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (ended && onEnded) onEnded({ ...game, result: ended.result });
  }, [ended]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Keep the latest move visible (runs with the other effects, above the
     early returns, so the hook order never changes between renders). A fresh
     move only pulls the list down while the viewer is pinned to its bottom. */
  const sansLen = gameRef.current ? gameRef.current.history().length : 0;
  useEffect(() => {
    if (pinnedRef.current.main) {
      try { movesEndRef.current?.scrollIntoView({ block: 'nearest' }); } catch { /* ignore */ }
    }
    if (pinnedRef.current.focus) {
      try { focusMovesEndRef.current?.scrollIntoView({ block: 'nearest' }); } catch { /* ignore */ }
    }
  }, [sansLen]);

  if (!classId || me == null) return fallback ?? null;
  /* Instructor view: never hijack the main panel with a paired/bot game —
     the admin keeps the Shared Board; games are watched in Spectate section */
  if (instructorView) return fallback ?? null;
  if (!resolved) return null;
  if (!game || game.status === 'pending') return fallback ?? null;
  if (hidden) return fallback ?? null;

  const myColor = game.myColor || 'white';
  const turnColor = gameRef.current.turn() === 'w' ? 'white' : 'black';
  const myTurn = !ended && turnColor === myColor && game.status === 'active' && !busy;
  const opponent = game.opponentName || 'Opponent';
  const myName = game.myName || 'You';

  /* Circular seat avatar. The signed-in player's own crafted avatar / profile
     photo comes from the session; the opponent is matched in the room roster
     by id, and otherwise gets the same deterministic chess avatar everyone
     else uses — always available, never a backend lookup. */
  const playerAvatar = (color) => {
    const isMe = color === myColor;
    const rosterMatch = participants.find((p) => (
      isMe ? Number(p.userId) === me : Number(p.userId) === Number(game.opponentId)
    ));
    const config = isMe ? user?.avatar_config : rosterMatch?.avatar_config;
    const photo = isMe ? user?.profile_image : rosterMatch?.profile_image;
    const seed = isMe ? `user_${me ?? ''}` : `pvp_${game.opponentId ?? opponent}`;
    if (config) return <StudentAvatar config={config} seed={seed} size={64} className="pvp-play-avatar-svg" />;
    if (photo) return <img className="pvp-play-photo" src={photo} alt="" loading="lazy" />;
    return <StudentAvatar seed={seed} size={64} className="pvp-play-avatar-svg" />;
  };

  const finished = ended || game.status === 'finished';
  /* The result banner (and Back to classroom) appears after a mating animation. */
  const resultShown = finished && !resultHidden;
  /* Move list, read live off the same Chess instance the board renders — so
     every applied move (mine, the opponent's over the socket, the bot's)
     shows up without a second source of truth. */
  const sans = gameRef.current ? gameRef.current.history() : [];
  const lastMoveIdx = sans.length - 1;
  const moveRows = [];
  for (let i = 0; i < sans.length; i += 2) {
    moveRows.push({
      n: i / 2 + 1,
      white: sans[i],
      black: sans[i + 1] || '',
      whiteCurrent: lastMoveIdx === i,
      blackCurrent: lastMoveIdx === i + 1,
    });
  }
  /* Captured material, derived live from the SAME Chess instance the board
     renders — never stored, so each player's tray can never drift from the
     position on screen. `captured.white` holds the black pieces White has
     taken; `capturedValue` is their point total for the +N advantage badge. */
  let verbose = [];
  try { verbose = gameRef.current ? gameRef.current.history({ verbose: true }) : []; } catch { verbose = []; }
  const captured = { white: [], black: [] };
  const capturedValue = { white: 0, black: 0 };
  for (const mv of verbose) {
    if (!mv || !mv.captured) continue;
    const by = mv.color === 'w' ? 'white' : 'black';
    captured[by].push(CAPTURE_GLYPH[mv.color === 'w' ? 'b' : 'w'][mv.captured]);
    capturedValue[by] += CAPTURE_VALUE[mv.captured] || 0;
  }
  /* Bot rows carry no clock fields, so baseMinutes/incrementSeconds can be
     missing — show just the move count rather than "undefined+undefined". */
  const tcLabel = game.baseMinutes == null
    ? null
    : game.baseMinutes >= 9999
      ? '∞ (unlimited)'
      : `${game.baseMinutes}+${game.incrementSeconds ?? 0}`;
  /* Computer games have no opponent to agree a draw with, so the button is
     meaningless there — and `endGame` would mark the row 'abandoned', which
     reads as a real result in the coach's game list. Resign stays (it ends the
     student's own attempt); only the draw control is bot-only-exempt. */
  const isBotGame = Boolean(game.isBot);

  /* Abort lives only in the starting position: fewer than two half-moves on
     the server's move list. Derived from `game`, never from local state, so
     the instant the second half-move lands over the socket both clients drop
     the button with no refresh and no extra call. */
  const canAbort = !finished && (game?.moves?.length || 0) < 2;

  /* Draw-offer bar. Plain JSX (not a component) rendered in the card head and
     mirrored into the expanded overlay, so the pending offer — and, for the
     opponent, the Accept/Decline answer — is one tap away wherever the player
     is looking. Bot games never have offers (no opponent to answer), so the
     bar stays null there and the offer button below stays hidden with it. */
  const offer = !isBotGame ? game?.drawOffer || null : null;
  const drawBar = offer ? (
    offer.mine ? (
      <div className="pvp-play-drawbar" role="status">
        <span>🤝 Draw offered — waiting for {opponent}…</span>
      </div>
    ) : (
      <div className="pvp-play-drawbar pvp-play-drawbar-theirs" role="alert">
        <span>🤝 {offer.byName || opponent} offers a draw</span>
        <span className="pvp-play-drawbar-actions">
          <Button type="button" variant="primary" size="sm" onClick={() => handleRespondDraw(true)} disabled={busy}>
            Accept
          </Button>
          <Button type="button" variant="danger" size="sm" onClick={() => handleRespondDraw(false)} disabled={busy}>
            Decline
          </Button>
        </span>
      </div>
    )
  ) : null;

  /* Board orientation is `myColor`, so the bottom edge of the board is always my
     side and the top edge is the opponent's. The two caption rows must follow that
     edge, not a fixed order — keying them by colour keeps each name, piece glyph
     and clock with the side it actually belongs to. */
  const playerRow = (color) => {
    const isMe = color === myColor;
    const isTheirTurn = turnColor === color && !finished;
    const taken = captured[color];
    const matDiff = capturedValue[color] - capturedValue[color === 'white' ? 'black' : 'white'];
    /* The live remaining time, ticking while it is their turn. Unlimited games
       show ∞ instead of a huge minute count; a payload with no clock at all
       (or a missing time control) falls back to the static label, then ⏱. */
    const unlimited = Number(game?.clock?.baseMinutes ?? 0) >= 9999;
    const shown = unlimited
      ? '∞'
      : formatClock(remainingMs(clock, color, nowTs)) || tcLabel || '⏱';
    return (
      <div key={color} className={`pvp-play-player ${isTheirTurn ? 'pvp-play-player-on' : ''}`}>
        <span className="pvp-play-avatar" aria-hidden="true">{playerAvatar(color)}</span>
        <span className="pvp-play-who">
          <span className="pvp-play-name">
            {isMe ? `${myName} ` : opponent}
            {isMe && <em>you</em>}
          </span>
          <span className="pvp-play-sub">
            <span className="pvp-play-color">{color === 'white' ? '⚪ White' : '⚫ Black'}</span>
            {isTheirTurn && <span className="pvp-play-turn">· to move</span>}
            {taken.length > 0 && (
              <span className="pvp-play-captured" aria-label={isMe ? 'Your captures' : `${opponent}'s captures`}>
                {taken.map((g, i) => (
                  <span key={i} className={`cp ${WHITE_GLYPHS.has(g) ? 'cp-white' : 'cp-black'}`}>{g}</span>
                ))}
                {matDiff > 0 && <span className="cp-diff">+{matDiff}</span>}
              </span>
            )}
          </span>
        </span>
        <span
          className={`pvp-play-clock ${!finished && clock.turn === color ? 'pvp-play-clock-run' : ''}`}
          title={tcLabel ? `Time control ${tcLabel}` : 'Game clock'}
        >
          {shown}
        </span>
      </div>
    );
  };
  /* Live status line + the game action controls. The card header and the
     expanded overlay's details card render THESE — one definition, one source
     of state — so the two views are a single picture of the game. The moment it
     ends, the result banner (winner + reason) replaces "Your move"/"Waiting" and
     the buttons switch to "Back to classroom" in both places at once. The expand
     affordance only makes sense on the card (the overlay is already expanded),
     so it is opt-in. */
  const statusPill = finished ? (
    resultHidden
      ? <span className="pvp-play-pill-gold">Game over</span>
      : <span className="pvp-play-pill-gold result-reveal">{resultLabel(game.result, game.resultReason)}</span>
  ) : (
    <span className={`pvp-play-pill-cyan ${myTurn ? 'pvp-play-pill-live' : ''}`}>
      {myTurn ? 'Your move' : 'Waiting for opponent…'}
    </span>
  );

  const actionControls = (withExpand) => (
    resultShown ? (
      <Button type="button" variant="secondary" size="sm" onClick={handleBackToClassroom} title="Close this finished game and return to the classroom board">
         Back to classroom
      </Button>
    ) : finished ? null : (
      <>
        {!isBotGame && !game?.drawOffer && (
          <Button type="button" variant="secondary" size="sm" onClick={handleOfferDraw} disabled={busy} title="Offer a draw — your opponent accepts or declines">
            🤝 Offer draw
          </Button>
        )}
        {canAbort && (
          <Button type="button" variant="danger" size="sm" onClick={handleAbort} disabled={busy} title="Abort this game — only before both players have moved">
            🚫 Abort
          </Button>
        )}
        <Button type="button" variant="danger" size="sm" onClick={handleResign} disabled={busy} title="Resign this game">
          🏳 Resign
        </Button>
        {withExpand && (
          <button
            type="button"
            className="pvp-play-btn pvp-expand-btn"
            onClick={openExpand}
            disabled={busy}
            title="Expand board"
            aria-label="Expand board"
          >
            ⛶
          </button>
        )}
      </>
    )
  );

  /* Top edge of the board is the side you are not playing; bottom is yours. */
  const topColor = myColor === 'white' ? 'black' : 'white';
  const bottomColor = myColor;
  /* Player plates are pinned to the board's own framed width so opponent /
     board / you read as one aligned column rather than full-width bars beside a
     narrower board. `boardSize` is always a positive number after the first
     measure; the guard just avoids a zero-width flash on the very first paint. */
  const seatStyle = boardSize > 0 ? { width: framedWidth(boardSize) } : undefined;

  return (
    <div className="pvp-play" ref={cardRef}>
      <div className="pvp-play-head">
        <div className="pvp-play-head-left">
          <span className="pvp-play-pill">⚔ My paired game</span>
          {statusPill}
        </div>
        <div className="pvp-play-controls">
          {actionControls(true)}
          <button
            type="button"
            className="pvp-play-close"
            onClick={handleHide}
            aria-label="Close game card"
            title="Close — the game keeps running"
          >
            ✕
          </button>
        </div>
      </div>

      {drawBar}

      <div className="pvp-play-body">
        <div className="pvp-play-boardcol">
          {/* Classic chess-app arrangement: the OPPONENT's name + clock sits
              above the board and YOURS below, each plate pinned to the board's
              framed width (`seatStyle`) so the three line up as one column.
              The score sheet stays below the whole column. */}
          <div className="pvp-play-seat" style={seatStyle}>
            {playerRow(topColor)}
          </div>

          <div ref={areaRef} className="pvp-play-boardstage">
            <div ref={fitRef} className="pvp-play-boardwrap">
              <ChessBoard
                game={gameRef.current}
                fen={gameRef.current.fen()}
                orientation={myColor}
                interactive={myTurn}
                onMove={onMove}
                boardWidth={boardSize}
                engineOn={false}
                highlightLastMove
                /* Tells the board which side is "me", so the opponent's move arriving
                   over the socket gets the opponent cue rather than your own. */
                selfColor={myColor}
                /* Tapping a piece must reveal where it can go. The board only wires
                   click-to-select when this is on, and it is gated on `interactive`
                   internally, so the opponent's pieces stay inert on their turn. */
                showLegalMoves
              />
            </div>
          </div>

          <div className="pvp-play-seat" style={seatStyle}>
            {playerRow(bottomColor)}
          </div>
        </div>

        <div className="pvp-play-moves">
          <p className="pvp-play-moves-title">♘ Moves <span>{sans.length}</span></p>
          {moveRows.length === 0 ? (
            <p className="pvp-play-moves-empty">No moves yet.</p>
          ) : (
            <div className="pvp-play-moves-list" onScroll={onMovesScroll('main')}>
              {moveRows.map((row) => (
                <div
                  key={row.n}
                  className={`pvp-play-moverow${row.whiteCurrent || row.blackCurrent ? ' pvp-play-moverow-current' : ''}`}
                >
                  <span className="pvp-play-movenum">{row.n}.</span>
                  <span
                    className={`pvp-play-move${row.whiteCurrent ? ' pvp-play-move-current' : ''}`}
                    onClick={scrollMoveIntoView}
                    title={row.white}
                  >
                    {row.white}
                  </span>
                  <span
                    className={`pvp-play-move${row.blackCurrent ? ' pvp-play-move-current' : ''}`}
                    onClick={row.black ? scrollMoveIntoView : undefined}
                    title={row.black || ''}
                  >
                    {row.black}
                  </span>
                </div>
              ))}
              <div ref={movesEndRef} />
            </div>
          )}
        </div>
      </div>

      <div className="pvp-play-tc">
        {tcLabel ? `Time control ${tcLabel} · ` : ''}{game.moves?.length || 0} moves
      </div>

      {/* Focus overlay: two cards — the board alone in one, players Clocks,
          moves and Resign in the other. Both views share the SAME gameRef
          position — no second game instance, so everything keeps working
          live. Unmounting changes nothing. */}
      {expanded && (
        <div
          className={`pvp-focus-backdrop${closing ? ' is-closing' : ''}`}
          onClick={closeExpand}
        >
          <div className="pvp-focus-wrap">
            <div
              className="pvp-focus-card pvp-focus-boardcard"
              role="dialog"
              aria-modal="true"
              aria-label="Expanded paired game board"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className="pvp-focus-x"
                onClick={closeExpand}
                aria-label="Exit full screen"
                title="Exit full screen"
              >
                ✕
              </button>
              {/* Phones put the two player plates around the board itself (the
                  details card's copies are hidden at that width), so name,
                  colour and clock stay visible above and below the pieces. */}
              <div className="pvp-focus-seat pvp-focus-seat-top">{playerRow(topColor)}</div>
              <ChessBoard
                game={gameRef.current}
                fen={gameRef.current.fen()}
                orientation={myColor}
                interactive={myTurn}
                onMove={onMove}
                boardWidth={focusSize}
                frameless={focusFrameless}
                engineOn={false}
                highlightLastMove
                selfColor={myColor}
                showLegalMoves
              />
              <div className="pvp-focus-seat pvp-focus-seat-bottom">{playerRow(bottomColor)}</div>
              {/* Phone full-screen only: status, an incoming/answered draw offer
                  and the action controls sit directly under the board, so the
                  result and Resign/Draw/Back are visible without scrolling. */}
              <div className="pvp-focus-statusbar">
                {drawBar}
                <div className="pvp-focus-status">{statusPill}</div>
                <div className="pvp-play-controls pvp-focus-controls">{actionControls(false)}</div>
              </div>
            </div>
            <div
              className="pvp-focus-card pvp-focus-side"
              aria-label="Game details"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="pvp-focus-exit">
                <Button type="button" variant="secondary" size="sm" onClick={closeExpand}>
                  ← Exit full screen
                </Button>
              </div>
              {playerRow(topColor)}
              {playerRow(bottomColor)}
              <div className="pvp-play-tc">
                {tcLabel ? `Time control ${tcLabel} · ` : ''}{game.moves?.length || 0} moves
              </div>
              {drawBar}
              <div className="pvp-play-moves">
                <p className="pvp-play-moves-title">♘ Moves <span>{sans.length}</span></p>
                {moveRows.length === 0 ? (
                  <p className="pvp-play-moves-empty">No moves yet.</p>
                ) : (
                  <div className="pvp-play-moves-list" onScroll={onMovesScroll('focus')}>
                    {moveRows.map((row) => (
                      <div
                        key={row.n}
                        className={`pvp-play-moverow${row.whiteCurrent || row.blackCurrent ? ' pvp-play-moverow-current' : ''}`}
                      >
                        <span className="pvp-play-movenum">{row.n}.</span>
                        <span
                          className={`pvp-play-move${row.whiteCurrent ? ' pvp-play-move-current' : ''}`}
                          onClick={scrollMoveIntoView}
                          title={row.white}
                        >
                          {row.white}
                        </span>
                        <span
                          className={`pvp-play-move${row.blackCurrent ? ' pvp-play-move-current' : ''}`}
                          onClick={row.black ? scrollMoveIntoView : undefined}
                          title={row.black || ''}
                        >
                          {row.black}
                        </span>
                      </div>
                    ))}
                    <div ref={focusMovesEndRef} />
                  </div>
                )}
              </div>
              <div className="pvp-focus-status">{statusPill}</div>
              <div className="pvp-play-controls pvp-focus-controls">{actionControls(false)}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}