import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import ChessBoard from '../components/ChessBoard';
import BotAvatar from '../components/bots/BotAvatar';
import BotChat from '../components/bots/BotChat';
import { useBotGame, statusLabel } from '../hooks/useBotGame';
import { useGameTimer } from '../hooks/useGameTimer';
import { useStockfish } from '../hooks/useStockfish';
import { useBotProgress } from '../hooks/useBotProgress';
import { useLeaveGameGuard } from '../hooks/useLeaveGameGuard';
import LeaveGameConfirmDialog from '../components/LeaveGameConfirmDialog';
import { getBot, getTimeControl, getColorChoice, resolveColor } from '../services/BotService';
import { submitResult } from '../services/botsApi';
import PostGameResultPopup from '../components/PostGameResultPopup';
import Button from '../components/Button';
import { analyzeGame, buildCoachMessage } from '../utils/gameAnalysis';
import usePageTitle from '../hooks/usePageTitle';
import { useFittedSquare } from '../hooks/useBoardWidth';
import { revealAfterCheckmate } from '../effects/moveEffect';

/**
 * /play/bot/:botId — a single bot match.
 *
 * The route param is untrusted input. `getBot()` validates it and a bad id
 * renders a real "not found" state with a link back to the catalogue, rather
 * than quietly substituting some default bot.
 *
 * The board is driven by one `Chess` instance owned by `useBotGame`. That is the
 * same contract the rest of the app uses (Play Arena, tournaments, live class),
 * which is why there is no separate move-validation path here.
 */
export default function BotGamePage() {
  usePageTitle('Bot Game');
  const { botId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  /* Validate the route param BEFORE any hook that depends on it. */
  const bot = useMemo(() => getBot(botId), [botId]);
  const tc = useMemo(() => getTimeControl(searchParams.get('tc')), [searchParams]);
  const colorChoice = useMemo(() => getColorChoice(searchParams.get('color')), [searchParams]);

  if (!bot) return <BotNotFound requestedId={botId} />;

  /* remountKey changes when the player switches bots or time control, which
     resets all game state without needing a manual effect dance. */
  return (
    <Game
      key={`${bot.id}:${tc?.id}:${colorChoice}`}
      bot={bot}
      timeControl={tc}
      colorChoice={colorChoice}
      navigate={navigate}
    />
  );
}

function Game({ bot, timeControl, colorChoice, navigate }) {
  /* Board size. Fitted to BOTH axes, because this page must not scroll.

     Capped at 530 (408 + 30%), restoring the board to a comfortable playing size
     after the earlier 40% reduction (680 -> 408). The panel beside it is a fixed
     320px, so 530 still leaves the moves list and chat readable at 1280px+.

     The height axis is the part that was missing. useBoardWidth only ever read
     window.innerWidth, but the board's real height is not 530: ChessBoard wraps it
     in a themed frame (clamp(round(width * 0.082), 20, 46) of band on each side)
     plus frame padding and a notation row, so the column needs roughly 655px. On
     any window shorter than that the page grew past the viewport and scrolled.
     useFittedSquare measures the container and that overhead off the DOM, then
     solves for the largest square that fits both axes.

     areaRef is the padded board container and fitRef the child sized to the board;
     the gap between the child's height and the board width IS the overhead. */
  const { areaRef, fitRef, size: boardWidth } = useFittedSquare({ max: 530, min: 280 });
  const { user, settings, updateSetting, forBot, refresh } = useBotProgress();
  const engine = useStockfish({ ownsPool: true });
  const chatOn = settings.chat !== false;

  /* 'random' is resolved ONCE here, so a rematch keeps the same sides unless
     the player explicitly asks to swap. */
  const [playerColor, setPlayerColor] = useState(() => resolveColor(colorChoice));
  const [outcome, setOutcome] = useState(null);
  /* The result card is held back until a mating move's animation is done. */
  const [resultReady, setResultReady] = useState(true);
  const resultRevealCancelRef = useRef(null);
  const gameSeqRef = useRef(0);
  /* The completion card is shown once per game. Undo/redo (or a repeated
     onFinish for the same mate) replays the animation but never the card. */
  const completionShownRef = useRef(null);

  const onFinish = useCallback(
    async (payload) => {
      /* Show the result immediately; coins land a tick later from the API. */
      setOutcome({ ...payload, coinsEarned: 0 });
      if (resultRevealCancelRef.current) { resultRevealCancelRef.current(); resultRevealCancelRef.current = null; }
      if (payload.status === 'checkmate') {
        const gameKey = String(payload.gameId || `seq:${gameSeqRef.current}`);
        if (completionShownRef.current === gameKey) {
          /* Same game, mate already celebrated: no second card. */
          setResultReady(true);
        } else {
          setResultReady(false);
          resultRevealCancelRef.current = revealAfterCheckmate(
            {},
            () => {
              completionShownRef.current = gameKey;
              resultRevealCancelRef.current = null;
              setResultReady(true);
            },
          );
        }
      } else {
        setResultReady(true);
      }
      const record = await submitResult({
        bot,
        result: payload.result,
        /* The signed-in user must be passed through, otherwise the local
           record is filed under guest scope and the catalogue never updates. */
        user,
        gameId: payload.gameId,
        plies: payload.plies,
      });
      const coins = Number(record?.coinsEarned ?? 0);
      const total = Number(record?.coins);
      /* The total balance rides along so the result panel can show the honest
         before → after (+earned) line. Guarded the same way as before: a
         missing total simply leaves the panel's fallback text in place. */
      if (coins || Number.isFinite(total)) {
        setOutcome((prev) => (prev
          ? { ...prev, coinsEarned: coins, ...(Number.isFinite(total) ? { coinsTotal: total } : {}) }
          : prev));
      }
      refresh();
    },
    [bot, user, refresh],
  );

  const game = useBotGame({
    bot,
    playerColor,
    timeControlSeconds: timeControl?.seconds || 0,
    chatEnabled: chatOn,
    onFinish,
  });

  /* Clocks. `flagBot`/`flagPlayer` are wired to whichever side ran out, and the
     game hook classifies a flag by side-to-move, so the winner is always right. */
  const timer = useGameTimer({
    seconds: timeControl?.seconds || 0,
    turn: game.turn,
    running: game.status === 'playing' && !outcome,
    onFlag: (flagged) => (flagged === game.botColor[0] ? game.flagBot() : game.flagPlayer()),
  });

  /* Stop any in-flight engine search the moment the game ends. */
  useEffect(() => {
    if (game.status !== 'playing') engine.stop();
  }, [game.status, engine]);

  /* Restart in place. Always clears the result panel, otherwise a finished
     game would leave its banner on screen after "Rematch". */
  /* Rematch resets the clocks. `useGameTimer` only reseeds when its `seconds`
     prop changes, and a rematch keeps the same time control, so without this the
     second game started on whatever was left on the clock. It also clears the
     flag latch - otherwise the side that already flagged stays latched and the
     next flagfall never ends the game. */
  const restartClock = useCallback(
    () => timer.reset(timeControl?.seconds || 0),
    [timer, timeControl],
  );

  const startOver = useCallback(() => {
    if (resultRevealCancelRef.current) { resultRevealCancelRef.current(); resultRevealCancelRef.current = null; }
    gameSeqRef.current += 1;
    completionShownRef.current = null;
    game.rematch();
    restartClock();
    setOutcome(null);
    setResultReady(true);
    setPopupOpen(false);
    setPopupDismissed(false);
  }, [game, restartClock]);

  const swapAndRestart = useCallback(() => {
    if (resultRevealCancelRef.current) { resultRevealCancelRef.current(); resultRevealCancelRef.current = null; }
    gameSeqRef.current += 1;
    completionShownRef.current = null;
    setPlayerColor((c) => (c === 'white' ? 'black' : 'white'));
    game.rematch();
    restartClock();
    setOutcome(null);
    setResultReady(true);
    setPopupOpen(false);
    setPopupDismissed(false);
  }, [game, restartClock]);

  /* ---- optional post-game analysis ------------------------------------
     Same components the Arena board uses (`PostGameResultPopup` +
     `utils/gameAnalysis`) so bot results read identically to rated games.
     `gameAnalysis` runs on nnueEngine, a separate module from this game's
     stockfish pool, so grading the game cannot starve the bot's own engine. */
  const [analysis, setAnalysis] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [popupOpen, setPopupOpen] = useState(false);
  const [popupDismissed, setPopupDismissed] = useState(false);
  const { open: leaveOpen, stay: leaveStay, leave: leaveLeave } = useLeaveGameGuard(!outcome);
  const analysisToken = useRef(0);

  const sanMoves = useMemo(() => game.history.map((m) => m.san), [game.history]);

  /* Grade the finished game once. The token guards the unmount/rematch races:
     a run started for the previous game must not write into the new one. */
  useEffect(() => {
    if (!outcome || sanMoves.length === 0) return undefined;
    const token = ++analysisToken.current;
    let cancelled = false;
    setAnalysis(null);
    setAnalyzing(true);
    analyzeGame('start', sanMoves, { isCancelled: () => cancelled || token !== analysisToken.current })
      .then((res) => {
        if (!cancelled && token === analysisToken.current) setAnalysis(res);
      })
      .catch(() => { /* analysis is a bonus; never disturb the result */ })
      .finally(() => {
        if (!cancelled && token === analysisToken.current) setAnalyzing(false);
      });
    return () => { cancelled = true; };
  }, [outcome, sanMoves]);

  /* Abandon the in-flight run if the page goes away mid-grade. */
  useEffect(() => () => {
    analysisToken.current++;
    if (resultRevealCancelRef.current) { resultRevealCancelRef.current(); resultRevealCancelRef.current = null; }
  }, []);

  /* The result popup does NOT auto-open: the inline panel below is the single
     result surface, so the end of a game never shows two stacked result cards.
     The popup (with move grades) stays one tap away through the panel's
     "View result & analysis" button. */

  /* Move-quality rows for the player's own side only, mirroring the Arena
     board. Zero-count verdicts are dropped so the row stays readable. */
  const popupStats = useMemo(() => {
    const counts = analysis?.counts?.[playerColor];
    if (!counts) return [];
    return [
      { icon: '!!', count: counts.brilliant, label: 'Brilliant', color: '#19c9c3' },
      { icon: '!', count: counts.great, label: 'Great', color: '#3d7ff5' },
      { icon: '\u2713', count: counts.best, label: 'Best', color: '#7bc96f' },
      { icon: '?', count: counts.good, label: 'Good', color: '#a3d977' },
      { icon: '?!', count: counts.inaccuracy, label: 'Inaccuracy', color: '#93c5fd' },
      { icon: '??', count: counts.mistake, label: 'Mistake', color: '#e58f4a' },
      { icon: '???', count: counts.blunder, label: 'Blunder', color: '#f87171' },
    ].filter((s) => s.count > 0);
  }, [analysis, playerColor]);

  const popupCoach = useMemo(() => {
    if (!outcome) return '';
    if (analyzing) return 'Grading your moves\u2026';
    return buildCoachMessage({
      won: outcome.result === 'win',
      drew: outcome.result === 'draw',
      counts: analysis?.counts || null,
      mySide: playerColor,
      reason: statusLabel(outcome.status),
    });
  }, [outcome, analysis, analyzing, playerColor]);

  /* Full Game Review is stateless here (`?pgn=`), so a bot game reviews without
     ever being written to game history. */
  const goToReview = useCallback(() => {
    const pgn = game.pgn();
    const query = pgn && sanMoves.length > 0
      ? `?pgn=${encodeURIComponent(pgn)}`
      : `?fen=${encodeURIComponent(game.fen())}`;
    navigate(`/student/review${query}`);
  }, [game, navigate, sanMoves.length]);

  const boardSide = playerColor === 'white' ? 'white' : 'black';
  const lowTime = !timer.unlimited && Math.min(timer.white, timer.black) < 30000;

  const activeRecord = forBot(bot.id);

  /* Player clock rows. Extracted so the panel card and the value stay together —
     the two used to be separate JSX blocks around the board, which is why the
     name and its clock could drift apart. */
  const playerClock = timer.format(playerColor === 'white' ? timer.white : timer.black);
  const botClock = timer.format(playerColor === 'black' ? timer.white : timer.black);
  const isPlayerTop = boardSide === 'w';

  return (
    /* Layout mirrors the Play Arena card: a fixed-width panel down the LEFT
       holding identity, clocks, chat and moves, and the board centred in the
       remaining space. Reuses the .play-mode-* classes rather than inventing a
       parallel look, so this page and the Play Arena stay visually identical.
       Deliberately NOT .play-mode-overlay: that class is position:fixed and
       would swallow the app shell, the floating back pill and the post-game
       popup that all still need to work here. */
    <div className="flex h-screen flex-col overflow-hidden bg-ink-950 text-ivory-300 lg:flex-row">
      {/* ── Panel ─────────────────────────────────────────────────────── */}
      {/* Deliberately NOT `.play-mode-panel`. That class hardcodes
          `width: 320px` and is declared AFTER @tailwind utilities in index.css,
          so it beats a `w-full` utility and would pin this panel to 320px on a
          phone too, squeezing the board. Only the visual classes are reused
          here; the responsive layout is set with utilities below. */}
      <aside className="order-2 flex min-h-0 w-full shrink-0 flex-col border-b border-ivory-700/40 bg-ink-900 lg:order-1 lg:w-[320px] lg:border-b-0 lg:border-r">
        <div className="play-mode-panel-scroll !p-3 lg:!py-3.5 lg:!pr-2.5 lg:!pl-3.5">
          {/* identity */}
          <div className="play-mode-top">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                icon="←"
                onClick={() => navigate('/play/bots')}
                aria-label="Back to bots"
              >
                Bots
              </Button>
              <BotAvatar bot={bot} size={34} />
            </div>
            <h1 className="play-mode-title mt-1.5">{bot.name}</h1>
            <p className="play-mode-sub">
              {bot.rating} · {bot.difficulty}
              {activeRecord?.defeated ? ' · defeated' : ''} · {timeControl?.label || '5 min'}
            </p>
          </div>

          {engine.message && (
            <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[0.7rem] text-amber-300" role="status">
              {engine.message} Bot moves will be weaker until the engine starts.
            </p>
          )}
          {game.engineError && (
            <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[0.7rem] text-amber-300" role="status">
              {game.engineError}
            </p>
          )}

          {/* clocks — same card shape as the Play Arena player rows */}
          <div className={`play-mode-player ${isPlayerTop ? 'play-mode-player-top' : 'play-mode-player-bot'}`}>
            <span className="ab-player-name">You</span>
            <span className={`ab-clock ${lowTime ? 'ab-clock-low' : ''}`}>
              <span className="ab-clock-time">{playerClock}</span>
            </span>
          </div>

          <div className={`play-mode-player ${isPlayerTop ? 'play-mode-player-bot' : 'play-mode-player-top'}`}>
            <BotAvatar bot={bot} size={26} rounded="rounded-full" />
            <span className="ab-player-name">{bot.name}</span>
            <span className={`ab-clock ${lowTime ? 'ab-clock-low' : ''}`}>
              <span className="ab-clock-time">{botClock}</span>
            </span>
            {game.botThinking && (
              <span className="text-[0.65rem] text-ivory-500" aria-live="polite">thinking…</span>
            )}
          </div>

          <BotChat bot={bot} line={game.chatLine} enabled={chatOn} onToggle={(v) => updateSetting('chat', v)} thinking={game.botThinking} />

          {/* moves + controls */}
          <div className="rounded-2xl border border-ivory-700/40 bg-ink-800/60 p-3">
            <p className="text-xs text-ivory-500">
              Moves: <span className="tabular-nums text-ivory-300">{Math.ceil(game.history.length / 2)}</span>
              {game.check && <span className="ml-2 text-amber-400">check!</span>}
            </p>
          </div>

          <div className="play-mode-controls !justify-start">
            <Button type="button" variant="primary" size="sm" onClick={startOver}>
              Rematch
            </Button>
            <Button
              type="button"
              variant="danger"
              size="sm"
              onClick={game.resign}
              disabled={game.status !== 'playing'}
            >
              Resign
            </Button>
            {game.status !== 'playing' && (
              <Button type="button" variant="primary" size="sm" onClick={swapAndRestart}>
                Rematch as {playerColor === 'white' ? 'black' : 'white'}
              </Button>
            )}
            <Button to="/play/bots" variant="secondary" size="sm">Change opponent</Button>
          </div>

          {outcome && resultReady && (
            <ResultPanel
              outcome={outcome}
              bot={bot}
              playerColor={playerColor}
              userName={user?.name}
              record={activeRecord}
              onReview={sanMoves.length > 0 ? goToReview : null}
              canReopen={popupDismissed}
              onReopen={() => setPopupOpen(true)}
            />
          )}
        </div>
      </aside>

      {/* ── Board ─────────────────────────────────────────────────────── */}
      {/* Also not `.play-mode-board-area`: its padding assumes Play Arena's
          fixed exit button in the top-right, which does not exist here. */}
      <div
        /* `items-start` + `my-auto` on the child, NOT `items-center`. A centred
           flex item that overflows its container has its overflow clipped at the
           start edge and cannot be scrolled to, so on a very short window the top
           of the board would be permanently unreachable. Auto margins centre the
           child when it fits and still allow scrolling to the start when it does
           not. `overflow-auto` is only the below-the-floor safety valve: the board
           is fitted down to 280px, and shrinking it further would make it
           unplayable, so that last sliver scrolls rather than clipping. */
        ref={areaRef}
        className="order-1 flex min-h-0 flex-1 items-start justify-center overflow-auto p-3 pt-6 lg:order-2 lg:p-4"
      >
        <div ref={fitRef} className="mx-auto my-auto w-fit max-w-full">
          <ChessBoard
            game={game.game}
            fen={game.fen}
            orientation={boardSide}
            boardWidth={boardWidth}
            interactive={game.humanTurn}
            draggableColor={playerColor === 'white' ? 'w' : 'b'}
            selfColor={playerColor === 'white' ? 'w' : 'b'}
            onMove={game.onHumanMove}
            lastMove={game.lastMove}
            showNotation
            showLegalMoves={false}
            clickToMove
          />
        </div>
      </div>

      {/* Optional post-game analysis. Dismissing it leaves the inline panel
          behind, so the result and the final position stay readable. */}
      <LeaveGameConfirmDialog open={leaveOpen} onStay={leaveStay} onLeave={leaveLeave} />
      <PostGameResultPopup
        open={popupOpen && !!outcome && resultReady}
        title={outcome ? (outcome.result === 'win' ? 'You Won!' : outcome.result === 'draw' ? 'Draw' : 'You Lost') : ''}
        reason={outcome ? `${statusLabel(outcome.status)} vs ${bot.name}` : ''}
        tone={outcome?.result === 'win' ? 'win' : outcome?.result === 'draw' ? 'draw' : 'loss'}
        coach={popupCoach}
        stats={popupStats}
        analyzing={analyzing}
        avatar={<BotAvatar bot={bot} size={40} />}
        onClose={() => { setPopupOpen(false); setPopupDismissed(true); }}
        onReview={sanMoves.length > 0 ? goToReview : null}
        secondary={[
          { label: 'Rematch', onClick: startOver, primary: true },
          { label: 'Swap sides', onClick: swapAndRestart },
        ]}
      />
    </div>
  );
}

/**
 * Post-game panel. Stays inline beneath the board so the result, the coins and
 * the final position remain readable after the analysis popup is dismissed;
 * `onReopen` brings the popup (with move grades) back.
 */
function ResultPanel({ outcome, bot, playerColor, userName, record, onReview, canReopen = false, onReopen }) {
  const won = outcome.result === 'win';
  const drew = outcome.result === 'draw';

  /* Bot Coins are the honest "rating" of a bot game: real balance movement,
     before → after. A bot has no chess rating, so none is invented. */
  const earned = Number(outcome.coinsEarned || 0);
  const total = Number(outcome.coinsTotal);
  const before = Number.isFinite(total) ? total - earned : null;
  const botSide = playerColor === 'white' ? 'black' : 'white';
  const headGames = (record?.wins || 0) + (record?.losses || 0) + (record?.draws || 0);

  return (
    <div
      className={`rounded-2xl border p-4 ${
        won
          ? 'border-emerald-500/50 bg-emerald-500/10'
          : drew
            ? 'border-ivory-700/40 bg-ink-800/60'
            : 'border-red-500/40 bg-red-500/10'
      }`}
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-bold">
            {won ? 'You win!' : drew ? 'Draw' : 'You lose'}
          </h2>
          <p className="mt-1 text-xs text-ivory-400">
            {statusLabel(outcome.status)} vs {bot.name}
          </p>
          {outcome.plies != null && (
            <p className="mt-1 text-xs text-ivory-500 tabular-nums">{Math.ceil(outcome.plies / 2)} moves played</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {onReview && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onReview}
            >
              📊 Review
            </Button>
          )}
          {canReopen && onReopen && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onReopen}
            >
              View result &amp; analysis
            </Button>
          )}
        </div>
      </div>

      {/* players */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-ivory-700/40 bg-black/[0.03] px-3 py-2">
          <p className="text-[0.65rem] font-bold uppercase tracking-wider text-ivory-500">
            {playerColor === 'white' ? '♔ White' : '♚ Black'}
          </p>
          <p className="mt-0.5 truncate text-sm font-bold text-ivory-100">{userName || 'You'}</p>
        </div>
        <div className="rounded-xl border border-ivory-700/40 bg-black/[0.03] px-3 py-2">
          <p className="text-[0.65rem] font-bold uppercase tracking-wider text-ivory-500">
            {botSide === 'white' ? '♔ White' : '♚ Black'}
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 truncate text-sm font-bold text-ivory-100">
            <BotAvatar bot={bot} size={20} rounded="rounded-full" />
            <span className="truncate">{bot.name}</span>
          </p>
          <p className="text-[0.7rem] text-ivory-500 tabular-nums">
            {bot.rating} · {bot.difficulty}
          </p>
        </div>
      </div>

      {/* Bot Coin balance movement */}
      {(before != null || earned) ? (
        <p className="mt-2 text-xs tabular-nums">
          <span className="font-semibold text-ivory-300">Bot Coins </span>
          {before != null ? (
            <>
              <span className="text-ivory-500">{before} → </span>
              <span className="font-bold text-ivory-100">{total}</span>
              {' '}
              <span className={earned > 0 ? 'font-bold text-emerald-500' : 'text-ivory-500'}>
                ({earned > 0 ? `+${earned}` : '±0'})
              </span>
            </>
          ) : (
            <span className="font-bold text-emerald-500">+{earned} Bot Coins</span>
          )}
        </p>
      ) : null}

      {/* head-to-head vs this bot */}
      {headGames > 0 && (
        <p className="mt-1 text-xs text-ivory-500 tabular-nums">
          vs {bot.name}: {record.wins || 0}W · {record.losses || 0}L · {record.draws || 0}D
        </p>
      )}
    </div>
  );
}

/** Invalid / unknown bot id. */
function BotNotFound({ requestedId }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-900 px-4 text-ivory-100">
      <div className="max-w-md space-y-4 rounded-2xl border border-ivory-700/40 bg-ink-800/70 p-6 text-center">
        <h1 className="text-xl font-bold">Bot not found</h1>
        <p className="text-sm text-ivory-400">
          There is no bot with the id <code className="text-ivory-300">{requestedId}</code>.
        </p>
        <Button to="/play/bots" variant="primary" size="md">
          Browse bots
        </Button>
      </div>
    </div>
  );
}
