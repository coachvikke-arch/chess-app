import { readFileSync, writeFileSync } from 'node:fs';

const path = 'c:\\Users\\MANIVEL M\\Downloads\\Files\\chess-academy\\frontend\\scripts\\eval-bar.test.mjs';
let content = readFileSync(path, 'utf8');

// 1. Replace 'GameReview drives both fills and the marker' test
const old1 = `test('GameReview drives both fills and the marker from that one split', () => {
  assert.match(REVIEW, /height: \`\${barPct}%\`/);
  assert.match(REVIEW, /height: \`\${100 - barPct}%\`/);
  assert.match(REVIEW, /bottom: \`calc(\${barPct}% - 1px)\`/);
  assert.ok(!/height:\s*'50%'/.test(REVIEW), 'no hard-coded 50/50 split');
  /* orientation only flips which side is on top — 0.00 stays centred either way */
  assert.match(REVIEW, /orientation === 'black' \? 100 - whitePct : whitePct/);
});`;

const new1 = `test('GameReview drives both fills and the marker from that one split', () => {
  /* CanonicalEvalBar computes the split internally from cp/mate/orientation;
     the page just passes those props through. */
  assert.match(REVIEW, /<CanonicalEvalBar cp=\{evalCp\} mate=\{evalMate\} orientation=\{orientation\} height=\{boardW\} \/>/);
  assert.ok(!/height:\s*'50%'/.test(REVIEW), 'no hard-coded 50/50 split');
});`;

if (content.includes(old1)) {
  content = content.replace(old1, new1);
  console.log('Replacement 1 done');
} else {
  console.log('Pattern 1 NOT found');
}

// 2. Replace 'the GM replay bar moves its fill AND its divider' test
const old2 = `test('the GM replay bar moves its fill AND its divider with the current ply', () => {
  assert.match(REPLAY, /evalBarPercent\(shownEval/);
  assert.match(REPLAY, /height: \`\${whiteShare}%\`/);
  assert.match(REPLAY, /gm-evalbar-mid" style=\{\{ top: \`\${dividerTop}%\` \}\}/);
  assert.ok(!/50 \+ 50 \* Math\.tanh/.test(REPLAY), 'the inline mapping moved into the helper');
  /* the graph keeps sharing the bar's scale, so curve and bar agree */
  assert.match(REPLAY, /GRAPH_SCALE_CP = EVAL_BAR_SCALE_CP/);
});`;

const new2 = `test('the GM replay bar moves its fill AND its divider with the current ply', () => {
  /* CanonicalEvalBar computes the split internally from cp/mate/orientation;
     the page just passes those props through. */
  assert.match(REPLAY, /<CanonicalEvalBar cp=\{shownEval\} mate=\{currentAnalysis\?\.mateAfter \?\? null\} orientation=\{orientation\} height=\{boardWidth\}/);
  assert.ok(!/50 \+ 50 \* Math\.tanh/.test(REPLAY), 'the inline mapping moved into the helper');
  /* the graph keeps sharing the bar's scale, so curve and bar agree */
  assert.match(REPLAY, /GRAPH_SCALE_CP = EVAL_BAR_SCALE_CP/);
});`;

if (content.includes(old2)) {
  content = content.replace(old2, new2);
  console.log('Replacement 2 done');
} else {
  console.log('Pattern 2 NOT found');
}

writeFileSync(path, content);
console.log('Done');