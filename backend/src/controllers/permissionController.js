const service = require('../services/permissionService');

/** Wrap an async handler so a rejected promise reaches the error middleware. */
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* ── self-service ──────────────────────────────────────────────────────────── */

/** The signed-in user's enabled features. Drives the whole frontend gating. */
exports.getMyFeatures = wrap(async (req, res) => {
  const features = await service.getEnabledFeaturesForUser(req.user);
  res.json({
    features,
    role: req.user.role,
    /* Tells the client it may render everything without a per-key lookup. */
    ungated: service.isUngatedRole(req.user.role),
  });
});

/* ── registry ──────────────────────────────────────────────────────────────── */

exports.listFeatures = wrap(async (req, res) => {
  res.json(await service.listFeaturesWithPermissions());
});

/** Body: { role: 'student' | 'coach' | 'admin', isEnabled: boolean }
 *
 *  Two states only: true = on, false = off. null is rejected rather than
 *  coerced, because the "inherit" state it used to mean resolved to Off anyway
 *  — accepting it would let a caller store a value that reads as one thing in
 *  the API and another in the grid. */
exports.setFeature = wrap(async (req, res) => {
  const { key } = req.params;
  const { role, isEnabled } = req.body || {};

  if (typeof isEnabled !== 'boolean') {
    return res.status(400).json({ message: 'isEnabled must be true or false' });
  }
  if (!service.GATED_ROLES.has(service.toPermissionRole(role))) {
    return res.status(400).json({ message: 'role must be student or coach' });
  }

  const changed = await service.setRolePermission(key, role, isEnabled, req.user.id);
  res.json({ ok: true, key, role, isEnabled, changed });
});

/** Body: { role, isEnabled, category? } — applies to every feature.
 *  `role` picks which column is affected; Student and Coach are always set
 *  separately, so a bulk call can never touch the other role's switches. */
exports.bulkSet = wrap(async (req, res) => {
  const { role, isEnabled, category } = req.body || {};

  if (typeof isEnabled !== 'boolean') {
    return res.status(400).json({ message: 'isEnabled must be a boolean for bulk actions' });
  }
  if (!service.GATED_ROLES.has(service.toPermissionRole(role))) {
    return res.status(400).json({ message: 'role must be student or coach' });
  }

  const result = await service.bulkSetRolePermission(role, isEnabled, req.user.id, { category });
  res.json({ ok: true, ...result });
});

/* ── per-user overrides ────────────────────────────────────────────────────── */

/** Search students and coaches for the per-user override picker. */
exports.searchUsers = wrap(async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  res.json(await service.searchUsers(q, { limit: req.query.limit }));
});

exports.getUserPermissions = wrap(async (req, res) => {
  const data = await service.getUserEffectivePermissions(req.params.userId);
  if (!data) return res.status(404).json({ message: 'User not found' });
  res.json(data);
});

/** Body: { isEnabled: boolean | null } — null clears the override. */
exports.setUserOverride = wrap(async (req, res) => {
  const { userId, key } = req.params;
  const { isEnabled } = req.body || {};

  if (isEnabled !== null && typeof isEnabled !== 'boolean') {
    return res.status(400).json({ message: 'isEnabled must be a boolean or null' });
  }

  const changed = await service.setUserOverride(userId, key, isEnabled, req.user.id);
  res.json({ ok: true, userId, key, isEnabled, changed });
});

/* ── audit ─────────────────────────────────────────────────────────────────── */

exports.listAudit = wrap(async (req, res) => {
  res.json(await service.listAuditLog({ limit: req.query.limit }));
});
