const db = require('../config/database');
const ratingService = require('../services/ratingService');
const { TIME_CLASSES, TIME_CLASS_META, timeClassLabel } = ratingService;
const unifiedProfileService = require('../services/unifiedProfileService');
const statisticsService = require('../services/statisticsService');
const openingService = require('../services/openingService');
const insightsService = require('../services/insightsService');
const gameHistoryCtrl = require('./gameHistoryController');
const { touchLoginStreak } = require('../services/streakService');
const mailService = require('../services/mailService');
const { isRecentlyMailed, markMailed, buildLoginUrl } = mailService;
const { generateRecoveryCode, hashRecoveryCode } = require('../services/recoveryCode');
const { normalisePhone } = require('../utils/phone');
const bcrypt = require('bcryptjs');

// Get student record id for a given user id
async function studentIdForUser(userId) {
  const r = await db.query('SELECT id FROM students WHERE user_id = $1', [userId]);
  return r.rows[0]?.id || null;
}

/* Admins only ever see the students the super admin has assigned to them
   (primary s.coach_id OR an explicit student_coaches row — one student can be
   handled by several coaches). Super admins see the whole roster. */
function coachScope(user, params) {
  if (user.role === 'superadmin') return { clause: '', params };
  params.push(user.id);
  return {
    clause: ` AND (s.coach_id = $${params.length} OR EXISTS (
                SELECT 1 FROM student_coaches sc
                WHERE sc.student_id = s.id AND sc.coach_id = $${params.length}))`,
    params,
  };
}

/* The roster SELECT, shared by the full roster (feature-gated) and the
 * coach-scoped Reports page, so both always return the same columns and can
 * never drift apart. `req.user` decides the scope via coachScope(). */
const ROSTER_SELECT = `
  SELECT s.id, s.group_id, s.active, s.default_board_theme, g.name AS group_name,
         s.coach_id, cu.name AS coach_name,
         COALESCE(sc.coaches, '[]'::jsonb) AS coaches,
         u.id AS user_id, u.name, u.email, u.phone, u.country_code, u.profile_image, u.avatar_config
  FROM students s
  JOIN users u ON u.id = s.user_id
  LEFT JOIN groups g ON g.id = s.group_id
  LEFT JOIN users cu ON cu.id = s.coach_id
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object('id', u2.id, 'name', u2.name)
                    ORDER BY (u2.id = s.coach_id) DESC, u2.name) AS coaches
    FROM student_coaches sc2
    JOIN users u2 ON u2.id = sc2.coach_id
    WHERE sc2.student_id = s.id
  ) sc ON TRUE
  WHERE 1=1
`;

exports.listStudents = async (req, res) => {
  try {
    const { search, groupId } = req.query;
    const params = [];
    let query = ROSTER_SELECT;
    const { clause, params: p } = coachScope(req.user, params);
    query += clause;
    if (search) {
      p.push(`%${search}%`);
      query += ` AND (u.name ILIKE $${p.length} OR u.email ILIKE $${p.length})`;
    }
    if (groupId) {
      p.push(groupId);
      query += ` AND s.group_id = $${p.length}`;
    }
    query += ' ORDER BY u.name ASC';
    const result = await db.query(query, p);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Failed to list students', error: err.message });
  }
};

/**
 * Roster for the Admin Reports page.
 *
 * Same data as the full roster, deliberately NOT behind `requireFeature(
 * 'student_roster')`: a coach's Reports page is meant to show the students
 * assigned to them, and coachScope() already restricts this to exactly those
 * rows. The per-student endpoints a coach can already reach (`GET /students/:id`
 * and `GET /students/:id/report`) are likewise not feature-gated, so this adds
 * no access a coach did not already have — while the full roster at
 * `GET /api/students` stays under the super admin's feature switch.
 */
exports.assignedStudents = async (req, res) => {
  try {
    const params = [];
    const { clause, params: p } = coachScope(req.user, params);
    const result = await db.query(ROSTER_SELECT + clause + ' ORDER BY u.name ASC', p);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Failed to load assigned students', error: err.message });
  }
};

/* Admin (non-superadmin) may only read/update a student assigned to them —
   primary coach or via student_coaches (multi-coach support). */
async function assertCoachAccess(user, studentId) {
  if (user.role === 'superadmin') return true;
  const r = await db.query(
    `SELECT 1 FROM students s
     WHERE s.id = $1 AND (s.coach_id = $2 OR EXISTS (
       SELECT 1 FROM student_coaches sc
       WHERE sc.student_id = s.id AND sc.coach_id = $2))`,
    [studentId, user.id]
  );
  if (r.rows.length > 0) return true;
  return false;
}

exports.getStudent = async (req, res) => {
  try {
    if (!(await assertCoachAccess(req.user, req.params.id))) {
      return res.status(403).json({ message: 'You can only view students assigned to you' });
    }
    const result = await db.query(
      `SELECT s.id, s.group_id, s.coach_id, s.active, s.default_board_theme, s.created_at, s.birthdate, s.nickname,
              s.parent_name, s.gender, s.preferred_language,
              u.id AS user_id, u.name, u.email, u.phone, u.country_code, u.profile_image, u.avatar_config, u.created_at AS joined_at,
              g.name AS group_name, cu.name AS coach_name,
              COALESCE(sc.coaches, '[]'::jsonb) AS coaches
       FROM students s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN groups g ON g.id = s.group_id
       LEFT JOIN users cu ON cu.id = s.coach_id
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(jsonb_build_object('id', u2.id, 'name', u2.name)
                         ORDER BY (u2.id = s.coach_id) DESC, u2.name) AS coaches
         FROM student_coaches sc2
         JOIN users u2 ON u2.id = sc2.coach_id
         WHERE sc2.student_id = s.id
       ) sc ON TRUE
       WHERE s.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: 'Student not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch student', error: err.message });
  }
};

// Coaches = coaching-staff accounts (role 'admin'), shown in assign dropdowns.
exports.listCoaches = async (req, res) => {
  const result = await db.query(
    `SELECT id, name, email, phone, country_code, profile_image, avatar_config, created_at
     FROM users WHERE role = 'admin' ORDER BY name`
  );
  res.json(result.rows);
};

/**
 * POST /api/students/:id/resend-registration-email
 *
 * Send the welcome mail again - with the login details in it.
 *
 * The OLD password cannot be sent: only its HASH is stored, so it is
 * unavailable. A resend therefore issues a NEW temporary password, stores its
 * hash, flags the account so the student must change it at their next
 * sign-in, and mails the new one. The admin is warned about this.
 *
 * The same student can only be mailed once a moment apart, so a double-click
 * (or a retry) cannot send two.
 */
exports.resendRegistrationEmail = async (req, res) => {
  try {
    if (!(await assertCoachAccess(req.user, req.params.id))) {
      return res.status(403).json({ message: 'You can only manage students assigned to you' });
    }
    const result = await db.query(
      `SELECT s.id, s.group_id, s.user_id, u.name, u.email, u.username,
              g.name AS group_name, cu.name AS coach_name
       FROM students s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN groups g ON g.id = s.group_id
       LEFT JOIN users cu ON cu.id = s.coach_id
       WHERE s.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: 'Student not found' });

    const s = result.rows[0];
    if (!s.email) {
      return res.status(400).json({ message: 'This student has no email address' });
    }
    if (!mailService.isValidEmail(s.email)) {
      return res.status(400).json({ message: 'This student has an invalid email address' });
    }
    /* The same guard as the registration path: one mail per student per
       minute, so a double-click cannot send two. */
    if (isRecentlyMailed(s.id)) {
      return res.status(429).json({ message: 'A confirmation was just sent to this student - give it a minute.' });
    }

    /* A NEW temporary password: the old one is hashed and unavailable, and the
       student is going to have to change it anyway. */
    const plainPassword = mailService.generateTemporaryPassword();
    const hashed = await bcrypt.hash(plainPassword, 10);
    await db.query(
      `UPDATE users
          SET password = $1,
              must_change_password = true,
              recovery_code_hash = $2,
              recovery_code_created_at = NOW()
        WHERE id = $3`,
      [hashed, hashRecoveryCode(generateRecoveryCode()), s.user_id]
    );

    const sent = await mailService.sendRegistrationEmail({
      name: s.name,
      email: s.email,
      studentId: s.id,
      username: s.username,
      password: plainPassword,
      batch: s.group_name || null,
      branch: s.coach_name || null,
      loginUrl: buildLoginUrl(),
    });
    if (!sent.ok) {
      return res.status(502).json({
        message: sent.skipped === 'not-configured'
          ? 'Email is not configured on this server'
          : (sent.error || 'The confirmation email could not be sent'),
      });
    }
    markMailed(s.id);
    res.json({ ok: true, sent: true, mode: sent.mode || 'smtp', email: s.email });
  } catch (err) {
    res.status(500).json({ message: 'Failed to send the confirmation email', error: err.message });
  }
};

exports.updateStudent = async (req, res) => {
  try {
    const { groupId, coachIds, removeCoachId, name, email, phone, defaultBoardTheme, active } = req.body;
    const details = {
      nickname: req.body.nickname,
      birthdate: req.body.birthdate,
      parentName: req.body.parentName,
      gender: req.body.gender,
      preferredLanguage: req.body.preferredLanguage,
    };
    const student = await db.query('SELECT * FROM students WHERE id = $1', [req.params.id]);
    if (student.rows.length === 0) return res.status(404).json({ message: 'Student not found' });

    if (!(await assertCoachAccess(req.user, req.params.id))) {
      return res.status(403).json({ message: 'You can only manage students assigned to you' });
    }

    // Only the super admin may (re)assign a student to coaches. One student can
    // be handled by several coaches (student_coaches join table); students.coach_id
    // stays the primary one.
    const coachChanged =
      coachIds !== undefined || removeCoachId !== undefined || req.body.coachId !== undefined;
    if (coachChanged && req.user.role !== 'superadmin') {
      return res.status(403).json({ message: 'Only the super admin can assign a coach' });
    }

    if (active !== undefined && typeof active !== 'boolean') {
      return res.status(400).json({ message: 'active must be a boolean' });
    }

    const phoneChange = normalisePhone({
      phone,
      countryCode: req.body.countryCode,
      phoneNumber: req.body.phoneNumber,
    });
    if (phoneChange.error) return res.status(400).json({ message: phoneChange.error });

    if (email !== undefined) {
      const dup = await db.query('SELECT id FROM users WHERE email ILIKE $1 AND id <> $2', [email, student.rows[0].user_id]);
      if (dup.rows.length > 0) {
        return res.status(400).json({ message: 'That email is already in use by another account' });
      }
    }

    const studentId = req.params.id;

    if (coachIds !== undefined) {
      if (!Array.isArray(coachIds)) {
        return res.status(400).json({ message: 'coachIds must be an array of admin ids' });
      }
      const uniq = [...new Set(coachIds.map((x) => Number(x)).filter(Number.isInteger))];
      if (uniq.length !== new Set(coachIds.map((x) => String(x))).size) {
        return res.status(400).json({ message: 'coachIds contains invalid ids' });
      }
      if (uniq.length > 0) {
        const found = await db.query(
          'SELECT id FROM users WHERE id = ANY($1) AND role = $2',
          [uniq, 'admin']
        );
        if (found.rows.length !== uniq.length) {
          return res.status(400).json({ message: 'One or more coaches were not found' });
        }
      }
      // Full replace: nuke the set, insert the new one; primary = first coach.
      const client = await db.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM student_coaches WHERE student_id = $1', [studentId]);
        for (const cid of uniq) {
          await client.query(
            `INSERT INTO student_coaches (student_id, coach_id, assigned_by)
             VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
            [studentId, cid, req.user.id]
          );
        }
        await client.query('UPDATE students SET coach_id = $1 WHERE id = $2', [uniq[0] || null, studentId]);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    } else if (removeCoachId) {
      // Drop a single coach (e.g. the 'unassign' action on an admin's page):
      // primary falls back to another remaining coach.
      const cid = Number(removeCoachId);
      if (!Number.isInteger(cid)) {
        return res.status(400).json({ message: 'Invalid coach id' });
      }
      await db.query(
        'DELETE FROM student_coaches WHERE student_id = $1 AND coach_id = $2',
        [studentId, cid]
      );
      const current = student.rows[0];
      if (current.coach_id === cid) {
        const next = await db.query(
          'SELECT coach_id FROM student_coaches WHERE student_id = $1 ORDER BY id LIMIT 1',
          [studentId]
        );
        await db.query('UPDATE students SET coach_id = $1 WHERE id = $2', [next.rows[0]?.coach_id || null, studentId]);
      }
    } else if (req.body.coachId !== undefined) {
      // Legacy single-call: a non-null id ADDS the coach (primary kept),
      // null clears every coach.
      const legacy = req.body.coachId;
      if (legacy === null || legacy === '') {
        await db.query('DELETE FROM student_coaches WHERE student_id = $1', [studentId]);
        await db.query('UPDATE students SET coach_id = NULL WHERE id = $1', [studentId]);
      } else {
        const cid = Number(legacy);
        const coach = await db.query('SELECT id FROM users WHERE id = $1 AND role = $2', [cid, 'admin']);
        if (coach.rows.length === 0) {
          return res.status(400).json({ message: 'Coach not found' });
        }
        await db.query(
          `INSERT INTO student_coaches (student_id, coach_id, assigned_by)
           VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [studentId, cid, req.user.id]
        );
        await db.query('UPDATE students SET coach_id = COALESCE(coach_id, $1) WHERE id = $2', [cid, studentId]);
      }
    }

    // defaultBoardTheme explicitly null → clear the recommendation.
    const hasDefaultBoardTheme = defaultBoardTheme !== undefined;
    let themeSql = defaultBoardTheme !== null ? 'COALESCE($2, default_board_theme)' : '$2';

    await db.query(
      `UPDATE students SET
         group_id = COALESCE($1, group_id),
         default_board_theme = ${themeSql},
         active = COALESCE($3, active),
         nickname = COALESCE($4, nickname),
         birthdate = COALESCE($5, birthdate),
         parent_name = COALESCE($6, parent_name),
         gender = COALESCE($7, gender),
         preferred_language = COALESCE($8, preferred_language)
       WHERE id = $9`,
      [
        groupId,
        hasDefaultBoardTheme ? defaultBoardTheme : undefined,
        active,
        details.nickname,
        details.birthdate,
        details.parentName,
        details.gender,
        details.preferredLanguage,
        req.params.id,
      ]
    );

    const userUpdates = [];
    const userParams = [student.rows[0].user_id];
    if (name !== undefined) { userUpdates.push(`name = $${userParams.length + 1}`); userParams.push(name); }
    if (email !== undefined) { userUpdates.push(`email = $${userParams.length + 1}`); userParams.push(email); }
    if (phoneChange.changed) {
      userUpdates.push(`phone = $${userParams.length + 1}`); userParams.push(phoneChange.phone);
      userUpdates.push(`country_code = $${userParams.length + 1}`); userParams.push(phoneChange.countryCode);
    }
    if (userUpdates.length > 0) {
      await db.query(`UPDATE users SET ${userUpdates.join(', ')}, updated_at = NOW() WHERE id = $1`, userParams);
    }

    res.json({ message: 'Student updated' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to update student', error: err.message });
  }
};

// Student edits their own profile details (nickname shown on the leaderboard,
// parent/guardian contact, birthdate, gender and preferred language).
exports.updateMe = async (req, res) => {
  try {
    const studentId = await studentIdForUser(req.user.id);
    if (!studentId) return res.status(404).json({ message: 'Student profile not found' });

    const details = {
      nickname: req.body.nickname,
      birthdate: req.body.birthdate,
      parentName: req.body.parentName,
      gender: req.body.gender,
      preferredLanguage: req.body.preferredLanguage,
    };

    const phoneChange = normalisePhone({
      phone: req.body.phone,
      countryCode: req.body.countryCode,
      phoneNumber: req.body.phoneNumber,
    });
    if (phoneChange.error) return res.status(400).json({ message: phoneChange.error });

    await db.query(
      `UPDATE students SET
         nickname = COALESCE($1, nickname),
         birthdate = COALESCE($2, birthdate),
         parent_name = COALESCE($3, parent_name),
         gender = COALESCE($4, gender),
         preferred_language = COALESCE($5, preferred_language)
       WHERE id = $6`,
      [
        details.nickname !== undefined ? details.nickname : null,
        details.birthdate !== undefined ? details.birthdate : null,
        details.parentName !== undefined ? details.parentName : null,
        details.gender !== undefined ? details.gender : null,
        details.preferredLanguage !== undefined ? details.preferredLanguage : null,
        studentId,
      ]
    );

    if (phoneChange.changed || req.body.name !== undefined) {
      const updates = [];
      const params = [req.user.id];
      if (req.body.name !== undefined) {
        updates.push(`name = COALESCE($${params.length + 1}, name)`);
        params.push(req.body.name);
      }
      if (phoneChange.changed) {
        updates.push(`phone = $${params.length + 1}`);
        params.push(phoneChange.phone);
        updates.push(`country_code = $${params.length + 1}`);
        params.push(phoneChange.countryCode);
      }
      await db.query(
        `UPDATE users SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $1`,
        params
      );
    }

    res.json({ message: 'Profile updated' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to update profile', error: err.message });
  }
};

// Save a DiceBear style avatar config. Callable by the student themselves
// ('me') or by an admin on behalf of a student (numeric student id).
exports.updateAvatar = async (req, res) => {
  try {
    const config = req.body.avatar_config;
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      return res.status(400).json({ message: 'avatar_config object is required' });
    }

    const clean = {};
    for (const key of ['basePiece', 'bodyColor', 'face', 'accessory', 'background']) {
      if (config[key] !== undefined && config[key] !== null) {
        if (typeof config[key] !== 'string') {
          return res.status(400).json({ message: `avatar_config.${key} must be a string` });
        }
        clean[key] = config[key];
      }
    }
    if (Object.keys(clean).length === 0) {
      return res.status(400).json({ message: 'avatar_config must include at least one valid field' });
    }

    let userId = req.user.id;
    // '/me/avatar' matches the static route (no :id captured); '/:id/avatar'
    // (admin) captures a numeric student id. Either way, a non-'me'/numeric id
    // resolves the student's user through the students table.
    if (req.params.id && req.params.id !== 'me') {
      const st = await db.query('SELECT user_id FROM students WHERE id = $1', [req.params.id]);
      if (st.rows.length === 0) return res.status(404).json({ message: 'Student not found' });
      if (!(await assertCoachAccess(req.user, req.params.id))) {
        return res.status(403).json({ message: 'You can only manage students assigned to you' });
      }
      userId = st.rows[0].user_id;
    }

    await db.query(
      'UPDATE users SET avatar_config = $1, updated_at = NOW() WHERE id = $2',
      [clean, userId]
    );
    res.json({ avatar_config: clean });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to save avatar', error: err.message });
  }
};

// Remove the custom avatar so the seeded default (or the uploaded photo) shows.
// Same self ('me') / admin (numeric student id) resolution as updateAvatar.
exports.resetAvatar = async (req, res) => {
  try {
    let userId = req.user.id;
    if (req.params.id && req.params.id !== 'me') {
      const st = await db.query('SELECT user_id FROM students WHERE id = $1', [req.params.id]);
      if (st.rows.length === 0) return res.status(404).json({ message: 'Student not found' });
      if (!(await assertCoachAccess(req.user, req.params.id))) {
        return res.status(403).json({ message: 'You can only manage students assigned to you' });
      }
      userId = st.rows[0].user_id;
    }

    await db.query(
      'UPDATE users SET avatar_config = NULL, updated_at = NOW() WHERE id = $1',
      [userId]
    );
    res.json({ avatar_config: null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to remove avatar', error: err.message });
  }
};

exports.deleteStudent = async (req, res) => {
  try {
    /* A coach may only delete a student assigned to them. This check is what
     * makes the route safe to open to the `admin` role — without it any coach
     * could delete any student id they could guess. */
    if (!(await assertCoachAccess(req.user, req.params.id))) {
      return res.status(403).json({ message: 'You can only delete students assigned to you' });
    }
    const student = await db.query('SELECT user_id FROM students WHERE id = $1', [req.params.id]);
    if (student.rows.length === 0) return res.status(404).json({ message: 'Student not found' });
    await db.query('DELETE FROM users WHERE id = $1', [student.rows[0].user_id]);
    res.json({ message: 'Student deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete student', error: err.message });
  }
};

// Aggregated progress used by the student dashboard & /student/progress page
exports.getProgress = async (req, res) => {
  try {
    const studentId = req.params.id === 'me' ? await studentIdForUser(req.user.id) : req.params.id;
    if (!studentId) return res.status(404).json({ message: 'Student profile not found' });

    const [attendance, puzzles, puzzleSets, quizzes, assignments, courseProgress, rating] = await Promise.all([
      db.query(
        `SELECT
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE status = 'present') AS present
         FROM attendance WHERE student_id = $1`,
        [studentId]
      ),
      db.query(
        `SELECT COUNT(*)::int AS attempts,
                COUNT(*) FILTER (WHERE result = 'correct')::int AS correct,
                COUNT(DISTINCT puzzle_id) FILTER (WHERE result = 'correct')::int AS puzzles_solved,
                COALESCE(SUM(score), 0)::int AS puzzle_score
         FROM puzzle_attempts WHERE student_id = $1`,
        [studentId]
      ),
      db.query(
        `SELECT
           COALESCE(s.name, 'General Tactics') AS set_name,
           COALESCE(p.set_code, 'general') AS set_code,
           COUNT(DISTINCT spa.puzzle_id)::int AS total,
           COUNT(DISTINCT pa.puzzle_id) FILTER (WHERE pa.result = 'correct')::int AS completed,
           COUNT(pa.id)::int AS attempts,
           COUNT(pa.id) FILTER (WHERE pa.result = 'correct')::int AS correct_attempts,
           COALESCE(SUM(pa.score), 0)::int AS score
         FROM student_puzzle_assignments spa
         JOIN puzzles p ON p.id = spa.puzzle_id AND p.is_published = true
         LEFT JOIN sets s ON s.code = p.set_code
         LEFT JOIN puzzle_attempts pa
           ON pa.puzzle_id = spa.puzzle_id AND pa.student_id = spa.student_id
         WHERE spa.student_id = $1
         GROUP BY COALESCE(s.name, 'General Tactics'), COALESCE(p.set_code, 'general')
         ORDER BY set_name`,
        [studentId]
      ),
      db.query(`SELECT AVG(score)::int AS avg_score, COUNT(*) AS taken FROM quiz_results WHERE student_id = $1`, [studentId]),
      db.query(
        `SELECT COUNT(*) AS submitted, AVG(score)::int AS avg_score
         FROM assignment_submissions WHERE student_id = $1`,
        [studentId]
      ),
      db.query(
        `SELECT c.id, c.title,
           COUNT(l.id) AS total_lessons,
           COUNT(lc.id) AS completed_lessons
         FROM courses c
         JOIN modules m ON m.course_id = c.id
         JOIN lessons l ON l.module_id = m.id
         LEFT JOIN lesson_completion lc ON lc.lesson_id = l.id AND lc.student_id = $1
         GROUP BY c.id, c.title`,
        [studentId]
      ),
      db.query(
        `SELECT current_rating, peak_rating FROM students WHERE id = $1`,
        [studentId]
      ),
      // Per-time-control rating pools. Left-joined in JS so a student who has
      // only played blitz still returns all four controls, with null ratings for
      // the ones they have no games in.
      db.query(
        `SELECT time_class, rating, peak_rating, games_played, highest_level
         FROM student_time_ratings WHERE student_id = $1`,
        [studentId]
      ),
    ]);

    const att = attendance.rows[0];
    const attendancePct = att.total > 0 ? Math.round((att.present / att.total) * 100) : 0;
    const pz = puzzles.rows[0];
    const attempts = Number(pz.attempts) || 0;
    const correct = Number(pz.correct) || 0;
    const puzzlesSolved = Number(pz.puzzles_solved) || 0;
    const puzzleAccuracy = attempts > 0 ? Math.round((correct / attempts) * 100) : 0;

    res.json({
      currentRating: Number(rating.rows[0]?.current_rating ?? 0),
      peakRating: Number(rating.rows[0]?.peak_rating ?? 0),
      // One entry per control, always all four so the UI can render a fixed row.
      timeRatings: TIME_CLASSES.reduce((acc, cls) => {
        const row = timeRatings.rows.find((r) => r.time_class === cls);
        acc[cls] = row
          ? {
              rating: Number(row.rating),
              peakRating: Number(row.peak_rating),
              gamesPlayed: Number(row.games_played),
              level: Number(row.highest_level),
              label: timeClassLabel(cls),
              icon: TIME_CLASS_META[cls].icon,
            }
          : { rating: null, peakRating: null, gamesPlayed: 0, level: 1,
              label: timeClassLabel(cls), icon: TIME_CLASS_META[cls].icon };
        return acc;
      }, {}),
      attendancePercentage: attendancePct,
      totalClasses: Number(att.total),
      classesAttended: Number(att.present),
      puzzleAccuracy,
      puzzlesAttempted: attempts,
      puzzlesSolved,
      puzzleScore: Number(pz.puzzle_score) || 0,
      puzzleSets: puzzleSets.rows.map((row) => {
        const total = Number(row.total) || 0;
        const completed = Number(row.completed) || 0;
        const setAttempts = Number(row.attempts) || 0;
        const correctAttempts = Number(row.correct_attempts) || 0;
        return {
          setCode: row.set_code,
          setName: row.set_name,
          total,
          completed,
          score: Number(row.score) || 0,
          completionPct: total > 0 ? Math.round((completed / total) * 100) : 0,
          accuracy: setAttempts > 0 ? Math.round((correctAttempts / setAttempts) * 100) : 0,
          attempts: setAttempts,
        };
      }),
      quizAverageScore: quizzes.rows[0].avg_score || 0,
      quizzesTaken: Number(quizzes.rows[0].taken),
      assignmentsSubmitted: Number(assignments.rows[0].submitted),
      assignmentAverageScore: assignments.rows[0].avg_score || 0,
      courseProgress: courseProgress.rows.map((c) => ({
        courseId: c.id,
        title: c.title,
        percentage: c.total_lessons > 0 ? Math.round((c.completed_lessons / c.total_lessons) * 100) : 0,
      })),
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch progress', error: err.message });
  }
};

// Full dashboard summary for /student/dashboard
exports.getDashboard = async (req, res) => {
  try {
    const studentId = await studentIdForUser(req.user.id);
    if (!studentId) return res.status(404).json({ message: 'Student profile not found' });

    const [
      assignmentStats,
      puzzleStats,
      profileRes,
      upcomingClassRes,
      pendingAssignmentsRes,
      assignmentTrend,
      puzzleTrend,
      pendingPuzzlesRes,
    ] = await Promise.all([
      db.query(
        `SELECT COUNT(*)::int AS total, COUNT(score)::int AS submitted,
                COALESCE(AVG(score)::int, 0) AS avg_score
         FROM assignment_submissions WHERE student_id = $1`,
        [studentId]
      ),
      db.query(
        `SELECT COUNT(*)::int AS attempted,
                COUNT(*) FILTER (WHERE result = 'correct')::int AS correct,
                COUNT(DISTINCT puzzle_id) FILTER (WHERE result = 'correct')::int AS solved,
                COALESCE(SUM(score), 0)::int AS score
         FROM puzzle_attempts WHERE student_id = $1`,
        [studentId]
      ),
      db.query(
        `SELECT u.name FROM students s
         JOIN users u ON u.id = s.user_id WHERE s.id = $1`,
        [studentId]
      ),
      db.query(
        `SELECT cl.title, cl.topic, cl.class_date, cl.start_time, cl.meeting_url
         FROM classes cl
         JOIN students st ON st.group_id = cl.group_id
         WHERE st.id = $1 AND cl.class_date >= CURRENT_DATE
         ORDER BY cl.class_date ASC, cl.start_time ASC LIMIT 1`,
        [studentId]
      ),
      db.query(
        `SELECT a.id, a.title, a.due_date FROM assignments a
         LEFT JOIN assignment_submissions sub ON sub.assignment_id = a.id AND sub.student_id = $1
         WHERE sub.id IS NULL AND (a.due_date IS NULL OR a.due_date >= CURRENT_DATE)
         ORDER BY a.due_date ASC NULLS LAST LIMIT 5`,
        [studentId]
      ),
      db.query(
        `SELECT to_char(submitted_at::date, 'YYYY-MM-DD') AS day, COUNT(*)::int AS count
         FROM assignment_submissions WHERE student_id = $1
           AND submitted_at >= CURRENT_DATE - INTERVAL '13 days'
         GROUP BY 1 ORDER BY 1`,
        [studentId]
      ),
      db.query(
        `SELECT to_char(attempted_at::date, 'YYYY-MM-DD') AS day,
                COUNT(*)::int AS attempts,
                COUNT(*) FILTER (WHERE result = 'correct')::int AS correct
         FROM puzzle_attempts WHERE student_id = $1
           AND attempted_at >= CURRENT_DATE - INTERVAL '13 days'
         GROUP BY 1 ORDER BY 1`,
        [studentId]
      ),
      db.query(
        `SELECT COUNT(*)::int AS pending
         FROM (
           SELECT spa.puzzle_id
           FROM student_puzzle_assignments spa
           WHERE spa.student_id = $1
             AND spa.status != 'completed'
           UNION
           SELECT pa.puzzle_id
           FROM puzzle_assignments pa
           WHERE (pa.student_id = $1 OR pa.student_id IS NULL)
             AND NOT EXISTS (
               SELECT 1 FROM student_puzzle_assignments spa2
               WHERE spa2.student_id = $1 AND spa2.puzzle_id = pa.puzzle_id
             )
         ) a
         JOIN puzzles p ON p.id = a.puzzle_id AND p.is_published = true
         WHERE NOT EXISTS (
           SELECT 1 FROM puzzle_attempts a1
           WHERE a1.puzzle_id = a.puzzle_id AND a1.student_id = $1 AND a1.result = 'correct'
         )`,
        [studentId]
      ),
    ]);

    // Daily login streak — visiting the dashboard counts as today's check-in.
    let loginStreak = { streak: 0, lastLogin: null };
    try {
      loginStreak = await touchLoginStreak(req.user.id);
    } catch (e) {
      /* column missing → treat as no streak instead of failing the dashboard */
    }

    res.json({
      profile: profileRes.rows[0] || null,
      upcomingClass: upcomingClassRes.rows[0] || null,
      pendingAssignments: pendingAssignmentsRes.rows,
      assignments: assignmentStats.rows[0],
      puzzles: puzzleStats.rows[0],
      assignmentTrend: assignmentTrend.rows,
      puzzleTrend: puzzleTrend.rows,
      pendingPuzzles: pendingPuzzlesRes.rows[0]?.pending ?? 0,
      loginStreak,
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to load dashboard', error: err.message });
  }
};

exports.studentIdForUser = studentIdForUser;

// Full "Activities & Performance Report" for a single student (admin only).
// Everything the standalone /students/:id/report page needs to render itself in
// a new browser tab — it must NOT depend on any React state from the roster page.
exports.studentReport = async (req, res) => {
  try {
    const studentId = req.params.id;
    if (!req.selfReport && !(await assertCoachAccess(req.user, studentId))) {
      return res.status(403).json({ message: 'You can only view students assigned to you' });
    }

    const [profileRes, ratingProfile] = await Promise.all([
      db.query(
        `SELECT s.id, s.group_id, s.coach_id, s.active, s.created_at, s.birthdate, s.nickname,
                s.parent_name, s.gender, s.preferred_language,
                u.id AS user_id,
                g.name AS group_name, u.name, u.email, u.phone, u.country_code, u.profile_image, u.avatar_config,
                cu.name AS coach_name,
                COALESCE(sc.coaches, '[]'::jsonb) AS coaches
         FROM students s
         JOIN users u ON u.id = s.user_id
         LEFT JOIN groups g ON g.id = s.group_id
         LEFT JOIN users cu ON cu.id = s.coach_id
         LEFT JOIN LATERAL (
           SELECT jsonb_agg(jsonb_build_object('id', u2.id, 'name', u2.name)
                           ORDER BY (u2.id = s.coach_id) DESC, u2.name) AS coaches
           FROM student_coaches sc2
           JOIN users u2 ON u2.id = sc2.coach_id
           WHERE sc2.student_id = s.id
         ) sc ON TRUE
         WHERE s.id = $1`,
        [studentId]
      ),
      ratingService.buildProfile(studentId),
    ]);
    const profile = profileRes.rows[0];
    if (!profile) return res.status(404).json({ message: 'Student not found' });
    const userId = profileRes.rows[0].user_id;

    const [
      ratedRecord,
      onlineRecord,
      tournamentRecord,
      puzzleStats,
      themeStats,
      assignmentStats,
      quizStats,
      attendance,
      lessons,
      courseProgress,
      academy,
      badges,
      coachNotes,
      recentActivity,
      assignmentsList,
      classesAttended,
      classesUpcoming,
    ] = await Promise.all([
      db.query(
        `SELECT COUNT(*)::int AS games,
                COUNT(*) FILTER (WHERE result='win')::int AS wins,
                COUNT(*) FILTER (WHERE result='draw')::int AS draws,
                COUNT(*) FILTER (WHERE result='loss')::int AS losses
         FROM rating_history WHERE student_id = $1`,
        [studentId]
      ),
      db.query(
        `SELECT COUNT(*) FILTER (WHERE status='finished')::int AS games,
                COUNT(*) FILTER (WHERE status='abandoned')::int AS abandoned,
                COUNT(*) FILTER (WHERE result='draw')::int AS draws,
                COUNT(*) FILTER (WHERE (admin_color='black' AND result='black') OR (admin_color='white' AND result='white'))::int AS wins,
                COUNT(*) FILTER (WHERE (admin_color='white' AND result='black') OR (admin_color='black' AND result='white'))::int AS losses
         FROM online_games WHERE student_id = $1`,
        [userId]
      ),
      db.query(
        `SELECT COUNT(DISTINCT t.id)::int AS participated,
COUNT(tp.id) FILTER (WHERE (tp.white_player = $1 AND tp.result = 'white') OR (tp.black_player = $1 AND tp.result = 'black'))::int AS wins,
                 COUNT(tp.id) FILTER (WHERE tp.result = 'draw')::int AS draws,
                 COUNT(tp.id) FILTER (WHERE (tp.white_player = $1 AND tp.result = 'black') OR (tp.black_player = $1 AND tp.result = 'white'))::int AS losses
         FROM tournament_registrations tr
         JOIN tournaments t ON t.id = tr.tournament_id
         LEFT JOIN tournament_pairings tp
           ON tp.tournament_id = t.id AND (tp.white_player = $1 OR tp.black_player = $1)
         WHERE tr.student_id = $1`,
        [userId]
      ),
      db.query(
        `SELECT COUNT(*)::int AS attempts,
                COUNT(*) FILTER (WHERE result='correct')::int AS correct,
                COUNT(DISTINCT puzzle_id) FILTER (WHERE result='correct')::int AS solved,
                COALESCE(SUM(score),0)::int AS score
         FROM puzzle_attempts WHERE student_id = $1`,
        [studentId]
      ),
      db.query(
        `SELECT ptheme AS theme,
                COUNT(*)::int AS attempts,
                COUNT(*) FILTER (WHERE pa.result='correct')::int AS correct
         FROM puzzle_attempts pa
         JOIN puzzles pz ON pz.id = pa.puzzle_id,
              unnest(pz.themes) AS ptheme
         WHERE pa.student_id = $1 AND pa.result IN ('correct','incorrect')
         GROUP BY ptheme
         ORDER BY attempts DESC, ptheme
         LIMIT 20`,
        [studentId]
      ),
      db.query(
        `SELECT COUNT(*)::int AS submitted,
                COALESCE(AVG(score)::int,0) AS avg_score,
                COUNT(*) FILTER (WHERE approved)::int AS approved
         FROM assignment_submissions WHERE student_id = $1`,
        [studentId]
      ),
      db.query(
        `SELECT COUNT(*)::int AS taken,
                COALESCE(AVG(score)::int,0) AS avg_score,
                COALESCE(MAX(score),0)::int AS best_score,
                COUNT(*) FILTER (WHERE score >= 100)::int AS perfect
         FROM quiz_results WHERE student_id = $1`,
        [studentId]
      ),
      db.query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE status='present')::int AS present,
                COUNT(*) FILTER (WHERE status='late')::int AS late
         FROM attendance WHERE student_id = $1`,
        [studentId]
      ),
      db.query(
        `SELECT COUNT(*)::int AS completed FROM lesson_completion WHERE student_id = $1`,
        [studentId]
      ),
      db.query(
        `SELECT c.id, c.title,
                COUNT(l.id)::int AS total_lessons,
                COUNT(lc.id)::int AS completed_lessons
         FROM courses c
         JOIN modules m ON m.course_id = c.id
         JOIN lessons l ON l.module_id = m.id
         LEFT JOIN lesson_completion lc ON lc.lesson_id = l.id AND lc.student_id = $1
         GROUP BY c.id, c.title
         ORDER BY c.title`,
        [studentId]
      ),
      db.query(
        `SELECT COALESCE(SUM(total_xp),0)::int AS xp,
                COALESCE(SUM(sessions_completed),0)::int AS sessions,
                COALESCE(SUM(exercises_attempted),0)::int AS exercises_attempted,
                COALESCE(SUM(exercises_correct),0)::int AS exercises_correct,
                COALESCE(MAX(daily_streak),0)::int AS best_streak
         FROM academy_stats WHERE user_id = $1`,
        [userId]
      ),
      db.query(
        `SELECT COUNT(*)::int AS count FROM user_academy_badges WHERE user_id = $1`,
        [userId]
      ),
      db.query(
        `SELECT created_at, coach_feedback
         FROM game_analysis
         WHERE student_id = $1 AND coach_feedback IS NOT NULL AND coach_feedback <> ''
         ORDER BY created_at DESC LIMIT 20`,
        [studentId]
      ),
      buildRecentActivity(studentId, userId),
      db.query(
        `WITH assigned AS (
           SELECT spa.puzzle_id, spa.assigned_date, spa.due_date
           FROM student_puzzle_assignments spa WHERE spa.student_id = $1
         ),
         cands AS (
           SELECT pz.id, pz.fen, pz.title, pz.theme, pz.themes, pz.difficulty, pz.solution,
                   pz.set_code, a.assigned_date, a.due_date
           FROM puzzles pz
           LEFT JOIN assigned a ON a.puzzle_id = pz.id
           WHERE a.puzzle_id IS NOT NULL
              OR EXISTS (SELECT 1 FROM puzzle_attempts pa
                         WHERE pa.puzzle_id = pz.id AND pa.student_id = $1)
         ),
agg AS (
           SELECT c.id, c.fen, c.title, c.theme, c.themes, c.difficulty, c.solution,
                  c.set_code, c.assigned_date, c.due_date,
                  COUNT(pa.id)::int AS attempts,
                  COUNT(pa.id) FILTER (WHERE pa.result = 'correct')::int AS correct_attempts,
                  COALESCE(MAX(pa.score) FILTER (WHERE pa.result = 'correct'), 0)::int AS best_score,
                  MIN(pa.attempted_at) AS first_attempt,
                  MAX(pa.attempted_at) FILTER (WHERE pa.result = 'correct') AS solved_at
           FROM cands c
           LEFT JOIN puzzle_attempts pa ON pa.puzzle_id = c.id AND pa.student_id = $1
           GROUP BY c.id, c.fen, c.title, c.theme, c.themes, c.difficulty, c.solution,
                    c.set_code, c.assigned_date, c.due_date
         )
         SELECT 'puzzle'::text AS kind,
                ('p' || a.id) AS key_id,
                a.id AS ref_id,
                COALESCE(NULLIF(a.title, ''), INITCAP(COALESCE(a.themes[1], a.theme, 'General')) || ' tactic') AS title,
                a.difficulty, a.themes,
                a.fen, a.solution,
                a.set_code,
                a.assigned_date, a.due_date,
                jsonb_array_length(a.solution) AS activities,
                (a.correct_attempts > 0) AS submitted,
                (a.correct_attempts > 0) AS approved,
                a.best_score AS score,
                COALESCE(a.assigned_date::timestamp, a.first_attempt) AS assigned_at,
                a.solved_at,
                a.attempts
         FROM agg a
         UNION ALL
         SELECT 'assignment'::text AS kind,
                ('a' || a.id) AS key_id,
                a.id AS ref_id,
                a.title AS title,
                NULL AS difficulty, NULL AS themes,
                NULL AS fen, NULL AS solution,
                NULL AS set_code,
                a.created_at::date AS assigned_date, a.due_date,
                COALESCE(jsonb_array_length(a.questions), 0) AS activities,
                COALESCE(sub.id IS NOT NULL, FALSE) AS submitted,
                COALESCE(sub.approved, FALSE) AS approved,
                COALESCE(sub.score, 0) AS score,
                a.created_at AS assigned_at,
                sub.submitted_at,
                NULL::int AS attempts
         FROM assignments a
         LEFT JOIN assignment_submissions sub
           ON sub.assignment_id = a.id AND sub.student_id = $1
         ORDER BY assigned_at DESC
         LIMIT 80`,
        [studentId]
      ),
      db.query(
        `SELECT cl.title, cl.class_date, cl.start_time, cl.status AS session_status,
                att.status AS attendance
         FROM attendance att
         JOIN classes cl ON cl.id = att.class_id
         WHERE att.student_id = $1
         ORDER BY cl.class_date DESC, cl.start_time DESC
         LIMIT 40`,
        [studentId]
      ),
      db.query(
        `SELECT cl.id, cl.title, cl.class_date, cl.start_time, cl.end_time, cl.is_online,
                cl.meeting_url, cu.name AS coach_name
         FROM classes cl
         LEFT JOIN users cu ON cu.id = cl.coach_id
         WHERE cl.class_date >= CURRENT_DATE
           AND cl.status IN ('scheduled', 'live')
           AND (
             EXISTS (SELECT 1 FROM class_students cs WHERE cs.class_id = cl.id AND cs.student_id = $2)
             OR (NOT EXISTS (SELECT 1 FROM class_students WHERE class_id = cl.id)
                 AND (cl.group_id IS NULL OR cl.group_id = $1))
           )
         ORDER BY cl.class_date, cl.start_time
         LIMIT 25`,
        [profile.group_id, userId]
      ),
    ]);

    const pz = puzzleStats.rows[0];
    const attempts = Number(pz.attempts) || 0;
    const correct = Number(pz.correct) || 0;
    const att = attendance.rows[0];
    const rated = ratedRecord.rows[0];

    // Strengths / weaknesses are derived from puzzle theme accuracy.
    const themes = themeStats.rows.map((t) => ({
      theme: t.theme,
      attempts: Number(t.attempts) || 0,
      accuracy: Number(t.attempts)
        ? Math.round((Number(t.correct) / Number(t.attempts)) * 100)
        : 0,
    }));
    const strengths = themes.filter((t) => t.attempts >= 2 && t.accuracy >= 70).slice(0, 6);
    const weaknesses = themes.filter((t) => t.attempts >= 2 && t.accuracy <= 50).slice(0, 6);

    const assignmentsLedger = assignmentsList.rows.map((r) => ({
      kind: r.kind,
      id: r.key_id,
      refId: r.ref_id,
      title: r.title,
      difficulty: r.difficulty,
      themes: r.themes || [],
      fen: r.fen,
      solution: r.solution || [],
      setCode: r.set_code,
      assignedAt: r.assigned_at,
      dueDate: r.due_date,
      activities: Number(r.activities) || 0,
      submitted: r.submitted,
      score: Number(r.score) || 0,
      approved: r.approved,
      submittedAt: r.submitted_at,
      attempts: Number(r.attempts) || 0,
    }));
    const ledgerCompleted = assignmentsLedger.filter((a) => a.submitted);
    const ledgerPending = assignmentsLedger.filter((a) => !a.submitted);
    const completionPct = assignmentsLedger.length
      ? Math.round((ledgerCompleted.length / assignmentsLedger.length) * 100)
      : 0;

    res.json({
      profile: {
        id: profile.id,
        group_id: profile.group_id,
        coach_id: profile.coach_id,
        name: profile.name,
        email: profile.email,
        phone: profile.phone,
        country_code: profile.country_code,
        profile_image: profile.profile_image,
        avatar_config: profile.avatar_config,
        group_name: profile.group_name,
        active: profile.active,
        coach_name: profile.coach_name,
        coaches: Array.isArray(profile.coaches) ? profile.coaches : [],
        joined_at: profile.created_at,
        nickname: profile.nickname,
        birthdate: profile.birthdate,
        parent_name: profile.parent_name,
        gender: profile.gender,
        preferred_language: profile.preferred_language,
      },
      rating: ratingProfile
        ? {
            /* Rapid is the ladder now; the common rating is kept only so old
               consumers keep working, and is no longer the headline number. */
            currentRating: ratingProfile.rapid?.rating ?? ratingProfile.currentRating,
            peakRating: ratingProfile.rapid?.peakRating ?? ratingProfile.peakRating,
            gamesPlayed: ratingProfile.rapid?.gamesPlayed ?? ratingProfile.gamesPlayed,
            isProvisional: ratingProfile.rapid?.provisional ?? ratingProfile.isProvisional,
            level: ratingProfile.rapid?.level ?? ratingProfile.level,
            maxLevel: ratingProfile.maxLevel,
            rapid: ratingProfile.rapid,
            history: (ratingProfile.rapidHistory || ratingProfile.history || []).map((h) => ({
              played_at: h.played_at,
              result: h.result,
              opponent_name: h.opponent_name,
              rating: h.rating_after,
              change: h.rating_change,
            })),
          }
        : null,
      performance: {
        rated: {
          games: Number(rated.games) || 0,
          wins: Number(rated.wins) || 0,
          draws: Number(rated.draws) || 0,
          losses: Number(rated.losses) || 0,
        },
        online: {
          games: Number(onlineRecord.rows[0].games) || 0,
          draws: Number(onlineRecord.rows[0].draws) || 0,
          wins: Number(onlineRecord.rows[0].wins) || 0,
          losses: Number(onlineRecord.rows[0].losses) || 0,
          abandoned: Number(onlineRecord.rows[0].abandoned) || 0,
        },
        tournaments: {
          participated: Number(tournamentRecord.rows[0].participated) || 0,
          wins: Number(tournamentRecord.rows[0].wins) || 0,
          draws: Number(tournamentRecord.rows[0].draws) || 0,
          losses: Number(tournamentRecord.rows[0].losses) || 0,
        },
        puzzles: {
          attempts,
          correct,
          solved: Number(pz.solved) || 0,
          score: Number(pz.score) || 0,
          accuracy: attempts ? Math.round((correct / attempts) * 100) : 0,
        },
        assignments: {
          submitted: ledgerCompleted.length,
          avgScore: ledgerCompleted.length
            ? Math.round(ledgerCompleted.reduce((s, a) => s + a.score, 0) / ledgerCompleted.length)
            : 0,
          approved: ledgerCompleted.length,
          completionPct,
        },
        quizzes: {
          taken: Number(quizStats.rows[0].taken) || 0,
          avgScore: Number(quizStats.rows[0].avg_score) || 0,
          bestScore: Number(quizStats.rows[0].best_score) || 0,
          perfect: Number(quizStats.rows[0].perfect) || 0,
        },
        lessons: { completed: Number(lessons.rows[0].completed) || 0 },
        attendance: {
          total: Number(att.total) || 0,
          present: Number(att.present) || 0,
          late: Number(att.late) || 0,
          pct: att.total ? Math.round((att.present / att.total) * 100) : 0,
        },
        academy: {
          xp: Number(academy.rows[0].xp) || 0,
          sessions: Number(academy.rows[0].sessions) || 0,
          exercisesAttempted: Number(academy.rows[0].exercises_attempted) || 0,
          exercisesCorrect: Number(academy.rows[0].exercises_correct) || 0,
          bestStreak: Number(academy.rows[0].best_streak) || 0,
          badges: Number(badges.rows[0].count) || 0,
        },
        courseProgress: courseProgress.rows.map((c) => ({
          title: c.title,
          percentage:
            c.total_lessons > 0 ? Math.round((c.completed_lessons / c.total_lessons) * 100) : 0,
        })),
        strengths,
        weaknesses,
        themes,
      },
      activity: recentActivity.slice(0, 25),
      coachNotes: coachNotes.rows.map((n) => ({ created_at: n.created_at, feedback: n.coach_feedback })),
      assignmentsList: assignmentsLedger,
      classes: {
        attended: classesAttended.rows.map((r) => ({
          title: r.title,
          classDate: r.class_date,
          startTime: r.start_time,
          sessionStatus: r.session_status,
          attendance: r.attendance,
        })),
        upcoming: classesUpcoming.rows.map((r) => ({
          id: r.id,
          title: r.title,
          classDate: r.class_date,
          startTime: r.start_time,
          endTime: r.end_time,
          isOnline: r.is_online,
          meetingUrl: r.meeting_url,
          coachName: r.coach_name,
        })),
      },
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to build student report', error: err.message });
  }
};

/* Admin detail view for one puzzle within a student's homework ledger:
   the puzzle position (FEN), the expected solution, and the student's full
   attempt history (right/wrong, score, time taken, when). */
exports.studentPuzzleReport = async (req, res) => {
  try {
    const studentId = req.params.id;
    const puzzleId = req.params.puzzleId;
    if (!req.selfReport && !(await assertCoachAccess(req.user, studentId))) {
      return res.status(403).json({ message: 'You can only view students assigned to you' });
    }

    const [profileRes, puzzleRes] = await Promise.all([
      db.query('SELECT u.name, u.id AS user_id FROM students s JOIN users u ON u.id = s.user_id WHERE s.id = $1', [studentId]),
      db.query(
        `SELECT p.id, p.fen, p.solution, p.theme, p.themes, p.difficulty, p.explanation,
                p.title, p.set_code, p.rating, p.is_published
         FROM puzzles p WHERE p.id = $1`,
        [puzzleId]
      ),
    ]);
    if (profileRes.rows.length === 0) return res.status(404).json({ message: 'Student not found' });
    if (puzzleRes.rows.length === 0) return res.status(404).json({ message: 'Puzzle not found' });

    const [assignmentRes, attemptsRes] = await Promise.all([
      db.query(
        `SELECT id, assigned_date, due_date, status, points, max_attempts,
                negative_points, time_limit_seconds, notes
         FROM student_puzzle_assignments
         WHERE student_id = $1 AND puzzle_id = $2`,
        [studentId, puzzleId]
      ),
      db.query(
        `SELECT attempt_no, result, score, time_taken, points_earned, attempted_at, notes, played_moves
         FROM puzzle_attempts
         WHERE puzzle_id = $1 AND student_id = $2
         ORDER BY attempted_at ASC, attempt_no ASC`,
        [puzzleId, studentId]
      ),
    ]);

    const p = puzzleRes.rows[0];
    const attempts = attemptsRes.rows;
    const solution = Array.isArray(p.solution) ? p.solution : [];
    const assignment = assignmentRes.rows[0] || null;
    const solved = attempts.some((a) => a.result === 'correct');

    res.json({
      profile: { name: profileRes.rows[0].name, user_id: profileRes.rows[0].user_id },
      puzzle: {
        id: p.id,
        title: p.title || null,
        fen: p.fen,
        solution,
        explanation: p.explanation,
        theme: p.theme || null,
        themes: p.themes || [],
        difficulty: p.difficulty || null,
        set_code: p.set_code || null,
      },
      assignment: assignment
        ? {
            assignedDate: assignment.assigned_date,
            dueDate: assignment.due_date,
            status: assignment.status,
            points: assignment.points,
            maxAttempts: assignment.max_attempts,
            negativePoints: assignment.negative_points,
            timeLimitSeconds: assignment.time_limit_seconds,
            notes: assignment.notes,
          }
        : null,
      summary: {
        solved,
        moves: solution.length,
        attemptsUsed: attempts.length,
        correctAttempts: attempts.filter((a) => a.result === 'correct').length,
        incorrectAttempts: attempts.filter((a) => a.result === 'incorrect').length,
        bestScore: attempts.reduce((best, a) => Math.max(best, Number(a.score) || 0), 0),
        lastAttemptAt: attempts.length ? attempts[attempts.length - 1].attempted_at : null,
      },
      attempts: attempts.map((a) => ({
        attempt_no: a.attempt_no,
        result: a.result,
        score: Number(a.score) || 0,
        points_earned: a.points_earned,
        time_taken: a.time_taken,
        attempted_at: a.attempted_at,
        notes: a.notes,
        played_moves: Array.isArray(a.played_moves) ? a.played_moves : [],
      })),
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to load puzzle detail', error: err.message });
  }
};
// lessons / classes / training sessions / online matches / coach reviews.
async function buildRecentActivity(studentId, userId) {
  const [puzzles, assignments, quizzes, lessons, classes, sessions, games, reviews] =
    await Promise.all([
      db.query(
        `SELECT pa.attempted_at AS date, pa.result,
                COALESCE(pz.themes[1], 'Tactics') AS theme
         FROM puzzle_attempts pa
         LEFT JOIN puzzles pz ON pz.id = pa.puzzle_id
         WHERE pa.student_id = $1
         ORDER BY pa.attempted_at DESC LIMIT 15`,
        [studentId]
      ),
      db.query(
        `SELECT sub.submitted_at AS date, sub.score, a.title
         FROM assignment_submissions sub
         JOIN assignments a ON a.id = sub.assignment_id
         WHERE sub.student_id = $1
         ORDER BY sub.submitted_at DESC LIMIT 15`,
        [studentId]
      ),
      db.query(
        `SELECT qr.completed_at AS date, qr.score, q.title
         FROM quiz_results qr
         JOIN quizzes q ON q.id = qr.quiz_id
         WHERE qr.student_id = $1
         ORDER BY qr.completed_at DESC LIMIT 15`,
        [studentId]
      ),
      db.query(
        `SELECT lc.completed_at AS date, l.title
         FROM lesson_completion lc
         JOIN lessons l ON l.id = lc.lesson_id
         WHERE lc.student_id = $1
         ORDER BY lc.completed_at DESC LIMIT 15`,
        [studentId]
      ),
      db.query(
        `SELECT att.created_at AS date, att.status, cl.title
         FROM attendance att
         JOIN classes cl ON cl.id = att.class_id
         WHERE att.student_id = $1 AND att.status IN ('present','late')
         ORDER BY att.created_at DESC LIMIT 15`,
        [studentId]
      ),
      db.query(
        `SELECT completed_at AS date, session_kind, accuracy
         FROM academy_sessions
         WHERE user_id = $1 AND abandoned = FALSE
         ORDER BY completed_at DESC LIMIT 15`,
        [userId]
      ),
      db.query(
        `SELECT updated_at AS date, result, admin_color
         FROM online_games
         WHERE student_id = $1 AND status='finished'
         ORDER BY updated_at DESC LIMIT 15`,
        [userId]
      ),
      db.query(
        `SELECT created_at AS date
         FROM game_analysis
         WHERE student_id = $1
         ORDER BY created_at DESC LIMIT 15`,
        [studentId]
      ),
    ]);

  const feed = [];
  puzzles.rows.forEach((r) =>
    feed.push({
      date: r.date,
      type: 'puzzle',
      title: r.result === 'correct' ? 'Puzzle solved' : 'Puzzle attempted',
      detail: r.theme || 'Tactics',
    })
  );
  assignments.rows.forEach((r) =>
    feed.push({
      date: r.date,
      type: 'assignment',
      title: 'Assignment submitted',
      detail: r.score != null ? `${r.title} · ${r.score}/100` : r.title,
    })
  );
  quizzes.rows.forEach((r) =>
    feed.push({
      date: r.date,
      type: 'quiz',
      title: 'Quiz completed',
      detail: `${r.title} · ${r.score}%`,
    })
  );
  lessons.rows.forEach((r) =>
    feed.push({ date: r.date, type: 'lesson', title: 'Lesson completed', detail: r.title })
  );
  classes.rows.forEach((r) =>
    feed.push({
      date: r.date,
      type: 'class',
      title: r.status === 'late' ? 'Class attended (late)' : 'Class attended',
      detail: r.title,
    })
  );
  sessions.rows.forEach((r) =>
    feed.push({
      date: r.date,
      type: 'training',
      title: 'Training session',
      detail: `${r.session_kind} · ${Math.round(r.accuracy)}% accuracy`,
    })
  );
  games.rows.forEach((r) => {
    let label = 'Draw';
    if (r.result === 'white') label = r.admin_color === 'black' ? 'Win' : 'Loss';
    else if (r.result === 'black') label = r.admin_color === 'white' ? 'Win' : 'Loss';
    feed.push({ date: r.date, type: 'match', title: `Online match · ${label}`, detail: `vs coach (${r.result})` });
  });
  reviews.rows.forEach((r) =>
    feed.push({ date: r.date, type: 'review', title: 'Game analysed', detail: 'Coach feedback recorded' })
  );

  return feed
    .filter((f) => f.date)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

// Coach/admin: the student's "Chess Profile" (Chess.com + Lichess unified
// stats) combined with their internal academy game history.  Feeds the Combined
// report's improvement section.  Mirrors the access policy of /students/:id/report.
exports.studentChessReport = async (req, res) => {
  try {
    const studentId = req.params.id;
    if (!req.selfReport && !(await assertCoachAccess(req.user, studentId))) {
      return res.status(403).json({ message: 'You can only view students assigned to you' });
    }
    const profile = await db.query(
      `SELECT s.id, u.id AS user_id
       FROM students s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = $1`,
      [studentId]
    );
    if (!profile.rows.length) return res.status(404).json({ message: 'Student not found' });
    const userId = profile.rows[0].user_id;

    const [accounts, statistics, openings, insights, internalHistory] = await Promise.all(
      [
        unifiedProfileService.accountsForUser(userId),
        statisticsService.buildStatistics(userId, null),
        openingService.buildOpenings(userId, null),
        insightsService.buildInsights(userId),
        gameHistoryCtrl.historyForUser(userId),
      ].map((p) => p.catch((e) => {
        console.warn(`[chess-report] component failed: ${e.message}`);
        return null;
      }))
    );

    // Per-platform figures (statistics + openings) for each connected service,
    // used by the Combined report's "Academy vs Chess.com & Lichess" comparison.
    const platforms = [...new Set((accounts || []).map((a) => a.platform).filter(Boolean))];
    const platformStats = {};
    await Promise.all(
      platforms.map(async (p) => {
        try {
          platformStats[p] = {
            statistics: await statisticsService.buildStatistics(userId, p),
            openings: await openingService.buildOpenings(userId, p),
          };
        } catch (e) {
          console.warn(`[chess-report] ${p} stats failed: ${e.message}`);
          platformStats[p] = { statistics: null, openings: null };
        }
      })
    );

    res.json({
      studentId,
      userId,
      accounts: accounts || [],
      statistics: statistics || null,
      openings: openings || null,
      insights: insights || null,
      internalHistory: internalHistory || null,
      platformStats,
    });
  } catch (err) {
    console.error('studentChessReport error:', err);
    res.status(500).json({ message: 'Failed to load chess report', error: err.message });
  }
};
