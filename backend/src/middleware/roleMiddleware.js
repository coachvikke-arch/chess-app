/* Role hierarchy:
     superadmin  → academy owner. May do everything an admin can AND may use the
                   superadmin-only endpoints (e.g. POST /auth/register).
     admin       → coach-level staff.
     student     → learner.                                              */
function isAdminRole(role) {
  return role === 'admin' || role === 'superadmin';
}

function roleMiddleware(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(403).json({ message: 'Forbidden: insufficient permissions' });
    }
    // A superadmin inherits every privilege granted to 'admin'.
    const granted =
      allowedRoles.includes(req.user.role) ||
      (allowedRoles.includes('admin') && req.user.role === 'superadmin');
    if (!granted) {
      return res.status(403).json({ message: 'Forbidden: insufficient permissions' });
    }
    next();
  };
}

module.exports = roleMiddleware;
module.exports.isAdminRole = isAdminRole;
