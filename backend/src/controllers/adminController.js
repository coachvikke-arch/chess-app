const db = require('../config/database');
const mailService = require('../services/mailService');
const { normalisePhone } = require('../utils/phone');

/* ── Super Admin platform analytics ──────────────────────────────────────── */

exports.platformOverview = async (req, res) => {
  try {
    const [academies, students, admins, puzzles, games, assignments, classes, activeStudents] = await Promise.all([
      db.query("SELECT COUNT(*)::int AS c FROM users WHERE role='admin'"),
      db.query('SELECT COUNT(*)::int AS c FROM students'),
      db.query("SELECT COUNT(*)::int AS c FROM users WHERE role='admin'"),
      db.query('SELECT COUNT(*)::int AS c FROM puzzle_attempts'),
      db.query("SELECT COUNT(*)::int AS c FROM online_games WHERE status='finished'"),
      db.query('SELECT COUNT(*)::int AS c FROM assignments'),
      db.query('SELECT COUNT(*)::int AS c FROM classes'),
      db.query("SELECT COUNT(DISTINCT student_id)::int AS c FROM (SELECT student_id FROM puzzle_attempts WHERE attempted_at >= NOW() - INTERVAL '30 days' UNION SELECT student_id FROM attendance WHERE created_at >= NOW() - INTERVAL '30 days') t"),
    ]);
    const activeAcademies = await db.query("SELECT COUNT(*)::int AS c FROM users WHERE role='admin' AND created_at >= NOW() - INTERVAL '30 days'");
    res.json({
      totalAcademies: academies.rows[0].c,
      activeAcademies: activeAcademies.rows[0].c,
      totalStudents: students.rows[0].c,
      activeStudents: activeStudents.rows[0].c,
      totalAdmins: admins.rows[0].c,
      totalPuzzleAttempts: puzzles.rows[0].c,
      totalGames: games.rows[0].c,
      totalAssignments: assignments.rows[0].c,
      totalClasses: classes.rows[0].c,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to load platform overview', error: err.message });
  }
};

exports.platformGrowth = async (req, res) => {
  try {
    const days = Number(req.query.days || 30);
    const daysMinusOne = days - 1;
    const result = await db.query(
      `WITH all_days AS (
         SELECT generate_series(
           (CURRENT_DATE - INTERVAL '${daysMinusOne} days')::date,
           CURRENT_DATE::date,
           '1 day'
         )::date AS day
       ),
       new_users AS (
         SELECT DATE(created_at) AS day, role, COUNT(*)::int AS c
         FROM users
         WHERE created_at >= NOW() - INTERVAL '${days} days'
         GROUP BY DATE(created_at), role
       )
       SELECT to_char(d.day, 'YYYY-MM-DD') AS date,
         COALESCE(SUM(nu.c) FILTER (WHERE nu.role='student'), 0)::int AS newstudents,
         COALESCE(SUM(nu.c) FILTER (WHERE nu.role='admin'), 0)::int AS newadmins,
         COALESCE(SUM(nu.c) FILTER (WHERE nu.role='superadmin'), 0)::int AS newsuperadmins
       FROM all_days d
       LEFT JOIN new_users nu ON nu.day = d.day
       GROUP BY d.day
       ORDER BY d.day`,
      []
    );
    res.json({ days, data: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to load platform growth', error: err.message });
  }
};

exports.platformAcademies = async (req, res) => {
  try {
    const result = await db.query(
      `WITH academy_stats AS (
         SELECT
           u.id,
           u.name,
           u.email,
           u.created_at AS academy_created_at,
           u.role,
           COUNT(DISTINCT s.id)::int AS student_count,
           COUNT(*) FILTER (WHERE ca.status IN ('completed','ended'))::int AS classes_taught,
           COUNT(*) FILTER (WHERE pa.student_id IS NOT NULL)::int AS puzzle_attempts,
           COUNT(*) FILTER (WHERE og.status = 'finished')::int AS games_played
         FROM users u
         LEFT JOIN students s ON s.coach_id = u.id
         LEFT JOIN classes ca ON ca.coach_id = u.id
         LEFT JOIN puzzle_attempts pa ON pa.student_id = s.id
         LEFT JOIN online_games og ON og.student_id = s.user_id
         WHERE u.role = 'admin'
         GROUP BY u.id, u.name, u.email, u.created_at, u.role
       )
       SELECT
         id,
         name AS academy_name,
         email AS contact_email,
         role,
         to_char(academy_created_at, 'YYYY-MM-DD') AS created_at,
         student_count,
         classes_taught,
         puzzle_attempts,
         games_played,
         ROUND((student_count::numeric / NULLIF((SELECT COUNT(*)::numeric FROM students), 0)) * 100, 2) AS student_share_pct
       FROM academy_stats
       ORDER BY student_count DESC, name ASC
       LIMIT 100`,
      []
    );
    res.json({ academies: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to load academy comparison', error: err.message });
  }
};

exports.platformActivity = async (req, res) => {
  try {
    const days = Number(req.query.days || 30);
    const daysMinusOne = days - 1;
    const result = await db.query(
      `WITH academy_engagement AS (
         SELECT u.id AS academy_id, u.name AS academy_name,
           COUNT(DISTINCT s.id)::int AS total_students,
           COUNT(DISTINCT CASE WHEN pa.student_id IS NOT NULL THEN s.id END)::int AS active_students
         FROM users u
         LEFT JOIN students s ON s.coach_id = u.id
         LEFT JOIN puzzle_attempts pa ON pa.student_id = s.id AND pa.attempted_at >= NOW() - INTERVAL '${days} days'
         WHERE u.role = 'admin'
         GROUP BY u.id, u.name
       )
       SELECT academy_id, academy_name, total_students, active_students FROM academy_engagement ORDER BY total_students DESC`,
      []
    );
    res.json({ days, engagementByAcademy: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to load platform activity', error: err.message });
  }
};

exports.platformHealth = async (req, res) => {
  try {
    const [users, sessions] = await Promise.all([
      db.query('SELECT COUNT(*)::int AS c FROM users'),
      db.query("SELECT COUNT(*) FILTER (WHERE revoked_at IS NULL)::int AS active, COUNT(*) FILTER (WHERE revoked_at IS NOT NULL AND revoked_at >= NOW() - INTERVAL '24 hours')::int AS revoked_24h, COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours')::int AS new_24h FROM user_sessions"),
    ]);
    res.json({
      database: { healthy: true, userCount: users.rows[0].c },
      sessions: {
        active: sessions.rows[0].active,
        revoked24h: sessions.rows[0].revoked_24h,
        new24h: sessions.rows[0].new_24h,
      },
      security: { revokedSessions24h: sessions.rows[0].revoked_24h },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to load platform health', error: err.message });
  }
};

/* ── Openings library ────────────────────────────────────────────────────── */
exports.listOpeningsLibrary = async (req, res) => {
  try {
    const r = await db.query('SELECT * FROM opening_lines ORDER BY id LIMIT 200');
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ message: 'Failed to load openings library', error: err.message });
  }
};

/* ── Accounts / recovery codes ───────────────────────────────────────────── */
exports.listAccounts = async (req, res) => {
  try {
    const r = await db.query('SELECT id, name, email, username, phone, country_code, role, created_at FROM users ORDER BY id');
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ message: 'Failed to list accounts', error: err.message });
  }
};

exports.issueRecoveryCode = async (req, res) => {
  res.status(501).json({ message: 'Not implemented' });
};

exports.revokeRecoveryCode = async (req, res) => {
  res.status(501).json({ message: 'Not implemented' });
};

exports.resetUserPassword = async (req, res) => {
  res.status(501).json({ message: 'Not implemented' });
};

/* ── Admin CRUD ──────────────────────────────────────────────────────────── */
exports.listAdmins = async (req, res) => {
  try {
    const r = await db.query("SELECT id, name, email, username, phone, country_code, role, created_at FROM users WHERE role IN ('admin','superadmin') ORDER BY id");
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ message: 'Failed to list admins', error: err.message });
  }
};

exports.listAdminStudents = async (req, res) => {
  try {
    const r = await db.query('SELECT * FROM students WHERE coach_id = $1', [req.params.id]);
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ message: 'Failed to list admin students', error: err.message });
  }
};

exports.adminReport = async (req, res) => {
  res.json({});
};

exports.performanceReport = async (req, res) => {
  res.json({});
};

exports.getAdmin = async (req, res) => {
  try {
    const r = await db.query(
      "SELECT id, name, email, username, phone, country_code, role, created_at FROM users WHERE id = $1 AND role IN ('admin','superadmin')",
      [req.params.id]
    );
    if (r.rows.length === 0) return res.status(404).json({ message: 'Not found' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Failed to get admin', error: err.message });
  }
};

/* A coach may edit their own record; the super admin may edit any coach.
   The route-level guard enforces that before this runs. */
exports.updateAdmin = async (req, res) => {
  try {
    const target = await db.query(
      "SELECT id, name, email, phone, country_code, role FROM users WHERE id = $1 AND role IN ('admin','superadmin')",
      [req.params.id]
    );
    if (target.rows.length === 0) return res.status(404).json({ message: 'Admin not found' });
    const current = target.rows[0];

    const { name, email, phone } = req.body;
    if (name !== undefined && !String(name).trim()) {
      return res.status(400).json({ message: 'Name cannot be empty' });
    }
    if (email !== undefined) {
      if (!mailService.isValidEmail(String(email).trim())) {
        return res.status(400).json({ message: 'Enter a valid email address' });
      }
      const dup = await db.query('SELECT id FROM users WHERE email ILIKE $1 AND id <> $2', [String(email).trim(), current.id]);
      if (dup.rows.length > 0) {
        return res.status(400).json({ message: 'That email is already in use by another account' });
      }
    }

    const phoneChange = normalisePhone({
      phone,
      countryCode: req.body.countryCode,
      phoneNumber: req.body.phoneNumber,
    });
    if (phoneChange.error) return res.status(400).json({ message: phoneChange.error });

    const updates = [];
    const params = [current.id];
    if (name !== undefined) {
      updates.push(`name = $${params.length + 1}`);
      params.push(String(name).trim());
    }
    if (email !== undefined) {
      updates.push(`email = $${params.length + 1}`);
      params.push(String(email).trim());
    }
    if (phoneChange.changed) {
      updates.push(`phone = $${params.length + 1}`);
      params.push(phoneChange.phone);
      updates.push(`country_code = $${params.length + 1}`);
      params.push(phoneChange.countryCode);
    }
    if (updates.length === 0) {
      return res.json({ ...current });
    }

    const updated = await db.query(
      `UPDATE users SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $1
       RETURNING id, name, email, username, phone, country_code, role, created_at`,
      params
    );
    res.json(updated.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Failed to update admin', error: err.message });
  }
};

exports.deleteAdmin = async (req, res) => {
  res.status(501).json({ message: 'Not implemented' });
};
