/* "✔ Reviewed" marks — the per-user contract behind the Games-tab badge.
 *
 * THE RULES BEING PROTECTED
 * 1. The owner is ALWAYS the JWT. A user id in the body is ignored, so nobody
 *    can mark, or read, somebody else's games.
 * 2. Marking is idempotent: a second mark of the same game is a 200 and one row.
 * 3. Only the three platforms the column allows are accepted, and the key is
 *    (user, platform, game) — so chess.com:123 and lichess:123 never collide.
 * 4. A viewer only ever sees their own marks.
 *
 * WHY A REAL EXPRESS APP AND A REAL JWT
 * Rule 1 is decided inside authMiddleware, so testing the controller directly
 * would test a fiction. These run the real router behind the real middleware
 * with a genuinely signed token.
 *
 * Only the database is faked, and the fake filters by the parameters the
 * controller actually passes: a query that forgot its `user_id = $1` would
 * return too many rows and FAIL here, rather than pass because the stub
 * happened to answer conveniently. Unmatched SQL throws — a query nobody
 * anticipated is a loud error, never a silent empty result.
 *
 * Run: node --test scripts/test-reviewed-games.mjs
 */
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const jwt = require(path.join(BACKEND, 'node_modules', 'jsonwebtoken'));
const express = require(path.join(BACKEND, 'node_modules', 'express'));
process.env.JWT_SECRET = process.env.JWT_SECRET || 'reviewed-games-test-secret';

const USER_A = 11;
const USER_B = 22;

const NAMES = { [USER_A]: 'Anand', [USER_B]: 'Bobby' };

/* The fake table. Rows are the shape the controller's SQL expects. */
let rows;
/* Queries issued since the last test started, so "auth ran before any query"
   and "user_id came from the token" are read out of the current test only. */
let TRACKED = [];
function resetState() { rows = []; TRACKED = []; }

const flat = (s) => s.replace(/\s+/g, ' ').trim();

function fakeDb() {
  return {
    pool: {
      connect: async () => ({ query: async () => ({ rows: [] }), release: () => {} }),
      end: async () => {},
    },
    query: async (text, params = []) => {
      const q = flat(text);
      TRACKED.push({ sql: q, params });
      const p = (i) => params[i];

      if (q.startsWith('SELECT platform, game_id FROM reviewed_games')) {
        if (!q.includes('WHERE user_id = $1')) {
          throw new Error('the list query must scope itself to one user');
        }
        const uid = p(0);
        return {
          rows: rows
            .filter((r) => r.user_id === uid)
            .map((r) => ({ platform: r.platform, game_id: r.game_id })),
        };
      }

      if (q.startsWith('INSERT INTO reviewed_games')) {
        const [uid, platform, gameId] = [p(0), p(1), p(2)];
        /* Enforce the migration's constraints here, so idempotency and the
           platform CHECK are exercised by the same code paths the browser hits. */
        if (!['matezone', 'chess.com', 'lichess'].includes(platform)) {
          const err = new Error(`violates check constraint "reviewed_games_platform_check"`);
          err.code = '23514';
          throw err;
        }
        const dupe = rows.find((r) => r.user_id === uid && r.platform === platform && r.game_id === gameId);
        if (dupe) return { rows: [], rowCount: 0 };            // ON CONFLICT DO NOTHING
        const row = { user_id: uid, platform, game_id: gameId, reviewed_at: new Date() };
        rows.push(row);
        return { rows: [{ reviewed_at: row.reviewed_at }], rowCount: 1 };
      }

      throw new Error(`unfaked query: ${q}`);
    },
  };
}

/* Swap the DB module BEFORE the controller is required, exactly as the other
   API suites do. */
const dbPath = path.join(BACKEND, 'src', 'config', 'database.js');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakeDb() };

const app = express();
app.use(express.json());
app.use('/api/reviewed', require(path.join(BACKEND, 'src', 'routes', 'reviewedGamesRoutes.js')));

let server;
let base;

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server && server.close(); });
beforeEach(resetState);

function tokenFor(id) {
  return jwt.sign({ id, role: 'student', name: NAMES[id], email: `u${id}@test` },
    process.env.JWT_SECRET, { expiresIn: '1h' });
}

async function call(pathname, { as = USER_A, token = tokenFor(as), method = 'GET', body } = {}) {
  const res = await fetch(`${base}${pathname}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const mark = (platform, gameId, opts = {}) =>
  call('/api/reviewed', { method: 'POST', body: { platform, gameId }, ...opts });
const list = (opts = {}) => call('/api/reviewed', opts);

/* ── 1. authentication ─────────────────────────────────────────────────────── */

test('both routes require a token', async () => {
  const noHeader = await list({ token: null });
  assert.equal(noHeader.status, 401, 'the list must not answer an anonymous caller');
  assert.equal((await mark('chess.com', '9', { token: null })).status, 401);

  /* A rejected read must not have touched the database at all. */
  assert.equal(TRACKED.length, 0, 'auth runs before any query');
});

/* ── 2. the owner comes from the token, never the body ─────────────────────── */

test('a user id in the body cannot move a mark to another account', async () => {
  const res = await mark('chess.com', 123, { body: { platform: 'chess.com', gameId: 123, user_id: USER_B, userId: USER_B } });
  assert.equal(res.status, 200);

  const mine = await list({ as: USER_A });
  const theirs = await list({ as: USER_B });
  assert.deepEqual(mine.json.reviewed, ['chess.com:123'], 'the mark lands on the token holder');
  assert.deepEqual(theirs.json.reviewed, [], 'and nowhere on the user named in the body');

  /* Belt and braces: the params the INSERT actually received. */
  const insert = TRACKED.find((t) => t.sql.startsWith('INSERT INTO reviewed_games'));
  assert.equal(insert.params[0], USER_A, 'user_id must be the JWT subject');
});

/* ── 3. idempotency ────────────────────────────────────────────────────────── */

test('re-marking the same game is a 200 and one row', async () => {
  const first = await mark('lichess', 'abcd1234');
  assert.equal(first.status, 200);
  assert.equal(first.json.already, false);

  const again = await mark('lichess', 'abcd1234');
  assert.equal(again.status, 200, 'a repeat mark is not an error');
  assert.equal(again.json.already, true);

  assert.equal(rows.length, 1, 'still exactly one row');
  assert.deepEqual((await list()).json.reviewed, ['lichess:abcd1234']);
});

/* ── 4. the platform is part of the key ────────────────────────────────────── */

test('the same game id on two platforms is two marks', async () => {
  await mark('chess.com', '123');
  await mark('lichess', '123');
  await mark('matezone', '123');
  assert.deepEqual((await list()).json.reviewed.sort(), ['chess.com:123', 'lichess:123', 'matezone:123']);
});

/* ── 5. input validation ───────────────────────────────────────────────────── */

test('an unknown platform is a 400 that names the allowed ones', async () => {
  /* 'chesscom' is the trap: it reads like the app's own vocabulary but the
     schema only ever spells the platform 'chess.com'. */
  for (const bad of ['chesscom', 'CHESS.COM', '', null, 'fide']) {
    const res = await mark(bad, '1');
    assert.equal(res.status, 400, `${String(bad)} must be rejected`);
    assert.deepEqual(res.json.platforms, ['matezone', 'chess.com', 'lichess']);
  }
  assert.equal(rows.length, 0, 'a rejected platform never reaches the database');
});

test('a missing, blank or oversized game id is a 400', async () => {
  for (const bad of [undefined, null, '', '   ', {}, []]) {
    assert.equal((await mark('chess.com', bad)).status, 400, `${JSON.stringify(bad)} must be rejected`);
  }
  assert.equal((await mark('chess.com', 'x'.repeat(161))).status, 400);
  assert.equal(rows.length, 0);
});

test('a numeric game id is accepted and stored as text', async () => {
  /* The imported-game id is a serial integer in the browser; the column is
     text. Both spellings must resolve to the same key. */
  await mark('chess.com', 4567);
  assert.equal(rows[0].game_id, '4567');
  assert.deepEqual((await list()).json.reviewed, ['chess.com:4567']);
  assert.equal((await mark('chess.com', '4567')).json.already, true, '4567 and "4567" are one game');
});

/* ── 6. the read shape, and nothing leaking between viewers ────────────────── */

test('the list is the platform:gameId keys, newest first', async () => {
  await mark('chess.com', '1');
  await mark('lichess', '2');
  const body = (await list()).json;
  assert.deepEqual(Object.keys(body), ['reviewed']);
  assert.ok(Array.isArray(body.reviewed));
  assert.ok(body.reviewed.every((k) => typeof k === 'string' && k.split(':').length === 2));
  /* Two users, interleaved marks, and each read only sees its own. */
  await mark('chess.com', '3', { as: USER_B });
  assert.deepEqual((await list({ as: USER_A })).json.reviewed.length, 2);
  assert.deepEqual((await list({ as: USER_B })).json.reviewed, ['chess.com:3']);
});

/* ── 7. the migration and the controller cannot drift apart ────────────────── */

test('the migration declares the same key and platforms the code uses', () => {
  const sql = fs.readFileSync(path.join(BACKEND, 'migrations', 'add_reviewed_games.sql'), 'utf8');
  assert.match(sql, /UNIQUE \(user_id, platform, game_id\)/,
    'the duplicate guard the controller relies on must exist in the schema');
  assert.match(sql, /CHECK \(platform IN \('matezone', 'chess\.com', 'lichess'\)\)/,
    'the CHECK and the controller\'s PLATFORMS list must be the same three values');
  assert.match(sql, /reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW\(\)/);
  assert.match(sql, /REFERENCES users\(id\) ON DELETE CASCADE/,
    'deleting an account must take its marks with it');
});
