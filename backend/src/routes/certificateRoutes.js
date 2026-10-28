const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/certificateController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');

/**
 * Certificates.
 *
 * The SELF-SERVICE routes come first and are deliberately NOT behind the
 * superadmin gate below:
 *   GET /template  the preview artwork (identical for every certificate, no
 *                  student data in it — the per-student part is the field values)
 *   GET /me        the signed-in student's OWN certificates, resolved from the
 *                  session so no id can be swapped for another student's
 *
 * Everything after the gate — issuing, sending, settings and the per-student
 * admin view — is an academy-owner action, not a student or coach decision.
 * Mounting the gate with router.use() means no later route can be added without
 * it.
 */
router.use(authMiddleware);

/* Order matters: literal paths must come before the /:id parameterised routes,
   or Express would swallow them as an id. */
router.get('/template', ctrl.template);
router.get('/me', ctrl.listMine);

/* ── Everything below is Super Admin only. ── */
router.use(roleMiddleware('superadmin'));

router.get('/settings', ctrl.getSettings);
router.put('/settings', ctrl.saveSettings);
router.post('/issue', ctrl.issue);

router.get('/students', ctrl.listStudents);
router.get('/students/:studentId', ctrl.listStudentCertificates);
router.get('/', ctrl.list);

router.post('/:id/generate', ctrl.generate);
router.patch('/:id/sent', ctrl.markSent);
router.post('/:id/mark-sent', ctrl.markSent);

/* Last, so every literal path above is matched first. */
router.get('/:id', ctrl.getOne);

module.exports = router;
