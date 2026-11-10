import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../services/api';
import PuzzlePlayer from '../components/PuzzlePlayer';
import TrainerLadder from '../components/puzzle/TrainerLadder';
import { pieceGlyph } from '../components/puzzle/PuzzlePopups';
import Modal from '../components/Modal';
import Button from '../components/Button';
import { Page } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useFittedSquare } from '../hooks/useBoardWidth';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useProfileChanged } from '../hooks/useProfileChanged';
import { NEXT_DELAY_MS, solveMessage } from '../lib/puzzleScore';
import { isAdminRole } from '../utils/roles';
import {
  TRAINER_LEVELS,
  readLevel, writeLevel,
  readSolvedCounts, countSolve,
  readStreak, writeStreak,
  readSeenIds, rememberSeenId,
} from '../config/puzzleTrainer';
import './puzzle-trainer.css';

/* The success FX overlay clears itself; this is that timer. */
const FX_MS = 1800;

/* The ladder is re-read on this beat while the page is open, and immediately
   after every solve (the award response carries the fresh board with it). */
const LADDER_REFRESH_MS = 20000;

/* What a failed load actually means, in the words the student can act on.
   A missing permission switch, an empty band and a dead connection need three
   different replies — one shared "check your connection" sends students at
   their wifi for problems that are not theirs. */
function describeLoadFailure(err) {
  const status = err?.response?.status;
  if (status === 403) return 'The Puzzle Trainer is switched off for your account. Ask your coach to enable it.';
  if (status === 404) return 'No new puzzle left in this band. Pick another level.';
  if (typeof status === 'number') return 'The puzzle service is having a moment. Try again.';
  return 'Could not reach the academy. Check your connection.';
}

export default function PuzzleTrainer() {
  const { user } = useAuth();
  /* Staff get the same feed as practice: solves are verified but never scored,
     and the ladder they see is the students' one. */
  const staff = isAdminRole(user?.role);
  const [level, setLevel] = useState(readLevel);
  const [counts, setCounts] = useState(readSolvedCounts);
  const [puzzle, setPuzzle] = useState(null);
  const [status, setStatus] = useState({ text: 'Loading a puzzle…', tone: '' });
  const [locked, setLocked] = useState(true);
  const [failed, setFailed] = useState(false);
  const [streak, setStreak] = useState(readStreak);
  const [sheet, setSheet] = useState(false);
  const [fx, setFx] = useState(null);
  /* Seconds left on the locked beat after a solve. 0 means "no beat running". */
  const [countdown, setCountdown] = useState(0);
  const [board, setBoard] = useState(null);
  const [boardError, setBoardError] = useState('');
  const [boardLoading, setBoardLoading] = useState(false);
  const [ladderSheet, setLadderSheet] = useState(false);

  /* A phone has no height for a ten-row table under the board, so the ladder
     lives in a sheet there and in the side column on a desktop — the same split
     the level picker already uses. */
  const compact = useMediaQuery('(max-width: 899px)');

  /* The refs are what keep a slow response from writing over a decision the
     student has already moved past: `levelRef` is the band a running load answers
     to, `puzzleRef` the line the board is showing. */
  const levelRef = useRef(level);
  levelRef.current = level;
  const puzzleRef = useRef(null);
  /* A clean solve is one with no wrong try in it — that is what the streak counts
     and what the server pays 10 points for instead of 5. */
  const mistakeRef = useRef(false);
  const pendingRef = useRef(null);   // { level, promise } — the next puzzle, already on its way
  const loadingRef = useRef(false);
  const timersRef = useRef([]);
  const fxTimerRef = useRef(null);
  const levelButtonRef = useRef(null);
  const ladderButtonRef = useRef(null);
  /* Bumped by every new load: a score response that lands after the next puzzle
     is already on the board must not rewrite its status line. */
  const solveSeqRef = useRef(0);
  const shownAtRef = useRef(0);
  const boardTicketRef = useRef(0);

  /* The streak is written as it changes, so a refresh in the middle of a run
     keeps the number the student earned instead of showing 0. The ref is what
     the next solve reads — a functional state updater would have to do the
     storage write inside itself, and StrictMode runs those twice. */
  const streakRef = useRef(streak);
  const setStreakRun = useCallback((next) => {
    streakRef.current = next;
    writeStreak(next);
    setStreak(next);
  }, []);

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
    boardTicketRef.current += 1;   // a ladder response in flight must not land on a dead page
  }, [clearTimers]);

  /* `cache: false` for the same reason the feed uses it: the shared api instance
     serves an identical GET from memory for 30 s, which here would be the ladder
     as it stood before the solve that just moved the student up it. */
  const loadBoard = useCallback(() => {
    const ticket = ++boardTicketRef.current;
    setBoardLoading(true);
    return api.get('/puzzles/trainer/leaderboard', { cache: false })
      .then((r) => {
        if (ticket !== boardTicketRef.current) return;
        setBoard(r.data);
        setBoardError('');
      })
      .catch((err) => {
        if (ticket !== boardTicketRef.current) return;
        setBoardError(err?.response?.status === 403
          ? 'The leaderboard is switched off for your account.'
          : 'Could not load the leaderboard. Check your connection.');
      })
      .finally(() => {
        if (ticket === boardTicketRef.current) setBoardLoading(false);
      });
  }, []);

  useEffect(() => { loadBoard(); }, [loadBoard]);

  /* Someone else's solve moves this student's rank too, so the ladder is re-read
     on a beat and the moment the tab is looked at again. */
  useEffect(() => {
    const timer = setInterval(loadBoard, LADDER_REFRESH_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') loadBoard(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [loadBoard]);

  useProfileChanged(loadBoard);

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
    shownAtRef.current = Date.now();
    rememberSeenId(p.id);
    setPuzzle(p);
    setFailed(false);
    setLocked(false);
    setCountdown(0);
    setStatus({ text: 'Find the best move.', tone: '' });
  }, []);

  const loadPuzzle = useCallback(async (lv) => {
    if (loadingRef.current) return;   // a double-fired mount effect must not cost two queries
    loadingRef.current = true;
    /* Whatever the last solve's score request has to say, it is about a position
       that is no longer on the board. */
    solveSeqRef.current += 1;
    setCountdown(0);
    setLocked(true);
    setFailed(false);
    setStatus({ text: 'Loading a puzzle…', tone: '' });
    try {
      /* The warm puzzle was fetched for this band, so it is only reusable while
         the band is still this one and it is not the line already on the board. */
      const pre = pendingRef.current;
      pendingRef.current = null;
      let p = pre && pre.level === lv ? await pre.promise : null;
      let failure = null;
      if (!p || p.id === puzzleRef.current?.id) {
        p = await fetchPuzzle(lv).catch((e) => { failure = e; return null; });
      }
      if (lv !== levelRef.current) return;

      if (!p) {
        setFailed(true);
        setStatus({ text: describeLoadFailure(failure), tone: 'bad' });
        return;
      }
      show(p);
      /* Warm the one after this while the student is still thinking. The catch
         is what lets loadPuzzle await this promise without a guard. */
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
    const seq = solveSeqRef.current;
    const puzzleId = puzzleRef.current?.id;
    const solveMs = shownAtRef.current ? Date.now() - shownAtRef.current : null;

    setCounts(countSolve(lv));
    setStreakRun(messy ? 0 : streakRef.current + 1);
    /* Locked for the whole beat. PuzzlePlayer ANDs this with its own "still
       playing" test, so an extra click or drag cannot move a solved board. */
    setLocked(true);
    const seconds = Math.round(NEXT_DELAY_MS / 1000);
    setCountdown(seconds);
    setStatus({
      text: messy ? 'Solved — saving your points.' : 'Correct! Saving your points.',
      tone: 'ok',
    });

    /* The server decides the award and writes it once per puzzle; the fresh
       ladder rides back with it, so points, rank and the top ten move together.
       A response that lands after the next position is up still updates the
       ladder, but never the status line of a puzzle it was not about. */
    if (puzzleId) {
      api.post('/puzzles/trainer/solve', {
        puzzleId, line: moves, firstTry: !messy, solveMs, level: lv,
      })
        .then((r) => {
          const award = r.data;
          if (award?.leaderboard) {
            setBoard(award.leaderboard);
            setBoardError('');
          }
          if (seq !== solveSeqRef.current) return;
          setStatus({
            text: solveMessage({ credited: award.credited, points: award.points, messy, counted: award.counted }),
            tone: 'ok',
          });
        })
        .catch(() => {
          if (seq !== solveSeqRef.current) return;
          setStatus({ text: 'Solved, but your points could not be saved.', tone: '' });
        });
    }

    /* A mating move already carries its own king-anchored "Checkmate" pill from
       the board's move effect. Showing the celebration card on top of it put the
       same word on the board twice, so the pill is the one announcement. */
    if (!meta.checkmate) {
      triggerFx({
        kind: 'solved',
        square: meta.lastMove?.to,
        piece: pieceGlyph(meta.lastMove?.pieceType, meta.lastMove?.color),
        msg: 'Solved!',
      });
    }

    /* One flight of timers, every one of them in timersRef: the countdown ticks
       and the load itself. clearTimers() on unmount or a level change takes the
       lot, so two puzzles can never arrive at once. */
    for (let s = seconds - 1; s >= 1; s -= 1) {
      later(() => setCountdown(s), (seconds - s) * 1000);
    }
    later(() => loadPuzzle(lv), NEXT_DELAY_MS);
  }, [later, loadPuzzle, setStreakRun, triggerFx]);

  const handleFailed = useCallback(() => {
    /* The board undoes the try itself and stays on the same position, so the only
       thing the page owns here is the wording and the streak. A wrong move scores
       nothing, and the solve that follows it is worth 5 instead of 10. */
    mistakeRef.current = true;
    setStreakRun(0);
    setStatus({ text: 'Not quite — 0 points. Try another move.', tone: 'bad' });
  }, [setStreakRun]);

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
    setCountdown(0);
    solveSeqRef.current += 1;
    pendingRef.current = null;
    writeLevel(i);
    setStreakRun(0);
    setLevel(i);
  }, [clearTimers, level, setStreakRun]);

  const openLadder = useCallback(() => {
    setLadderSheet(true);
    loadBoard();
  }, [loadBoard]);

  const active = TRAINER_LEVELS[level];
  const myRow = board?.me || null;
  const solverWhite = puzzle && !failed ? String(puzzle.fen).split(/\s+/)[1] !== 'b' : null;
  const ladder = (
    <TrainerLadder
      board={board}
      loading={boardLoading}
      error={boardError}
      myUserId={user?.id}
      onRefresh={loadBoard}
      staff={staff}
    />
  );

  return (
    <Page
      piece="♞"
      title="Puzzle Trainer"
      sub={staff
        ? 'Practice by rating band. Staff solves stay off the student leaderboard.'
        : 'Pick a rating band and find the best move. The feed never runs out.'}
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
                outerWidth={boardWidth}
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
            {countdown > 0 && (
              /* Outside the live region on purpose: a per-second tick would be
                 read out three times over the award it belongs to. */
              <span className="pt-next" aria-hidden="true">Next in {countdown}s</span>
            )}
            {failed && (
              <Button type="button" size="sm" variant="secondary" onClick={() => loadPuzzle(level)}>
                Retry
              </Button>
            )}
          </div>

          <div className="pt-stats">
            <div className="pt-stat">
              <b>{!staff && myRow ? myRow.total_points : '—'}</b>
              <span>{staff ? 'Unranked' : 'Points'}</span>
            </div>
            <div className="pt-stat"><b>{counts[level]}</b><span>Solved here</span></div>
            <div className="pt-stat"><b>{streak}</b><span>Streak</span></div>
          </div>

          {/* A phone has no room for ten rows under the board, so the ladder is
              one live row there — your rank and points, always visible — and the
              table opens from it. On a desktop it is the table, in the column. */}
          {compact ? (
            <button
              type="button"
              className="pt-level pt-lbopen"
              ref={ladderButtonRef}
              onClick={openLadder}
              aria-haspopup="dialog"
              aria-label={staff
                ? 'Student leaderboard. Open the top 10.'
                : myRow
                  ? `Leaderboard: you are rank ${myRow.rank} with ${myRow.total_points} points. Open the top 10.`
                  : 'Leaderboard: no rank yet. Open the top 10.'}
            >
              <span className="pt-badge" aria-hidden="true">♛</span>
              <span className="pt-level-text">
                <b>Leaderboard</b>
                <small>{staff
                  ? 'Student ladder · top 10'
                  : myRow
                    ? `You #${myRow.rank} · ${myRow.total_points} pts · ${myRow.solved_count} solved`
                    : 'Top 10 · solve a puzzle to rank'}</small>
              </span>
              <span className="pt-chevron" aria-hidden="true">▾</span>
            </button>
          ) : ladder}
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

      {compact && (
        <Modal
          open={ladderSheet}
          onClose={() => setLadderSheet(false)}
          title="Puzzle Leaderboard"
          description={staff
            ? 'The student ladder. Staff practice is verified but never scored.'
            : 'Every solve counts: a clean first try pays the most, and the table moves as the academy plays.'}
          size="sm"
          modalClass="pt-lbmodal"
          returnFocusRef={ladderButtonRef}
          closeLabel="Close leaderboard"
        >
          {ladder}
        </Modal>
      )}
    </Page>
  );
}
