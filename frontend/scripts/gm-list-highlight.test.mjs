// Regression tests for the GM Games list "active game" highlight —
//   run with: node --test scripts/gm-list-highlight.test.mjs   (from frontend/)
//
// The "N key moments" count in the game list must turn green for the game
// currently open in the replay interface, so the active game is obvious at a
// glance. Previously the ONLY cue that a card was selected was its border, and
// the meta line (event · result · N key moments · player) was a single <small>
// with no hook to colour one part of it independently.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(ROOT, 'src', 'index.css'), 'utf8');
const page = readFileSync(join(ROOT, 'src', 'pages', 'AdminGmGames.jsx'), 'utf8');

const rulesFor = (re) => {
  const out = [];
  const rx = new RegExp(re.source ?? re, 'g');
  let m;
  while ((m = rx.exec(css)) !== null) out.push(m[1]);
  return out;
};
/* literal selector text -> matcher */
const selRule = (text) =>
  rulesFor(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}');

test('the key-moment count has its own element to target', () => {
  /* It used to be interpolated straight into <small>, so nothing could colour
     it without also recolouring the event/result/player text. */
  assert.match(page, /className="gm-key-moments"/,
    'the count must be wrapped in its own element');
  assert.match(page, /\{\(game\.annotations \|\| \[\]\)\.length\} key moments/,
    'the count must still read "N key moments"');
  /* the surrounding meta text must remain intact */
  assert.match(page, /\{game\.event\} · \{game\.result\}/);
});

test('the count turns green only on the SELECTED (open) game', () => {
  const selected = selRule('.gm-admin-games-page .gm-game-list-card.selected .gm-key-moments');
  assert.ok(selected.length >= 1, 'a .selected .gm-key-moments rule must exist');
  const body = selected.join(' ');
  assert.match(body, /color\s*:\s*#15803d/i,
    'the selected game\'s count must be green');
  assert.match(body, /font-weight\s*:\s*700/,
    'the selected count should also be bolded so it reads as active');

  /* And there must be NO unscoped rule that greens every row. Match only a rule
     whose selector ENDS at .gm-key-moments (not one that merely contains it as
     part of a longer, .selected-scoped selector). */
  const unscoped = rulesFor(/(?:^|[};])\s*\.gm-key-moments\s*\{([^}]*)\}/);
  const greening = unscoped.filter((r) => /color\s*:/.test(r));
  assert.equal(greening.length, 0,
    'unselected games must keep the muted meta colour, not be green');
});

test('the green beats the page theme colour on the meta line', () => {
  /* The theme paints `.gm-admin-games-page .gm-game-list-card small` with
     `!important`. An !important on the PARENT cannot override a colour set
     directly on the CHILD, so the span is safe — but the selected rule must
     still be at least as specific as the theme's (0,2,1), which (0,3,0) is,
     and must be declared after it. Assert both, since a future reorder or a
     weakened selector would silently repaint the count back to grey. */
  const themeIdx = css.indexOf('.gm-admin-games-page .gm-game-list-card small');
  const selIdx = css.indexOf('.gm-admin-games-page .gm-game-list-card.selected .gm-key-moments');
  assert.notEqual(themeIdx, -1, 'the theme rule should still exist');
  assert.notEqual(selIdx, -1, 'the selected rule should exist');
  assert.ok(selIdx > themeIdx,
    'the selected rule must come after the theme rule so it wins on order too');
  assert.match(
    css.slice(selIdx, css.indexOf('}', selIdx)),
    /\.gm-game-list-card\.selected \.gm-key-moments/,
    'the selector must include .selected for extra specificity',
  );
});

test('the card still marks the active game with .selected', () => {
  assert.match(page, /lastViewed === game\.id \? 'selected' : ''/,
    'the card must toggle .selected for the last-watched game');
});

test('the highlight is driven by lastViewed, NOT by the modal-open state', () => {
  /* THE BUG THIS GUARDS. `selected` doubles as "which game is open in the
     replay modal" AND used to drive `.selected` on the card. That made the
     green highlight impossible to ever see:
       click card  -> `selected` set AND the modal opens; the modal overlay
                      COVERS the list, so the green is hidden
       close modal -> setSelected(null) -> the green switches off again
     The card must therefore key off a separate `lastViewed` state that is not
     cleared when the viewer closes. */
  assert.match(page, /const \[lastViewed, setLastViewed\] = useState/,
    'a separate lastViewed state must exist');
  assert.ok(!/selected === game\.id \? 'selected'/.test(page),
    "the card must NOT key .selected off `selected` (the modal-open state)");
  assert.match(page, /onClick=\{\(\) => \{ setSelected\(game\.id\); setLastViewed\(game\.id\); \}\}/,
    'opening a game must record it as last-viewed as well as open it');
});

test('closing the viewer must NOT clear the highlight', () => {
  /* If a close handler reset lastViewed, the whole feature is dead again. */
  const closes = [...page.matchAll(/setSelected\(null\)/g)];
  assert.ok(closes.length >= 2, 'the overlay and the ✕ both close the viewer');
  const cardBlock = page.slice(0, page.indexOf('const gameCard'));
  assert.ok(!/setLastViewed\(null\)/.test(cardBlock),
    'lastViewed must not be cleared by a close/viewer action');
});

test('the highlight is cleared when its game is deleted', () => {
  /* Otherwise a removed game stays marked. */
  const fn = page.slice(page.indexOf('const runPlayerRemove'));
  assert.match(fn, /setLastViewed\(/,
    'removing a pack must clear the highlight if it pointed into that pack');
  assert.match(page.slice(page.indexOf('const removeGame')), /setLastViewed\(/,
    'deleting a single game must clear the highlight for that game');
});
