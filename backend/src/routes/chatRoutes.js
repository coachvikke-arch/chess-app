const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const ctrl = require('../controllers/chatController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');
const requireFeature = require('../middleware/requireFeature');

/* Every route below requires a signed-in user. Both students and admins/coaches
 * use the 1:1 messenger (student<->coach, student<->student), so the broad
 * guard is just "signed in" on top of whichever role the caller has. */
router.use(authMiddleware);

/* Messaging is one feature per role — the same surface, two different switches —
 * so the whole messenger is gated by whichever key matches the caller. */
router.use(requireFeature.requireFeatureByRole({
  student: 'messaging_coach',
  coach: 'messaging_students',
}));

/* Chat group attachments (WhatsApp-style images/files) land under
 * backend/uploads/chat/ and are served from /uploads/chat/... */
const storage = multer.diskStorage({
  destination: path.join(__dirname, '..', '..', 'uploads', 'chat'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
      'application/pdf',
      'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain',
    ];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('File type not allowed'), false);
  },
});

/* GET /api/chat/users?q=                searchable contact list w/ online+lastSeen */
router.get('/users', ctrl.listContacts);
router.get('/conversations', ctrl.listConversations);
router.get('/conversations/:otherId/messages', ctrl.getThread);
router.post('/conversations/:otherId/messages', upload.single('file'), ctrl.sendDirectMessage);
router.post('/conversations/:otherId/read', ctrl.markRead);
router.post('/reactions', ctrl.toggleReaction);
router.delete('/messages/:id', ctrl.deleteMessage);

/* Groups are read by any member; only admins/superadmins create or manage them. */
router.get('/groups', ctrl.listGroups);
router.post('/groups', roleMiddleware('admin'), ctrl.createGroup);
router.get('/groups/:id', ctrl.getGroup);
router.get('/groups/:id/messages', ctrl.getGroupMessages);
router.post('/groups/:id/messages', upload.single('file'), ctrl.sendGroupMessage);
router.post('/groups/:id/read', ctrl.markGroupRead);
router.post('/groups/:id/members', roleMiddleware('admin'), ctrl.addGroupMembers);
router.delete('/groups/:id/members/:userId', roleMiddleware('admin'), ctrl.removeGroupMember);
router.post('/groups/:id/avatar', roleMiddleware('admin'), upload.single('file'), ctrl.updateGroupAvatar);

module.exports = router;
