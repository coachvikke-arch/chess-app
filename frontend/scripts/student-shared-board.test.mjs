/* The student side of the classroom: moving the pieces, and solving the coach's
 * drill on the shared board.
 *
 * Run: node --test scripts/student-shared-board.test.mjs
 *
 * THREE THINGS THAT WERE BROKEN
 * -----------------------------
 * 1. STUDENTS COULD NOT MOVE. `myMoveSide` only ever sees a side when
 *    `classMeta.studentInteractionEnabled` is on, and the only control for that
 *    flag was the checkbox on the class-creation form (`ManageClasses.jsx`).
 *    Nothing in the running lesson could switch it on, so a student in a class
 *    created with it off was stuck on "Viewing instructor demo" — and the
 *    instructor had to leave the lesson to change it. The backend already
 *    accepted a `toggle_interaction` action; it simply had no button.
 *
 * 2. THE DRILL'S SCORE WAS INVISIBLE. Points and right/wrong moves lived in
 *    StudentSolveView, which only renders for a viewer who is not on the shared
 *    board. Once the drill card was taken out of the stage, the student's
 *    progress had nowhere to appear at all.
 *
 * 3. NOBODY COULD SOLVE ANYTHING. Taking the card away removed the only thing
 *    that rendered PuzzlePlayer, so a drill became something you could look at
 *    and never play.
 *
 * The hard part is (3): the board is ONE position broadcast to the whole room,
 * while a drill is per-student. Solving on it as-is would have moved everyone's
 * pieces every time one student tried a move. So the board gets a drill mode in
 * which it holds a PRIVATE copy of the puzzle position, validates attempts
 * locally, emits nothing, and hands the class its own game back afterwards.
 * That contract — above all the "emits nothing" half — is what this file guards.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Chess } from 'chess.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(join(root, ...p), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

const board = strip(read('src', 'components', 'liveclass', 'SharedChessBoard.jsx'));
const drill = strip(read('src', 'components', 'liveclass', 'PuzzleDrill.jsx'));
const player = strip(read('src', 'components', 'PuzzlePlayer.jsx'));
const solverSource = read('src', 'utils', 'puzzleSolve.js');
const css = read('src', 'index.css');
const imports = drill.slice(0, drill.indexOf('\n\nconst POLL_MS'));

/* The shared solver, on its own, so an assertion about the rules cannot pass by
   matching the same words in a caller's comment. createSolver is loaded for real
   and driven below, so these are behavioural, not textual. */
const solver = solverSource.slice(solverSource.indexOf('export function createSolver'), solverSource.indexOf('/** Replay'));
const { createSolver, fenAtPly, sanLine, MOVE_ANIM_SECONDS, MOVE_ANIM_MS } = await import('../src/utils/puzzleSolve.js');
const makeSolver = (line) => createSolver(line);

const drillBody = board.slice(board.indexOf('const doDrillMove'), board.indexOf('const drillReviewFen'));
/* The student's card, and the list it renders. */
const card = drill.slice(drill.indexOf('function StudentDrillStatus'), drill.indexOf('export default function PuzzleDrillArea'));
const socketBlock = board.slice(board.indexOf("on('chess_state_updated'"), board.indexOf("on('annotations_updated'"));

test('a student can be given the pieces from inside the running room', () => {
  /* The bug: the switch was gated on the very flag it switches, so it could
     only ever turn interaction OFF. */
  assert.doesNotMatch(board, /isInstructor && classMeta\?\.studentInteractionEnabled && \([\s\S]{0,200}toggle_interaction/,
    'the switch must not be hidden behind the flag it switches');
  assert.match(board, /sendControl\('toggle_interaction', \{ enabled: !classMeta\?\.studentInteractionEnabled \}\)/,
    'the switch must emit toggle_interaction with the flipped value');
  assert.match(board, /\{classMeta\?\.studentInteractionEnabled \? 'On' : 'Off'\}/,
    'the switch must state which way round it is');
  assert.match(board, /on\('interaction_changed', \(\{ enabled \}\) => \{/,
    'the flag must stay truthful off the socket broadcast, not a cached copy');
  assert.match(board, /\{isInstructor && classMeta\?\.studentInteractionEnabled && \(/, 'the side picker is still interaction-gated');
});

test('the switch is offered to the instructor only', () => {
  const at = board.indexOf("sendControl('toggle_interaction'");
  const guard = board.lastIndexOf('{isInstructor && (', at);
  assert.ok(guard !== -1 && guard < at, 'an isInstructor guard must open before the switch it guards');
});

test('the drill arrives at the board as data, and the board never invents it', () => {
  assert.match(board, /export default function SharedChessBoard\(\{ drill = null, drillStatus = null, onDrillViewPly = null \}\)/,
    'both the position to solve and the card to show come in as props');
  assert.match(drill, /const drillSolver = !isInstructor && drill/, 'the instructor never gets drill mode');
  assert.match(drill, /solution: drill\.puzzle\?\.solution \|\| \[\]/);
  /* `shownMe` is the progress with a checkmate finish still masked, so this is
     the same rule plus the animation wait. */
  assert.match(drill, /interactive: shownMe\.result === 'solving' && !timeUp/,
    'a solved or timed-out drill is displayed but no longer playable');
  assert.match(drill, /<SharedChessBoard[\s\S]{0,200}drill=\{drillSolver\}[\s\S]{0,160}drillStatus=\{studentDrillStatus\}/,
    'the solver and the strip reach the same board build');
});

test('a drill attempt must not move the class board', () => {
  /* THE dangerous half. If a drill attempt reached doMove, every student in the
     room would watch one student's wrong guess. */
  assert.match(board, /if \(drillActive\) \{\s*doDrillMove\(move, game\);\s*return;\s*\}/,
    'drill mode must short-circuit before the broadcast path');
  assert.doesNotMatch(drillBody, /emit\('chess_move'/, 'the drill handler must never broadcast a move');
  assert.doesNotMatch(drillBody, /sendControl\(/, 'the drill handler must never send a control');
  assert.doesNotMatch(drillBody, /doMove\(/, 'the drill handler must never reach the class move path');
});

test('a wrong move is vetoed, so the board can never leave the solution line', () => {
  /* The rules moved to utils/puzzleSolve.js so the classroom and the homework
     trainer cannot drift. The veto has to still be THERE, though — that is the
     behaviour, not the file it lives in. */
  assert.match(solver, /if \(uci !== expected\) \{/, 'the played move is compared to the expected one');
  assert.match(solver, /try \{ game\.undo\(\); \} catch \{/, 'and undone when it is wrong');
  assert.match(solver, /status: 'wrong'/, 'with the attempt reported as a wrong one');
  /* Order matters: the board must be off the wrong move before the caller reads
     it, or the reported position is one the student never really held. */
  assert.ok(solver.indexOf('game.undo()') < solver.indexOf("status: 'wrong'"),
    'the undo must happen before the wrong verdict is returned');
  assert.match(drillBody, /const result = solver\.judge\(move, g\);/,
    'and the drill board must actually go through the shared solver');
  assert.match(drillBody, /if \(result\.status === 'wrong'\) \{[\s\S]{0,320}?drill\?\.onFailed\?\.\(\[\.\.\.result\.line, result\.uci\], result\.san\)/,
    'reporting the guess itself, which is what the instructor needs to see');
});

test("the defender's reply is played automatically, like every puzzle player", () => {
  assert.match(solverSource, /export function isSolverPly\(ply\) \{\s*return ply % 2 === 0;/,
    'solver moves sit on the even plies');
  assert.match(solver, /replyPly = \(isSolverPly\(ply - 1\) && ply < line\.length\) \? ply : null;/,
    'and only they arm a reply');
  assert.match(solver, /game\.move\(\{ from: reply\.slice\(0, 2\), to: reply\.slice\(2, 4\), promotion: reply\[4\] \}\)/,
    'the reply comes from the solution line, not from an engine');
  assert.match(drillBody, /if \(wasSolverTurn && drill\?\.onCorrectMove && move\) \{/, 'each correct solver move is reported');
  assert.match(drillBody, /drill\?\.onSolved\?\.\(result\.line/, 'and completion is reported with the line that was walked');
});

/* ── move-by-move, on both surfaces ──────────────────────────────────────
 *
 * The drill and the homework trainer both looked "instant" even though
 * animationDuration was set. react-chessboard only slides a piece when the
 * position arrives as an EXTERNAL change — it snaps anything it recognises as
 * the user's own drag. Applying the solver's move and the defender's reply in
 * one synchronous handler is a single two-ply commit, which is neither, so
 * NEITHER ply animated.
 *
 * The reply is therefore a second step, played in a later tick, on both
 * surfaces.
 */
test('the reply is a second step, so it can animate', () => {
  /* The solver must NOT play the reply inside judge(). */
  const judge = solver.slice(solver.indexOf('judge(move, game)'), solver.indexOf('applyReply(game)'));
  assert.doesNotMatch(judge, /game\.move\(/,
    'judge must not move a piece itself, or the two plies land in one commit');
  assert.match(judge, /replyPending: replyPly != null/, 'it reports that a reply is owed instead');
  assert.match(solver, /applyReply\(game\) \{/, 'and a separate call plays it');
  assert.match(solver, /hasPendingReply: \(\) => replyPly != null/, 'the caller can see a reply is waiting');

  /* Both surfaces must schedule it in a later tick, not inline. */
  for (const [name, src] of [['the drill board', board], ['the homework trainer', player]]) {
    assert.match(src, /MOVE_ANIM_MS/, `${name} must use the shared animation delay`);
    assert.match(src, /setTimeout\(\(\) => \{/, `${name} must schedule the reply`);
    assert.match(src, /\.applyReply\(/, `${name} must play it through the shared solver`);
  }
  assert.match(board, /drillReplyTimerRef\.current = setTimeout\(/, 'the drill schedules the reply');
  assert.match(player, /replyTimerRef\.current = setTimeout\(/, 'the trainer schedules the reply');
  assert.match(board, /MOVE_ANIM_SECONDS, MOVE_ANIM_MS \} from '\.\.\/\.\.\/utils\/puzzleSolve'/, 'and imports the delay');
});

test('the board is not playable while a reply is sliding in', () => {
  /* A second attempt during the animation would be judged against a position
     the student has not finished reading — and would desynchronise the ply. */
  assert.match(board, /if \(drillReplyTimerRef\.current\) return;/, 'the drill ignores an attempt mid-reply');
  assert.match(player, /if \(replyTimerRef\.current\) return;/, 'so does the trainer');
  assert.match(board, /drillReady && !drillReplying/, 'and the board is locked while it slides');
  assert.match(player, /status === 'playing' && !busy/, 'on both surfaces');
  /* A pending reply must not outlive its drill. */
  assert.match(board, /useEffect\(\(\) => \(\) => \{\s*if \(drillReplyTimerRef\.current\) clearTimeout\(drillReplyTimerRef\.current\);[\s\S]{0,400}?\}, \[drillKey\]\);/,
    'a pending reply is cancelled when the drill changes, or it fires into the next puzzle');
});

test('deferring the reply does not change what is solved', () => {
  /* Same line, same verdicts — the split into two steps is about timing only. */
  const fen = '7k/6pp/1N3p2/8/2P5/b3r1P1/1q3PKP/3R4 w - - 0 38';
  const solution = ['d1d8', 'e3e8', 'd8e8', 'a3f8', 'e8f8'];
  const g = new Chess(fen);
  const s = makeSolver(solution);
  const trace = [];

  for (const u of ['d1d8', 'd8e8', 'e8f8']) {
    const played = g.move({ from: u.slice(0, 2), to: u.slice(2, 4) });
    const r = s.judge(played, g);
    trace.push([r.status, g.history().length, r.replyPending]);
    if (r.replyPending) s.applyReply(g);
  }
  assert.deepEqual(trace, [
    ['correct', 1, true],    // the move paints on its own…
    ['correct', 3, true],    // …and the reply arrives after it
    ['solved', 5, false],    // the final move needs no reply
  ], 'each solver move is judged on its own, one ply at a time');
  assert.deepEqual(g.history({ verbose: true }).map((m) => m.san), ['Rd8+', 'Re8', 'Rxe8+', 'Bf8', 'Rxf8#']);
  assert.equal(g.isCheckmate(), true);

  /* A reply that cannot be applied must not be faked. */
  const broken = new Chess(fen);
  const s2 = makeSolver(solution);
  const m = broken.move({ from: 'd1', to: 'd8' });
  s2.judge(m, broken);
  /* e3e8 IS legal here, so force the failure path with an impossible line. */
  const s3 = makeSolver(['d1d8', 'a1a8', 'd8e8']);
  const g3 = new Chess(fen);
  const m3 = g3.move({ from: 'd1', to: 'd8' });
  const r3 = s3.judge(m3, g3);
  assert.equal(r3.replyPending, true, 'a reply is owed');
  const rep = s3.applyReply(g3);
  assert.equal(rep.played, false, 'an inapplicable reply is reported as not played');
  assert.equal(g3.history().length, 1, 'and the board does not pretend the defender answered');
});

/* ── one set of rules, for both places a puzzle is solved ──────────────────
 *
 * It used to be two copies — one in PuzzlePlayer, one inline in this board — and
 * two copies of a rule this load-bearing is how one of them ends up believing a
 * wrong move should stick, or that the line is finished a ply early. A drill did
 * exactly that: a five-move mate in three closed after two solver moves.
 */
test('the solve rules exist in exactly one place, and both surfaces use it', () => {
  assert.match(board, /import \{ createSolver, fenAtPly, MOVE_ANIM_SECONDS, MOVE_ANIM_MS \} from '\.\.\/\.\.\/utils\/puzzleSolve'/,
    'the drill board must solve through the shared module');
  assert.match(player, /import \{ createSolver, MOVE_ANIM_SECONDS, MOVE_ANIM_MS \} from '\.\.\/utils\/puzzleSolve'/,
    'and so must the homework trainer');
  /* Neither may re-derive the rules locally. */
  assert.doesNotMatch(drillBody, /drillSolution\[played\]|drillSolution\[n - 1\]/,
    'the drill must not match the line itself');
  assert.doesNotMatch(drillBody, /g\.history\(\)\.length/,
    'and the ply must not be read off the shared game history');
  assert.doesNotMatch(player, /solution\[n - 1\]|const n = game\.history\(\)\.length/,
    'the player must not keep a second copy of the same walk');
  /* The shared module is the one that counts plies, vetoes, and answers when
     the line is consumed. */
  assert.match(solver, /let ply = 0;/, 'the solver owns the ply count');
  assert.match(solver, /const solved = ply >= line\.length && line\.length > 0;/,
    'and decides completion from its own count');
});

test('a drill must not end early', () => {
  assert.match(board, /const drillKey = useMemo\([\s\S]{0,160}?drill\?\.nonce/, 'the drill\'s identity includes Retry');
  const handback = board.slice(board.indexOf('if (drillKey !== drillFenRef.current)'), board.indexOf('/* ── announce orientation changes'));
  assert.doesNotMatch(handback, /\[drillActive, drill\?\.fen, fen, applyAuthoritative\]/,
    'depending on `fen` re-loads the puzzle start after every move of the solve');
  assert.match(handback, /drillSolverRef\.current = createSolver\(drillSolution\)/,
    'and a new drill re-arms the solver rather than keeping the old one');
});

test('a mate in three is only finished on the third solver move', () => {
  /* The drill that prompted the fix, walked through the shared solver itself. */
  const fen = '7k/6pp/1N3p2/8/2P5/b3r1P1/1q3PKP/3R4 w - - 0 38';
  const solution = ['d1d8', 'e3e8', 'd8e8', 'a3f8', 'e8f8'];

  /* ChessBoard applies the move and only then hands it over, and the caller
     plays the reply in its own tick — so the harness does both, in that order. */
  const walk = (solverMoves) => {
    const g = new Chess(fen);
    const s = makeSolver(solution);
    const events = [];
    for (const m of solverMoves) {
      g.move({ from: m.from, to: m.to });
      const r = s.judge(m, g);
      events.push(r.status);
      if (r.replyPending) s.applyReply(g);
    }
    return { events, history: g.history().length, checkmate: g.isCheckmate() };
  };

  const uci = (s) => ({ from: s.slice(0, 2), to: s.slice(2, 4) });
  assert.deepEqual(walk([uci('d1d8')]).events, ['correct'], 'one solver move must not finish it');
  assert.deepEqual(walk([uci('d1d8'), uci('d8e8')]).events, ['correct', 'correct'], 'nor two');
  const full = walk([uci('d1d8'), uci('d8e8'), uci('e8f8')]);
  assert.deepEqual(full.events, ['correct', 'correct', 'solved'], 'and the third does');
  assert.equal(full.history, solution.length, 'the whole line was played');
  assert.equal(full.checkmate, true);

  /* A wrong guess must cost nothing: it must not push the solve closer to the
     end. h2-h4 is legal but is not the puzzle's move, so the board really does
     apply it and really does have to undo it. */
  const withGuess = walk([uci('d1d8'), uci('h2h4'), uci('d8e8'), uci('e8f8')]);
  assert.deepEqual(withGuess.events, ['correct', 'wrong', 'correct', 'solved'],
    'the vetoed move must leave the solve where it was');
});

test('the class game is parked while a drill has the board, and handed back after', () => {
  assert.match(socketBlock, /if \(drillActive\) \{\s*classFenRef\.current = state\.fen;\s*return;\s*\}/,
    'a broadcast during a drill must park the position, not apply it');
  assert.match(board, /applyAuthoritative\(\{ fen: classFenRef\.current, lastMove: null \}\)/,
    'and the parked position is what the board is restored to');
  assert.match(board, /applyAuthoritative\(\{ fen: drill\.fen, lastMove: null \}\)/,
    'entering a drill loads a private copy of the puzzle');
});

test('class-wide controls step aside while a drill owns the board', () => {
  /* Replaying moves desynchronises the drill's move count, which is the index
     the solution is read against; the position resets clobber the puzzle.
     Both remaining groups live in the Board tools panel (the bottom toolbar
     was removed): the new-game/load-FEN/setup trio plus its own undo/redo/
     suggest copy. */
  const gates = board.match(/permissions\.canControlBoard && !drillActive/g) || [];
  assert.equal(gates.length, 2, `both control groups must step aside, found ${gates.length}`);
  assert.match(board, /if \(drillActive\) return;[\s\S]{0,80}if \(!permissions\.canControlBoard\) return;/,
    'and the keyboard shortcuts must not replay a drill');
});

test('the caption tells the student they are on their own puzzle', () => {
  assert.match(board, /drillReady \? 'Solve the coach.s puzzle — find the right moves' : 'Drill finished — no more moves'/);
  assert.match(board, /your own attempts — the class board is untouched/,
    'and must not imply the class board is what is moving');
});

/* ── the student's card, beside the board ───────────────────────────────── */
test('the card sits left of the board, not over it, and the fit accounts for it', () => {
  /* It used to hang UNDER the board as a strip, which stole the height the board
     is fitted against and pushed the position down the screen. */
  assert.match(board, /\{drillStatus && \(\s*<div className="live-drill-info" ref=\{infoCardRef\}>\{drillStatus\}<\/div>\s*\)\}/,
    'the card is a child of the measured stage');
  assert.match(board, /className="live-board-body" ref=\{stageRef\}/, 'and that stage is the one the board is fitted against');
  assert.ok(board.indexOf('className="live-board-body"') < board.indexOf('className="live-drill-info"'),
    'and the card must come BEFORE the board column, i.e. on its left');
  assert.doesNotMatch(board, /className="live-drill-strip">\{drillStatus\}/,
    'the old strip under the board must be gone');

  /* The stage still counts the card, so the fit has to subtract it or the board
     is sized against width that is not there. */
  assert.match(board, /- infoCardWidth - \(infoCardWidth > 0 \? gap : 0\)/,
    'the card width must come off the board\'s available width');
  assert.match(board, /\}, \[manualSize, boardSize, infoCardWidth\]\);/,
    'and the fit must re-run when the card appears');
  /* Stacked under the board on a narrow screen it takes no width at all, so the
     measured width has to be zero there rather than a stale number. */
  assert.match(board, /const beside = stage \? rect\.left < stage\.left : false;/,
    'beside-the-board or stacked has to be measured, not assumed');
  /* THE crash this guard exists for. A hook's dependency array is read while the
     component renders, so the fit effect cannot name a value bound below it —
     that throws "Cannot access X before initialization" and the board never
     appears at all. */
  assert.ok(board.indexOf('const [infoCardWidth') < board.indexOf('}, [manualSize, boardSize, infoCardWidth]);'),
    'infoCardWidth must be bound ABOVE the fit effect that spends it');
  assert.ok(board.indexOf('const infoCardRef') < board.indexOf('}, [infoCardEl]);'),
    'and the card ref too');
});

test('the card carries the puzzle, what it is worth, the tries, the status and the moves', () => {
  const card = drill.slice(drill.indexOf('function StudentDrillStatus'), drill.indexOf('export default function PuzzleDrillArea'));
  for (const needle of [
    /live-drill-info-title/,                    // the puzzle title
    /live-drill-info-rating/,                   // ★ rating
    /live-drill-info-points/,                   // points
    /role="progressbar"/,                       // the progress bar
    /live-drill-info-bar/,                      // …and its track
    /live-drill-pill/,                          // the status badge
    /live-drill-info-mlabel/,                   // the move list
    /<MoveRows/,                                // …rendered
  ]) {
    assert.match(card, needle, `the card must carry ${needle}`);
  }
  /* The order asked for: puzzle, worth, progress, status, moves. */
  const order = ['live-drill-info-title', 'live-drill-info-worth', 'live-drill-info-progress',
    'live-drill-info-status', 'live-drill-info-moves'];
  const at = order.map((k) => card.indexOf(k));
  assert.ok(at.every((v) => v !== -1), 'every section must be present');
  assert.deepEqual(at, [...at].sort((a, b) => a - b), 'the sections must appear in the order they are read in');

  /* A capped drill shows tries, an uncapped one shows progress through the line
     — there is no denominator to show otherwise. */
  assert.match(card, /maxAttempts != null[\s\S]{0,200}?\{attempted\}\/\{maxAttempts\}/, 'capped → tries used');
  assert.match(card, /\{moves\.length\}\/\{totalPlies\}/, 'uncapped → moves through the line');
});

test('the move list pairs by ply, keeps wrong guesses beside their step, and can jump', () => {
  const list = drill.slice(drill.indexOf('function MoveRows'), drill.indexOf('function MiniDrillBoard'));
  assert.match(list, /const solverSan = correct\[step \* 2\]/, 'pairing is off the ply index');
  assert.match(list, /const replySan = correct\[step \* 2 \+ 1\]/, '…solver move, then the reply');
  assert.match(list, /live-drill-move-bad/, 'a wrong guess is shown in red');
  assert.match(list, /wrongByStep\.get\(step\)/, 'and beside the step it was made on');
  assert.match(list, /\{step \+ 1\}\./, 'rows are numbered from 1');
  /* A step guessed wrong before anything landed still needs its row, or the
     numbering jumps when the first right move arrives. */
  assert.match(list, /Math\.max\(Math\.ceil\(correct\.length \/ 2\), lastWrongStep \+ 1\)/);

  /* Clicking a move shows that position. */
  const plyBtn = drill.slice(drill.indexOf('function MovePly'), drill.indexOf('function MoveRows'));
  assert.match(plyBtn, /onClick=\{\(\) => onJump\(ply\)\}/, 'a ply is clickable');
  assert.match(plyBtn, /aria-current=\{isCurrent \|\| undefined\}/, 'and the one on screen is marked');
  assert.match(board, /import \{ createSolver, fenAtPly, MOVE_ANIM_SECONDS, MOVE_ANIM_MS \}/, 'the board can replay a ply');
  assert.match(board, /return fenAtPly\(drill\.fen, drillSolution, drillViewPly\);/, 'to show that position');
});

test('clicking a move cannot disturb the solve', () => {
  /* The reviewed position is replayed on a SEPARATE Chess instance, never by
     rewinding the live board — that would desynchronise the solver, and the
     student's next attempt would then be judged from the wrong ply. The board
     stays MOUNTED across live/review, though: only the `game` it renders swaps,
     so a click no longer remounts (and blinks) the whole board. */
  assert.match(board, /const reviewGame = useMemo\(\(\) => \{[\s\S]{0,240}?new Chess\(reviewFen\)/,
    'the review position is its own Chess instance, built from the reviewed FEN');
  assert.match(board, /game=\{reviewing \? reviewGame : gameRef\.current\}/,
    'the live game is rendered only when not reviewing');
  assert.match(board, /interactive=\{reviewing[\s\S]{0,60}?\? false/, 'and the review is not playable');
  assert.match(drillBody, /if \(drillViewPly !== null\) setViewPly\(null\);/,
    'an attempt made while reviewing snaps back to the live position first');
  assert.match(board, /useEffect\(\(\) => \{ onDrillViewPly\?\.\(drillViewPly\); \}, \[drillViewPly, onDrillViewPly\]\);/,
    'the board owns the ply and reports it up, so the card and the board agree');
});

test('completed is green and failed is red, on the card and the grid alike', () => {
  /* One STATUS_META feeds both surfaces, so "completed" cannot be green on the
     student's card and amber on the instructor's grid. */
  assert.match(drill, /completed: \{ label: 'Completed', tone: 'done'/);
  assert.match(drill, /failed: \{ label: 'Failed', tone: 'bad'/);
  assert.match(drill, /time_finished: \{ label: 'Failed — Time Finished', tone: 'bad'/);
  assert.match(drill, /live-drill-card live-drill-tone-\$\{meta\.tone\}/, 'the grid card takes the tone too');
  assert.match(drill, /live-drill-info-card live-drill-tone-\$\{meta\.tone\}/, 'and so does the info card');
  assert.match(css, /\.live-drill-tone-done\s*\{[^}]*border-color:[^}]*(34, 197, 94|21, 128, 61)/,
    'a solved drill is green');
  assert.match(css, /\.live-drill-tone-bad\s*\{[^}]*border-color:[^}]*(239, 68, 68|185, 28, 28)/,
    'a failed one is red');
  /* Points are shown as earned, and a wrong move is marked with the same red. */
  assert.match(card, /live-drill-info-points/, 'points are on the card');
  assert.match(card, /\{solved \? '✓ ' : dead \? '✗ ' : ''\}\{meta\.label\}/, 'the badge carries its own mark');
  assert.match(card, /\{points > 0 \? `\+\$\{points\}` : points\} pts/, 'and the score is spelled out');
});

test('a failed or finished puzzle offers a retry that clears only that student', () => {
  const retry = drill.slice(drill.indexOf('const onRetry = useCallback'), drill.indexOf('const showSharedBoard'));
  assert.match(drill, /\{onRetry && \(solved \|\| dead\) && \(/, 'retry appears once there is something to retry');
  assert.match(retry, /post\(\{ result: 'solving', moves: \[\], wrongMoves: \[\], attempted: 0, retry: true \}\)/,
    'and it posts an explicit retry');
  /* Ending the drill is the instructor's call, and it drops the board for the
     whole room — a student must have no way to reach it from their own card. */
  assert.doesNotMatch(retry, /puzzle-drill\/end/, 'a retry must never end the drill — that is the instructor\'s');
});

test('back lives in the header, not over the board', () => {
  const room = read('src', 'pages', 'LiveClassroom.jsx');
  const headerLeft = room.slice(room.indexOf('<div className="live-room-header-left">'), room.indexOf('live-room-header-right'));
  assert.match(headerLeft, /className="live-room-back"/, 'the back control is in the header\'s left corner');
  assert.match(headerLeft, /onClick=\{handleLeave\}/, 'and it leaves, as it always did');
  assert.match(headerLeft, /aria-label="Leave this classroom"/,
    'the words live in the label, because the control is an icon');
  assert.match(headerLeft, /title="Leave this classroom"/,
    'and the tooltip agrees');
  assert.doesNotMatch(headerLeft, /handleEnd/,
    'the back arrow must never end the class, not even for the instructor');
  assert.match(css, /\.live-room-back \{[^}]*width: 30px;[^}]*height: 30px;/, 'a small icon, not a labelled bar');
  /* Nothing floats over the board any more. */
  assert.doesNotMatch(headerLeft, /live-board/, 'the header is not part of the board');
  assert.match(room, /live-room-leavebar/, 'and the destructive confirm sits with the room chrome');
});

test('the card shows the rating, the points, the tries and every move', () => {
  assert.match(drill, /StudentDrillStatus/);
  assert.match(drill, /live-drill-info-rating/, 'the rating is shown');
  assert.match(drill, /★ \{rating\}|★<\/span> \{rating\}/, 'as a star');
  assert.match(drill, /No moves yet/, 'an empty list says so rather than nothing');
  assert.match(board, /<div className="live-drill-info" ref=\{infoCardRef\}>\{drillStatus\}<\/div>/,
    'and it reaches the board');
});

test('the drill has no leftover surface of its own', () => {
  /* StudentSolveView and its PuzzlePlayer are gone. Two copies of the rules is
     how one of them ends up believing a wrong move should stick. */
  assert.doesNotMatch(drill, /StudentSolveView/, 'the superseded solve view must be gone');
  assert.doesNotMatch(imports, /PuzzlePlayer/, 'PuzzlePlayer must no longer be imported');
  assert.doesNotMatch(imports, /useFittedBoardWidth/, 'nor its board-width helper');
  for (const gone of ['live-drill-solve', 'live-drill-own', 'live-drill-student-done']) {
    assert.ok(!new RegExp(`\\.${gone}\\s*\\{`).test(css), `${gone} must no longer be styled`);
    assert.ok(!drill.includes(`"${gone}`), `${gone} must no longer be rendered`);
  }
});

/* ── move-by-move animation, shared with the homework trainer ───────────── */
test('both surfaces animate the same way', () => {
  /* The prop existed on ChessBoard and was never forwarded to react-chessboard,
     so every board animated at the library's default whatever a caller asked
     for — which is why a replay and a puzzle solve did not feel like the same
     board. */
  const chessBoard = read('src', 'components', 'ChessBoard.jsx');
  assert.match(chessBoard, /animationDuration=\{Number\.isFinite\(animationDuration\)/,
    'the prop must reach react-chessboard');
  assert.match(chessBoard, /animationDuration = 0\.25,/, 'and still default to a sane slide');

  /* One number for both surfaces, so they cannot drift apart. */
  assert.ok(MOVE_ANIM_SECONDS > 0 && MOVE_ANIM_SECONDS <= 1, 'the shared duration must be usable');
  assert.match(solverSource, /export const MOVE_ANIM_SECONDS = 0\.25;/, 'and it is the one both import');
  assert.match(player, /animationDuration=\{MOVE_ANIM_SECONDS\}/, 'the homework trainer animates with it');
  assert.match(board, /animationDuration=\{MOVE_ANIM_SECONDS\}/, 'and so does the drill board');
  /* The review slides to the reviewed ply too, but WITHOUT a per-FEN key: a key
     changed with every click, which remounted the board and blinked the page. */
  assert.doesNotMatch(board, /key=\{`(review|class-review|remote-review)-/,
    'the board must not be keyed by a changing position — that remounts and blinks');

  /* The reply waits for the slide to finish, then a frame, so the reply is not
     racing the piece that is still moving. */
  assert.ok(MOVE_ANIM_MS >= MOVE_ANIM_SECONDS * 1000, 'the wait must cover the slide');
  assert.ok(MOVE_ANIM_MS < MOVE_ANIM_SECONDS * 1000 + 200, 'and not dawdle after it');
});

test('the shared solver produces the same SAN a score sheet would', () => {
  /* The drill's move list is derived from this, so a wrong replay would show a
     student moves they never played. */
  const fen = '7k/6pp/1N3p2/8/2P5/b3r1P1/1q3PKP/3R4 w - - 0 38';
  const solution = ['d1d8', 'e3e8', 'd8e8', 'a3f8', 'e8f8'];
  assert.deepEqual(sanLine(fen, solution), ['Rd8+', 'Re8', 'Rxe8+', 'Bf8', 'Rxf8#']);
  assert.deepEqual(sanLine(fen, solution, 4), ['Rd8+', 'Re8', 'Rxe8+', 'Bf8'], 'and honours a ply count');
  /* Jump-to-move replays the same line, so the board shows a real position.
     Checked against the position the board itself would be showing at that ply
     — `fenAtPly` returns a FEN, which carries no history of its own. */
  const expectedAt = (count) => {
    const g = new Chess(fen);
    solution.slice(0, count).forEach((u) => g.move({ from: u.slice(0, 2), to: u.slice(2, 4) }));
    return g.fen();
  };
  assert.equal(fenAtPly(fen, solution, 4), expectedAt(4), 'ply 4 is the position after four plies');
  assert.equal(fenAtPly(fen, solution, 0), fen, 'ply 0 is the starting position');
  /* And it is a position a board can actually be built from. */
  assert.doesNotThrow(() => new Chess(fenAtPly(fen, solution, 5)));
});
