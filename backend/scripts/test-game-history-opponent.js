/* Regression tests for participant/opponent resolution in Recent Games
 * (GET /api/game-history -> games[], rendered by pages/GameHistory.jsx).
 *
 * Run: node scripts/test-game-history-opponent.js
 *
 * The bug: gameHistoryController decided the opponent with `g.admin_id === userId`
 * against a query that selected only the two joined NAMES, never `g.admin_id`.
 * The comparison evaluated `undefined === 30` — always false — so the opponent was
 * always reported as `admin_name`. That is correct exactly when the viewer is the
 * student, and wrong precisely when the viewer is the ADMIN, who then became
 * their own opponent. `my_color` was computed in SQL so it stayed right, which
 * is why this looked like a naming bug rather than an identity bug.
 *
 * These assert the identity rules directly against real rows, for every
 * admin_color / result combination, plus the unit-level invariants. */
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const db = require('../src/config/database');
const { resolveParticipants } = require('../src/utils/gameParticipants');

let pass = 0;
let fail = 0;
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

async function history(token) {
  const res = await fetch(`${base}/api/game-history`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

const sign = (id, role) =>
  jwt.sign({ id, role, name: 'tester', email: 't@example.invalid' }, process.env.JWT_SECRET, { expiresIn: '5m' });

async function check(name, fn) {
  try {
    await fn();
    pass += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    fail += 1;
    console.log(`  FAIL ${name}\n         ${err.message}`);
  }
}

/* ── unit level: the resolver itself, with no database involved ───────────── */

const G = (adminColor) => ({
  admin_id: 30, student_id: 31, admin_color: adminColor,
  admin_name: 'Manivel M', student_name: 'Nagavel k',
});

const unitChecks = async () => {
await check('Case A — viewer is the ADMIN and admin_color is white', () => {
  const p = resolveParticipants(G('white'), 30);
  assert.equal(p.myColor, 'white', 'myColor must be White');
  assert.equal(p.opponentId, 31, 'opponent must be the student');
  assert.equal(p.opponentName, 'Nagavel k');
});

await check('Case B — viewer is the ADMIN and admin_color is black', () => {
  const p = resolveParticipants(G('black'), 30);
  assert.equal(p.myColor, 'black', 'myColor must be Black');
  assert.equal(p.opponentName, 'Nagavel k');
});

await check('Case C — viewer is the STUDENT (the admin is the opponent)', () => {
  for (const adminColor of ['white', 'black']) {
    const p = resolveParticipants(G(adminColor), 31);
    assert.equal(p.opponentName, 'Manivel M',
      `student viewer must see the admin as opponent (admin_color=${adminColor})`);
    assert.equal(p.myColor, adminColor === 'white' ? 'black' : 'white');
  }
});

await check('admin_color is not confused with identity (all four combinations)', () => {
  /* Whichever side the admin sat on, the admin's opponent is the student and the
     student's opponent is the admin. admin_color must only ever move the labels,
     never re-point the opponent. */
  for (const adminColor of ['white', 'black']) {
    const asAdmin = resolveParticipants(G(adminColor), 30);
    const asStudent = resolveParticipants(G(adminColor), 31);
    assert.equal(asAdmin.opponentName, 'Nagavel k',
      `admin faces the student (admin_color=${adminColor})`);
    assert.equal(asStudent.opponentName, 'Manivel M',
      `student faces the admin (admin_color=${adminColor})`);
    /* And the absolute sides agree with admin_color. */
    const expectedWhite = adminColor === 'white' ? 'Manivel M' : 'Nagavel k';
    assert.equal(asAdmin.whiteName, expectedWhite, `White must be the admin's side (admin_color=${adminColor})`);
  }
});

await check('a string userId still resolves (int8-as-string drivers)', () => {
  const p = resolveParticipants(G('white'), '30');
  assert.equal(p.opponentName, 'Nagavel k', 'identity must not depend on JS number type');
  assert.equal(p.myColor, 'white');
});

await check('a non-participant gets no opponent and no colour', () => {
  const p = resolveParticipants(G('white'), 999);
  assert.equal(p.isParticipant, false);
  assert.equal(p.opponentName, null, 'must not invent an opponent');
  assert.equal(p.opponentId, null);
  assert.equal(p.myColor, null);
});

await check('the resolver refuses to return the viewer as their own opponent', () => {
  /* Defensive: if a bad row ever made the opponent resolve to the viewer, the
     helper must return null rather than echo their own name. */
  const selfGame = {
    admin_id: 30, student_id: 30, admin_color: 'white',
    admin_name: 'Manivel M', student_name: 'Manivel M',
  };
  const p = resolveParticipants(selfGame, 30);
  assert.equal(p.opponentId, null, 'self-game must not report the viewer as opponent');
  assert.equal(p.opponentName, null);
});

await check('missing participant data yields a null opponent, never a fallback name', () => {
  const p = resolveParticipants(
    { admin_id: 30, student_id: null, admin_color: 'white', admin_name: 'Manivel M', student_name: null },
    30,
  );
  assert.equal(p.opponentName, null, 'must be null, not the viewer\'s own name');
});

await check('absolute white/black sides do not depend on the viewer', () => {
  const a = resolveParticipants(G('white'), 30);
  const b = resolveParticipants(G('white'), 31);
  assert.equal(a.whiteName, b.whiteName, 'White must be the same person for both viewers');
  assert.equal(a.blackName, b.blackName);
  assert.equal(a.whiteId, 30, 'admin_color=white means the admin is White');
});
};

/* ── integration: real rows through the real endpoint ─────────────────────── */

async function main() {
await unitChecks();

const { rows: stu } = await db.query(
  `SELECT u.id AS user_id, u.name, s.id AS student_id
     FROM users u JOIN students s ON s.user_id = u.id
    WHERE u.role = 'student' ORDER BY u.id LIMIT 2`,
);
const [A, B] = stu;
const aToken = sign(A.user_id, 'student');
const bToken = sign(B.user_id, 'student');
const created = [];

async function makeGame({ adminId, studentId, adminColor, status = 'finished', result = 'white' }) {
  const r = await db.query(
    `INSERT INTO online_games (admin_id, student_id, admin_color, status, result, result_reason,
       fen, pgn, time_base_minutes, time_increment_seconds, white_ms, black_ms, is_bot,
       created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,'start','1. e4 e5 1-0 ',10,5,0,0,FALSE,NOW(),NOW()) RETURNING id`,
    [adminId, studentId, adminColor, status, result, result === 'draw' ? 'agreement' : 'checkmate'],
  );
  const id = r.rows[0].id;
  created.push(id);
  return `online_${id}`;
}

const rowFor = (data, key) => (data.games || []).find((g) => g.id === key);

try {
  /* Test 1 — current user is White (they are the admin, admin_color white). */
  await check('Test 1 — viewer is White: myColor White, opponent is the other player', async () => {
    const key = await makeGame({ adminId: A.user_id, studentId: B.user_id, adminColor: 'white', result: 'white' });
    const h = await history(aToken);
    const row = rowFor(h.data, key);
    assert.ok(row, 'the fixture game must appear');
    assert.equal(row.myColor, 'white', 'viewer sat White');
    assert.equal(row.opponentName, B.name, 'opponent must be the student');
    assert.equal(row.opponentName, A.name === row.opponentName ? 'SELF' : row.opponentName,
      'must not be the viewer');
  });

  /* Test 2 — current user is Black (they are the admin, admin_color black). */
  await check('Test 2 — viewer is Black: myColor Black, opponent is the other player', async () => {
    const key = await makeGame({ adminId: A.user_id, studentId: B.user_id, adminColor: 'black', result: 'white' });
    const h = await history(aToken);
    const row = rowFor(h.data, key);
    assert.equal(row.myColor, 'black', 'viewer sat Black');
    assert.equal(row.opponentName, B.name, 'opponent must be the student');
  });

  /* Test 3 — reverse perspective on the SAME game. */
  await check('Test 3 — reverse perspective: the two viewers are exact mirrors', async () => {
    const key = await makeGame({ adminId: A.user_id, studentId: B.user_id, adminColor: 'black', result: 'black' });
    const ha = await history(aToken);
    const hb = await history(bToken);
    const ra = rowFor(ha.data, key);
    const rb = rowFor(hb.data, key);
    assert.ok(ra && rb, 'both viewers must see the game');
    assert.equal(ra.myColor, 'black');
    assert.equal(rb.myColor, 'white', 'the two sides must be opposite');
    assert.equal(ra.opponentName, B.name, "A's opponent must be B");
    assert.equal(rb.opponentName, A.name, "B's opponent must be A");
    /* A.opponent === B.player, B.opponent === A.player */
    assert.equal(ra.opponentName, rb.opponentName === ra.opponentName ? 'BAD' : B.name);
    assert.equal(rb.opponentName, A.name);
  });

  /* Tests 4-7 — the result must not influence opponent resolution. */
  for (const [label, result] of [['Draw', 'draw'], ['Win', 'white'], ['Loss', 'black'], ['Abandoned', 'abandoned']]) {
    await check(`Test — ${label}: opponent is still the other player`, async () => {
      const key = await makeGame({
        adminId: A.user_id, studentId: B.user_id, adminColor: 'white', result,
        status: 'finished',
      });
      const ha = await history(aToken);
      const hb = await history(bToken);
      assert.equal(rowFor(ha.data, key).opponentName, B.name, `A must face B on a ${label.toLowerCase()}`);
      assert.equal(rowFor(hb.data, key).opponentName, A.name, `B must face A on a ${label.toLowerCase()}`);
    });
  }

  /* Test 8 — the viewer is the STUDENT, so the admin is the opponent. */
  await check('Test 8 — viewer is the student: the admin is the opponent', async () => {
    const key = await makeGame({ adminId: B.user_id, studentId: A.user_id, adminColor: 'white', result: 'black' });
    const h = await history(aToken);
    const row = rowFor(h.data, key);
    assert.equal(row.myColor, 'black', 'the student sits opposite a white admin');
    assert.equal(row.opponentName, B.name, 'opponent must be the admin');
  });

  /* Test 9 — the invariant, over every online game the viewer has. */
  await check('Test 9 — opponent.id is never the viewer, across the whole history', async () => {
    for (const [token, me] of [[aToken, A], [bToken, B]]) {
      const h = await history(token);
      const online = (h.data.games || []).filter((g) => g.type === 'online');
      assert.ok(online.length > 0, 'expected some online games');
      for (const g of online) {
        assert.notEqual(g.opponentName, me.name,
          `${g.id}: the viewer must never be their own opponent`);
        if (g.opponentId != null) {
          assert.notEqual(Number(g.opponentId), me.user_id,
            `${g.id}: opponent.id must differ from the viewer`);
        }
      }
    }
  });

  await check('score-sheet side names stay viewer-independent', async () => {
    const key = await makeGame({ adminId: A.user_id, studentId: B.user_id, adminColor: 'black', result: 'black' });
    const ha = await history(aToken);
    const hb = await history(bToken);
    const ra = rowFor(ha.data, key);
    const rb = rowFor(hb.data, key);
    assert.equal(ra.whiteName, rb.whiteName, 'White must be the same name for both viewers');
    assert.equal(ra.blackName, rb.blackName, 'Black must be the same name for both viewers');
    assert.equal(ra.whiteName, B.name, 'admin_color=black means the student is White');
  });

  await check('computer games keep their own opponent label (not forced through the resolver)', async () => {
    const h = await history(aToken);
    const comp = (h.data.games || []).filter((g) => g.type === 'computer');
    for (const c of comp) {
      assert.match(c.opponentName, /^Computer Lv\d+$/,
        'a computer game must still say Computer LvN');
    }
  });

  await check('an unauthenticated history request is refused', async () => {
    const h = await history(null);
    assert.equal(h.status, 401, `expected 401, got ${h.status}`);
  });
} finally {
  for (const id of created) {
    await db.query('DELETE FROM online_games WHERE id = $1', [id]);
  }
  server.close();
  db.pool?.end?.().catch(() => {});
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error('harness error:', e);
  server.close();
  process.exit(1);
});
