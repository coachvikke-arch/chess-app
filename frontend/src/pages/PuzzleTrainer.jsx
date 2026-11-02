import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../services/api';
import PuzzlePlayer from '../components/PuzzlePlayer';
import { pieceGlyph } from '../components/puzzle/PuzzlePopups';
import Modal from '../components/Modal';
import Button from '../components/Button';
import { Page } from '../components/ui';
import { useFittedSquare } from '../hooks/useBoardWidth';
import { revealAfterCheckmate } from '../effects/moveEffect';
import {
  TRAINER_LEVELS,
  readLevel, writeLevel,
  readSolvedCounts, countSolve,
  readSeenIds, rememberSeenId,
} from '../config/puzzleTrainer';
import './puzzle-trainer.css';

/* The solved line — and the checkmate that produced it — stays on screen for a
   beat before the next position arrives. Long enough to read, short enough that
   the feed feels endless. */
const NEXT_DELAY_MS = 1100;

/* The success FX overlay clears itself; this is that timer. */
const FX_MS = 1800;

export default function PuzzleTrainer() {
  const [level, setLevel] = useState(readLevel);
  const [counts, setCounts] = useState(readSolvedCounts);
  const [puzzle, setPuzzle] = useState(null);
  const [status, setStatus] = useState({ text: 'Loading a puzzle…', tone: '' });
  const [locked, setLocked] = useState(true);
  const [failed, setFailed] = useState(false);
  const [streak, setStreak] = useState(0);
  const [sheet, setSheet] = useState(false);
  const [fx, setFx] = useState(null);

  /* The refs are what keep a slow response from writing over a decision the
     student has already moved past: `levelRef` is the band a running load answers
     to, `puzzleRef` the line the board is showing. */
  const levelRef = useRef(level);
  levelRef.current = level;
  const puzzleRef = useRef(null);
  /* A clean solve is one with no wrong try in it — that is what the streak counts. */
  const mistakeRef = useRef(false);
  const pendingRef = useRef(null);   // { level, promise } — the next puzzle, already on its way
  const loadingRef = useRef(false);
  const timersRef = useRef([]);
  const fxTimerRef = useRef(null);
  const fxRevealCancelRef = useRef(null);
  const levelButtonRef = useRef(null);

  /* Two-axis fit: the page is clipped to the viewport (see .pt-page in
     puzzle-trainer.css), so the board is solved against the stage's HEIGHT as
     well as its width — 440 on a roomy desktop, the column's width on a phone,
     and whatever a short landscape screen leaves after the header and controls.
     `min` is that landscape case: a rotated phone has ~210px of board room, so
     the floor is where the position stops being readable rather than the 180 a
     portrait column would need. Below it the stage is the scroll safety valve. */
  const { areaRef, fitRef, size: boardWidth } = useFittedSquare({ max: 440, min: 150 });

  const later = useCallback((fn, ms) => {
    timersRef.current.push(setTimeout(fn, ms));
  }, []);
  const clearTimers = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  }, []);

  useEffect(() => () => {
    clearTimers();
    clearTimeout(fxTimerRef.current);
    if (fxRevealCancelRef.current) fxRevealCancelRef.current();
  }, [clearTimers]);

  const triggerFx = useCallback((payload) => {
    setFx({ key: Date.now(), ...payload });
    clearTimeout(fxTimerRef.current);
    fxTimerRef.current = setTimeout(() => setFx(null), FX_MS);
  }, []);

  /* `cache: false` is not optional. The shared api instance serves an identical
     GET from memory for 30 s, which for this endpoint means handing the student
     the puzzle they just solved. */
  const fetchPuzzle = useCallback((lv) => api.get('/puzzles/next', {
    params: { level: lv, seen: readSeenIds().join(',') },
    cache: false,
  }).then((r) => r.data), []);

  const show = useCallback((p) => {
    puzzleRef.current = p;
    mistakeRef.current = false;
    rememberSeenId(p.id);
    setPuzzle(p);
    setFailed(false);
    setLocked(false);
    setStatus({ text: 'Find the best move.', tone: '' });
  }, []);

  const loadPuzzle = useCallback(async (lv) => {
    if (loadingRef.current) return;   // a double-fired mount effect must not cost two queries
    loadingRef.current = true;
    setLocked(true);
    setFailed(false);
    setStatus({ text: 'Loading a puzzle…', tone: '' });
    try {
      /* The warm puzzle was fetched for this band, so it is only reusable while
         the band is still this one and it is not the line already on the board. */
      const pre = pendingRef.current;
      pendingRef.current = null;
      let p = pre && pre.level === lv ? await pre.promise.catch(() => null) : null;
      if (!p || p.id === puzzleRef.current?.id) p = await fetchPuzzle(lv).catch(() => null);
      if (lv !== levelRef.current) return;

      if (!p) {
        setFailed(true);
        setStatus({ text: 'Could not load a puzzle. Check your connection.', tone: 'bad' });
        return;
      }
      show(p);
      /* Warm the one after this while the student is still thinking. */
      pendingRef.current = { level: lv, promise: fetchPuzzle(lv).catch(() => null) };
    } finally {
      loadingRef.current = false;
    }
  }, [fetchPuzzle, show]);

  useEffect(() => {
    loadPuzzle(level);
  }, [level, loadPuzzle]);

  const handleSolved = useCallback((moves, meta = {}) => {
    const lv = levelRef.current;
    const messy = mistakeRef.current;
    setCounts(countSolve(lv));
    setStreak((s) => (messy ? 0 : s + 1));
    setLocked(true);
    setStatus({
      text: messy ? 'Solved — next one coming up.' : 'Correct! Next one coming up.',
      tone: 'ok',
    });
    if (fxRevealCancelRef.current) {
      fxRevealCancelRef.current();
      fxRevealCancelRef.current = null;
    }

    const isMate = !!meta.checkmate;
    const payload = {
      kind: isMate ? 'checkmate' : 'solved',
      square: meta.lastMove?.to,
      piece: pieceGlyph(meta.lastMove?.pieceType, meta.lastMove?.color),
      msg: isMate ? 'CHECKMATE!' : 'Solved!',
    };
    /* A celebration on a mating move must not cover the mating animation. */
    if (isMate) {
      fxRevealCancelRef.current = revealAfterCheckmate(
        { to: meta.lastMove?.to },
        () => {
          fxRevealCancelRef.current = null;
          triggerFx(payload);
        },
      );
    } else {
      triggerFx(payload);
    }

    later(() => loadPuzzle(lv), NEXT_DELAY_MS);
  }, [later, loadPuzzle, triggerFx]);

  const handleFailed = useCallback(() => {
    /* The board undoes the try itself and stays on the same position, so the only
       thing the page owns here is the wording and the streak. */
    mistakeRef.current = true;
    setStreak(0);
    setStatus({ text: 'Not quite. Try another move.', tone: 'bad' });
  }, []);

  const handleCorrectMove = useCallback((move) => {
    triggerFx({
      kind: 'correct',
      square: move.to,
      piece: pieceGlyph(move.pieceType, move.color),
    });
    setStatus({ text: 'Good move.', tone: 'ok' });
  }, [triggerFx]);

  const chooseLevel = useCallback((i) => {
    setSheet(false);
    if (i === level) return;
    clearTimers();            // a scheduled "load next" must not fire on the new band
    pendingRef.current = null;
    writeLevel(i);
    setStreak(0);
    setLevel(i);
  }, [clearTimers, level]);

  const active = TRAINER_LEVELS[level];
  const totalSolved = useMemo(() => counts.reduce((a, b) => a + b, 0), [counts]);
  const solverWhite = puzzle && !failed ? String(puzzle.fen).split(/\s+/)[1] !== 'b' : null;

  return (
    <Page
      piece="♞"
      title="Puzzle Trainer"
      sub="Pick a rating band and find the best move. The feed never runs out."
      className="pt-page"
    >
      <div className="pt-wrap">
        <div className="pt-stage" ref={areaRef}>
          <div className="pt-board" ref={fitRef}>
            {failed ? (
              /* The position left on the board belongs to the previous band, so it
                 goes away: a frozen puzzle under "could not load" reads like a bug. */
              <div className="pt-empty" style={{ width: boardWidth, height: boardWidth }}>
                <span className="pt-idle" aria-hidden="true">♞</span>
              </div>
            ) : puzzle ? (
              <PuzzlePlayer
                key={puzzle.id}
                fen={puzzle.fen}
                solution={puzzle.moves}
                onSolved={handleSolved}
                onFailed={handleFailed}
                onCorrectMove={handleCorrectMove}
                fx={fx}
                boardWidth={boardWidth}
                interactive={!locked}
                points={0}
                showStatus={false}
                showMoveStrip={false}
              />
            ) : (
              <div className="pt-empty" style={{ width: boardWidth, height: boardWidth }}>
                <div className="chess-spinner"><span>♞</span></div>
              </div>
            )}
          </div>
        </div>

        {/* Board on one side, everything you read and press on the other:
            beside it on a desktop, stacked under it on a phone. Only the
            wrapper is new — the rows inside are the ones the page had. */}
        <div className="pt-side">
          <div className="pt-bar">
            <button
              type="button"
              className="pt-level"
              ref={levelButtonRef}
              onClick={() => setSheet(true)}
              aria-haspopup="dialog"
              aria-label={`Puzzle level: ${active.range} ${active.name}. Change level.`}
            >
              <span className="pt-badge" aria-hidden="true">{level + 1}</span>
              <span className="pt-level-text">
                <b>{active.range}</b>
                <small>{active.name}</small>
              </span>
              <span className="pt-chevron" aria-hidden="true">▾</span>
            </button>

            {solverWhite !== null && (
              <span className="pt-turn">
                <span className={`pt-dot${solverWhite ? ' is-w' : ' is-b'}`} aria-hidden="true" />
                You play {solverWhite ? 'White' : 'Black'}
              </span>
            )}
          </div>

          <div className={`pt-msg${status.tone ? ` ${status.tone}` : ''}`} role="status" aria-live="polite">
            <span>{status.text}</span>
            {failed && (
              <Button type="button" size="sm" variant="secondary" onClick={() => loadPuzzle(level)}>
                Retry
              </Button>
            )}
          </div>

          <div className="pt-stats">
            <div className="pt-stat"><b>{counts[level]}</b><span>Solved here</span></div>
            <div className="pt-stat"><b>{streak}</b><span>Streak</span></div>
            <div className="pt-stat"><b>{totalSolved}</b><span>Total solved</span></div>
          </div>
        </div>
      </div>

      <Modal
        open={sheet}
        onClose={() => setSheet(false)}
        title="Choose a level"
        description="Puzzles come from inside the band you pick, and the feed skips any you have already seen on this device."
        size="sm"
        modalClass="mz-modal-trainer"
        returnFocusRef={levelButtonRef}
        closeLabel="Close level picker"
      >
        <div className="pt-levels">
          {TRAINER_LEVELS.map((l, i) => (
            <button
              key={l.range}
              type="button"
              className={`pt-levelrow${i === level ? ' is-current' : ''}`}
              onClick={() => chooseLevel(i)}
            >
              <span className="pt-badge" aria-hidden="true">{i + 1}</span>
              <span className="pt-level-text">
                <b>{l.range}</b>
                <small>{l.name}</small>
              </span>
              <span className="pt-count">
                {i === level ? <em>Current</em> : null}
                {counts[i]} solved
              </span>
            </button>
          ))}
        </div>
      </Modal>
    </Page>
  );
}
