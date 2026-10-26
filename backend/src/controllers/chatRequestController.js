const db = require('../config/database');
const notif = require('../services/notificationService');
const chatPerm = require('../services/chatPermissionService');
const { isAdminRole } = require('../middleware/roleMiddleware');

const { STATUS, pairKey } = chatPerm;

const NOTIF_TYPE = 'chat_request';

/* Full row shape shared by the coach queue, the requester's history, the Super
 * Admin oversight list and the detail view, so all four surfaces render exactly
 * the same fields. Every name and id the spec asks for is resolved here. */
const REQUEST_SELECT = `
  SELECT cr.id,
         cr.requester_user_id,
         cr.target_user_id,
         cr.target_coach_id,
         cr.status,
         cr.created_at,
         cr.updated_at,
         cr.approved_at,
         cr.rejected_at,
         cr.cancelled_at,
         cr.cancel_reason,
         cr.approved_by,
         cr.rejected_by,
         cr.cancelled_by,
         req.id    AS requester_student_id,
         req.name  AS requester_name,
         req.email AS requester_email,
         tgt.id    AS target_student_id,
         tgt.name  AS target_name,
         tgt.email AS target_email,
         coach.id   AS coach_user_id,
         coach.name AS coach_name,
appr.name  AS approver_name,
           rej.name   AS rejecter_name,
           canx.name  AS canceller_name,
          /* Everyone who was asked to decide, so the UI can name all of them
             instead of implying one coach had the request. */
COALESCE(an.names, '[]'::jsonb) AS approver_names
     FROM chat_requests cr
     JOIN users req   ON req.id = cr.requester_user_id
     JOIN users tgt   ON tgt.id = cr.target_user_id
     LEFT JOIN users coach ON coach.id = cr.target_coach_id
     LEFT JOIN users appr  ON appr.id = cr.approved_by
     LEFT JOIN users rej   ON rej.id = cr.rejected_by
     LEFT JOIN users canx  ON canx.id = cr.cancelled_by
     LEFT JOIN LATERAL (
       /* The panel: requester's primary coach, target's primary coach, Super Admins.
          can_decide is filtered so a future read-only observer type stays invisible
          here, but today every panel member is included. */
       SELECT jsonb_agg(jsonb_build_object('id', cu.id, 'name', cu.name)
                        ORDER BY (cu.id = cr.target_coach_id) DESC, cu.name) AS names
         FROM chat_request_approvers ca
         JOIN users cu ON cu.id = ca.coach_id
        WHERE ca.chat_request_id = cr.id AND ca.can_decide
     ) an ON TRUE
`;

/** Shape a DB row into the camelCase payload the frontend consumes. */
function shapeRequest(row) {
  return {
    id: Number(row.id),
    requesterUserId: Number(row.requester_user_id),
    requesterName: row.requester_name,
    requesterStudentId: row.requester_student_id != null ? Number(row.requester_student_id) : null,
    targetUserId: Number(row.target_user_id),
    targetName: row.target_name,
    targetStudentId: row.target_student_id != null ? Number(row.target_student_id) : null,
    targetCoachId: row.target_coach_id != null ? Number(row.target_coach_id) : null,
    coachName: row.coach_name || null,
    /* The full panel: requester's primary coach, target's primary coach and Super
       Admins. Every one of them can approve or reject. Falls back to the single
       owning coach for rows written before the panel existed. */
    coachNames: Array.isArray(row.approver_names) && row.approver_names.length > 0
      ? row.approver_names
      : (row.coach_name ? [{ id: Number(row.target_coach_id), name: row.coach_name }] : []),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    approvedAt: row.approved_at,
    rejectedAt: row.rejected_at,
    /* Cancellation is a first-class outcome, not an absence of approval: the
       detail view has to be able to say WHO stopped the chat, WHEN, and WHY. */
    cancelledAt: row.cancelled_at,
    cancelReason: row.cancel_reason || null,
    approvedBy: row.approver_name || null,
    rejectedBy: row.rejecter_name || null,
    cancelledBy: row.canceller_name || null,
    /* The deciding admin's id as well as their name: two admins can share a
       display name, and oversight needs to name the exact account. */
    approvedByUserId: row.approved_by != null ? Number(row.approved_by) : null,
    rejectedByUserId: row.rejected_by != null ? Number(row.rejected_by) : null,
    cancelledByUserId: row.cancelled_by != null ? Number(row.cancelled_by) : null,
  };
}

const VALID_STATUSES = new Set([STATUS.PENDING, STATUS.APPROVED, STATUS.REJECTED, STATUS.CANCELLED]);

/**
 * Settle the bell entry of EVERY panel member.
 *
 * Creation pushed one notification per panel member, so an outcome has to close
 * all of them. Settling only one would leave the other admins looking at a
 * pending request that no longer exists, with a queue badge that never clears.
 * The approvers table is sufficient here because Super Admins are panel members
 * and therefore already have a row.
 */
async function settleApproverBells(requestId, status) {
  const recipients = await db.query(
    `SELECT coach_id AS user_id FROM chat_request_approvers WHERE chat_request_id = $1`,
    [requestId]
  );
  await Promise.all(
    recipients.rows.map((r) =>
      notif.setRequestStatus({
        relatedId: Number(requestId), userId: Number(r.user_id),
        requestStatus: status, isRead: true, type: NOTIF_TYPE,
      })
    )
  );
}

/* ── Cancellation ──────────────────────────────────────────────────────────
 * Cancelling is the one decision that stays available for the WHOLE life of a
 * request, including after it was approved and both students are already talking.
 * That is deliberate: a coach who approved a pairing can be told afterwards that
 * it must stop, and either student can end a conversation they no longer want.
 *
 * Three groups may act, and the set is computed server-side so the UI can never
 * offer a button the endpoint would refuse:
 *   1. the recorded PANEL for this request (can_decide) - the same authority the
 *      approve/reject buttons use, so "the coach who approved it can undo it"
 *   2. any admin/superadmin - academy oversight, any chat
 *   3. the two students in the request, but ONLY their own chat
 * Everyone else is refused with 403 and shown no button at all. */

/** Statuses a chat can still be in when it is worth cancelling. */
const CANCELLABLE_STATUSES = new Set([STATUS.PENDING, STATUS.APPROVED]);

/**
 * Whether `me` may cancel `row`, ignoring the status gate the caller applies
 * separately. `inPanel` is passed in rather than queried per row, so decorating a
 * 200-row queue costs one extra query instead of 200.
 */
function mayCancel(row, me, role, inPanel) {
  if (inPanel) return true;
  if (isAdminRole(role)) return true;
  const id = Number(me);
  return Number(row.requester_user_id) === id || Number(row.target_user_id) === id;
}

/**
 * Shape a whole result set, stamping each row with its own `canCancel`.
 *
 * The flag is per REQUEST, not per viewer-role: a coach is on the panel for some
 * requests and an unrelated bystander for others, and the same coach is a
 * participant on one chat and an observer on another. Computing it here is what
 * lets the page render a plain `request.canCancel` without re-deriving the rule.
 */
async function shapeRequestsFor(rows, me, role, extra = {}) {
  const ids = rows.map((r) => Number(r.id));
  const panelForMe = new Set();
  if (ids.length > 0) {
    const p = await db.query(
      `SELECT chat_request_id FROM chat_request_approvers
        WHERE chat_request_id = ANY($1::int[]) AND coach_id = $2 AND can_decide`,
      [ids, me]
    );
    for (const hit of p.rows) panelForMe.add(Number(hit.chat_request_id));
  }
  return rows.map((row) => {
    const cancelOk =
      CANCELLABLE_STATUSES.has(row.status) &&
      mayCancel(row, me, role, panelForMe.has(Number(row.id)));
    return { ...shapeRequest(row), ...extra, canCancel: cancelOk };
  });
}

/** Load a request and confirm the caller may cancel it. */
async function loadCancellable(req) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return { error: { code: 404, body: { message: 'Chat request not found' } } };
  }
  const r = await db.query(`${REQUEST_SELECT} WHERE cr.id = $1`, [id]);
  if (r.rows.length === 0) return { error: { code: 404, body: { message: 'Chat request not found' } } };
  const row = r.rows[0];

  // Panel membership is the same authority approve/reject use, so the admin who
  // approved a chat is also the admin who can cancel it - no second, wider rule.
  const inPanel = await db.query(
    `SELECT 1 FROM chat_request_approvers
      WHERE chat_request_id = $1 AND coach_id = $2 AND can_decide LIMIT 1`,
    [row.id, req.user.id]
  );
  const isParticipant =
    Number(row.requester_user_id) === Number(req.user.id) ||
    Number(row.target_user_id) === Number(req.user.id);
  if (
    inPanel.rows.length === 0 &&
    !isAdminRole(req.user.role) &&
    !isParticipant
  ) {
    return {
      error: {
        code: 403,
        body: {
          message:
            'Only a coach, an admin, or one of the two users in this chat can cancel it.',
        },
      },
    };
  }

  if (!CANCELLABLE_STATUSES.has(row.status)) {
    return {
      error: {
        code: 409,
        body: {
          message: `Only a pending or approved chat can be cancelled. This one is already ${row.status}.`,
          status: row.status,
        },
      },
    };
  }
  return { row };
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

/* ── GET /api/chat-requests/eligibility?targetUserId= ──
 * The one call the Message button makes when a profile is opened. Returns the
 * full state machine so the UI never has to guess, and never has to infer
 * permission from data it happens to already have. */
async function eligibility(req, res) {
  try {
    const targetUserId = Number(req.query.targetUserId);
    if (!targetUserId) return res.status(400).json({ message: 'targetUserId required' });

    const access = await chatPerm.evaluateAccess(req.user.id, targetUserId, req.user.role);
    res.json(access);
  } catch (err) {
    console.error('[chatRequest:eligibility] error', err);
    res.status(500).json({ message: 'Failed to check chat permission', error: err.message });
  }
}

/* ── POST /api/chat-requests  { targetUserId } ──
 * Creates ONE pending request.
 *
 * ONE DECIDER (the requester's primary coach) and OBSERVERS (the target's primary
 * coach, plus superadmins). The split is deliberate: exactly one person answers
 * the student, so a request cannot be approved by one colleague and then disputed
 * by another, while everyone responsible for either student can still see it.
 *
 * The pending check runs first and the database's partial unique index backs it
 * up, because two fast clicks (or a double-submitted form) must not produce two
 * requests that a coach then has to arbitrate. */
async function create(req, res) {
  try {
    const me = req.user.id;
    const targetUserId = Number(req.body.targetUserId);
    if (!targetUserId) return res.status(400).json({ message: 'targetUserId required' });

    const access = await chatPerm.evaluateAccess(me, targetUserId, req.user.role);

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
    // Re-request rules live in the service so the button and this endpoint can
    // never disagree about whether a new request is allowed right now.
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
    const targetCoachId = await chatPerm.resolvePrimaryCoachId(targetUserId);
    /* The panel: requester's primary coach, target's primary coach, every
     * Super Admin. All three may approve OR reject. */
    const partyIds = await chatPerm.resolveRequestParties(me, targetUserId);

    if (partyIds.length === 0) {
      return res.status(409).json({
        message: 'No coach is available to review this request.',
        code: 'no_approver',
      });
    }

    const inserted = await db.query(
      `INSERT INTO chat_requests (requester_user_id, target_user_id, target_coach_id, status)
       VALUES ($1, $2, $3, 'pending')
       ON CONFLICT (requester_user_id, target_user_id) WHERE status = 'pending'
         DO NOTHING
       RETURNING id`,
      [me, targetUserId, targetCoachId]
    );

    // Lost the race against a concurrent submit: report the existing one rather
    // than pretending a second request was created.
    if (inserted.rows.length === 0) {
      const existing = await chatPerm.findPendingRequest(me, targetUserId);
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
      db.query('SELECT name FROM users WHERE id = $1', [me]),
      db.query('SELECT name FROM users WHERE id = $1', [targetUserId]),
    ]);
    const meName = meRow.rows[0]?.name || 'A user';
    const targetName = targetRow.rows[0]?.name || 'another user';

    /* Everyone in the panel gets the same actionable notification: each of them can
     * approve or reject, so none of them is being told about someone else's
     * decision. related_id is the request id, which is what the queue, the bell
     * deep link and the settle pass all resolve against. */
    const io = req.app.get('io');
    await Promise.all(
      partyIds.map((userId) =>
        notif.push(
          io, userId,
          'New chat request',
          `${meName} wants to chat with ${targetName}. You can approve or reject this request.`,
          { type: NOTIF_TYPE, senderId: me, relatedId: requestId, requestStatus: STATUS.PENDING }
        )
      )
    );

    res.status(201).json({
      requestId, status: STATUS.PENDING,
      approverCount: partyIds.length,
      message: 'Request sent. Waiting for coach approval.',
    });
  } catch (err) {
    console.error('[chatRequest:create] error', err);
    res.status(500).json({ message: 'Failed to create chat request', error: err.message });
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

/* ── POST /api/chat-requests/:id/approve ──
 * Approving does three things, in this order:
 *   1. flips the request to approved
 *   2. materialises the conversation pair (so an approved pair with no messages
 *      yet still has somewhere to live)
 *   3. notifies BOTH users
 *
 * Step 2 uses the canonical ordering so the CHECK constraint holds and the
 * unique index collapses a re-approval onto the existing conversation instead
 * of creating a second, empty thread. */
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

/* ── POST /api/chat-requests/:id/reject ──
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

    await db.query(
      `INSERT INTO conversations (user1_id, user2_id, chat_request_id, status)
       VALUES ($1, $2, $3, 'locked')
       ON CONFLICT (user1_id, user2_id) DO UPDATE SET status = 'locked', updated_at = NOW()`,
      [pair[0], pair[1], row.id]
    );
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

/* ── POST /api/chat-requests/:id/cancel   body: { reason?: string } ──
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
    /* Both participants are told, so neither is left wondering why the other
     * went quiet. Each is told the OTHER user's name, which is the person whose
     * chat it is from their side. */
    const by = req.user.name || 'Someone';
    await Promise.all([
      notif.push(io, row.requester_user_id, 'Chat cancelled',
        `Your chat with ${row.target_name} was cancelled by ${by}.`, {
          type: NOTIF_TYPE, senderId: req.user.id, relatedId: Number(row.id), requestStatus: STATUS.CANCELLED,
        }),
      notif.push(io, row.target_user_id, 'Chat cancelled',
        `Your chat with ${row.requester_name} was cancelled by ${by}.`, {
          type: NOTIF_TYPE, senderId: req.user.id, relatedId: Number(row.id), requestStatus: STATUS.CANCELLED,
        }),
    ]);

    /* Real time. The two participants are NOT in a shared socket room - each is in
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

module.exports = {
  eligibility, create, mine, inbox, adminList, detail,
  approve, reject, cancel, shapeRequest,
};