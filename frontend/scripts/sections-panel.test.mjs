/* The sections rail must survive a section switch.
 *
 * THE BUG THIS LOCKS DOWN
 * `SectionNav` and `SetChip` were each declared INSIDE their page component's
 * render body. A component defined in a render body is a new function identity
 * - and therefore a new component TYPE to React - on every render. React
 * reconciles a changed type by unmounting the old subtree and mounting a fresh
 * one, so the entire rail was destroyed and rebuilt on every click and on every
 * unrelated state change, taking its scroll position with it. The page then
 * re-fetched and re-rendered, which is what the console showed.
 *
 * Source-text assertions rather than a browser test, because the failure is
 * about WHERE a function is declared and WHAT PROPS a component receives -
 * properties of the source, not of a running page. The same approach the rest
 * of this suite uses.
 *
 * Run: node --test scripts/sections-panel.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const report = read('src/pages/StudentReport.jsx');
const puzzles = read('src/pages/PuzzleListing.jsx');
const superAdmin = read('src/pages/SuperAdmin.jsx');

/** Strip block and line comments.
 *
 * Several of these assertions are "this must NOT appear in the file", and the
 * fix is DOCUMENTED next to the code by quoting the old pattern. Without
 * stripping, a comment explaining the fix would satisfy - or break - the very
 * assertion meant to police the code. */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** Index of the definition of `name`, and of the page component that owns it. */
const declaredAt = (src, name) => {
  const m = new RegExp(`^function ${name}\\(`, 'm').exec(src)
    || new RegExp(`^const ${name}\\s*=`, 'm').exec(src);
  return m ? m.index : -1;
};

/* ── StudentReport: the seven-section rail ────────────────────────────────── */

test('SectionNav is declared at module level, not inside StudentReport', () => {
  /* THE regression. If this ever moves back inside the render body the rail
     starts remounting on every render again, and the scroll position goes with
     it. Asserting declaration ORDER is what catches it: module-level code is
     necessarily above the component that renders it. */
  const nav = declaredAt(report, 'SectionNav');
  const page = report.indexOf('export default function StudentReport');
  assert.ok(nav > -1, 'SectionNav must exist');
  assert.ok(page > -1, 'StudentReport must exist');
  assert.ok(nav < page,
    `SectionNav (index ${nav}) must be declared before StudentReport (index ${page}); ` +
    'a component declared in a render body is a new type every render and remounts the rail'
  );
});

test('the rail is rendered without a key, so nothing can force it to remount', () => {
  const usage = report.match(/<SectionNav[^>]*\/>/);
  assert.ok(usage, '<SectionNav /> must be rendered');
  assert.doesNotMatch(usage[0], /\bkey=/,
    'a key on the rail would let a parent force a remount');
});

test('selecting a section only sets the selection - it cannot refetch or navigate', () => {
  /* The handler's whole job. If a fetch or a navigate crept in here, the rail
     would reload on every click again. */
  const handler = report.slice(
    report.indexOf('const selectSection'),
    /* Search forward from the handler, not from the top: `useLayoutEffect`
       first appears in the import on line 1, which would make the slice empty. */
    report.indexOf('useLayoutEffect', report.indexOf('const selectSection'))
  );
  assert.match(handler, /setSection\(key\)/);
  assert.doesNotMatch(handler, /api\.(get|post|put|patch|delete)/, 'the handler must not fetch');
  assert.doesNotMatch(handler, /navigate\(|window\.location|location\.href|reload\(/,
    'the handler must not navigate or reload the page');
});

test('selectSection is stable, so the rail is handed the same function every render', () => {
  assert.match(report, /const selectSection = useCallback\(/,
    'an inline arrow would be a new function each render');
});

test('the rail is not gated behind a loading or conditional branch', () => {
  /* Cause (a): a `loading ? <Spinner/> : <List/>` that a click flips would
     unmount the list. The rail is rendered unconditionally in the layout. */
  const layout = report.slice(
    report.indexOf('<SectionNav')
  );
  assert.ok(layout.includes('min-w-0'), 'the rail sits beside the content pane, not inside it');
  const before = report.slice(
    Math.max(0, report.indexOf('<SectionNav') - 400),
    report.indexOf('<SectionNav')
  );
  assert.doesNotMatch(before, /loading\s*\?|if \(loading\)|\{loading &&/,
    'the rail must not be inside a loading conditional');
});

test('the rail scroll position is saved before a switch and restored after', () => {
  assert.match(report, /sectionNavRef\s*=\s*useRef/,
    'the rail needs a ref to read and write its own scrollTop');
  assert.match(report, /savedRailScroll\.current = sectionNavRef\.current\?\.scrollTop/,
    'scrollTop must be captured in the click handler');
  assert.match(report, /useLayoutEffect/, 'restore before paint, or the jump is visible');
  assert.match(report, /rail\.scrollTop = savedRailScroll\.current/);
});

test('the page scroll is also restored, because content height changes clamp it', () => {
  /* Superseded: the content pane now carries min-h-screen, so the document never
     shrinks and the clamp cannot happen. The scroll-restore hack is deliberately
     gone - if this comes back, the layout fix has been undone. */
  assert.doesNotMatch(code(report), /savedPageScroll/,
    'min-h-screen on the content pane makes a window.scrollTo restore unnecessary');
  assert.doesNotMatch(code(report), /window\.scrollTo\(0, savedPageScroll/);
});

test('the rail is memoised and receives only referentially stable props', () => {
  /* Requirement: content or unrelated state changes must not re-render the list. */
  assert.match(report, /const SectionNav = memo\(function SectionNav\(\{ sections, active, onSelect, navRef \}\)/,
    'the rail must be wrapped in React.memo');
  assert.match(report, /sections=\{SECTIONS\}/, 'the static list is passed as a module constant');
  assert.match(report, /onSelect=\{selectSection\}/);
  /* And the handler those props point at must itself be stable. */
  assert.match(report, /const selectSection = useCallback\(\(key\) => \{[\s\S]*?\}, \[\]\);/);
});

test('the rail is its own sticky scroll container', () => {
  /* So the rail's position is independent of the document, and of whatever the
     content pane does to the page height. */
  assert.match(report, /md:sticky/);
  assert.match(report, /md:max-h-\[calc\(100vh-2rem\)\]/);
  assert.match(report, /md:overflow-y-auto/);
});

test('every visited section stays mounted and inactive ones are hidden, not removed', () => {
  /* Requirement: keep each panel's state, no refetch on returning to a section. */
  assert.match(report, /visitedSections/);
  assert.match(report, /if \(prev\.has\(section\)\) return prev/,
    'an already-visited section must keep Set identity, or the map re-renders');
  assert.match(report, /\[...visitedSections\]\.map\(\(key\) => \(\s*<div key=\{key\} hidden=\{key !== section\}>/,
    'sections are rendered from the visited set and hidden when inactive');
  /* And the body is keyed by the section, so it does not read the selection from
     the closure and swap a single conditional subtree. */
  assert.match(report, /function renderSectionBody\(key\) \{\s*switch \(key\)/);
  assert.doesNotMatch(code(report), /\{renderSection\(\)\}/,
    'the single-conditional render is the thing that destroyed the panels');
});

test('the content pane has a min-height so the document never shrinks', () => {
  assert.match(report, /min-w-0 min-h-screen/,
    'a short section must not let the browser clamp scrollY');
});

test('section items are keyed by the section key, never by index', () => {
  assert.match(report, /sections\.map\(\(\[key, label, glyph\]\) => \(\s*<button\s*key=\{key\}/);
  assert.doesNotMatch(report, /sections\.map\(\([^)]*\bi\b[^)]*\)\s*=>[\s\S]{0,120}key=\{i\}/,
    'an index key would move the highlight when the list reorders');
});

test('the section items are buttons, not links, so there is no navigation', () => {
  /* Cause (g): an <a href> or form submit would reload the document. */
  const rail = report.slice(
    report.indexOf('function SectionNav'),
    report.indexOf('export default function StudentReport')
  );
  assert.doesNotMatch(rail, /<a\s|href=/, 'the rail must not navigate');
  assert.match(rail, /<button[\s\S]*?type="button"/);
});

test('the active highlight is driven only by the selected section', () => {
  assert.match(report, /<SectionNav[\s\S]{0,200}?sections=\{SECTIONS\}[\s\S]{0,120}?active=\{section\}[\s\S]{0,120}?onSelect=\{selectSection\}/);
  assert.match(report, /active === key \? 'bg-gold-500/);
  assert.match(report, /aria-current=\{active === key \? 'page' : undefined\}/);
});

/* ── SuperAdmin: the console section switcher ─────────────────────────────── */

test('the Super Admin switcher is a memoised module-level component', () => {
  const sw = declaredAt(superAdmin, 'SectionSwitcher');
  const page = superAdmin.indexOf('export default function SuperAdmin');
  assert.ok(sw > -1, 'SectionSwitcher must exist');
  assert.ok(sw < page, 'SectionSwitcher must be declared outside the page component');
  assert.match(superAdmin, /const SectionSwitcher = memo\(function SectionSwitcher\(\{ sections, active, onSelect, listRef \}\)/);
  assert.match(superAdmin, /onSelect=\{selectSection\}/);
  assert.match(superAdmin, /const switchSection = useCallback\(\(key\) => setSection\(key\), \[\]\)/);
});

test('Super Admin panels are mounted once and hidden, never swapped by a ternary', () => {
  /* THE bug on this page: `section === 'x' ? <X/> : ...` destroyed the outgoing
     panel and mounted a new one, so every switch refetched all of them and threw
     away SidebarOrder's unsaved draft and dnd-kit session. */
  assert.match(code(superAdmin), /\[...visitedSections\]\.map\(\(key\) => \(\s*\n?\s*<div key=\{key\} hidden=\{key !== section\}>/);
  assert.match(superAdmin, /if \(prev\.has\(section\)\) return prev/);
  assert.doesNotMatch(code(superAdmin), /\{section === 'features' \?/,
    'the four-way ternary must be gone');
  assert.doesNotMatch(code(superAdmin), /: section === 'sidebar' \?/);
  /* The inner branch now keys off the visited section, not the selection. */
  assert.match(code(superAdmin), /key === 'features' \? \(\s*<FeatureAccessPanel \/>/);
  assert.match(code(superAdmin), /key === 'sidebar' \? \(\s*<SidebarOrder \/>/);
});

test('the Super Admin console keeps a tall content area', () => {
  assert.match(superAdmin, /<div className="min-h-screen">/);
});

/* ── PuzzleListing: the set-chip rail (same defect, same class) ────────────── */

test('SetChip is declared at module level, not inside PuzzleListing', () => {
  const chip = declaredAt(puzzles, 'SetChip');
  const page = puzzles.indexOf('export default function PuzzleListing');
  assert.ok(chip > -1, 'SetChip must exist');
  assert.ok(page > -1, 'PuzzleListing must exist');
  assert.ok(chip < page,
    `SetChip (index ${chip}) must be declared before PuzzleListing (index ${page}); ` +
    'declared in a render body it rebuilt every chip on every render'
  );
});

test('the chip rail keeps its horizontal scroll across a set change', () => {
  assert.match(puzzles, /setStripRef\s*=\s*useRef/);
  assert.match(puzzles, /ref=\{setStripRef\}/);
  assert.match(puzzles, /savedStripScroll\.current = setStripRef\.current\?\.scrollLeft/);
  assert.match(puzzles, /el\.scrollLeft = savedStripScroll\.current/);
});

test('chips are keyed by set_code and receive their state as props', () => {
  assert.match(puzzles, /const SetChip = memo\(function SetChip\(\{ set, active, deleting, onSelect, onRename, onDelete \}\)/,
    'the chip must take its state as props, not close over the page');
  assert.match(puzzles, /<SetChip[\s\S]{0,240}?key=\{s\.set_code\}/);
  assert.match(puzzles, /active=\{s\.set_code === setCode && !across\}/);
});

test('the chip callbacks are stable, so the memo actually holds', () => {
  /* useCallback over a ref: the handler identity must survive re-renders, or
   * every chip re-renders anyway and the memo is decoration. */
  for (const fn of ['pickSet', 'renameSet', 'removeSet']) {
    assert.match(puzzles, new RegExp(`const ${fn} = useCallback\\(`),
      `${fn} must be a useCallback or the memoised chips re-render on every pass`);
  }
  assert.match(puzzles, /goRef\.current = go/);
  assert.match(puzzles, /savedStripScroll\.current = setStripRef\.current\?\.scrollLeft/);
});

test('the puzzle grid keeps a min-height so the document cannot shrink', () => {
  assert.match(puzzles, /xl:grid-cols-4 min-h-\[60vh\]/);
});

test('picking a set records the selection and does not reload the page', () => {
  const pick = puzzles.slice(
    puzzles.indexOf('const pickSet'),
    puzzles.indexOf('const renderSetChip')
  );
  assert.match(pick, /savedStripScroll\.current = setStripRef\.current\?\.scrollLeft/);
  assert.match(pick, /goRef\.current\(\{ set: s\.set_code, page: 1 \}\)/);
  assert.doesNotMatch(pick, /window\.location|reload\(|location\.href/,
    'changing a set must never reload the document');
});

/* ── What must NOT have been "fixed" ──────────────────────────────────────── */

/* The full-page `key={location.pathname}` in App.jsx is a real remount bomb,
   but removing it changes reconciliation for ~70 pages at once. It is NOT the
   cause of this bug (the rail's URL never changes on a section switch), so it
   must stay until that is a deliberate, separately-tested change. */
test('the routed-page key is left alone - it is not the cause of this bug', () => {
  const app = read('src/App.jsx');
  assert.match(app, /key=\{location\.pathname\}/,
    'unchanged on purpose; see the note above');
});

test('neither page still carries the temporary diagnostic logs', () => {
  for (const [name, src] of [
    ['StudentReport.jsx', report],
    ['PuzzleListing.jsx', puzzles],
    ['SuperAdmin.jsx', superAdmin],
  ]) {
    assert.doesNotMatch(src, /console\.log\(\s*'Sections?List (MOUNT|UNMOUNT)'/,
      `${name} still has the temporary mount logging`);
    assert.doesNotMatch(src, /console\.trace\(\)/,
      `${name} still has a temporary trace`);
  }
});