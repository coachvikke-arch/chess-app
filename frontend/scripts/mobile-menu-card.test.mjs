import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/* The phone menu, on both shells.
 *
 * It was one `max-h` transition: `max-h-0` closed, `max-h-[70vh]` open. Any menu
 * taller than 70vh therefore stopped at 70vh, and because the transition
 * animated the cap itself it looked like the card had only opened halfway before
 * it settled. The edges were flush to the viewport too (`left-0 right-0` with a
 * `border-t`), so there was no card - just a square sheet.
 *
 * Fixed by moving the open/close onto opacity/transform and making the LIST the
 * scroll container inside a rounded, inset card. These assertions pin that
 * arrangement, because a plausible-looking edit (re-adding `max-h-0` to tidy up
 * the animation) brings the exact bug straight back. */

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => readFileSync(join(ROOT, 'src', 'components', p), 'utf8');

const SHELLS = [
  { file: 'StudentAppShell.jsx', id: 'student-nav' },
  { file: 'AdminAppShell.jsx', id: 'admin-nav' },
];

/* The opening className of the wrapper that holds the nav with this id. */
function wrapperClass(source, id) {
  const at = source.indexOf(`id="${id}"`);
  assert.notEqual(at, -1, `found id="${id}"`);
  const open = source.indexOf('className={`', at);
  assert.notEqual(open, -1, 'the wrapper drives its classes from mobileOpen');
  const end = source.indexOf('`}', open);
  return source.slice(open, end);
}

for (const shell of SHELLS) {
  test(`${shell.file}: the phone menu opens to full height instead of animating to a cap`, () => {
    const cls = wrapperClass(read(shell.file), shell.id);

    /* THE regression. `max-h` on the wrapper is what parks the card at the cap. */
    assert.ok(!/max-h-\[/.test(cls), `no max-h cap on the wrapper: ${cls}`);
    assert.ok(!cls.includes('max-h-0'), 'nothing collapses the wrapper when closed');

    /* Closed = faded and shifted, open = present. Never a height animation. */
    assert.match(cls, /opacity-0[^\n]*invisible/, 'closed is invisible');
    assert.match(cls, /opacity-100/, 'open is visible');
    assert.match(cls, /transition-\[opacity,transform,visibility\]/,
      'only opacity/transform/visibility animate');

    /* An invisible overlay must not eat taps meant for the page behind it. */
    assert.match(cls, /pointer-events-none/, 'the closed card takes no pointer events');
  });

  test(`${shell.file}: the menu is an inset, rounded card`, () => {
    const cls = wrapperClass(read(shell.file), shell.id);

    assert.match(cls, /rounded-2xl/, 'rounded edges');
    assert.match(cls, /border\b/, 'a visible border to show the card edge');
    assert.ok(!cls.includes('left-0 right-0'), 'inset from the viewport edges so the corners read');
    assert.match(cls, /left-2 right-2/, 'inset by a small margin');
    assert.ok(!cls.includes('border-t'), 'not a sheet flush to the viewport');
  });
}

test('the list scrolls inside the card, and does not drag the page with it', () => {
  for (const shell of SHELLS) {
    const source = read(shell.file);
    const after = source.slice(source.indexOf(`id="${shell.id}"`));
    /* Start at the `<nav`, not the wrapper: the wrapper's own className contains
       a `>` inside `top-[calc(100%+0.5rem)]`, so slicing to the first `>` from
       the id would read the wrapper and never reach the list. */
    const navStart = after.indexOf('<nav');
    assert.notEqual(navStart, -1, 'the wrapper wraps a <nav>');
    const tag = after.slice(navStart, after.indexOf('>', navStart));

    /* The cap + scroll now belong to the LIST, so a long menu scrolls inside the
       rounded box instead of growing past the screen. */
    assert.match(tag, /overflow-y-auto/, 'the list scrolls');
    assert.match(tag, /max-h-\[min\(70vh,32rem\)\]/, 'capped at a readable height');
    assert.match(tag, /overscroll-contain/,
      'a flick at the end of the list must not scroll the page behind the menu');
  }
});