const db = require('../config/database');

/* ── role mapping ────────────────────────────────────────────────────────────
   This app's user roles are 'superadmin' | 'admin' | 'student'; coaches are
   stored as 'admin'. The permission tables use the spec's 'student' | 'coach'
   vocabulary, so we translate at this one boundary rather than leaking the
   mismatch into every query. */
const GATED_ROLES = new Set(['student', 'coach']);

/* role_permissions.is_enabled is a plain boolean: TRUE = on, FALSE = off.

   This was tri-state at one point (NULL = "inherit"), and that is gone. Inherit
   resolved to the same thing as Off — the platform default is Off for everything
   — so it was a state that looked meaningful in the admin grid and granted
   nothing. Worse, any draft that resolved Inherit to TRUE for a role's own
   category failed OPEN: a feature shipped without a row, or a row deleted by
   mistake, handed out access. Two explicit states cannot express that mistake.

The column is NOT NULL again (see migrations/remove_permission_inherit_state.sql)
   and setRolePermission rejects null, so NULL is unreachable at every layer. The
   COALESCE(..., FALSE) in the reads below is belt-and-braces against a row that
   predates the NOT NULL constraint, not a live third state. */

function toPermissionRole(role) {
  if (role === 'admin') return 'coach';
  return role;
}

/** Super Admin is never gated — that is what prevents an accidental lockout. */
function isUngatedRole(role) {
  return role === 'superadmin';
}

/**
 * Resolve the set of feature keys a user may access.
 *
* Resolution order per feature:
 *   1. user override, if one exists  (wins outright)
*   2. role permission for their role
 *   3. false                          (fail-closed, also covers a missing row)
 *
 * Unknown users and ungated roles get everything: there is nothing to gate.
 * A database failure resolves to "no features" rather than throwing, so a
 * permissions outage can never accidentally open the app up.
 */
async function getEnabledFeaturesForUser(user) {
  if (!user || !user.id) return [];
  if (isUngatedRole(user.role)) return ['*'];

  const role = toPermissionRole(user.role);
  if (!GATED_ROLES.has(role)) return [];

  try {
/* LEFT JOIN, not an inner join filtered on is_enabled: an inner join would
       drop every feature the role has switched OFF before the override could
       grant it back, so a per-user grant on a role-disabled feature would be
       silently ignored. The COALESCE does the real resolution, and its trailing
       FALSE is what denies a feature with no override and no switch row. */
    const { rows } = await db.query(
      `SELECT f.key
         FROM features f
     LEFT JOIN role_permissions rp
            ON rp.feature_id = f.id AND rp.role = $2
     LEFT JOIN user_permission_overrides upo
            ON upo.feature_id = f.id AND upo.user_id = $1
        WHERE COALESCE(upo.is_enabled, rp.is_enabled, FALSE) = TRUE
        ORDER BY f.key`,
      [user.id, role],
    );
    return rows.map((r) => r.key);
  } catch (err) {
    console.error('[permissions] resolution failed, denying all features:', err.message);
    return [];
  }
}

/** Single-feature check — the form used by requireFeature(). */
async function canAccess(user, featureKey) {
  if (!user || !user.id) return false;
  if (isUngatedRole(user.role)) return true;

  const role = toPermissionRole(user.role);
  if (!GATED_ROLES.has(role)) return false;

  try {
    /* LEFT JOIN for the same reason as getEnabledFeaturesForUser: a feature the
       role has off must still be resolvable, because a user override may
       grant it back. */
const { rows } = await db.query(
      `SELECT COALESCE(upo.is_enabled, rp.is_enabled, FALSE) AS enabled
         FROM features f
     LEFT JOIN role_permissions rp ON rp.feature_id = f.id AND rp.role = $2
     LEFT JOIN user_permission_overrides upo
            ON upo.feature_id = f.id AND upo.user_id = $1
        WHERE f.key = $3`,
      [user.id, role, featureKey],
    );
    /* No row at all means the feature is not registered or has no switch —
       treat as denied (fail-closed). */
    return rows.length > 0 && rows[0].enabled === true;
  } catch (err) {
    console.error(`[permissions] check for "${featureKey}" failed, denying:`, err.message);
    return false;
  }
}


/* -- admin writes ---------------------------------------------------------- */

/**
 * Set a role-level switch and record the change in the audit trail.
 * isEnabled is boolean: true = on, false = off. null is rejected, not coerced.
 * Returns false when the value is unchanged, so no redundant audit row is written.
 */
async function setRolePermission(featureKey, role, isEnabled, updatedBy) {
  const permRole = toPermissionRole(role);
  if (!GATED_ROLES.has(permRole)) throw new Error(`Unsupported role: ${role}`);
  if (typeof isEnabled !== 'boolean') {
    throw new Error('isEnabled must be a boolean');
  }

  const { rows: fRows } = await db.query('SELECT id FROM features WHERE key = $1', [featureKey]);
  if (!fRows.length) throw new Error(`Unknown feature: ${featureKey}`);
  const featureId = fRows[0].id;

  const { rows: before } = await db.query(
    'SELECT is_enabled FROM role_permissions WHERE feature_id = $1 AND role = $2',
    [featureId, permRole],
  );
  /* A NULL can no longer exist here (NOT NULL), but normalise before comparing
     so a pre-migration row is still corrected by an explicit Off rather than
     reporting a false "no change" on the first click. */
  const oldValue = before.length ? before[0].is_enabled : null;
  if (before.length && (oldValue ?? false) === isEnabled) return false;

  await db.query(
    `INSERT INTO role_permissions (feature_id, role, is_enabled, updated_by, updated_at)
          VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (feature_id, role)
     DO UPDATE SET is_enabled = EXCLUDED.is_enabled,
                   updated_by  = EXCLUDED.updated_by,
                   updated_at  = NOW()`,
    [featureId, permRole, isEnabled, updatedBy ?? null],
  );

  await db.query(
    `INSERT INTO feature_permission_audit
       (feature_id, feature_key, scope, role, old_value, new_value, updated_by)
     VALUES ($1, $2, 'role', $3, $4, $5, $6)`,
    [featureId, featureKey, permRole, oldValue, isEnabled, updatedBy ?? null],
  );
  return true;
}

/** Bulk switch: apply one value to every feature, optionally within a category. */
async function bulkSetRolePermission(role, isEnabled, updatedBy, { category } = {}) {
  const permRole = toPermissionRole(role);
  if (!GATED_ROLES.has(permRole)) throw new Error(`Unsupported role: ${role}`);

  const { rows: features } = category
    ? await db.query('SELECT id, key FROM features WHERE category = $1 ORDER BY sort_order', [category])
    : await db.query('SELECT id, key FROM features ORDER BY sort_order');

  let changed = 0;
  for (const feat of features) {
    /* Sequential on purpose: each call writes its own audit row, and the
       feature count is small (tens), so a transaction is not warranted. */
    // eslint-disable-next-line no-await-in-loop
    if (await setRolePermission(feat.key, permRole, isEnabled, updatedBy)) changed += 1;
  }
  return { changed, total: features.length };
}

/** Per-user override. Pass null for isEnabled to clear the override. */
async function setUserOverride(userId, featureKey, isEnabled, updatedBy) {
  const { rows: fRows } = await db.query('SELECT id FROM features WHERE key = $1', [featureKey]);
  if (!fRows.length) throw new Error(`Unknown feature: ${featureKey}`);
  const featureId = fRows[0].id;

  const { rows: before } = await db.query(
    'SELECT is_enabled FROM user_permission_overrides WHERE user_id = $1 AND feature_id = $2',
    [userId, featureId],
  );
  const oldValue = before.length ? before[0].is_enabled : null;

  if (isEnabled === null) {
    if (!before.length) return false;
    await db.query('DELETE FROM user_permission_overrides WHERE user_id = $1 AND feature_id = $2', [userId, featureId]);
  } else {
    if (before.length && oldValue === isEnabled) return false;
    await db.query(
      `INSERT INTO user_permission_overrides (user_id, feature_id, is_enabled, updated_by, updated_at)
            VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (user_id, feature_id)
       DO UPDATE SET is_enabled = EXCLUDED.is_enabled,
                     updated_by  = EXCLUDED.updated_by,
                     updated_at  = NOW()`,
      [userId, featureId, isEnabled, updatedBy ?? null],
    );
  }

  await db.query(
    `INSERT INTO feature_permission_audit
       (feature_id, feature_key, scope, target_user_id, old_value, new_value, updated_by)
     VALUES ($1, $2, 'user', $3, $4, $5, $6)`,
    [featureId, featureKey, userId, oldValue, isEnabled, updatedBy ?? null],
  );
  return true;
}

/* -- reads ---------------------------------------------------------------- */

/** The full registry with both role switches, for the admin grid.
 *
* The two role columns are always both returned — the admin grid edits Student
 * and Coach side by side rather than one role at a time.
 *
 * Each column is COALESCEd to FALSE so the grid always receives a strict
 * boolean. Any NULL left over from the tri-state era reads as Off, which is
 * what the resolution queries already do with it. */
async function listFeaturesWithPermissions() {
  const { rows } = await db.query(
    `SELECT f.id, f.key, f.name, f.description, f.category, f.route, f.sort_order,
            COALESCE(rs.is_enabled, FALSE) AS student_enabled,
            COALESCE(rc.is_enabled, FALSE) AS coach_enabled,
             rs.updated_at AS student_updated_at,
            rc.updated_at AS coach_updated_at
       FROM features f
  LEFT JOIN role_permissions rs ON rs.feature_id = f.id AND rs.role = 'student'
  LEFT JOIN role_permissions rc ON rc.feature_id = f.id AND rc.role = 'coach'
      ORDER BY f.category, f.sort_order, f.name`,
  );
  return rows;
}

/** One user's effective access: the role default, overridden per feature. */
async function getUserEffectivePermissions(userId) {
  const { rows: uRows } = await db.query('SELECT id, name, role FROM users WHERE id = $1', [userId]);
  if (!uRows.length) return null;
  const user = uRows[0];
  const role = toPermissionRole(user.role);
  const ungated = isUngatedRole(user.role);

  const { rows } = await db.query(
    `SELECT f.id, f.key, f.name, f.description, f.category, f.route,
COALESCE(upo.is_enabled, rp.is_enabled, FALSE) AS effective,
             COALESCE(rp.is_enabled, FALSE)                             AS role_default,
             upo.is_enabled                                            AS override_value
       FROM features f
  LEFT JOIN role_permissions rp ON rp.feature_id = f.id AND rp.role = $2
  LEFT JOIN user_permission_overrides upo
         ON upo.feature_id = f.id AND upo.user_id = $1
      ORDER BY f.category, f.sort_order, f.name`,
    [userId, role],
  );

  return {
    user: { id: user.id, name: user.name, role: user.role, permissionRole: role },
    ungated,
    features: rows.map((r) => ({ ...r, effective: ungated ? true : r.effective === true })),
  };
}

async function listAuditLog({ limit = 100 } = {}) {
  const { rows } = await db.query(
    `SELECT a.*, u.name AS updated_by_name
       FROM feature_permission_audit a
  LEFT JOIN users u ON u.id = a.updated_by
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT $1`,
    [Math.min(Number(limit) || 100, 500)],
  );
  return rows;
}

/**
 * Search students and coaches by name or email, for the per-user overrides
 * picker. Super Admin only (the route enforces that).
 *
 * Returns just what the picker needs: id, name, email, role and the student's
 * display name when they have one.
 */
async function searchUsers(term, { limit = 20 } = {}) {
  const q = String(term || '').trim();
  if (q.length < 2) return [];
  const { rows } = await db.query(
    `SELECT u.id, u.name, u.email, u.role,
            COALESCE(s.nickname, NULL) AS nickname
       FROM users u
  LEFT JOIN students s ON s.user_id = u.id
      WHERE u.role IN ('student', 'admin')
        AND (u.name ILIKE $1 OR u.email ILIKE $1 OR s.nickname ILIKE $1)
      ORDER BY
        -- exact-ish name matches first, then alphabetical
        CASE WHEN lower(u.name) = lower($2) THEN 0 ELSE 1 END,
        u.name
      LIMIT $3`,
    [`%${q}%`, q, Math.min(Number(limit) || 20, 50)],
  );
  return rows;
}

module.exports = {
  GATED_ROLES,
  toPermissionRole,
  isUngatedRole,
  canAccess,
  getEnabledFeaturesForUser,
  setRolePermission,
  bulkSetRolePermission,
  setUserOverride,
  listFeaturesWithPermissions,
  getUserEffectivePermissions,
  listAuditLog,
  searchUsers,
};

