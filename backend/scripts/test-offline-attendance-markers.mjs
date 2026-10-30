import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

/* The handlers under test are exercised for real against a stubbed pg client,
 * so the SQL text, the parameter numbering and the JSON envelope are all
 * checked without touching any database. Nothing here connects anywhere. */
const require = createRequire(import.meta.url);

const DB_PATH = require.resolve('../src/config/database');
const NOTIF_PATH = require.resolve('../src/services/notificationService');

/* Install the stubs, THEN load the module under test, so its `require`s bind to
 * the fakes. The controller is dropped from the cache each time because the
 * previous run's closures would otherwise keep the old stub. */
function withStubs(modPath, handlers, fn) {
  const queries = [];
  const pushes = [];

  require.cache[DB_PATH] = {
    id: DB_PATH,
    filename: DB_PATH,
    loaded: true,
    exports: {
      query: async (sql, params = []) => {
        queries.push({ sql, params });
        const flat = sql.replace(/\s+/g, ' ');
        const hit = handlers.find(([re]) => re.test(flat));
        return { rows: hit ? hit[1](sql, params) : [] };
      },
    },
  };
  require.cache[NOTIF_PATH] = {
    id: NOTIF_PATH,
    filename: NOTIF_PATH,
    loaded: true,
    exports: {
      push: async (io, userId, title, message, extra) => {
        pushes.push({ io, userId, title, message, extra });
        return null;
      },
      create: async () => null,
      emitToUser: () => {},
      setRequestStatus: async () => [],
    },
  };

  const resolved = require.resolve(modPath);
  delete require.cache[resolved];
  const mod = require(modPath);

  try {
    return fn({ mod, queries, pushes });
  } finally {
    delete require.cache[DB_PATH];
    delete require.cache[NOTIF_PATH];
    delete require.cache[resolved];
  }
}

const res = () => {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
};

const reqUser = { id: 7, name: 'Coach Vikram', role: 'admin' };
const app = { get: () => ({}) };

const MARK_PATH = '../src/controllers/classController';
const LIST_PATH = '../src/controllers/attendanceController';

/* ───────────────────────── the register write ───────────────────────── */

const CLASS_ROW = [{ id: 3, date_key: '2026-10-30', date_label: '30 Oct 2026' }];

test('marking offline attendance stores the date, type and full marker', async () => {
  await withStubs(MARK_PATH, [
    [/FROM classes WHERE id/, () => CLASS_ROW],
    [/INSERT INTO attendance/, () => [{ id: 1 }]],
    [/SELECT user_id FROM students/, () => [{ user_id: 99 }]],
  ], async ({ mod: ctrl, queries, pushes }) => {
    const r = res();
    await ctrl.markAttendance(
      { params: { id: '3' }, body: { studentId: 12, status: 'present' }, user: reqUser, app },
      r
    );
    const ins = queries.find((q) => /INSERT INTO attendance/.test(q.sql));
    assert.ok(ins, 'an attendance row was written');
    for (const col of ['attendance_date', 'type', 'marked_by', 'marked_by_name', 'marked_by_role', 'marked_at']) {
      assert.match(ins.sql, new RegExp(col), `${col} is persisted`);
    }
    assert.match(ins.sql, /ON CONFLICT \(class_id, student_id\) DO UPDATE/, 're-marking updates in place');
    assert.match(ins.sql, /marked_by\s*=\s*EXCLUDED.marked_by/, 'the marker is refreshed on update');
    assert.deepEqual(
      [ins.params[0], ins.params[1], ins.params[2], ins.params[3]],
      ['3', 12, 'present', '2026-10-30'],
      'class, student, status and the copied class date'
    );
    assert.deepEqual(ins.params.slice(4), [7, 'Coach Vikram', 'admin'], 'markedBy / name / role');
    assert.equal(r.statusCode, 200);

    assert.equal(pushes.length, 1, 'the student is notified');
    assert.equal(pushes[0].userId, 99, 'pushed to the student user, not the marker');
    assert.equal(
      pushes[0].message,
      'Your offline attendance for 30 Oct 2026 was marked Present by Coach Vikram'
    );
    assert.equal(pushes[0].extra.type, 'attendance');
  });
});

test('super admin marks are recorded with the superadmin role', async () => {
  await withStubs(MARK_PATH, [
    [/FROM classes WHERE id/, () => CLASS_ROW],
    [/INSERT INTO attendance/, () => [{ id: 2 }]],
    [/SELECT user_id FROM students/, () => [{ user_id: 99 }]],
  ], async ({ mod: ctrl, queries }) => {
    await ctrl.markAttendance(
      {
        params: { id: '3' },
        body: { studentId: 12, status: 'Late' },
        user: { id: 1, name: 'Head Office', role: 'superadmin' },
        app,
      },
      res()
    );
    const ins = queries.find((q) => /INSERT INTO attendance/.test(q.sql));
    assert.equal(ins.params[2], 'late', 'status is normalised');
    assert.equal(ins.params[5], 'Head Office', 'markedByName');
    assert.equal(ins.params[6], 'superadmin', 'markedByRole');
  });
});

test('clearing a status deletes the record instead of writing one', async () => {
  await withStubs(MARK_PATH, [
    [/FROM classes WHERE id/, () => CLASS_ROW],
    [/DELETE FROM attendance/, () => []],
  ], async ({ mod: ctrl, queries, pushes }) => {
    const r = res();
    await ctrl.markAttendance(
      { params: { id: '3' }, body: { studentId: 12, status: '' }, user: reqUser, app },
      r
    );
    assert.ok(queries.some((q) => /DELETE FROM attendance WHERE class_id = \$1 AND student_id = \$2/.test(q.sql.replace(/\s+/g, ' '))));
    assert.equal(queries.filter((q) => /INSERT INTO attendance/.test(q.sql)).length, 0);
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.status, null);
    assert.equal(pushes.length, 0, 'a cleared record sends no notification');
  });
});

test('an unknown status is rejected before anything is written', async () => {
  await withStubs(MARK_PATH, [
    [/FROM classes WHERE id/, () => CLASS_ROW],
  ], async ({ mod: ctrl, queries }) => {
    const r = res();
    await ctrl.markAttendance(
      { params: { id: '3' }, body: { studentId: 12, status: 'here' }, user: reqUser, app },
      r
    );
    assert.equal(r.statusCode, 400);
    assert.equal(queries.filter((q) => /INSERT|DELETE/.test(q.sql)).length, 0);
  });
});

test('a missing class or student id fails without writing', async () => {
  await withStubs(MARK_PATH, [], async ({ mod: ctrl, queries }) => {
    const missingClass = res();
    await ctrl.markAttendance(
      { params: { id: '404' }, body: { studentId: 12, status: 'present' }, user: reqUser, app },
      missingClass
    );
    assert.equal(missingClass.statusCode, 404);

    const noStudent = res();
    await ctrl.markAttendance(
      { params: { id: '3' }, body: { status: 'present' }, user: reqUser, app },
      noStudent
    );
    assert.equal(noStudent.statusCode, 400);
    assert.equal(queries.filter((q) => /INSERT|DELETE/.test(q.sql)).length, 0, 'nothing was written');
  });
});

/* ─────────────────────── the student's own list ─────────────────────── */

const EMPTY_PAGE = () => [];
const SUMMARY = () => [{ total: 12, present: 8, late: 2, absent: 2, offline: 4 }];

/* The summary is the only statement that counts by status filter, so that is
   what tells the two concurrent queries apart in the recorded log. */
const SUMMARY_RE = /FILTER \(WHERE status = 'present'\)/;
const LIST_RE = /COUNT\(\*\)::int OVER/;

async function callMyAttendance(query, extraHandlers = []) {
  return withStubs(LIST_PATH, [
    ...extraHandlers,
    [SUMMARY_RE, SUMMARY],
    [LIST_RE, EMPTY_PAGE],
  ], async ({ mod: ctrl, queries }) => {
    const r = res();
    await ctrl.myAttendance({ user: { id: 7 }, query }, r);
    return { body: r.body, queries, status: r.statusCode };
  });
}

test('the student list is keyed to the caller only', async () => {
  const { body, queries } = await callMyAttendance({ page: '2', limit: '10', type: 'offline', month: '2026-10' });
  const list = queries.find((q) => /COUNT\(\*\)::int OVER/.test(q.sql));
  assert.equal(list.params[0], 7, 'the first parameter is always req.user.id');
  assert.equal(body.page, 2);
  assert.equal(body.limit, 10);
  assert.equal(body.total, 12, 'total comes from the windowed count');
  assert.equal(body.totalPages, 2);
});

test('an edited studentId in the query cannot widen the read', async () => {
  const { queries } = await callMyAttendance({ studentId: '55', id: '55', userId: '55' });
  for (const q of queries) {
    assert.ok(!q.params.includes('55') && !q.params.includes(55),
      `no client-supplied identity reaches the params: ${JSON.stringify(q.params)}`);
  }
});

test('filters land in the SQL and the summary ignores the type chip', async () => {
  const { queries } = await callMyAttendance({ type: 'offline', month: '2026-10' });
  const list = queries.find((q) => LIST_RE.test(q.sql));
  const summary = queries.find((q) => SUMMARY_RE.test(q.sql));

  assert.match(list.sql, /WHERE type = \$2 AND to_char\(attendance_date, 'YYYY-MM'\) = \$3/);
  assert.deepEqual(list.params, [7, 'offline', '2026-10', 10, 0]);
  assert.match(summary.sql, /WHERE to_char\(attendance_date, 'YYYY-MM'\) = \$2/);
  assert.ok(!/type = /.test(summary.sql.split('FROM all_records')[1]), 'the summary drops the type chip');
  assert.deepEqual(summary.params, [7, '2026-10']);
});

test('a junk month or type is dropped, not injected', async () => {
  const { queries, body } = await callMyAttendance({ type: 'evil', month: "2026'; DROP" });
  assert.equal(body.filters.type, 'all');
  assert.equal(body.filters.month, '');
  for (const q of queries) {
    assert.ok(!q.params.some((p) => typeof p === 'string'),
      `only the caller id and the page window are bound: ${JSON.stringify(q.params)}`);
  }
  assert.deepEqual(queries.find((q) => LIST_RE.test(q.sql)).params, [7, 10, 0]);
  assert.deepEqual(queries.find((q) => SUMMARY_RE.test(q.sql)).params, [7]);
});

test('the rate is present over marked records only', async () => {
  const { body } = await callMyAttendance({}, [
    [SUMMARY_RE, () => [{ total: 20, present: 6, late: 1, absent: 3, offline: 2 }]],
  ]);
  assert.equal(body.summary.graded, 10);
  assert.equal(body.summary.rate, 60);
  assert.equal(body.summary.total, 20, 'the 10 unmarked classes are still counted in Total');
});

test('limit is clamped so a request cannot ask for the whole table', async () => {
  const { body } = await callMyAttendance({ limit: '100000', page: '-4' });
  assert.equal(body.limit, 50);
  assert.equal(body.page, 1);
});
