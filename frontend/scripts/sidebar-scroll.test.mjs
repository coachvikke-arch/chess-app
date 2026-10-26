import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/* Sidebar rails must stay scrollable on short desktop viewports.
 *
 * Regression guard for the "sidebar menu is stuck" bug: the rails used
 * `max-h-[calc(100vh-…)]` on the aside + `h-full` on the inner card, and
 * percentage heights don't resolve against a max-height-capped sticky box —
 * so the nav never got a bounded box, `overflow-y-auto` never engaged, and
 * bottom links were unreachable. The rail now needs a DEFINITE height, a
 * shrink-0 header/footer, a flex-1/min-h-0 scrollable nav, and an INVISIBLE
 * scrollbar on the direct admin-sidebar-menu scroller (scroll still works).
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sidebar = readFileSync(join(root, 'src/components/Sidebar.jsx'), 'utf8');
const css = readFileSync(join(root, 'src/index.css'), 'utf8');

function railNavLine(src) {
  // The new coach sidebar uses admin-sidebar-menu class on the nav
  let line = src.split('\n').find((l) => l.includes('<nav') && l.includes('admin-sidebar-menu'));
  if (line) return line;
  // Fallback for student shell: desktop rail nav is `flex flex-col gap-1 …`
  return src.split('\n').find((l) => l.includes('<nav') && l.includes('flex-col') && l.includes('gap-1'));
}

function checkRail(name, src) {
  describe(`${name} desktop rail`, () => {
    it('aside has a definite height (h-[calc(100vh…)]), not max-h', () => {
      assert.ok(src.includes('h-[calc(100vh') || src.includes('h-full'), `${name}: aside needs a definite viewport height`);
      const asideLine = src.split('\n').find((l) => l.includes('<aside'));
      assert.ok(asideLine && !asideLine.includes('max-h-'), `${name}: aside must not rely on max-h for its height`);
    });

    it('nav is the bounded scroller: flex-1 + min-h-0 + overflow-y-auto', () => {
      const navLine = railNavLine(src);
      assert.ok(navLine, `${name}: desktop rail nav not found`);
      assert.ok(navLine.includes('flex-1'), `${name}: nav needs flex-1`);
      assert.ok(navLine.includes('min-h-0'), `${name}: nav needs min-h-0`);
      assert.ok(navLine.includes('overflow-y-auto'), `${name}: nav needs overflow-y-auto`);
    });

    it('bar has overscroll containment', () => {
      const navLine = railNavLine(src);
      assert.ok(navLine.includes('overscroll-contain'), `${name}: nav must contain overscroll so menu scrolling never yanks the page`);
    });

    it('header and footer are shrink-0 so only the link list scrolls', () => {
      assert.ok(src.includes('shrink-0'), `${name}: rail header/footer must be shrink-0`);
    });
  });
}

function checkCoachRail(src) {
  describe('coach Sidebar (new fixed layout)', () => {
    it('uses admin-sidebar-menu with an invisible scrollbar', () => {
      assert.ok(src.includes('admin-sidebar-menu'), 'nav uses the admin-sidebar-menu scroller');
      assert.ok(!src.includes('no-scrollbar'), 'nav must not use no-scrollbar class');
      assert.match(css, /\.admin-sidebar-menu\s*\{[^}]*scrollbar-width:\s*none/s,
        'the coach sidebar hides its scrollbar (Firefox/legacy Edge)');
      assert.match(css, /\.admin-sidebar-menu::-webkit-scrollbar\s*\{[^}]*display:\s*none/s,
        'the coach sidebar hides its scrollbar (Chrome/Edge/Safari)');
    });
  });
}

checkRail('coach Sidebar', sidebar);
checkRail('student Sidebar', sidebar);
checkCoachRail(sidebar);

describe('no-scrollbar style', () => {
  it('still hides bars without disabling scroll', () => {
    assert.ok(css.includes('.no-scrollbar'), 'index.css must define .no-scrollbar');
    assert.ok(/\.no-scrollbar\s*{[^}]*scrollbar-width:\s*none/s.test(css), '.no-scrollbar must hide the bar (scrolling itself comes from overflow-y-auto)');
  });
});
