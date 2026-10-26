const db = require('../config/database');

/* ─────────────────────────────────────────────────────────────────────────────
 * Who may this signed-in user see on the Game Review page?
 *
 * ONE helper, consulted by every endpoint behind that page: the members table,
 * a single member's games, the Brilliant Moves list, the single-game and
 * analysis fetches, and any search. Before this existed each of those handlers
 * carried its own idea of who a coach may look at, and the members table had no
 * idea at all — so any signed-in coach saw every member in the academy.
 *
 * The rules, by role:
 *   superadmin  the academy owner. Sees every member. This is the ONLY
 *               "sees everything" role: `admin` is the coach role in this app
 *               (permissionService.js), so there is no separate "head coach"
 *               flag on users and no role value that could express one.
 *   admin       a coach. Sees ONLY the students assigned to them — the primary
 *               coach (students.coach_id) plus any additional coach rows in
 *               student_coaches. Never a colleague, never another coach's
 *               students, never an unassigned account, and never themselves
 *               unless they also have their own students row.
 *   student     a learner. Sees only themselves.
 *
 * Two properties this deliberately does NOT have:
 *   - No client-sent scope. The caller's identity always comes from
 *     req.user (the verified JWT). A coachId/userId in a query string or body
 *     is only ever used as a REQUEST for someone, and is then checked against
 *     this set — never as proof of anything.
 *   - No memoisation. Reassigning a student has to take effect on the very next
 *     request, so the answer is re-read every time. One cheap indexed query is
 *     a fair price for access control that cannot go stale.
 * ───────────────────────────────────────────────────────────────────────────── */

/**
 * The users.id values this user may see, as a Set of numbers.
 *
 * Always a concrete set — there is no "unrestricted" sentinel. Callers apply one
 * uniform `= ANY($1::int[])` filter, which means no call site can forget the
 * branch that means "superadmin", and an empty set naturally yields no rows
 * (which is exactly what a coach with no students should get).
 *
 * @param {{id:number, role:string}} user  req.user
 * @returns {Promise<Set<number>>}
 */
async function getVisibleUserIds(user) {
  if (!user || user.id == null) return new Set();

  if (user.role === 'superadmin') {
    const r = await db.query('SELECT id FROM users');
    return new Set(r.rows.map((row) => Number(row.id)).filter((n) => n > 0));
  }

  if (user.role === 'admin') {
    /* The two assignment sources, unioned:
         - students.coach_id          the PRIMARY coach, the column every older
                                      feature still reads
         - student_coaches            additional coaches. A student can be handled
                                      by several, and a coach who is allowed to see
                                      the student must be allowed to review their
                                      games - otherwise the assignment exists for
                                      nothing.
       Note student_coaches.student_id is students.id, NOT users.id, so the join
       through students is mandatory. Getting that backwards matches nobody. */
    const r = await db.query(
      `SELECT s.user_id
         FROM students s
        WHERE s.coach_id = $1 AND s.user_id IS NOT NULL
        UNION
       SELECT s.user_id
         FROM student_coaches sc
         JOIN students s ON s.id = sc.student_id
        WHERE sc.coach_id = $1 AND s.user_id IS NOT NULL`,
      [user.id]
    );
    return new Set(r.rows.map((row) => Number(row.user_id)).filter((n) => n > 0));
  }

  /* A student - and any future learner role - sees themselves and nothing else.
     Falling through to `return new Set()` here would be fail-open; it is
     deliberately fail-closed. */
  return new Set([Number(user.id)].filter((n) => n > 0));
}

/** The visible set as a plain array, ready to hand to `= ANY($n::int[])`. */
function visibleIdArray(visibleIds) {
  return [...(visibleIds || new Set())];
}

/** May this user see this one member? */
function canSeeUser(visibleIds, userId) {
  return visibleIds instanceof Set && visibleIds.has(Number(userId));
}

/**
 * May this user see a game with these participants?
 *
 * A game has two players and the viewer may know only one of them: a coach whose
 * student played a colleague sees the game (with the opponent named, and no route
 * to that opponent's other games) but never the opponent's history. So the test
 * is "at least one participant is visible", not "all of them are".
 *
 * @param {number[]} ids  candidate participants
 * @returns {boolean}
 */
function canSeeParticipant(visibleIds, ids) {
  if (!(visibleIds instanceof Set)) return false;
  return (ids || []).some((id) => visibleIds.has(Number(id)));
}

/**
 * Express an unauthorised read the way the rest of the API does: a 403-shaped
 * error the route wrapper turns into a response.
 *
 * Deliberately 403 and not 404. 404 would hide the fact that the row exists;
 * here the caller has already been refused for asking about someone outside
 * their own scope, and saying so is what tells the UI to render an error rather
 * than an empty screen.
 */
function forbidden(message) {
  const err = new Error(message || 'You do not have access to that.');
  err.status = 403;
  err.code = 'not_visible';
  return err;
}

/**
 * Resolve the caller's visibility once and fail fast if they asked for someone
 * outside it.
 *
 * @returns {Promise<number>} the requested userId, guaranteed visible
 * @throws  {Error & {status:403}} when the target is not visible
 */
async function requireVisible(visibleIds, userId, message) {
  if (!canSeeUser(visibleIds, userId)) throw forbidden(message);
  return Number(userId);
}

module.exports = {
  getVisibleUserIds,
  visibleIdArray,
  canSeeUser,
  canSeeParticipant,
  requireVisible,
  forbidden,
};