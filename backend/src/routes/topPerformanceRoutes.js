const express = require('express');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const ctrl = require('../controllers/topPerformanceController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');

const router = express.Router();

const storage = multer.diskStorage({
  destination: path.join(__dirname, '..', '..', 'uploads'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `performance-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB, same as avatars
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files are allowed (jpg, png, gif, webp)'), false);
  },
});

/* Multer rejections (wrong type, over size) would otherwise surface as an
   HTML 500 from Express' default handler - translate them to JSON 400s the
   upload form can actually display. */
function uploadOne(req, res, next) {
  upload.single('photo')(req, res, (err) => {
    if (err) return res.status(400).json({ message: err.message || 'Photo upload failed' });
    return next();
  });
}

router.use(authMiddleware);
router.get('/', ctrl.list);
/* roleMiddleware('admin') admits coaches AND the Super Admin (inheritance). */
router.post('/', roleMiddleware('admin'), uploadOne, ctrl.create);
router.delete('/:id', roleMiddleware('admin'), ctrl.remove);

module.exports = router;
