/** Shared role helpers — single source of truth for the role hierarchy.
 *  superadmin inherits every admin capability and additionally owns the
 *  account-registration console at /super. */
export function isAdminRole(role) {
  return role === 'admin' || role === 'superadmin';
}

/** The landing panel each role is redirected to after login or on a
 *  wrong-role visit.
 *  Super Admin lands on the Dashboard like everyone else — the account console
 *  at /super stays reachable from the sidebar, it is just no longer the
 *  post-login destination. */
export function homeForRole(role) {
  if (role === 'superadmin' || role === 'admin') return '/admin/dashboard';
  return '/student/dashboard';
}

export function isSuperAdmin(role) {
  return role === 'superadmin';
}