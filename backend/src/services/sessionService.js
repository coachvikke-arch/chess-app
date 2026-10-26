const crypto = require('crypto');
const db = require('../config/database');

/* ── Concurrent-device session cap ───────────────────────────────────────────
 *
 * Every sign-in binds the JWT to a row in `user_sessions`. At most
 * MAX_ACTIVE_SESSIONS may be active per user; a sign-in on a THIRD device
 * revokes the oldest, and `authMiddleware` then rejects the revoked device's
 * token with code SESSION_REVOKED. The client turns that into a forced logout
 * with the message below.
 *
 * All state lives in Postgres (not memory) so the cap holds across restarts and
 * across multiple app instances behind a load balancer.
 */
const MAX_ACTIVE_SESSIONS = 2;

const SESSION_REVOKED_CODE = 'SESSION_REVOKED';
const SESSION_REVOKED_MESSAGE =
  'You were logged out because your account was used on another device.';

/** Only a digest of the refresh token is ever stored. */
function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function generateRefreshToken() {
  return crypto.randomBytes(48).toString('base64url');
}

async function withTransaction(fn) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

/** A user's live sessions, oldest first (so [0] is the one to drop at cap). */
async function listActiveSessions(userId, client = db) {
  const { rows } = await client.query(
    `SELECT id, device_id, device_name, platform, created_at, last_active_at
       FROM user_sessions
      WHERE user_id = $1 AND revoked_at IS NULL
      ORDER BY created_at ASC`,
    [userId]
  );
  return rows;
}

/** The active session bound to a device, if any (drives reuse-on-relogin). */
async function findActiveByDevice(userId, deviceId, client = db) {
  if (!deviceId) return null;
  const { rows } = await client.query(
    `SELECT * FROM user_sessions
      WHERE user_id = $1 AND device_id = $2 AND revoked_at IS NULL
      ORDER BY created_at DESC LIMIT 1`,
    [userId, deviceId]
  );
  return rows[0] || null;
}

async function findById(sessionId, client = db) {
  const { rows } = await client.query('SELECT * FROM user_sessions WHERE id = $1', [sessionId]);
  return rows[0] || null;
}

async function findByRefreshToken(refreshToken) {
  if (!refreshToken) return null;
  const { rows } = await db.query(
    `SELECT * FROM user_sessions
      WHERE refresh_token_hash = $1 AND revoked_at IS NULL LIMIT 1`,
    [hashToken(refreshToken)]
  );
  return rows[0] || null;
}

/** True while the session is live (not revoked). A missing row is NOT active. */
async function isSessionActive(sessionId, userId = null) {
  const { rows } = await db.query(
    `SELECT 1 FROM user_sessions
      WHERE id = $1 AND revoked_at IS NULL
        AND ($2::int IS NULL OR user_id = $2)
      LIMIT 1`,
    [sessionId, userId ?? null]
  );
  return rows.length > 0;
}

async function touchSession(sessionId) {
  await db.query('UPDATE user_sessions SET last_active_at = NOW() WHERE id = $1', [sessionId]);
}

/** Mint and store a fresh refresh token for an existing live session. */
async function rotateRefreshToken(sessionId) {
  const refreshToken = generateRefreshToken();
  await db.query(
    `UPDATE user_sessions
        SET refresh_token_hash = $1, last_active_at = NOW()
      WHERE id = $2 AND revoked_at IS NULL`,
    [hashToken(refreshToken), sessionId]
  );
  return { refreshToken };
}

/* `last_active_at` only needs minute resolution, so a request-per-write update
 * would be pointless load. This throttles writes to once per session/minute. */
const touchGate = new Map(); // sessionId -> last write ms
function touchSessionThrottled(sessionId, everyMs = 60_000) {
  const now = Date.now();
  if (now - (touchGate.get(sessionId) || 0) < everyMs) return;
  touchGate.set(sessionId, now);
  touchSession(sessionId).catch(() => { /* best-effort */ });
}

async function revokeSession(sessionId) {
  if (!sessionId) return 0;
  const { rowCount } = await db.query(
    'UPDATE user_sessions SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL',
    [sessionId]
  );
  return rowCount;
}

/** Revoke every live session for a user (optionally sparing the current one).
 *  Returns the revoked ids so callers can push a `session_revoked` event. */
async function revokeAllSessions(userId, { exceptSessionId = null } = {}) {
  const { rows } = await db.query(
    `UPDATE user_sessions
        SET revoked_at = NOW()
      WHERE user_id = $1 AND revoked_at IS NULL
        AND ($2::int IS NULL OR id <> $2)
      RETURNING id`,
    [userId, exceptSessionId ?? null]
  );
  return rows.map((r) => r.id);
}

/**
 * Open a session for a device while enforcing the concurrent-device cap.
 *
 * Runs inside a transaction and locks the user's row (`SELECT ... FOR UPDATE`)
 * so two simultaneous sign-ins for the same user cannot both observe "room for
 * another session" and slip a third past the cap.
 *
 *   · same device_id already active → reuse it (no new session, no eviction)
 *   · otherwise, if the cap is reached → revoke the oldest session(s)
 *   · insert the new session
 *
 * Returns { session, reused, revoked: [ids], refreshToken }.
 */
async function createSession({
  userId,
  deviceId = null,
  deviceName = null,
  platform = null,
}) {
  const refreshToken = generateRefreshToken();
  const refreshTokenHash = hashToken(refreshToken);

  const result = await withTransaction(async (client) => {
    // Serialise concurrent logins for this user.
    await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);

    if (deviceId) {
      const existing = await findActiveByDevice(userId, deviceId, client);
      if (existing) {
        const { rows } = await client.query(
          `UPDATE user_sessions
              SET last_active_at = NOW(),
                  device_name = COALESCE($2, device_name),
                  platform = COALESCE($3, platform),
                  refresh_token_hash = $4
            WHERE id = $1
            RETURNING *`,
          [existing.id, deviceName, platform, refreshTokenHash]
        );
        return { session: rows[0], reused: true, revoked: [] };
      }
    }

    const active = await listActiveSessions(userId, client);
    const revoked = [];
    // Free exactly enough slots for the incoming session to fit under the cap.
    const excess = active.length - MAX_ACTIVE_SESSIONS + 1;
    for (const row of active.slice(0, Math.max(0, excess))) {
      const upd = await client.query(
        `UPDATE user_sessions SET revoked_at = NOW()
          WHERE id = $1 AND revoked_at IS NULL RETURNING id`,
        [row.id]
      );
      if (upd.rows[0]) revoked.push(upd.rows[0].id);
    }

    const { rows } = await client.query(
      `INSERT INTO user_sessions
         (user_id, device_id, device_name, platform, refresh_token_hash, last_active_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       RETURNING *`,
      [userId, deviceId, deviceName, platform, refreshTokenHash]
    );
    return { session: rows[0], reused: false, revoked };
  });

  return { ...result, refreshToken };
}

/**
 * Optional real-time push: tell each revoked device to log out immediately.
 * Only the specific socket(s) that joined `session:<id>` are targeted, so a
 * user's OTHER devices stay signed in.
 */
function notifyRevoked(io, sessionIds, reason = 'revoked') {
  if (!io || !Array.isArray(sessionIds)) return;
  for (const sid of sessionIds) {
    io.to(`session:${sid}`).emit('session_revoked', {
      code: SESSION_REVOKED_CODE,
      message: SESSION_REVOKED_MESSAGE,
      reason,
      at: Date.now(),
    });
  }
}

module.exports = {
  MAX_ACTIVE_SESSIONS,
  SESSION_REVOKED_CODE,
  SESSION_REVOKED_MESSAGE,
  hashToken,
  generateRefreshToken,
  listActiveSessions,
  findActiveByDevice,
  findById,
  findByRefreshToken,
  isSessionActive,
  touchSession,
  rotateRefreshToken,
  touchSessionThrottled,
  revokeSession,
  revokeAllSessions,
  createSession,
  notifyRevoked,
};
