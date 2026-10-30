const db = require('../config/database');
const notif = require('../services/notificationService');
const adminReq = require('../services/chatAdminRequestService');

/* Student -> allocated-admin chat requests.
 *
 * Four endpoints, and the whole point of the file is that the authorisation lives
 * here rather than in the People list. Hiding a button is presentation; these
 * checks are what make "a student may only ask their own coach, and only that
 * coach may answer" true when someone calls the API directly.
 *
 * NOT mounted under /api/chat on purpose, for the same reason /api/chat-requests
 * is not: that router is wrapped in requireFeatureByRole, and an admin whose
 * 'messaging_students' switch happens to be off must still be able to accept or
 * cancel a request. Otherwise a feature toggle would strand requests forever.
 */

const NOTIF_TYPE = 'chat_admin_request';

/* The socket every client listens to. One event for every transition, carrying
 * `otherId` (the counterpart from the receiver's point of view) plus the new
 * status, so one handler in ChatContext patches the right People row without a
 * refetch and the two sides can never drift apart. */
const SOCKET_EVENT = 'admin_chat_request';

const STATUSES = adminReq.ADMIN_REQUEST_STATUS;

const REQUEST_SELECT = `
  SELECT r.id,
         r.student_user_id,
         r.admin_user_id,
         r.status,
         r.created_at,
         r.updated_at,
         r.accepted_at,
         r.cancelled_at,
         stu.name  AS student_name,
         stu.role  AS student_role,
         adm.name  AS admin_name,
         adm.role  AS admin_role,
         dec.name  AS decided_by_name
    FROM chat_admin_requests r
    JOIN users stu ON stu.id = r.student_user_id
    JOIN users adm ON adm.id = r.admin_user_id
    LEFT JOIN users dec ON dec.id = COALESCE(r.accepted_by, r.cancelled_by)
`;

/** CamelCase payload, shared by the list and the three write responses. */
function shapeRequest(row, meId) {
  const studentUserId = Number(row.student_user_id);
  const adminUserId = Number(row.admin_user_id);
  const meIsAdmin = Number(meId) === adminUserId;
  return {
    id: Number(row.id),
    studentId: studentUserId,
    studentName: row.student_name,
    adminId: adminUserId,
    adminName: row.admin_name,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    acceptedAt: row.accepted_at,
    cancelledAt: row.cancelled_at,
    decidedBy: row.decided_by_name || null,
    /* Whichever side I am on, `otherId` is the person the row is about. */
    otherId: meIsAdmin ? studentUserId : adminUserId,
    otherName: meIsAdmin ? row.student_name : row.admin_name,
    direction: meIsAdmin ? 'received' : 'sent',
    /* Only the named admin may act, and only while the request is unanswered.
     * The server decides this so the UI never has to re-derive a permission. */
    canDecide: meIsAdmin && row.status === STATUSES.PENDING,
  };
}

/** Push the same transition to both sides with each one's own `otherId`. */
function emitToPair(io, row) {
  if (!io) return;
  const studentUserId = Number(row.student_user_id);
  const adminUserId = Number(row.admin_user_id);
  notif.emitToUser(io, studentUserId, SOCKET_EVENT, {
    requestId: Number(row.id),
    status: row.status,
    otherId: adminUserId,
    otherName: row.admin_name,
  });
  notif.emitToUser(io, adminUserId, SOCKET_EVENT, {
    requestId: Number(row.id),
    status: row.status,
    otherId: studentUserId,
    otherName: row.student_name,
  });
}

/**
 * POST /api/chat-admin-requests   body: { adminId }
 *
 * A student asks the coach allocated to them for permission to chat. Nothing else
 * is accepted: no free text, no reason, no choice of who decides - the request
 * goes to exactly one named admin and that admin is the only one who can answer.
 */
async function create(req, res) {
  try {
    const studentId = Number(req.user.id);
    const adminId = Number(req.body?.adminId);

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

    const allocated = await adminReq.allocatedAdminUserIds(studentId);
    if (!allocated.includes(adminId)) {
      /* The message stays vague about whether the coach exists: this endpoint
         otherwise doubles as a way to enumerate who is allocated to whom. */
      return res.status(403).json({
        message: 'You can only request a chat with a coach allocated to you.',
        code: 'not_allocated',
      });
    }

    const newest = await adminReq.newestRequest(studentId, adminId);
    if (newest && (newest.status === STATUSES.PENDING || newest.status === STATUSES.ACCEPTED)) {
      return res.status(409).json({
        message: newest.status === STATUSES.PENDING
          ? 'You have already sent a request that is still awaiting an answer.'
          : 'You can already message this coach.',
        code: 'request_exists',
        state: newest.status,
        requestId: Number(newest.id),
      });
    }

    const inserted = await db.query(
      `INSERT INTO chat_admin_requests (student_user_id, admin_user_id, status)
       VALUES ($1, $2, 'pending')
       RETURNING *`,
      [studentId, adminId]
    );
    const row = inserted.rows[0];

    /* The partial unique index is the backstop for two taps in the same instant;
     * the check above only makes the common case read nicely. */
    const io = req.app.get('io');
    const student = await db.query('SELECT name FROM users WHERE id = $1', [studentId]);
    const studentName = student.rows[0]?.name || 'A student';

    await notif.push(io, adminId, studentName, `${studentName} wants to chat with you`, {
      type: NOTIF_TYPE,
      senderId: studentId,
      relatedId: Number(row.id),
      requestStatus: STATUSES.PENDING,
    });
    emitToPair(io, {
      ...row,
      admin_name: target.rows[0].name,
      student_name: studentName,
    });

    res.status(201).json({
      request: shapeRequest(
        { ...row, student_name: studentName, admin_name: target.rows[0].name },
        studentId
      ),
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ message: 'A request for this coach already exists.', code: 'request_exists' });
    }
    console.error('[chatAdminRequest:create] error', err);
    res.status(500).json({ message: 'Failed to send the chat request', error: err.message });
  }
}

/**
 * Load a request and confirm the caller is the admin it was sent to.
 *
 * Shared by accept and cancel because the two rules are identical, and because a
 * 404-vs-403 split that leaks which request ids exist is not worth the argument.
 * Super Admin gets no override here: the spec names one decider, and a third party
 * accepting on a coach's behalf would make the accepted state a lie about consent.
 */
async function loadForAdmin(req, res) {
  const r = await db.query(`${REQUEST_SELECT} WHERE r.id = $1`, [Number(req.params.id)]);
  if (r.rows.length === 0) {
    res.status(404).json({ message: 'Request not found' });
    return null;
  }
  const row = r.rows[0];
  if (Number(row.admin_user_id) !== Number(req.user.id)) {
    res.status(403).json({
      message: 'Only the coach this request was sent to can answer it.',
      code: 'not_your_request',
    });
    return null;
  }
  return row;
}

/**
 * POST /api/chat-admin-requests/:id/accept
 *
 * The ONLY way a student reaches the messaging state for a coach. It also has to
 * re-check allocation: a request that sat unanswered while the student moved to
 * another coach must not be acceptable, because the gate would refuse the pair
 * anyway and the coach would be looking at an accepted request that does nothing.
 */
async function accept(req, res) {
  try {
    const row = await loadForAdmin(req, res);
    if (!row) return;

    if (row.status !== STATUSES.PENDING) {
      return res.status(409).json({
        message: row.status === STATUSES.ACCEPTED
          ? 'This request is already accepted.'
          : 'This request has already been cancelled.',
        code: 'already_decided',
        state: row.status,
      });
    }

    const allocated = await adminReq.allocatedAdminUserIds(row.student_user_id);
    if (!allocated.includes(Number(req.user.id))) {
      return res.status(409).json({
        message: 'This student is no longer allocated to you. They will need to ask their new coach.',
        code: 'not_allocated',
      });
    }

    const updated = await db.query(
      `UPDATE chat_admin_requests
          SET status = 'accepted', accepted_at = NOW(), accepted_by = $1, updated_at = NOW()
        WHERE id = $2
        RETURNING *`,
      [req.user.id, row.id]
    );
    const fresh = updated.rows[0];

    /* Close the coach's own bell entry, then tell the student. Both use the same
       related id so the entry the coach clicked resolves to a settled request. */
    await notif.setRequestStatus({
      relatedId: Number(row.id),
      userId: Number(req.user.id),
      requestStatus: STATUSES.ACCEPTED,
      type: NOTIF_TYPE,
      isRead: true,
    });
    const io = req.app.get('io');
    await notif.push(io, Number(row.student_user_id), req.user.name || 'Your coach',
      `${row.admin_name} accepted your chat request. You can message them now.`, {
        type: NOTIF_TYPE,
        senderId: Number(req.user.id),
        relatedId: Number(row.id),
        requestStatus: STATUSES.ACCEPTED,
      });
    emitToPair(io, { ...row, ...fresh });

    res.json({ request: shapeRequest({ ...row, ...fresh }, req.user.id) });
  } catch (err) {
    console.error('[chatAdminRequest:accept] error', err);
    res.status(500).json({ message: 'Failed to accept the request', error: err.message });
  }
}

/**
 * POST /api/chat-admin-requests/:id/cancel
 *
 * Withdraws a pending request, and closes an accepted one. Cancelling is the only
 * way a coach shuts a channel that has already been opened, and it is reversible
 * only by a NEW request from the student - which is why the student's copy says
 * "you can ask again" rather than "you were refused".
 */
async function cancel(req, res) {
  try {
    const row = await loadForAdmin(req, res);
    if (!row) return;

    if (row.status === STATUSES.CANCELLED) {
      return res.status(409).json({ message: 'This request is already cancelled.', code: 'already_cancelled' });
    }

    const wasAccepted = row.status === STATUSES.ACCEPTED;
    const updated = await db.query(
      `UPDATE chat_admin_requests
          SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = $1, updated_at = NOW()
        WHERE id = $2
        RETURNING *`,
      [req.user.id, row.id]
    );
    const fresh = updated.rows[0];

    await notif.setRequestStatus({
      relatedId: Number(row.id),
      userId: Number(req.user.id),
      requestStatus: STATUSES.CANCELLED,
      type: NOTIF_TYPE,
      isRead: true,
    });

    const io = req.app.get('io');
    await notif.push(io, Number(row.student_user_id), req.user.name || 'Your coach',
      wasAccepted
        ? `${row.admin_name} closed your chat.`
        : `${row.admin_name} cancelled your chat request.`, {
          type: NOTIF_TYPE,
          senderId: Number(req.user.id),
          relatedId: Number(row.id),
          requestStatus: STATUSES.CANCELLED,
        });

    /* Cancelling an OPEN chat has to stop the live thread on both screens right
     * now, not on the next poll, so the peer queue's own event is reused with the
     * same shape: the frontend already knows how to flip an open thread to
     * read-only when it sees this. */
    if (wasAccepted) {
      notif.emitToUser(io, Number(row.student_user_id), 'chat_cancelled', {
        requestId: Number(row.id),
        otherId: Number(row.admin_user_id),
        cancelledBy: req.user.name || 'Your coach',
        cancelledAt: fresh.cancelled_at,
      });
      notif.emitToUser(io, Number(row.admin_user_id), 'chat_cancelled', {
        requestId: Number(row.id),
        otherId: Number(row.student_user_id),
        cancelledBy: req.user.name || 'You',
        cancelledAt: fresh.cancelled_at,
      });
    }
    emitToPair(io, { ...row, ...fresh });

    res.json({ request: shapeRequest({ ...row, ...fresh }, req.user.id) });
  } catch (err) {
    console.error('[chatAdminRequest:cancel] error', err);
    res.status(500).json({ message: 'Failed to cancel the request', error: err.message });
  }
}

/**
 * GET /api/chat-admin-requests?status=pending
 *
 * Every request the caller is a party to, in either direction: the coach's queue
 * of incoming asks and the student's own history. Optional status filter, newest
 * first, capped - the People list is the primary surface, so this is the fallback
 * for a client that wants the request rows themselves.
 */
async function mine(req, res) {
  try {
    const me = Number(req.user.id);
    const status = String(req.query.status || '').trim();
    const params = [me];
    let where = `(r.student_user_id = $1 OR r.admin_user_id = $1)`;
    if (status && Object.values(STATUSES).includes(status)) {
      params.push(status);
      where += ` AND r.status = $${params.length}`;
    }
    params.push(Math.min(200, Math.max(1, Number(req.query.limit) || 100)));
    const r = await db.query(
      `${REQUEST_SELECT} WHERE ${where} ORDER BY r.created_at DESC, r.id DESC LIMIT $${params.length}`,
      params
    );
    res.json({ requests: r.rows.map((row) => shapeRequest(row, me)) });
  } catch (err) {
    console.error('[chatAdminRequest:mine] error', err);
    res.status(500).json({ message: 'Failed to load chat requests', error: err.message });
  }
}

module.exports = { create, accept, cancel, mine, NOTIF_TYPE, SOCKET_EVENT };
