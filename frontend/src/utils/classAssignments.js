/* Pure model for the classroom "Assignments" tab (coach view).
 *
 * Kept out of ClassAssignmentsPanel.jsx for the same reason the Worklist keeps
 * its filter rules out of the panel: the arithmetic — and the definition of
 * "completed" — can be pinned by a test without a DOM.
 *
 * The inputs are the Worklist's own shapes, so the classroom can never tell a
 * different story than the screen the coach already trusts:
 *   roster      — [{ student_id, name, email }]  (GET /classes/:id/detail)
 *   assignments — [{ id, title, student_refs: [{ id, status, solved, total }] }]
 *                 (GET /assignments/puzzle-assignments)
 */

/* A per-assignment student status that counts as done. These are the server's
   derived statuses (effectiveStudentStatus), so this is the one client-side
   reading of them. */
export const DONE_STATUSES = new Set(['submitted', 'reviewed', 'completed']);

/** One summary row per enrolled student, summed across every assignment. */
export function buildSummaries(roster = [], assignments = []) {
  return (roster || []).map((st) => {
    let assignmentsTotal = 0;
    let assignmentsDone = 0;
    let puzzlesTotal = 0;
    let puzzlesDone = 0;
    for (const a of assignments) {
      const ref = (a?.student_refs || []).find((r) => Number(r?.id) === Number(st?.student_id));
      if (!ref) continue;
      assignmentsTotal += 1;
      if (DONE_STATUSES.has(ref.status)) assignmentsDone += 1;
      puzzlesTotal += Number(ref.total) || 0;
      puzzlesDone += Number(ref.solved) || 0;
    }
    const pct = puzzlesTotal > 0 ? Math.round((puzzlesDone / puzzlesTotal) * 100) : 0;
    return {
      id: st.student_id,
      name: st.name || `Student ${st.student_id}`,
      email: st.email || '',
      assignmentsTotal,
      assignmentsDone,
      puzzlesTotal,
      puzzlesDone,
      pct,
      completed: assignmentsTotal > 0 && assignmentsDone === assignmentsTotal,
    };
  });
}

/** Search + the All / Pending / Completed filter, applied to summary rows. */
export function filterSummaries(rows = [], filter = 'all', query = '') {
  let out = rows;
  if (filter === 'pending') out = out.filter((r) => !r.completed);
  else if (filter === 'completed') out = out.filter((r) => r.completed);
  const q = (query || '').trim().toLowerCase();
  if (q) {
    out = out.filter(
      (r) => r.name.toLowerCase().includes(q) || (r.email || '').toLowerCase().includes(q)
    );
  }
  return out;
}
