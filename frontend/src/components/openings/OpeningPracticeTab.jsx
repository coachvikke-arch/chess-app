import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import ChessBoard from '../ChessBoard';
import {
  getLine,
  listLines,
  buildLine,
  lineLength,
  expectedSan,
  plyMoveNumber,
  branchPly,
} from '../../lib/openings';
import { recordSession, requiredStreak, STATUS } from '../../lib/openingsProgress';
import { useFittedBoardWidth } from '../../hooks/useBoardWidth';
import { useAuth } from '../../context/AuthContext';
import Button from '../Button';

function LineChip({ line, active, onClick, isVariation }) {
  return (
    <button
      type="button"
      className={`op-line-chip ${active ? 'op-line-chip--active' : ''} ${isVariation ? 'op-line-chip--variation' : ''}`}
      onClick={onClick}
      title={line.name}
    >
      {line.name}
    </button>
  );
}

function MoveChip({ move, index, total, played, isVariationMove, onClick }) {
  const isCurrent = played && index === played.length - 1;
  const isDone = played && index < played.length;
  return (
    <button
      type="button"
      className={`op-move-chip ${isCurrent ? 'op-move-chip--active' : ''} ${isDone ? 'op-move-chip--played' : ''} ${isVariationMove ? 'op-move-chip--variation' : ''}`}
      onClick={onClick}
      disabled={!isDone && !isCurrent}
      aria-label={isDone ? `Played: ${move}` : move === '?' ? 'Not played yet' : move}
    >
      {isDone ? move : '?'}
    </button>
  );
}

export default function OpeningPracticeTab({ opening, variationParam, onLineSelect, onBackToStudy }) {
  const boardWidth = useFittedBoardWidth(440);
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const lines = useMemo(() => listLines(opening), [opening]);
  const line = useMemo(() => getLine(opening, variationParam), [opening, variationParam]);
  const isMainLine = !line || line.isMain;
  const theory = useMemo(() => line?.moves || [], [line]);
  const { plies } = useMemo(() => (line ? buildLine(line) : { plies: [] }), [line]);
  const total = lineLength(line || { moves: [] });
  const target = requiredStreak(line || { moves: [] });
  const branch = useMemo(() => branchPly(opening, line), [opening, line]);

  const gameRef = useRef(null);
  if (!gameRef.current) gameRef.current = new Chess();
  const [fen, setFen] = useState(() => gameRef.current.fen());
  const [ply, setPly] = useState(0);
  const [log, setLog] = useState([]);
  const [ended, setEnded] = useState(false);
  const [result, setResult] = useState(null);
  const [hint, setHint] = useState(null);
  const [playAsWhite, setPlayAsWhite] = useState(opening.side === 'white');

  const correctRef = useRef(0);
  const runRef = useRef(0);
  const bestRef = useRef(0);
  const mineRef = useRef(0);
  const onTheoryRef = useRef(true);
  const hintCountRef = useRef(0);
  const wrongCountRef = useRef(0);
  const historyRef = useRef([]);
  const futureRef = useRef([]);
  const [navTick, setNavTick] = useState(0);

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
    setEnded(false);
    setResult(null);
    setHint(null);
  };

  const reset = useCallback(() => {
    const g = new Chess();
    const first = [];

    /* Playing Black means White moves first, so the engine opens the line.
       Playing White (the normal case for a White opening) leaves the first
       move to the learner. */
    if (!playAsWhite && theory[0]) {
      try {
        const mv = g.move(theory[0]);
        if (mv) first.push({
          san: mv.san, color: mv.color, book: true, mine: false,
          text: `${mv.san} — book reply`
        });
      } catch { }
    }
    gameRef.current = g;
    correctRef.current = 0;
    runRef.current = 0;
    bestRef.current = 0;
    mineRef.current = 0;
    hintCountRef.current = 0;
    wrongCountRef.current = 0;
    onTheoryRef.current = true;
    setFen(g.fen());
    setPly(first.length);
    setLog(first);
    setEnded(false);
    setResult(null);
    setHint(null);
    historyRef.current = [
      snapshot(g.fen(), first.length, [...first], 0, 0, 0, 0, true)
    ];
    futureRef.current = [];
    setNavTick(t => t + 1);
  }, [opening, theory, playAsWhite]);

  useEffect(() => { reset(); }, [reset, variationParam, playAsWhite]);

  const expected = expectedSan(line || { moves: [] }, ply);
  const lineDone = ply >= total;
  /* The board only accepts moves from the learner's colour. Playing Black
     starts after the engine's first White move, so parity tracks the turn. */
  const learnerToMove = !lineDone && (ply % 2 === 0) === playAsWhite;
  const bookFen = plies[ply]?.fen || null;

  const advance = (game, index) => {
    const legal = game.moves();
    if (legal.length === 0) return null;
    const want = onTheoryRef.current ? theory[index] : null;
    const san = want && legal.includes(want) ? want : legal[0];
    let mv = null;
    try { mv = game.move(san); } catch { return null; }
    if (!mv) return null;
    return {
      san: mv.san, color: mv.color, book: san === want, mine: false,
      text: san === want ? `${mv.san} — book reply` : `${mv.san} — engine pick`
    };
  };

  const pushHistory = (entries, plyValue, correct, mine, run, best, onTheory) => {
    historyRef.current = [...historyRef.current, snapshot(gameRef.current.fen(), plyValue, entries, correct, mine, run, best, onTheory)];
    futureRef.current = [];
    setNavTick(t => t + 1);
  };

  const undoTurn = () => {
    if (historyRef.current.length < 2) return;
    const current = historyRef.current[historyRef.current.length - 1];
    const prev = historyRef.current[historyRef.current.length - 2];
    historyRef.current = historyRef.current.slice(0, -1);
    futureRef.current = [...futureRef.current, current];
    restore(prev);
    setNavTick(t => t + 1);
  };

  const redoTurn = () => {
    if (!futureRef.current.length) return;
    const next = futureRef.current[futureRef.current.length - 1];
    futureRef.current = futureRef.current.slice(0, -1);
    historyRef.current = [...historyRef.current, next];
    restore(next);
    setNavTick(t => t + 1);
  };

  const canUndo = historyRef.current.length > 1;
  const canRedo = futureRef.current.length > 0;

  const finish = (completed) => {
    setEnded(true);
    setResult({
      ...recordSession({
        slug: opening.slug,
        correct: correctRef.current,
        total: mineRef.current,
        streak: bestRef.current,
        completed,
        lineId: line?.id || 'main',
        opening: line ? { ...opening, moves: line.moves } : opening,
        library: [],
        userId,
      }),
      completed,
    });
  };

  const commit = (san, color, wasTheory) => {
    if (ended) return;
    const g = gameRef.current;
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

    const onTheory = wasTheory;
    setHint(wasTheory
      ? { tone: 'good', text: 'Correct — that\'s the book move. Keep going.' }
      : { tone: 'gentle', text: `${san} isn't the book move. Try again.` }
    );
    if (!wasTheory) wrongCountRef.current += 1;

    entries.push({
      san, color, book: wasTheory, mine: true,
      text: wasTheory ? `${san} — correct, book move` : `${san} — your move, not the book move`
    });

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

  const onMove = (move) => {
    if (ended || !move || !learnerToMove) return;
    const isBook = Boolean(expected) && move.san === expected;
    if (!isBook) {
      /* The board has already applied the move to the shared Chess instance.
         Take it back so the learner retries from the same position instead of
         walking into a line the exercise isn't teaching. */
      gameRef.current.undo();
      setFen(gameRef.current.fen());
      wrongCountRef.current += 1;
      runRef.current = 0;
      setHint({ tone: 'gentle', text: `${move.san} isn't the book move. Try again.` });
      return;
    }
    commit(move.san, move.color, true);
  };

  const reveal = () => {
    if (ended || !expected || !gameRef.current) return;
    const g = gameRef.current;
    if (!g.moves().includes(expected)) return;
    let mv = null;
    try { mv = g.move(expected); } catch { return; }
    if (!mv) return;
    hintCountRef.current += 1;
    commit(mv.san, mv.color, true);
  };

  const mine = log.filter(m => m.mine);
  const onBookCount = correctRef.current;
  const best = bestRef.current;
  void navTick;
  const accuracy = mine.length > 0 ? Math.round((onBookCount / mine.length) * 100) : 0;
  const remaining = Math.max(0, total - ply);

  const handleLineSelect = (id) => {
    onLineSelect(id);
    setPlayAsWhite(opening.side === 'white');
  };

  const toggleSide = () => setPlayAsWhite((p) => !p);

  const orientation = playAsWhite ? 'white' : 'black';
  const draggableColor = playAsWhite ? 'white' : 'black';

  return (
    <div className="op-practice-tab">
      <div className="op-practice-header">
        <Button type="button" variant="secondary" size="sm" className="!py-2 !px-3 text-xs" onClick={onBackToStudy}>
          ← Study
        </Button>
        <span className="chess-chip">{opening.eco}</span>
        <span className="chess-chip">{playAsWhite ? '♔ White' : '♚ Black'}</span>
        {!isMainLine && <span className="chess-chip chess-chip-gold">{line.name}</span>}
        <Button type="button" variant="secondary" size="md" className="ml-auto" onClick={toggleSide}>
          Play as {playAsWhite ? 'Black' : 'White'}
        </Button>
      </div>

      <div className="op-practice-line-selector" role="tablist" aria-label="Select line to practice">
        {lines.map((l) => (
          <LineChip
            key={l.id}
            line={l}
            active={l.id === line?.id}
            onClick={() => handleLineSelect(l.id)}
            isVariation={!l.isMain}
          />
        ))}
      </div>

      <div className="op-practice-bar">
        <span className="op-metric"><b>{ply}</b>/{total} plies</span>
        <span className="op-metric"><b>{remaining}</b> to go</span>
        <span className={`op-metric ${onBookCount > 0 ? 'op-metric--good' : ''}`}>
          <b>{onBookCount}</b> on theory
        </span>
        <span className={`op-metric ${accuracy >= target ? 'op-metric--good' : accuracy < 60 ? 'op-metric--warn' : ''}`}>
          <b>{accuracy}%</b> accuracy
        </span>
        <span className={`op-metric ${best >= target ? 'op-metric--good' : ''}`}>
          <b>{best}</b>/{target} streak
        </span>
        <span className="op-metric op-metric--warn"><b>{wrongCountRef.current}</b> wrong</span>
        <span className="op-metric"><b>{hintCountRef.current}</b> hints</span>
        <span className="ml-auto flex flex-wrap gap-2">
          <Button type="button" onClick={undoTurn} disabled={!canUndo} variant="secondary" size="sm" className="!py-1.5 !px-3 text-xs disabled:opacity-40" title="Undo last turn">◀ Undo</Button>
          <Button type="button" onClick={redoTurn} disabled={!canRedo} variant="secondary" size="sm" className="!py-1.5 !px-3 text-xs disabled:opacity-40" title="Redo">Redo ▶</Button>
          <Button type="button" onClick={reset} variant="secondary" size="sm" className="!py-1.5 !px-3 text-xs">↻ Restart</Button>
          <Button type="button" onClick={() => finish(false)} disabled={ended || mine.length === 0} variant="secondary" size="sm" className="!py-1.5 !px-3 text-xs disabled:opacity-40">■ End</Button>
        </span>
      </div>

      <div className="op-detail" style={{ marginTop: '0.75rem' }}>
        <div className="op-board-pair">
          <ChessBoard
            game={gameRef.current}
            fen={fen}
            boardWidth={boardWidth}
            orientation={orientation}
            draggableColor={draggableColor}
            interactive={!ended && learnerToMove}
            onMove={onMove}
            showLegalMoves
            clickToMove
            showNotation
          />
        </div>

        <div className="op-detail-side">
          <div className="op-panel">
            <h3 className="op-panel-title"><span className="chess-card-piece">♟</span> What to play</h3>
            {ended ? (
              <p className="op-desc">Session over. Restart to run the line again.</p>
            ) : learnerToMove ? (
              <>
                <p className="op-desc">Your move at move {plyMoveNumber(ply)}.</p>
                {hint ? (
                  <p className={`op-hint op-hint--${hint.tone}`}>{hint.text}</p>
                ) : (
                  <p className="op-desc">Play the book move. A move that leaves the line is taken back so you can retry.</p>
                )}
                {bookFen && (
                  <Button type="button" variant="secondary" size="sm" className="!py-1.5 !px-3 text-xs mt-2" onClick={reveal}>
                    Hint (show move)
                  </Button>
                )}
              </>
            ) : (
              <p className="op-desc">Opponent thinking…</p>
            )}
          </div>

          <div className="op-panel">
            <h3 className="op-panel-title"><span className="chess-card-piece">✎</span> Session log</h3>
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

          <div className="op-panel">
            <h3 className="op-panel-title"><span className="chess-card-piece">≡</span> Move chips</h3>
            <div className="op-move-chips" role="list" aria-label="Moves in this line">
              {theory.map((move, i) => (
                <MoveChip
                  key={i}
                  move={move}
                  index={i}
                  total={theory.length}
                  played={mine}
                  isVariationMove={branch !== null && i >= branch}
                  onClick={() => {}}
                />
              ))}
            </div>
          </div>

          {ended && result && (
            <div className="op-result">
              <div className="op-result-title">
                {result.completed ? 'Line completed' : 'Session ended'}
              </div>
              <div className="op-result-score">{result.accuracy}%</div>
              <p className="op-result-sub">
                {onBookCount} of {mine.length} moves matched the book · best streak {best} · {wrongCountRef.current} wrong · {hintCountRef.current} hints
              </p>
              {result.justLearned && (
                <p className="op-hint op-hint--good">★ You've learned {opening.name}!</p>
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
                <Button type="button" onClick={reset} variant="primary" size="md">↻ Practice again</Button>
                <Button type="button" onClick={toggleSide} variant="secondary" size="md">Other side</Button>
                <Button type="button" onClick={onBackToStudy} variant="secondary" size="md">Learn the line</Button>
              </div>
              {result.completed && lines.length > 1 && (
                <div className="op-result-alt">
                  {lines
                    .filter((l) => l.id !== line?.id)
                    .slice(0, 3)
                    .map((l) => (
                      <Button
                        key={l.id}
                        type="button"
                        onClick={() => handleLineSelect(l.id)}
                        variant="secondary"
                        size="sm"
                        className="!py-1.5 !px-3 text-xs"
                      >
                        ↪ Try {l.name}
                      </Button>
                    ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}