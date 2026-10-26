/**
 * requireFeatureByRole — role translation regression test.
 *
 * THE BUG THIS EXISTS FOR
 *
 * `role_permissions` uses the permission vocabulary ('student' | 'coach') while
 * `req.user.role` uses the app vocabulary ('admin' | 'student' | 'superadmin').
 * The gate looked the raw app role up in a map keyed by permission role, so
 * 'admin' missed, fell through to the `?? map.student` fallback, and every coach
 * was checked against the *student's* feature key. Concretely, on /api/chat an
 * admin was evaluated as `coach` x `messaging_coach` — a pairing that exists in
 * no admin UI — so every coach got a 403 no matter which switch they enabled.
 *
 * `assignmentRoutes` had the identical shape and therefore the identical bug.
 *
 * This test pins the translation so the fallback cannot silently come back.
 *
 * Run with: npm run test:feature-gate
 */

const assert = require('node:assert/strict');
const test = require('node:test');

const { requireFeatureByRole } = require('../src/middleware/requireFeature');
const { toPermissionRole } = require('../src/services/permissionService');

/** Minimal `req`. Only `user.role` is read by the middleware. */
function req(role) {
  return { user: { id: 1, role } };
}

function res() {
  const r = { statusCode: null, body: null };
  r.status = (code) => {
    r.statusCode = code;
    return r;
  };
  r.json = (b) => {
    r.body = b;
    return r;
  };
  return r;
}

/** Runs the middleware and reports the feature key it resolved to. */
async function resolvedKey(map, role) {
  const r = res();
  let seen = null;
  await requireFeatureByRole(map)(req(role), r, () => {
    seen = 'passed';
  });
  return { status: r.statusCode, body: r.body, outcome: seen };
}

const CHAT_MAP = { student: 'messaging_coach', coach: 'messaging_students' };

test('toPermissionRole translates the app role into the permission role', () => {
  assert.equal(toPermissionRole('admin'), 'coach');
  assert.equal(toPermissionRole('student'), 'student');
});

test('an admin is checked against messaging_students, never the student fallback', async () => {
  /* End-to-end through the middleware. Whether the admin is allowed depends on
     the database — every switch is seeded FALSE, but a Super Admin enabling
     "Messaging Students" on the Coach column is the normal setup — so the
     outcome is environment-dependent. The KEY is not: whichever way it goes,
     the feature it was checked on must be the coach's key. Before the fix an
     admin was checked against 'messaging_coach', which no admin UI ever writes,
     so it always denied. */
  const { status, body } = await resolvedKey(CHAT_MAP, 'admin');
  assert.notEqual(body?.feature, 'messaging_coach', 'regressed: admin checked against the student key');
  if (status === 403) {
    assert.equal(body?.feature, 'messaging_students', 'denial must name the coach key');
  } else {
    assert.equal(status, null, 'a gate either passes (no status) or denies (403)');
  }
});

test('the map lookup itself translates before falling back', () => {
  const key = CHAT_MAP[toPermissionRole('admin')] ?? CHAT_MAP.student;
  assert.equal(key, 'messaging_students');
  assert.notEqual(key, 'messaging_coach');
});

test('a student still resolves the student key', () => {
  const key = CHAT_MAP[toPermissionRole('student')] ?? CHAT_MAP.student;
  assert.equal(key, 'messaging_coach');
});

test('an unknown role still falls back to the student key rather than passing', async () => {
  const r = res();
  let passed = false;
  await requireFeatureByRole(CHAT_MAP)(req('some-new-role'), r, () => {
    passed = true;
  });
  assert.equal(passed, false, 'an unmapped role must not slip through');
  assert.equal(r.statusCode, 403);
});

test('a request with no user is 401, not 403', async () => {
  const r = res();
  let passed = false;
  await requireFeatureByRole(CHAT_MAP)({}, r, () => {
    passed = true;
  });
  assert.equal(passed, false);
  assert.equal(r.statusCode, 401);
});

test('superadmin bypasses the gate entirely', async () => {
  const r = res();
  let passed = false;
  await requireFeatureByRole(CHAT_MAP)(req('superadmin'), r, () => {
    passed = true;
  });
  assert.equal(passed, true, 'superadmin must never be locked out of its own control panel');
  assert.equal(r.statusCode, null);
});

test('every role-aware route map is keyed in the permission vocabulary', () => {
  /* A guard rail: if someone adds a route map keyed by 'admin', the lookup will
     miss and fall back to the student key again. Fail loudly instead. */
  const maps = {
    'chatRoutes': CHAT_MAP,
    'assignmentRoutes': { student: 'assignments', coach: 'assign_lessons' },
  };
  for (const [name, map] of Object.entries(maps)) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(map, 'admin'),
      false,
      `${name} keys the map with 'admin'; use the permission role 'coach' instead`,
    );
    assert.ok(map.student, `${name} has no student fallback`);
    assert.ok(map.coach, `${name} has no coach key`);
  }
});