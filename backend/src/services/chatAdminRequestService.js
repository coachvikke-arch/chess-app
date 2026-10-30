const db = require('../config/database');

/* Student <-> allocated-admin chat channel.
 *
 * The rule this encodes: a student may only open a DM with a coach who is
 * actually allocated to them, and only after that specific coach has accepted a
 * chat request. Before this service existed, chatPermissionService.isStaffPair()
 * returned "no request needed" for ANY pair containing an admin, so a student
 * could message every coach account in the academy. That was written as a
 * supervision channel; the academy wants a permissioned one.
 *
 * Allocation is READ from the roster the rest of the app already maintains
 * (students.coach_id is the primary coach, student_coaches holds the rest). There
 * is no parallel allocation table and no copy - if a student is moved to another
 * coach, this service's answer for the old coach goes stale on purpose, which is
 * exactly the "hide the old chat, make them ask again" behaviour.
 *
 * Super Admins are NOT special inside this file. The owner may always talk to
 * anyone, and that exception is decided by chatPermissionService BEFORE this is
 * consulted, so nothing here has to know about it.
 */

/* Three states. No 'rejected' by design - Cancel withdraws the request, it does
   not refuse the student on the merits, which is why there is no cooldown. */
const ADMIN_REQUEST_STATUS = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  CANCELLED: 'cancelled',
};

/** Every admin user id currently allocated to one student account. */
async function allocatedAdminUserIds(studentUserId, query = db.query) {
  const r = await query(
    `SELECT s.coach_id AS id
       FROM students s
      WHERE s.user_id = $1 AND s.coach_id IS NOT NULL
     UNION
     SELECT sc.coach_id AS id
       FROM students s
       JOIN student_coaches sc ON sc.student_id = s.id
      WHERE s.user_id = $1 AND sc.coach_id IS NOT NULL`,
    [studentUserId]
  );
  return r.rows.map((row) => Number(row.id));
}

/** Every student user id currently allocated to one admin account. */
async function allocatedStudentUserIds(adminUserId, query = db.query) {
  const r = await query(
    `SELECT s.user_id AS id
       FROM students s
      WHERE s.coach_id = $1 AND s.user_id IS NOT NULL AND COALESCE(s.active, TRUE)
     UNION
     SELECT s.user_id AS id
       FROM students s
       JOIN student_coaches sc ON sc.student_id = s.id
      WHERE sc.coach_id = $1 AND s.user_id IS NOT NULL AND COALESCE(s.active, TRUE)`,
    [adminUserId]
  );
  return r.rows.map((row) => Number(row.id));
}

async function isAllocated(studentUserId, adminUserId, query = db.query) {
  const ids = await allocatedAdminUserIds(studentUserId, query);
  return ids.includes(Number(adminUserId));
}

/**
 * The NEWEST request for one student/admin pair, whatever its status.
 *
 * The newest row is the only one that speaks, which is the same rule the peer
 * queue follows. It matters most right after a cancellation: cancelling leaves no
 * live row behind (that is what the partial unique index guarantees), so a lookup
 * filtered to pending/accepted would report "never asked" and the student's row
 * would show a plain "Request chat" instead of "Request cancelled".
 */
async function newestRequest(studentUserId, adminUserId, query = db.query) {
  const r = await query(
    `SELECT id, student_user_id, admin_user_id, status, created_at, updated_at
       FROM chat_admin_requests
      WHERE student_user_id = $1 AND admin_user_id = $2
      ORDER BY created_at DESC, id DESC
      LIMIT 1`,
    [studentUserId, adminUserId]
  );
  return r.rows.length > 0 ? r.rows[0] : null;
}

/**
 * The newest request for every peer in a contact list, in a single query.
 *
 * The direction is fixed by `asStudent`, because a caller is either a student
 * looking at coaches or a coach looking at students - never both. That makes this
 * a plain two-column lookup instead of the LEAST/GREATEST row-value matching the
 * peer queue needs, and it is what keeps the People list at one round trip.
 *
 * DISTINCT ON takes the NEWEST row per pair rather than only the live ones, which
 * is what lets a People row say "Request cancelled" instead of looking like a
 * first-time contact. A cancellation deliberately leaves no live row, so reading
 * only the live row would erase the event the student most needs to see.
 *
 * @returns {Promise<Map<number, {requestId:number,status:string}>>} keyed by peer user id.
 */
async function latestRequestsForPeers(meId, peerIds, asStudent, query = db.query) {
  const ids = (peerIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (ids.length === 0) return new Map();
  const column = asStudent ? 'admin_user_id' : 'student_user_id';
  const mine = asStudent ? 'student_user_id' : 'admin_user_id';
  const r = await query(
    `SELECT DISTINCT ON (${column})
            ${column} AS peer_id, id AS request_id, status
       FROM chat_admin_requests
      WHERE ${mine} = $1
        AND ${column} = ANY($2::int[])
      ORDER BY ${column}, created_at DESC, id DESC`,
    [meId, ids]
  );
  const byPeer = new Map();
  for (const row of r.rows) {
    byPeer.set(Number(row.peer_id), { requestId: Number(row.request_id), status: row.status });
  }
  return byPeer;
}

/**
 * Decide the student/admin channel, in the same shape the peer gate returns so
 * one UI and one error payload cover both.
 *
 * `studentUserId` and `adminUserId` are explicit rather than derived from the
 * caller, so the coach reading a student's row gets the same answer as the
 * student reading the coach's row - the pair has ONE state, not two per-view
 * opinions.
 */
/**
 * The one place a request row becomes a channel state, so the gate, the People
 * list and the REST payload can never disagree about what a row means.
 */
function stateFromRow(row) {
  if (!row) {
    return {
      allowed: false, requiresApproval: true, state: 'none',
      reason: 'admin_request_required', canRequest: true, requestId: null,
    };
  }
  if (row.status === ADMIN_REQUEST_STATUS.ACCEPTED) {
    return {
      allowed: true, requiresApproval: true, state: ADMIN_REQUEST_STATUS.ACCEPTED,
      reason: 'admin_request_accepted', canRequest: false, requestId: Number(row.id),
    };
  }
  if (row.status === ADMIN_REQUEST_STATUS.CANCELLED) {
    /* Re-requesting is allowed IMMEDIATELY. A cancellation is a withdrawal, not
     * a refusal on the merits, so there is nothing to cool down - and the peer
     * queue's configurable cooldown does not reach here. This is the timing
     * choice the spec asked to be told about. */
    return {
      allowed: false, requiresApproval: true, state: ADMIN_REQUEST_STATUS.CANCELLED,
      reason: 'admin_request_cancelled', canRequest: true, requestId: Number(row.id),
    };
  }
  return {
    allowed: false, requiresApproval: true, state: ADMIN_REQUEST_STATUS.PENDING,
    reason: 'admin_request_pending', canRequest: false, requestId: Number(row.id),
  };
}

/**
 * Decide the student/admin channel, in the same shape the peer gate returns so
 * one UI and one error payload cover both.
 *
 * `studentUserId` and `adminUserId` are explicit rather than derived from the
 * caller, so the coach reading a student's row gets the same answer as the
 * student reading the coach's row - the pair has ONE state, not two per-view
 * opinions.
 *
 * Allocation is checked FIRST, above the request history. An accepted request
 * does not survive re-allocation: the pair simply stops being a pair, which is
 * how "moved to a new coach means ask the new coach" falls out with no extra
 * bookkeeping and no cleanup job.
 */
async function evaluateChannel(studentUserId, adminUserId, query = db.query) {
  const student = Number(studentUserId);
  const admin = Number(adminUserId);

  if (!Number.isInteger(student) || !Number.isInteger(admin) || student === admin) {
    return {
      allowed: false, requiresApproval: true, state: 'unavailable',
      reason: 'user_not_found', canRequest: false, requestId: null,
    };
  }

  if (!(await isAllocated(student, admin, query))) {
    /* Not "you need approval" - approval would be obtainable. This student is
     * nobody's to ask, so the row must not offer a button that can only fail. */
    return {
      allowed: false, requiresApproval: true, state: 'not_allocated',
      reason: 'not_allocated', canRequest: false, requestId: null,
    };
  }

  return stateFromRow(await newestRequest(student, admin, query));
}

module.exports = {
  ADMIN_REQUEST_STATUS,
  allocatedAdminUserIds,
  allocatedStudentUserIds,
  isAllocated,
  newestRequest,
  latestRequestsForPeers,
  stateFromRow,
  evaluateChannel,
};
