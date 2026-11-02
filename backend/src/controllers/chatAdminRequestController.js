const db = require('../config/database');
const notif = require('../services/notificationService');
const adminReq = require('../services/chatAdminRequestService');

/* Student -> allocated-admin chat requests.
 *
 * Four endpoints, and the whole point of the file is that the authorisation lives
 * here rather than in the People list. Hiding a button is presentation; these
 * checks are what make "a student may only ask their own coach, only that coach
 * (or the academy owner) may answer, and only the sender may take an unanswered
 * ask back" true when someone calls the API directly.
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

/** CamelCase payload, shared by the list and the three write responses.
 *
 * `meRole` is what lets a Super Admin read someone else's row as the decision it
 * is for them: they are neither the sender nor the named coach, but the academy
 * gives them the same Accept/Cancel authority as the coach whose request it is. */
function shapeRequest(row, meId, meRole = null) {
  const studentUserId = Number(row.student_user_id);
  const adminUserId = Number(row.admin_user_id);
  const me = Number(meId);
  const pending = row.status === STATUSES.PENDING;
  /* The seat this row is being read from: the coach who owns it, or the owner
   * standing in for that coach. Both look at the learner; the learner looks at
   * the coach. */
  const iAmDecider = me === adminUserId || meRole === 'superadmin';
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
    otherId: iAmDecider ? studentUserId : adminUserId,
    otherName: iAmDecider ? row.student_name : row.admin_name,
    direction: iAmDecider ? 'received' : 'sent',
    /* The server decides both flags, so the UI never re-derives a permission.
     * Answering is for the named coach and the owner; WITHDRAWING your own
     * unanswered ask is not an answer, so it stays with the learner - which is
     * what the "Request pending, cancel it" row on the student's side needs. */
    canDecide: iAmDecider && pending,
    canCancel: iAmDecider
      ? (pending || row.status === STATUSES.ACCEPTED)
      : me === studentUserId && pending,
  };
}

/** Push the same transition to both sides with each one's own `otherId`.
 *
 * Exported because a coach's first message is also a transition (see
 * chatController.sendDirectMessage), and a second place that builds this payload
 * by hand is how the two sides of the People list start drifting apart. */
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
 * goes to exactly one named admin, and that admin (or the academy owner, standing
 * in for them) is the only one who can answer it.
 *
 * A student asking to chat with a CLASSMATE does not come here either; that pair is
 * a peer request in chat_requests, whose deciders are the two students' coaches.
 * A row here is a student and their own coach and nobody else, which is what lets
 * accept/cancel stay a two-button decision with one named owner.
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

    /* One live ask per pair. An unanswered one is RETURNED rather than duplicated,
       so a second tap on "Request chat" repaints the row to "Request sent" instead
       of failing something that already worked; an accepted one is the same story
       from the other side - the channel is open, so say so. */
    const newest = await adminReq.newestRequest(studentId, adminId);
    if (newest && newest.status === STATUSES.PENDING) {
      return res.json({
        requestId: Number(newest.id), status: STATUSES.PENDING, alreadyPending: true,
        message: 'Request sent. Waiting for coach approval.',
      });
    }
    if (newest && newest.status === STATUSES.ACCEPTED) {
      return res.json({
        requestId: Number(newest.id), status: STATUSES.ACCEPTED,
        message: `You and ${target.rows[0].name} can chat.`,
      });
    }

    const inserted = await db.query(
      `INSERT INTO chat_admin_requests (student_user_id, admin_user_id, status)
       VALUES ($1, $2, 'pending')
       RETURNING *`,
      [studentId, adminId]
    );
    const row = inserted.rows[0];

    const meRow = await db.query('SELECT name FROM users WHERE id = $1', [studentId]);
    const meName = meRow.rows[0]?.name || 'A student';

    const io = req.app.get('io');
    /* Exactly one decider, named on the row - no panel to snapshot. The owner is
       given the same ask as a copy, because the accept route lets them answer on
       their coach's behalf; leaving them uninformed would make that authority
       unreachable. */
    const coaches = [Number(row.admin_user_id)];
    const owners = req.user.role === 'superadmin'
      ? []
      : (await db.query(`SELECT id FROM users WHERE role = 'superadmin' ORDER BY id ASC`)).rows.map((r) => Number(r.id));
    await Promise.all(
      [...new Set([...coaches, ...owners])].map((userId) =>
        notif.push(
          io, userId,
          'New chat request',
          `${meName} wants to chat with you. You can accept or cancel this request.`,
          { type: NOTIF_TYPE, senderId: studentId, relatedId: Number(row.id), requestStatus: STATUSES.PENDING }
        )
      )
    );
    /* And the coach's People list repaints at once: their row for this student moves
       from "No request" to "Their request" without waiting for the poll. */
    emitToPair(io, row);

    res.status(201).json({
      requestId: Number(row.id), status: STATUSES.PENDING,
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

/**
 * Load a request and confirm the caller may act on it.
 *
 * Shared by accept and cancel because both start from the same read, and because a
 * 404-vs-403 split that leaks which request ids exist is not worth the argument.
 *
 * Three callers get through:
 *   the named coach         the ordinary case - Accept or Cancel, their own ask;
 *   a Super Admin           oversight. The academy gives the owner the same answer
 *                           rights over any request, so this is the one place the
 *                           rule "only that admin decides" is widened, and it is
 *                           widened because the spec names the owner explicitly.
 *   the learner who sent it CANCEL only (`allowSelfCancel`). Withdrawing an ask
 *                           that has not been answered is not an answer about
 *                           anybody, and the student's own pending row has to offer
 *                           it - but they may never accept, and never close a chat
 *                           the coach opened.
 */
async function loadForDecision(req, res, { allowSelfCancel = false } = {}) {
  const r = await db.query(`${REQUEST_SELECT} WHERE r.id = $1`, [Number(req.params.id)]);
  if (r.rows.length === 0) {
    res.status(404).json({ message: 'Request not found' });
    return null;
  }
  const row = r.rows[0];
  const me = Number(req.user.id);
  const mayAct = me === Number(row.admin_user_id) ||
    req.user.role === 'superadmin' ||
    (allowSelfCancel && me === Number(row.student_user_id));
  if (mayAct) return row;
  res.status(403).json({
    message: 'Only the coach this request was sent to can answer it.',
    code: 'not_your_request',
  });
  return null;
}

/* True when the caller IS the coach named on the row. The notification copy and
 * the bell entry belong to that coach, so when the owner decides instead, the
 * student must not be told their coach did it. */
function isNamedCoach(row, meId) {
  return Number(row.admin_user_id) === Number(meId);
}

/**
 * POST /api/chat-admin-requests/:id/accept
 *
 * For a learner it is the only way past "you may not write to your coach": the
 * coach's own first message opens the same channel without a request, but nothing
 * a LEARNER does gets them in. It also has to re-check allocation: a request that
 * sat unanswered while the student moved to another coach must not be acceptable,
 * because the gate would refuse the pair anyway and the coach would be looking at
 * an accepted request that does nothing.
 */
async function accept(req, res) {
  try {
    const row = await loadForDecision(req, res);
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

    /* Allocation is measured against the COACH ON THE ROW, not the caller: when
       the owner accepts on a coach's behalf, "you are not their coach" is the wrong
      reason to refuse the pair. */
    const allocated = await adminReq.allocatedAdminUserIds(row.student_user_id);
    if (!allocated.includes(Number(row.admin_user_id))) {
      return res.status(409).json({
        message: isNamedCoach(row, req.user.id)
          ? 'This student is no longer allocated to you. They will need to ask their new coach.'
          : 'This student is no longer allocated to that coach.',
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
       related id so the entry the coach clicked resolves to a settled request - and
       the entry is the COACH's even when the owner is the one who clicked. */
    await notif.setRequestStatus({
      relatedId: Number(row.id),
      userId: Number(row.admin_user_id),
      requestStatus: STATUSES.ACCEPTED,
      type: NOTIF_TYPE,
      isRead: true,
    });
    const io = req.app.get('io');
    await notif.push(io, Number(row.student_user_id), row.admin_name,
      `${row.admin_name} accepted your chat request. You can message them now.`, {
        type: NOTIF_TYPE,
        senderId: Number(row.admin_user_id),
        relatedId: Number(row.id),
        requestStatus: STATUSES.ACCEPTED,
      });
    emitToPair(io, { ...row, ...fresh });

    res.json({ request: shapeRequest({ ...row, ...fresh }, req.user.id, req.user.role) });
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
 *
 * The learner reaches this endpoint too, but only to take back an ask nobody has
 * answered: their own "Request pending" row offers Cancel, and closing a chat that
 * is already open stays the coach's call.
 */
async function cancel(req, res) {
  try {
    const row = await loadForDecision(req, res, { allowSelfCancel: true });
    if (!row) return;

    if (row.status === STATUSES.CANCELLED) {
      return res.status(409).json({ message: 'This request is already cancelled.', code: 'already_cancelled' });
    }

    const me = Number(req.user.id);
    const iAmSender = me === Number(row.student_user_id);
    const wasAccepted = row.status === STATUSES.ACCEPTED;

    if (iAmSender && wasAccepted) {
      return res.status(403).json({
        message: 'Only your coach can close a chat they have accepted.',
        code: 'not_your_request',
      });
    }

    const updated = await db.query(
      `UPDATE chat_admin_requests
          SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = $1, updated_at = NOW()
        WHERE id = $2
        RETURNING *`,
      [req.user.id, row.id]
    );
    const fresh = updated.rows[0];

    /* Whichever direction this went, the coach's unread ask is settled - so the
       bell entry is the COACH's even when the learner is the one who withdrew. */
    await notif.setRequestStatus({
      relatedId: Number(row.id),
      userId: Number(row.admin_user_id),
      requestStatus: STATUSES.CANCELLED,
      type: NOTIF_TYPE,
      isRead: true,
    });

    const io = req.app.get('io');
    const actorName = isNamedCoach(row, me)
      ? row.admin_name
      : (String(req.user.name || '').trim() || 'The academy owner');

    if (iAmSender) {
      await notif.push(io, Number(row.admin_user_id), row.student_name,
        `${row.student_name} withdrew their chat request.`, {
          type: NOTIF_TYPE,
          senderId: me,
          relatedId: Number(row.id),
          requestStatus: STATUSES.CANCELLED,
        });
    } else {
      /* Named after the coach when the coach acted, and after whoever else did it:
         a learner told "your coach cancelled" when the owner stepped in has been
         told the wrong thing about who to talk to. */
      await notif.push(io, Number(row.student_user_id), actorName,
        wasAccepted
          ? `${actorName} closed your chat.`
          : `${actorName} cancelled your chat request.`, {
            type: NOTIF_TYPE,
            senderId: me,
            relatedId: Number(row.id),
            requestStatus: STATUSES.CANCELLED,
          });
    }

    /* Cancelling an OPEN chat has to stop the live thread on both screens right
     * now, not on the next poll, so the peer queue's own event is reused with the
     * same shape: the frontend already knows how to flip an open thread to
     * read-only when it sees this. */
    if (wasAccepted) {
      notif.emitToUser(io, Number(row.student_user_id), 'chat_cancelled', {
        requestId: Number(row.id),
        otherId: Number(row.admin_user_id),
        cancelledBy: actorName,
        cancelledAt: fresh.cancelled_at,
      });
      notif.emitToUser(io, Number(row.admin_user_id), 'chat_cancelled', {
        requestId: Number(row.id),
        otherId: Number(row.student_user_id),
        cancelledBy: isNamedCoach(row, me) ? 'You' : actorName,
        cancelledAt: fresh.cancelled_at,
      });
    }
    emitToPair(io, { ...row, ...fresh });

    res.json({ request: shapeRequest({ ...row, ...fresh }, req.user.id, req.user.role) });
  } catch (err) {
    console.error('[chatAdminRequest:cancel] error', err);
    res.status(500).json({ message: 'Failed to cancel the request', error: err.message });
  }
}

/**
 * GET /api/chat-admin-requests?status=pending
 *
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
    params.push(Math.min(200, Math.max(1, Number(req.query.limit) || 100)));
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

module.exports = { create, accept, cancel, mine, emitToPair, NOTIF_TYPE, SOCKET_EVENT };
