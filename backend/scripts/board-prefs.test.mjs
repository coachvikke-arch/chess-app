// Pins the board-preference schema install (backend/src/services/boardPreferenceService.js).
//   run with: npm run test:board-prefs   (from backend/)
//
// In production, Settings could not save a theme, a piece set or the frame, and
// the app lost the signed-in user on every reload:
//
//   PATCH /api/auth/me 500  error: column "board_light_color" does not exist
//   GET   /api/auth/me 500
//
// because `users.board_light_color` / `board_dark_color` are created by
// migrations/add_board_colors.sql, a file that database was never handed. The
// service now installs what those two queries need, and these tests drive it
// against an in-memory pg stand-in — no database is contacted, no live row is
// touched.
//
// The properties that matter: a healthy database is left completely alone, only
// the absent columns get DDL, a failure is not remembered, and both handlers
// reach the install before they name the columns.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const BACKEND = join(dirname(fileURLToPath(import.meta.url)), '..');
const SERVICE = join(BACKEND, 'src', 'services', 'boardPreferenceService.js');
const CONTROLLER = join(BACKEND, 'src', 'controllers', 'authController.js');
const db = require(join(BACKEND, 'src', 'config', 'database.js'));

/**
 * A fresh service — and, when asked, a controller bound to it. authController
 * captures the function at require time, so a test that drives the handlers has
 * to purge both modules or it inherits the previous test's memoised promise.
 */
function load({ controller = false } = {}) {
  delete require.cache[require.resolve(SERVICE)];
  if (controller) delete require.cache[require.resolve(CONTROLLER)];
  const service = require(SERVICE);
  return { ...service, auth: controller ? require(CONTROLLER) : null };
}

/**
 * pg stand-in for `information_schema` plus the two preference queries.
 * `present` is what the database has beforehand, as ['users.board_theme', …].
 */
function stubDb({ present = [] } = {}) {
  const held = new Set(present);
  const state = { ddl: [], introspect: 0, updates: [], selects: [] };
  db.query = async (sql, params = []) => {
    const flat = sql.replace(/\s+/g, ' ').trim();
    if (flat.includes('information_schema.columns')) {
      state.introspect += 1;
      /* Pair matching, exactly like the real JOIN: a name held by the other
         table must not count as present. */
      const pairs = [...flat.matchAll(/\('(\w+)', '(\w+)'\)/g)];
      return { rows: pairs.filter(([, t, c]) => held.has(`${t}.${c}`)).map(([, t, c]) => ({ table_name: t, column_name: c })) };
    }
    if (flat.startsWith('ALTER TABLE')) {
      const m = flat.match(/^ALTER TABLE (\w+) ADD COLUMN IF NOT EXISTS (\w+)/);
      if (!m) throw new Error(`unexpected DDL: ${flat}`);
      held.add(`${m[1]}.${m[2]}`);
      state.ddl.push(flat);
      return { rows: [] };
    }
    if (flat.startsWith('UPDATE users SET')) {
      state.updates.push({ sql: flat, params });
      /* A column the RETURNING list names but the table lacks is what made
         production answer 500 even for a frame-only save. */
      for (const c of ['board_light_color', 'board_dark_color', 'board_frame', 'board_theme', 'piece_set']) {
        if (flat.includes(c) && !held.has(`users.${c}`)) {
          throw Object.assign(new Error(`column "${c}" does not exist`), { code: '42703' });
        }
      }
      return { rows: [{ id: params[0], name: 'Test', board_theme: 'classic-green', board_frame: true }] };
    }
    if (flat.startsWith('SELECT u.id, u.name')) {
      state.selects.push({ sql: flat, params });
      for (const [c, key] of [
        ['board_light_color', 'users.board_light_color'],
        ['default_board_theme', 'students.default_board_theme'],
      ]) {
        if (flat.includes(c) && !held.has(key)) {
          throw Object.assign(new Error(`column "${c}" does not exist`), { code: '42703' });
        }
      }
      return { rows: [{ id: params[0], name: 'Test' }] };
    }
    throw new Error(`unhandled stub query: ${flat.slice(0, 80)}`);
  };
  return state;
}

const HEALTHY = [
  'users.board_theme', 'users.piece_set', 'users.board_frame',
  'users.board_light_color', 'users.board_dark_color', 'students.default_board_theme',
];

/** The production database: everything add_board_colors.sql would have added is missing. */
const PROD = ['users.board_theme', 'users.piece_set', 'users.board_frame', 'students.default_board_theme'];

const res = () => {
  const out = { code: null, body: null };
  out.status = (n) => { out.code = n; return out; };
  out.json = (b) => { out.body = b; return out; };
  return out;
};

test('a fully migrated database is not touched', async () => {
  const state = stubDb({ present: HEALTHY });
  const { ensureBoardPreferences } = load();
  assert.deepEqual(await ensureBoardPreferences(), []);
  assert.equal(state.ddl.length, 0);
});

test('the production database gets exactly the two absent columns', async () => {
  const state = stubDb({ present: PROD });
  const { ensureBoardPreferences } = load();
  assert.deepEqual(await ensureBoardPreferences(), ['users.board_light_color', 'users.board_dark_color']);
  assert.deepEqual(state.ddl, [
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS board_light_color VARCHAR(7)',
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS board_dark_color VARCHAR(7)',
  ]);
});

test('the same name on the other table does not excuse the missing column', async () => {
  /* users.default_board_theme is not what the query asks for — matching on the
     column name alone would skip the real ALTER and leave the 500 in place. */
  const state = stubDb({ present: [...PROD, 'users.default_board_theme'] });
  const { ensureBoardPreferences } = load();
  assert.deepEqual(await ensureBoardPreferences(), ['users.board_light_color', 'users.board_dark_color']);
  assert.deepEqual(state.ddl, [
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS board_light_color VARCHAR(7)',
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS board_dark_color VARCHAR(7)',
  ]);
});

test('the install runs once, however many calls ask for it', async () => {
  const state = stubDb({ present: PROD });
  const { ensureBoardPreferences } = load();
  const [a, b] = await Promise.all([ensureBoardPreferences(), ensureBoardPreferences()]);
  assert.deepEqual(a, ['users.board_light_color', 'users.board_dark_color']);
  assert.deepEqual(b, a); // the same memoised run reporting the same columns
  await ensureBoardPreferences();
  assert.equal(state.introspect, 1);
  assert.equal(state.ddl.length, 2);
});

test('a failed install is not remembered', async () => {
  const state = stubDb({ present: PROD });
  const { ensureBoardPreferences } = load();
  const real = db.query;
  let poisoned = true;
  db.query = async (sql, params) => {
    if (poisoned && sql.includes('ADD COLUMN IF NOT EXISTS board_dark_color')) {
      poisoned = false;
      throw new Error('cannot execute ALTER TABLE in a read-only transaction');
    }
    return real(sql, params);
  };
  await assert.rejects(ensureBoardPreferences(), /read-only transaction/);
  assert.deepEqual(await ensureBoardPreferences(), ['users.board_dark_color']);
  assert.equal(poisoned, false);
  assert.equal(state.introspect, 2, 'the retry reads the schema again');
});

test('PATCH /auth/me survives the production database, frame-only save included', async () => {
  const state = stubDb({ present: PROD });
  const { auth } = load({ controller: true });
  for (const body of [{ boardFrame: false }, { boardTheme: 'pearl-lagoon' }, { boardLightColor: '#FFFFFF', boardDarkColor: '#4B7399' }]) {
    const out = res();
    await auth.updatePreferences({ body, user: { id: 7 } }, out);
    /* A save answers with res.json(), which never passes through status() — so
       "no error code and a user object" IS the 200 here. */
    assert.equal(out.code, null, `${JSON.stringify(body)} → ${JSON.stringify(out.body)}`);
    assert.equal(out.body.user.id, 7);
  }
  assert.equal(state.updates.length, 3);
  assert.equal(state.ddl.length, 2, 'the install runs for the first save and never again');
});

test('PATCH /auth/me still validates before it reaches the install', async () => {
  const state = stubDb({ present: PROD });
  const { auth } = load({ controller: true });
  const out = res();
  await auth.updatePreferences({ body: { boardFrame: 'false' }, user: { id: 7 } }, out);
  assert.equal(out.code, 400);
  assert.match(out.body.message, /boolean/);
  assert.equal(state.introspect, 0);
});

test('GET /auth/me answers with the profile on the production database', async () => {
  const state = stubDb({ present: PROD });
  const { auth } = load({ controller: true });
  const out = res();
  await auth.me({ user: { id: 7 } }, out);
  assert.equal(out.code, null);
  assert.equal(out.body.user.id, 7);
  assert.equal(state.ddl.length, 2);
});

test('the install is additive: nothing here can rewrite a stored preference', () => {
  const source = readFileSync(SERVICE, 'utf8');
  const { COLUMNS } = require(SERVICE);
  assert.equal(COLUMNS.length, 6);
  for (const c of COLUMNS) {
    assert.match(c.sql, /^ALTER TABLE \w+ ADD COLUMN IF NOT EXISTS \w+/, c.sql);
    assert.doesNotMatch(c.sql, /DROP/i, c.sql);
  }
  assert.doesNotMatch(source, /DROP TABLE|TRUNCATE|DELETE FROM|UPDATE users SET/);
});

test('both handlers reach the install, and the deploy warms it at start-up', () => {
  const source = readFileSync(CONTROLLER, 'utf8');
  assert.equal((source.match(/await ensureBoardPreferences\(\);/g) || []).length, 2);
  assert.match(readFileSync(join(BACKEND, 'server.js'), 'utf8'), /ensureBoardPreferences\(\)/);
});
