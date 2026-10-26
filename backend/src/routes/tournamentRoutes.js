const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/tournamentController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');

router.use(authMiddleware);

const admin = roleMiddleware('admin');   // superadmin inherits
const student = roleMiddleware('student');

/* Fixed paths first so they are never swallowed by /:id */
router.get('/', ctrl.list);
router.post('/', admin, ctrl.create);
router.get('/students', admin, ctrl.studentPool);
router.post('/pairings/:pairingId/result', admin, ctrl.setResult);

router.get('/:id', ctrl.get);
router.put('/:id', admin, ctrl.update);
router.delete('/:id', admin, ctrl.remove);
router.get('/:id/report', ctrl.report);
router.patch('/:id/status', admin, ctrl.setStatus);
router.post('/:id/generate-pairings', admin, ctrl.generatePairings);
router.post('/:id/add-players', admin, ctrl.addPlayers);
router.delete('/:id/players/:userId', admin, ctrl.removePlayer);
router.post('/:id/pairings/:pairingId/result', admin, ctrl.setResult);
router.post('/:id/manual-pairing', admin, ctrl.manualPairing);
router.get('/:id/audit', admin, ctrl.audit);

router.post('/:id/join', student, ctrl.join);
router.post('/:id/leave', student, ctrl.leave);
router.post('/:id/arena/pause', student, ctrl.arenaPause);
router.post('/:id/arena/resume', student, ctrl.arenaResume);

module.exports = router;
