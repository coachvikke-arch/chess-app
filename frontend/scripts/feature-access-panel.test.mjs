import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement as h } from 'react';

/* FeatureAccess is rendered here for a reason the build cannot cover.
 *
 * Two real bugs shipped past `npm run build` while it stayed green:
 *   1. AccessControl's body referenced a prop that had been deleted
 *      (ReferenceError in the browser, no build error).
 *   2. A row read its switch value off the ROLE object instead of the feature
 *      row - every row rendered as the same state and every save wrote the
 *      feature key "student".
 *
 * Vite does not resolve identifiers inside JSX bodies, so the only thing that
 * catches either is rendering the component with realistic rows. The row was
 * extracted into FeatureRow specifically so it can be rendered here without the
 * api/auth/toast providers the full page needs.
 *
 * Current contract: Student and Coach are SEPARATE LISTS, each row carrying one
 * role's two-state on/off switch. There is no third state, and no shared
 * control between the roles. */

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let mod;

const source = readFileSync(join(ROOT, 'src', 'pages', 'FeatureAccess.jsx'), 'utf8');

async function bundlePanel() {
  const outfile = join(ROOT, 'node_modules', '.feature-access-panel.test.mjs');
  await build({
    stdin: {
      contents: "export { FeatureRow, Toggle, ROLES, roleSees } from './src/pages/FeatureAccess.jsx';",
      resolveDir: ROOT,
      sourcefile: 'feature-access-entry.js',
      loader: 'jsx',
    },
    absWorkingDir: ROOT,
    bundle: true,
    format: 'esm',
    outfile,
    jsx: 'automatic',
    external: ['react', 'react-dom', 'react-dom/server', 'react/jsx-runtime'],
    plugins: [{
      name: 'stub-toast',
      setup(b) {
        b.onResolve({ filter: /[\\/]components[\\/]Toast$/ }, () => ({ path: 'toast-stub', namespace: 'toast-stub' }));
        b.onLoad({ filter: /.*/, namespace: 'toast-stub' }, () => ({
          contents: 'export const useToast = () => ({ showToast() {} });',
          loader: 'js',
        }));
      },
    }],
    logLevel: 'silent',
  });
  return import(pathToFileURL(outfile).href);
}

before(async () => { mod = await bundlePanel(); });

/* ── the switch itself ────────────────────────────────────────────────────── */

test('Toggle renders On and Off for both states', () => {
  for (const [checked, text] of [[true, 'On'], [false, 'Off']]) {
    const html = renderToStaticMarkup(h(mod.Toggle, { checked, label: 'x', onChange: () => {} }));
    assert.match(html, new RegExp(`aria-checked="${checked}"`));
    assert.match(html, new RegExp(`>${text}<`), `shows the ${text} label`);
  }
});

test('Toggle reports itself as a switch to assistive tech', () => {
  const html = renderToStaticMarkup(h(mod.Toggle, { checked: false, label: 'Leaderboard for Coach', onChange: () => {} }));
  assert.match(html, /role="switch"/);
  assert.match(html, /aria-label="Leaderboard for Coach"/);
});

test('Toggle flips to the opposite state when clicked', () => {
  const seen = [];
  const el = mod.Toggle({ checked: false, label: 'x', onChange: (v) => seen.push(v) });
  el.props.onClick();
  assert.deepEqual(seen, [true], 'from Off it offers On');

  const el2 = mod.Toggle({ checked: true, label: 'x', onChange: (v) => seen.push(v) });
  el2.props.onClick();
  assert.deepEqual(seen, [true, false], 'from On it offers Off');
});

/* ── the row: exactly one role's switch ───────────────────────────────────── */

const ROW = {
  key: 'leaderboard',
  name: 'Leaderboard',
  description: 'Academy-wide rating ladder',
  student_enabled: true,
  coach_enabled: false,
};

const LABEL = { student: 'Student', coach: 'Coach' };
const COLUMN = { student: 'student_enabled', coach: 'coach_enabled' };

const renderRow = (feature = ROW, role = 'student', saving = {}, onToggle = () => {}) =>
  renderToStaticMarkup(h(mod.FeatureRow, { feature, role, saving, onToggle }));

test('a row carries one switch, and only the role it was asked for', () => {
  const html = renderRow(ROW, 'student');
  assert.equal((html.match(/role="switch"/g) || []).length, 1, 'exactly one switch');
  assert.match(html, /aria-label="Leaderboard for Student"/);
  assert.ok(!html.includes('for Coach'), 'the other role must not appear in this row');
});

/* Asymmetric fixtures. A true/false pair is symmetric, so a mutation that read
 * the wrong role's column would still produce ['true','false'] and slip through.
 * These rows make every pairing distinguishable. */
const ASYMMETRIC = [
  { key: 'a', name: 'A', student_enabled: true,  coach_enabled: false },
  { key: 'b', name: 'B', student_enabled: false, coach_enabled: true },
  { key: 'c', name: 'C', student_enabled: false, coach_enabled: false },
  { key: 'd', name: 'D', student_enabled: true,  coach_enabled: true },
];

/* THE regression. When the row variable was shadowed by the role variable the
 * lookup resolved off the role object, came back undefined, and every row
 * rendered identically. */
test('the switch reads the column of the role it was rendered for', () => {
  for (const feature of ASYMMETRIC) {
    for (const role of ['student', 'coach']) {
      const html = renderRow(feature, role);
      assert.match(
        html,
        new RegExp(`aria-checked="${feature[COLUMN[role]]}"`),
        `${feature.name} as ${LABEL[role]}: student=${feature.student_enabled} coach=${feature.coach_enabled}`,
      );
    }
  }
});

/* A legacy NULL row must read as Off, never as On: dropping the `=== true`
 * guard flips this the wrong way. */
test('a null or missing value reads as Off, not On', () => {
  for (const value of [null, undefined]) {
    const html = renderRow({ ...ROW, student_enabled: value }, 'student');
    assert.match(html, /aria-checked="false"/, 'null/undefined reads as Off');
    /* And it must not silently fall through to the other role's column. */
    assert.ok(!html.includes('aria-checked="true"'), 'it must not borrow the coach value');
  }
});

test('the On/Off text label is rendered, not just the knob position', () => {
  /* A bare knob is ambiguous at a glance, and this list decides who can reach
   * what. */
  assert.match(renderRow(ROW, 'student'), />On</);
  assert.match(renderRow(ROW, 'coach'), />Off</);
});

/* Saving is keyed on feature AND role. With a single id, one role's save could
 * disable the other's switch for the same feature. */
test('an in-flight save disables only its own role', () => {
  const html = renderRow(ROW, 'student', { 'leaderboard:student': true });
  /* disabled is emitted after aria-label on the same button, so match the whole
   * tag and test membership rather than assuming an attribute order. */
  const disabled = [...html.matchAll(/<button[^>]*>/g)]
    .map((m) => m[0])
    .filter((tag) => tag.includes('disabled=""'))
    .map((tag) => tag.match(/aria-label="([^"]+)"/)?.[1]);
  assert.ok(disabled.includes('Leaderboard for Student'), 'the saving switch is disabled');
  /* A save for the OTHER role must leave this one usable. */
  const other = renderRow(ROW, 'student', { 'leaderboard:coach': true });
  assert.ok(!other.includes('disabled=""'), 'the other role\'s save must not disable this one');
});

test('onToggle receives the feature key and the role key, never swapped', () => {
  const calls = [];
  /* FeatureRow is a plain function component, so calling it yields the element
   * tree with props intact. Static markup cannot be used here: handlers do not
   * survive rendering to a string. */
  const el = mod.FeatureRow({ feature: ROW, role: 'coach', saving: {}, onToggle: (...a) => calls.push(a) });
  const found = [];
  (function walk(node) {
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    /* The Toggle element carries label + onChange; FeatureRow's own props carry
     * neither, so only the switch matches. */
    if (node.props && typeof node.props.label === 'string' && node.props.onChange) {
      found.push(node.props);
    }
    walk(node.props?.children);
  })(el);

  assert.equal(found.length, 1, 'one switch');
  found[0].onChange(false);
  assert.deepEqual(calls, [['leaderboard', 'coach', false]], 'feature key first, role second');
});

/* ── the panel: one role at a time, and no bulk switch ────────────────────── */

/* The real registry, as the migration seeds it. Kept as data (not a regex over
   the source) because the rule under test is a decision about these rows. */
const REGISTRY = [
  { key: 'profile_settings',   category: 'General' },
  { key: 'notifications',      category: 'General' },
  { key: 'student_roster',     category: 'Coach Tools' },
  { key: 'assign_lessons',     category: 'Coach Tools' },
  { key: 'live_review',        category: 'Coach Tools' },
  { key: 'analytics',          category: 'Coach Tools' },
  { key: 'messaging_students', category: 'Coach Tools' },
  { key: 'puzzle_authoring',   category: 'Coach Tools' },
  { key: 'gm_games',           category: 'Coach Tools' },
  { key: 'chess_tactics',      category: 'Coach Tools' },
  { key: 'piece_lessons',      category: 'Student Tools' },
  { key: 'live_game',          category: 'Student Tools' },
  { key: 'puzzle_trainer',     category: 'Student Tools' },
  { key: 'leaderboard',        category: 'Student Tools' },
  { key: 'game_analysis',      category: 'Student Tools' },
  { key: 'assignments',        category: 'Student Tools' },
  { key: 'tournaments',        category: 'Student Tools' },
  { key: 'opening_library',    category: 'Student Tools' },
  { key: 'messaging_coach',    category: 'Student Tools' },
];
const keys = (role) => REGISTRY.filter((f) => mod.roleSees(role, f)).map((f) => f.key);

test('the Students list offers no Coach Tools', () => {
  /* The complaint: Coach Tools sat inside Students access, so a Super Admin
     scrolled past switches that grant a student nothing. */
  const student = keys('student');
  assert.ok(!student.includes('student_roster'), 'no Student Roster for students');
  assert.ok(!student.includes('analytics'), 'no Analytics for students');
  assert.ok(!student.includes('puzzle_authoring'), 'no Puzzle Authoring for students');
  for (const f of REGISTRY.filter((x) => x.category === 'Coach Tools' && x.key !== 'gm_games' && x.key !== 'chess_tactics')) {
    assert.ok(!student.includes(f.key), `${f.key} is a Coach Tool and must not be listed`);
  }
});

test('the Coaches list offers no Student Tools', () => {
  const coach = keys('coach');
  for (const f of REGISTRY.filter((x) => x.category === 'Student Tools')) {
    assert.ok(!coach.includes(f.key), `${f.key} is a Student Tool and must not be listed`);
  }
});

test('General settings are listed for both roles', () => {
  for (const role of ['student', 'coach']) {
    for (const f of REGISTRY.filter((x) => x.category === 'General')) {
      assert.ok(keys(role).includes(f.key), `${f.key} belongs to ${role} too`);
    }
  }
});

test('GM Games stays listed for BOTH roles', () => {
  /* gm_games sits on the Coach Tools shelf but both navs gate on it: a coach
   * imports and annotates, a student opens the same games read-only. Filtering
   * strictly by shelf would silently revoke the student's GM Games page. */
  assert.ok(keys('student').includes('gm_games'), 'students keep GM Games');
  assert.ok(keys('coach').includes('gm_games'), 'coaches keep GM Games');
});

test('Chess Tactics stays listed for BOTH roles', () => {
  /* chess_tactics sits on the Coach Tools shelf but both navs gate on it: the
   * same 45 tactics render inside the coach shell and the student shell. */
  assert.ok(keys('student').includes('chess_tactics'), 'students keep Chess Tactics');
  assert.ok(keys('coach').includes('chess_tactics'), 'coaches keep Chess Tactics');
});

test('each role sees every feature on its own shelf, and nothing duplicated', () => {
  for (const role of ['student', 'coach']) {
    const own = REGISTRY.filter((f) => mod.ROLES.find((r) => r.key === role).shelf === f.category);
    for (const f of own) assert.ok(keys(role).includes(f.key), `${f.key} is on the ${role} shelf`);
    assert.equal(new Set(keys(role)).size, keys(role).length, 'no duplicates');
  }
});

test('one role is on screen at a time, chosen by a selector', () => {
  /* Two full lists on one page doubled the switches and made it easy to change
   * the wrong role's access. */
  assert.match(source, /role="radiogroup"/, 'the role picker is a radio group');
  assert.match(source, /aria-checked=\{role === r\.key\}/, 'exactly one option is checked');
  assert.match(source, /onClick=\{\(\) => setRole\(r\.key\)\}/, 'choosing an option switches the list');
  assert.ok(!/ROLES\.map\(\(role\)/.test(source), 'the section is not mapped over both roles');
  assert.match(source, /<FeatureRow[\s\S]{0,200}role=\{role\}/,
    'rows are handed the SELECTED role');
  /* The list itself is filtered before it renders, so the other role\'s shelf is
   * gone rather than merely hidden. */
  assert.match(source, /roleRows = useMemo\([\s\S]{0,160}roleSees\(role, r\)/,
    'the list is filtered through roleSees');
  assert.match(source, /return roleRows\.filter\(/, 'search and category filter the role\'s own rows');
});

test('a single role section, and no empty titled box under the empty message', () => {
  assert.ok(!source.includes('perm-row--role'), 'the two-column row is gone');
  assert.match(source, /perm-row--single/, 'rows carry a single switch column');
  assert.match(source, /\{visible\.length > 0 && \(\s*<section/, 'one section, when there is something to show');
  assert.match(source, /access/, 'the heading still names whose access it is');
});

test('the bulk Enable all / Disable all controls are gone', () => {
  /* The user asked for these to be removed: beside a per-role list they read as
   * "turn everything on", which is not what anyone wanted from this panel. */
  assert.ok(!source.includes('Enable all'), 'no Enable all button');
  assert.ok(!source.includes('Disable all'), 'no Disable all button');
  assert.ok(!/\bbulk\s*\(/.test(source), 'the bulk helper is gone');
  assert.ok(!source.includes('/permissions/bulk'), 'the panel no longer calls the bulk endpoint');
});

test('a saved switch confirms itself instead of looking inert', () => {
  /* "I clicked it and nothing happened" was the original complaint: the panel
   * flipped optimistically and said nothing, and a silent failure was
   * indistinguishable from success. */
  assert.match(source, /await load\(\);[\s\S]{0,200}Access saved/,
    'a successful save re-reads the server and says so');
});

test('every permissions read opts out of the 30s GET memo', () => {
  /* `api` caches identical GETs for 30 seconds. Permission reads went through
   * it, so a poll right after a change could return the answer captured BEFORE
   * it - the request succeeded, the data was old, and the switch looked like it
   * had not saved. That is the reported "I clicked on and off but it not change
   * anything", and it is a data bug, not a layout one. */
  const reads = [...source.matchAll(/api\.get\((`[^`]+`|'[^']+')([^)]*)\)/g)];
  /* Four reads today (member search, member rows, member switches, registry);
     the floor only guards that the regex above actually found them. */
  assert.ok(reads.length >= 4, 'found the permissions reads');
  for (const [, url, rest] of reads) {
    assert.match(rest, /cache:\s*false/, `${url} must not be served from the GET memo`);
  }
  /* The signed-in user's own list is read by PermissionContext on every focus
   * change, and it is the one that decides what that person can see. */
  const ctx = readFileSync(join(ROOT, 'src', 'context', 'PermissionContext.jsx'), 'utf8');
  assert.match(ctx, /api\.get\('\/permissions\/me',\s*\{\s*cache:\s*false\s*\}\)/,
    '/permissions/me must not be served from the GET memo');
});
test('only the newest registry read may repaint the panel', () => {
  /* Each save re-reads /permissions/features, so several switches flipped in a
   * row leave several reads in flight. Their responses can arrive out of order,
   * and the last one to arrive would repaint the panel with a snapshot taken
   * before the newer writes committed - a switch you just turned on snaps back
   * to Off, which reads as "the setting turns itself off". Only the newest read
   * is allowed to paint. */
  assert.match(source, /loadSeq\s*=\s*useRef\(0\)/,
    'the panel keeps a monotonic ticket for registry reads');
  assert.match(source, /const seq = \(loadSeq\.current \+= 1\)/,
    'every load() takes the next ticket');
  const guards = [...source.matchAll(/if \(seq !== loadSeq\.current\) return;/g)];
  assert.equal(guards.length, 2,
    'both the success and the failure branch drop a stale response');
});
