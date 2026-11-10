const db = require('../config/database');
const profile = require('./unifiedProfileService');
/* The one place that decides whose students a signed-in user may see. Reused
   here rather than re-derived: an admin's scope is their primary students plus
   the student_coaches rows, a superadmin's is everyone, and a student's is
   themselves (which the admin router already refuses). */
const visibility = require('./reviewVisibilityService');

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
        ratings: a.ratings || [],
      })),
      totalGames: linked.reduce((sum, a) => sum + (Number(a.games) || 0), 0),
      lastSyncedAt: synced || null,
    };
  });
}

/** One student's header row plus the same account payload their own page reads. */
async function studentProfile(user, studentId) {
  const student = await resolveStudent(user, studentId);
  const accounts = await profile.accountsForUser(student.user_id);
  return { student, accounts };
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
    accounts: refreshed,
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

module.exports = {
  resolveStudent,
  listStudents,
  studentProfile,
  syncStudent,
};
