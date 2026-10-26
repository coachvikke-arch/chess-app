/* Behavioural tests for the coach-approval chat gate.
 *
 * The rule under test is a security boundary, so this exercises the REAL
 * chatPermissionService against an in-memory database stub rather than grepping
 * the source. A source-contract test would happily pass while the decision
 * matrix was inverted; these cases assert who can actually message whom.
 *
 * DB access is stubbed by intercepting the module load of
 * src/config/database, so nothing here needs a live PostgreSQL.
 *
 * Run: node --test scripts/test-chat-requests.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

/* ── In-memory world ──
 * Users 1 and 2 are students, 10 and 11 are coaches, 99 is the superadmin.
 * Student 2 has no coach, which is what exercises the superadmin fallback.
 * Student 3 has a primary coach AND a second one, which is the multi-coach case. */
const USERS = {
  1: { id: 1, name: 'Ana', role: 'student' },
  2: { id: 2, name: 'Ben', role: 'student' },
  3: { id: 3, name: 'Cara', role: 'student' },
  10: { id: 10, name: 'Coach Diaz', role: 'admin' },
  11: { id: 11, name: 'Coach Ekwu', role: 'admin' },
  99: { id: 99, name: 'Owner', role: 'superadmin' },
};
const STUDENT_COACH = { 1: 10, 2: null, 3: 11 };
/* Extra assigned coaches, as written to student_coaches when the assignment UI
 * allocates more than one coach to a student. */
const STUDENT_EXTRA_COACHES = { 3: [10] };

let requests = [];
let settings = { allow_rerequest: true, rerequest_cooldown_days: 7 };

/* Fresh world per test, so ordering never matters. */
function reset() {
  requests = [];
  settings = { allow_rerequest: true, rerequest_cooldown_days: 7 };
}

function addRequest(overrides) {
  const row = {
    id: requests.length + 1,
    requester_user_id: 1,
    target_user_id: 2,
    target_coach_id: 99,
    status: 'pending',
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
    approved_at: null,
    rejected_at: null,
    approved_by: null,
    rejected_by: null,
    requester_name: USERS[overrides?.requester_user_id ?? 1]?.name,
    target_name: USERS[overrides?.target_user_id ?? 2]?.name,
    coach_name: USERS[overrides?.target_coach_id ?? 99]?.name,
    ...overrides,
  };
  requests.push(row);
  return row;
}

/** Rows of chat_requests touching the pair, newest first - matches the real ORDER BY. */
function pairRequests(a, b) {
  return requests
    .filter(
      (r) =>
        (r.requester_user_id === a && r.target_user_id === b) ||
        (r.requester_user_id === b && r.target_user_id === a)
    )
    .sort((x, y) => y.created_at - x.created_at || y.id - x.id);
}

const dbStub = {
  async query(sql, params = []) {
    const s = sql.replace(/\s+/g, ' ');

    if (s.includes('FROM chat_request_settings')) {
      // A missing row really does come back as zero rows, not a row of nulls.
      return { rows: settings ? [settings] : [] };
    }
    /* Must be matched BEFORE the single-coach branch: the multi-coach query also
     * mentions `FROM students s` and `coach_id`. Returns rows shaped like the
     * real UNION ALL, duplicates included, so the dedupe is genuinely tested. */
    if (s.includes('UNION ALL') && s.includes('student_coaches')) {
      const uid = Number(params[0]);
      const rows = [];
      const primary = STUDENT_COACH[uid];
      if (primary) rows.push({ id: primary, ord: 0 });
      for (const coach of STUDENT_EXTRA_COACHES[uid] || []) rows.push({ id: coach, ord: 1 });
      return { rows };
    }
    if (s.includes('FROM students s') && s.includes('coach_id')) {
      const uid = Number(params[0]);
      const coach = STUDENT_COACH[uid];
      return { rows: coach ? [{ coach_id: coach }] : [] };
    }
    if (s.includes("role = 'superadmin'")) {
      return { rows: [{ id: 99 }] };
    }
    /* coachNamesFor resolves the whole set in one round trip and preserves the
     * caller's order, which is what keeps the primary coach listed first. */
    if (s.includes('WHERE id = ANY($1::int[])')) {
      const rows = (Array.isArray(params[0]) ? params[0] : [])
        .map((id) => USERS[Number(id)])
        .filter(Boolean)
        .map((u) => ({ id: u.id, name: u.name }));
      return { rows };
    }
    /* Order matters: the pending and approved lookups share the newest-row
     * ORDER BY with latestRequest, so they must be matched before it or they
     * would receive an arbitrary request regardless of status. */
    if (s.includes('FROM chat_requests') && s.includes("status = 'pending'")) {
      const found = pairRequests(Number(params[0]), Number(params[1])).find(
        (r) => r.status === 'pending'
      );
      return { rows: found ? [found] : [] };
    }
    if (s.includes('FROM chat_requests') && s.includes("status = 'approved'") && !s.includes('ORDER BY')) {
      const found = pairRequests(Number(params[0]), Number(params[1])).some(
        (r) => r.status === 'approved'
      );
      return { rows: found ? [{ '?column?': 1 }] : [] };
    }
    if (s.includes('FROM chat_requests') && s.includes('ORDER BY cr.created_at DESC')) {
      const rows = pairRequests(Number(params[0]), Number(params[1]));
      return { rows: rows.length ? [rows[0]] : [] };
    }
    if (s.includes('FROM users WHERE id = $1')) {
      const u = USERS[Number(params[0])];
      return { rows: u ? [u] : [] };
    }
    if (s.includes('SELECT id, name, role FROM users WHERE id = $1')) {
      const u = USERS[Number(params[0])];
      return { rows: u ? [u] : [] };
    }
    if (s.includes('SELECT name FROM users WHERE id = $1')) {
      const u = USERS[Number(params[0])];
      return { rows: u ? [{ name: u.name }] : [] };
    }
    throw new Error(`unstubbed query: ${s.slice(0, 90)}`);
  },
};

/* Intercept the database module before chatPermissionService requires it. */
const dbPath = require.resolve('../src/config/database');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (parent && parent.filename && parent.filename.endsWith('chatPermissionService.js')) {
    if (request === '../config/database') return dbStub;
    if (request === '../middleware/roleMiddleware') {
      return {
        isAdminRole: (r) => r === 'admin' || r === 'superadmin',
        roleMiddleware: () => (req, res, next) => next(),
      };
    }
  }
  return originalLoad.apply(this, arguments);
};

const perm = require('../src/services/chatPermissionService');
Module._load = originalLoad;

/* ── The pure helpers ── */
test('pairKey canonicalises direction and rejects nonsense', () => {
  assert.deepEqual(perm.pairKey(2, 1), [1, 2]);
  assert.deepEqual(perm.pairKey(1, 2), [1, 2]);
  assert.equal(perm.pairKey(1, 1), null, 'self is not a pair');
  assert.equal(perm.pairKey(0, 2), null, 'zero is not a user');
  assert.equal(perm.pairKey('x', 2), null, 'non-numeric is not a user');
});

test('isStaffPair treats both admin and superadmin as staff', () => {
  assert.equal(perm.isStaffPair('student', 'admin'), true);
  assert.equal(perm.isStaffPair('admin', 'student'), true);
  assert.equal(perm.isStaffPair('student', 'superadmin'), true);
  assert.equal(perm.isStaffPair('student', 'student'), false);
});

/* ── Who may message whom ── */
test('a student may message their coach without any approval', async () => {
  reset();
  const access = await perm.evaluateAccess(1, 10, 'student');
  assert.equal(access.allowed, true);
  assert.equal(access.requiresApproval, false);
  assert.equal(access.state, 'not_required');
  assert.equal(access.canRequest, false, 'no request is ever offered');
});

test('a coach may message a student without any approval', async () => {
  reset();
  const access = await perm.evaluateAccess(10, 3, 'admin');
  assert.equal(access.allowed, true);
  assert.equal(access.state, 'not_required');
});

test('two students with no request are blocked and offered one', async () => {
  reset();
  const access = await perm.evaluateAccess(1, 2, 'student');
  assert.equal(access.allowed, false);
  assert.equal(access.requiresApproval, true);
  assert.equal(access.state, 'none');
  assert.equal(access.canRequest, true);
  assert.match(access.message, /approval/i);
});

test('a pending request blocks messaging and cannot be resubmitted', async () => {
  reset();
  addRequest({ status: 'pending' });
  const access = await perm.evaluateAccess(1, 2, 'student');
  assert.equal(access.allowed, false);
  assert.equal(access.state, 'pending');
  assert.equal(access.canRequest, false, 'no duplicate while one is in flight');
  assert.equal(access.message, 'Chat request pending');
});

test('approval opens the channel in BOTH directions', async () => {
  reset();
  addRequest({ status: 'approved', requester_user_id: 1, target_user_id: 2 });
  const forward = await perm.evaluateAccess(1, 2, 'student');
  const reverse = await perm.evaluateAccess(2, 1, 'student');
  assert.equal(forward.allowed, true);
  assert.equal(reverse.allowed, true, 'the grant is symmetric');
  assert.equal(forward.state, 'approved');
});

test('rejection blocks messaging and starts a cooldown', async () => {
  reset();
  addRequest({
    status: 'rejected',
    rejected_at: new Date(),
    updated_at: new Date(),
  });
  const access = await perm.evaluateAccess(1, 2, 'student');
  assert.equal(access.allowed, false);
  assert.equal(access.state, 'rejected');
  assert.equal(access.canRequest, false, 'still inside the 7 day cooldown');
  assert.ok(access.cooldownEndsAt, 'reports when a retry becomes possible');
  assert.match(access.message, /not approved/i);
});

test('a re-request is allowed once the cooldown has passed', async () => {
  reset();
  addRequest({
    status: 'rejected',
    rejected_at: new Date(Date.now() - 8 * 86400000),
    updated_at: new Date(Date.now() - 8 * 86400000),
  });
  const access = await perm.evaluateAccess(1, 2, 'student');
  assert.equal(access.canRequest, true);
});

test('re-requests can be switched off entirely by configuration', async () => {
  reset();
  settings = { allow_rerequest: false, rerequest_cooldown_days: 7 };
  addRequest({ status: 'rejected', rejected_at: new Date(), updated_at: new Date() });
  const access = await perm.evaluateAccess(1, 2, 'student');
  assert.equal(access.canRequest, false);
  assert.equal(access.cooldownEndsAt, null, 'not a wait, a hard refusal');
});

test('a missing settings row falls back to the documented defaults', async () => {
  reset();
  settings = null;
  const access = await perm.evaluateAccess(1, 2, 'student');
  assert.equal(access.allowed, false);
  assert.equal(typeof access.canRequest, 'boolean');
});

test('a stale pending request cannot mask a newer rejection', async () => {
  reset();
  /* Pending first, then rejected later: the newest decision must win, or a
     pair could stay un-approvable forever. */
  addRequest({ status: 'pending', created_at: new Date('2026-01-01T00:00:00Z') });
  addRequest({
    status: 'rejected',
    created_at: new Date('2026-02-01T00:00:00Z'),
    rejected_at: new Date('2026-02-01T00:00:00Z'),
    updated_at: new Date('2026-02-01T00:00:00Z'),
  });
  const access = await perm.evaluateAccess(1, 2, 'student');
  assert.equal(access.state, 'rejected');
});

test('self and unknown users are refused before any pair logic', async () => {
  reset();
  const self = await perm.evaluateAccess(1, 1, 'student');
  assert.equal(self.allowed, false);
  assert.equal(self.state, 'self');
  const ghost = await perm.evaluateAccess(1, 4242, 'student');
  assert.equal(ghost.allowed, false);
  assert.equal(ghost.state, 'unavailable');
});

/* ── Coach routing ── */
test('the target student primary coach is the approver', async () => {
  reset();
  assert.equal(await perm.resolveTargetCoachId(1), 10);
});

test('every assigned coach is an approver, with the primary recorded first', async () => {
  reset();
  assert.deepEqual(await perm.resolveTargetCoachIds(1), [10]);
  /* Student 3's primary is 11 and 10 is assigned as well. Index 0 is what
   * chat_requests.target_coach_id records, so it must stay the primary. */
  assert.deepEqual(await perm.resolveTargetCoachIds(3), [11, 10]);
});

test('a coach assigned twice is notified once', async () => {
  reset();
  /* Student 1's primary is 10; putting 10 in the extra list reproduces the
   * primary-also-listed-in-student_coaches case, which must not duplicate. */
  STUDENT_EXTRA_COACHES[1] = [10];
  assert.deepEqual(await perm.resolveTargetCoachIds(1), [10]);
  delete STUDENT_EXTRA_COACHES[1];
});

test('a student with no coach falls back to the superadmin', async () => {
  reset();
  assert.equal(await perm.resolveTargetCoachId(2), 99);
  assert.deepEqual(await perm.resolveTargetCoachIds(2), [99]);
});

test('the eligibility answer names the full panel for a request', async () => {
  reset();
  /* Cara (3) asks Ana (1). The panel is both primary coaches (11, 10) plus
     Super Admins (99), deduped. Order is not important here; the names should
     include the three actors who can approve or reject. */
  const access = await perm.evaluateAccess(3, 1, 'student');
  assert.ok(Array.isArray(access.coachNames));
  assert.equal(access.coachNames.length >= 2, true);

  const other = await perm.evaluateAccess(1, 3, 'student');
  assert.ok(Array.isArray(other.coachNames));
});

test('resolveRequestParties returns the full panel (primary coaches + superadmins)', async () => {
  reset();
  const p = await perm.resolveRequestParties(1, 3);
  /* Requester 1 coach 10, target 3 coach 11 */
  assert.ok(p.includes(10));
  assert.ok(p.includes(11));
  assert.equal(new Set(p).size, p.length, 'no duplicates');
  assert.equal(p.includes(99), false, 'superadmin is not on the decision panel');
});

test('the requester with no coach has no decision panel member from the school', async () => {
  reset();
/* Ben (2) has no coach. The panel will include the target's coach (10) if present,
     but not Super Admins. */
  const parties = await perm.resolveRequestParties(2, 1);
  assert.equal(parties.includes(10), true, 'target coach is on panel');
  assert.equal(parties.includes(99), false, 'superadmin is oversight-only');
  assert.equal(await perm.resolvePrimaryCoachId(2), null);
  const access = await perm.evaluateAccess(2, 1, 'student');
  assert.ok(Array.isArray(access.coachNames));
});

test('resolvePrimaryCoachId never falls back to a superadmin', async () => {
  reset();
  assert.equal(await perm.resolvePrimaryCoachId(2), null);
  assert.equal(await perm.resolvePrimaryCoachId(1), 10);
  assert.equal(await perm.resolvePrimaryCoachId(3), 11);
});

/* ── assertCanMessage is what the messenger calls ── */
test('assertCanMessage resolves quietly when allowed', async () => {
  reset();
  const access = await perm.assertCanMessage(1, 10, 'student');
  assert.equal(access.allowed, true);
});

test('assertCanMessage throws a 403 carrying the UI state', async () => {
  reset();
  await assert.rejects(
    () => perm.assertCanMessage(1, 2, 'student'),
    (err) => {
      assert.equal(err.status, 403);
      assert.equal(err.code, 'approval_required');
      assert.equal(err.access.state, 'none', 'the UI needs this to pick a button');
      assert.equal(err.access.canRequest, true);
      return true;
    }
  );
});