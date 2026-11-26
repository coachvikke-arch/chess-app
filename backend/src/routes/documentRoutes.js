const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { makeStorage, folderName } = require('../services/uploadService');
const ctrl = require('../controllers/documentController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');

const storage = makeStorage({
  destination: path.join(__dirname, '..', '..', 'uploads'),
  folder: `${folderName()}/documents`,
  prefix: 'document',
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (req, file, cb) => {
    const allowed = [
      'application/pdf',
      'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
      'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
    ];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('File type not allowed'), false);
  },
});

router.get('/', authMiddleware, ctrl.listDocuments);
router.post('/', authMiddleware, roleMiddleware('admin'), upload.single('file'), ctrl.uploadDocument);
router.delete('/:id', authMiddleware, roleMiddleware('admin'), ctrl.deleteDocument);

module.exports = router;