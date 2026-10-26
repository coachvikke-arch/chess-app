const db = require('../config/database');
const { isAdminRole } = require('../middleware/roleMiddleware');

/* Coach-approval gate for 1:1 DMs.
 *
 * The rule this encodes was agreed as: the gate applies to STUDENT <-> STUDENT
 * peer messaging, while the staff <-> student supervision channel stays open.
 *
 * That split is not cosmetic. A coach has no coach of their own, so routing
 * "student messages their coach" through an approval workflow is not merely
 * pointless, it is unimplementable - there is no approver to name. And a coach
 * approving a request to message their own student is a self-approval loop.
 * Meanwhile the staff channel is the one that has to keep working: it is how
 * coaches contact students today, and it is a supervision relationship, not
 * peer contact.
 *
 * Everything else (two students) requires an APPROVED chat_request. Note the
 * asymmetry that falls out of this: a student may DM their coach or any coach
 * at any time, but may not DM a classmate until that classmate's coach has
 * approved it.
 */

/* Roles that are staff. Kept as a set rather than reusing isAdminRole at each
 * call site so the boundary is stated once. */
const STAFF_ROLES = new Set(['admin', 'superadmin']);

/* Statuses, mirroring the chat_requests CHECK constraint. Declared here too so
 * the service can build its own predicates without stringly-typed drift. */
const STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled',
};

/**
 * Canonical, direction-free identity for a pair of users.
 *
 * conversations.user1_id < user2_id is enforced by a CHECK constraint, and
 * chat_requests grants symmetric access, so every lookup normalises through
 * here. Returns null for a non-positive id so callers cannot accidentally build
 * a query against user 0.
 */
function pairKey(a, b) {
  const lo = Number(a);
  const hi = Number(b);
  if (!Number.isInteger(lo) || !Number.isInteger(hi)) return null;
  if (lo <= 0 || hi <= 0 || lo === hi) return null;
  return lo < hi ? [lo, hi] : [hi, lo];
}

/** True when either side of the pair is staff (a coach or the academy owner). */
function isStaffPair(meRole, otherRole) {
  return STAFF_ROLES.has(meRole) || STAFF_ROLES.has(otherRole);
}

/**
 * Resolve EVERY coach who should be asked to decide a request aimed at
 * `targetUserId`, primary coach first.
 *
 * A student can be handled by several coaches. `students.coach_id` is only the
 * PRIMARY one; `student_coaches` holds the rest. Both are consulted here so the
 * request reaches the same set of people who can already open the student in
 * coachScope() — a coach who is allowed to see the student must also be allowed
 * to action their request, or the requester has no predictable path to approval.
 *
 * The group coach is deliberately NOT included: coachScope() excludes it too, and
 * including it here would hand approval authority to someone who cannot open the
 * student in the first place.
 *
 * Falls back to the Super Admin when the student has no coach at all, so an
 * unassigned student's request is never dead-ended. Returns [] only when the
 * database has no superadmin either, which the caller treats as "nobody can
 * approve this".
 *
 * Order matters: index 0 is the primary/owning coach and is what
 * `chat_requests.target_coach_id` records, so the owner stays stable and
 * predictable even when several coaches are assigned.
 */
async function resolveTargetCoachIds(targetUserId) {
  const r = await db.query(
    `SELECT s.coach_id AS id, 0 AS ord
       FROM students s
      WHERE s.user_id = $1 AND s.coach_id IS NOT NULL
     UNION ALL
     SELECT sc.coach_id AS id, 1 AS ord
       FROM students s
       JOIN student_coaches sc ON sc.student_id = s.id
      WHERE s.user_id = $1`,
    [targetUserId]
  );

  /* UNION ALL can repeat a coach (primary + explicit row), so dedupe keeping the
   * lowest `ord` - that is what puts the primary coach first. */
  const best = new Map();
  for (const row of r.rows) {
    const id = Number(row.id);
    if (!Number.isFinite(id)) continue;
    const ord = Number(row.ord);
    if (!best.has(id) || ord < best.get(id)) best.set(id, ord);
  }
  const ids = [...best.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
  if (ids.length > 0) return ids;

  const fallback = await db.query(
    `SELECT id FROM users WHERE role = 'superadmin' ORDER BY id ASC LIMIT 1`
  );
  return fallback.rows.length > 0 ? [Number(fallback.rows[0].id)] : [];
}

/**
 * The single OWNING coach for a request, for the one-column
 * `chat_requests.target_coach_id`. Prefer resolveTargetCoachIds() when deciding
 * who to notify or who may act; this exists for callers that genuinely need one
 * deterministic owner.
 */
async function resolveTargetCoachId(targetUserId) {
  const ids = await resolveTargetCoachIds(targetUserId);
  return ids.length > 0 ? ids[0] : null;
}

/** Every Super Admin account, ordered by id. */
async function resolveSuperadminIds() {
  const r = await db.query(`SELECT id FROM users WHERE role = 'superadmin' ORDER BY id ASC`);
  return r.rows.map((row) => Number(row.id));
}

/**
 * The three admins who see a request and may act on it - Approve OR Reject:
 *
 *   1. the REQUESTER's primary coach (the admin who sent the student here)
 *   2. the TARGET's primary coach   (the admin who owns the other student)
 *   3. every Super Admin            (academy oversight)
 *
 * All three are symmetric: each sees who gave the request to whom, and each can
 * accept or reject it. Anyone accountable for either student can stop a request,
 * and the first action wins, so nobody can approve a pairing another admin
 * considers unacceptable.
 *
 * PRIMARY coaches only. A student's additional coaches (student_coaches) are not
 * in the panel - the two students each have one accountable admin, and a third
 * or fourth coach is not part of this decision.
 *
 * Duplicates are collapsed, because the same account can be both primary coaches
 * (shared students), and can also be the Super Admin. That person must receive
 * exactly one notification, and must not appear twice in the panel.
 *
 * @returns {Promise<number[]>} possibly empty only if nobody is accountable at all.
 */
async function resolveRequestParties(requesterUserId, targetUserId) {
  const [requesterCoachId, targetCoachId] = await Promise.all([
    resolvePrimaryCoachId(requesterUserId),
    resolvePrimaryCoachId(targetUserId),
  ]);
  const parties = [requesterCoachId, targetCoachId];
  return [...new Set(parties.filter((id) => id != null))];
}

/** The primary coach of a student, with no superadmin fallback. */
async function resolvePrimaryCoachId(userId) {
  const r = await db.query(
    `SELECT s.coach_id FROM students s
      WHERE s.user_id = $1 AND s.coach_id IS NOT NULL LIMIT 1`,
    [userId]
  );
  return r.rows.length > 0 ? Number(r.rows[0].coach_id) : null;
}

/** Names for a list of coach ids, primary order preserved, blanks dropped. */
async function coachNamesFor(coachIds) {
  const ids = (Array.isArray(coachIds) ? coachIds : [coachIds])
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0);
  if (ids.length === 0) return [];
  const r = await db.query(`SELECT id, name FROM users WHERE id = ANY($1::int[])`, [ids]);
  const byId = new Map(r.rows.map((u) => [Number(u.id), u.name]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

/**
 * Read the re-request configuration (single seeded row, id = 1).
 * Fails soft to the documented defaults so a missing row can never take the
 * whole messenger down.
 */
async function getSettings() {
  const r = await db.query(
    `SELECT allow_rerequest, rerequest_cooldown_days FROM chat_request_settings WHERE id = 1`
  );
  if (r.rows.length === 0) {
    return { allow_rerequest: true, rerequest_cooldown_days: 7 };
  }
  return {
    allow_rerequest: r.rows[0].allow_rerequest !== false,
    rerequest_cooldown_days: Number(r.rows[0].rerequest_cooldown_days ?? 7),
  };
}

/**
 * The most recent request between two users, in either direction.
 *
 * Ordering is by created_at then id: two requests created in the same
 * millisecond (a reject followed immediately by a re-request) still resolve
 * deterministically instead of depending on the planner's row order.
 */
async function latestRequest(meId, otherId) {
  const pair = pairKey(meId, otherId);
  if (!pair) return null;
  const [lo, hi] = pair;
  const r = await db.query(
    `SELECT cr.*,
            req.name AS requester_name,
            tgt.name AS target_name,
            coach.name AS coach_name
       FROM chat_requests cr
       JOIN users req ON req.id = cr.requester_user_id
       JOIN users tgt ON tgt.id = cr.target_user_id
       LEFT JOIN users coach ON coach.id = cr.target_coach_id
      WHERE (cr.requester_user_id = $1 AND cr.target_user_id = $2)
         OR (cr.requester_user_id = $2 AND cr.target_user_id = $1)
      ORDER BY cr.created_at DESC, cr.id DESC
      LIMIT 1`,
    [lo, hi]
  );
  return r.rows.length > 0 ? r.rows[0] : null;
}

/** Any approved request for the pair, in either direction. */
async function hasApprovedRequest(meId, otherId) {
  const pair = pairKey(meId, otherId);
  if (!pair) return false;
  const [lo, hi] = pair;
  const r = await db.query(
    `SELECT 1 FROM chat_requests
      WHERE status = 'approved'
        AND ((requester_user_id = $1 AND target_user_id = $2)
          OR (requester_user_id = $2 AND target_user_id = $1))
      LIMIT 1`,
    [lo, hi]
  );
  return r.rows.length > 0;
}

/**
 * The newest request for the pair, but only when that newest row is a
 * CANCELLATION.
 *
 * This is the write-path backstop. evaluateAccess already refuses a cancelled
 * pair, but the send endpoint states the invariant directly so that "a cancelled
 * chat cannot accept a message" does not depend on the caller having read the
 * state machine correctly. Returns null when the pair was never cancelled, or
 * when the cancellation has since been superseded - a newer approved request
 * makes the chat live again, and the newest row is the one that governs.
 */
async function cancelledChatRequest(meId, otherId) {
  const latest = await latestRequest(meId, otherId);
  return latest && latest.status === STATUS.CANCELLED ? latest : null;
}

/** The still-open pending request for the pair, in either direction. */
async function findPendingRequest(meId, otherId) {
  const pair = pairKey(meId, otherId);
  if (!pair) return null;
  const [lo, hi] = pair;
  const r = await db.query(
    `SELECT cr.*, req.name AS requester_name, tgt.name AS target_name
       FROM chat_requests cr
       JOIN users req ON req.id = cr.requester_user_id
       JOIN users tgt ON tgt.id = cr.target_user_id
      WHERE cr.status = 'pending'
        AND ((cr.requester_user_id = $1 AND cr.target_user_id = $2)
          OR (cr.requester_user_id = $2 AND cr.target_user_id = $1))
      ORDER BY cr.created_at DESC, cr.id DESC
      LIMIT 1`,
    [lo, hi]
  );
  return r.rows.length > 0 ? r.rows[0] : null;
}

/**
 * Decide whether `meId` may start or read a DM with `otherId`, and describe the
 * state well enough for the UI to render the right button without a second
 * round trip.
 *
 * Returns:
 *   {
 *     allowed,          // may send/read right now
 *     requiresApproval, // false means the gate does not apply to this pair
 *     state,            // self | unavailable | not_required | approved | pending
 *                      // | rejected | cancelled | none
 *     requestId,        // latest request id, for history links
 *     reason,           // machine-readable code
 *     message,          // human-readable, safe to show
 *     canRequest,       // may the caller submit a NEW request right now
 *     cooldownEndsAt,   // when a rejected pair may ask again
 *     coachName,        // primary coach, who owns the request
 *     coachNames,       // every coach who will see it (a student can have several)
 *   }
 *
 * This is the single authority for the decision. The UI renders `state`; the
 * messenger calls `assertCanMessage` before touching chat_messages. Neither is
 * allowed to re-derive the rule.
 */
async function evaluateAccess(meId, otherId, meRole) {
  const me = Number(meId);
  const other = Number(otherId);

  if (!Number.isInteger(other) || other <= 0) {
    return {
      allowed: false, requiresApproval: false, state: 'unavailable',
      reason: 'user_not_found', message: 'That user could not be found.',
      canRequest: false, requestId: null, cooldownEndsAt: null, coachName: null, coachNames: [],
    };
  }
  if (other === me) {
    return {
      allowed: false, requiresApproval: false, state: 'self',
      reason: 'self', message: 'You cannot start a chat with yourself.',
      canRequest: false, requestId: null, cooldownEndsAt: null, coachName: null, coachNames: [],
    };
  }

  const otherRes = await db.query('SELECT id, name, role FROM users WHERE id = $1', [other]);
  if (otherRes.rows.length === 0) {
    return {
      allowed: false, requiresApproval: false, state: 'unavailable',
      reason: 'user_not_found', message: 'That user could not be found.',
      canRequest: false, requestId: null, cooldownEndsAt: null, coachName: null, coachNames: [],
    };
  }
  const otherRole = otherRes.rows[0].role;
  const otherName = otherRes.rows[0].name;

  // The supervision channel. Staff may always DM a student and vice versa, so
  // no request is involved and none is offered.
  if (isStaffPair(meRole, otherRole)) {
    return {
      allowed: true, requiresApproval: false, state: 'not_required',
      reason: 'supervision_channel',
      message: `You can message ${otherName} directly.`,
      canRequest: false, requestId: null, cooldownEndsAt: null, coachName: null, coachNames: [],
    };
  }

  // Student <-> student: an approval is required, so everything below is
  // about whether one already exists.
  const latest = await latestRequest(me, other);
  const approved = latest ? latest.status === STATUS.APPROVED : await hasApprovedRequest(me, other);

  if (approved) {
    return {
      allowed: true, requiresApproval: true, state: 'approved',
      reason: 'approved', message: `You and ${otherName} can chat.`,
      canRequest: false, requestId: latest ? latest.id : null,
      cooldownEndsAt: null, coachName: latest ? latest.coach_name : null,
    };
  }

  /* The newest request decides, rather than "does any pending row exist".
   * Those differ once a pair has a history: a rejection that came AFTER a
   * pending row must govern, otherwise the pair reports "pending" forever and
   * the re-request rule is unreachable. Reading one row also saves a query. */
  if (latest && latest.status === STATUS.PENDING) {
    return {
      allowed: false, requiresApproval: true, state: 'pending',
      reason: 'pending', message: 'Chat request pending',
      canRequest: false, requestId: latest.id,
      cooldownEndsAt: null, coachName: latest.coach_name || null,
    };
  }

  /* A cancellation is a hard stop, and it is NOT a rejection: no cooldown
   * applies, because nobody refused the pairing on the merits. The pair may
   * therefore ask again immediately - as a BRAND NEW request that the panel
   * decides from scratch. The old approval is never revived, which is why this
   * branch sits above the generic fall-through and below the pending check: the
   * newest row is the only one that speaks. */
  if (latest && latest.status === STATUS.CANCELLED) {
    return {
      allowed: false, requiresApproval: true, state: STATUS.CANCELLED,
      reason: 'cancelled',
      message: `This chat was cancelled. You can request it again.`,
      canRequest: true, requestId: latest.id,
      cooldownEndsAt: null, coachName: latest.coach_name || null,
      coachNames: [],
    };
  }

  // No live approval. Work out whether a NEW request may be submitted, which
  // depends on the re-request rules and, after a rejection, the cooldown.
  const settings = await getSettings();
  let canRequest = true;
  let cooldownEndsAt = null;
  const lastWasRejected = Boolean(latest && latest.status === STATUS.REJECTED);

  if (lastWasRejected && !settings.allow_rerequest) {
    canRequest = false;
  } else if (lastWasRejected && settings.rerequest_cooldown_days > 0) {
    const rejectedAt = new Date(
      latest.rejected_at || latest.updated_at || latest.created_at
    ).getTime();
    const endsAt = rejectedAt + settings.rerequest_cooldown_days * 86400000;
    if (Date.now() < endsAt) {
      canRequest = false;
      cooldownEndsAt = new Date(endsAt).toISOString();
    }
  }

/* Both admins plus Super Admin will see this request and may accept OR reject it,
     * so the student is told the full panel rather than one name. */
    const partyIds = await resolveRequestParties(meId, otherId);
    const coachNames = await coachNamesFor(partyIds);
    /* `coachName` stays as the first name so older clients keep working;
       `coachNames` is the full panel the UI should show. */
    const coachName = coachNames.length > 0 ? coachNames[0] : null;

  return {
    allowed: false, requiresApproval: true,
    state: lastWasRejected ? 'rejected' : 'none',
    reason: lastWasRejected ? 'rejected' : 'approval_required',
    message: lastWasRejected
      ? 'Your chat request was not approved by the coach.'
      : "You need your coach's approval before you can start chatting with this user.",
    canRequest, requestId: latest ? latest.id : null, cooldownEndsAt, coachName, coachNames,
  };
}

/**
 * Server-side gate for the messenger itself. Throws a 403-shaped error so every
 * caller rejects the same way; the messenger turns this into a response.
 *
 * Deliberately not a boolean: the caller needs `state` to tell the user whether
 * to offer "Send Chat Request", "pending", or "not approved".
 */
async function assertCanMessage(meId, otherId, meRole) {
  const access = await evaluateAccess(meId, otherId, meRole);
  if (access.allowed) return access;
  const err = new Error(access.message);
  err.status = 403;
  err.code = access.reason;
  err.access = access;
  throw err;
}

module.exports = {
  STATUS,
  pairKey,
  isStaffPair,
  resolveTargetCoachId,
      resolveTargetCoachIds,
resolveRequestParties,
  resolveSuperadminIds,
  resolvePrimaryCoachId,
      coachNamesFor,
  getSettings,
  latestRequest,
  hasApprovedRequest,
  cancelledChatRequest,
  findPendingRequest,
  evaluateAccess,
  assertCanMessage,
};