/* Classroom "Assignments" tab (coach view).
 *
 * Run: node --test scripts/class-assignments.test.mjs
 *
 * The summary arithmetic and the All/Pending/Completed filter are pure and
 * imported directly. The wiring — the tab being coach-only, the panel reusing
 * the Worklist's endpoint and status UI, and the Worklist backend now carrying
 * per-student solved/total — is asserted against the source, matching the rest
 * of this suite.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildSummaries, filterSummaries, DONE_STATUSES } from '../src/utils/classAssignments.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const read = (...p) => readFileSync(join(root, ...p), 'utf8');
const readRepo = (...p) => readFileSync(join(root, '..', ...p), 'utf8');

const roster = [
  { student_id: 1, name: 'Alice', email: 'alice@chess.test' },
  { student_id: 2, name: 'Bob', email: 'bob@chess.test' },
  { student_id: 3, name: 'Cara', email: 'cara@chess.test' },
];

const assignments = [
  {
    id: 10,
    title: 'Set A',
    student_refs: [
      { id: 1, status: 'submitted', solved: 3, total: 3 },
      { id: 2, status: 'pending', solved: 1, total: 3 },
    ],
  },
  {
    id: 11,
    title: 'Set B',
    student_refs: [
      { id: 1, status: 'reviewed', solved: 2, total: 2 },
      { id: 2, status: 'in_progress', solved: 0, total: 4 },
    ],
  },
];

/* ------------------------------------------------------------------ *
 * Summary maths
 * ------------------------------------------------------------------ */

test('sums assignments and puzzles per student from the assignment refs', () => {
  const [alice, bob] = buildSummaries(roster, assignments);

  assert.equal(alice.assignmentsTotal, 2);
  assert.equal(alice.assignmentsDone, 2, 'submitted + reviewed both count as done');
  assert.equal(alice.puzzlesTotal, 5);
  assert.equal(alice.puzzlesDone, 5);
  assert.equal(alice.pct, 100);
  assert.equal(alice.completed, true);

  assert.equal(bob.assignmentsTotal, 2);
  assert.equal(bob.assignmentsDone, 0, 'pending + in_progress are not done');
  assert.equal(bob.puzzlesTotal, 7);
  assert.equal(bob.puzzlesDone, 1);
  assert.equal(bob.pct, 14, '1/7 rounds to 14%');
  assert.equal(bob.completed, false);
});

test('a student with no assignments is 0/0 and not "completed"', () => {
  const [, , cara] = buildSummaries(roster, assignments);
  assert.equal(cara.assignmentsTotal, 0);
  assert.equal(cara.puzzlesTotal, 0);
  assert.equal(cara.pct, 0);
  assert.equal(cara.completed, false, 'no work assigned is not the same as all done');
});

test('overdue work is pending, not completed', () => {
  const rows = buildSummaries(roster, [{
    id: 12,
    title: 'Late',
    student_refs: [{ id: 1, status: 'overdue', solved: 1, total: 4 }],
  }]);
  assert.equal(rows[0].assignmentsDone, 0);
  assert.equal(rows[0].completed, false);
  assert.ok(!DONE_STATUSES.has('overdue'));
});

test('missing refs and junk totals never produce NaN', () => {
  const rows = buildSummaries(
    [{ student_id: 9, name: 'No Ref' }],
    [{ id: 1, student_refs: [{ id: 9, status: 'pending', solved: null, total: undefined }] }, null]
  );
  assert.equal(rows[0].puzzlesTotal, 0);
  assert.equal(rows[0].puzzlesDone, 0);
  assert.equal(rows[0].pct, 0);
});

/* ------------------------------------------------------------------ *
 * Search + filter
 * ------------------------------------------------------------------ */

test('the All / Pending / Completed filter and the search box', () => {
  const rows = buildSummaries(roster, assignments);

  assert.equal(filterSummaries(rows, 'all', '').length, 3);
  assert.deepEqual(filterSummaries(rows, 'completed', '').map((r) => r.name), ['Alice']);
  assert.deepEqual(filterSummaries(rows, 'pending', '').map((r) => r.name), ['Bob', 'Cara']);

  assert.deepEqual(filterSummaries(rows, 'all', 'bo').map((r) => r.name), ['Bob']);
  assert.deepEqual(filterSummaries(rows, 'all', 'cara@chess.test').map((r) => r.name), ['Cara']);
  assert.deepEqual(filterSummaries(rows, 'completed', 'bo'), []);
});

/* ------------------------------------------------------------------ *
 * Wiring — the classroom tab
 * ------------------------------------------------------------------ */

test('ChatPanel adds one instructor-only Assignments tab', () => {
  const src = read('src', 'components', 'liveclass', 'ChatPanel.jsx');
  assert.match(src, /import ClassAssignmentsPanel from '\.\/ClassAssignmentsPanel'/, 'panel is imported');
  assert.match(src, /📋 Assignments/, 'chip label');
  assert.match(src, /openTab\('assignments'\)/, 'chip opens the tab');
  assert.match(src, /tab === 'assignments' \? 'live-chip-on'/, 'active chip state');
  /* The chip lives inside an isInstructor block, so a student never sees it. */
  assert.ok(
    src.indexOf('📋 Assignments') > src.indexOf('{isInstructor && ('),
    'chip is inside the isInstructor block'
  );
  /* A student can never restore the tab from localStorage either. */
  assert.match(src, /t === 'files' \|\| t === 'assignments'\) && !isInstructor/, 'restore guard');
});

test('the panel refreshes on (re)open and only fetches detail on click', () => {
  const src = read('src', 'components', 'liveclass', 'ClassAssignmentsPanel.jsx');
  assert.match(src, /if \(!active\) return;/, 'refetch is driven by the active tab');
  const chat = read('src', 'components', 'liveclass', 'ChatPanel.jsx');
  assert.match(chat, /active=\{tab === 'assignments' && isInstructor\}/, 'ChatPanel passes active');
  /* List data loads once; the tracker call happens in openStudent, not in refresh. */
  const refreshBody = src.slice(src.indexOf('const refresh = useCallback'), src.indexOf('const rows = useMemo'));
  assert.match(refreshBody, /puzzle-assignments'\)/, 'list endpoint in refresh');
  assert.doesNotMatch(refreshBody, /\/students`/, 'no per-student tracker call in the list load');
  assert.match(src, /\/assignments\/puzzle-assignments\/\$\{a\.id\}\/students/, 'detail uses the tracker endpoint');
});

test('the panel reuses the Worklist status UI and data source', () => {
  const src = read('src', 'components', 'liveclass', 'ClassAssignmentsPanel.jsx');
  assert.match(src, /import \{ StatusPill, fmtDate \} from '\.\.\/PuzzleAssignmentsPanel'/, 'reuses StatusPill + fmtDate');
  assert.match(src, /import \{ Spinner, Bar \} from '\.\.\/ui'/, 'reuses Bar + Spinner');
  assert.match(src, /import PuzzleReviewModal from '\.\.\/PuzzleReviewModal'/, 'reuses the review modal');
  assert.match(src, /buildSummaries, filterSummaries \} from '\.\.\/\.\.\/utils\/classAssignments'/, 'pure model extracted');
  assert.match(src, /\/classes\/\$\{classId\}\/detail/, 'roster comes from the class detail endpoint');
});

test('PuzzleAssignmentsPanel exports the shared pill + date helper', () => {
  const src = read('src', 'components', 'PuzzleAssignmentsPanel.jsx');
  assert.match(src, /export function StatusPill/, 'StatusPill exported');
  assert.match(src, /export function fmtDate/, 'fmtDate exported');
});

test('the Worklist list endpoint now carries per-student solved/total', () => {
  const src = readRepo('backend', 'src', 'controllers', 'assignmentController.js');
  assert.match(src, /solved: s\.solved,/, 'solved travels with each ref');
  assert.match(src, /total: s\.total,/, 'total travels with each ref');
});
