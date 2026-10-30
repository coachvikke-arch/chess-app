/*
 * One-on-one messenger: student <-> coach and student <-> student.
 *
 * Conversations are derived on the fly from chat_messages (the same table the
 * live-classroom chat uses) by looking at who a private message's recipient
 * was. Each conversation here is a 1:1 pair:
 *
 *     conversation(otherUserId) = all chat_messages where
 *         (sender_id = me AND recipient_id = otherUser)
 *      OR (sender_id = otherUser AND recipient_id = me)
 *         AND is_private IS TRUE
 *
 * We deliberately derive rather than maintain a conversations table so there is
 * exactly ONE source of truth for MESSAGE HISTORY: chat_messages. Unread =
 * count of rows where I am the recipient and read_at IS NULL.
 *
 * ── Who is allowed to use that channel ──
 * Deriving history does NOT mean deriving permission. Chat access is governed by
 * chatPermissionService, and the directory a caller is shown is decided here by
 * allowedPeerIds() from the SAME roster: Super Admin reaches everyone, a coach
 * reaches their allocated students and the owner, and a student reaches their
 * classmates, their own coaches, and an owner who has written to them. A coach and
 * a learner need an accepted chat_admin_requests row on top of a live allocation.
 * A `conversations` row exists to hold an approved pair that has no messages yet,
 * so an approved contact still shows up in the inbox before anyone has written
 * anything - but it is a pairing record, not a source of truth for message content.
 *
 * Every read AND write path below calls chatPerm.assertCanMessage() first. That
 * is deliberate and load-bearing: the UI hides the Message button, but a hidden
 * button is not a security control, so the same check is repeated server-side
 * for getThread, sendDirectMessage and markRead. The frontend must never be the
 * only thing enforcing this rule.
 *
 * Presence (green dot):
 *   online  = currently connected socket for that user (io.fetchSockets()).
 *   grace   = 60s buffer after the last disconnect before the dot turns grey,
 *             so a tab-switch or a short network blip doesn't flicker offline.
 *   lastSeen = users.last_seen_at persisted whenever we see the user (connect/
 *              disconnect/heartbeat), used as the "last seen 5m ago" text.
 */

const db = require('../config/database');
const notif = require('../services/notificationService');
const chatPerm = require('../services/chatPermissionService');
const adminReq = require('../services/chatAdminRequestService');
const { isAdminRole } = require('../middleware/roleMiddleware');
const fs = require('fs');
const path = require('path');

const GRACE_MS = 60 * 1000;            /* presence buffer after last disconnect */
const DISCONNECT_TRACKER = new Map();  /* userId -> Date.now() of disconnect */
const DISCONNECT_TTL_MS = 24 * 60 * 60 * 1000;

function sweptDisconnecting(userId, only) {
  if (only !== 'set') {
    const at = Date.now();
    DISCONNECT_TRACKER.delete(userId);      /* per-user single entry */
    DISCONNECT_TRACKER.set(userId, at);
  }
}

function sweepDisconnects() {
  const now = Date.now();
  for (const [uid, at] of DISCONNECT_TRACKER) {
    if (now - at > DISCONNECT_TTL_MS) DISCONNECT_TRACKER.delete(uid);
  }
}

function trackDisconnect(uid) {
  const at = Date.now();
  DISCONNECT_TRACKER.set(uid, at);          /* keep, don't delete (disconnect) */
}

/** All userIds that should be considered online right now: whichever sockets
 *  are connected PLUS freshly-disconnected users still inside the grace window. */
async function fetchOnlineUserIds(io) {
  const onlineIds = new Set();
  try {
    const sockets = await io.fetchSockets();
    let onlineCount = 0;
    for (const sock of sockets) {
      if (sock.user && sock.user.id != null) {
        onlineIds.add(Number(sock.user.id));
        onlineCount++;
      }
    }
  } catch (e) {
    console.warn('[chat presence] could not fetch sockets', e.message);
  }
  sweepDisconnects();
  const now = Date.now();
  for (const [uid, at] of DISCONNECT_TRACKER) {
    if (now - at <= GRACE_MS) onlineIds.add(uid);
  }
  return onlineIds;
}

/** Persist "now seen" so the offline sidebar can show "last seen 5m ago". */
async function markSeen(userId) {
  try {
    await db.query('UPDATE users SET last_seen_at = NOW() WHERE id = $1', [userId]);
  } catch (e) {
    /* non-fatal */
  }
}

async function markThreadSeen(me, otherId) {
  /* When I open a thread I have *sent* to someone, also note that I'm present. */
  await markSeen(me);
}

/* ------------------------------------------------------------------ */
/* Message deletion ("for me" tombstones)                               */
/* ------------------------------------------------------------------ */
/* "Delete for everyone" physically removes the row, so there is nothing to
 * filter. "Delete for me" leaves the row alone and records a tombstone in
 * chat_message_deletions; this returns the ids hidden from ME so thread loads
 * can drop them. */
async function hiddenMessageIds(scope, me, messageIds) {
  const ids = (messageIds || []).map(Number).filter(Boolean);
  if (ids.length === 0) return new Set();
  const r = await db.query(
    `SELECT message_id FROM chat_message_deletions
      WHERE scope = $1 AND user_id = $2 AND message_id = ANY($3::int[])`,
    [scope, me, ids]
  );
  return new Set(r.rows.map((x) => Number(x.message_id)));
}

/* ------------------------------------------------------------------ */
/* Emoji reactions                                                     */
/* ------------------------------------------------------------------ */
/* One table backs both 1:1 DMs and group rooms; `scope` says which
 * `message_id` namespace to use ('dm' -> chat_messages, 'group' ->
 * chat_group_messages). Each row is one (message, user, emoji) triple;
 * the UNIQUE constraint makes reactions toggleable. */

/* Load every reaction for a batch of message ids, shaped for the client:
 *   [{ emoji, users: [userId, ...], count }]  (most-used emoji first). */
async function loadReactions(scope, messageIds) {
  const ids = (messageIds || []).map(Number).filter(Boolean);
  if (ids.length === 0) return {};
  const r = await db.query(
    `SELECT message_id, emoji, user_id FROM chat_reactions
      WHERE scope = $1 AND message_id = ANY($2::int[])`,
    [scope, ids]
  );
  const byMessage = {};
  for (const row of r.rows) {
    const mid = Number(row.message_id);
    (byMessage[mid] = byMessage[mid] || []).push({ emoji: row.emoji, user_id: Number(row.user_id) });
  }
  const shaped = {};
  for (const [mid, list] of Object.entries(byMessage)) {
    const byEmoji = new Map();
    for (const it of list) {
      if (!byEmoji.has(it.emoji)) byEmoji.set(it.emoji, []);
      byEmoji.get(it.emoji).push(it.user_id);
    }
    shaped[mid] = [...byEmoji.entries()]
      .map(([emoji, users]) => ({ emoji, users, count: users.length }))
      .sort((a, b) => b.count - a.count);
  }
  return shaped;
}

/* Stamp a `reactions` array onto each message row (id field is `id` in both
 * the DM and group selects), so the client gets them inline on load. */
function attachReactions(rows, reactionsById) {
  for (const m of rows) m.reactions = reactionsById[Number(m.id)] || [];
  return rows;
}

/* ------------------------------------------------------------------ */
/* REST                                                                */
/* ------------------------------------------------------------------ */

/* ── Coach-approval gate ──
 * Single helper every DM read/write path uses. Returns true when the caller may
 * proceed; otherwise it has already written the 403 and the caller must return
 * immediately.
 *
 * The 403 body carries `state` so the client can tell "you need to ask" apart
 * from "you already asked" and "you were refused" and render the right button,
 * instead of a generic error the user cannot act on. */
async function chatGate(req, res, otherId) {
  try {
    await chatPerm.assertCanMessage(req.user.id, otherId, req.user.role);
    return true;
  } catch (err) {
    if (err.status === 403) {
      // multer already wrote the upload to disk before this handler ran, so a
      // blocked send would otherwise leave an orphaned file nobody references.
      // Same cleanup the error path does.
      if (req.file) { try { fs.unlinkSync(req.file.path); } catch {} }
      res.status(403).json({
        message: err.message,
        code: err.code,
        state: err.access ? err.access.state : null,
        canRequest: err.access ? err.access.canRequest : false,
        cooldownEndsAt: err.access ? err.access.cooldownEndsAt : null,
        requestId: err.access ? err.access.requestId : null,
      });
      return false;
    }
    throw err;
  }
}

/* GET /api/chat/users?q=   - the people this caller is allowed to talk to,
 * with live online state + lastSeen. `q` filters by name or email (case-
 * insensitive substring) so the "find a coach or a student" search works.
 *
 * The search runs INSIDE the permitted set, not across all of users: a student
 * typing a coach's name must learn that coach is not theirs by getting no row,
 * the same way the row was never listed, rather than by finding it through the
 * search box and then being refused. */
exports.listContacts = async (req, res) => {
  try {
    const me = req.user.id;
    const q = String(req.query.q || '').trim();
    const io = req.app.get('io');

    const onlineIds = io ? await fetchOnlineUserIds(io) : new Set();

    /* One roster, three consumers. The People list, the inbox and the send gate
     * all start from allowedPeerIds(), so what a user is shown can never be
     * wider than what the API will let them do. */
    const directoryIds = [...(await allowedPeerIds(me, req.user.role))];

    let rows = [];
    if (directoryIds.length > 0) {
      const params = [directoryIds];
      let where = 'id = ANY($1::int[])';
      if (q) {
        params.push(q);
        where += ` AND (name ILIKE '%' || $2 || '%' OR email ILIKE '%' || $2 || '%')`;
      }
      const r = await db.query(
        `SELECT id, name, email, role, last_seen_at, profile_image, avatar_config
           FROM users
          WHERE ${where}
          ORDER BY name ASC
          LIMIT 200`,
        params
      );
      rows = r.rows;
    }

    const seen = await db.query('SELECT last_seen_at FROM users WHERE id = $1', [me]);
    await markSeen(me);

    /* Annotate every row with its permission state so the People list can render
     * Message / Request chat / Request pending / Accept+Cancel without each row
     * firing its own eligibility request.
     *
     * One query per KIND of row for the whole page rather than one per row: with
     * two hundred contacts the naive version is two hundred round trips every time
     * the tab is opened. */
    const contacts = rows.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      online: onlineIds.has(Number(u.id)),
      lastSeen: u.last_seen_at,
      profile_image: u.profile_image,
      avatar_config: u.avatar_config,
    }));

    /* A Super Admin row needs no state read at all - that channel is open by
     * rule, and a student only ever gets such a row listed when the owner has
     * already written first, which is the roster's decision, not this one. */
    const isStudentCaller = req.user.role === 'student';
    const callerIsSuperadmin = req.user.role === 'superadmin';
    for (const u of contacts) {
      if (callerIsSuperadmin || u.role === 'superadmin') {
        u.chatState = 'not_required';
        u.canMessage = true;
      }
    }

    /* Coach <-> learner rows: the allocated-admin request table decides. */
    const adminChannelRows = contacts.filter((u) => u.chatState === undefined &&
      ((isStudentCaller && u.role === 'admin') || (!isStudentCaller && u.role === 'student')));
    const adminChannelSet = new Set(adminChannelRows);

    if (adminChannelRows.length > 0) {
      const latest = await adminReq.latestRequestsForPeers(
        me, adminChannelRows.map((u) => Number(u.id)), isStudentCaller
      );
      for (const u of adminChannelRows) {
        const found = latest.get(Number(u.id)) || null;
        const state = adminReq.stateFromRow(found ? { id: found.requestId, status: found.status } : null);
        u.chatState = state.state;
        u.canMessage = state.allowed;
        u.adminRequestId = found ? found.requestId : null;
        /* A pending row is a decision, and only the coach it was sent to owns it.
         * The UI renders Accept and Cancel from this flag instead of inferring it
         * from "I am a coach and this student is in my list". */
        u.canDecideAdminRequest = !isStudentCaller && Boolean(found) &&
          found.status === adminReq.ADMIN_REQUEST_STATUS.PENDING;
      }
    }

    /* Student <-> student rows: the peer chat_requests queue, unchanged. */
    const peerIds = contacts
      .filter((u) => u.chatState === undefined && !adminChannelSet.has(u))
      .map((u) => Number(u.id));
    if (peerIds.length > 0) {
      // Compare on the CANONICAL pair (LEAST/GREATEST) so one row-value IN
      // clause covers both request directions. Matching on
      // (requester,target) IN (...) OR (target,requester) IN (...) would also
      // work but repeats the value list and relies on AND binding tighter than
      // OR to stay correct.
      const values = [];
      const tuples = peerIds.map((pid) => {
        const [lo, hi] = chatPerm.pairKey(me, pid);
        values.push(lo, hi);
        /* The ::int casts are REQUIRED, not decoration. An untyped
           `(VALUES ($1, $2), ...)` list is resolved as text[], so the row
           comparison raises `operator does not exist: integer = text`
           (SQLSTATE 42883). Casting the placeholders types the VALUES rows as
           int and the comparison resolves. */
        return `($${values.length - 1}::int, $${values.length}::int)`;
      });
      const pairMatch =
        `(LEAST(requester_user_id, target_user_id), GREATEST(requester_user_id, target_user_id))
         IN (VALUES ${tuples.join(', ')})`;

      const approvedRows = await db.query(
        `SELECT LEAST(requester_user_id, target_user_id) AS lo,
                GREATEST(requester_user_id, target_user_id) AS hi
           FROM chat_requests
          WHERE status = 'approved' AND ${pairMatch}`,
        values
      );
      const pendingRows = await db.query(
        `SELECT LEAST(requester_user_id, target_user_id) AS lo,
                GREATEST(requester_user_id, target_user_id) AS hi
           FROM chat_requests
          WHERE status = 'pending' AND ${pairMatch}`,
        values
      );

      const approvedSet = new Set(approvedRows.rows.map((row) => `${row.lo}:${row.hi}`));
      const pendingSet = new Set(pendingRows.rows.map((row) => `${row.lo}:${row.hi}`));
      /* A rejected pair must read as rejected, not as "never asked": without
         this the row looks identical to a first-time contact and the detail
         panel offers a plain Send button with no trace of the refusal. Live
         states win — an approved or pending pair is never also rejected. */
      const rejectedRows = await db.query(
        `SELECT LEAST(requester_user_id, target_user_id) AS lo,
                GREATEST(requester_user_id, target_user_id) AS hi
           FROM chat_requests
          WHERE status = 'rejected' AND ${pairMatch}`,
        values
      );
      const rejectedSet = new Set(rejectedRows.rows.map((row) => `${row.lo}:${row.hi}`));

      /* A cancelled pair is NOT "never asked" and NOT "rejected": the chat
       * existed and then someone stopped it. It has to read as its own state so
         * the People row explains the truth ("This chat was cancelled") and still
         * offers a fresh request, instead of looking like a first-time contact. */
      const cancelledRows = await db.query(
        `SELECT LEAST(requester_user_id, target_user_id) AS lo,
                GREATEST(requester_user_id, target_user_id) AS hi
           FROM chat_requests
          WHERE status = 'cancelled' AND ${pairMatch}`,
        values
      );
      const cancelledSet = new Set(cancelledRows.rows.map((row) => `${row.lo}:${row.hi}`));

      for (const u of contacts) {
        /* Only the peer rows are still undecided here: a Super Admin row or a
         * coach/learner row already carries its state, and writing 'none' over it
         * would make an open channel look blocked in the People list. */
        if (u.chatState !== undefined || adminChannelSet.has(u)) continue;
        const key = chatPerm.pairKey(me, u.id).join(':');
        if (approvedSet.has(key)) {
          u.chatState = 'approved';
          u.canMessage = true;
        } else if (pendingSet.has(key)) {
          u.chatState = 'pending';
          u.canMessage = false;
        } else if (rejectedSet.has(key)) {
          u.chatState = 'rejected';
          u.canMessage = false;
        } else if (cancelledSet.has(key)) {
          u.chatState = 'cancelled';
          u.canMessage = false;
        } else {
          u.chatState = 'none';
          u.canMessage = false;
        }
      }
    }

    res.json({
      users: contacts,
      me: { id: me, lastSeen: seen.rows[0]?.last_seen_at || null },
    });
  } catch (err) {
    console.error('[chat:listContacts] error', err);
    res.status(500).json({ message: 'Failed to load contacts', error: err.message });
  }
};

/* Every peer `me` may see and message, as a Set of user ids.
 *
 * This is THE directory rule, and both the People list and the inbox read it.
 * That is deliberate: a list built from one rule and a thread gate built from
 * another eventually disagree, and the disagreement is always the user being able
 * to reach something they were shown as off-limits (or the reverse). Hiding a
 * contact is presentation; deriving the visible list, the inbox and the 403 from
 * one query is the actual control.
 *
 * Three rosters:
 *   Super Admin  every account. Oversight has to be able to reach anyone.
 *   Admin        the students allocated to them, plus every Super Admin. Not
 *                fellow coaches - the People list was scoped to "my students and
 *                the owner", and a list that hides a pair the gate allows is a
 *                hole waiting to be found.
 *   Student      every classmate (the peer-request flow has to be able to FIND
 *                someone before it can ask for them), their own coaches, and a
 *                Super Admin only once that owner has written to them first.
 *
 * Allocation is the live roster - students.coach_id for the primary coach and
 * student_coaches for the rest. There is no second allocation table, so moving a
 * student to another coach hides the old coach here on the next read, and the
 * accepted request that pair once held stops counting: an approval opens a pair
 * inside the roster, it does not widen the roster.
 */
async function allowedPeerIds(me, role) {
  if (role === 'superadmin') {
    const all = await db.query('SELECT id FROM users WHERE id <> $1', [me]);
    return new Set(all.rows.map((row) => Number(row.id)));
  }

  if (isAdminRole(role)) {
    const r = await db.query(
      `SELECT id FROM users WHERE id <> $1 AND role = 'superadmin'
       UNION
       SELECT s.user_id AS id
         FROM students s
        WHERE s.coach_id = $1 AND s.user_id IS NOT NULL AND COALESCE(s.active, TRUE)
       UNION
       SELECT s.user_id AS id
         FROM students s
         JOIN student_coaches sc ON sc.student_id = s.id
        WHERE sc.coach_id = $1 AND s.user_id IS NOT NULL AND COALESCE(s.active, TRUE)`,
      [me]
    );
    return new Set(r.rows.map((row) => Number(row.id)));
  }

  const r = await db.query(
    `SELECT u.id AS id FROM users u
      WHERE u.id <> $1 AND u.role = 'student'
     UNION
     SELECT s.coach_id AS id
       FROM students s
      WHERE s.user_id = $1 AND s.coach_id IS NOT NULL
     UNION
     SELECT sc.coach_id AS id
       FROM students s
       JOIN student_coaches sc ON sc.student_id = s.id
      WHERE s.user_id = $1 AND sc.coach_id IS NOT NULL
     UNION
     /* Reachable back only because the owner wrote first - this is the whole of
        "a Super Admin appears once they have messaged the student". */
     SELECT m.sender_id AS id
       FROM chat_messages m
       JOIN users sa ON sa.id = m.sender_id AND sa.role = 'superadmin'
      WHERE m.is_private IS TRUE AND m.recipient_id = $1
     UNION
     SELECT CASE WHEN c.user1_id = $1 THEN c.user2_id ELSE c.user1_id END AS id
       FROM conversations c
       JOIN users sa
         ON sa.id = CASE WHEN c.user1_id = $1 THEN c.user2_id ELSE c.user1_id END
        AND sa.role = 'superadmin'
      WHERE c.status = 'active'
        AND (c.user1_id = $1 OR c.user2_id = $1)`,
    [me]
  );
  return new Set(r.rows.map((row) => Number(row.id)));
}

/* True when exactly one side is a learner and the other is a plain coach.
 *
 * Names the rows that the allocated-admin request flow governs, so the People
 * list and the inbox ask about the same set of pairs and neither guesses from a
 * role string. A Super Admin on either side is never such a pair: that channel is
 * open by rule and needs no request. */
function isAdminChannelPair(callerRole, peerRole) {
  if (callerRole === 'superadmin' || peerRole === 'superadmin') return false;
  return (callerRole === 'student') !== (peerRole === 'student');
}

/* GET /api/chat/conversations   - my 1:1 DM list: one entry per person I have
 * exchanged private messages with, sorted by most recent, each carrying the
 * other user (with online + lastSeen), the last message, its timestamp and my
 * unread count for that person. */
exports.listConversations = async (req, res) => {
  try {
    const me = req.user.id;
    const io = req.app.get('io');
    const onlineIds = io ? await fetchOnlineUserIds(io) : new Set();
    const allowed = await allowedPeerIds(me, req.user.role);

    const r = await db.query(
      `SELECT
         other.id            AS other_id,
         other.name          AS other_name,
         other.role          AS other_role,
         other.last_seen_at  AS other_last_seen,
         msgs.id             AS last_message_id,
         msgs.message        AS last_message,
         msgs.attachment     AS last_attachment,
         msgs.attachment_name AS last_attachment_name,
         msgs.created_at     AS last_message_at,
         msgs.is_private     AS last_is_private,
         COALESCE(unread.n, 0)::int AS unread_count
       FROM (
         SELECT DISTINCT ON (conv_other)
                $1 AS me,
                conv_other,
                id, message, attachment, attachment_name, created_at, is_private
         FROM (
           SELECT
             id, message, attachment, attachment_name, created_at, is_private,
             CASE WHEN sender_id = $1 THEN recipient_id ELSE sender_id END AS conv_other
           FROM chat_messages
           WHERE is_private IS TRUE
             AND (sender_id = $1 OR recipient_id = $1)
           ORDER BY created_at DESC
         ) x
         ORDER BY conv_other, created_at DESC
       ) msgs
       JOIN users other ON other.id = msgs.conv_other
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS n
         FROM chat_messages un
         WHERE un.recipient_id = $1 AND un.sender_id = other.id
           AND un.is_private IS TRUE AND un.read_at IS NULL
       ) unread ON TRUE
       ORDER BY msgs.created_at DESC
       LIMIT 100`,
      [me]
    );

    await markSeen(me);

    /* Approved pairs with no messages yet, so a new approval is visible in the
     * inbox straight away rather than only after the first message. Sorted to
     * the bottom by the final sort below, using the conversation row's own
     * created_at as the timestamp. */
    const empty = await db.query(
      `SELECT c.user1_id, c.user2_id, c.created_at,
              u.id AS other_id, u.name AS other_name, u.role AS other_role,
              u.last_seen_at AS other_last_seen
         FROM conversations c
         JOIN users u ON u.id = CASE WHEN c.user1_id = $1 THEN c.user2_id ELSE c.user1_id END
        WHERE (c.user1_id = $1 OR c.user2_id = $1)
          AND c.status = 'active'
          AND NOT EXISTS (
            SELECT 1 FROM chat_messages m
             WHERE m.is_private IS TRUE
               AND ((m.sender_id = $1 AND m.recipient_id = u.id)
                 OR (m.sender_id = u.id AND m.recipient_id = $1))
          )`,
      [me]
    );

    /* Two questions have to be answered YES before a thread is listed, and the
     * messages being on disk answers neither of them:
     *   allowed - is this person in my directory at all? (roster rule, above)
     *   open    - may this pair still write? A coach/learner pair needs an
     *             ACCEPTED request, so a thread that exists only because it came
     *             in through a side door - a live-class private note, history from
     *             before the gate, a re-allocation - is not a channel around it.
     * The second is one batched read for the whole page, exactly like the People
     * list, and the two surfaces share isAdminChannelPair so they cannot disagree
     * about which rows the question even applies to. */
    const directory = r.rows.filter((row) => allowed.has(Number(row.other_id)));
    const pairings = empty.rows.filter((row) => allowed.has(Number(row.other_id)));

    const adminPeers = [...new Set(
      [...directory, ...pairings]
        .filter((row) => isAdminChannelPair(req.user.role, row.other_role))
        .map((row) => Number(row.other_id))
    )];
    const liveAdmin = await adminReq.latestRequestsForPeers(
      me, adminPeers, req.user.role === 'student'
    );
    const mayList = (row) => {
      if (!isAdminChannelPair(req.user.role, row.other_role)) return true;
      const found = liveAdmin.get(Number(row.other_id));
      return Boolean(found) && found.status === adminReq.ADMIN_REQUEST_STATUS.ACCEPTED;
    };

    const rows = directory
      .filter(mayList)
      .map((row) => ({
        otherId: Number(row.other_id),
        otherName: row.other_name,
        otherRole: row.other_role,
        otherOnline: onlineIds.has(Number(row.other_id)),
        otherLastSeen: row.other_last_seen,
        lastMessage: row.last_message,
        lastAttachment: row.last_attachment,
        lastAttachmentName: row.last_attachment_name,
        lastMessageAt: row.last_message_at,
        lastIsPrivate: row.last_is_private,
        unread: row.unread_count,
      }));

    for (const row of pairings) {
      if (!mayList(row)) continue;
      rows.push({
        otherId: Number(row.other_id),
        otherName: row.other_name,
        otherRole: row.other_role,
        otherOnline: onlineIds.has(Number(row.other_id)),
        otherLastSeen: row.other_last_seen,
        lastMessage: null,
        lastAttachment: null,
        lastAttachmentName: null,
        lastMessageAt: row.created_at,
        lastIsPrivate: true,
        unread: 0,
        awaitingFirstMessage: true,
      });
    }

    /* newest first; an empty thread falls to the bottom because its created_at
     * is the approval time, not a message time */
    rows.sort((a, b) => {
      const at = a.awaitingFirstMessage ? 0 : 1;
      const bt = b.awaitingFirstMessage ? 0 : 1;
      if (at !== bt) return bt - at;
      return new Date(b.lastMessageAt || 0) - new Date(a.lastMessageAt || 0);
    });

    res.json({ conversations: rows.slice(0, 100) });
  } catch (err) {
    console.error('[chat:listConversations] error', err);
    res.status(500).json({ message: 'Failed to load conversations', error: err.message });
  }
};

/* GET /api/chat/conversations/:otherId/messages   - full thread with a specific
 * user (newest-first pagination via `before`); marks everything in the thread
 * as read once loaded. */
exports.getThread = async (req, res) => {
  try {
    const me = req.user.id;
    const otherId = Number(req.params.otherId);
    const before = req.query.before ? Number(req.query.before) : null;

    if (!otherId) return res.status(400).json({ message: 'otherId required' });

    // Gate BEFORE the query, not after: reading a thread is exactly as
    // privileged as writing to it, so a blocked pair must not be able to page
    // through history by calling this endpoint directly.
    if (!(await chatGate(req, res, otherId))) return;

    const params = [me, otherId];
    let where = `(m.sender_id = $1 AND m.recipient_id = $2)
                  OR (m.sender_id = $2 AND m.recipient_id = $1)`;
    let limitIdx = 3;
    if (before) {
      params.push(before);
      where += ' AND m.id < $' + limitIdx;
      limitIdx++;
    }
    params.push(50);
    const r = await db.query(
      `SELECT m.id, m.sender_id, m.recipient_id, m.message, m.is_private, m.created_at,
              m.attachment, m.attachment_name, m.attachment_type, m.attachment_size,
              u.name AS sender_name, u.role AS sender_role
         FROM chat_messages m
         JOIN users u ON u.id = m.sender_id
        WHERE ${where}
        ORDER BY m.created_at DESC
        LIMIT $${limitIdx}`,
      params
    );

    /* Mark everything in this thread as read (harmless both directions). */
    if (r.rows.length > 0) {
      await db.query(
        `UPDATE chat_messages SET read_at = NOW()
          WHERE recipient_id = $1 AND sender_id = $2 AND read_at IS NULL`,
        [me, otherId]
      );
    }
    await markSeen(me);

    /* Drop anything I chose to hide for myself ("delete for me"). */
    const hidden = await hiddenMessageIds('dm', me, r.rows.map((m) => m.id));
    const visible = hidden.size === 0 ? r.rows : r.rows.filter((m) => !hidden.has(Number(m.id)));

    const reactions = await loadReactions('dm', visible.map((m) => m.id));
    res.json({ messages: attachReactions(visible, reactions) });
  } catch (err) {
    console.error('[chat:getThread] error', err);
    res.status(500).json({ message: 'Failed to load thread', error: err.message });
  }
};

/* POST /api/chat/conversations/:otherId/messages
 * multipart: text (optional) + file (optional, multer) — at least one required. */
/* ── message notifications ──
   A sent message currently only reaches the recipient's OPEN chat tab, over the
   socket. If they are anywhere else, nothing tells them a message arrived —
   which is exactly what the bell is for. This adds a bell entry so an idle
   user still finds out, and keeps `related_id` pointing at the conversation so
   clicking the entry can open the right thread.

   Deliberately ONE unread entry per conversation, not one per message: a busy
   group would otherwise bury every other kind of notification under dozens of
   chat rows. Dedupe is on (type, related_id, still-unread), so a second
   message in a thread the user has not opened yet reuses that pending entry
   instead of stacking. */
const MSG_PREVIEW_MAX = 120;

/** Short single-line preview of a message, with an attachment marker. */
function messagePreview(text, hasFile) {
  const t = String(text || '').trim();
  const body = t.length > MSG_PREVIEW_MAX ? `${t.slice(0, MSG_PREVIEW_MAX - 1)}…` : t;
  if (body && hasFile) return `${body} 📎`;
  if (body) return body;
  return hasFile ? '📎 Attachment' : '';
}

async function notifyMessage(io, { recipients, senderId, senderName, conversationId, group, text, hasFile }) {
  if (!recipients || recipients.length === 0) return;
  // DMs and groups share the `related_id` space (a user id can equal a group
  // id), so they get distinct types and can never dedupe against each other.
  const type = group ? 'group_message' : 'message';
  const preview = messagePreview(text, hasFile);
  if (!preview) return;
  for (const uid of new Set(recipients.map(Number))) {
    if (!uid || Number(uid) === Number(senderId)) continue;
    try {
      const dupe = await db.query(
        `SELECT 1 FROM notifications
          WHERE user_id = $1 AND type = $2 AND related_id = $3 AND is_read = FALSE
          LIMIT 1`,
        [uid, type, conversationId]
      );
      if (dupe.rows.length > 0) continue;
      await notif.push(io, uid, senderName, preview, { type, senderId, relatedId: conversationId });
    } catch (e) {
      console.warn('[chat message notification]', e.message);
    }
  }
}

exports.sendDirectMessage = async (req, res) => {
  try {
    const me = req.user.id;
    const otherId = Number(req.params.otherId);
    const text = String(req.body.text || '').trim();
    const file = req.file || null;

    if (!otherId) return res.status(400).json({ message: 'otherId required' });
    if (!text && !file) return res.status(400).json({ message: 'text or file required' });
    if (text.length > 4000) return res.status(400).json({ message: 'Message too long' });

    const recp = await db.query('SELECT id FROM users WHERE id = $1', [otherId]);
    if (recp.rows.length === 0) return res.status(404).json({ message: 'User not found' });

    // The authoritative check. Everything above is validation; this is the gate.
    // Placed after the recipient exists so a bad id reports 404 rather than a
    // confusing 403, and before the INSERT so no row can be written.
    if (!(await chatGate(req, res, otherId))) return;

    /* Second, explicit statement of the same invariant. assertCanMessage already
     * reads the newest request and refuses a cancelled pair, but the spec asks for
     * the write path itself to require an APPROVED chat - and it has to, because a
     * client can be arbitrarily out of date: an open tab, a queued send, a replayed
     * retry. Stating it here means a cancelled chat cannot accept a message even
     * if some earlier gate is ever relaxed. */
    const cancelled = await chatPerm.cancelledChatRequest(me, otherId);
    if (cancelled) {
      if (req.file) { try { fs.unlinkSync(req.file.path); } catch {} }
      return res.status(403).json({
        message: 'This chat was cancelled. You can no longer send messages.',
        code: 'chat_cancelled',
        state: chatPerm.STATUS.CANCELLED,
        requestId: Number(cancelled.id),
        canRequest: true,
      });
    }

    const inserted = await db.query(
      `INSERT INTO chat_messages (sender_id, recipient_id, message, is_private, attachment, attachment_name, attachment_type, attachment_size, created_at)
       VALUES ($1, $2, $3, TRUE, $4, $5, $6, $7, NOW())
       RETURNING id, sender_id, recipient_id, message, is_private, attachment,
                 attachment_name, attachment_type, attachment_size, created_at`,
      [
        me, otherId, text,
        file ? ATTACHMENT_PATH(file.filename) : null,
        file ? file.originalname : null,
        file ? file.mimetype : null,
        file ? file.size : null,
      ]
    );
    const row = inserted.rows[0];

    const io = req.app.get('io');
    const sender = await db.query('SELECT name, role FROM users WHERE id = $1', [me]);
    const senderName = sender.rows[0]?.name || 'Someone';
    if (io) {
      try {
        io.to(`user:${otherId}`).emit('chat_dm', {
          message: { ...row, sender_name: senderName, sender_role: sender.rows[0]?.role },
        });
      } catch (e) {
        console.warn('[chat dm broadcast]', e.message);
      }
    }

    // Also raise it in the recipient's bell so they find out even when they are
    // not looking at Messages. `relatedId` is the sender's user id, which is the
    // conversation the entry should open.
    await notifyMessage(io, {
      recipients: [otherId],
      senderId: me,
      senderName,
      conversationId: otherId,
      group: false,
      text,
      hasFile: !!file,
    });

    await markSeen(me);
    res.status(201).json({ message: row });
  } catch (err) {
    if (req.file) { try { require('fs').unlinkSync(req.file.path); } catch {} }
    console.error('[chat:sendDirectMessage] error', err);
    res.status(500).json({ message: 'Failed to send message', error: err.message });
  }
};

/* POST /api/chat/conversations/:otherId/read   - clears my unread badge for
 * that person (called when the thread is opened). */
exports.markRead = async (req, res) => {
  try {
    const me = req.user.id;
    const otherId = Number(req.params.otherId);

    if (!(await chatGate(req, res, otherId))) return;

    await db.query(
      `UPDATE chat_messages SET read_at = NOW()
        WHERE recipient_id = $1 AND sender_id = $2 AND read_at IS NULL`,
      [me, otherId]
    );

    const io = req.app.get('io');
    if (io) io.to(`user:${me}`).emit('chat_unread_changed', { otherId, unread: 0 });

    await markSeen(me);
    res.json({ ok: true });
  } catch (err) {
    console.error('[chat:markRead] error', err);
    res.status(500).json({ message: 'Failed to mark read', error: err.message });
  }
};

/* POST /api/chat/reactions   body: { scope: 'dm'|'group', messageId, emoji }
 * Toggles my reaction for that emoji on that message (react twice to remove).
 * Returns the message's full, freshly-shaped reaction list and pushes the same
 * payload to everyone who can see the message, so both sides stay in sync. */
exports.toggleReaction = async (req, res) => {
  try {
    const me = Number(req.user.id);
    const scope = req.body?.scope === 'group' ? 'group' : 'dm';
    const messageId = Number(req.body?.messageId);
    const emoji = String(req.body?.emoji || '').trim();

    if (!messageId) return res.status(400).json({ message: 'messageId required' });
    if (!emoji || emoji.length > 16) return res.status(400).json({ message: 'emoji required' });

    /* Resolve the message + who may see it. `authorId` is whose message it is
     * (the only person who should be told about a reaction on it). */
    let notifyIds = [];
    let authorId = null;
    let groupId = null;
    if (scope === 'group') {
      const g = await db.query('SELECT group_id, sender_id FROM chat_group_messages WHERE id = $1', [messageId]);
      if (g.rows.length === 0) return res.status(404).json({ message: 'Message not found' });
      const gid = Number(g.rows[0].group_id);
      if (!(await isGroupMember(gid, me))) return res.status(403).json({ message: 'Not a member' });
      notifyIds = await groupMemberIds(gid);
      authorId = Number(g.rows[0].sender_id);
      groupId = gid;
    } else {
      const m = await db.query(
        'SELECT sender_id, recipient_id FROM chat_messages WHERE id = $1',
        [messageId]
      );
      if (m.rows.length === 0) return res.status(404).json({ message: 'Message not found' });
      const { sender_id, recipient_id } = m.rows[0];
if (Number(sender_id) !== me && Number(recipient_id) !== me) {
          return res.status(403).json({ message: 'Not your message' });
        }
        // Participation is not permission. A pair that was never approved, or
        // whose approval was withdrawn, must not be able to keep interacting
        // with pre-existing rows just because they were once allowed to.
        const counterpart = Number(sender_id) === me ? Number(recipient_id) : Number(sender_id);
        if (!(await chatGate(req, res, counterpart))) return;
        notifyIds = [Number(sender_id), Number(recipient_id)];
        authorId = Number(sender_id);
    }

    /* Toggle: delete first, insert only when nothing was removed. */
    const del = await db.query(
      `DELETE FROM chat_reactions
        WHERE scope = $1 AND message_id = $2 AND user_id = $3 AND emoji = $4`,
      [scope, messageId, me, emoji]
    );
    let added = false;
    if (del.rowCount === 0) {
      await db.query(
        `INSERT INTO chat_reactions (scope, message_id, user_id, emoji)
         VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [scope, messageId, me, emoji]
      );
      added = true;
    }

    const byId = await loadReactions(scope, [messageId]);
    const reactions = byId[messageId] || [];

    /* Resolve the reactor's display name once — it rides the socket payload so
     * the recipient's toast can say WHO reacted, and the notification title
     * below is built from the same lookup. */
    let actorName = 'Someone';
    try {
      const who = await db.query('SELECT name FROM users WHERE id = $1', [me]);
      actorName = who.rows[0]?.name || 'Someone';
    } catch (e) {
      /* non-fatal: fall back to the generic label */
    }

    const payload = { scope, messageId, userId: me, authorId, actorName, emoji, added, reactions };

    const io = req.app.get('io');
    if (io) {
      try {
        for (const uid of new Set(notifyIds.map(Number))) {
          io.to(`user:${uid}`).emit('chat_reaction', payload);
        }
      } catch (e) {
        console.warn('[chat reaction broadcast]', e.message);
      }
    }

    /* Tell the author, by name, who reacted — but only when a reaction was
     * actually added (un-reacting shouldn't spam) and never for a self-reaction
     * on your own message. */
    if (added && authorId != null && authorId !== me) {
      try {
        const where = scope === 'group' ? 'your group message' : 'your message';
        await notif.push(io, authorId, `${actorName} reacted ${emoji}`,
          `${actorName} reacted ${emoji} to ${where}.`,
          { type: 'chat_reaction', senderId: me, relatedId: messageId });
      } catch (e) {
        console.warn('[chat reaction notification]', e.message);
      }
    }

    res.json({ ok: true, ...payload });
  } catch (err) {
    console.error('[chat:toggleReaction] error', err);
    res.status(500).json({ message: 'Failed to update reaction', error: err.message });
  }
};

/* DELETE /api/chat/messages/:id   body: { scope: 'dm'|'group', mode: 'everyone'|'me' }
 *
 * WhatsApp-style deletion with two distinct outcomes:
 *   'everyone' — the row is removed for ALL participants. Only the author may do
 *                this; in a group an admin/superadmin may also remove anyone's
 *                message (the same moderation rule the member list uses).
 *   'me'       — the row is untouched, a tombstone hides it from me only. Any
 *                participant can hide a message from their own view.
 * The socket push is what makes it disappear live on the other person's screen.
 */
exports.deleteMessage = async (req, res) => {
  try {
    const me = Number(req.user.id);
    const myRole = String(req.user.role || '');
    const scope = req.body?.scope === 'group' ? 'group' : 'dm';
    const mode = req.body?.mode === 'me' ? 'me' : 'everyone';
    const messageId = Number(req.params.id);

    if (!messageId) return res.status(400).json({ message: 'id required' });

    const table = scope === 'group' ? 'chat_group_messages' : 'chat_messages';

    const found = await db.query(
      scope === 'group'
        ? `SELECT id, sender_id, group_id FROM ${table} WHERE id = $1`
        : `SELECT id, sender_id, recipient_id FROM ${table} WHERE id = $1`,
      [messageId]
    );
    if (found.rows.length === 0) return res.status(404).json({ message: 'Message not found' });
    const row = found.rows[0];

    /* Who can see this message at all (used for both the permission check and
     * the realtime fan-out). */
    let notifyIds = [];
    if (scope === 'group') {
      const gid = Number(row.group_id);
      if (!(await isGroupMember(gid, me))) return res.status(403).json({ message: 'Not a member' });
      notifyIds = await groupMemberIds(gid);
    } else {
      const { sender_id, recipient_id } = row;
      if (Number(sender_id) !== me && Number(recipient_id) !== me) {
        return res.status(403).json({ message: 'Not your message' });
      }
      notifyIds = [Number(sender_id), Number(recipient_id)];
    }

    if (mode === 'me') {
      /* Hide it from my own view only. */
      await db.query(
        `INSERT INTO chat_message_deletions (scope, message_id, user_id)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [scope, messageId, me]
      );
    } else {
      const isAuthor = Number(row.sender_id) === me;
      const isGroupAdmin = scope === 'group' && (myRole === 'admin' || myRole === 'superadmin');
      if (!isAuthor && !isGroupAdmin) {
        return res.status(403).json({ message: 'You can only delete your own messages' });
      }
      await db.query(`DELETE FROM ${table} WHERE id = $1`, [messageId]);
      /* Reactions point at the message by id (no FK), so clean them up here or
       * they would linger as orphans. */
      await db.query(
        `DELETE FROM chat_reactions WHERE scope = $1 AND message_id = $2`,
        [scope, messageId]
      );
    }

    const payload = { scope, messageId, byUserId: me, mode };
    const io = req.app.get('io');
    if (io) {
      try {
        /* For 'me', only the user who hid it needs an update (their other tabs).
           For 'everyone', everybody who can see it must drop the row. */
        const targets = mode === 'me' ? [me] : notifyIds;
        for (const uid of new Set(targets.map(Number))) {
          io.to(`user:${uid}`).emit('chat_message_deleted', payload);
        }
      } catch (e) {
        console.warn('[chat delete broadcast]', e.message);
      }
    }

    res.json({ ok: true, ...payload });
  } catch (err) {
    console.error('[chat:deleteMessage] error', err);
    res.status(500).json({ message: 'Failed to delete message', error: err.message });
  }
};

/* Called from the socket layer when a user connects/disconnects so presence +
 * lastSeen stay consistent on the server side without a REST round-trip. */
exports.heartbeatSeen = (userId) => markSeen(userId);
exports.trackDisconnect = trackDisconnect;
exports.sweptDisconnecting = sweptDisconnecting;

/* ================================================================== */
/* Group chat: admin-created rooms, 1:many real-time chat + attachments */
/* ================================================================== */

const ATTACHMENT_PATH = (filename) => `/uploads/chat/${filename}`;

async function isGroupMember(groupId, userId) {
  const r = await db.query(
    'SELECT 1 FROM chat_group_members WHERE group_id = $1 AND user_id = $2',
    [groupId, userId]
  );
  return r.rows.length > 0;
}

async function groupMemberIds(groupId) {
  const r = await db.query(
    'SELECT user_id FROM chat_group_members WHERE group_id = $1',
    [groupId]
  );
  return r.rows.map((u) => Number(u.user_id));
}

async function ensureReadRow(groupId, userId) {
  await db.query(
    `INSERT INTO chat_group_reads (group_id, user_id, last_read_message_id)
     VALUES ($1, $2, 0)
     ON CONFLICT (group_id, user_id) DO NOTHING`,
    [groupId, userId]
  );
}

async function insertMember(groupId, userId) {
  await db.query(
    `INSERT INTO chat_group_members (group_id, user_id) VALUES ($1, $2)
       ON CONFLICT (group_id, user_id) DO NOTHING`,
    [groupId, userId]
  );
  await ensureReadRow(groupId, userId);
}

/* GET /api/chat/groups   - groups I belong to, newest activity first, with the
 * last message, member count, and my unread count. */
exports.listGroups = async (req, res) => {
  try {
    const me = req.user.id;
    const r = await db.query(
      `SELECT g.id, g.name, g.created_by, g.avatar, g.created_at,
              (SELECT COUNT(*) FROM chat_group_members m2 WHERE m2.group_id = g.id)::int AS member_count,
              COALESCE(r.last_read_message_id, 0) AS my_last_read,
              lm.id AS last_message_id,
              lm.message AS last_message,
              lm.attachment AS last_attachment,
              lm.attachment_name AS last_attachment_name,
              lm.created_at AS last_message_at,
              (SELECT COUNT(*) FROM chat_group_messages mm
                WHERE mm.group_id = g.id AND mm.id > COALESCE(r.last_read_message_id, 0))::int AS unread_count
         FROM chat_groups g
         JOIN chat_group_members mine ON mine.group_id = g.id AND mine.user_id = $1
         LEFT JOIN chat_group_reads r ON r.group_id = g.id AND r.user_id = $1
         LEFT JOIN LATERAL (
           SELECT id, message, attachment, attachment_name, created_at
             FROM chat_group_messages lm
            WHERE lm.group_id = g.id
            ORDER BY lm.created_at DESC, lm.id DESC LIMIT 1
         ) lm ON TRUE
        ORDER BY COALESCE(lm.created_at, g.created_at) DESC
        LIMIT 100`,
      [me]
    );
    await markSeen(me);
    res.json({
      groups: r.rows.map((g) => ({
        id: Number(g.id),
        name: g.name,
        avatar: g.avatar || null,
        createdBy: Number(g.created_by),
        memberCount: g.member_count,
        lastMessage: g.last_message || g.last_attachment_name || null,
        lastAttachment: g.last_attachment || null,
        lastMessageAt: g.last_message_at || g.created_at,
        unread: g.unread_count,
      })),
    });
  } catch (err) {
    console.error('[chat:listGroups] error', err);
    res.status(500).json({ message: 'Failed to load groups', error: err.message });
  }
};

/* POST /api/chat/groups  body: { name, memberIds: number[] }  (admin/superadmin) */
exports.createGroup = async (req, res) => {
  try {
    const me = req.user.id;
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ message: 'Group name required' });
    if (name.length > 60) return res.status(400).json({ message: 'Group name too long (max 60)' });

    const rawIds = Array.isArray(req.body.memberIds)
      ? req.body.memberIds.map(Number).filter(Number.isInteger)
      : [];
    const memberSet = new Map([[me, true]]);
    rawIds.forEach((id) => { if (id !== me) memberSet.set(id, true); });

    const g = await db.query(
      'INSERT INTO chat_groups (name, created_by) VALUES ($1, $2) RETURNING *',
      [name, me]
    );
    const groupId = g.rows[0].id;

    for (const uid of memberSet.keys()) {
      await insertMember(groupId, uid);
    }

    const members = await db.query(
      `SELECT u.id, u.name, u.role, u.avatar_config, u.profile_image
         FROM chat_group_members m JOIN users u ON u.id = m.user_id
        WHERE m.group_id = $1 ORDER BY u.name ASC`,
      [groupId]
    );

    await markSeen(me);
    res.status(201).json({
      group: { id: groupId, name, createdBy: me, avatar: null, memberCount: members.rows.length, unread: 0 },
      members: members.rows,
    });
  } catch (err) {
    console.error('[chat:createGroup] error', err);
    res.status(500).json({ message: 'Failed to create group', error: err.message });
  }
};

/* GET /api/chat/groups/:id   - group + its members. */
exports.getGroup = async (req, res) => {
  try {
    const me = req.user.id;
    const groupId = Number(req.params.id);
    if (!(await isGroupMember(groupId, me))) return res.status(403).json({ message: 'Not a member' });

    const g = await db.query(
      `SELECT g.*, u.name AS creator_name, u.role AS creator_role,
              u.avatar_config AS creator_avatar, u.profile_image AS creator_image
         FROM chat_groups g JOIN users u ON u.id = g.created_by
        WHERE g.id = $1`,
      [groupId]
    );
    if (g.rows.length === 0) return res.status(404).json({ message: 'Group not found' });

    const members = await db.query(
      `SELECT u.id, u.name, u.role, u.avatar_config, u.profile_image,
              u.last_seen_at
         FROM chat_group_members m JOIN users u ON u.id = m.user_id
        WHERE m.group_id = $1 ORDER BY u.name ASC`,
      [groupId]
    );

    res.json({
      group: g.rows[0],
      members: members.rows,
    });
  } catch (err) {
    console.error('[chat:getGroup] error', err);
    res.status(500).json({ message: 'Failed to load group', error: err.message });
  }
};

/* GET /api/chat/groups/:id/messages?before=   - newest-first pagination. */
exports.getGroupMessages = async (req, res) => {
  try {
    const me = req.user.id;
    const groupId = Number(req.params.id);
    const before = req.query.before ? Number(req.query.before) : null;
    if (!(await isGroupMember(groupId, me))) return res.status(403).json({ message: 'Not a member' });

    const params = [groupId];
    let where = 'm.group_id = $1';
    if (before) {
      params.push(before);
      where += ' AND m.id < $2';
    }
    params.push(50);
    const r = await db.query(
      `SELECT m.id, m.group_id, m.sender_id, m.message, m.attachment,
              m.attachment_name, m.attachment_type, m.attachment_size, m.created_at,
              u.name AS sender_name, u.role AS sender_role, u.avatar_config AS sender_avatar,
              u.profile_image AS sender_image
         FROM chat_group_messages m JOIN users u ON u.id = m.sender_id
        WHERE ${where}
        ORDER BY m.created_at DESC
        LIMIT $${params.length}`,
      params
    );

    await markSeen(me);
    const hidden = await hiddenMessageIds('group', me, r.rows.map((m) => m.id));
    const visible = hidden.size === 0 ? r.rows : r.rows.filter((m) => !hidden.has(Number(m.id)));
    const reactions = await loadReactions('group', visible.map((m) => m.id));
    res.json({ messages: attachReactions(visible, reactions) });
  } catch (err) {
    console.error('[chat:getGroupMessages] error', err);
    res.status(500).json({ message: 'Failed to load group messages', error: err.message });
  }
};

/* POST /api/chat/groups/:id/messages
 * multipart: text (optional) + file (optional, multer) — at least one required. */
exports.sendGroupMessage = async (req, res) => {
  try {
    const me = req.user.id;
    const groupId = Number(req.params.id);
    const text = String(req.body.text || '').trim();
    const file = req.file || null;

    if (!(await isGroupMember(groupId, me))) return res.status(403).json({ message: 'Not a member' });
    if (!text && !file) return res.status(400).json({ message: 'Text or file required' });
    if (text.length > 4000) return res.status(400).json({ message: 'Message too long' });

    const inserted = await db.query(
      `INSERT INTO chat_group_messages
         (group_id, sender_id, message, attachment, attachment_name, attachment_type, attachment_size, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       RETURNING id, group_id, sender_id, message, attachment, attachment_name, attachment_type, attachment_size, created_at`,
      [
        groupId, me, text || null,
        file ? ATTACHMENT_PATH(file.filename) : null,
        file ? file.originalname : null,
        file ? file.mimetype : null,
        file ? file.size : null,
      ]
    );
    const row = inserted.rows[0];

    const sender = await db.query('SELECT name, role FROM users WHERE id = $1', [me]);
    row.sender_name = sender.rows[0]?.name;
    row.sender_role = sender.rows[0]?.role;

    const io = req.app.get('io');
    /* Needed for BOTH the socket fan-out and the bell notifications, so it is
       fetched once here rather than inside the `if (io)` block. */
    const memberIds = await groupMemberIds(groupId);
    if (io) {
      try {
        for (const uid of memberIds) {
          /* The sender appends their own message from the POST response, so a
             socket echo would show it twice in their UI. Recipients get one. */
          if (Number(uid) === Number(me)) continue;
          io.to(`user:${uid}`).emit('chat_group_message', { message: row });
        }
        io.to(`group:${groupId}`).emit('chat_group_message', { message: row });
      } catch (e) {
        console.warn('[chat group broadcast]', e.message);
      }
    }

    /* Raise a bell entry for every other member. The group name is best-effort:
       if this lookup fails we still notify, just with a generic title. */
    let groupName = row.sender_name;
    try {
      const g = await db.query('SELECT name FROM chat_groups WHERE id = $1', [groupId]);
      if (g.rows[0]?.name) groupName = g.rows[0].name;
    } catch (e) {
      console.warn('[chat group name lookup]', e.message);
    }
    await notifyMessage(io, {
      recipients: memberIds,
      senderId: me,
      senderName: `${groupName} · ${row.sender_name || 'Someone'}`,
      conversationId: groupId,
      group: true,
      text,
      hasFile: !!file,
    });

    await markSeen(me);
    res.status(201).json({ message: row });
  } catch (err) {
    if (req.file) { try { require('fs').unlinkSync(req.file.path); } catch {} }
    console.error('[chat:sendGroupMessage] error', err);
    res.status(500).json({ message: 'Failed to send group message', error: err.message });
  }
};

/* POST /api/chat/groups/:id/read   - move my read cursor to the newest message. */
exports.markGroupRead = async (req, res) => {
  try {
    const me = req.user.id;
    const groupId = Number(req.params.id);
    if (!(await isGroupMember(groupId, me))) return res.status(403).json({ message: 'Not a member' });

    const mx = await db.query('SELECT COALESCE(MAX(id), 0) AS m FROM chat_group_messages WHERE group_id = $1', [groupId]);
    const maxId = Number(mx.rows[0].m);

    await db.query(
      `INSERT INTO chat_group_reads (group_id, user_id, last_read_message_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (group_id, user_id)
       DO UPDATE SET last_read_message_id = GREATEST(chat_group_reads.last_read_message_id, EXCLUDED.last_read_message_id)`,
      [groupId, me, maxId]
    );

    const io = req.app.get('io');
    if (io) io.to(`user:${me}`).emit('chat_group_unread_changed', { groupId, unread: 0 });

    await markSeen(me);
    res.json({ ok: true, lastReadMessageId: maxId });
  } catch (err) {
    console.error('[chat:markGroupRead] error', err);
    res.status(500).json({ message: 'Failed to mark group read', error: err.message });
  }
};

/* POST /api/chat/groups/:id/members  body: { memberIds }  (admin/superadmin) */
exports.addGroupMembers = async (req, res) => {
  try {
    const groupId = Number(req.params.id);
    const rawIds = Array.isArray(req.body.memberIds)
      ? req.body.memberIds.map(Number).filter(Number.isInteger)
      : [];

    const g = await db.query('SELECT id FROM chat_groups WHERE id = $1', [groupId]);
    if (g.rows.length === 0) return res.status(404).json({ message: 'Group not found' });

    for (const uid of rawIds) {
      await insertMember(groupId, uid);
    }

    const added = await db.query(
      `SELECT u.id, u.name, u.role, u.avatar_config, u.profile_image
         FROM chat_group_members m JOIN users u ON u.id = m.user_id
        WHERE m.group_id = $1 AND m.user_id = ANY($2::int[])`,
      [groupId, rawIds]
    );

    const io = req.app.get('io');
    if (io) {
      try {
        for (const u of added.rows) {
          io.to(`user:${u.id}`).emit('chat_group_added', { group: { id: groupId } });
        }
      } catch (e) { console.warn('[chat group add broadcast]', e.message); }
    }

    const members = await db.query(
      `SELECT u.id, u.name, u.role, u.avatar_config, u.profile_image
         FROM chat_group_members m JOIN users u ON u.id = m.user_id
        WHERE m.group_id = $1 ORDER BY u.name ASC`,
      [groupId]
    );

    res.json({ members: members.rows, added: added.rows });
  } catch (err) {
    console.error('[chat:addGroupMembers] error', err);
    res.status(500).json({ message: 'Failed to add members', error: err.message });
  }
};

/* DELETE /api/chat/groups/:id/members/:userId  (admin/superadmin) */
exports.removeGroupMember = async (req, res) => {
  try {
    const groupId = Number(req.params.id);
    const targetId = Number(req.params.userId);

    const mem = await db.query(
      'SELECT id FROM chat_group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, targetId]
    );
    if (mem.rows.length === 0) return res.status(404).json({ message: 'Member not found' });

    await db.query('DELETE FROM chat_group_members WHERE id = $1', [mem.rows[0].id]);
    await db.query('DELETE FROM chat_group_reads WHERE group_id = $1 AND user_id = $2', [groupId, targetId]);

    const io = req.app.get('io');
    if (io) {
      try { io.to(`user:${targetId}`).emit('chat_group_removed', { group: { id: groupId } }); }
      catch (e) { console.warn('[chat group remove broadcast]', e.message); }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[chat:removeGroupMember] error', err);
    res.status(500).json({ message: 'Failed to remove member', error: err.message });
  }
};

/* POST /api/chat/groups/:id/avatar  (admin/superadmin) — image only.
 * Replaces the group profile picture; the old file (if any) is cleaned up. */
exports.updateGroupAvatar = async (req, res) => {
  try {
    const groupId = Number(req.params.id);
    if (!req.file) return res.status(400).json({ message: 'No file provided' });

    const g = await db.query('SELECT avatar FROM chat_groups WHERE id = $1', [groupId]);
    if (g.rows.length === 0) {
      try { fs.unlinkSync(req.file.path); } catch {}
      return res.status(404).json({ message: 'Group not found' });
    }

    const newUrl = ATTACHMENT_PATH(req.file.filename);
    const oldUrl = g.rows[0].avatar;
    await db.query('UPDATE chat_groups SET avatar = $1 WHERE id = $2', [newUrl, groupId]);

    /* Remove the previous avatar file so uploads/chat stays tidy. Only touch
       files under uploads/chat. */
    if (oldUrl && oldUrl.startsWith('/uploads/chat/')) {
      const oldPath = path.join(__dirname, '..', '..', 'uploads', 'chat', path.basename(oldUrl));
      if (fs.existsSync(oldPath)) { try { fs.unlinkSync(oldPath); } catch {} }
    }

    const io = req.app.get('io');
    if (io) {
      const memberIds = await groupMemberIds(groupId);
      try {
        for (const uid of memberIds) io.to(`user:${uid}`).emit('chat_group_updated', { group: { id: groupId } });
      } catch (e) { console.warn('[chat group avatar broadcast]', e.message); }
    }

    res.json({ ok: true, group: { id: groupId, avatar: newUrl } });
  } catch (err) {
    if (req.file) { try { fs.unlinkSync(req.file.path); } catch {} }
    console.error('[chat:updateGroupAvatar] error', err);
    res.status(500).json({ message: 'Failed to update group avatar', error: err.message });
  }
};
