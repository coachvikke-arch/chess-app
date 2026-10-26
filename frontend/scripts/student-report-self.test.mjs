// Regression test: a student sees ONLY their own report via My Report.
//   run with: node --test scripts/student-report-self.test.mjs   (from frontend/)
//
// The bugs this guards, each of which silently shows the wrong student's data
// or another student's data at all:
//   1. the nav entry or route carries a student id (URL param / user input)
//      instead of resolving it from the session;
//   2. the shared report keeps admin-only actions (edit / delete) visible to
//      the student viewing their own report;
//   3. the report endpoints let a student pass any id (the old
//      roleMiddleware('admin') shape would 403 students outright, which is why
//      the guard below exists instead);
//   4. the PDF export captures only the open tab instead of every section.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');

const shell = read('src', 'components', 'StudentAppShell.jsx');
const app = read('src', 'App.jsx');
const page = read('src', 'pages', 'StudentReport.jsx');
const routes = read('..', 'backend', 'src', 'routes', 'studentRoutes.js');
const ctrl = read('..', 'backend', 'src', 'controllers', 'studentController.js');

test('the student nav has My Report with no id anywhere in it', () => {
  assert.match(shell, /to: '\/student\/report'.*label: 'My Report'/,
    'My Report entry is missing from the student menu');
  assert.doesNotMatch(shell, /student\/report\/:/,
    'the entry must not carry an id - the id comes from the session');
});

test('the student route resolves the id from the session, never the URL', () => {
  const route = app.match(/<Route path="\/student\/report"[\s\S]*?\/>/);
  assert.ok(route, 'no /student/report route');
  assert.match(route[0], /role="student"/, 'students only');
  assert.match(route[0], /<StudentReport studentMode studentId="me"/,
    'the page must render the shared report in student mode seeded from the session');
  assert.match(route[0], /<StudentLayout>/, 'inside the student shell like every section');
});

test('the shared report takes its id from props, URL only as fallback', () => {
  assert.match(page, /studentId: propId, studentMode = false/,
    'admin usage (URL param) must keep working unchanged');
  assert.match(page, /const studentId = propId \?\? paramId;/,
    'an explicit id wins; the URL param is only the admin fallback');
});

test('admin-only actions stay hidden from the student viewing their own report', () => {
  for (const spot of ['Edit Student', 'Delete']) {
    const uses = [...page.matchAll(new RegExp(`\\{!studentMode && \\([\\s\\S]{0,400}?${spot}`, 'g'))];
    assert.ok(uses.length > 0, `"${spot}" must be gated on !studentMode`);
  }
  assert.match(page, /\{!studentMode && editOpen && editForm && \(/,
    'the edit modal must not mount for students');
});

test('the report endpoints let a student fetch ONLY their own report', () => {
  for (const path of ['/:id/report', '/:id/chess-report', '/:id/puzzle/:puzzleId/report']) {
    assert.ok(routes.includes(`router.get('${path}', reportAccess,`),
      `${path} must run the self-or-staff guard, not the admin-only gate`);
  }
  assert.match(routes, /String\(req\.params\.id\) !== 'me' && String\(req\.params\.id\) !== String\(ownId\)/,
    'anything but me-or-mine is a 403');
  assert.match(routes, /req\.params\.id = String\(ownId\)/,
    'controllers keep working on a normalized numeric id');
  assert.match(routes, /req\.selfReport = true/,
    'the guard must mark proven self-access - a student can never pass assertCoachAccess');
  for (const check of ['!req.selfReport && !(await assertCoachAccess']) {
    const hits = ctrl.split(check).length - 1;
    assert.equal(hits, 3, `all three report controllers must honor the self-access flag (found ${hits})`);
  }
  /* Admin behavior is untouched: the controllers still enforce coach scope. */
  for (const fn of ['studentReport', 'studentChessReport', 'studentPuzzleReport']) {
    const body = ctrl.match(new RegExp(`exports\\.${fn} = async[\\s\\S]*?(?=exports\\.\\w+ = |$)`));
    assert.ok(body && /assertCoachAccess\(req\.user/.test(body[0]),
      `${fn} must keep its coach-scope check`);
  }
});

test('the PDF renders from a dedicated print layout, never the visible page', () => {
  const print = read('src', 'pages', 'StudentReportPrint.jsx');
  assert.match(print, /width:\s*794|PRINT_WIDTH_PX/,
    'the print container must be a fixed A4-ish width, not the device width');
  assert.match(print, /left:\s*'-10000px'|left: '-10000px'/,
    'the print layout lives off-screen while exporting');
  assert.match(print, /data-print-block/,
    'capture works block by block, never as one tall screenshot');
  assert.match(page, /setPrintJob\(\{ chess: chessData \}\)/,
    'export mounts the print layout with data instead of flipping screen tabs');
  assert.doesNotMatch(page, /setSection\(prevSection\)/,
    'the on-screen tab is never touched by an export anymore');
});

test('homework puzzle details stay out of the PDF', () => {
  const print = read('src', 'pages', 'StudentReportPrint.jsx');
  assert.doesNotMatch(print, /HomeworkPuzzleFolder/,
    'per-puzzle answer cards must not render in print at all');
  assert.match(print, /Sorted by: Newest first/,
    'filters appear as plain text, not inputs');
  assert.doesNotMatch(print, /<button|<select|<input/,
    'no buttons, dropdowns or inputs anywhere in the print layout');
});

test('every logical page becomes its own physical page', () => {
  const print = read('src', 'pages', 'StudentReportPrint.jsx');
  assert.match(print, /pages\.forEach\(\(page, pageIdx\) => \{\s*if \(pageIdx > 0\) pdf\.addPage\(\);/,
    'the draw loop must advance to a fresh page per logical page, or everything stacks on page one');
  const drawAt = print.indexOf('/* Draw');
  const stampAt = print.indexOf('getNumberOfPages()');
  assert.ok(drawAt > 0 && stampAt > drawAt,
    'the total must come from the finished document, not before pages exist');
});

test('pages break only between cards, with headers and footers throughout', () => {
  const print = read('src', 'pages', 'StudentReportPrint.jsx');
  const css = read('src', 'index.css');
  assert.match(css, /\.rp-card\s*\{[^}]*break-inside:\s*avoid/,
    'cards carry break-inside rules (real printers too, not just the slicer)');
  assert.match(print, /\(continued\)/,
    'a section running onto another page repeats its title');
  assert.match(print, /Page \${pageNo} of \${total}/,
    'every page is stamped Page X of Y');
  assert.match(print, /exportStudentReportPdf/,
    'one exporter builds the whole file');
});

test('print charts are complete and readable', () => {
  const print = read('src', 'pages', 'StudentReportPrint.jsx');
  assert.match(print, /maxLabels=\{8\}/,
    'dense x-axes are thinned so labels cannot collide');
  assert.match(print, /hasVolume \? \(/,
    'the monthly chart renders an honest empty note instead of blank bars');
  assert.match(print, /document\.fonts\.ready/,
    'text is captured after fonts arrive, not mid-swap');
});
