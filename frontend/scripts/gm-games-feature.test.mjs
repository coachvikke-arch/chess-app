// Regression test: the `gm_games` Feature Access switch must actually reveal
// something on BOTH sides.
//   run with: node --test scripts/gm-games-feature.test.mjs   (from frontend/)
//
// The bug this guards: the switch was registered and the coach sidebar used it
// (`/admin/gm-games`), but the STUDENT menu had no entry and no route at all —
// so a Super Admin could turn "GM Games" on for students and see nothing happen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');

const studentShell = read('src', 'components', 'StudentAppShell.jsx');
const sidebar = read('src', 'components', 'Sidebar.jsx');
const app = read('src', 'App.jsx');
const gmPage = read('src', 'pages', 'AdminGmGames.jsx');
const routes = read('..', 'backend', 'src', 'routes', 'gmGameRoutes.js');

test('both menus expose GM Games, gated on the same feature key', () => {
  assert.match(sidebar, /to: '\/admin\/gm-games'.*feature: 'gm_games'/);
  assert.match(studentShell, /to: '\/student\/gm-games'.*feature: 'gm_games'/);
});

test('the student route is gated and renders the library read-only', () => {
  const route = app.match(/<Route path="\/student\/gm-games"[\s\S]*?\/>/);
  assert.ok(route, 'no /student/gm-games route');
  assert.match(route[0], /role="student"/, 'students only');
  assert.match(route[0], /FeatureRoute feature="gm_games"/,
    'a direct URL must not bypass the switch');
  assert.match(route[0], /<AdminGmGames readOnly \/>/,
    'the student view must not expose the import/delete controls');
});

test('readOnly removes the import and delete controls', () => {
  assert.match(gmPage, /function AdminGmGames\(\{ readOnly = false \}\)/);
  assert.match(gmPage, /\{!readOnly && \(\s*<button type="button" onClick=\{\(\) => setShowPlayers/,
    'the pgnmentor importer must be coach-only');
  assert.match(gmPage, /\{!readOnly && \(\s*<button type="button" onClick=\{\(\) => setShowImport/,
    'the PGN importer must be coach-only');
  assert.match(gmPage, /\{game\.isImported && !readOnly/,
    'the per-game delete affordance must be coach-only');
});

test('the server keeps import and delete admin-only behind the same switch', () => {
  assert.match(routes, /router\.use\(requireFeature\('gm_games'\)\)/);
  for (const verb of ['post', 'delete']) {
    for (const line of routes.match(new RegExp(`router\\.${verb}\\([^\\n]+`, 'g')) || []) {
      assert.match(line, /roleMiddleware\('admin'\)/,
        `a student must not be able to reach ${verb}: ${line}`);
    }
  }
});