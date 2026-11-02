const db = require('../config/database');

const STAFF_ROLES = new Set(['admin', 'superadmin']);

/* chatPermissionService requires THIS module at its own top, so the pair-level
   helpers it owns are read lazily. A top-level `require('./chatPermissionService')`
   here would complete the cycle at load time: whichever file loaded second would
   receive the other's half-built `module.exports` (still `{}`, because both files
   assign theirs on the last line) and every one of those helpers would be
   `undefined` - silently, until the first request. Nothing here needs them while
   loading, only while serving, and by then both files are finished. */
let permModule;
const perm = () => (permModule ||= require('./chatPermissionService'));

/* Three of them are part of THIS module's API, because the student→coach flow
   asks this service for everything and should not have to know which of the two
   files a decision lives in. */
const pairKey = (...args) => perm().pairKey(...args);
const resolvePrimaryCoachId = (...args) => perm().resolvePrimaryCoachId(...args);
const resolveRequestParties = (...args) => perm().resolveRequestParties(...args);

/* Student <-> allocated-admin chat channel.

 * The rule this encodes runs one way: a STUDENT may only open a DM with a coach
  * who is allocated to them, and only after that specific coach has accepted a
  * chat request. The coach's own direction needs no request at all - they write to
  * any student on their roster from the first keystroke - so a row here is the
  * learner's permission, never the coach's. When a coach opens a channel before any
  * row exists, openChannelByAdmin() writes the accepted row that lets the learner
  * answer.

 * Before this service existed, chatPermissionService.isStaffPair() returned "no
  * request needed" for ANY pair containing an admin, so a student could message
  * every coach account in the academy. That was written as a supervision channel;
  * the academy wants a permissioned one.

 * Two learners asking to chat with EACH OTHER is not this file either. That pairing
  * is a peer request in `chat_requests`, decided by the coach who owns them, and
  * chatPermissionService routes it - so nothing here has to know it exists.

 * Allocation is READ from the roster the rest of the app already maintains
  * (students.coach_id is the primary coach, student_coaches holds the rest). There
  * is no parallel allocation table and no copy - if a student is moved to another
  * coach, this service's answer for the old coach goes stale on purpose, which is
  * exactly the "hide the old chat, make them ask again" behaviour.

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
    [Number(studentUserId), Number(adminUserId)]
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

/**
 * Record that the coach opened the channel themselves, so the learner can reply.
 *
 * A coach writes to their own student with no request, which leaves the learner
 * looking at a thread they are not allowed to answer: the student's permission is
 * the request row, and there is no row. Writing one here is the spec's "the admin
 * messaging first makes the chat active immediately, and any pending request is
 * marked accepted automatically" - and it keeps the database the single truth that
 * `stateFromRow`, the People list and the inbox all read, instead of making every
 * one of them also ask "but did the coach write first?".
 *
 * The coach's own consent is what `accepted_by` records, which is honest: they
 * opened it. A cancelled row is reopened rather than stacked, because a coach
 * sending a message after cancelling is plainly changing their mind, and one live
 * row per pair is what the partial unique index already guarantees.
 *
 * The caller must have proved the pair is allocated; this writes paperwork, it
 * does not grant access.
 *
 * @returns {Promise<{row: object|null, changed: boolean}>} `changed` is false when
 *   the pair was already accepted, so the caller can skip the realtime event.
 */
async function openChannelByAdmin(studentUserId, adminUserId, query = db.query) {
  const student = Number(studentUserId);
  const admin = Number(adminUserId);
  const newest = await newestRequest(student, admin, query);

  if (newest && newest.status === ADMIN_REQUEST_STATUS.ACCEPTED) {
    return { row: newest, changed: false };
  }

  if (newest) {
    /* Pending or cancelled: the SAME row turns live, so the pair's history stays
       one line and the id the student's UI already holds keeps meaning something. */
    const updated = await query(
      `UPDATE chat_admin_requests
          SET status = 'accepted',
              accepted_at = NOW(),
              accepted_by = $1,
              cancelled_at = NULL,
              cancelled_by = NULL,
              updated_at = NOW()
        WHERE id = $2
        RETURNING id, student_user_id, admin_user_id, status, created_at, updated_at`,
      [admin, Number(newest.id)]
    );
    return { row: updated.rows[0] || null, changed: true };
  }

  try {
    const inserted = await query(
      `INSERT INTO chat_admin_requests
         (student_user_id, admin_user_id, status, accepted_at, accepted_by, updated_at)
      VALUES ($1, $2, 'accepted', NOW(), $2, NOW())
      RETURNING id, student_user_id, admin_user_id, status, created_at, updated_at`,
      [student, admin]
    );
    return { row: inserted.rows[0] || null, changed: true };
  } catch (err) {
    /* 23505 = another writer (a request arriving at the same instant) already
       holds the live slot. Re-read it: whichever row won, the pair is live and the
       coach's message is still entitled to go out. */
    if (err && err.code === '23505') {
      const live = await newestRequest(student, admin, query);
      return { row: live || null, changed: false };
    }
    throw err;
  }
}

/* Learner↔learner asks are NOT this table's: a classmate pairing is decided on the
   peer queue (`chat_requests`), which already has a requester, a target, an
   approver panel and its own status machine. This file governs exactly one shape -
   a student and the coach allocated to them - and its rows have one named decider.
   Mixing the two would need a column here that does not exist in the live schema,
   and would put a second source of truth next to the queue's. */

/**
 * Every request I am a party to, either as the student or as the coach. */
async function listMyAdminChatRequests(status, query = db.query) {
  const me = Number(req?.user?.id || 0); // Will be set by controller
  // ... (existing logic, adapted for new column)
  /* Note: this function will be updated in the controller to use the proper me value */
  throw new Error('Use chatAdminRequestController.mine instead');
}

/* ── GET /api/chat-admin-requests?status=pending ───────────────────────────────
  * Every request the caller is a party to, in either direction: the coach's queue
  * of incoming asks and the student's own history - except for the academy owner,
  * who is never a party and sees all of them, because the same spec that hands them
  * Accept/Cancel authority over any request has to let them FIND the ids.
  * Optional status filter, newest first, capped - the People list is the primary
  * surface, so this is the fallback for a client that wants the request rows.
  */
async function mine(req, res) {
  try {
    const me = Number(req.user.id);
    const status = String(req.query.status || '').trim();
    const params = [me];
    let where = req.user.role === 'superadmin'
      ? '1 = 1'
      : `(r.student_user_id = $1 OR r.admin_user_id = $1)`;
    if (status && Object.values(STATUSES).includes(status)) {
      params.push(status);
      where += ` AND r.status = $${params.length}`;
    }
    // Also filter by target_student_user_id when relevant (for student->student requests)
    // The admin sees requests from their allocated students, so we include the target
    // student id in the where clause when the admin is looking at student->student requests
    const r = await db.query(
      `${REQUEST_SELECT} WHERE ${where} ORDER BY r.created_at DESC, r.id DESC LIMIT $${params.length}`,
      params
    );
    res.json({ requests: r.rows.map((row) => shapeRequest(row, me, req.user.role)) });
  } catch (err) {
    console.error('[chatAdminRequest:mine] error', err);
    res.status(500).json({ message: 'Failed to load chat requests', error: err.message });
  }
}

/** Append-only record of who decided a chat, when, and why. Never read for auth. */
async function writeAudit({ requestId, action, actor, previousStatus, newStatus, reason }) {
  try {
    await db.query(
      `INSERT INTO chat_request_audit
         (chat_request_id, action, actor_id, actor_name, previous_status, new_status, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        requestId, action,
        actor?.id ?? null, actor?.name ?? null,
        previousStatus || null, newStatus, reason || null,
      ]
    );
  } catch (e) {
    /* The audit trail must never be the reason a cancellation fails. */
    console.warn('[chatRequest:audit]', e.message);
  }
}

/* ── POST /api/chat-admin-requests   body: { adminId, targetStudentUserId } ──

  * A student asks the coach allocated to them for permission to chat.
  *
  * Two modes:
  *   1. student -> admin: body = { adminId } (targetStudentUserId omitted, NULL)
  *   2. student -> student: body = { adminId, targetStudentUserId }
  *
  * ONE DECIDER (the requester's primary coach) and OBSERVERS (the target's primary
  * coach, plus superadmins). The split is deliberate: exactly one person answers
  * the student, so a request cannot be approved by one colleague and then disputed
  * by another, while everyone responsible for either student can still see it.

  * The pending check runs first and the database's partial unique index backs it
  * up, because two fast clicks (or a double-submitted form) must not produce two
  * requests that a coach then has to arbitrate.
   */
async function create(req, res) {
  try {
    const studentId = Number(req.user.id);
    const adminId = Number(req.body?.adminId);
    const targetStudentUserId = req.body?.targetStudentUserId != null ? Number(req.body.targetStudentUserId) : null;

    if (!Number.isInteger(adminId) || adminId <= 0) {
      return res.status(400).json({ message: 'adminId is required' });
    }

    const target = await db.query('SELECT id, name, role FROM users WHERE id = $1', [adminId]);
    if (target.rows.length === 0) return res.status(404).json({ message: 'Admin not found' });
    if (target.rows[0].role !== 'admin') {
      /* A Super Admin needs no request - they are reachable directly, and asking
         one would create a request they are not obliged to answer. */
      return res.status(400).json({ message: 'Chat requests are only for your allocated coach.' });
    }

    // Determine the type of request
    let requestType = 'student-to-admin';
    if (targetStudentUserId !== null) {
      requestType = 'student-to-student';
      if (!Number.isInteger(targetStudentUserId) || targetStudentUserId <= 0) {
        return res.status(400).json({ message: 'targetStudentUserId is required for student-to-student requests' });
      }
      // Verify target student exists
      const tgt = await db.query('SELECT id, name FROM users WHERE id = $1', [targetStudentUserId]);
      if (tgt.rows.length === 0) return res.status(404).json({ message: 'Target student not found' });
    }

    const access = await chatPerm.evaluateAccess(studentId, targetStudentUserId !== null ? targetStudentUserId : adminId, req.user.role);

    // Staff pairs never need one, and neither does an approved pair.
    if (access.state === 'not_required' || access.state === 'approved') {
      return res.status(409).json({
        message: access.message,
        state: access.state,
        code: 'no_request_needed',
      });
    }
    if (access.state === 'self') return res.status(400).json({ message: access.message });
    if (access.state === 'pending') {
      return res.status(409).json({
        message: 'Chat request pending',
        state: 'pending',
        requestId: access.requestId,
        code: 'already_pending',
      });
    }
    if (!access.canRequest) {
      return res.status(403).json({
        message: access.cooldownEndsAt
          ? `You cannot send another request until ${new Date(access.cooldownEndsAt).toLocaleDateString()}.`
          : 'Your chat request was not approved by the coach.',
        state: access.state,
        code: access.reason,
        cooldownEndsAt: access.cooldownEndsAt,
      });
    }

    /* target_coach_id records the TARGET's primary coach, i.e. the receiving admin.
     * It is display metadata only - the panel that may act comes from
     * chat_request_approvers. */
    const targetCoachId = await chatPerm.resolvePrimaryCoachId(targetStudentUserId !== null ? targetStudentUserId : adminId);
    /* The panel: requester's primary coach, target's primary coach, every
     * Super Admin. All three may approve OR reject. */
    const partyIds = await chatPerm.resolveRequestParties(studentId, targetStudentUserId !== null ? targetStudentUserId : adminId);

    if (partyIds.length === 0) {
      return res.status(409).json({
        message: 'No coach is available to review this request.',
        code: 'no_approver',
      });
    }

    const inserted = await db.query(
      `INSERT INTO chat_admin_requests (student_user_id, admin_user_id, status, target_student_user_id)
       VALUES ($1, $2, 'pending', $3)
       RETURNING *`,
      [studentId, targetStudentUserId !== null ? adminId : adminId, targetStudentUserId]
    );

    // Lost the race against a concurrent submit: report the existing one rather
    // than pretending a second request was created.
    if (inserted.rows.length === 0) {
      const existing = await chatPerm.findPendingRequest(studentId, targetStudentUserId !== null ? targetStudentUserId : adminId);
      return res.status(409).json({
        message: 'Chat request pending',
        state: 'pending',
        requestId: existing ? Number(existing.id) : null,
        code: 'already_pending',
      });
    }

    const requestId = Number(inserted.rows[0].id);

    /* The panel, snapshotted at creation. can_decide is stored rather than derived so
     * that an account assigned or promoted later does not silently gain authority
     * over a request it was never asked about - and so the panel that answers a
     * student is exactly the panel that was notified. */
    await db.query(
      `INSERT INTO chat_request_approvers (chat_request_id, coach_id, can_decide)
       SELECT $1, UNNEST($2::int[]), TRUE
       ON CONFLICT (chat_request_id, coach_id) DO NOTHING`,
      [requestId, partyIds]
    );

    const [meRow, targetRow] = await Promise.all([
      db.query('SELECT name FROM users WHERE id = $1', [studentId]),
      db.query('SELECT name FROM users WHERE id = $1', [targetStudentUserId !== null ? targetStudentUserId : adminId]),
    ]);
    const meName = meRow.rows[0]?.name || 'A student';
    const targetName = targetRow.rows[0]?.name || (targetStudentUserId !== null ? 'another student' : 'another user');

    /* Everyone in the panel gets the same actionable notification: each of them can
     * approve or reject, so none of them is being told about someone else's
     * decision. related_id is the request id, which is what the queue, the bell
     * deep link and the settle pass all resolve against. */
    const io = req.app.get('io');
    const studentName = (await db.query('SELECT name FROM users WHERE id = $1', [studentId])).rows[0]?.name || 'A student';

    await Promise.all(
      partyIds.map((userId) =>
        notif.push(
          io, userId,
          'New chat request',
          `${meName} wants to chat with ${targetName}. You can approve or reject this request.`,
          { type: NOTIF_TYPE, senderId: studentId, relatedId: requestId, requestStatus: STATUS.PENDING }
        )
      )
    );

    res.status(201).json({
      requestId, status: STATUS.PENDING,
      approverCount: partyIds.length,
      message: 'Request sent. Waiting for coach approval.',
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ message: 'A request for this coach already exists.', code: 'request_exists' });
    }
    console.error('[chatAdminRequest:create] error', err);
    res.status(500).json({ message: 'Failed to send the chat request', error: err.message });
  }
}

/* ── GET /api/chat-requests/mine ── the requester's own history, newest first. */
async function mine(req, res) {
  try {
    const r = await db.query(
      `${REQUEST_SELECT}
        WHERE cr.requester_user_id = $1 OR cr.target_user_id = $1
      ORDER BY cr.created_at DESC, cr.id DESC
      LIMIT 200`,
      [req.user.id]
    );
    res.json({ requests: await shapeRequestsFor(r.rows, req.user.id, req.user.role) });
  } catch (err) {
    console.error('[chatRequest:mine] error', err);
    res.status(500).json({ message: 'Failed to load your chat requests', error: err.message });
  }
}

/* ── GET /api/chat-requests/inbox ──
  * The coach's actionable queue: requests where they are the recorded approver.
  * Pending first, then newest, so the thing needing a decision is always on top. */
async function inbox(req, res) {
  try {
    const status = req.query.status ? String(req.query.status).toLowerCase() : null;
    if (status && !VALID_STATUSES.has(status)) {
      return res.status(400).json({ message: 'Unknown status filter' });
    }
    const r = await db.query(
      `${REQUEST_SELECT}
            WHERE EXISTS (
                    SELECT 1 FROM chat_request_approvers a
                     WHERE a.chat_request_id = cr.id
                       AND a.coach_id = $1
                       AND a.can_decide
                   )
              AND ($2::text IS NULL OR cr.status = $2)
            ORDER BY (cr.status = 'pending') DESC, cr.created_at DESC, cr.id DESC
          LIMIT 200`,
      [req.user.id, status]
    );
    /* canDecide is true for every row by construction: /inbox is filtered on
     * can_decide. It is still sent explicitly so the UI has ONE rule - trust the
     * server's per-row flag - instead of special-casing which endpoint it came
     * from. */
    res.json({
      requests: await shapeRequestsFor(r.rows, req.user.id, req.user.role, { canDecide: true }),
    });
  } catch (err) {
    console.error('[chatRequest:inbox] error', err);
    res.status(500).json({ message: 'Failed to load chat requests', error: err.message });
  }
}

/* ── GET /api/chat-requests/admin/all ──
  * Super Admin oversight: every request, filterable by status and searchable by
  * user or coach (name or id).
  *
  * READ-ONLY BY DESIGN. The spec forbids admin actions bypassing the permission
  * system, and the only legitimate way for a Super Admin to decide a request is
  * to be its recorded fallback coach - which the approve route already permits on
  * its own merits. This list therefore exposes no mutation. */
async function adminList(req, res) {
  try {
    const status = req.query.status ? String(req.query.status).toLowerCase() : null;
    if (status && status !== 'all' && !VALID_STATUSES.has(status)) {
      return res.status(400).json({ message: 'Unknown status filter' });
    }
    const search = String(req.query.q || '').trim();

    const r = await db.query(
      `${REQUEST_SELECT}
        WHERE ($1::text IS NULL OR cr.status = $1)
          AND (
            $2 = ''
            OR req.name   ILIKE '%' || $2 || '%'
            OR tgt.name   ILIKE '%' || $2 || '%'
            OR coach.name ILIKE '%' || $2 || '%'
            OR CAST(cr.requester_user_id AS TEXT) = $2
            OR CAST(cr.target_user_id AS TEXT)    = $2
            OR CAST(cr.target_coach_id AS TEXT)   = $2
            /* Search must reach every approver, not just the owning coach:
               filtering by the second coach's name has to find the request. */
            OR EXISTS (
                 SELECT 1 FROM chat_request_approvers sa
                  JOIN users su ON su.id = sa.coach_id
                 WHERE sa.chat_request_id = cr.id
                    AND (su.name ILIKE '%' || $2 || '%'
                         OR CAST(sa.coach_id AS TEXT) = $2)
            )
          )
        ORDER BY cr.created_at DESC, cr.id DESC
        LIMIT 300`,
      [status === 'all' ? null : status, search]
    );
    res.json({ requests: await shapeRequestsFor(r.rows, req.user.id, req.user.role) });
  } catch (err) {
    console.error('[chatRequest:adminList] error', err);
    res.status(500).json({ message: 'Failed to load chat requests', error: err.message });
  }
}

/* ── GET /api/chat-requests/:id ── detail + the full history for that pair. */
async function detail(req, res) {
  try {
    const id = Number(req.params.id);
    const me = req.user.id;
    const isSuper = req.user.role === 'superadmin';

    const one = await db.query(`${REQUEST_SELECT} WHERE cr.id = $1`, [id]);
    if (one.rows.length === 0) return res.status(404).json({ message: 'Chat request not found' });
    const row = one.rows[0];

    // A request is visible to its two participants, every coach attached to it (the
    // decider AND the observers), and the Super Admin. Visibility is deliberately
    // wider than authority: the target's coach must be able to read what they were
    // notified about even though they cannot decide it.
    let involved =
      Number(row.requester_user_id) === Number(me) ||
      Number(row.target_user_id) === Number(me) ||
      isSuper;
    if (!involved) {
      const asApprover = await db.query(
        `SELECT 1 FROM chat_request_approvers WHERE chat_request_id = $1 AND coach_id = $2 LIMIT 1`,
        [row.id, me]
      );
      involved = asApprover.rows.length > 0;
    }
    if (!involved) return res.status(403).json({ message: 'Not allowed to view this request' });

    const pair = pairKey(row.requester_user_id, row.target_user_id);
    /* Named pairRows, not history: it shadows the /history handler above and
       reading `history` inside this function would be ambiguous. */
    const pairRows = await db.query(
      `${REQUEST_SELECT}
        WHERE (cr.requester_user_id = $1 AND cr.target_user_id = $2)
           OR (cr.requester_user_id = $2 AND cr.target_user_id = $1)
      ORDER BY cr.created_at DESC, cr.id DESC`,
      pair
    );

    const [shaped] = await shapeRequestsFor([row], me, req.user.role);
    res.json({ request: shaped, history: pairRows.rows.map(shapeRequest) });
  } catch (err) {
    console.error('[chatRequest:detail] error', err);
    res.status(500).json({ message: 'Failed to load chat request', error: err.message });
  }
}

/** Load a request and confirm the caller is entitled to decide it. */
async function loadDecidable(req) {
  const id = Number(req.params.id);
  const r = await db.query(`${REQUEST_SELECT} WHERE cr.id = $1`, [id]);
  if (r.rows.length === 0) return { error: { code: 404, body: { message: 'Chat request not found' } } };
  const row = r.rows[0];

  // Only a PANEL member decides: the requester's primary coach, the target's primary
  // coach, or a Super Admin. can_decide is stored on the request, so an account
  // assigned or promoted later does not inherit authority over a request it was
  // never asked about. First action wins, so the panel is symmetric - any one of
  // them can approve or reject, and no admin can be overruled.
  const inPanel = await db.query(
    `SELECT 1 FROM chat_request_approvers
      WHERE chat_request_id = $1 AND coach_id = $2 AND can_decide LIMIT 1`,
    [row.id, req.user.id]
  );
  if (inPanel.rows.length === 0) {
    return {
      error: {
        code: 403,
        body: {
          message: 'Only the two students\u2019 coaches or a Super Admin can decide this request.',
        },
      },
    };
  }
  if (row.status !== STATUS.PENDING) {
    return {
      error: {
        code: 409,
        body: { message: `This request was already ${row.status}.`, status: row.status },
      },
    };
  }
  return { row };
}

/* ── POST /api/chat-requests/:id/approve ───────────────────────────────────────
  * Approving does three things, in this order:
  *   1. flips the request to approved
  *   2. materialises the conversation pair (so an approved pair with no messages
  *      yet still has somewhere to live)
  *   3. notifies BOTH users
   */
async function approve(req, res) {
  try {
    const { row, error } = await loadDecidable(req);
    if (error) return res.status(error.code).json(error.body);

    const updated = await db.query(
      `UPDATE chat_requests
           SET status = 'approved', approved_at = NOW(), approved_by = $2, updated_at = NOW()
         WHERE id = $1 AND status = 'pending'
       RETURNING id`,
      [row.id, req.user.id]
    );
    // Guarded UPDATE: if it matched nothing, someone else decided first.
    if (updated.rows.length === 0) {
      return res.status(409).json({ message: 'This request was already decided.' });
    }

    const pair = pairKey(row.requester_user_id, row.target_user_id);
    await db.query(
      `INSERT INTO conversations (user1_id, user2_id, chat_request_id, status)
     VALUES ($1, $2, $3, 'active')
    ON CONFLICT (user1_id, user2_id) DO UPDATE SET updated_at = NOW()
   RETURNING id`,
      [pair[0], pair[1], row.id]
    );

    const io = req.app.get('io');
    // Both participants are told, so neither is left guessing.
    await Promise.all([
      notif.push(io, row.requester_user_id, 'Chat request approved',
        `Your request to chat with ${row.target_name} was approved. You can now message them.`, {
          type: NOTIF_TYPE, senderId: req.user.id, relatedId: Number(row.id), requestStatus: STATUS.APPROVED,
        }),
      notif.push(io, row.target_user_id, 'Chat request approved',
        `${row.requester_name}'s request to message you was approved.`, {
          type: NOTIF_TYPE, senderId: req.user.id, relatedId: Number(row.id), requestStatus: STATUS.APPROVED,
        }),
    ]);
    // Settle every asked coach's bell entry so none of them stop showing as pending.
    await settleApproverBells(row.id, STATUS.APPROVED);

    res.json({ message: 'Chat request approved.', requestId: Number(row.id), status: STATUS.APPROVED });
  } catch (err) {
    console.error('[chatRequest:approve] error', err);
    res.status(500).json({ message: 'Failed to approve chat request', error: err.message });
  }
}

/* ── POST /api/chat-requests/:id/reject ───────────────────────────────────────
  * Rejection records the decision and notifies the requester. It deliberately
   * creates no conversation, so the pair stays blocked; the requester may only try
   * again once the configured re-request rules allow it. */
async function reject(req, res) {
  try {
    const { row, error } = await loadDecidable(req);
    if (error) return res.status(error.code).json(error.body);

    const updated = await db.query(
      `UPDATE chat_requests
          SET status = 'rejected', rejected_at = NOW(), rejected_by = $2, updated_at = NOW()
        WHERE id = $1 AND status = 'pending'
      RETURNING id`,
      [row.id, req.user.id]
    );
    if (updated.rows.length === 0) {
      return res.status(409).json({ message: 'This request was already decided.' });
    }

    /* Nothing else to write. A rejection only ever happens on a PENDING row, so
     * there is no pairing record to retire (that is cancel's job) and no thread to
     * close: chatPermissionService reads the newest request and refuses the pair by
     * itself. An INSERT here was once attempted with a 'locked' status the
     * conversations CHECK does not allow, and it crashed after the row above had
     * already committed - a rejection that answered 500. */
    await settleApproverBells(row.id, STATUS.REJECTED);

    const settings = await chatPerm.getSettings();
    res.json({
      message: 'Chat request rejected.',
      requestId: Number(row.id),
      status: STATUS.REJECTED,
      rerequestAllowed: settings.allow_rerequest,
      rerequestCooldownDays: settings.rerequest_cooldown_days,
    });
  } catch (err) {
    console.error('[chatRequest:reject] error', err);
    res.status(500).json({ message: 'Failed to reject chat request', error: err.message });
  }
}

/* ── POST /api/chat-requests/:id/cancel   body: { reason?: string } ────────────
  * The only decision that stays available for the whole life of a request: it
  * works while pending AND after approval, because an approved chat is a live
  * conversation that has to be stoppable.
   *
   * Order matters and is deliberate:
   *   1. authorise (403) and check the status (409) BEFORE touching the row
   *   2. guarded UPDATE, so two people racing to cancel cannot both "win" and only
   *      one audit row is written
   *   3. archive the conversation pair, so the thread stops being surfaced as an
   *      empty live thread
   *   4. audit log
   *   5. notify BOTH users
   *   6. push `chat_cancelled` over the socket, so an OPEN thread flips to
   *      read-only immediately instead of after a reload
   *
   * The old approval is not revived and the row is not reused: because
   * chatPermissionService reads the NEWEST request, a cancelled pair has no live
   * approval and can only get back by submitting a brand-new request that the
   * panel decides again. */
async function cancel(req, res) {
  try {
    const { row, error } = await loadCancellable(req);
    if (error) return res.status(error.code).json(error.body);

    const rawReason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    const reason = rawReason.slice(0, 500) || null;

    const updated = await db.query(
      `UPDATE chat_requests
          SET status = 'cancelled',
              cancelled_at = NOW(),
              cancelled_by = $2,
              cancel_reason = $3,
              updated_at = NOW()
        WHERE id = $1 AND status IN ('pending', 'approved')
      RETURNING id, status, cancelled_at, cancelled_by, cancel_reason`,
      [row.id, req.user.id, reason]
    );
    /* Guarded UPDATE: an empty result means somebody else cancelled (or decided)
     * between the read above and here. Answering 409 rather than re-applying
     * keeps the audit log to exactly one row per real cancellation. */
    if (updated.rows.length === 0) {
      return res.status(409).json({ message: 'This chat has already been decided.' });
    }
    const now = updated.rows[0];

    /* Retire the pairing record. `conversations` is the durable record that an
     * approved pair exists; leaving it 'active' would keep an empty cancelled
     * chat sitting in both inboxes forever. Messages are untouched - history
     * stays readable for coach/admin review, which is the point of archiving
     * rather than deleting. */
    const pair = pairKey(row.requester_user_id, row.target_user_id);
    if (pair) {
      await db.query(
        `UPDATE conversations SET status = 'archived', updated_at = NOW()
          WHERE user1_id = $1 AND user2_id = $2 AND status = 'active'`,
        pair
      );
    }

    await writeAudit({
      requestId: Number(row.id),
      action: 'cancelled',
      actor: { id: req.user.id, name: req.user.name || 'Someone' },
      previousStatus: row.status,
      newStatus: STATUS.CANCELLED,
      reason,
    });

    const io = req.app.get('io');
    /* Both participants are NOT in a shared socket room - each is in
     * their own `user:<id>` room - so both are emitted to explicitly. Without
     * this, a user with the thread open keeps a composer that the server will
     * refuse, and only finds out after the failed send.
     *
     * `otherId` is the person I was talking to, so it is DIFFERENT for the two
     * recipients and the payload cannot be built once and reused: the requester
     * keys it on the target, the target keys it on the requester. */
    const cancelledBy = req.user.name || 'Someone';
    const base = {
      requestId: Number(row.id),
      cancelledBy,
      cancelledByUserId: Number(req.user.id),
      cancelledAt: now.cancelled_at,
      reason,
    };
    if (io) {
      io.to(`user:${row.requester_user_id}`).emit('chat_cancelled', {
        ...base, otherId: Number(row.target_user_id),
      });
      io.to(`user:${row.target_user_id}`).emit('chat_cancelled', {
        ...base, otherId: Number(row.requester_user_id),
      });
    }

    // Coaches' "pending" bells must not keep showing a request that is now dead.
    await settleApproverBells(row.id, STATUS.CANCELLED);

    res.json({
      message: 'Chat cancelled.',
      requestId: Number(row.id),
      status: STATUS.CANCELLED,
      cancelledBy,
      cancelledAt: now.cancelled_at,
      cancelReason: now.cancel_reason || null,
    });
  } catch (err) {
    console.error('[chatRequest:cancel] error', err);
    res.status(500).json({ message: 'Failed to cancel chat', error: err.message });
  }
}

/* What this module actually owns. The pair-level decisions below are the lazy
   delegations defined at the top; everything else is a function declared in this
   file. The HTTP handlers further down are deliberately NOT here: they are a
   parked copy of the two request controllers, they still call helpers that were
   never brought along with them, and no route points at this file. */
module.exports = {
  ADMIN_REQUEST_STATUS,
  STAFF_ROLES,
  pairKey,
  resolvePrimaryCoachId,
  resolveRequestParties,
  allocatedAdminUserIds,
  allocatedStudentUserIds,
  isAllocated,
  newestRequest,
  latestRequestsForPeers,
  stateFromRow,
  evaluateChannel,
  openChannelByAdmin,
};