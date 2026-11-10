const db = require('../config/database');
const profile = require('./unifiedProfileService');
/* The one place that decides whose students a signed-in user may see. Reused
   here rather than re-derived: an admin's scope is their primary students plus
   the student_coaches rows, a superadmin's is everyone, and a student's is
   themselves (which the admin router already refuses). */
const visibility = require('./reviewVisibilityService');
const notifications = require('./notificationService');

/* ─────────────────────────────────────────────────────────────────────────────
 * Admin / coach view of ASSIGNED students' Chess.com + Lichess profiles.
 *
 * Every read goes through `resolveStudent`, which answers two questions in one
 * place: "is this user in the caller's visibility set?" and "are they actually a
 * student?". The second matters because a superadmin's visibility set is every
 * user row, including other admins - a coach has no chess profile to show here.
 *
 * No new data model: accounts, ratings, history and games all stay in the tables
 * the student's own page already fills, and the sync calls are the exact same
 * functions. This module only decides WHO may ask, and which user id to ask for.
 * ───────────────────────────────────────────────────────────────────────────── */

function notFound(message) {
  return Object.assign(new Error(message || 'Student not found.'), { status: 404 });
}

/**
 * Resolve :studentId to a real, visible student.
 *
 * @param {{id:number, role:string}} user  req.user
 * @param {number|string} studentId        the student's users.id
 * @returns {Promise<{user_id:number, name:string, profile_image:string|null, avatar_config:object|null}>}
 */
async function resolveStudent(user, studentId) {
  const id = Number(studentId);
  if (!Number.isInteger(id) || id <= 0) throw notFound();

  const visibleIds = await visibility.getVisibleUserIds(user);
  /* 403 rather than 404 here: the caller asked about a specific person and is
     told they may not see them. `forbidden()` is the same error shape every
     other visibility-checked endpoint returns. */
  if (!visibility.canSeeUser(visibleIds, id)) {
    throw visibility.forbidden('That student is not assigned to you.');
  }

  const r = await db.query(
    `SELECT s.user_id, u.name, u.profile_image, u.avatar_config
       FROM students s
       JOIN users u ON u.id = s.user_id
      WHERE s.user_id = $1`,
    [id]
  );
  if (!r.rows.length) throw notFound();
  const row = r.rows[0];
  return { ...row, user_id: Number(row.user_id) };
}

/**
 * Every accessible student, with the connected accounts and cached ratings the
 * list, badges and summary table are built from.
 *
 * Two queries rather than one join: the roster is small, and keeping accounts in
 * their own result means a student with two connections can never duplicate a
 * roster row through a join fan-out.
 */
async function listStudents(user) {
  const visibleIds = await visibility.getVisibleUserIds(user);
  const ids = visibility.visibleIdArray(visibleIds);
  if (!ids.length) return [];

  const roster = await db.query(
    `SELECT s.user_id, u.name, u.profile_image, u.avatar_config
       FROM students s
       JOIN users u ON u.id = s.user_id
      WHERE s.user_id = ANY($1::int[])
      ORDER BY u.name ASC`,
    [ids]
  );
  const accounts = await db.query(
    `SELECT a.user_id, a.id, a.platform, a.username, a.avatar, a.title, a.country_code,
            a.last_synced_at, a.last_error, a.status,
            a.data -> 'linkedByAdminId' AS linked_by_admin_id,
            (SELECT COUNT(*) FROM chess_games g WHERE g.account_id = a.id) AS games,
            COALESCE((SELECT json_agg(json_build_object(
                        'category', r.category, 'rating', r.rating, 'best', r.best) ORDER BY r.category)
                      FROM chess_ratings r WHERE r.account_id = a.id), '[]'::json) AS ratings
       FROM connected_chess_accounts a
      WHERE a.user_id = ANY($1::int[])
      ORDER BY a.created_at ASC`,
    [ids]
  );

  const byUser = new Map();
  for (const row of roster.rows) byUser.set(Number(row.user_id), []);
  for (const a of accounts.rows) byUser.get(Number(a.user_id))?.push(a);

  return roster.rows.map((s) => {
    const userId = Number(s.user_id);
    const linked = byUser.get(userId) || [];
    const synced = linked
      .map((a) => a.last_synced_at)
      .filter(Boolean)
      .sort()
      .pop();
    return {
      userId,
      name: s.name,
      profileImage: s.profile_image || null,
      avatarConfig: s.avatar_config || null,
      accounts: linked.map((a) => ({
        id: a.id,
        platform: a.platform,
        username: a.username,
        avatar: a.avatar,
        title: a.title,
        countryCode: a.country_code,
        games: Number(a.games) || 0,
        lastSyncedAt: a.last_synced_at,
        lastError: a.last_error,
        status: a.status,
        linkedByAdmin: a.linked_by_admin_id != null,
        ratings: a.ratings || [],
      })),
      totalGames: linked.reduce((sum, a) => sum + (Number(a.games) || 0), 0),
      lastSyncedAt: synced || null,
    };
  });
}

/* The provenance rides in the account's data JSONB as `linkedByAdminId`; the
   page only needs the boolean, so it is lifted into one camelCase field there. */
function withLinkSource(accounts) {
  return (accounts || []).map((a) => ({
    ...a,
    linkedByAdmin: a.linked_by_admin_id != null,
  }));
}

/** One student's header row plus the same account payload their own page reads. */
async function studentProfile(user, studentId) {
  const student = await resolveStudent(user, studentId);
  const accounts = await profile.accountsForUser(student.user_id);
  return { student, accounts: withLinkSource(accounts) };
}

/**
 * Re-fetch every connected account of one student.
 *
 * Errors are per-account on purpose: Chess.com answering 429 must not stop the
 * Lichess import, and a failed refresh must never wipe the cached profile. The
 * caller gets the refreshed (cached + newly imported) accounts in the same
 * response, so the page can simply re-render.
 */
async function syncStudent(user, studentId) {
  const student = await resolveStudent(user, studentId);
  const accounts = await profile.accountsForUser(student.user_id);

  let newGames = 0;
  const failures = [];
  for (const acct of accounts) {
    try {
      const r = await profile.syncAccount(student.user_id, acct.id);
      newGames += Number(r?.newGames) || 0;
    } catch (err) {
      failures.push({ platform: acct.platform, message: syncFailureMessage(acct.platform, err) });
    }
  }

  const refreshed = await profile.accountsForUser(student.user_id);
  return {
    student,
    accounts: withLinkSource(refreshed),
    newGames,
    failures,
    /* null means a clean run; a string is what the page shows as the reason it
       is looking at cached data. */
    note: failures.length ? failures.map((f) => f.message).join(' ') : null,
  };
}

function syncFailureMessage(platform, err) {
  const label = platform === 'lichess' ? 'Lichess' : 'Chess.com';
  if (err?.status === 429) return `${label} rate limit reached — showing the last cached data.`;
  if (err?.status === 404) return `${label} could not find that username — showing the last cached data.`;
  return `${label} sync failed — showing the last cached data.`;
}

/* ── coach-managed links ──────────────────────────────────────────────────────
 * The coach writes into the SAME table, under the SAME student user id, that the
 * learner's own "Connect profile" writes to. There is no admin-only mirror: the
 * student's page reads these rows as their own, can sync them, and can unlink
 * them. The only trace of who added it is the `linkedByAdminId` value in `data`,
 * which draws the badge and never affects access. */

function platformLabel(platform) {
  return platform === 'lichess' ? 'Lichess' : 'Chess.com';
}

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function conflict(message) {
  return Object.assign(new Error(message), { status: 409 });
}

/** The UI posts "chesscom" (the body contract); the database stores
    "chess.com". Accept the URL host too, so a caller cannot half-succeed. */
function normalizePlatform(input) {
  const v = String(input || '').trim().toLowerCase();
  if (v === 'chesscom' || v === 'chess.com' || v === 'chess-com') return 'chess.com';
  if (v === 'lichess' || v === 'lichess.org') return 'lichess';
  throw badRequest('Choose Chess.com or Lichess.');
}

/* Tell the student through the bell/socket. Failure is tolerated: the link is
   already saved and the notification is a courtesy, not part of the write. */
async function notifyStudent(io, student, platform, username, senderId, accountId, action) {
  const label = platformLabel(platform);
  const message = action === 'updated'
    ? `Your coach updated your ${label} profile to ${username}.`
    : `Your coach linked your ${label} profile (${username}).`;
  try {
    await notifications.push(io, student.user_id, 'Chess profile updated', message, {
      type: 'chess_profile',
      senderId: senderId || null,
      relatedId: accountId || null,
    });
  } catch (err) {
    console.warn('[chess-profile] student notification failed:', err.message);
  }
}

/**
 * POST /:studentId/accounts — a coach links a username for a student.
 *
 * The username is verified against the platform's official public API before
 * anything is stored, so a typo fails here instead of becoming an empty account.
 * If the import then fails (rate limit, network), the verified link is KEPT and
 * the reason is returned separately: the link is real even when the data is not
 * readable yet, and the account card shows last_error until the next sync.
 */
async function connectStudentAccount(user, studentId, { platform, username } = {}, { io } = {}) {
  const student = await resolveStudent(user, studentId);
  const platformKey = normalizePlatform(platform);
  const value = String(username || '').trim();
  if (!value) throw badRequest('Enter a username or profile URL.');
  const label = platformLabel(platformKey);

  /* One account per platform is a table constraint. A different username there
     must go through Edit, which clears the previous person's imported data;
     silently overwriting would mix two histories under one account. */
  const existing = await profile.accountOnPlatform(student.user_id, platformKey);
  const { username: normalized, summary } = await profile.validate(platformKey, value);
  if (existing && String(existing.username).toLowerCase() !== normalized.toLowerCase()) {
    throw conflict(
      `${label} is already linked to this student as "${existing.username}". Use Edit to change the username.`
    );
  }

  const owner = await profile.ownerOfUsername(platformKey, normalized);
  if (owner && Number(owner.user_id) !== student.user_id) {
    throw conflict(`That ${label} username is already linked to another student.`);
  }

  const alreadyLinked = Boolean(existing);
  const result = await profile.connectSummaryAsAdmin(student.user_id, summary, user.id);
  if (!alreadyLinked) {
    await notifyStudent(io, student, platformKey, result.username, user.id, result.accountId, 'linked');
  }

  const accounts = withLinkSource(await profile.accountsForUser(student.user_id));
  return {
    student,
    accountId: result.accountId,
    platform: platformKey,
    username: result.username,
    alreadyLinked,
    accounts,
    /* A failed import does not fail the connect. The account is linked and the
       page shows why its data is not there yet. */
    syncError: result.syncError ? syncFailureMessage(platformKey, result.syncError) : null,
    message: alreadyLinked
      ? `${label} (${result.username}) is already linked to this student.`
      : `${label} (${result.username}) linked and imported.`,
  };
}

/**
 * PUT /:studentId/accounts/:accountId — change the username of an existing link.
 *
 * A DIFFERENT username means a different person, so the old account row is
 * deleted first. Every child row (games, ratings, rating history, per-game
 * analysis) references it with ON DELETE CASCADE, so the previous player's data
 * goes with it instead of being attributed to the new username. The new row is
 * then created and imported by the same verified connect path.
 */
async function updateStudentAccount(user, studentId, accountId, { username } = {}, { io } = {}) {
  const student = await resolveStudent(user, studentId);
  const id = Number(accountId);
  if (!Number.isInteger(id) || id <= 0) throw notFound('Account not found.');

  const current = (await profile.accountsForUser(student.user_id))
    .find((a) => Number(a.id) === id);
  if (!current) throw notFound('Account not found.');

  const value = String(username || '').trim();
  if (!value) throw badRequest('Enter a username or profile URL.');

  const platform = current.platform;
  const label = platformLabel(platform);
  const { username: normalized, summary } = await profile.validate(platform, value);

  const owner = await profile.ownerOfUsername(platform, normalized);
  if (owner && Number(owner.user_id) !== student.user_id) {
    throw conflict(`That ${label} username is already linked to another student.`);
  }

  const changed = String(current.username).toLowerCase() !== normalized.toLowerCase();
  if (changed) {
    await db.query(
      'DELETE FROM connected_chess_accounts WHERE id = $1 AND user_id = $2',
      [id, student.user_id]
    );
  }

  const result = await profile.connectSummaryAsAdmin(student.user_id, summary, user.id);
  await notifyStudent(
    io, student, platform, result.username, user.id, result.accountId,
    changed ? 'updated' : 'linked'
  );

  const accounts = withLinkSource(await profile.accountsForUser(student.user_id));
  return {
    student,
    accountId: result.accountId,
    platform,
    username: result.username,
    accounts,
    syncError: result.syncError ? syncFailureMessage(platform, result.syncError) : null,
    message: `${label} username updated to ${result.username}.`,
  };
}

/** DELETE /:studentId/accounts/:accountId — unlink, exactly like the student's
    own Disconnect: the account row goes, and its imported data cascades. */
async function removeStudentAccount(user, studentId, accountId) {
  const student = await resolveStudent(user, studentId);
  const id = Number(accountId);
  if (!Number.isInteger(id) || id <= 0) throw notFound('Account not found.');
  await profile.disconnect(student.user_id, id);
  const accounts = withLinkSource(await profile.accountsForUser(student.user_id));
  return { student, accounts, message: 'Profile unlinked.' };
}

module.exports = {
  resolveStudent,
  listStudents,
  studentProfile,
  syncStudent,
  connectStudentAccount,
  updateStudentAccount,
  removeStudentAccount,
};
