/* ──────────────────────────────────────────────────────────────────────────
 * Stepping through the game-viewer card must cost a pointer read, not a replay.
 *
 * The regression the user first reported: after Stockfish finished a game,
 * pressing Prev/Next (or tapping a move) froze the whole app — the board stopped
 * following the move number and, once a promise was left hanging, the board
 * stopped answering at all. The fix was a precomputed position per ply; the card
 * has since moved to the shared variation tree, where every ply (mainline AND
 * branch) is one node and navigation is a `pointer` assignment.
 *
 * What must stay true, whichever model holds the positions:
 *   - one node per ply, built once per game — no `new Chess()` replay on a step;
 *   - the board and the last-move marker read the SAME node, so they cannot
 *     drift (the old `fen`/`lastMove` state pair could);
 *   - a held arrow key accumulates instead of collapsing into one ply;
 *   - no engine call on the navigation path.
 *
 * Run: node --test scripts/viewer-navigation.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Chess } from 'chess.js';

import { buildMainline, initialState, lineOf } from '../src/utils/variationTree.js';

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

/* ── one source of truth: a tree node per ply, built once ────────────────── */

test('the card navigates the shared tree, not its own position table', () => {
  assert.match(CARD, /const tree = useVariationTree\(parsed\.moves, \{/,
    'the card is wired to the shared hook');
  assert.match(CARD, /initialFen: parsed\.initFen,/,
    'a game with a custom start is replayed from its real origin');
  assert.match(CARD, /storageKey: variationKey,/,
    'this user’s branches for this game are restored on open');
  assert.doesNotMatch(CARD, /const positions = useMemo\(/,
    'the private FEN table is gone — the tree owns every ply');
  assert.doesNotMatch(CARD, /function applyNav\(/,
    'there is no second navigation path beside the tree');
});

test('navigation reads the pointer; it never replays the game', () => {
  assert.match(CARD, /const moveIndex = tree\.currentPly;/,
    'the ply on screen is the tree pointer');
  assert.match(CARD, /const lastMove = tree\.currentLastMove;/,
    'the highlight comes from the same node as the position');
  assert.doesNotMatch(CARD, /\[fen, setFen\]|setLastMove\(/,
    'the board position and the last-move marker are not separate state');
  const navigate = body(CARD, 'useReviewKeys({');
  assert.doesNotMatch(navigate, /new Chess\(|history\(|searchTopMoves/,
    'a step costs a pointer read, not a replay or a search');
});

test('the tree model still produces the position a naive replay would', () => {
  /* The tree’s mainline, replayed the old way over the same 150 plies: they
     must agree square for square, including the move that produced each node. */
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

  const base = buildMainline(new Chess().fen(), sans);
  const state = initialState(base, base.ids[base.ids.length - 1]);
  const line = lineOf(state);
  assert.equal(line.length, sans.length + 1, 'root + one node per ply');

  for (let ply = 0; ply <= sans.length; ply += 1) {
    const node = state.nodes[state.ids[ply]];
    const g = new Chess();
    for (let i = 0; i < ply; i += 1) g.move(sans[i]);
    assert.equal(node.fen, g.fen(), `ply ${ply} disagrees`);
    if (ply > 0) {
      const last = g.history({ verbose: true }).at(-1);
      assert.equal(node.uci, `${last.from}${last.to}${last.promotion || ''}`);
    }
  }
});

/* ── held keys: every press is one node ──────────────────────────────────── */

test('a held arrow key accumulates: each press moves exactly one node', () => {
  const sans = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'];
  const base = buildMainline(new Chess().fen(), sans);
  let state = initialState(base, base.ids[0]);
  for (let i = 0; i < sans.length; i += 1) {
    const at = state.ids.indexOf(state.pointer);
    state = { ...state, pointer: state.ids[at + 1] };
    assert.equal(state.nodes[state.pointer].ply, i + 1,
      `press ${i + 1} lands on ply ${i + 1}`);
  }
  /* No rAF queue: five synchronous presses are five pointers, so a fast
     key-repeat can never collapse into one step. */
  assert.doesNotMatch(CARD, /requestAnimationFrame/,
    'the old frame coalescer is gone; synchronous commits accumulate');
});

/* ── no engine work, and nothing unbounded, on the navigation path ───────── */

test('navigation never touches the engine', () => {
  assert.doesNotMatch(body(CARD, 'useReviewKeys({'), /searchTopMoves|evaluate|analyzeCanonical/,
    'undo/redo must not ask the engine anything');
  /* The live eval runs only OFF the original line, and never while a full
     review is running — it can never fight the review for the engine pool. */
  assert.match(CARD, /enabled: !tree\.isOnMainline && revState !== 'running',/);
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

/* ── the board + list are the shared ones ───────────────────────────────── */

test('the card renders the shared board and the shared move list', () => {
  assert.match(CARD, /<VariationBoard[\s\S]{0,400}tree=\{tree\}/,
    'the board is the shared variation wrapper');
  assert.match(CARD, /<VariationMoveList[\s\S]{0,400}headless/,
    'the score sheet is the shared list, not a private copy');
  assert.match(CARD, /id="cp-score-body"[\s\S]{0,700}<VariationMoveList/,
    'the list renders inside the scrolling score sheet so it can scroll itself');
});

test('the score-sheet grid puts White on odd plies', () => {
  const list = read('src/components/variation/VariationMoveList.jsx');
  assert.match(list, /const side = abs % 2 === 1 \? 'white' : 'black';/,
    'ply 1 is White’s first move, so the column parity must start odd');
  assert.match(list, /const num = Math\.ceil\(abs \/ 2\);/,
    'the move number of ply 1 is 1, not 2');
  assert.match(list, /\{abs % 2 === 1 && <span className="var-mv-num">\{Math\.ceil\(abs \/ 2\)\}\./,
    'a variation’s inline move number must follow the same parity');
});

test('a variation line renders each move once, not once per block', () => {
  const list = read('src/components/variation/VariationMoveList.jsx');
  /* The first child of a chain node is the line's own continuation, already a
     button in the same row. Rendering it again as a nested block duplicated
     every later move of a multi-move variation (v3 appeared inside both v2 and
     v1), so only the side children may become nested blocks. */
  assert.match(list, /\.filter\(\(c\) => c && !c\.isMainline && c\.id !== n\.children\[0\]\)/,
    'nested blocks must skip the chain continuation');
});

test('a deviation from the start position still gets a block', () => {
  const list = read('src/components/variation/VariationMoveList.jsx');
  assert.match(list, /const rootBranches = useMemo\(/,
    'branches of the root have no row to sit under');
  assert.match(list, /\{rootBranches\.length > 0 && [\s\S]{0,600}rootBranches\.map/,
    'they are rendered at the top of the list');
  assert.match(list, /tree\.promoteVariation\(tree\.promotedId\)/,
    'a promoted view can be undone without deleting the variation');
});

/* ── the best-move arrow ─────────────────────────────────────────────────── */

test('the arrow is the best move for the position showing', () => {
  const arrows = body(CARD, 'const lineArrows = useMemo(');
  assert.match(arrows, /verdicts\[moveIndex\]/,
    'on the original line, the row read is the move that comes NEXT');
  assert.match(arrows, /liveEval\?\.bestUci/,
    'off the line, the live search answers for the node itself');
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
