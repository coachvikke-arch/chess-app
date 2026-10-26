import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Page } from '../components/ui';
import ChessBoard from '../components/ChessBoard';
import {
  getOpening,
  OPENINGS,
  getLine,
  listLines,
  buildLine,
  lineLength,
  expectedSan,
  plyMoveNumber,
  isSidePly,
} from '../lib/openings';
import { recordSession, requiredStreak, STATUS } from '../lib/openingsProgress';
import { useFittedBoardWidth } from '../hooks/useBoardWidth';
import { useAuth } from '../context/AuthContext';
import Button from '../components/Button';

/**
 * Opening practice — play the opening out against the book.
 *
 * The board is the single source of truth: a live `Chess` instance owned by this
 * page is handed to ChessBoard as a controlled prop, so the position on screen is
 * the position actually reached.
 *
 * The learner is never blocked. An off-book move is played as-is and recorded as
 * a miss, which flips the session off theory; from then on the opponent plays
 * any legal move instead of the scripted one, so the drill keeps going to the end
 * of the line either way. This is the flow the spec scripts assert against
 * (scripts/test-openings-practice.mjs).
 */
export default function OpeningPractice() {
  const { slug } = useParams();
  const [params, setParams] = useSearchParams();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const opening = getOpening(slug);

  /* ?v=<variationId> — the study view links here with the line the learner was
     reading. Absent or unknown, getLine falls back to the main line, so a
     hand-typed or stale URL still drills something real. */
  const variationParam = params.get('v') || '';
  const lines = useMemo(() => listLines(opening), [opening]);
  const line = useMemo(() => getLine(opening, variationParam), [opening, variationParam]);
  const isMainLine = !line || line.isMain;

  /* The theory the drill follows is the SELECTED line, not always the opening's
     own moves. Progress is still recorded against the opening slug, so
     practising a variation still counts towards the opening and its family badge. */
  const theory = useMemo(() => line?.moves || [], [line]);
  const { plies } = useMemo(() => (line ? buildLine(line) : { plies: [] }), [line]);
  const total = lineLength(line || { moves: [] });
  const target = requiredStreak(line || { moves: [] });
  /* Fluid board width so the framed card fits narrow viewports. */
  const boardWidth = useFittedBoardWidth(440);

  /* Live position. `gameRef` is the real game and is handed to ChessBoard as a
     controlled prop; `fen` exists to drive re-renders, since the board re-reads
     `game.fen()` on each render. Constructed eagerly (not in an effect) so the
     board is controlled from its very first render. */
  const gameRef = useRef(null);
  if (!gameRef.current) gameRef.current = new Chess();
  const [fen, setFen] = useState(() => gameRef.current.fen());
  const [ply, setPly] = useState(0);
  const [log, setLog] = useState([]);
  const [ended, setEnded] = useState(false);
  const [result, setResult] = useState(null);

  /* Counters live in refs: `recordSession` is called inside the same event that
     finishes the line, where a `setState` update has not been applied yet — so
     reading state here would record a stale `correct`. */
  const correctRef = useRef(0);
  const runRef = useRef(0);
  const bestRef = useRef(0);
  const mineRef = useRef(0);
  /* Whether the session is still following the book. An off-book learner move
     clears this, and the opponent then plays any legal move. */
  const onTheoryRef = useRef(true);
  /* The single status line under the turn prompt. Exactly one .op-hint is
     rendered at a time so its tone always describes the latest move. */
  const [hint, setHint] = useState(null);

  /* Undo/redo. chess.js has `undo()` but NO `redo()`, and a session's state is
     more than a position (log, counters, theory flag), so this keeps whole-state
     snapshots of every completed turn. `history` holds them oldest-first and its
     last entry is always the live state; `future` holds the undone ones. */
  const historyRef = useRef([]);
  const futureRef = useRef([]);
  const [navTick, setNavTick] = useState(0);

  /* A full turn state: everything the session derives from, so undo/redo restore
     it exactly rather than re-deriving it from the position. */
  const snapshot = (fenValue, plyValue, logValue, c, m, run, best, onTheory) => ({
    fen: fenValue,
    ply: plyValue,
    log: logValue,
    correct: c,
    mine: m,
    run,
    best,
    onTheory,
  });

  const restore = (s) => {
    const g = new Chess(s.fen);
    gameRef.current = g;
    correctRef.current = s.correct;
    runRef.current = s.run;
    bestRef.current = s.best;
    mineRef.current = s.mine;
    onTheoryRef.current = s.onTheory;
    setFen(s.fen);
    setPly(s.ply);
    setLog(s.log);
    /* A rewound session is live again — the recorded result no longer applies. */
    setEnded(false);
    setResult(null);
    setHint(null);
  };

  const reset = useCallback(() => {
    const g = new Chess();
    const first = [];
    /* A black opening starts after the opponent's first move, so the learner is
       always the side to move. That reply is played, but not scored. */
    if (opening?.side === 'black' && theory[0]) {
      try {
        const mv = g.move(theory[0]);
        if (mv) first.push({
        san: mv.san,
        color: mv.color,
        book: true,
        mine: false,
        text: `${mv.san} — book reply`,
      });
      } catch {
        /* malformed line — stay on the start position */
      }
    }
    gameRef.current = g;
    correctRef.current = 0;
    runRef.current = 0;
    bestRef.current = 0;
    mineRef.current = 0;
    onTheoryRef.current = true;
    setFen(g.fen());
    setPly(first.length);
    setLog(first);
    setEnded(false);
    setResult(null);
    setHint(null);
    /* History starts with the opening position itself, so the first Undo after a
       single move returns here rather than having nothing to restore. */
    historyRef.current = [
      snapshot(g.fen(), first.length, [...first], 0, 0, 0, 0, true),
    ];
    futureRef.current = [];
    setNavTick((t) => t + 1);
  }, [opening, theory]);

  useEffect(() => { reset(); }, [reset, slug, line?.id]);

  /* Switching line mid-session starts that line from move 1. */
  const selectLine = useCallback(
    (id) => {
      if (id === 'main') setParams({}, { replace: true });
      else setParams({ v: id }, { replace: true });
    },
    [setParams]
  );

  if (!opening) {
    return (
      <Page title="Openings" piece="♞" sub="That opening isn’t in the library.">
        <div className="chess-card chess-empty">
          <p className="mb-3">♙ Opening not found — it isn’t in the library.</p>
          <Button to="/openings" variant="secondary" size="md">Back to the library</Button>
        </div>
      </Page>
    );
  }

  const expected = expectedSan(line || { moves: [] }, ply);
  /* Past the last ply there is nothing left to play, even if it is nominally
     the learner's turn — the line has to read as finished. */
  const lineDone = ply >= total;
  const learnerToMove = !lineDone && isSidePly(line || { side: opening.side }, ply);
  const bookFen = plies[ply]?.fen || null;

  /* The opponent's reply: follow the book while the session is on theory, and
     otherwise (or when the book move is illegal here) play any legal move, so a
     deviation never strands the drill. Returns the log entry to append, or null
     when the opponent has no move at all (checkmate/stalemate) — which is how
     the session knows to close. */
  const advance = (game, index) => {
    const legal = game.moves();
    if (legal.length === 0) return null; // checkmate or stalemate
    const want = onTheoryRef.current ? theory[index] : null;
    const san = want && legal.includes(want) ? want : legal[0];
    let mv = null;
    try { mv = game.move(san); } catch { return null; }
    if (!mv) return null;
    return {
      san: mv.san,
      color: mv.color,
      book: san === want,
      mine: false,
      /* Spells out where the move came from, so a learner can tell the book
         line from the bot improvising once they have left theory. */
      text: san === want ? `${mv.san} — book reply` : `${mv.san} — engine pick`,
    };
  };

  /* Append the finished turn to the undo history. Any redo branch is dropped —
     once a new move is played, the abandoned future is no longer reachable.
     `plyValue` is the ply index the session ends this turn on. */
  const pushHistory = (entries, plyValue, correct, mine, run, best, onTheory) => {
    historyRef.current = [
      ...historyRef.current,
      snapshot(gameRef.current.fen(), plyValue, entries, correct, mine, run, best, onTheory),
    ];
    futureRef.current = [];
    setNavTick((t) => t + 1);
  };

  /* Take back the last completed turn, bot reply included. */
  const undoTurn = () => {
    if (historyRef.current.length < 2) return;
    const current = historyRef.current[historyRef.current.length - 1];
    const prev = historyRef.current[historyRef.current.length - 2];
    historyRef.current = historyRef.current.slice(0, -1);
    futureRef.current = [...futureRef.current, current];
    restore(prev);
    setNavTick((t) => t + 1);
  };

  /* Replay the last undone turn. */
  const redoTurn = () => {
    if (!futureRef.current.length) return;
    const next = futureRef.current[futureRef.current.length - 1];
    futureRef.current = futureRef.current.slice(0, -1);
    historyRef.current = [...historyRef.current, next];
    restore(next);
    setNavTick((t) => t + 1);
  };

  const canUndo = historyRef.current.length > 1;
  const canRedo = futureRef.current.length > 0;

  const finish = (completed) => {
    setEnded(true);
    setResult(
      recordSession({
        /* Progress is keyed on the OPENING, never the variation, so every line
           of an opening feeds the same entry and the same family badge. */
        slug: opening.slug,
        correct: correctRef.current,
        total: mineRef.current,
        streak: bestRef.current,
        completed,
        /* `requiredStreak` reads `.moves` off this, so it must be the line that
           was actually drilled — a short variation cannot demand 8 in a row. */
        opening: line ? { ...opening, moves: line.moves } : opening,
        library: OPENINGS,
        userId,
      })
    );
  };

  /* Score the learner's move and let the opponent reply. ChessBoard has already
     applied the move to the controlled game, so nothing is replayed here.

     Log entries are collected into a local array and committed in one go, so the
     finished turn can be snapshotted for Undo/Redo. */
  const commit = (san, color, wasTheory) => {
    const g = gameRef.current;
    /* Copy, never mutate: the undo history holds references to earlier log
       arrays, and pushing onto one of them in place would corrupt the snapshots
       this session can still rewind to. */
    const entries = [...log];

    let correct = correctRef.current;
    let run = runRef.current;
    let best = bestRef.current;
    const mine = mineRef.current + 1;

    if (wasTheory) {
      correct += 1;
      run += 1;
      best = Math.max(best, run);
    } else {
      run = 0;
    }

    /* The session follows the book only while the learner's last move did. */
    const onTheory = wasTheory;
    setHint(
      wasTheory
        ? { tone: 'good', text: 'Correct — that’s the main line. Keep going.' }
        : { tone: 'gentle', text: `${san} isn’t the main line, but that’s fine — play on.` }
    );
    entries.push({
      san,
      color,
      book: wasTheory,
      mine: true,
      text: wasTheory
        ? `${san} — correct, main line`
        : `${san} — your move, not the main line`,
    });

    // Counters are committed before the line is resolved, so a session that ends
    // below records the moves that were actually played.
    correctRef.current = correct;
    runRef.current = run;
    bestRef.current = best;
    mineRef.current = mine;
    onTheoryRef.current = onTheory;

    const nextPly = ply + 1;
    if (nextPly >= total) {
      setLog(entries);
      setFen(g.fen());
      setPly(nextPly);
      pushHistory(entries, nextPly, correct, mine, run, best, onTheory);
      finish(true);
      return;
    }
    /* Opponent replies, then the learner is on move again. A line can also END on
       the opponent's reply, so check the ply after it too — otherwise the drill
       would wait for a move that no longer exists. */
    const reply = advance(g, nextPly);
    if (!reply) {
      setLog(entries);
      setPly(nextPly);
      setFen(g.fen());
      pushHistory(entries, nextPly, correct, mine, run, best, onTheory);
      finish(false);
      return;
    }
    entries.push(reply);
    const after = nextPly + 1;
    setLog(entries);
    setFen(g.fen());
    setPly(after);
    pushHistory(entries, after, correct, mine, run, best, onTheory);
    if (after >= total) finish(true);
  };

  /* A move dragged on the board. Any legal move is accepted — the learner is
     never blocked, which is the whole point of the drill. */
  const onMove = (move) => {
    if (ended || !move) return;
    const want = expected;
    commit(move.san, move.color, Boolean(want) && move.san === want);
  };

  /* "Show me" — plays the expected move for the learner so they can see it. */
  const reveal = () => {
    if (ended || !expected || !gameRef.current) return;
    const g = gameRef.current;
    if (!g.moves().includes(expected)) return; // already off the book
    let mv = null;
    try { mv = g.move(expected); } catch { return; }
    if (!mv) return;
    commit(mv.san, mv.color, true);
  };

  const mine = log.filter((m) => m.mine);
  /* The counters live in refs, so they are re-read on every render; `navTick`
     is what signals that an undo/redo has just replaced them. */
  const onBookCount = correctRef.current;
  const best = bestRef.current;
  void navTick;
  const accuracy = mine.length > 0 ? Math.round((onBookCount / mine.length) * 100) : 0;
  const remaining = Math.max(0, total - ply);

  return (
    <Page
      title={isMainLine ? `Practice ${opening.name}` : `Practice ${line.name}`}
      piece="♟"
      sub="Play the line. Deviations are fine — the session records what you actually played."
      wide
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button
          to={`/openings/${opening.slug}${isMainLine ? '' : `?v=${line.id}`}`}
          variant="secondary" size="sm" className="!py-2 !px-3 text-xs"
        >
          ← Study this opening
        </Button>
        <span className="chess-chip">{opening.eco}</span>
        <span className="chess-chip">{opening.side === 'white' ? 'White' : 'Black'}</span>
        {!isMainLine && <span className="chess-chip chess-chip-gold">{line.name}</span>}
      </div>

      {/* The line being drilled, switchable without leaving the page. Same
          pattern as the study view, so the two stay in step. */}
      {lines.length > 1 && (
        <div className="op-lines" role="tablist" aria-label="Lines to practise">
          {lines.map((l) => (
            <button
              key={l.id}
              type="button"
              role="tab"
              aria-selected={l.id === line?.id}
              className={`op-line-tab ${l.id === line?.id ? 'op-line-tab--active' : ''}`}
              onClick={() => selectLine(l.id)}
              title={l.isMain ? 'The main line' : l.name}
            >
              <span className="op-line-tab-label">{l.name}</span>
              <span className="op-line-tab-meta">
                {l.moves.length} {l.moves.length === 1 ? 'ply' : 'plies'}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Live metrics strip */}
      <div className="op-practice-bar">
        <span className="op-metric"><b>{ply}</b>/{total} plies</span>
        <span className="op-metric"><b>{remaining}</b> to go</span>
        <span className={`op-metric ${onBookCount > 0 ? 'op-metric--good' : ''}`}>
          <b>{onBookCount}</b> on theory
        </span>
        <span
          className={`op-metric ${
            accuracy >= target ? 'op-metric--good' : accuracy < 60 ? 'op-metric--warn' : ''
          }`}
        >
          <b>{accuracy}%</b> accuracy
        </span>
        <span className={`op-metric ${best >= target ? 'op-metric--good' : ''}`}>
          <b>{best}</b>/{target} streak
        </span>
        <span className="ml-auto flex flex-wrap gap-2">
          <Button
            type="button"
            onClick={undoTurn}
            disabled={!canUndo}
            variant="secondary" size="sm" className="!py-1.5 !px-3 text-xs disabled:opacity-40"
            title="Take back your last move (and the reply)"
          >
            ◀ Undo
          </Button>
          <Button
            type="button"
            onClick={redoTurn}
            disabled={!canRedo}
            variant="secondary" size="sm" className="!py-1.5 !px-3 text-xs disabled:opacity-40"
            title="Replay the move you just took back"
          >
            Redo ▶
          </Button>
          <Button
            type="button"
            onClick={reset}
            variant="secondary" size="sm" className="!py-1.5 !px-3 text-xs"
          >
            ↻ Restart
          </Button>
          <Button
            type="button"
            onClick={() => finish(false)}
            disabled={ended || mine.length === 0}
            variant="secondary" size="sm" className="!py-1.5 !px-3 text-xs disabled:opacity-40"
          >
            ■ End session
          </Button>
        </span>
      </div>
      <div className="op-detail" style={{ marginTop: '0.75rem' }}>
        <div className="op-board-pair">
          <ChessBoard
            /* Controlled: this page owns the Chess instance, so the position
               stays authoritative here and a move can be taken back. */
            game={gameRef.current}
            fen={fen}
            /* Fluid, so the framed board fits narrow viewports too. */
            boardWidth={boardWidth}
            orientation={opening.side === 'white' ? 'white' : 'black'}
            /* Lock the opponent's pieces so only the learner's side is draggable. */
            draggableColor={opening.side}
            interactive={!ended}
            onMove={onMove}
            showLegalMoves
            /* Tap-piece → tap-target, so the drill works on touch screens too. */
            clickToMove
            showNotation
          />
        </div>

        <div className="op-detail-side">
          <div className="op-panel">
            <h3 className="op-panel-title">
              <span className="chess-card-piece">♟</span> What to play
            </h3>
            {ended ? (
              <p className="op-desc">Session over. Restart it to run the line again.</p>
            ) : learnerToMove ? (
              <>
                <p className="op-desc">Your move at move {plyMoveNumber(ply)}.</p>
                {/* Exactly one .op-hint on screen: its tone always describes the
                    learner's most recent move. */}
                {hint ? (
                  <p className={`op-hint op-hint--${hint.tone}`}>{hint.text}</p>
                ) : (
                  <p className="op-desc">
                    Play the book move to stay on the main line, or anything legal to explore.
                  </p>
                )}
                {bookFen && (
                  <Button
                    type="button"
                    variant="secondary" size="sm" className="!py-1.5 !px-3 text-xs mt-2"
                    onClick={reveal}
                  >
                    Show me the move
                  </Button>
                )}
              </>
            ) : (
              <p className="op-desc">Bot thinking…</p>
            )}
          </div>

          {/* Every move of the session, labelled with where it came from. */}
          <div className="op-panel">
            <h3 className="op-panel-title">
              <span className="chess-card-piece">✎</span> Session log
            </h3>
            {log.length === 0 ? (
              <p className="op-desc">Nothing played yet — make a move on the board.</p>
            ) : (
              <ul className="op-ideas">
                {log.map((m, i) => (
                  <li key={i}>
                    {m.mine ? (m.book ? '✓ ' : '✎ ') : '· '}
                    {m.text}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {ended && result && (
            <div className="op-result">
              <div className="op-result-score">{result.accuracy}%</div>
              <p className="op-result-sub">
                {onBookCount} of {mine.length} moves matched the book · best streak {best}
              </p>
              {result.justLearned && (
                <p className="op-hint op-hint--good">★ You’ve learned {opening.name}!</p>
              )}
              {result.status === STATUS.LEARNED && !result.justLearned && (
                <p className="op-hint op-hint--good">This opening is marked learned.</p>
              )}
              {result.newBadges?.length > 0 && (
                <>
                  <p className="op-result-sub">New badges</p>
                  <div className="op-badges-earned">
                    {result.newBadges.map((b) => (
                      <span key={b.id} className="op-badge-chip" title={b.detail}>
                        {b.icon} {b.name}
                      </span>
                    ))}
                  </div>
                </>
              )}
              <div className="op-actions" style={{ justifyContent: 'center' }}>
                <Button type="button" onClick={reset} variant="primary" size="md">↻ Practise again</Button>
                <Button
                  to={`/openings/${opening.slug}${isMainLine ? '' : `?v=${line.id}`}`}
                  variant="secondary" size="md"
                >
                  Study the line
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Page>
  );
}
