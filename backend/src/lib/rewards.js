const db = require('../config/database');

const REWARD_ID = 'intermediate-50-percent-reward';

function isAdmin(user) {
  return !!user && (user.role === 'admin' || user.role === 'superadmin');
}

async function resolveStudentId(userId) {
  const r = await db.query('SELECT id FROM students WHERE user_id = $1 LIMIT 1', [userId]);
  return r.rows[0]?.id || null;
}

async function hasUnlocked(studentId, rewardId = REWARD_ID) {
  const r = await db.query(
    'SELECT 1 FROM academy_reward_unlocks WHERE student_id = $1 AND reward_id = $2 LIMIT 1',
    [studentId, rewardId]
  );
  return r.rows.length > 0;
}

/**
 * Persist the milestone once. This function may be called after every real
 * progress save; the unique constraint makes repeated calls and concurrent
 * requests harmless.
 */
async function checkAndUnlockReward(studentId, level, progress) {
  if (level !== 'intermediate' || Number(progress) < 50) return false;
  const result = await db.query(
    `INSERT INTO academy_reward_unlocks (student_id, level_slug, reward_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (student_id, reward_id) DO NOTHING
     RETURNING id`,
    [studentId, level, REWARD_ID]
  );
  return result.rows.length > 0;
}

async function rewardStatus(user) {
  const unlockedByRole = isAdmin(user);
  const studentId = user ? await resolveStudentId(user.id) : null;
  const unlocked = unlockedByRole || (studentId ? await hasUnlocked(studentId) : false);
  return { rewardId: REWARD_ID, level: 'intermediate', threshold: 50, unlocked, unlockedByRole, unlockedAt: null };
}

async function checkAndUnlockForUser(userId, level, progress) {
  const studentId = await resolveStudentId(userId);
  return studentId ? checkAndUnlockReward(studentId, level, progress) : false;
}

module.exports = { REWARD_ID, isAdmin, hasUnlocked, checkAndUnlockReward, checkAndUnlockForUser, rewardStatus };
