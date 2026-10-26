/* End-to-end check of the Super Admin sidebar order over real HTTP with real
 * JWTs: who may read it, who may write it, that a write is visible to OTHER
 * users (the whole point of the feature), and the validation edges.

   Run: node scripts/test-sidebar-api.js                              */

const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const db = require('../src/config/database');
const svc = require('../src/services/sidebarService');

let pass = 0;
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

async function api(path, token, opts = {}) {
  const res = await fetch(`${base}${path}`, {
    method: opts.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  return { status: res.status, data };
}

const sign = (id, role) =>
  jwt.sign({ id, role, name: 'tester', email: 't@example.invalid' }, process.env.JWT_SECRET, {
    expiresIn: '5m',
  });

const check = async (name, fn) => {
  try {
    await fn();
    console.log(`PASS  ${name}`);
    pass += 1;
  } catch (err) {
    console.log(`FAIL  ${name}\n      ${err.message}`);
    process.exitCode = 1;
  }
};

async function main() {
  /* Real user ids: sidebar_order.updated_by is a real FK, so a synthetic id
     would fail the write with a 500 and mask the behaviour under test. */
  const { rows: su } = await db.query("SELECT id FROM users WHERE role = 'superadmin' ORDER BY id LIMIT 1");
  const { rows: co } = await db.query("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1");
  const { rows: stu } = await db.query("SELECT id FROM users WHERE role = 'student' ORDER BY id LIMIT 1");
  assert.ok(su.length, 'need a superadmin to exist');
  assert.ok(co.length, 'need a coach (admin) to exist');
  assert.ok(stu.length, 'need a student to exist');

  const superToken = sign(su[0].id, 'superadmin');
  const adminToken = sign(co[0].id, 'admin');
  const studentToken = sign(stu[0].id, 'student');

  const A = '/admin/dashboard';
  const B = '/admin/reports';
  const C = '/admin/settings';

  /* ── the read gate ── */
  await check('GET without a token is 401', async () => {
    const { status } = await api('/api/sidebar');
    assert.equal(status, 401);
  });

  await check('GET as a student is 200 and reports both menus', async () => {
    const { status, data } = await api('/api/sidebar', studentToken);
    assert.equal(status, 200);
    assert.deepEqual(Object.keys(data.orders).sort(), ['admin', 'student']);
  });

  /* ── the write gate ── */
  await check('PUT as a student is 403', async () => {
    const { status } = await api('/api/sidebar/order', studentToken, {
      method: 'PUT',
      body: { menu: 'admin', keys: [A, B] },
    });
    assert.equal(status, 403);
  });

  await check('PUT as a coach is 403 (only Super Admin reorders for everyone)', async () => {
    const { status } = await api('/api/sidebar/order', adminToken, {
      method: 'PUT',
      body: { menu: 'admin', keys: [A, B] },
    });
    assert.equal(status, 403);
  });

  await check('PUT without a token is 401', async () => {
    const { status } = await api('/api/sidebar/order', null, {
      method: 'PUT',
      body: { menu: 'admin', keys: [A, B] },
    });
    assert.equal(status, 401);
  });

  /* ── validation ── */
  await check('an unknown menu is 400', async () => {
    const { status } = await api('/api/sidebar/order', superToken, {
      method: 'PUT',
      body: { menu: 'teachers', keys: [A] },
    });
    assert.equal(status, 400);
  });

  await check('keys that are not an array is 400', async () => {
    const { status } = await api('/api/sidebar/order', superToken, {
      method: 'PUT',
      body: { menu: 'admin', keys: A },
    });
    assert.equal(status, 400);
  });

  await check('a non-string key is 400', async () => {
    const { status } = await api('/api/sidebar/order', superToken, {
      method: 'PUT',
      body: { menu: 'admin', keys: [A, 7] },
    });
    assert.equal(status, 400);
  });

  await check('a blank key is 400', async () => {
    const { status } = await api('/api/sidebar/order', superToken, {
      method: 'PUT',
      body: { menu: 'admin', keys: [A, '   '] },
    });
    assert.equal(status, 400);
  });

  await check('more keys than the cap is 400', async () => {
    const many = Array.from({ length: 201 }, (_, i) => `/x/${i}`);
    const { status } = await api('/api/sidebar/order', superToken, {
      method: 'PUT',
      body: { menu: 'admin', keys: many },
    });
    assert.equal(status, 400);
  });

  await check('a rejected write leaves the stored order untouched', async () => {
    await api('/api/sidebar/order', superToken, { method: 'PUT', body: { menu: 'admin', keys: [C, B, A] } });
    await api('/api/sidebar/order', superToken, { method: 'PUT', body: { menu: 'admin', keys: [A, null] } });
    const ranks = await svc.getRanks();
    assert.deepEqual(ranks.admin, { [C]: 0, [B]: 1, [A]: 2 });
  });

  /* ── the behaviour that matters: one user's write, everyone's menu ── */
  await check('a Super Admin write is immediately visible to a STUDENT and a COACH', async () => {
    const res = await api('/api/sidebar/order', superToken, {
      method: 'PUT',
      body: { menu: 'admin', keys: [C, A, B] },
    });
    assert.equal(res.status, 200);

    /* Different users, different tokens: the order is global, not per-account. */
    for (const [who, token] of [['student', studentToken], ['coach', adminToken]]) {
      const read = await api('/api/sidebar', token);
      assert.deepEqual(
        read.data.orders.admin,
        { [C]: 0, [A]: 1, [B]: 2 },
        `${who} did not see the new order`,
      );
    }
  });

  await check('ranks are assigned from array position, starting at 0', async () => {
    const ranks = (await svc.getRanks()).admin;
    assert.deepEqual(Object.values(ranks).sort((x, y) => x - y), [0, 1, 2]);
  });

  await check('duplicate keys collapse and leave no gap in the ranks', async () => {
    await api('/api/sidebar/order', superToken, {
      method: 'PUT',
      body: { menu: 'admin', keys: [A, B, A, C, B] },
    });
    const ranks = (await svc.getRanks()).admin;
    assert.deepEqual(ranks, { [A]: 0, [B]: 1, [C]: 2 });
  });

  await check('a key the client stops sending is dropped, not left stale', async () => {
    await api('/api/sidebar/order', superToken, { method: 'PUT', body: { menu: 'admin', keys: [A, B, C] } });
    await api('/api/sidebar/order', superToken, { method: 'PUT', body: { menu: 'admin', keys: [C, A] } });
    const ranks = (await svc.getRanks()).admin;
    assert.deepEqual(ranks, { [C]: 0, [A]: 1 });
    assert.ok(!(B in ranks), 'the removed key kept a stale rank');
  });

  await check('the two menus are ordered independently', async () => {
    await api('/api/sidebar/order', superToken, { method: 'PUT', body: { menu: 'student', keys: ['/student/settings', '/student/dashboard'] } });
    const ranks = await svc.getRanks();
    assert.deepEqual(ranks.student, { '/student/settings': 0, '/student/dashboard': 1 });
    assert.deepEqual(ranks.admin, { [C]: 0, [A]: 1 }, 'writing the student menu disturbed the admin menu');
  });

  /* ── reset ── */
  await check('reset clears only the menu it is given', async () => {
    const res = await api('/api/sidebar/order/reset', superToken, {
      method: 'POST',
      body: { menu: 'admin' },
    });
    assert.equal(res.status, 200);
    const ranks = await svc.getRanks();
    assert.deepEqual(ranks.admin, {});
    assert.equal(Object.keys(ranks.student).length, 2, 'reset removed the other menu too');
  });

  await check('reset as a student is 403', async () => {
    const { status } = await api('/api/sidebar/order/reset', studentToken, {
      method: 'POST',
      body: { menu: 'admin' },
    });
    assert.equal(status, 403);
  });

  /* ── restore the baseline: empty means every client uses its code order ── */
  await svc.resetOrder('admin');
  await svc.resetOrder('student');
  const final = await svc.getRanks();
  assert.deepEqual(final.admin, {});
  assert.deepEqual(final.student, {});

  console.log(`\n${pass} passed, ${process.exitCode ? 'SOME FAILED' : 'all good'}`);
  server.close();
  await db.pool.end();
}

main().catch(async (err) => {
  console.error(err);
  server.close();
  await db.pool.end();
  process.exit(1);
});
