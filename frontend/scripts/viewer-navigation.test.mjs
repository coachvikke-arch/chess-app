/* ──────────────────────────────────────────────────────────────────────────
 * Stepping through the game-viewer card must cost a ply index, not a replay.
 *
 * The regression the user reported: after Stockfish finished a game, pressing
 * Prev/Next (or tapping a move) froze the whole app — the board stopped
 * following the move number and, once a promise was left hanging, the board
 * stopped answering at all.
 *
 * What profiling showed, per press:
 *   - `go()` rebuilt the game: a fresh Chess plus one `move()` per ply up to the
 *     target, each of which regenerates the legal move list (27-59 ms on a
 *     156-ply game, and it grows with the game);
 *   - three independent "which move happened here?" sweeps ran over the same
 *     step — the piece layer probed forward AND backward, the board probed again
 *     for the sound, and each had its own private copy of that scan;
 *   - once an analysis existed, two more full `history({ verbose: true })` walks
 *     joined in (the effect's move lookup and the board's last-move marker).
 *   50 rapid Prev presses measured 2168 ms of blocked main thread before React
 *   did any work at all. The same 50 steps through a position table measured
 *   0.08 ms.
 *
 * So this file holds the SHAPE that made the number small: one precomputed
 * position per ply, one Chess instance, one state value, coalesced navigation,
 * memoised rows, one shared probe, and no engine call — and no unbounded one —
 * anywhere on the path.
 *
 * Run: node --test scripts/viewer-navigation.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Chess } from 'chess.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const CARD = read('src/components/GameViewerCard.jsx');
const BOARD = read('src/components/ChessBoard.jsx');
const ANIMATED = read('src/components/board/AnimatedBoard.jsx');
const DIFF = read('src/utils/positionDiff.js');

/** The body of `declaration`, up to the line that closes it. */
function body(source, declaration) {
  const start = source.indexOf(declaration);
  assert.ok(start >= 0, `${declaration} is missing`);
  const lines = source.slice(start).split('\n');
  let depth = 0;
  const out = [];
  for (const line of lines) {
    out.push(line);
    depth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
    if (out.length > 1 && depth === 0) break;
  }
  return out.join('\n');
}

/* ── one source of truth: a position per ply, built once ─────────────────── */

test('the card precomputes one position per ply when the game loads', () => {
  assert.match(CARD, /const positions = useMemo\(/,
    'the FEN table has to exist');
  assert.match(CARD, /\}, \[parsed\.initFen, parsed\.moves\]\);/,
    'the table is built once per game, not per navigation');
  assert.match(CARD, /const plies = positions\.length - 1;/,
    'the ply count the whole card clamps to comes from the table');
});

test('navigation reads the table; it never replays the game', () => {
  const apply = body(CARD, 'function applyNav(');
  assert.match(apply, /const pos = positions\[ply\];/);
  assert.match(apply, /g\.load\(pos\.fen\)/,
    'the board is loaded from the table entry');
  assert.doesNotMatch(apply, /new Chess\(/,
    'no Chess instance is built during navigation');
  assert.doesNotMatch(apply, /for \(let i = 0; i < target; i\+\+\)/,
    'no replay up to the target ply');
  assert.doesNotMatch(apply, /history\(/,
    'the move comes out of the table, not out of a history walk');
  assert.doesNotMatch(CARD, /\[fen, setFen\]|setLastMove\(/,
    'the board position and the last-move marker are not separate state');
  assert.match(CARD, /const lastMove = positions\[moveIndex\]\?\.lastMove \|\| null;/,
    'the highlight is read from the same entry as the position, so they cannot drift');
});

test('the table is the position the naive replay would have produced', () => {
  /* The model, replayed the old way and the new way over the same 150 plies:
     they must agree square for square, including the last move that produced
     each position. */
  const sans = [];
  const gen = new Chess();
  while (sans.length < 150) {
    const legal = gen.moves();
    if (!legal.length) break;
    const pick = legal[(sans.length * 7 + 3) % legal.length];
    const mv = gen.move(pick);
    if (!mv) break;
    sans.push(mv.san);
  }
  assert.ok(sans.length > 100, 'fixture game is too short');

  /* new way: one pass, one FEN per ply */
  const table = [{ fen: new Chess().fen(), from: null, to: null }];
  const walk = new Chess();
  for (let i = 0; i < sans.length; i += 1) {
    const m = walk.move(sans[i]);
    table.push({ fen: walk.fen(), from: m.from, to: m.to });
  }
  /* old way: rebuild from scratch for every single ply */
  for (let ply = 0; ply < table.length; ply += 1) {
    const g = new Chess();
    for (let i = 0; i < ply; i += 1) g.move(sans[i]);
    assert.equal(g.fen(), table[ply].fen, `ply ${ply} disagrees`);
    if (ply > 0) {
      const last = g.history({ verbose: true }).at(-1);
      assert.equal(last.from, table[ply].from);
      assert.equal(last.to, table[ply].to);
    }
  }
});

/* ── rapid presses: one navigation per frame ─────────────────────────────── */

test('quick presses are coalesced into one frame, and the frame is cancelled', () => {
  const queue = body(CARD, 'function queueNav(');
  assert.match(queue, /nav\.raf = requestAnimationFrame/,
    'animated navigation is queued, not applied per press');
  assert.match(queue, /nav\.target \+ target/,
    'a held step accumulates inside the frame: five presses still move five plies');
  assert.match(queue, /base \+ target/,
    'a step that opens a new queue counts from the ply the board is on');
  assert.match(CARD, /appliedPlyRef\.current = ply;/,
    'the applied ply is tracked as of the navigation, not as of the last render');
  assert.match(queue, /isStep \? \(pending \? nav\.target \+ target : base \+ target\) : target;/,
    'a step accumulates, an absolute jump takes the newest target');
  const unmount = body(CARD, 'useEffect(() => () => {\n    if (navRef.current.raf)');
  assert.match(unmount, /cancelAnimationFrame\(navRef\.current\.raf\)/,
    'a frame that never painted is dropped on unmount');
});

test('the score sheet re-renders the rows that actually moved', () => {
  assert.match(CARD, /const ScoreRow = memo\(/, 'rows are memoised');
  assert.match(CARD, /const sheetRows = useMemo\(/, 'row content is memoised');
  assert.match(CARD, /\}, \[parsed\.moves, verdicts\]\);/,
    'row content only changes with the game or the analysis');
  assert.match(CARD, /const onCell = useCallback\(\(ply\) => jumpRef\.current\(ply\), \[\]\);/,
    'the tap handler keeps one identity, or every memo above is useless');
  assert.match(CARD, /activeWhite=\{cells\[0\]\?\.ply === moveIndex\}/,
    'the highlight is the only prop that moves per ply');
});

/* ── no engine work, and nothing unbounded, on the navigation path ───────── */

test('navigation never touches the engine', () => {
  assert.doesNotMatch(body(CARD, 'function applyNav('), /searchTopMoves|evaluate|analyzeCanonical/,
    'undo/redo must not ask the engine anything');
});

test('the analysis pre-flight cannot hang the card forever', () => {
  const run = body(CARD, 'async function runAnalysis(');
  assert.match(CARD, /const ENGINE_BOOT_TIMEOUT_MS = \d+;/,
    'the boot probe has a stated ceiling');
  assert.match(run, /await Promise\.race\(\[/,
    'the probe races that ceiling');
  assert.match(run, /bootTimedOut[\s\S]{0,200}stopEngineSearch\(\)/,
    'a probe that timed out is aborted, so a retry does not queue behind it');
  assert.match(run, /window\.clearTimeout\(preWatchdog\)/,
    'the probe timer is cleared whichever way the race went');
  assert.match(CARD, /if \(runningRef\.current\) stopEngineSearch\(\);/,
    'closing the card stops the search it started');
});

/* ── the best-move arrow ─────────────────────────────────────────────────── */

test('the arrow is the engine best move for the position showing', () => {
  const arrows = body(CARD, 'const lineArrows = useMemo(');
  assert.match(arrows, /verdicts\[moveIndex\]/,
    'the row read is the move that comes NEXT from the position on screen');
  assert.match(arrows, /moveIndex < verdicts\.length/,
    'the last position has no next move, so no arrow');
  assert.match(arrows, /row\.bestUci/,
    'a ply with no lines still has the best move the engine saw');
  assert.match(arrows, /from === to\) return \[\];/,
    'a degenerate pair never paints a dot-sized arrow');
  assert.match(CARD, /const TOP_LINE_COLOR = 'rgba\(0, 128, 0, 1\)';/,
    'the arrow keeps its green — a colour change here is a design change');
  assert.match(BOARD, /customArrows=\{pendingPromo \? \[\] : normalizedArrows\}/,
    'the board draws the overlay arrow itself, not only react-chessboard’s');
});

test('a verdict row is keyed by its own ply, so a dropped row cannot shift the arrow', () => {
  const project = body(CARD, 'function projectReview(');
  assert.match(project, /const at = Number\.isInteger\(m\.ply\) \? m\.ply : i;/,
    'rows land at their ply, not at their position in the array');
  assert.match(project, /sacrifice: Boolean\(m\.sacrifice\)/,
    'the engine sacrifice decision reaches the card');
});

/* ── one shared probe, not three private sweeps ──────────────────────────── */

test('both boards ask the same shared probe, which caches the step', () => {
  assert.match(BOARD, /from '\.\.\/utils\/positionDiff'/);
  assert.match(ANIMATED, /from '\.\.\/\.\.\/utils\/positionDiff'/);
  assert.doesNotMatch(BOARD, /function exactlyOnePly\(/,
    'the board must not keep its own copy of the scan');
  assert.doesNotMatch(ANIMATED, /function exactlyOnePly\(/,
    'the piece layer must not keep its own copy either');
  assert.match(DIFF, /legal\.filter\(\(m\) => diff\.has\(m\.from\) && diff\.has\(m\.to\)\)/,
    'only the squares the FEN actually changed are applied');
  assert.match(DIFF, /const CACHE_LIMIT = \d+;/,
    'one step is probed by two layers, so the answer is kept');
});

/* ── the glide ───────────────────────────────────────────────────────────── */

test('the review glide is capped, and only ever shortened', () => {
  assert.match(CARD, /maxMoveMs=\{160\}/,
    'stepping through a game waits no longer than the next press');
  assert.match(ANIMATED, /Math\.min\(preset\.duration, maxMoveMs\)/,
    'the cap shortens the saved preference, it does not override it');
  assert.match(ANIMATED, /transition: settle\.phase === 'go' && animate/,
    'the glide is a transform, and no layout property is touched');
});
