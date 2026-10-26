/* Who may watch whose board inside a live classroom.

   The anti-cheat rule — a student may only spectate once their OWN game in the
   class has finished, and may never watch another class's boards — lives here as
   a pure predicate rather than being re-implemented in each controller and
   socket handler. Every call site feeds it plain row objects (no DB access of
   its own) so the rules stay unit-testable and cannot drift between the HTTP and
   websocket layers. */

const ADMIN_ROLES = ['admin', 'superadmin'];

function isClassInstructor(viewer, classRow) {
  if (!viewer) return false;
  if (ADMIN_ROLES.includes(viewer.role)) return true;
  if (!classRow || classRow.coach_id == null) return false;
  return Number(classRow.coach_id) === Number(viewer.id);
}

/* Class-level gate. Instructors always pass; a student passes only when the
   teacher left the switch on AND the student's own game in this class finished.
   `reason` lets callers explain a refusal instead of returning a bare 403. */
function canSpectateClass({ viewer, classRow, ownGameFinished }) {
  if (!viewer) return { allowed: false, reason: 'not-signed-in' };
  if (isClassInstructor(viewer, classRow)) return { allowed: true, instructor: true };
  if (!classRow) return { allowed: false, reason: 'no-class' };
  if (classRow.spectate_enabled === false) return { allowed: false, reason: 'disabled' };
  if (!ownGameFinished) return { allowed: false, reason: 'own-game-unfinished' };
  return { allowed: true, instructor: false };
}

/* A specific board: it must belong to the SAME class, then the class rule
   applies. `wrong-class` is what stops a student in class A from watching a
   game that belongs to class B. */
function canSpectateGame({ viewer, gameRow, classRow, ownGameFinished }) {
  if (!gameRow) return { allowed: false, reason: 'not-found' };
  if (!classRow || Number(gameRow.class_id) !== Number(classRow.id)) {
    return { allowed: false, reason: 'wrong-class' };
  }
  return canSpectateClass({ viewer, classRow, ownGameFinished });
}

/* A spectator is never a participant, so the move guard reduces to this: only
   the two players stored on the row may move. Exported so the controller and the
   tests share one definition. */
function canMoveGame({ viewer, gameRow }) {
  if (!viewer || !gameRow) return false;
  return Number(gameRow.admin_id) === Number(viewer.id)
    || Number(gameRow.student_id) === Number(viewer.id);
}

module.exports = {
  ADMIN_ROLES,
  isClassInstructor,
  canSpectateClass,
  canSpectateGame,
  canMoveGame,
};
