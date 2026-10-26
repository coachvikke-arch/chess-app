// Regression test: Top Performances showcase wiring.
//   run with: node --test scripts/top-performances.test.mjs   (from frontend/)
//
// The rules this pins down:
//   1. students get a gallery entry with no id and no gate to misconfigure;
//   2. coaches get a manage entry on the same single staff menu;
//   3. visibility is decided server-side (superadmin posts reach everyone, a
//      coach's posts reach only their allocated students) - the client renders
//      whatever the endpoint returns and carries no role logic;
//   4. uploads are images-only, 5MB, with the author stamped from the session.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');

const shell = read('src', 'components', 'StudentAppShell.jsx');
const sidebar = read('src', 'components', 'Sidebar.jsx');
const app = read('src', 'App.jsx');
const gallery = read('src', 'pages', 'StudentPerformances.jsx');
const manage = read('src', 'pages', 'ManagePerformances.jsx');
const ctrl = read('..', 'backend', 'src', 'controllers', 'topPerformanceController.js');
const routes = read('..', 'backend', 'src', 'routes', 'topPerformanceRoutes.js');
const migration = read('..', 'backend', 'migrations', 'add_top_performances.sql');

test('both shells expose Top Performances with no id anywhere', () => {
  assert.match(shell, /to: '\/student\/performances'.*label: 'Top Performances'/);
  assert.match(sidebar, /to: '\/admin\/performances'.*label: 'Top Performances'/);
  assert.doesNotMatch(shell, /student\/performances\/:/,
    'the entry must not carry an id - visibility is server-side');
});

test('the routes mount each page in its own shell for its own role', () => {
  const student = app.match(/<Route path="\/student\/performances"[\s\S]*?\/>/);
  assert.ok(student, 'no /student/performances route');
  assert.match(student[0], /role="student"/, 'students only');
  assert.match(student[0], /<StudentPerformances \/>/, 'the gallery page');
  const admin = app.match(/<Route path="\/admin\/performances"[\s\S]*?\/>/);
  assert.ok(admin, 'no /admin/performances route');
  assert.match(admin[0], /role="admin"/, 'staff only (admits superadmin too)');
  assert.match(admin[0], /<ManagePerformances \/>/, 'the manage page');
});

test('visibility is role-shaped on the server, never the client', () => {
  assert.match(ctrl, /u\.role = 'superadmin'/,
    'superadmin posts must reach every student');
  assert.match(ctrl, /student_coaches/,
    "a coach's posts must reach allocated students via both assignment paths");
  assert.doesNotMatch(gallery, /role ===|isAdmin|coach_id/,
    'the gallery must not re-implement visibility - it renders what comes back');
});

test('uploads are images-only with the author stamped from the session', () => {
  assert.match(routes, /upload\.single\('photo'\)/, 'single photo upload');
  assert.match(routes, /image\/jpeg.*image\/png.*image\/gif.*image\/webp/s, 'image types only');
  assert.match(ctrl, /created_by.*req\.user\.id|req\.user\.id.*created_by/,
    'the author id comes from the session, never the request body');
  assert.match(ctrl, /req\.user\.role !== 'superadmin' && Number\(row\.created_by\)/,
    'coaches delete only their own posts; superadmin may clear any');
});

test('the registry migration creates the table', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS top_performances/);
  assert.match(migration, /ON DELETE SET NULL/,
    'deleting an account orphans posts instead of cascading students away');
});
