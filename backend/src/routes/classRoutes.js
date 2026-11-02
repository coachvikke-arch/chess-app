const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/classController');
const liveCtrl = require('../controllers/liveClassController');
const onlineCtrl = require('../controllers/onlineController');
const drillCtrl = require('../controllers/puzzleDrillController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');

router.use(authMiddleware);
router.get('/', ctrl.listClasses);
router.get('/online', ctrl.listOnlineClasses);
router.get('/my-upcoming', ctrl.myUpcomingClasses);
router.get('/attendance/records', roleMiddleware('admin'), ctrl.getAttendanceRecords);
router.post('/', roleMiddleware('admin'), ctrl.createClass);
router.put('/:id', roleMiddleware('admin'), ctrl.updateClass);
router.delete('/:id', roleMiddleware('admin'), ctrl.deleteClass);
router.get('/:id/detail', roleMiddleware('admin'), ctrl.getClassDetail);
router.post('/:id/attendance', roleMiddleware('admin'), ctrl.markAttendance);
router.get('/:id/attendance', roleMiddleware('admin'), ctrl.getAttendanceForClass);

router.post('/:id/start', roleMiddleware('admin'), liveCtrl.startClass);
router.post('/:id/end', roleMiddleware('admin'), liveCtrl.endClass);
router.post('/:id/cancel', roleMiddleware('admin'), liveCtrl.cancelClass);
router.get('/:id/join-token', liveCtrl.getClassJoinToken);
router.post('/:id/join-external', liveCtrl.joinExternalClass);
router.get('/:id/chat', liveCtrl.listChat);
router.post('/:id/chat/clear', roleMiddleware('admin'), liveCtrl.clearChat);
router.get('/:id/participants', liveCtrl.listParticipants);
router.get('/:id/inviteable-students', liveCtrl.listInviteableStudents);
router.get('/:id/leaderboard', liveCtrl.getClassLeaderboard);
/* Student "watch classmates": the other students' boards for a student whose
   own game in this class has finished (gated in the controller). */
router.get('/:id/watch', onlineCtrl.watchClassmates);
/* Instructor switch: allow/deny students watching classmates. */
router.patch('/:id/spectate', roleMiddleware('admin'), liveCtrl.setSpectateEnabled);

router.get('/:id/puzzle-drill', drillCtrl.getDrill);
router.post('/:id/puzzle-drill/start', drillCtrl.startDrill);
router.post('/:id/puzzle-drill/end', drillCtrl.endDrill);
router.post('/:id/puzzle-drill/progress', drillCtrl.saveProgress);

module.exports = router;
