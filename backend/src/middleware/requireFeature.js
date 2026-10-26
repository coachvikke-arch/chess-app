const { canAccess, isUngatedRole, toPermissionRole } = require('../services/permissionService');

/**
 * Server-side feature gate.
 *
 * Frontend hiding is a convenience only — this is the actual enforcement
 * point, so a user who crafts a request by hand still gets a 403.
 *
 *   router.get('/puzzles', requireFeature('puzzle_trainer'), ctrl.listPuzzles);
 *
 * Super Admin bypasses the check entirely so the control panel that governs
 * these switches can never lock its own owner out.
 */
function requireFeature(featureKey) {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'No token provided' });
    }
    if (isUngatedRole(req.user.role)) return next();

    try {
      const allowed = await canAccess(req.user, featureKey);
      if (!allowed) {
        return res.status(403).json({
          message: 'This feature is not enabled for your account.',
          feature: featureKey,
        });
      }
      return next();
    } catch (err) {
      // Fail closed: a broken permission lookup must not open the route.
      console.error(`[permissions] gate "${featureKey}" errored, denying:`, err.message);
      return res.status(403).json({ message: 'This feature is not enabled for your account.' });
    }
  };
}

/**
 * Role-aware gate for features that exist once per role — e.g. messaging is
 * "messaging_coach" for a student and "messaging_students" for a coach, but it
 * is the same /api/chat surface for both.
 *
 *   router.use(authMiddleware, requireFeatureByRole({
 *     student: 'messaging_coach', coach: 'messaging_students',
 *   }));
 */
function requireFeatureByRole(map) {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: 'No token provided' });
    if (isUngatedRole(req.user.role)) return next();

    /* The map is keyed in the PERMISSION vocabulary ('coach'), but
       req.user.role is in the APP vocabulary ('admin'). Looking up an unmapped
       app role fell through to map.student, so a coach was checked against the
       *student's* key — messaging_coach against the coach column, a pairing that
       appears nowhere in the admin UI. Every coach on every role-aware route
       therefore got a 403 no matter which switch they had enabled. Translating
       first is the fix; canAccess() does the same translation independently
       when it resolves the permission row. */
    const key = map[toPermissionRole(req.user.role)] ?? map.student;
    if (!key) return res.status(403).json({ message: 'This feature is not enabled for your account.' });

    try {
      const allowed = await canAccess(req.user, key);
      if (!allowed) {
        return res.status(403).json({
          message: 'This feature is not enabled for your account.',
          feature: key,
        });
      }
      return next();
    } catch (err) {
      console.error(`[permissions] gate "${key}" errored, denying:`, err.message);
      return res.status(403).json({ message: 'This feature is not enabled for your account.' });
    }
  };
}

module.exports = requireFeature;
module.exports.requireFeature = requireFeature;
module.exports.requireFeatureByRole = requireFeatureByRole;
