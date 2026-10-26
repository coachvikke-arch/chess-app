import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const panel = readFileSync('src/components/PuzzleAssignmentsPanel.jsx', 'utf8');
const drawer = readFileSync('src/components/AssignmentFilterPanel.jsx', 'utf8');
const css = readFileSync('src/index.css', 'utf8');
const controller = readFileSync('../backend/src/controllers/assignmentController.js', 'utf8');

/* The pure filter logic, pulled straight out of the module. Imported rather
   than reimplemented so the tests cannot drift from what ships. */
const logic = drawer.match(
  /export function applyAssignmentFilters[\s\S]*?\n}\n/
);
assert.ok(logic, 'applyAssignmentFilters is exported and parseable');

/* `applyAssignmentFilters` reads FILTER_DEFAULTS, so it has to be in scope
   inside the extracted function. Pulled from the source rather than restated, so
   a change to the defaults shows up here as a failing expectation. */
const defaultsSrc = drawer.match(/export const FILTER_DEFAULTS = (\{[\s\S]*?\});/);
assert.ok(defaultsSrc, 'FILTER_DEFAULTS is exported');
const FILTER_DEFAULTS = new Function(`return ${defaultsSrc[1]};`)();

const helpers = {};
for (const name of ['isPending', 'countActiveFilters', 'collectStudents', 'studentStatusFor']) {
  const m = drawer.match(new RegExp(`export function ${name}[\\s\\S]*?\\n}\\n`));
  assert.ok(m, `${name} is exported`);
  // eslint-disable-next-line no-new-func
  helpers[name] = new Function(
    'FILTER_DEFAULTS',
    `${m[0].replace('export ', '')}; return ${name};`
  )(FILTER_DEFAULTS);
}

/* statusFiltersFor reads the two chip lists, so they have to be in scope too -
   pulled from the source so a chip can be added or relabelled without the test
   quietly checking a stale copy. */
const chipList = (name) => {
  const m = drawer.match(new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\];`));
  assert.ok(m, `${name} is exported`);
  // eslint-disable-next-line no-new-func
  return new Function(`return [${m[1]}];`)();
};
const STATUS_FILTERS = chipList('STATUS_FILTERS');
const STUDENT_STATUS_FILTERS = chipList('STUDENT_STATUS_FILTERS');
// eslint-disable-next-line no-new-func
helpers.statusFiltersFor = new Function(
  'STATUS_FILTERS',
  'STUDENT_STATUS_FILTERS',
  drawer
    .match(/export function statusFiltersFor\([\s\S]*?\n}\n/)[0]
    .replace('export ', '') + '; return statusFiltersFor;'
)(STATUS_FILTERS, STUDENT_STATUS_FILTERS);
/* `applyAssignmentFilters` calls isPending and studentStatusFor, so they have to
   be in scope inside the extracted function - they are its own dependencies. */
const applyAssignmentFilters = new Function(
  'FILTER_DEFAULTS',
  'isPending',
  'studentStatusFor',
  `${logic[0].replace('export ', '')}; return applyAssignmentFilters;`
)(FILTER_DEFAULTS, helpers.isPending, helpers.studentStatusFor);

const DEFAULTS = FILTER_DEFAULTS;
const NOW = new Date('2026-06-15T12:00:00Z');

const row = (over = {}) => ({
  id: over.id ?? 1,
  title: 'Endgame drills',
  status: 'active',
  created_at: '2026-06-01T09:00:00Z',
  due_date: null,
  student_count: 2,
  completed_count: 0,
  student_refs: [{ id: 11, name: 'Ana Ruiz' }],
  ...over,
});

/* ═══════════════ pending, and the status field it cannot be read from ═══════════════ */

test('pending is derived from the counts, not read off the status field', () => {
  /* The API's `effectiveStatus` rewrites every past-due non-draft assignment to
     'completed', so the status field cannot say whether work is outstanding - and
     the old Overdue tab, which tested `status === 'active'`, matched nothing at
     all as a result. These rows are shaped exactly like the endpoint's output. */
  const pastDueNotFinished = row({
    status: 'completed',
    due_date: '2026-06-10T00:00:00Z',
    completed_count: 1,
    student_count: 3,
  });
  assert.equal(helpers.isPending(pastDueNotFinished), true,
    'past due with 2 of 3 unfinished is still pending');

  const pastDueFinished = row({
    status: 'completed',
    due_date: '2026-06-10T00:00:00Z',
    completed_count: 3,
    student_count: 3,
  });
  assert.equal(helpers.isPending(pastDueFinished), false, 'everyone handed it in');
});

test('pending ignores the due date entirely', () => {
  /* It means "still waiting", not "late" - work with no deadline and students
     part-way through is the case a coach most wants to see. */
  const unfinished = { completed_count: 1, student_count: 4 };
  assert.equal(helpers.isPending(row({ ...unfinished, status: 'active', due_date: null })), true,
    'no due date, one student still to go');
  assert.equal(helpers.isPending(row({ ...unfinished, status: 'active', due_date: '2026-12-01T00:00:00Z' })), true,
    'due next month, still not finished');
});

test('pending skips anything that is not outstanding', () => {
  const base = { completed_count: 1, student_count: 2 };
  assert.equal(helpers.isPending(row({ ...base, status: 'archived' })), false, 'archived');
  assert.equal(helpers.isPending(row({ ...base, status: 'draft' })), false, 'draft, never handed out');
  assert.equal(helpers.isPending(row({ ...base, student_count: 0, completed_count: 0 })), false,
    'nobody was assigned it, so there is nobody waiting on it');
  assert.equal(helpers.isPending(row({ ...base, student_count: 2, completed_count: 2 })), false,
    'finished');
  assert.equal(helpers.isPending(undefined), false, 'no row at all');
});

/* ═══════════════ filters combine, rather than overriding each other ═══════════════ */

const corpus = () => [
  row({ id: 1, title: 'Oldest active', created_at: '2026-01-05T09:00:00Z', student_refs: [{ id: 11, name: 'Ana Ruiz', status: 'in_progress' }] }),
  row({ id: 2, title: 'Archived one', status: 'archived', created_at: '2026-02-10T09:00:00Z', student_refs: [{ id: 12, name: 'Bo Chen', status: 'submitted' }] }),
  row({
    id: 3, title: 'Ana past due, unfinished', created_at: '2026-03-15T09:00:00Z',
    status: 'completed', due_date: '2026-04-01T00:00:00Z',
    completed_count: 1, student_count: 2,
    student_refs: [{ id: 11, name: 'Ana Ruiz', status: 'in_progress' }],
  }),
  row({
    id: 4, title: 'Ana newest', created_at: '2026-05-20T09:00:00Z',
    student_refs: [{ id: 11, name: 'Ana Ruiz', status: 'pending' }, { id: 13, name: 'Cy Ade', status: 'pending' }],
  }),
  row({ id: 5, title: 'Bo draft', status: 'draft', created_at: '2026-05-25T09:00:00Z', student_refs: [{ id: 12, name: 'Bo Chen', status: 'pending' }] }),
];

test('status alone narrows the list', () => {
  assert.equal(applyAssignmentFilters(corpus(), { ...DEFAULTS, status: 'draft' }, NOW).length, 1);
  assert.equal(applyAssignmentFilters(corpus(), { ...DEFAULTS, status: 'archived' }, NOW).length, 1);
  assert.equal(applyAssignmentFilters(corpus(), { ...DEFAULTS, status: 'all' }, NOW).length, 5);
});

test('pending selects everything still waiting on a student', () => {
  /* Rows 1, 3 and 4 are all handed out with students behind them. Row 1 and row
     4 are not late at all - they are simply unfinished, which is what pending
     means here. Rows 2 and 5 are archived and draft. */
  const out = applyAssignmentFilters(corpus(), { ...DEFAULTS, status: 'pending' }, NOW);
  assert.deepEqual(out.map((a) => a.id), [4, 3, 1], 'newest first');
});

test('pending and completed do not overlap', () => {
  /* A finished past-due assignment reads as 'completed' to the API and is not
     pending; an unfinished one reads as 'completed' too but IS pending. The two
     filters are independent, which is exactly why pending cannot be a status. */
  const corpusRows = corpus();
  const pending = applyAssignmentFilters(corpusRows, { ...DEFAULTS, status: 'pending' }, NOW);
  const finished = pending.filter((a) => a.completed_count >= a.student_count);
  assert.deepEqual(finished, [], 'nothing both finished and pending');
});

test('student and sort apply at the same time', () => {
  const out = applyAssignmentFilters(corpus(), {
    ...DEFAULTS,
    studentId: '11',
    sort: 'oldest',
  }, NOW);
  assert.deepEqual(out.map((a) => a.id), [1, 3, 4],
    "Ana's rows, oldest first - the other students' rows are gone");

  const impossible = applyAssignmentFilters(corpus(), {
    ...DEFAULTS,
    studentId: '13',
    status: 'archived',
  }, NOW);
  assert.deepEqual(impossible, [], 'an impossible combination is empty, not silently widened');
});

/* ═══════════════ a selected student switches the status axis ═══════════════ */

test('a selected student filters on THEIR status, not the assignment status', () => {
  /* Row 3 is an overdue assignment the API reports as 'completed'. Filtering
     student 11 by 'completed' must NOT return it: from that student's side it is
     still in progress. Reading the assignment's status here is the whole bug -
     the same row shows as "In progress" the moment a student is picked. */
  const byStudentCompleted = applyAssignmentFilters(corpus(), {
    ...DEFAULTS,
    studentId: '11',
    status: 'completed',
  }, NOW);
  assert.deepEqual(byStudentCompleted, [], 'student 11 has handed in nothing');

  const byStudentInProgress = applyAssignmentFilters(corpus(), {
    ...DEFAULTS,
    studentId: '11',
    status: 'in_progress',
  }, NOW);
  assert.deepEqual(byStudentInProgress.map((a) => a.id), [3, 1], 'newest first');

  const allOfAnas = applyAssignmentFilters(corpus(), { ...DEFAULTS, studentId: '11' }, NOW);
  assert.deepEqual(allOfAnas.map((a) => a.id), [4, 3, 1], 'with no status chosen, every one of her rows');
});

test('student status and assignment status are different questions', () => {
  const studentMode = helpers.statusFiltersFor({ studentId: '11' });
  const assignmentMode = helpers.statusFiltersFor({ studentId: '' });
  assert.ok(!assignmentMode.some((s) => s.value === 'in_progress'), 'no student state without a student');
  assert.ok(!studentMode.some((s) => s.value === 'archived'), 'and no assignment state with one');
  assert.ok(!studentMode.some((s) => s.value === 'completed'), "the assignment's Completed is not a student state");

  /* Every student status offered must be one the API can actually return, or a
     chip exists that always yields zero rows. */
  const derived = new Set(['pending', 'in_progress', 'submitted', 'reviewed', 'overdue']);
  for (const s of studentMode.filter((x) => x.value !== 'all')) {
    assert.ok(derived.has(s.value), `${s.value} is a real per-student status`);
  }
});

test('the status axis resets when it changes, rather than filtering to nothing', () => {
  /* Picking a student while "Draft" is active: Draft is not a student state, so
     carrying it over would show an empty list with no obvious cause. */
  assert.match(drawer, /const allowed = statusFiltersFor\(\{ \.\.\.d, studentId \}\)/);
  assert.match(drawer, /allowed\.includes\(d\.status\) \? d\.status : 'all'/);
});

test('the row shows the selected student’s status while filtering by them', () => {
  /* Otherwise the pill reads "Active" above a list the coach has just filtered
     to "Reviewed". */
  assert.match(panel, /focusStudent=\{focusStudent\}/);
  assert.match(panel, /const focusStatus = studentStatusFor\(a, focusStudent\?\.id\)/);
  assert.match(panel, /\{focusStatus \? \([\s\S]*?focusStudent\.name[\s\S]*?StatusPill status=\{focusStatus\}[\s\S]*?\) : \([\s\S]*?StatusPill status=\{a\.status\}/);
  assert.match(drawer, /\{statusFilters\.map\(/, 'the chips render whichever axis applies');
});

/* ═══════════════ sort ═══════════════ */

test('sort reverses the order, and ties keep a stable order', () => {
  const latest = applyAssignmentFilters(corpus(), { ...DEFAULTS, sort: 'latest' }, NOW).map((a) => a.id);
  const oldest = applyAssignmentFilters(corpus(), { ...DEFAULTS, sort: 'oldest' }, NOW).map((a) => a.id);
  assert.deepEqual(latest, [5, 4, 3, 2, 1]);
  assert.deepEqual(oldest, [1, 2, 3, 4, 5]);
  assert.deepEqual(oldest, [...latest].reverse(), 'the two are exact opposites');

  const tied = applyAssignmentFilters(
    [row({ id: 9, created_at: '2026-04-01T00:00:00Z' }), row({ id: 8, created_at: '2026-04-01T00:00:00Z' })],
    DEFAULTS,
    NOW
  );
  assert.deepEqual(tied.map((a) => a.id), [9, 8], 'equal dates do not reshuffle');
});

test('filters must never mutate the source list', () => {
  const src = corpus();
  const before = src.map((a) => a.id);
  applyAssignmentFilters(src, { ...DEFAULTS, sort: 'oldest', status: 'overdue' }, NOW);
  assert.deepEqual(src.map((a) => a.id), before);
});

/* ═══════════════ the active-filter badge ═══════════════ */

test('the badge counts only what is off its default', () => {
  assert.equal(helpers.countActiveFilters(DEFAULTS), 0);
  assert.equal(helpers.countActiveFilters({ ...DEFAULTS, status: 'all' }), 0, '"All" is not a filter');
  assert.equal(helpers.countActiveFilters({ ...DEFAULTS, status: 'draft' }), 1);
  assert.equal(
    helpers.countActiveFilters({ status: 'draft', sort: 'oldest', studentId: '11' }),
    3
  );
  assert.equal(helpers.countActiveFilters({}), 0, 'an empty snapshot is not all filtered');
});

test('there is no date selector', () => {
  /* Removed on request. Asserted rather than just deleted: a stray `dateFrom` in
     the filter snapshot would silently stop counting toward the badge and stop
     filtering, which reads as "the date filter randomly ignores me". */
  assert.doesNotMatch(drawer, /type="date"/, 'no date inputs');
  assert.doesNotMatch(drawer, /dateFrom|dateTo/, 'no date fields in the panel');
  assert.doesNotMatch(logic[0], /dateFrom|dateTo|dayKey/, 'and none in the filter logic');
  assert.doesNotMatch(drawer, /export function dayKey/, 'the day helper went with it');
  assert.deepEqual(Object.keys(FILTER_DEFAULTS).sort(), ['sort', 'status', 'studentId']);
  assert.doesNotMatch(drawer, /Matches the date each assignment was given out/,
    'and the hint that explained it');
});

/* ═══════════════ the student list is built from the real rows ═══════════════ */

test('student options come from the assignments, deduped and sorted', () => {
  const list = helpers.collectStudents([
    row({ id: 1, student_refs: [{ id: 13, name: 'Cy Ade' }, { id: 11, name: 'Ana Ruiz' }] }),
    row({ id: 2, student_refs: [{ id: 11, name: 'Ana Ruiz' }] }),
    row({ id: 3, student_refs: [] }),
    row({ id: 4, student_refs: undefined }),
  ]);
  assert.deepEqual(list, [
    { id: 11, name: 'Ana Ruiz' },
    { id: 13, name: 'Cy Ade' },
  ], 'a student on several assignments is offered once');
});

test('the dropdown survives a nameless student rather than rendering "undefined"', () => {
  const list = helpers.collectStudents([row({ student_refs: [{ id: 99 }] })]);
  assert.equal(list[0].name, 'Student 99');
});

/* ═══════════════ the query actually returns ids ═══════════════ */

test('the list endpoint returns id, name and the status the tracker shows', () => {
  assert.match(controller, /AS student_refs/);
  assert.match(controller, /json_build_object\([^)]*'id', st\.id[^)]*'name', us\.name/);
  assert.match(controller, /'status', sub3\.status/, 'the stored status comes through to derive from');
  assert.match(controller, /'solved', LEAST\(/, 'as does solved-progress, capped at the puzzle count');
  /* Not a second parallel array: names sort A-Z and ids sort numerically, so two
     independently-ordered arrays cannot be zipped by index. */
  assert.doesNotMatch(controller, /array_agg\(DISTINCT st\.id[^)]*\)\s*\n[^;]*AS student_ids/);
  assert.match(controller, /AS student_names/, 'the existing name array is left alone');
});

test('both endpoints derive status from one shared rule', () => {
  /* Two copies of the overdue/submitted rules would drift, and a filtered list
     that disagrees with the tracker behind the "Track students" button is the
     kind of bug nobody reports - they just stop trusting the filter. */
  assert.match(controller, /function effectiveStudentStatus\(/);
  assert.match(controller, /status: effectiveStudentStatus\(\{/);
  assert.match(controller, /const status = effectiveStudentStatus\(\{/);

  /* \r? because the backend file has CRLF endings - without it the extraction
     silently returns null and the rule below is never actually checked. */
  const helper = controller.match(/function effectiveStudentStatus\([\s\S]*?\r?\n}\r?\n/)[0];
  const uses = controller.match(/effectiveStudentStatus\(/g).length;
  assert.equal(uses, 3, 'one definition plus both call sites');

  /* The rule itself, so a silent edit to either is caught. */
  assert.match(helper, /!\['submitted', 'reviewed'\]\.includes\(out\)[\s\S]*out = 'overdue'/);
  assert.match(helper, /\['pending', 'in_progress'\]\.includes\(out\)[\s\S]*out = 'submitted'/);
  assert.match(helper, /total > 0 && solved >= total/);

  /* The raw refs must not ship beside the derived ones - two near-identical
     fields is how a caller ends up filtering on the un-derived one. */
  assert.doesNotMatch(controller, /studentRefs/, 'no second field of student refs');
  assert.match(controller, /student_refs: \(r\.student_refs \|\| \[\]\)\.map/);
});

test('the panel consumes the derived status, not the assignment status', () => {
  assert.match(drawer, /studentStatusFor/);
  assert.doesNotMatch(drawer, /Number\(r\?\.id\) === id/, 'no longer filters by presence alone');
});

/* ═══════════════ the two status controls share one state ═══════════════ */

test('the quick tabs and the drawer write the same filter', () => {
  /* Two independent status controls is how a list ends up showing "Active" while
     the drawer says something else. One snapshot, two views of it. */
  assert.doesNotMatch(panel, /const \[tab, setTab\] = useState/);
  assert.match(panel, /const \[filters, setFilters\] = useState\(FILTER_DEFAULTS\)/);
  assert.match(panel, /onClick=\{\(\) => setFilters\(\{ \.\.\.filters, status: t \}\)\}/);
  assert.match(panel, /filters\.status === t/);
  assert.doesNotMatch(panel, /const \[filtersOpen, setFiltersOpen\] = useState\(false\);\s*const \[tab/);
});

test('the filter is called Pending on both surfaces', () => {
  /* One filter, two controls - the quick tab row and the drawer. If only the
     drawer is renamed the list shows a highlighted "Overdue" tab that no longer
     matches anything the coach is looking at. */
  assert.match(drawer, /\{ value: 'pending', label: 'Pending' \}/);
  /* Scoped to the assignment axis: "Overdue" is legitimately a per-student state
     in the other list, so a whole-file check would forbid a real chip. */
  const assignmentChips = drawer.match(/export const STATUS_FILTERS = \[[\s\S]*?\];/)[0];
  assert.doesNotMatch(assignmentChips, /Overdue/, 'no stale Overdue chip on the assignment axis');
  assert.match(drawer, /\{ value: 'overdue', label: 'Overdue' \}/,
    'and a real Overdue chip where overdue genuinely applies');

  const tabs = panel.match(/const LIST_TABS = \[[^\]]*\]/)[0];
  assert.match(tabs, /'pending'/);
  assert.doesNotMatch(tabs, /'overdue'/, 'and no stale Overdue quick tab');
  assert.match(panel, /pending: 'Pending'/);
  assert.match(panel, /overdue: 'Overdue'/,
    "the tracker's per-student overdue is a different, still-real value");

  /* Neither control may reach for a status that is never stored. */
  assert.match(controller, /\['draft', 'active', 'archived'\]\.includes\(status\)/,
    'assignment status is clamped, so pending has to stay derived');
  assert.match(drawer, /f\.status === 'pending'/, 'and it is filtered as a derived rule');
});

/* ═══════════════ the drawer contract ═══════════════ */

test('the panel is a labelled modal drawer', () => {
  assert.match(drawer, /role="dialog"/);
  assert.match(drawer, /aria-modal="true"/);
  assert.match(drawer, /aria-labelledby=\{titleId\}/);
  assert.match(drawer, />\s*Filters\s*</, 'the title is Filters');
  assert.match(drawer, /Narrow assignments by status, student, or sort order\./);
  assert.match(drawer, /role="radiogroup"/, 'sort is a single-choice group');
  assert.match(drawer, /role="combobox"/, 'the student field is a real combobox');
  assert.match(drawer, /aria-controls=\{listId\}/);
  assert.match(drawer, /role="listbox"/);
  assert.match(drawer, /justify-end/, 'the drawer is pinned to the right edge');
  assert.match(drawer, /max-w-sm/, 'and stays a sidebar width, not a full-screen takeover');
  assert.match(css, /@keyframes filter-panel-in/, 'and slides in rather than popping');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.filter-drawer \{ animation: none; \}/,
    'the slide respects prefers-reduced-motion');
});

test('every filter control is a real labelled, keyboard-reachable control', () => {
  assert.match(drawer, /aria-pressed=\{draft\.status === s\.value\}/, 'status chips expose their state');
  assert.match(drawer, /aria-checked=\{draft\.sort === o\.value\}/, 'sort options expose their state');
  assert.match(drawer, /<label\s+htmlFor="assignment-filter-student"/);
  assert.match(drawer, /aria-label="Select student"/);
  assert.match(drawer, /placeholder="Select student"/);
  assert.match(drawer, /htmlFor=\{titleId\}|aria-labelledby/);
});

test('Escape, Tab and focus are handled', () => {
  assert.match(drawer, /e\.key === 'Escape'/);
  assert.match(drawer, /e\.key !== 'Tab'/, 'Tab is trapped inside the dialog');
  assert.match(drawer, /firstFieldRef\.current\?\.focus\(\)/, 'focus enters the drawer');

  /* Focus has to go BACK to the Filters button, which lives in the toolbar -
     a different component. The drawer is unmounted on close rather than flipped
     to open=false, so an effect inside it could never restore focus: the parent
     owns the button, so the parent does it. */
  assert.match(panel, /const filterBtnRef = useRef\(null\)/);
  assert.match(panel, /ref=\{filterBtnRef\}/, 'the button is the stored trigger');
  assert.match(panel, /const closeFilters = useCallback\(\(\) => \{\s*setFiltersOpen\(false\);\s*filterBtnRef\.current\?\.focus\(\);/,
    'closing hands focus back to it');
  assert.match(panel, /onClose=\{closeFilters\}/, 'dismiss goes through the same path');
  assert.doesNotMatch(drawer, /triggerRef/, 'and the drawer does not pretend to own a trigger it was never given');
});

test('the drawer edits a draft that only Done commits', () => {
  assert.match(drawer, /setDraft\(value\)/, 'reopening restores the applied filters');
  assert.match(drawer, /onApply\(draft\)/, 'Done applies the draft');
  assert.match(drawer, /setDraft\(FILTER_DEFAULTS\)/, 'Clear resets every filter');
  assert.match(panel, /onApply=\{\(next\) => \{\s*setFilters\(next\);\s*closeFilters\(\);/,
    'Done commits the draft and closes');
});

/* ═══════════════ the toolbar entry point ═══════════════ */

test('the Filters button sits in the toolbar and reports the count', () => {
  assert.match(panel, /onOpenFilters/);
  assert.match(panel, /aria-haspopup="dialog"/);
  assert.match(panel, /Filters\{activeFilterCount > 0 \? ` \(\$\{activeFilterCount\}\)` : ''\}/,
    'shows "Filters (n)" only when something is filtered');
  assert.match(panel, /const activeFilterCount = countActiveFilters\(filters\)/);
});

test('an empty result after filtering says so, and offers a way out', () => {
  assert.match(panel, /No results found/);
  assert.match(panel, /activeFilterCount > 0 && \(\s*<button[\s\S]*?Clear filters/);
  assert.match(panel, /onClick=\{\(\) => setFilters\(FILTER_DEFAULTS\)\}/);
  assert.match(panel, /No puzzle assignments here\. Create one from a puzzle set\./,
    'the no-assignments-at-all message is unchanged');
});