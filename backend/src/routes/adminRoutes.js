const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/adminController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');

router.use(authMiddleware);

/* A coach edits their own basic details from "My Profile", so this one write
   must be reachable without the super-admin gate below. Everyone else still
   needs super admin. */
router.put('/:id', (req, res, next) => {
  if (req.user?.role === 'superadmin' || String(req.user?.id) === String(req.params.id)) return next();
  return res.status(403).json({ message: 'You can only edit your own account' });
}, ctrl.updateAdmin);

router.use(roleMiddleware('superadmin'));

/* Declared before the `/:id` routes so the literal path can never be swallowed
   by a param route — `GET /accounts` would otherwise match `GET /:id` with
   id="accounts". Same reason as /openings/library below. */
router.get('/openings/library', ctrl.listOpeningsLibrary);

/* ── Super Admin platform analytics ─────────────────────────────────────────
   Platform-wide overview, growth, academy comparison, activity analytics,
   system health and recent audit activity. All superadmin-only. */
router.get('/platform/overview', ctrl.platformOverview);
router.get('/platform/growth', ctrl.platformGrowth);
router.get('/platform/academies', ctrl.platformAcademies);
router.get('/platform/activity', ctrl.platformActivity);
router.get('/platform/health', ctrl.platformHealth);

/* Password help. These are superadmin-only because the whole router already is
   (line 8), and they expose no password material — they mint one-time reset
   codes so a locked-out user can choose their own new password. */
router.get('/accounts', ctrl.listAccounts);
router.post('/:id/recovery-code', ctrl.issueRecoveryCode);
router.delete('/:id/recovery-code', ctrl.revokeRecoveryCode);
/* Direct password set by superadmin — the ONLY way to fix a forgotten
   password without a recovery code. Plaintext passwords can never be
   "viewed" (bcrypt is one-way), so this mints a brand-new one. */
router.post('/:id/reset-password', ctrl.resetUserPassword);

router.get('/', ctrl.listAdmins);
router.get('/:id/students', ctrl.listAdminStudents);
router.get('/:id/report', ctrl.adminReport);
router.get('/:id/performance', ctrl.performanceReport);
router.get('/:id', ctrl.getAdmin);
router.delete('/:id', ctrl.deleteAdmin);

module.exports = router;