const db = require('../config/database');

function dayKey(d) {
  return d.toISOString().slice(0, 10);
}

function parseDay(s) {
  if (!s) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Daily-login streak: consecutive calendar days a user was active.
 * Returns { streak, lastLogin } where lastLogin is 'YYYY-MM-DD'.
 */
async function readLoginStreak(userId) {
  const r = await db.query(
    `SELECT login_streak, to_char(last_login, 'YYYY-MM-DD') AS last_login
     FROM users WHERE id = $1`,
    [userId]
  );
  const row = r.rows[0] || {};
  return { streak: Number(row.login_streak || 0), lastLogin: row.last_login || null };
}

/**
 * Record activity "today" for a user and grow/reset their login streak.
 * Idempotent per day — calling it twice the same day never double counts.
 */
async function touchLoginStreak(userId) {
  const today = dayKey(new Date());
  const { streak, lastLogin } = await readLoginStreak(userId);

  let next = streak;
  if (lastLogin !== today) {
    const last = parseDay(lastLogin);
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    next = last && last.toISOString().slice(0, 10) === dayKey(yesterday) ? streak + 1 : 1;
  }

  await db.query(
    `UPDATE users SET login_streak = $2, last_login = TO_DATE($3, 'YYYY-MM-DD'), updated_at = NOW()
     WHERE id = $1`,
    [userId, next, today]
  );

  return { streak: next, lastLogin: today };
}

async function getLoginStreak(userId) {
  return readLoginStreak(userId);
}

module.exports = { getLoginStreak, touchLoginStreak };