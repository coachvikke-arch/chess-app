const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/studentController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');
const requireFeature = require('../middleware/requireFeature');

router.use(authMiddleware);
router.get('/', roleMiddleware('admin'), requireFeature('student_roster'), ctrl.listStudents);
/* Reports roster: the coach's OWN assigned students. Not behind the
   `student_roster` feature, because coachScope() already restricts it to those
   rows and the per-student report endpoints are ungated too. */
router.get('/assigned', roleMiddleware('admin'), ctrl.assignedStudents);
router.get('/coaches', roleMiddleware('admin'), ctrl.listCoaches);
router.patch('/me', ctrl.updateMe); // student edits their own profile details
router.patch('/me/avatar', ctrl.updateAvatar); // student customizes their avatar
router.delete('/me/avatar', ctrl.resetAvatar); // student removes / resets to default avatar
router.patch('/:id/avatar', roleMiddleware('admin'), ctrl.updateAvatar); // coach sets a student's avatar
router.delete('/:id/avatar', roleMiddleware('admin'), ctrl.resetAvatar); // coach resets a student's avatar
router.get('/:id/progress', ctrl.getProgress); // 'me' or numeric id; students can only fetch their own via 'me'
/* Report endpoints: staff keep exactly the access they had (the controllers
   still enforce assertCoachAccess themselves), and a signed-in student may
   fetch ONLY their own report — 'me' or their own numeric id, resolved from
   the session, never trusted from the URL. Anything else is a 403. */
async function reportAccess(req, res, next) {
  try {
    const role = req.user?.role;
    if (role === 'admin' || role === 'superadmin') return next();
    if (role !== 'student') return res.status(403).json({ message: 'Forbidden' });
    const ownId = await ctrl.studentIdForUser(req.user.id);
    if (!ownId) return res.status(404).json({ message: 'Student profile not found' });
    if (String(req.params.id) !== 'me' && String(req.params.id) !== String(ownId)) {
      return res.status(403).json({ message: 'You can only view your own report' });
    }
    req.params.id = String(ownId);
    /* The controllers below still run assertCoachAccess, which a student can
       never pass — this flag tells them the route guard already proved
       self-access. Set server-side only; a client cannot forge it. */
    req.selfReport = true;
    return next();
  } catch (err) {
    return res.status(500).json({ message: 'Failed to check report access', error: err.message });
  }
}
router.get('/:id/report', reportAccess, ctrl.studentReport);
router.get('/:id/chess-report', reportAccess, ctrl.studentChessReport);
router.get('/:id/puzzle/:puzzleId/report', reportAccess, ctrl.studentPuzzleReport);
router.get('/:id', ctrl.getStudent);
router.put('/:id', roleMiddleware('admin'), ctrl.updateStudent);
/* Send the registration confirmation again. An explicit admin action, so the
   result is reported back (sent / could not be sent). */
router.post('/:id/resend-registration-email', roleMiddleware('admin'), ctrl.resendRegistrationEmail);
/* Deletion is scoped to the coach's own students inside the controller
   (assertCoachAccess), so `admin` is safe here — not just `superadmin`. */
router.delete('/:id', roleMiddleware('admin'), ctrl.deleteStudent);

module.exports = router;
