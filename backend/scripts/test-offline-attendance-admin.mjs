import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const DB_PATH = require.resolve('../src/config/database');
const NOTIF_PATH = require.resolve('../src/services/notificationService');
const CTRL_PATH = require.resolve('../src/controllers/attendanceController');

function harness(handlers = []) {
  const queries = [];
  const events = [];
  const pushes = [];

  async function runQuery(sql, params = []) {
    const flat = sql.replace(/\s+/g, ' ').trim();
    queries.push({ sql, flat, params });
    events.push(flat);
    const hit = handlers.find(([re]) => re.test(flat));
    if (!hit) return { rows: [] };
    const value = hit[1](sql, params);
    if (value instanceof Error) throw value;
    return { rows: value || [] };
  }

  const client = {
    query: runQuery,
    release: () => events.push('RELEASE'),
  };

  require.cache[DB_PATH] = {
    id: DB_PATH,
    filename: DB_PATH,
    loaded: true,
    exports: {
      query: runQuery,
      pool: { connect: async () => client },
    },
  };
  require.cache[NOTIF_PATH] = {
    id: NOTIF_PATH,
    filename: NOTIF_PATH,
    loaded: true,
    exports: {
      push: async (io, userId, title, message, extra) => {
        pushes.push({ io, userId, title, message, extra });
        events.push(`NOTIFY:${userId}`);
        return null;
      },
    },
  };
  delete require.cache[CTRL_PATH];
  const ctrl = require('../src/controllers/attendanceController');

  return {
    ctrl,
    queries,
    events,
    pushes,
    cleanup: () => {
      delete require.cache[DB_PATH];
      delete require.cache[NOTIF_PATH];
      delete require.cache[CTRL_PATH];
    },
  };
}

function response() {
  const r = { statusCode: 200, body: null };
  r.status = (code) => { r.statusCode = code; return r; };
  r.json = (body) => { r.body = body; return r; };
  return r;
}

const app = { get: () => ({}) };
const admin = { id: 7, name: 'Coach Vikram', role: 'admin' };
const roster = [{ id: 12, user_id: 99, name: 'Student One', group_id: 3, group_name: 'Batch A', coach_id: 7, coach_name: 'Coach Vikram', coaches: [{ id: 7, name: 'Coach Vikram' }] }];

const ROSTER_RE = /FROM students s JOIN users u/;
const LIST_RE = /COUNT\(\*\)::int OVER/;
const SUMMARY_RE = /FILTER \(WHERE status = 'present'\)/;

test('student reads fall back to the legacy schema after an undefined marker column', async (t) => {
  const missing = new Error('column a.marked_by_name does not exist');
  missing.code = '42703';
  const h = harness([
    [/a\.marked_by_name/, () => missing],
    [SUMMARY_RE, () => [{ total: 1, present: 1, late: 0, absent: 0, offline: 1 }]],
    [LIST_RE, () => []],
  ]);
  t.after(h.cleanup);

  const r = response();
  await h.ctrl.myAttendance({ user: { id: 70 }, query: { type: 'offline', month: '2026-10' } }, r);
  assert.equal(r.statusCode, 200);
  assert.equal(h.queries.length, 4, 'both read queries are retried with legacy columns');
  const legacy = h.queries.slice(2);
  assert.ok(legacy.every((q) => !q.sql.includes('a.marked_by_name')));
  assert.ok(legacy.every((q) => q.sql.includes('COALESCE(cl.class_date, a.created_at::date)')));
  assert.deepEqual(legacy.find((q) => LIST_RE.test(q.flat)).params, [70, 'offline', '2026-10', 10, 0]);
  assert.equal(r.body.summary.rate, 100);
});

test('the day register uses the coach roster and returns the saved standalone mark', async (t) => {
  const h = harness([
    [ROSTER_RE, () => roster],
    [/FROM attendance a WHERE a.class_id IS NULL/, () => [{ student_id: 12, status: 'late', marked_by_name: 'Coach Vikram', marked_by_role: 'admin', marked_at: '30 Oct 2026, 10:00' }]],
  ]);
  t.after(h.cleanup);

  const r = response();
  await h.ctrl.offlineDay({ user: admin, query: { date: '2026-10-30' } }, r);
  const rosterQuery = h.queries.find((q) => ROSTER_RE.test(q.flat));
  assert.match(rosterQuery.sql, /s\.coach_id = \$1/);
  assert.deepEqual(rosterQuery.params, [7]);
  const marksQuery = h.queries.find((q) => /ANY\(\$2::int\[\]\)/.test(q.sql));
  assert.deepEqual(marksQuery.params, ['2026-10-30', [12]]);
  assert.equal(r.body.students[0].status, 'late');
  assert.equal(r.body.students[0].markedByName, 'Coach Vikram');
});

test('super admin overview reads the whole roster and at most a 31-day range', async (t) => {
  const h = harness([
    [ROSTER_RE, () => roster],
    [/BETWEEN \$1::date AND \$2::date/, () => [{ student_id: 12, date: '2026-10-30', status: 'present' }]],
  ]);
  t.after(h.cleanup);

  const r = response();
  await h.ctrl.offlineOverview({
    user: { id: 1, role: 'superadmin' },
    query: { startDate: '2026-10-24', endDate: '2026-10-30' },
  }, r);
  const rosterQuery = h.queries.find((q) => ROSTER_RE.test(q.flat));
  assert.equal(rosterQuery.params.length, 0);
  assert.ok(!rosterQuery.sql.includes('s.coach_id = $1'));
  assert.equal(r.body.dates.length, 7);
  assert.deepEqual(r.body.records[0], { studentId: 12, date: '2026-10-30', status: 'present' });

  const before = h.queries.length;
  const invalid = response();
  await h.ctrl.offlineOverview({
    user: { id: 1, role: 'superadmin' },
    query: { startDate: '2026-09-01', endDate: '2026-10-30' },
  }, invalid);
  assert.equal(invalid.statusCode, 400);
  assert.equal(h.queries.length, before, 'an invalid range never reaches the database');
});

test('saving a standalone day upserts one row and notifies only after commit', async (t) => {
  const h = harness([
    [ROSTER_RE, () => roster],
    [/INSERT INTO attendance/, () => [{ id: 44 }]],
  ]);
  t.after(h.cleanup);

  const r = response();
  await h.ctrl.saveOfflineDay({
    user: admin,
    body: { date: '2026-10-30', records: [{ studentId: 12, status: 'Present' }] },
    app,
  }, r);

  const insert = h.queries.find((q) => /INSERT INTO attendance/.test(q.sql));
  assert.match(insert.sql, /VALUES \(NULL, \$1, \$2, \$3::date, 'offline'/);
  assert.match(insert.sql, /ON CONFLICT \(student_id, attendance_date\)\s+WHERE class_id IS NULL AND type = 'offline'/);
  assert.match(insert.sql, /marked_by_name\s*=\s*EXCLUDED.marked_by_name/);
  assert.deepEqual(insert.params, [12, 'present', '2026-10-30', 7, 'Coach Vikram', 'admin']);
  assert.equal(r.body.saved, 1);
  assert.equal(h.pushes.length, 1);
  assert.equal(h.pushes[0].message, 'Your offline attendance for 30 Oct 2026 was marked Present by Coach Vikram');
  assert.equal(h.pushes[0].extra.relatedId, 44);
  assert.ok(h.events.indexOf('COMMIT') < h.events.indexOf('NOTIFY:99'));
});

test('a super admin re-save refreshes the frozen marker identity', async (t) => {
  const h = harness([
    [ROSTER_RE, () => roster],
    [/INSERT INTO attendance/, () => [{ id: 44 }]],
  ]);
  t.after(h.cleanup);

  await h.ctrl.saveOfflineDay({
    user: { id: 1, name: 'Head Office', role: 'superadmin' },
    body: { date: '2026-10-30', records: [{ studentId: 12, status: 'absent' }] },
    app,
  }, response());
  const insert = h.queries.find((q) => /INSERT INTO attendance/.test(q.sql));
  assert.deepEqual(insert.params.slice(2), ['2026-10-30', 1, 'Head Office', 'superadmin']);
  assert.match(insert.sql, /marked_by_role\s*=\s*EXCLUDED.marked_by_role/);
});

test('clearing a standalone mark deletes it and sends no notification', async (t) => {
  const h = harness([[ROSTER_RE, () => roster]]);
  t.after(h.cleanup);

  const r = response();
  await h.ctrl.saveOfflineDay({
    user: admin,
    body: { date: '2026-10-30', records: [{ studentId: 12, status: '' }] },
    app,
  }, r);
  const deletion = h.queries.find((q) => /DELETE FROM attendance/.test(q.sql));
  assert.ok(deletion);
  assert.match(deletion.sql, /class_id IS NULL AND type = 'offline'/);
  assert.deepEqual(deletion.params, [12, '2026-10-30']);
  assert.equal(r.body.cleared, 1);
  assert.equal(h.pushes.length, 0);
});

test('an out-of-scope student rolls back the whole save before any write', async (t) => {
  const h = harness([[ROSTER_RE, () => roster]]);
  t.after(h.cleanup);

  const r = response();
  await h.ctrl.saveOfflineDay({
    user: admin,
    body: { date: '2026-10-30', records: [{ studentId: 999, status: 'present' }] },
    app,
  }, r);
  assert.equal(r.statusCode, 403);
  assert.ok(h.events.includes('ROLLBACK'));
  assert.ok(!h.events.includes('COMMIT'));
  assert.equal(h.queries.filter((q) => /INSERT INTO attendance|DELETE FROM attendance/.test(q.sql)).length, 0);
  assert.equal(h.pushes.length, 0);
});

test('invalid dates, statuses and duplicate students are rejected without connecting', async (t) => {
  const h = harness();
  t.after(h.cleanup);

  for (const body of [
    { date: '2026-02-30', records: [{ studentId: 12, status: 'present' }] },
    { date: '2026-10-30', records: [{ studentId: 12, status: 'unknown' }] },
    { date: '2026-10-30', records: [{ studentId: 12, status: 'present' }, { studentId: 12, status: 'late' }] },
  ]) {
    const r = response();
    await h.ctrl.saveOfflineDay({ user: admin, body, app }, r);
    assert.equal(r.statusCode, 400);
  }
  assert.equal(h.queries.length, 0);
});
