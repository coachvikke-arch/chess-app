// Pins the profile-mutation contract (backend/src/services/profileService.js +
// the photo/avatar/preferences handlers).
//   run with: npm run test:profile   (from backend/)
//
// In the deployed app a new photo or avatar only appeared after logging out and
// back in. The frontend had nothing to publish: half of these endpoints answered
// with a single field (`{ avatar_config }`), and the ones that did send a user
// sent a short UPDATE ... RETURNING list missing the student, coach and board
// columns — so `setUser(res.data.user)` quietly truncated the cached profile.
//
// Every mutation now answers with the same object GET /auth/me does. These tests
// run against an in-memory pg stand-in that keeps one users row, applies the
// SET clause for real, and serves the shared profile SELECT — no database is
// contacted and no live row is touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const BACKEND = join(dirname(fileURLToPath(import.meta.url)), '..');
const AUTH = join(BACKEND, 'src', 'controllers', 'authController.js');
const SERVICE = join(BACKEND, 'src', 'services', 'profileService.js');
const db = require(join(BACKEND, 'src', 'config', 'database.js'));

const PROFILE_COLUMNS = [
  'id', 'name', 'email', 'username', 'phone', 'country_code', 'role', 'profile_image',
  'avatar_config', 'board_theme', 'board_light_color', 'board_dark_color', 'piece_set',
  'board_frame', 'created_at', 'updated_at', 'must_change_password',
  'recommended_board_theme', 'student_id', 'group_id', 'active', 'nickname', 'birthdate',
  'parent_name', 'gender', 'preferred_language', 'group_name', 'coach_name', 'coach_names',
];

/** A fresh controller — it captures fetchProfile at require time, so both modules
    have to be purged or a test inherits the previous test's stub. */
function loadAuth() {
  delete require.cache[require.resolve(SERVICE)];
  delete require.cache[require.resolve(AUTH)];
  return require(AUTH);
}

function resStub() {
  const out = { code: null, body: null };
  out.status = (n) => { out.code = n; return out; };
  out.json = (b) => { out.body = b; return out; };
  return out;
}

/**
 * Applies `SET a = $1, b = NULL, updated_at = NOW()` against the held row, which
 * is what makes "the response shows the picture I just uploaded" a real
 * behaviour test rather than a text search.
 */
function applySet(row, setClause, params) {
  for (const part of setClause.split(',')) {
    const m = part.trim().match(/^(\w+)\s*=\s*(.+)$/);
    if (!m) throw new Error(`unparsable SET term: ${part}`);
    const [, column, rawValue] = m;
    if (rawValue === 'NOW()') { row[column] = '2026-11-03T00:00:00.000Z'; continue; }
    if (rawValue === 'NULL') { row[column] = null; continue; }
    const ref = rawValue.match(/^\$(\d+)$/);
    if (!ref) throw new Error(`unparsable SET value: ${rawValue}`);
    const value = params[Number(ref[1]) - 1];
    row[column] = typeof value === 'object' && value !== null ? { ...value } : value;
  }
}

/**
 * One users row plus every query the profile endpoints can issue.
 * `columns` names the board-preference columns the schema install is asked about.
 */
function stubDb(row) {
  const state = { writes: [], reads: 0 };
  db.query = async (sql, params = []) => {
    const flat = sql.replace(/\s+/g, ' ').trim();
    if (flat.includes('information_schema.columns')) {
      const pairs = [...flat.matchAll(/\('(\w+)', '(\w+)'\)/g)];
      return { rows: pairs.map(([, t, c]) => ({ table_name: t, column_name: c })) };
    }
    if (flat.startsWith('ALTER TABLE')) return { rows: [] };

    /* CTE write (photo + avatar handlers): RETURNING hands back the previous
       image so the handler can delete the file it replaced. */
    const cte = flat.match(/^WITH previous AS .*UPDATE users\s+SET (.+?)\s+FROM previous\s+WHERE users\.id = \$(\d+)\s+RETURNING (.+)$/);
    if (cte) {
      const previousImage = row.profile_image;
      applySet(row, cte[1], params);
      state.writes.push(cte[1]);
      const returned = cte[3].split(',').map((s) => s.trim());
      const out = { previous_image: previousImage };
      if (returned.some((r) => /\busers\.id$/.test(r))) out.id = row.id;
      return { rows: [out] };
    }

    /* Preferences write: `UPDATE users SET …, updated_at = NOW() WHERE id = $1 RETURNING id`. */
    const plain = flat.match(/^UPDATE users SET (.+?) WHERE id = \$(\d+) RETURNING (\w+)$/);
    if (plain) {
      applySet(row, plain[1], params);
      state.writes.push(plain[1]);
      return { rows: [{ [plain[3]]: row.id }] };
    }

    if (flat.startsWith('SELECT u.id, u.name')) {
      state.reads += 1;
      /* The shared profile read answers every column /auth/me has ever returned.
         A handler that stopped using it would fail the key-set assertions below. */
      const out = {};
      for (const c of PROFILE_COLUMNS) out[c] = row[c] ?? null;
      out.coach_names = [];
      return { rows: [out] };
    }
    throw new Error(`unhandled stub query: ${flat.slice(0, 90)}`);
  };
  return state;
}

const baseRow = () => ({
  id: 7, name: 'Test', email: 't@e.com', username: 'test', phone: null, country_code: 'IN',
  role: 'student', profile_image: null, avatar_config: null,
  board_theme: 'classic-green', board_light_color: null, board_dark_color: null,
  piece_set: 'cburnett', board_frame: true,
  created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
  must_change_password: false, recommended_board_theme: null, student_id: 3, group_id: 1,
  active: true, nickname: 'Ty', birthdate: null, parent_name: null, gender: null,
  preferred_language: null, group_name: 'A', coach_name: 'C',
});

const req = (body, file) => ({ user: { id: 7 }, body, params: {}, file });

test('GET /auth/me answers with every profile column', async () => {
  const row = baseRow();
  stubDb(row);
  const out = resStub();
  await loadAuth().me(req({}), out);
  assert.equal(out.code, null);
  assert.deepEqual(Object.keys(out.body.user).sort(), [...PROFILE_COLUMNS].sort());
});

test('uploading a photo returns the full user, avatar cleared', async () => {
  const row = baseRow();
  row.avatar_config = { basePiece: 'pawn' };
  stubDb(row);
  const out = resStub();
  await loadAuth().uploadPhoto(req({}, { filename: 'avatar-1-a.jpg', path: '/tmp/avatar-1-a.jpg' }), out);
  assert.equal(out.code, null);
  assert.equal(out.body.profile_image, '/uploads/avatar-1-a.jpg');
  assert.equal(out.body.user.profile_image, '/uploads/avatar-1-a.jpg');
  /* One image per profile: the photo wins and the avatar goes, in the answer as
     well as in the row. */
  assert.equal(out.body.user.avatar_config, null);
  assert.equal(row.avatar_config, null);
  assert.deepEqual(Object.keys(out.body.user).sort(), [...PROFILE_COLUMNS].sort());
});

test('removing a photo returns the full user with both fields null', async () => {
  const row = baseRow();
  row.profile_image = '/uploads/avatar-old.jpg';
  stubDb(row);
  const out = resStub();
  await loadAuth().removePhoto(req({}), out);
  assert.equal(out.code, null);
  assert.equal(out.body.profile_image, null);
  assert.equal(out.body.user.profile_image, null);
  assert.equal(out.body.user.avatar_config, null);
  assert.deepEqual(Object.keys(out.body.user).sort(), [...PROFILE_COLUMNS].sort());
});

test('saving an avatar returns the full user with the photo dropped', async () => {
  const row = baseRow();
  row.profile_image = '/uploads/avatar-old.jpg';
  stubDb(row);
  const out = resStub();
  await loadAuth().updateMyAvatar(req({ avatar_config: { basePiece: 'knight', bodyColor: '#1d4ed8' } }), out);
  assert.equal(out.code, null);
  assert.deepEqual(out.body.avatar_config, { basePiece: 'knight', bodyColor: '#1d4ed8' });
  assert.deepEqual(out.body.user.avatar_config, { basePiece: 'knight', bodyColor: '#1d4ed8' });
  assert.equal(out.body.user.profile_image, null);
  assert.deepEqual(Object.keys(out.body.user).sort(), [...PROFILE_COLUMNS].sort());
});

test('removing an avatar returns the full user', async () => {
  const row = baseRow();
  row.avatar_config = { basePiece: 'knight' };
  row.profile_image = '/uploads/avatar-old.jpg';
  stubDb(row);
  const out = resStub();
  await loadAuth().resetMyAvatar(req({}), out);
  assert.equal(out.code, null);
  assert.equal(out.body.avatar_config, null);
  assert.equal(out.body.user.avatar_config, null);
  assert.equal(out.body.user.profile_image, null);
  assert.deepEqual(Object.keys(out.body.user).sort(), [...PROFILE_COLUMNS].sort());
});

test('a frame-only preferences save keeps the student and coach fields intact', async () => {
  const row = baseRow();
  stubDb(row);
  const out = resStub();
  await loadAuth().updatePreferences(req({ boardFrame: false }), out);
  assert.equal(out.code, null);
  assert.equal(out.body.user.board_frame, false);
  /* The old short RETURNING list answered this with a user that had no nickname,
     no student_id, no coach_names — and the caller wrote it over the cache. */
  assert.deepEqual(Object.keys(out.body.user).sort(), [...PROFILE_COLUMNS].sort());
  assert.equal(out.body.user.student_id, 3);
  assert.equal(out.body.user.nickname, 'Ty');
});

test('no handler answers a profile mutation from its own column list', () => {
  const source = readFileSync(AUTH, 'utf8');
  /* Every mutation reaches the shared read; nothing re-derives the user from an
     UPDATE's RETURNING any more. */
  assert.doesNotMatch(source, /RETURNING users\.id, users\.name/);
  assert.equal((source.match(/res\.json\(\{ user: await fetchProfile\(req\.user\.id\)/g) || []).length, 5);
  assert.doesNotMatch(source, /FROM users u\s+LEFT JOIN students s/);
  assert.match(readFileSync(SERVICE, 'utf8'), /FROM users u\s+LEFT JOIN students s/);
});
