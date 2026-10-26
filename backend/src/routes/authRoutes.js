const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const auth = require('../controllers/authController');
const authMiddleware = require('../middleware/authMiddleware');
const { loginLimiter, resetLimiter } = require('../middleware/rateLimits');

const storage = multer.diskStorage({
  destination: path.join(__dirname, '..', '..', 'uploads'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `avatar-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files are allowed (jpg, png, gif, webp)'), false);
  },
});

router.post('/register', auth.register);
router.patch('/me/password', auth.changeMyPassword);
// NOTE: there is deliberately NO public signup route.
// Accounts are created only by an admin through POST /auth/register, which
// `auth.register` gates behind authMiddleware + roleMiddleware('superadmin').
// The old POST /auth/signup was reachable by anyone, unauthenticated, and
// created a ready-to-use student account — so removing only the frontend page
// would have left the hole wide open.
router.post('/login', loginLimiter, auth.login);
router.post('/refresh', loginLimiter, auth.refresh);
router.post('/reset-password', resetLimiter, auth.resetPassword);
// Logout is session-aware now: it revokes the session row so the device slot is
// freed immediately. It needs the token, hence authMiddleware.
router.post('/logout', authMiddleware, auth.logout);
router.post('/logout-all', authMiddleware, auth.logoutAll);
router.get('/me', authMiddleware, auth.me);
router.patch('/me', authMiddleware, auth.updatePreferences);
router.post('/me/photo', authMiddleware, upload.single('photo'), auth.uploadPhoto);
router.delete('/me/photo', authMiddleware, auth.removePhoto);
router.patch('/me/avatar', authMiddleware, auth.updateMyAvatar);
router.delete('/me/avatar', authMiddleware, auth.resetMyAvatar);

module.exports = router;
