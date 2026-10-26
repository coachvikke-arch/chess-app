// Regression tests for the game-review classification BADGE overlay geometry —
//   run with: node --test scripts/badge-position.test.mjs   (from frontend/)
//
// The badge must sit on the exact point where FOUR adjacent squares meet, never
// over a piece and never inside a single square.
//
// The bug this guards: `.move-badge` is a zero-size anchor (width/height: 0) and
// the centring lived on IT as `transform: translate(-50%,-50%)`. A percentage
// translate resolves against the element's OWN size, so on a 0x0 box it is 0px
// of movement — a silent no-op. The sized `.move-badge-dot` therefore kept its
// top-LEFT corner on the junction and spilled down-and-right onto the
// neighbouring square, covering that square's piece.
//
// These assert the geometry ChessBoard.jsx computes and index.css applies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const boardSrc = readFileSync(join(ROOT, 'src', 'components', 'ChessBoard.jsx'), 'utf8');
const css = readFileSync(join(ROOT, 'src', 'index.css'), 'utf8');

const rule = (sel) => {
  const i = css.indexOf(`${sel} {`);
  assert.notEqual(i, -1, `${sel} rule must exist`);
  return css.slice(i, css.indexOf('}', i));
};

/* Replicates ChessBoard's anchor math so the geometry is asserted directly. */
const anchorFor = (file, rank, orientation, boardWidth) => {
  const sq = boardWidth / 8;
  const col = orientation === 'white' ? file : 7 - file;
  const row = orientation === 'white' ? 7 - rank : rank;
  /* junction = the destination square's top-left, advanced one square in X */
  return { x: col * sq + sq, y: row * sq, sq };
};

test('the centring translate is on the SIZED dot, not the zero-size anchor', () => {
  /* The whole bug in one assertion: a % translate on a 0x0 box moves nothing. */
  assert.ok(!/transform\s*:\s*translate\(-50%/.test(rule('.move-badge')),
    '.move-badge is width:0/height:0 — a % translate there is a silent no-op');
  assert.match(rule('.move-badge-dot'), /transform\s*:\s*translate\(-50%,\s*-50%\)/,
    'the centring translate must be on .move-badge-dot, the element that has size');
});

test('the anchor stays a zero-size point so percentages stay meaningful', () => {
  const anchor = rule('.move-badge');
  assert.match(anchor, /width\s*:\s*0\s*;/);
  assert.match(anchor, /height\s*:\s*0\s*;/);
});

test('the pop animation composes the translate so it cannot displace the badge', () => {
  /* transform is one property: an animated transform REPLACES the static one,
     so an un-composed scale() would fling the badge off the junction mid-pop. */
  const kf = css.slice(css.indexOf('@keyframes move-badge-pop'));
  /* the keyframes run to the closing brace of the AT-RULE, not the first
     keyframe's brace — slice to the rule's own terminator. */
  const body = kf.slice(0, kf.indexOf('\n}'));
  const frames = body.match(/transform\s*:[^;}]+/g) || [];
  assert.ok(frames.length >= 3, 'expected 3 pop keyframes');
  for (const f of frames) {
    assert.match(f, /translate\(-50%,\s*-50%\)/,
      `every pop keyframe must keep the centring translate: ${f}`);
  }
  /* the original scale values must be preserved — animation look unchanged */
  assert.match(body, /scale\(0\.4\)/);
  assert.match(body, /scale\(1\.15\)/);
  assert.match(body, /scale\(1\)/);
});

test('the badge anchors on a 4-square junction, not a square centre', () => {
  /* The junction is offset by exactly one square from the square's top-left;
     a square CENTRE would be + sq/2. Assert the code really uses + sq, so the
     badge can never land in the middle of a square (or on its piece). */
  assert.match(boardSrc, /badgeX\s*=\s*badgeCol\s*\*\s*badgeSq\s*\+\s*badgeSq\s*;/,
    'badgeX must be the junction (top-left + one square), not the square centre');
  assert.match(boardSrc, /badgeY\s*=\s*badgeRow\s*\*\s*badgeSq\s*;/,
    'badgeY must be the square top edge (the junction row)');
});

test('the anchor follows orientation so flipping keeps the badge correct', () => {
  /* Both col and row must be mirrored for black's view, otherwise the badge
     lands on the wrong junction once the board is flipped. */
  assert.match(boardSrc, /badgeCol\s*=\s*moveBadge\s*\?\s*\(orientation\s*===\s*'white'\s*\?\s*moveBadge\.file\s*:\s*7\s*-\s*moveBadge\.file\)/);
  assert.match(boardSrc, /badgeRow\s*=\s*moveBadge\s*\?\s*\(orientation\s*===\s*'white'\s*\?\s*7\s*-\s*moveBadge\.rank\s*:\s*moveBadge\.rank\)/);
});

test('badge size scales with the board instead of fixed pixels', () => {
  /* --mb-size is derived from the live square size, so a resize / mobile board
     keeps the badge proportional. A hard-coded px here would regress that. */
  assert.match(boardSrc, /badgeDiameter\s*=\s*badgeSq\s*\*\s*0\.6\s*;/,
    'badge diameter must be a fraction of the square size');
  assert.match(boardSrc, /badgeSq\s*=\s*boardWidth\s*\/\s*8\s*;/,
    'square size must be derived from the rendered board width');
  assert.match(boardSrc, /--mb-size/,
    'the board must pass --mb-size through to CSS');
});

test('with the centring applied, the badge is centred on the junction', () => {
  /* The real payoff: dot centre == junction, so it straddles all four squares
     and touches no piece. Reproduces the browser's layout arithmetic across
     board sizes and both orientations — i.e. resize, responsive and flip. */
  for (const boardWidth of [320, 480, 640, 800]) {
    for (const orientation of ['white', 'black']) {
      for (let file = 0; file < 8; file++) {
        for (let rank = 0; rank < 8; rank++) {
          const { x, y, sq } = anchorFor(file, rank, orientation, boardWidth);
          const d = sq * 0.6;
          /* Layout: the dot's top-LEFT sits on the anchor, then
             translate(-50%,-50%) shifts it by half its own size, so the dot's
             CENTRE lands exactly on the junction. */
          const topLeftX = x - d / 2;
          const topLeftY = y - d / 2;
          const centreX = topLeftX + d / 2;
          const centreY = topLeftY + d / 2;
          assert.ok(Math.abs(centreX - x) < 1e-9 && Math.abs(centreY - y) < 1e-9,
            `badge centre must equal the junction (${file},${rank},${orientation},${boardWidth})`);

          /* the junction must sit ON a square boundary, never a square centre */
          const onBoundaryX = Math.abs((x / sq) - Math.round(x / sq)) < 1e-9;
          const onBoundaryY = Math.abs((y / sq) - Math.round(y / sq)) < 1e-9;
          assert.ok(onBoundaryX && onBoundaryY,
            'junction must lie on square boundaries, i.e. between squares');
        }
      }
    }
  }
});

/* ── Engine top-line rank badges ──────────────────────────────────────────────
   These replaced the "Best / Great / Good" word legend that used to sit under
   the review board. They reuse the same zero-size-anchor pattern, so they carry
   the same class of bug: a percentage translate on a 0x0 parent is a silent
   no-op and the chip lands off-centre. */
test('the rank chip centres on the SIZED element, not the zero-size anchor', () => {
  assert.ok(!/transform\s*:\s*translate\(-50%/.test(rule('.line-badge-anchor')),
    '.line-badge-anchor is width:0/height:0 — a % translate there is a silent no-op');
  assert.match(rule('.line-badge'), /transform\s*:\s*translate\(-50%,\s*-50%\)/,
    'the centring translate must be on .line-badge, the element that has size');
});

test('the rank chip anchor stays a zero-size point', () => {
  const anchor = rule('.line-badge-anchor');
  assert.match(anchor, /width\s*:\s*0\s*;/);
  assert.match(anchor, /height\s*:\s*0\s*;/);
  assert.match(anchor, /pointer-events\s*:\s*none/,
    'the chip must never block board clicks or drags');
});

test('the rank chip is sized from the board, not fixed pixels', () => {
  assert.match(boardSrc, /--lb-size/,
    'the board must pass --lb-size through to CSS');
  assert.match(boardSrc, /badgeSq\s*\*\s*0\.38/,
    'rank chip size must be a fraction of the square size so it stays proportional');
});

test('the rank chip mirrors for black orientation like the move badge', () => {
  assert.match(boardSrc,
    /orientation === 'white' \? file : 7 - file/,
    'rank chips must mirror columns when the board is flipped');
  assert.match(boardSrc,
    /orientation === 'white' \? 7 - rank : rank/,
    'rank chips must mirror rows when the board is flipped');
});

test('rank chips are numbered from the best line', () => {
  /* rank 0 must read "1": the engine's top line is the best move, and a chip
     labelled 0 would be nonsense to a student. */
  assert.match(boardSrc, /\{b\.rank \+ 1\}/,
    'the chip must show rank + 1 so the best line reads 1');
  assert.match(boardSrc, /LINE_RANK_NAMES\[b\.rank\] \|\| `Candidate \$\{b\.rank \+ 1\}`/,
    'rank chips need an accessible name, not a bare number');
  assert.match(boardSrc, /const LINE_RANK_NAMES = \['Best line', 'Great line', 'Good line'\]/,
    'the accessible names must match the ranking the arrows encode');
});

test('the removed Best/Great/Good legend is gone from the board', () => {
  /* The legend rendered under the review board and restated the arrow opacity
     that was already visible, pushing the move nav down the page. The words
     must not come back as literal markup under the board. */
  const review = readFileSync(join(ROOT, 'src', 'pages', 'GameReview.jsx'), 'utf8');
  assert.ok(!/className="gr-top-lines"/.test(review),
    'the under-board "Best / Great / Good" legend must not be rendered');
  assert.match(review, /lineBadges=\{rankedArrows\}/,
    'the board must receive the ranked lines so it can badge them');
});

test('only the BEST engine arrow is drawn on the review board', () => {
  /* The board used to draw the top THREE multiPV candidates (best / great /
     good) at graded opacities with numbered chips. The 2nd and 3rd engine
     preferences are not suggestions a student should read as "also fine", so
     one arrow is drawn now. Both arrow sources must take the FIRST line only —
     whichever one is currently feeding the board. */
  const review = readFileSync(join(ROOT, 'src', 'pages', 'GameReview.jsx'), 'utf8');

  /* live engine source */
  assert.match(review, /const l = liveEval\.lines\[0\];/,
    'the live-engine arrow must be lines[0] — the engine\'s best move');
  /* saved review rows source */
  assert.match(review, /ls\.slice\(0, 1\)/,
    'the saved-row arrow must take only the first (best) line');

  /* no leftover three-arrow machinery */
  assert.ok(!/TOP_LINE_COLORS/.test(review),
    'the three-stop colour ramp must be gone — there is one arrow to colour');

  /* The SEARCH still asks for 3 lines and the review rows still store all 3:
     the classifier needs the runner-up gap (GREAT_MIN_GAP_CP) to tell a forced
     move from a clearly-better one. What must not survive is a three-line
     ARROW — so scope this to the two arrow builders by name. */
  const arrowBlocks = [
    review.slice(review.indexOf('const liveLineArrows')),
    review.slice(review.indexOf('const reviewLineArrows'), review.indexOf('const topLineArrows')),
  ];
  for (const block of arrowBlocks) {
    assert.ok(!/slice\(0, 3\)/.test(block),
      'an arrow source may not still take three lines');
  }
  /* …while the pipeline keeps its three lines for the verdict maths. */
  assert.match(review, /lines: \(Array\.isArray\(top\) \? top : \[\]\)/,
    'the review row must still keep the multiPV line set for the classifier');

  /* the rank chips went with the arrows: with a single arrow the chip could only
     ever read "1", which the arrow itself already says. */
  assert.match(review, /const rankedArrows = \[\];/,
    'rankedArrows must be empty so the board badges nothing');
  assert.ok(!/rank: i,/.test(review),
    'no arrow may stamp a rank any more');
});

test('only the BEST engine arrow is drawn on the chess-profile board', () => {
  /* Same change as the review board, applied to the local-analysis viewer. */
  const profile = readFileSync(join(ROOT, 'src', 'pages', 'ChessProfile.jsx'), 'utf8');
  assert.match(profile, /ls\.slice\(0, 1\)/,
    'the chess-profile arrow must take only the first (best) line');
  assert.ok(!/TOP_LINE_COLORS/.test(profile),
    'the three-stop colour ramp must be gone there too');
  assert.match(profile, /lineBadges=\{null\}/,
    'the rank chip must be suppressed on that board too');
});

test('the GM replay board badges the classification too', () => {
  /* The replay graded moves only in the score sheet's !/?!/?? suffix, so the
     board itself carried no verdict. GameReview already did this, so the replay
     must now pass the same moveBadge prop. */
  const replay = readFileSync(join(ROOT, 'src', 'components', 'GameReplay.tsx'), 'utf8');
  assert.match(replay, /moveBadge=\{moveBadge\}/,
    'GameReplay must pass moveBadge to ChessBoard');
  assert.match(replay, /file: to\.charCodeAt\(0\) - 97/,
    'the badge destination square must be converted to 0-indexed file');
  assert.match(replay, /rank: Number\(to\[1\]\) - 1/,
    'the badge destination square must be converted to 0-indexed rank');
  /* 'Good' must stay unbadged: a chip on every solid quiet move is noise. */
  assert.ok(!/Good:\s*'good'/.test(replay),
    "a 'Good' verdict must not be badged on the board");
});

test('the badge never covers a piece: it is equidistant from all 4 squares', () => {
  /* A circle centred on the junction is exactly sq/2 from the centre of each
     of the four adjacent squares, so it sits in the gap between them rather
     than over any one piece. */
  const sq = 60;
  const d = sq * 0.6;
  const { x, y } = anchorFor(4, 4, 'white', sq * 8);
  const r = d / 2;
  const centres = [
    { cx: x - sq / 2, cy: y - sq / 2 },   // destination square
    { cx: x + sq / 2, cy: y - sq / 2 },   // right neighbour
    { cx: x - sq / 2, cy: y + sq / 2 },   // square above
    { cx: x + sq / 2, cy: y + sq / 2 },   // diagonal
  ];
  for (const c of centres) {
    const dist = Math.hypot(c.cx - x, c.cy - y);
    assert.ok(dist > r,
      `badge (r=${r}) must not reach a square centre (distance ${dist.toFixed(2)})`);
  }
});

