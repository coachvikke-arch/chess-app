const express = require('express');
const router = express.Router();
const multer = require('multer');
const ctrl = require('../controllers/gmGameController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');
const requireFeature = require('../middleware/requireFeature');

router.use(authMiddleware);
/* Feature Access gate: the whole GM Games library is controlled by the
   `gm_games` switch. Super Admin bypasses it, so the panel that owns the
   switch can never lock itself out. */
router.use(requireFeature('gm_games'));

router.get('/players', ctrl.getPlayers);
router.get('/', ctrl.listImported);
router.get('/:id', ctrl.getOne);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 50 },
});

router.post('/import', roleMiddleware('admin'), ctrl.importBulk);
router.post('/import/files', roleMiddleware('admin'), upload.array('files', 50), ctrl.importBulkFiles);
router.post('/import/player', roleMiddleware('admin'), ctrl.importPlayerGames);
/* Declared BEFORE '/:id' — Express matches in order, so a later '/:id' route
   would otherwise capture "/import/player" and try to delete a game whose id is
   the literal string "import". */
router.delete('/import/player', roleMiddleware('admin'), ctrl.removePlayerGames);
router.delete('/:id', roleMiddleware('admin'), ctrl.removeOne);

module.exports = router;