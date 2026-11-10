// Puzzle Trainer scoring, the three-second beat and the box-free navbar logo -
//   run with: node --test scripts/trainer-score-delay.test.mjs   (from frontend/)
//
// Three separate promises are guarded here, because three different mechanisms
// deliver them and each can regress on its own:
//
//  1. THE BEAT. A solved puzzle shows the award, then the next one arrives
//     three seconds later. The board must stay locked for those seconds, every
//     timer must live in `timersRef` so unmount or a level change cancels the
//     whole flight, and the score request that rides alongside must never
//     rewrite the status line of a puzzle it was not about.
//  2. THE LADDER. The top ten, the viewer's own row (even below the ten) and
//     the scoring rule all come from the server; the page re-reads them after
//     every solve and on a beat while it is open.
//  3. THE EMBLEM. The logo is artwork: one transparent PNG at a fixed 36px,
//     with no chip, frame or forced square around it. An earlier asset had a
//     white rounded card baked into its pixels, which is what read as a "box".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { NEXT_DELAY_MS, solveMessage, scoringNote } from '../src/lib/puzzleScore.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const page = read('src/pages/PuzzleTrainer.jsx');
const ladder = read('src/components/puzzle/TrainerLadder.jsx');
const brandCss = read('src/index.css');
const trainerCss = read('src/pages/puzzle-trainer.css');
const logo = read('src/components/Logo.jsx');

/* ── the beat ─────────────────────────────────────────────────────────────── */

test('the next puzzle waits three seconds, not one', () => {
  assert.equal(NEXT_DELAY_MS, 3000);
  /* One definition, imported: a local copy drifting from the URL's 3 s would
     be invisible here and obvious to a student. */
  assert.match(page, /import \{ NEXT_DELAY_MS, solveMessage \} from '\.\.\/lib\/puzzleScore';/);
  assert.doesNotMatch(page, /const NEXT_DELAY_MS =/, 'the delay must not be redefined in the page');
});

test('the next load is scheduled once, through the shared timer list', () => {
  const loads = page.match(/later\(\(\) => loadPuzzle\(lv\), NEXT_DELAY_MS\);/g) || [];
  assert.equal(loads.length, 1, 'exactly one scheduled next-puzzle load');
  /* A bare setTimeout would survive both unmount and a level change. */
  assert.doesNotMatch(page, /setTimeout\(\(\) => loadPuzzle/);
});

test('the board is locked for the whole beat', () => {
  const solved = page.slice(page.indexOf('const handleSolved'), page.indexOf('const handleFailed'));
  assert.match(solved, /setLocked\(true\);/, 'a solved puzzle must lock the board');
  assert.match(page, /interactive=\{!locked\}/, 'the board reads the lock');
  assert.match(solved, /setCountdown\(seconds\)/, 'the beat is visible as a countdown');
  assert.match(page, /Next in \{countdown\}s/, 'the countdown renders in the status row');
});

test('the countdown ticks down and clears when the beat ends', () => {
  assert.match(page, /for \(let s = seconds - 1; s >= 1; s -= 1\)/);
  assert.match(page, /later\(\(\) => setCountdown\(s\), \(seconds - s\) \* 1000\)/);
  /* loadPuzzle and show() both reset it: a stale "Next in 2s" over a fresh
     position would be a lie. */
  assert.match(page, /const show = useCallback\(\(p\) => \{[\s\S]*?setCountdown\(0\);/);
  assert.match(page, /solveSeqRef\.current \+= 1;\s*\n\s*setCountdown\(0\);/);
});

test('unmount and a level change cancel the pending flight', () => {
  assert.match(page, /useEffect\(\(\) => \(\) => \{\s*\n\s*clearTimers\(\);/,
    'unmount must clear every scheduled timer');
  const choose = page.slice(page.indexOf('const chooseLevel'), page.indexOf('const openLadder'));
  assert.match(choose, /clearTimers\(\);/, 'a level change must not leave a load behind');
  assert.match(choose, /setCountdown\(0\)/);
  /* Changing band also invalidates the warm puzzle and any score reply. */
  assert.match(choose, /pendingRef\.current = null;/);
  assert.match(choose, /solveSeqRef\.current \+= 1;/);
});

test('the solve request carries what the server needs to score it', () => {
  const solved = page.slice(page.indexOf('const handleSolved'), page.indexOf('const handleFailed'));
  assert.match(solved, /api\.post\('\/puzzles\/trainer\/solve', \{/);
  for (const key of ['puzzleId', 'line: moves', 'firstTry: !messy', 'solveMs', 'level: lv']) {
    assert.ok(solved.includes(key), `solve request must send ${key}`);
  }
  /* The time starts when the position appears, not when the last one was
     solved - otherwise the speed bonus measures the wrong thing. */
  assert.match(page, /shownAtRef\.current = Date\.now\(\);/);
  assert.match(solved, /Date\.now\(\) - shownAtRef\.current/);
});

test('a late score reply cannot rewrite the next puzzle status', () => {
  const solved = page.slice(page.indexOf('const handleSolved'), page.indexOf('const handleFailed'));
  const guards = solved.match(/if \(seq !== solveSeqRef\.current\) return;/g) || [];
  assert.equal(guards.length, 2, 'both the award and the failure are gated on the sequence');
  /* The ladder still updates from a late reply - only the status is gated. */
  assert.match(solved, /setBoard\(award\.leaderboard\)/);
});

test('wordings match the score the server awarded', () => {
  assert.equal(
    solveMessage({ credited: true, points: 10, messy: false }),
    'Correct! +10 points',
  );
  assert.equal(
    solveMessage({ credited: true, points: 5, messy: true }),
    'Solved! +5 points',
  );
  assert.equal(
    solveMessage({ credited: true, points: 1, messy: false }),
    'Correct! +1 point',
    'a single point must not read "1 points"',
  );
  assert.match(solveMessage({ credited: false, points: 0 }), /already counted/);
});

test('staff practice is not dressed up as an award', () => {
  assert.match(
    solveMessage({ credited: false, points: 0, messy: false, counted: false }),
    /not added to the student leaderboard/,
    'a staff solve must say it was not counted',
  );
  assert.match(page, /const staff = isAdminRole\(user\?\.role\);/);
  assert.match(page, /counted: award\.counted/, 'the page must read the server\'s counted flag');
  assert.match(page, /staff=\{staff\}/, 'the ladder is not told this viewer is staff');
});

test('staff reach the trainer from the admin sidebar, ungated', () => {
  const app = read('src/App.jsx');
  assert.match(app, /path="\/admin\/trainer"[\s\S]{0,120}<PuzzleTrainer \/>/,
    'the admin trainer route is missing');
  const sidebars = read('src/config/sidebarConfigs.js');
  const at = sidebars.indexOf("to: '/admin/trainer'");
  assert.ok(at > -1, 'the admin sidebar has no Puzzle Trainer row');
  const line = sidebars.slice(at, sidebars.indexOf('\n', at));
  assert.match(line, /label: 'Puzzle Trainer'/);
  assert.doesNotMatch(line, /feature:/,
    'staff practice must not depend on the student puzzle_trainer switch');
});

/* ── the ladder ───────────────────────────────────────────────────────────── */

test('the ladder is read fresh, never from the 30-second GET cache', () => {
  assert.match(page, /api\.get\('\/puzzles\/trainer\/leaderboard', \{ cache: false \}\)/,
    'the cache would serve the ladder as it stood before the solve');
});

test('the ladder moves without a reload', () => {
  assert.match(page, /const LADDER_REFRESH_MS = \d+;/);
  assert.match(page, /setInterval\(loadBoard, LADDER_REFRESH_MS\)/);
  assert.match(page, /visibilitychange/);
  assert.match(page, /useProfileChanged\(loadBoard\)/,
    'a new avatar must repaint the ladder it is drawn into');
});

test('the award response is the ladder', () => {
  const solved = page.slice(page.indexOf('const handleSolved'), page.indexOf('const handleFailed'));
  assert.match(solved, /setBoard\(award\.leaderboard\)/,
    'the fresh board rides back with the award - no second round trip');
});

test('the ladder rows show rank, name, points and solved count', () => {
  assert.match(ladder, /row\.rank/);
  assert.match(ladder, /pt-lb-uname/);
  assert.match(ladder, /row\.total_points/);
  assert.match(ladder, /row\.solved_count\} solved/);
});

test('your own row is highlighted, and shown even outside the ten', () => {
  assert.match(ladder, /const isMe = \(row\) => Number\(row\.user_id\) === Number\(myUserId\);/);
  assert.match(ladder, /isMe\(row\) \? ' is-me' : ''/);
  assert.match(ladder, /const meInTop = !!me && top\.some\(isMe\);/);
  assert.match(ladder, /board && !staff && !meInTop &&/);
  assert.match(ladder, /is-me is-outside/);
  assert.match(ladder, /solve to rank/, 'an unranked viewer gets words, not a fake rank');
});

test('the ladder never shows staff a fake "you" row', () => {
  assert.match(ladder, /board && !staff && !meInTop &&/,
    'a staff viewer would be drawn as an unranked student');
  assert.match(ladder, /student leaderboard|Student leaderboard/);
  assert.match(ladder, /staff practice is not ranked/);
});

test('the ladder says how it scores', () => {
  assert.match(ladder, /scoringNote\(board\?\.scoring\)/);
  assert.match(scoringNote({
    first_try: 10, after_miss: 5, wrong_move: 0, speed_bonus: 2, speed_window_ms: 30000,
  }), /First try \+10 · after a miss \+5 · wrong move 0 · under 30s \+2/);
  assert.equal(scoringNote(null), '');
});

test('a phone opens the ladder from one live row instead of a ten-row table', () => {
  assert.match(page, /compact \? \(/);
  assert.match(page, /className="pt-level pt-lbopen"/);
  assert.match(page, /You #\$\{myRow\.rank\} · \$\{myRow\.total_points\} pts/);
  assert.match(page, /modalClass="pt-lbmodal"/);
});

test('the ladder card scrolls inside itself, not the page', () => {
  assert.match(trainerCss, /\.pt-lb-body \{[^}]*overflow-y: auto;/);
  assert.match(trainerCss, /\.pt-lb-row\.is-outside \{[^}]*position: sticky;/);
  assert.match(trainerCss, /\.pt-msg \.pt-next \{[^}]*white-space: nowrap;/);
  /* The one-screen frame must not clip a tall ladder: the side column
     stretches on a desktop and the ladder shrinks within it. */
  assert.match(trainerCss, /@media \(min-width: 900px\) \{\s*\.pt-lb \{\s*flex: 0 1 auto;/);
});

/* ── the navbar emblem ────────────────────────────────────────────────────── */

function pngInfo(file) {
  const b = readFileSync(file);
  let off = 8, width = 0, height = 0, colorType = 0;
  const idat = [];
  while (off < b.length) {
    const len = b.readUInt32BE(off);
    const type = b.toString('ascii', off + 4, off + 8);
    const data = b.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  return { width, height, colorType, idat };
}

test('the emblem PNG is transparent, and trimmed to the artwork', () => {
  const info = pngInfo(join(ROOT, 'src', 'assets', 'logo-emblem.png'));
  assert.equal(info.colorType, 6, 'the emblem must be an RGBA PNG with an alpha channel');
  assert.ok(info.width > 200 && info.height > 200, 'the artwork must stay crisp at 36px');

  /* Decode just enough of the image to prove the background is see-through:
     8-bit RGBA, filter byte per row. */
  const raw = inflateSync(Buffer.concat(info.idat));
  const stride = info.width * 4;
  const px = Buffer.alloc(info.height * stride);
  let p = 0;
  for (let y = 0; y < info.height; y++) {
    const filter = raw[p++];
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? px[y * stride + x - 4] : 0;
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = y > 0 && x >= 4 ? px[(y - 1) * stride + x - 4] : 0;
      let v = raw[p++];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      px[y * stride + x] = v & 255;
    }
  }
  const alpha = (x, y) => px[(y * info.width + x) * 4 + 3];
  const corners = [[0, 0], [info.width - 1, 0], [0, info.height - 1], [info.width - 1, info.height - 1]];
  for (const [x, y] of corners) {
    assert.equal(alpha(x, y), 0, `corner ${x},${y} must be transparent - a filled card here is the "box"`);
  }
  let painted = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) if (alpha(x, y) > 8) painted += 1;
  }
  const ratio = painted / (info.width * info.height);
  assert.ok(ratio > 0.2 && ratio < 0.8,
    `the artwork covers ${(ratio * 100).toFixed(0)}% of the file - a full-bleed card would be ~100%`);
});

test('the brand rule is one 36px emblem with nothing drawn around it', () => {
  const block = brandCss.slice(brandCss.indexOf('.brand-emblem {'));
  const rule = block.slice(0, block.indexOf('}'));
  assert.match(rule, /height: 36px;/, 'the emblem is 36px tall');
  assert.match(rule, /width: auto;/, 'the width follows the artwork');
  assert.match(rule, /object-fit: contain;/);
  assert.match(rule, /background: none;/);
  assert.match(rule, /border: 0;/);
  assert.match(rule, /box-shadow: none;/);
  assert.match(rule, /border-radius: 0;/);
  assert.doesNotMatch(rule, /overflow: hidden/, 'nothing may clip the artwork into a box');
  assert.doesNotMatch(rule, /height: var\(--brand-h/, 'the emblem must not resize per header');
  assert.doesNotMatch(brandCss, /\.brand-emblem \{ height: calc\(var\(--brand-h, 44px\) \* 0\.73\)/,
    'the old sub-640px shrink is gone - the same 36px fits the narrowest bar');
});

test('the lockup sizes the name, not the emblem', () => {
  assert.match(logo, /--brand-h/);
  assert.match(logo, /brand-emblem/);
  assert.match(brandCss, /\.brand-name \{[\s\S]*?font-size: calc\(var\(--brand-h, 44px\) \* 0\.55\)/);
});
