const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/miscController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');
const requireFeature = require('../middleware/requireFeature');

router.use(authMiddleware);

router.get('/groups', ctrl.listGroups);
router.post('/groups', roleMiddleware('admin'), ctrl.createGroup);
router.post('/groups/assign', roleMiddleware('admin'), ctrl.assignStudentToGroup);
router.put('/groups/:id', roleMiddleware('admin'), ctrl.updateGroup);
router.delete('/groups/:id', roleMiddleware('admin'), ctrl.deleteGroup);

router.get('/announcements', requireFeature('notifications'), ctrl.listAnnouncements);
router.post('/announcements', roleMiddleware('admin'), ctrl.createAnnouncement);
router.delete('/announcements/:id', roleMiddleware('admin'), ctrl.deleteAnnouncement);

router.get('/notifications', ctrl.listNotifications);
router.get('/notifications/unread-count', ctrl.unreadNotificationsCount);
router.put('/notifications/:id/read', ctrl.markNotificationRead);
router.put('/notifications/read-all', ctrl.markAllNotificationsRead);
router.delete('/notifications', ctrl.clearNotifications);

router.get('/achievements', ctrl.listAchievements);
router.get('/achievements/me', roleMiddleware('student'), ctrl.studentAchievements);

router.get('/worklist', roleMiddleware('admin'), ctrl.worklist);
router.get('/worklist/puzzles', roleMiddleware('admin'), ctrl.worklistPuzzles);

router.post('/game-analysis/analyze', ctrl.analyzeGame);
router.post('/game-analysis', roleMiddleware('student'), ctrl.submitGame);
router.get('/game-analysis', roleMiddleware('admin'), ctrl.listGameAnalyses);
router.put('/game-analysis/:id/feedback', roleMiddleware('admin'), ctrl.giveGameFeedback);

module.exports = router;
