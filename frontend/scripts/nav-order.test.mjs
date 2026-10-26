import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { transform } from 'esbuild';

/* The nav-order sort is the one piece of this feature that can go quietly wrong:
   a bad merge shows up as "the sidebar is in a slightly odd order" rather than an
   error, so it is pinned down here rather than left to a manual glance. */

const SRC = new URL('../src/utils/navOrder.js', import.meta.url);

let mod;
test.before(async () => {
  const source = await readFile(SRC, 'utf8');
  const { code } = await transform(source, { loader: 'js', format: 'esm' });
  const file = join(mkdtempSync(join(tmpdir(), 'nav-order-')), 'navOrder.mjs');
  writeFileSync(file, code);
  mod = await import(pathToFileURL(file).href);
});

const links = (...tos) => tos.map((to) => ({ to }));
const keys = (list) => list.map((l) => l.to);

/* ── the baseline: no saved order means the code order is untouched ── */
test('with no stored order the code order is returned unchanged', () => {
  const list = links('/a', '/b', '/c');
  assert.deepEqual(keys(mod.applyNavOrder(list, {})), ['/a', '/b', '/c']);
  assert.deepEqual(keys(mod.applyNavOrder(list, undefined)), ['/a', '/b', '/c']);
  assert.deepEqual(keys(mod.applyNavOrder(list, null)), ['/a', '/b', '/c']);
});

test('every item is kept, whatever the stored ranks say', () => {
  /* A rank map that mentions only some items, and one that invents a key, must
     not drop anything from the menu. */
  const list = links('/a', '/b', '/c', '/d');
  const out = mod.applyNavOrder(list, { '/d': 0, '/ghost': 1 });
  assert.deepEqual(keys(out).sort(), ['/a', '/b', '/c', '/d']);
  assert.equal(out.length, list.length);
});

test('the stored ranks win over the code order', () => {
  const out = mod.applyNavOrder(links('/a', '/b', '/c'), { '/c': 0, '/a': 1, '/b': 2 });
  assert.deepEqual(keys(out), ['/c', '/a', '/b']);
});

test('a reversed rank map fully reverses the menu', () => {
  const list = links('/a', '/b', '/c', '/d');
  const ranks = { '/a': 3, '/b': 2, '/c': 1, '/d': 0 };
  assert.deepEqual(keys(mod.applyNavOrder(list, ranks)), ['/d', '/c', '/b', '/a']);
});

/* ── the interesting case: an item with no stored rank yet ── */
test('an unranked item slots in beside its code neighbours', () => {
  /* '/x' is a nav item added after the order was saved. It has no rank, so it
     takes the midpoint of its code position and lands next to its neighbours —
     NOT at the bottom of the menu, and without displacing them. */
  const list = links('/a', '/b', '/x', '/c');
  const out = mod.applyNavOrder(list, { '/a': 0, '/b': 1, '/c': 2 });
  assert.deepEqual(keys(out), ['/a', '/b', '/c', '/x']);
});

test('an unranked item never displaces an explicitly ranked neighbour', () => {
  /* '/x' shares its code index with '/c', which the Super Admin put at rank 2.
     The saved decision has to win, so '/x' follows '/c' rather than pushing it
     down a place. */
  const out = mod.applyNavOrder(links('/a', '/x', '/c'), { '/a': 0, '/c': 1 });
  assert.deepEqual(keys(out), ['/a', '/c', '/x']);
});

test('an unranked item does not disturb the ranked ones relative order', () => {
  const out = mod.applyNavOrder(links('/a', '/z', '/b', '/c'), { '/c': 0, '/b': 1, '/a': 2 });
  const k = keys(out);
  assert.deepEqual(k.filter((x) => x !== '/z'), ['/c', '/b', '/a']);
});

test('two unranked items keep their relative code order', () => {
  const out = mod.applyNavOrder(links('/a', '/x', '/y', '/b'), { '/b': 0 });
  assert.deepEqual(keys(out), ['/b', '/a', '/x', '/y']);
});

/* ── hostile input ── */
test('a non-numeric or non-finite rank is ignored, not coerced', () => {
  const list = links('/a', '/b', '/c');
  /* /b and /c are ranked ahead of /a. A string '99' honoured as a number would
     push /a to the very end; ignored, /a falls back to its code position and
     lands between them. A string '0' honoured would tie it with /b and win on
     index, putting it first. Both differ from the ignored answer, so this
     catches a rank table that got coerced instead of validated. */
  for (const bad of ['0', '99', null, undefined, {}, [], true, NaN, Infinity, -Infinity]) {
    const out = mod.applyNavOrder(list, { '/a': bad, '/b': 0, '/c': 1 });
    assert.deepEqual(keys(out), ['/b', '/a', '/c'], `rank ${String(bad)} was not ignored`);
  }
});

test('a negative rank still sorts first', () => {
  const out = mod.applyNavOrder(links('/a', '/b', '/c'), { '/c': -5, '/a': 0, '/b': 1 });
  assert.deepEqual(keys(out), ['/c', '/a', '/b']);
});

test('the input list is never mutated', () => {
  const list = links('/a', '/b', '/c');
  const before = keys(list);
  mod.applyNavOrder(list, { '/c': 0, '/a': 1, '/b': 2 });
  assert.deepEqual(keys(list), before);
});

test('non-array input degrades to an empty list rather than throwing', () => {
  assert.deepEqual(mod.applyNavOrder(null, {}), []);
  assert.deepEqual(mod.applyNavOrder(undefined, {}), []);
  assert.deepEqual(mod.orderKeys(null), []);
});

/* ── the arrows in the reorder panel ── */
test('moveItem shifts an item one place and leaves the rest in order', () => {
  const list = links('/a', '/b', '/c');
  assert.deepEqual(keys(mod.moveItem(list, 2, -1)), ['/a', '/c', '/b'], 'down');
  assert.deepEqual(keys(mod.moveItem(list, 0, 1)), ['/b', '/a', '/c'], 'up');
});

test('moveItem does nothing at either end of the list', () => {
  const list = links('/a', '/b', '/c');
  assert.deepEqual(keys(mod.moveItem(list, 0, -1)), ['/a', '/b', '/c']);
  assert.deepEqual(keys(mod.moveItem(list, 2, 1)), ['/a', '/b', '/c']);
  assert.deepEqual(keys(mod.moveItem(list, 9, 1)), ['/a', '/b', '/c'], 'out of range');
  assert.deepEqual(keys(mod.moveItem(list, -1, -1)), ['/a', '/b', '/c'], 'out of range');
});

test('moveItem does not mutate the list it was given', () => {
  const list = links('/a', '/b', '/c');
  mod.moveItem(list, 0, 1);
  assert.deepEqual(keys(list), ['/a', '/b', '/c']);
});

/* ── the round trip that actually matters: arrows -> save -> re-render ── */
test('a sequence built with moveItem survives a save and reload unchanged', () => {
  const list = links('/a', '/b', '/c', '/d');
  /* Reorder by hand the way the panel does, then persist the way it does. */
  let draft = list;
  draft = mod.moveItem(draft, 3, -1); // /d up
  draft = mod.moveItem(draft, 0, 1);  // /a down
  const saved = mod.orderKeys(draft);

  /* Rebuild the ranks the server would store: position -> rank. */
  const ranks = Object.fromEntries(saved.map((k, i) => [k, i]));
  const reloaded = mod.applyNavOrder(list, ranks);
  assert.deepEqual(keys(reloaded), saved, 'the order did not survive the round trip');
});

test('applying a saved order twice is stable', () => {
  const list = links('/a', '/b', '/c', '/d', '/e');
  const ranks = { '/e': 0, '/c': 1, '/a': 2, '/d': 3, '/b': 4 };
  const once = mod.applyNavOrder(list, ranks);
  const twice = mod.applyNavOrder(once, ranks);
  assert.deepEqual(keys(twice), keys(once));
});

/* ── the real nav arrays ──
   The route is the key a rank is stored against, so two links sharing a route in
   one menu would make the saved order ambiguous. Both lists are read straight out
   of the components that render them, so this fails as soon as one is copied. */
function readNavArray(file, name) {
  const src = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
  const start = src.indexOf(`export const ${name} = [`);
  assert.ok(start >= 0, `${name} not found in ${file}`);
  const open = src.indexOf('[', start);
  let depth = 0;
  let end = open;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '[') depth += 1;
    else if (src[i] === ']') {
      depth -= 1;
      if (depth === 0) { end = i; break; }
    }
  }
  /* Plain data plus comments, so it is safe to evaluate directly. */
  return new Function(`return ${src.slice(open, end + 1)}`)();
}

test('every route in the real admin menu is unique', () => {
  const list = readNavArray('config/sidebarConfigs.js', 'adminLinks');
  assert.ok(list.length > 15, 'the admin menu should not have shrunk to nothing');
  const seen = new Set();
  for (const link of list) {
    assert.ok(!seen.has(link.to), `duplicate route in the admin menu: ${link.to}`);
    seen.add(link.to);
  }
});

test('every route in the real student menu is unique', () => {
  const list = readNavArray('config/sidebarConfigs.js', 'studentLinks');
  assert.ok(list.length > 10, 'the student menu should not have shrunk to nothing');
  const seen = new Set();
  for (const link of list) {
    assert.ok(!seen.has(link.to), `duplicate route in the student menu: ${link.to}`);
    seen.add(link.to);
  }
});

test('the real admin menu reorders without losing or duplicating a link', () => {
  const list = readNavArray('config/sidebarConfigs.js', 'adminLinks');
  const original = keys(list);
  const reversed = [...original].reverse();
  const ranks = Object.fromEntries(reversed.map((k, i) => [k, i]));

  const out = keys(mod.applyNavOrder(list, ranks));
  assert.deepEqual(out, reversed, 'the real menu did not follow the saved order');
  assert.equal(out.length, original.length, 'an item went missing');
  assert.equal(new Set(out).size, original.length, 'an item was duplicated');
});

test('/openings appears in both menus and is ordered independently in each', () => {
  /* The one route the two menus genuinely share, which is why the rank table is
     keyed by menu as well as by route. */
  const admin = readNavArray('config/sidebarConfigs.js', 'adminLinks');
  const student = readNavArray('config/sidebarConfigs.js', 'studentLinks');
  assert.ok(keys(admin).includes('/openings'), 'the coach menu lost /openings');
  assert.ok(keys(student).includes('/openings'), 'the student menu lost /openings');

  const adminOut = keys(mod.applyNavOrder(admin, { '/openings': 0 }));
  const studentOut = keys(mod.applyNavOrder(student, { '/openings': 5 }));
  assert.equal(adminOut[0], '/openings', 'a coach-menu rank did not apply to the coach menu');
  assert.notEqual(studentOut[0], '/openings', 'the student menu was moved by a coach-menu rank');
});

/* ── dragging: the panel commits a drop, not an index ── */
test('a drop lands the item where the target row was', () => {
  const list = links('/a', '/b', '/c', '/d');
  assert.deepEqual(keys(mod.moveToKey(list, '/a', '/d')), ['/b', '/c', '/d', '/a']);
  assert.deepEqual(keys(mod.moveToKey(list, '/d', '/a')), ['/d', '/a', '/b', '/c']);
});

test('a drop is measured after the dragged item is lifted out', () => {
  /* Dragging the first row onto the second has to leave it SECOND, not first:
     the target row is at index 0, but it is at index 1 once the dragged item is
     removed. Getting this backwards is the classic off-by-one in a drag list. */
  const list = links('/a', '/b', '/c');
  assert.deepEqual(keys(mod.moveToKey(list, '/a', '/b')), ['/b', '/a', '/c']);
  assert.deepEqual(keys(mod.moveToKey(list, '/b', '/c')), ['/a', '/c', '/b']);
});

test('a drop onto the row it came from changes nothing', () => {
  const list = links('/a', '/b', '/c');
  assert.deepEqual(keys(mod.moveToKey(list, '/b', '/b')), ['/a', '/b', '/c']);
});

test('a drop on an unknown row, or of an unknown item, is ignored', () => {
  const list = links('/a', '/b', '/c');
  assert.deepEqual(keys(mod.moveToKey(list, '/a', '/ghost')), ['/a', '/b', '/c']);
  assert.deepEqual(keys(mod.moveToKey(list, '/ghost', '/a')), ['/a', '/b', '/c']);
});

test('a drop never loses or duplicates an item', () => {
  const list = links('/a', '/b', '/c', '/d', '/e');
  for (let from = 0; from < list.length; from += 1) {
    for (let to = 0; to < list.length; to += 1) {
      const out = keys(mod.moveToKey(list, list[from].to, list[to].to));
      assert.equal(out.length, list.length, `drag ${from}->${to} changed the length`);
      assert.deepEqual([...out].sort(), [...keys(list)].sort(), `drag ${from}->${to} changed the items`);
    }
  }
});

test('dragging does not mutate the list it was given', () => {
  const list = links('/a', '/b', '/c');
  mod.moveToKey(list, '/a', '/c');
  assert.deepEqual(keys(list), ['/a', '/b', '/c']);
});

test('a drag always agrees with pressing the arrow the same number of times', () => {
  /* The panel offers both, so a drag onto row j and pressing the arrow |i-j|
     times from row i have to produce the same sequence. moveItem only steps one
     place, so the arrow side has to be applied repeatedly. */
  const list = links('/a', '/b', '/c', '/d', '/e');
  for (let from = 0; from < list.length; from += 1) {
    for (let to = 0; to < list.length; to += 1) {
      const dragged = keys(mod.moveToKey(list, list[from].to, list[to].to));
      let pressed = list;
      const step = to > from ? 1 : -1;
      for (let n = from; n !== to; n += step) pressed = mod.moveItem(pressed, n, step);
      assert.deepEqual(
        dragged,
        keys(pressed),
        `dragging row ${from} onto row ${to} disagreed with ${Math.abs(to - from)} arrow press(es)`,
      );
    }
  }
});
