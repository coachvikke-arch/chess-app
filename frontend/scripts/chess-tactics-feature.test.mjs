// Regression test: the `chess_tactics` Feature Access switch must actually
// reveal something on BOTH sides.
//   run with: node --test scripts/chess-tactics-feature.test.mjs   (from frontend/)
//
// Mirrors gm-games-feature.test.mjs: a switch that only gates one shell lets a
// Super Admin turn Tactics on for a role and see nothing happen there. (There
// is no server side to gate — tactic progress lives in localStorage — so this
// covers menus, routes and the registry only.)
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
const featureAccess = read('src', 'pages', 'FeatureAccess.jsx');

test('both menus expose Chess Tactics, gated on the same feature key', () => {
  assert.match(sidebar, /to: '\/admin\/tactics'.*feature: 'chess_tactics'/);
  assert.match(studentShell, /to: '\/student\/tactics'.*feature: 'chess_tactics'/);
});

test('both shell routes are gated so a direct URL cannot bypass the switch', () => {
  const student = app.match(/<Route path="\/student\/tactics"[\s\S]*?\/>/);
  assert.ok(student, 'no /student/tactics route');
  assert.match(student[0], /FeatureRoute feature="chess_tactics"/,
    'a direct student URL must not bypass the switch');
  const admin = app.match(/<Route path="\/admin\/tactics"[\s\S]*?\/>/);
  assert.ok(admin, 'no /admin/tactics route');
  assert.match(admin[0], /FeatureRoute feature="chess_tactics"/,
    'a direct coach URL must not bypass the switch');
});

test('the switch is listed for both roles in Feature Access', () => {
  assert.match(featureAccess, /'chess_tactics'/,
    'BOTH_ROLES must include chess_tactics or one role loses its switch');
});

test('the registry migration registers the key, on for both roles', () => {
  const migration = read('..', 'backend', 'migrations', 'add_chess_tactics_feature.sql');
  assert.match(migration, /'chess_tactics', 'Chess Tactics'/);
  assert.match(migration, /SELECT f\.id, r\.role, TRUE/,
    'Tactics already ships visible - the seed must preserve access, not revoke it');
});
