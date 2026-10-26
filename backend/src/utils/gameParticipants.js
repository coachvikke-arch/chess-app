/* Canonical participant resolution for an online game.
 *
 * `online_games` stores the two participants as `admin_id` / `student_id` plus
 * `admin_color` — the ADMIN's colour. Neither column means "White". So "who is
 * White?" and "who am I playing?" are two separate questions, and both have to be
 * answered from IDs, never from names.
 *
 * WHY THIS EXISTS (the bug it fixes)
 * ----------------------------------
 * gameHistoryController read `g.admin_id === userId` to decide the opponent, but
 * its query selected only the two joined NAMES — never `g.admin_id` itself. The
 * comparison therefore evaluated `undefined === 30`, i.e. always false, and the
 * opponent was ALWAYS reported as `admin_name`. That looked correct for exactly
 * half the games: whenever the viewer happened to be the student, the admin was
 * genuinely the opponent. The moment the viewer was the ADMIN, the "opponent"
 * became the viewer themselves — Manivel M shown as his own opponent.
 *
 * `my_color` was computed in SQL from `g.admin_id = $1`, so Postgres compared it
 * correctly and the Color column stayed right — which is exactly why the bug
 * looked like an opponent-naming problem rather than an identity problem.
 *
 * THE RULES
 *   whiteId / blackId   resolved via admin_color, so they are absolute and do
 *                       not depend on who is asking
 *   isParticipant       did this user actually play in this game?
 *   myColor             the viewer's side, or null when they did not play
 *   opponentId / Name   the OTHER participant, or null when it cannot be resolved
 *
 * Names are display data only: they can be duplicated, changed, or differ from
 * an account name, so every decision here is made on IDs. */

/**
 * @param {object} game  a row with admin_id, student_id, admin_color,
 *                       admin_name, student_name
 * @param {number|string} userId  the authenticated viewer's id
 */
function resolveParticipants(game, userId) {
  const me = userId == null ? null : Number(userId);

  const adminId = game.admin_id == null ? null : Number(game.admin_id);
  const studentId = game.student_id == null ? null : Number(game.student_id);
  const adminColor = game.admin_color === 'white' ? 'white' : 'black';

  /* Absolute sides. admin_color is the ADMIN's colour, so when it is white the
     admin IS White and the student is Black, and vice versa. */
  const whiteId = adminColor === 'white' ? adminId : studentId;
  const blackId = adminColor === 'white' ? studentId : adminId;
  const whiteName = adminColor === 'white' ? game.admin_name : game.student_name;
  const blackName = adminColor === 'white' ? game.student_name : game.admin_name;

  /* Numeric compare on purpose: a driver that hands back int8 as a string would
     otherwise make `'30' === 30` false and silently repeat the original bug. */
  const isAdmin = me !== null && adminId !== null && me === adminId;
  const isStudent = me !== null && studentId !== null && me === studentId;
  const isParticipant = isAdmin || isStudent;

  /* The opponent is derived from the participant IDs — never from the result,
     the colour string, or a name comparison. When the viewer played as the admin
     the opponent is the student, and vice versa. */
  let opponentId = isAdmin ? studentId : isAdmin ? null : adminId;
  let opponentName = isAdmin ? game.student_name : isAdmin ? null : game.admin_name;
  if (!isParticipant) {
    opponentId = null;
    opponentName = null;
  }

  /* Safety invariant: if the resolved opponent is the viewer, the mapping is
     wrong and we refuse to echo the viewer's own name back as an opponent.
     Dropping to null makes the UI show "—" instead of a lie. */
  if (opponentId !== null && me !== null && opponentId === me) {
    opponentId = null;
    opponentName = null;
  }

  return {
    isParticipant,
    isCreator: isAdmin,
    myColor: isAdmin ? adminColor : isStudent ? (adminColor === 'white' ? 'black' : 'white') : null,
    opponentId,
    opponentName: opponentId === null ? null : opponentName,
    whiteId,
    blackId,
    whiteName,
    blackName,
  };
}

module.exports = { resolveParticipants };
