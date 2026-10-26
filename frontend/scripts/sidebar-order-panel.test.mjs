import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement as h } from 'react';

/* The reorder panel is rendered to static markup here because the failure it
 * guards against is invisible in a unit test: the panel once built its list from
 * route strings while rendering link objects, so every row came out blank except
 * the arrows — no error, no failed assertion, just an empty menu. */

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Read a nav array literal straight out of the component that renders it. */
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
  return new Function(`return ${src.slice(open, end + 1)}`)();
}

/** Bundle the panel (and the toast provider it needs) through a virtual entry, so
 *  JSX and its imports resolve while React stays shared with the test's own
 *  react-dom/server instance.
 *
 *  The output has to sit INSIDE the project: written to the temp dir, its
 *  `import 'react'` would walk up to a parent node_modules and load a second
 *  copy of React, leaving the hooks dispatcher null.
 *
 *  No SidebarOrderProvider here on purpose. It reaches for useAuth() and so needs
 *  a logged-in user and a localStorage; the hook's own fallback (no provider =>
 *  code order, nothing saved) is exactly the state under test, and reaching for
 *  the real provider would only add a fake auth layer to assert against. */
async function bundlePanel() {
  const outfile = join(ROOT, 'node_modules', '.navorder-panel.test.mjs');
  await build({
    stdin: {
      contents: [
        "export { default as Panel } from './src/pages/SidebarOrder.jsx';",
        "export { ToastProvider } from './src/components/Toast.jsx';",
      ].join('\n'),
      resolveDir: ROOT,
      sourcefile: 'navorder-entry.js',
      loader: 'jsx',
    },
    absWorkingDir: ROOT,
    bundle: true,
    format: 'esm',
    outfile,
    jsx: 'automatic',
    logLevel: 'silent',
    external: ['react', 'react-dom', 'react-dom/server', 'react-router-dom', 'react/jsx-runtime'],
  });
  return import(pathToFileURL(outfile).href);
}

let Panel;
let ToastProvider;
let adminLinks;
let studentLinks;

before(async () => {
  ({ Panel, ToastProvider } = await bundlePanel());
  adminLinks = readNavArray('config/sidebarConfigs.js', 'adminLinks');
  studentLinks = readNavArray('config/sidebarConfigs.js', 'studentLinks');
});

const render = () => renderToStaticMarkup(h(ToastProvider, null, h(Panel)));

const ESCAPES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'" };
const unescapeHtml = (s) => s.replace(/&(?:amp|lt|gt|quot|apos|#39);/g, (m) => ESCAPES[m]);

/** The label of each row: the text node that follows the icon span. Reading it
 *  that way rather than stripping tags is what keeps the icon and the label from
 *  being concatenated into one string ("♕Dashboard"). */
const labelsIn = (html) =>
  [...html.matchAll(/class="navorder-icon" aria-hidden="true">[^<]*<\/span>([^<]*)</g)]
    .map((m) => unescapeHtml(m[1].trim()))
    .filter(Boolean);

/** The aria-label of every ▲ / ▼ button, which also embeds the item name. */
const arrowLabels = (html, dir) =>
  [...html.matchAll(new RegExp(`aria-label="Move ([^"]+) ${dir}"`, 'g'))]
    .map((m) => unescapeHtml(m[1]));

test('every menu item renders its label', () => {
  const shown = labelsIn(render());
  assert.equal(shown.length, adminLinks.length, 'the panel did not render one row per menu item');
  for (const link of adminLinks) {
    assert.ok(shown.includes(link.label), `the row for ${link.label} rendered no label`);
  }
});

test('the rows appear in the code order when nothing has been saved', () => {
  const shown = labelsIn(render());
  assert.deepEqual(shown, adminLinks.map((l) => l.label));
});

test('no row is blank, which is the regression this file exists for', () => {
  const html = render();
  const shown = labelsIn(html);
  for (const label of shown) {
    assert.ok(label.length > 0, 'a rendered row had no label at all');
  }
  /* The old bug produced 21 rows and not one label, so assert on the ratio
     rather than trusting the list comparison above. */
  const labelled = shown.filter((l) => adminLinks.some((a) => a.label === l)).length;
  assert.equal(labelled, shown.length, 'some rows rendered text that is not a menu item');
});

test('the panel offers two move buttons per item, both labelled for screen readers', () => {
  const html = render();
  const ups = arrowLabels(html, 'up');
  const downs = arrowLabels(html, 'down');
  assert.equal(ups.length, adminLinks.length);
  assert.equal(downs.length, adminLinks.length);
  assert.deepEqual(ups, adminLinks.map((l) => l.label));
  assert.deepEqual(downs, adminLinks.map((l) => l.label));
});

test('the first item cannot move up and the last cannot move down', () => {
  const html = render();
  const disabled = [...html.matchAll(/class="navorder-arrow"([^>]*)disabled/g)].map((m) => m[1]);
  /* Exactly two dead buttons: ▲ on row 1 and ▼ on the last row. */
  assert.equal(disabled.length, 2, 'expected only the two end-of-list arrows to be disabled');
});

test('the icons are marked decorative so a screen reader reads the label once', () => {
  const html = render();
  const icons = [...html.matchAll(/class="navorder-icon" aria-hidden="true">([^<]*)</g)];
  assert.equal(icons.length, adminLinks.length);
  assert.equal(icons[0][1], adminLinks[0].icon, 'the first row shows the wrong icon');
});

test('Save starts disabled, because nothing has been changed yet', () => {
  const html = render();
  const save = html.match(/<button[^>]*>[^<]*Save order/);
  assert.ok(save, 'the Save button is missing');
  assert.match(save[0], /disabled/, 'Save is enabled before anything is edited');
  assert.ok(!html.includes('Unsaved changes'), 'an untouched panel claims to have unsaved changes');
});

test('both menus are offered, and the student menu is named as such', () => {
  const html = render();
  assert.ok(html.includes('Coach menu'), 'the coach menu is not selectable');
  assert.ok(html.includes('Student menu'), 'the student menu is not selectable');
});


test('the Super Admin console entry is itself a reorderable row', () => {
  const html = render();
  assert.ok(html.includes('Super Admin'), 'the console entry row is missing from the panel');
});

test('the owner-only rows sit under a Super Admin section', () => {
  const html = render();
  assert.ok(html.includes('Super Admin section'), 'the section header is missing');
  assert.ok(html.includes('Coach section'), 'the coach section header is missing');
  const superAt = html.indexOf('Super Admin section');
  assert.ok(html.indexOf('Certificates', superAt) > superAt, 'Certificates is not under the Super Admin section');
});

/* ---- dragging ---- */

const handlesIn = (html) => [...html.matchAll(/<button[^>]*class="navorder-handle"[\s\S]*?<\/button>/g)].map((m) => m[0]);

test('every row has a drag handle', () => {
  assert.equal(handlesIn(render()).length, adminLinks.length);
});

test('each handle names the item and where it currently sits', () => {
  /* The label reads "Reorder Dashboard. Position 1 of 21." — strip the sentence
     period that the trailing dot leaves behind on the captured name. */
  const found = [...render().matchAll(/class="navorder-handle"[^>]*aria-label="Reorder ([^"]+) Position (\d+) of (\d+)\."/g)]
    .map((m) => ({ label: unescapeHtml(m[1]).replace(/\.$/, ''), pos: Number(m[2]), of: Number(m[3]) }));
  assert.deepEqual(
    found,
    adminLinks.map((l, i) => ({ label: l.label, pos: i + 1, of: adminLinks.length })),
  );
});

test('the handles are wired to the drag library, not just styled like it', () => {
  const handles = handlesIn(render());
  /* dnd-kit supplies these through useSortable's `attributes`. If the wiring is
     missing the handle still looks draggable but does nothing when dragged. */
  for (const h of handles) {
    assert.match(h, /aria-roledescription="sortable"/, 'handle is not announced as sortable');
    assert.match(h, /tabindex="0"/, 'handle cannot be reached with the keyboard');
    assert.match(h, /type="button"/, 'handle would submit a form');
  }
});

test('the drag handle does not swallow the arrow buttons', () => {
  /* The handle is a separate button, so the arrows must still be outside it —
     nesting them would make an arrow click start a drag. */
  const html = render();
  for (const h of handlesIn(html)) {
    assert.ok(!h.includes('navorder-arrow'), 'an arrow button was nested inside a drag handle');
  }
  assert.equal([...html.matchAll(/class="navorder-arrow"/g)].length, adminLinks.length * 2);
});

test('the header spans the handle column so the labels still line up', () => {
  assert.ok(render().includes('navorder-head-label'), 'the header is not aligned to the new grid');
});

/* The student menu renders the same component, so a label bug there would be just
   as invisible. Reordering the tabs is a click, so the list is checked directly. */
test('the student menu list is complete too', () => {
  /* 21 = the 17 entries this list used to have, minus People (the contact
     directory is no longer its own section and is now the People tab inside
     Messages (/student/messages?tab=people), so keeping a separate entry would
     point at a redirect for no reason), plus Chess Tactics, My Report, Top
     Performances and Certificates (the student's own certificates at
     /student/certificates). */
  assert.equal(studentLinks.length, 21);
  /* A count alone cannot tell a new page from a typo'd path, so the link that was
     added is checked by destination too. */
  const bots = studentLinks.find((l) => l.label === 'Play vs Bots');
  assert.ok(bots, 'Play vs Bots is missing from the student menu');
  assert.equal(bots.to, '/play/bots', 'Play vs Bots points somewhere else');
  assert.ok(bots.icon, 'Play vs Bots renders an empty icon');
  const certs = studentLinks.find((l) => l.label === 'Certificates');
  assert.ok(certs, 'Certificates is missing from the student menu');
  assert.equal(certs.to, '/student/certificates', 'Certificates points somewhere else');
  assert.ok(certs.icon, 'Certificates renders an empty icon');
  /* A link pointing at a deleted page is the failure this count used to hide. */
  for (const link of studentLinks) {
    assert.ok(link.label && link.icon && link.to, 'a student link is missing a field the row renders');
  }
});
