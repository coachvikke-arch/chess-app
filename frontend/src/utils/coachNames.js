/* Normalising the coach fields of a user record.
 *
 * /auth/me returns TWO coach fields with DIFFERENT shapes:
 *
 *   coach_name  -> string | null     the primary coach (students.coach_id),
 *                                     falling back to the GROUP coach
 *   coach_names -> [{ id, name }]    everyone assigned through student_coaches,
 *                                     ordered primary first
 *
 * They are not interchangeable, and rendering coach_names as though it held
 * strings throws "Objects are not valid as a React child". So the shape
 * translation lives here, where it can be tested against the real payload
 * instead of being re-guessed at each render site.
 *
 * Fallback rule: coach_names wins when it has entries, because a student's
 * assigned coaches are exactly what the rest of the app means by "assigned"
 * (coachScope() unions students.coach_id with student_coaches and excludes the
 * group coach). Only a student with no assigned coaches falls back to
 * coach_name, which is then the group coach they were assigned by batch.
 */

/**
 * The coaches to display for a user, de-duplicated and display-ready.
 * @returns {{ id: number|null, name: string }[]} empty when there are none.
 */
export function coachListFrom(user) {
  const assigned = Array.isArray(user?.coach_names) ? user.coach_names : [];
  const source = assigned.length > 0 ? assigned : [{ id: null, name: user?.coach_name }];

  const seen = new Set();
  const coaches = [];

  for (const entry of source) {
    // Tolerate a bare string so a future payload change degrades instead of crashing.
    const name = typeof entry === 'string' ? entry : entry?.name;
    if (!name) continue;

    const id = typeof entry === 'string' ? null : entry?.id ?? null;
    // Key on the id when there is one: two coaches can share a display name.
    const key = id != null ? `id:${id}` : `name:${name}`;
    if (seen.has(key)) continue;

    seen.add(key);
    coaches.push({ id, name });
  }

  return coaches;
}

/** Just the names, primary first. Useful for copy and for list keys. */
export function coachNamesFrom(user) {
  return coachListFrom(user).map((c) => c.name);
}