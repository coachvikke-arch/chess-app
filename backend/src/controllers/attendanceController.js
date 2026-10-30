const db = require('../config/database');
const notif = require('../services/notificationService');

/* ═══════════════ the student's own attendance list ═══════════════
 *
 * One record per thing that happened on a date: an attendance row (marked from
 * the offline register, or written when the student joined a live class) plus
 * the online classes they can see that nobody has marked yet. Both come out of
 * the same `attendance` table / `classes` table the admin screens already use —
 * nothing is duplicated, this only reads it the other way round: by student and
 * date instead of by class.
 *
 * `studentId` is NEVER a parameter. The student is resolved from the JWT
 * (`students.user_id = req.user.id`), so editing the query string cannot reach
 * another student's rows.
 */

/* Same visibility rule as classController.listOnlineClasses: an explicit
   class_students roster wins; otherwise the class' batch (group) members;
   otherwise everyone. Kept identical so the "not marked yet" rows are exactly
   the classes the student already saw on this page before offline records
   existed. */
function recordsSql(legacy = false) {
  const markedColumns = legacy
    ? `COALESCE(cl.class_date, a.created_at::date) AS attendance_date,
           a.status,
           CASE WHEN cl.is_online THEN 'online' ELSE 'offline' END AS type,
           NULL::varchar AS marked_by_name, NULL::varchar AS marked_by_role,
           NULL::timestamp AS marked_at`
    : `COALESCE(a.attendance_date, a.created_at::date) AS attendance_date,
           a.status,
           a.type,
           a.marked_by_name, a.marked_by_role, a.marked_at`;

  return `
  WITH mine AS (
    SELECT id, group_id FROM students WHERE user_id = $1
  ),
  marked AS (
    SELECT ${markedColumns},
           cl.id AS class_id, cl.title, cl.topic, cl.start_time,
           u.name AS coach_name
      FROM attendance a
      JOIN mine st ON st.id = a.student_id
      LEFT JOIN classes cl ON cl.id = a.class_id
      LEFT JOIN users u ON u.id = cl.coach_id
  ),
  unmarked AS (
    SELECT cl.class_date AS attendance_date,
           NULL::varchar AS status,
           'online' AS type,
           NULL::varchar AS marked_by_name, NULL::varchar AS marked_by_role,
           NULL::timestamp AS marked_at,
           cl.id AS class_id, cl.title, cl.topic, cl.start_time,
           u.name AS coach_name
      FROM classes cl
      CROSS JOIN mine st
      LEFT JOIN users u ON u.id = cl.coach_id
     WHERE cl.is_online = TRUE
       AND (cl.meeting_url IS NOT NULL OR cl.class_type = 'integrated')
       AND (
         EXISTS (SELECT 1 FROM class_students cs
                  WHERE cs.class_id = cl.id AND cs.student_id = st.id)
         OR (
           NOT EXISTS (SELECT 1 FROM class_students cs2 WHERE cs2.class_id = cl.id)
           AND (cl.group_id IS NULL OR cl.group_id = st.group_id)
         )
       )
       AND NOT EXISTS (
         SELECT 1 FROM attendance a2
          WHERE a2.class_id = cl.id AND a2.student_id = st.id
       )
  ),
  all_records AS (
    SELECT * FROM marked UNION ALL SELECT * FROM unmarked
  )`;
}

const RECORDS_SQL = recordsSql();
const LEGACY_RECORDS_SQL = recordsSql(true);

const TYPE_VALUES = new Set(['all', 'online', 'offline']);
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** WHERE + params for one filter set. `$1` is always the caller's user id. */
function buildWhere({ type, month, useMonth = true }) {
  const clauses = [];
  const params = [];
  let n = 1;

  if (type && type !== 'all') {
    params.push(type);
    clauses.push(`type = $${++n}`);
  }
  if (useMonth && month && MONTH_RE.test(month)) {
    params.push(month);
    clauses.push(`to_char(attendance_date, 'YYYY-MM') = $${++n}`);
  }

  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

async function queryOwnAttendance(sql, { userId, page, limit, listFilter, summaryFilter }) {
  return Promise.all([
    db.query(
      `${sql}
       SELECT to_char(attendance_date, 'YYYY-MM-DD')        AS "date",
              to_char(attendance_date, 'DD Mon YYYY')       AS "dateLabel",
              status,
              type,
              class_id                                      AS "classId",
              title                                         AS "classTitle",
              topic,
              start_time                                    AS "startTime",
              coach_name                                    AS "coachName",
              marked_by_name                                AS "markedByName",
              marked_by_role                                AS "markedByRole",
              to_char(marked_at, 'DD Mon YYYY, HH24:MI')    AS "markedAt",
              COUNT(*)::int OVER ()                         AS "total"
         FROM all_records
         ${listFilter.where}
        ORDER BY attendance_date DESC NULLS LAST,
                 start_time DESC NULLS LAST,
                 class_id DESC NULLS LAST
        LIMIT $${listFilter.params.length + 2}
       OFFSET $${listFilter.params.length + 3}`,
      [userId, ...listFilter.params, limit, (page - 1) * limit]
    ),
    db.query(
      `${sql}
       SELECT COUNT(*)::int                                            AS total,
              COUNT(*) FILTER (WHERE status = 'present')::int          AS present,
              COUNT(*) FILTER (WHERE status = 'late')::int             AS late,
              COUNT(*) FILTER (WHERE status = 'absent')::int           AS absent,
              COUNT(*) FILTER (WHERE type = 'offline')::int            AS offline
         FROM all_records
         ${summaryFilter.where}`,
      [userId, ...summaryFilter.params]
    ),
  ]);
}

exports.myAttendance = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const type = TYPE_VALUES.has(req.query.type) ? req.query.type : 'all';
    const month = MONTH_RE.test(String(req.query.month || '')) ? req.query.month : '';

    const listFilter = buildWhere({ type, month });
    /* The month cards answer "how did I do this month", so they follow the
       calendar, not the type chips — filtering to Offline must not silently
       drop the online half of the rate. */
    const summaryFilter = buildWhere({ month });
    const args = { userId: req.user.id, page, limit, listFilter, summaryFilter };

    let listRes;
    let summaryRes;
    try {
      [listRes, summaryRes] = await queryOwnAttendance(RECORDS_SQL, args);
    } catch (err) {
      /* Older installations predate the additive marker migration. Keep their
         existing attendance readable instead of turning the whole page into a
         500; standalone admin writes still require the migrated schema. */
      if (err.code !== '42703') throw err;
      [listRes, summaryRes] = await queryOwnAttendance(LEGACY_RECORDS_SQL, args);
    }

    const s = summaryRes.rows[0] || { total: 0, present: 0, late: 0, absent: 0 };
    /* The rate is Present over the *marked* records only — an unmarked upcoming
       class is not an absence, and counting it as one would push every
       student's percentage down before their first lesson. */
    const graded = (s.present || 0) + (s.late || 0) + (s.absent || 0);
    const total = listRes.rows[0]?.total ?? s.total;

    res.json({
      records: listRes.rows,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      filters: { type, month },
      summary: {
        total: s.total || 0,
        present: s.present || 0,
        late: s.late || 0,
        absent: s.absent || 0,
        offline: s.offline || 0,
        rate: graded ? Math.round((s.present / graded) * 100) : 0,
        graded,
      },
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to load attendance', error: err.message });
  }
};

/* ═══════════════ admin: standalone offline attendance ═══════════════ */

const OFFLINE_STATUSES = new Set(['present', 'late', 'absent']);
const STATUS_LABEL = { present: 'Present', late: 'Late', absent: 'Absent' };
const CLEAR_TOKENS = new Set(['', 'null', 'none', 'clear', 'cleared', 'remove', 'removed', 'unmarked']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

const OFFLINE_ROSTER_SELECT = `
  SELECT s.id, s.group_id, s.coach_id, s.user_id,
         u.name, u.email, u.profile_image, u.avatar_config,
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
   WHERE 1=1`;

function isDateKey(value) {
  const key = String(value || '');
  if (!DATE_RE.test(key)) return false;
  const parsed = new Date(`${key}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === key;
}

function dateLabel(dateKey) {
  return new Date(`${dateKey}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

function dateRange(startDate, endDate) {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  const count = Math.round((end - start) / DAY_MS) + 1;
  if (count < 1 || count > 31) return null;
  return Array.from({ length: count }, (_, index) =>
    new Date(start + index * DAY_MS).toISOString().slice(0, 10));
}

async function offlineRoster(user, query = db.query) {
  const params = [];
  let scope = '';
  if (user.role !== 'superadmin') {
    params.push(user.id);
    scope = ` AND (s.coach_id = $1 OR EXISTS (
      SELECT 1 FROM student_coaches sc
       WHERE sc.student_id = s.id AND sc.coach_id = $1))`;
  }
  const result = await query(
    `${OFFLINE_ROSTER_SELECT}${scope} ORDER BY u.name ASC, s.id ASC`,
    params
  );
  return result.rows;
}

function rosterStudent(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    profileImage: row.profile_image,
    avatarConfig: row.avatar_config,
    groupId: row.group_id,
    groupName: row.group_name,
    coachId: row.coach_id,
    coachName: row.coach_name,
    coaches: Array.isArray(row.coaches) ? row.coaches : [],
  };
}

function offlineMigrationError(res, err, message) {
  if (err.code === '42703' || err.code === '42P10') {
    return res.status(503).json({ message: 'Offline attendance requires the latest database migration' });
  }
  return res.status(err.status || 500).json({ message: err.status ? err.message : message, error: err.message });
}

exports.offlineDay = async (req, res) => {
  try {
    const date = String(req.query.date || '');
    if (!isDateKey(date)) return res.status(400).json({ message: 'A valid date is required' });

    const roster = await offlineRoster(req.user);
    const byStudent = new Map();
    if (roster.length) {
      const marks = await db.query(
        `SELECT a.student_id, a.status, a.marked_by_name, a.marked_by_role,
                to_char(a.marked_at, 'DD Mon YYYY, HH24:MI') AS marked_at
           FROM attendance a
          WHERE a.class_id IS NULL AND a.type = 'offline'
            AND a.attendance_date = $1::date
            AND a.student_id = ANY($2::int[])`,
        [date, roster.map((s) => s.id)]
      );
      for (const mark of marks.rows) byStudent.set(mark.student_id, mark);
    }

    res.json({
      date,
      students: roster.map((row) => {
        const mark = byStudent.get(row.id);
        return {
          ...rosterStudent(row),
          status: mark?.status || '',
          markedByName: mark?.marked_by_name || null,
          markedByRole: mark?.marked_by_role || null,
          markedAt: mark?.marked_at || null,
        };
      }),
    });
  } catch (err) {
    offlineMigrationError(res, err, 'Failed to load offline attendance');
  }
};

exports.offlineOverview = async (req, res) => {
  try {
    const startDate = String(req.query.startDate || '');
    const endDate = String(req.query.endDate || '');
    if (!isDateKey(startDate) || !isDateKey(endDate)) {
      return res.status(400).json({ message: 'Valid start and end dates are required' });
    }
    const dates = dateRange(startDate, endDate);
    if (!dates) return res.status(400).json({ message: 'Date range must be 1–31 days' });

    const roster = await offlineRoster(req.user);
    let records = [];
    if (roster.length) {
      const result = await db.query(
        `SELECT a.student_id,
                to_char(a.attendance_date, 'YYYY-MM-DD') AS date,
                a.status
           FROM attendance a
          WHERE a.class_id IS NULL AND a.type = 'offline'
            AND a.attendance_date BETWEEN $1::date AND $2::date
            AND a.student_id = ANY($3::int[])
          ORDER BY a.attendance_date ASC, a.student_id ASC`,
        [startDate, endDate, roster.map((s) => s.id)]
      );
      records = result.rows.map((row) => ({
        studentId: row.student_id,
        date: row.date,
        status: row.status,
      }));
    }

    res.json({
      startDate,
      endDate,
      dates,
      students: roster.map(rosterStudent),
      records,
    });
  } catch (err) {
    offlineMigrationError(res, err, 'Failed to load attendance overview');
  }
};

exports.saveOfflineDay = async (req, res) => {
  let client;
  try {
    const date = String(req.body?.date || '');
    if (!isDateKey(date)) return res.status(400).json({ message: 'A valid date is required' });
    const input = req.body?.records;
    if (!Array.isArray(input) || input.length > 1000) {
      return res.status(400).json({ message: 'records must be an array of at most 1000 marks' });
    }
    if (input.length === 0) return res.json({ date, saved: 0, cleared: 0, records: [] });

    const seen = new Set();
    const marks = [];
    for (const item of input) {
      const studentId = Number(item?.studentId);
      if (!Number.isInteger(studentId) || studentId <= 0 || seen.has(studentId)) {
        return res.status(400).json({ message: 'Each record needs one valid, unique studentId' });
      }
      seen.add(studentId);
      const value = item?.status == null ? '' : String(item.status).trim().toLowerCase();
      const status = CLEAR_TOKENS.has(value) ? '' : value;
      if (status && !OFFLINE_STATUSES.has(status)) {
        return res.status(400).json({ message: 'status must be present, late, absent or empty' });
      }
      marks.push({ studentId, status });
    }

    client = await db.pool.connect();
    let roster;
    const written = [];
    let cleared = 0;
    try {
      await client.query('BEGIN');
      roster = await offlineRoster(req.user, (sql, params) => client.query(sql, params));
      const allowed = new Map(roster.map((row) => [row.id, row]));
      for (const mark of marks) {
        const student = allowed.get(mark.studentId);
        if (!student) {
          const err = new Error('One or more students are outside your assigned roster');
          err.status = 403;
          throw err;
        }

        if (!mark.status) {
          await client.query(
            `DELETE FROM attendance
              WHERE class_id IS NULL AND type = 'offline'
                AND student_id = $1 AND attendance_date = $2::date`,
            [mark.studentId, date]
          );
          cleared += 1;
          continue;
        }

        const result = await client.query(
          `INSERT INTO attendance
             (class_id, student_id, status, attendance_date, type,
              marked_by, marked_by_name, marked_by_role, marked_at)
           VALUES (NULL, $1, $2, $3::date, 'offline', $4, $5, $6, NOW())
           ON CONFLICT (student_id, attendance_date)
           WHERE class_id IS NULL AND type = 'offline'
           DO UPDATE SET
             status = EXCLUDED.status,
             marked_by = EXCLUDED.marked_by,
             marked_by_name = EXCLUDED.marked_by_name,
             marked_by_role = EXCLUDED.marked_by_role,
             marked_at = NOW()
           RETURNING id`,
          [mark.studentId, mark.status, date, req.user.id, req.user.name || null, req.user.role]
        );
        written.push({ ...mark, attendanceId: result.rows[0]?.id || null });
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
      client = null;
    }

    const rosterById = new Map(roster.map((row) => [row.id, row]));
    await Promise.all(written.map(async (mark) => {
      const userId = rosterById.get(mark.studentId)?.user_id;
      if (!userId) return;
      try {
        await notif.push(
          req.app.get('io'),
          userId,
          'Attendance updated',
          `Your offline attendance for ${dateLabel(date)} was marked ${STATUS_LABEL[mark.status]} by ${req.user.name || 'an admin'}`,
          { type: 'attendance', senderId: req.user.id, relatedId: mark.attendanceId }
        );
      } catch (err) {
        console.warn('[saveOfflineDay] notification skipped:', err.message);
      }
    }));

    res.json({
      date,
      saved: written.length,
      cleared,
      records: written.map(({ studentId, status, attendanceId }) => ({ studentId, status, attendanceId })),
    });
  } catch (err) {
    if (client) client.release();
    offlineMigrationError(res, err, 'Failed to save offline attendance');
  }
};
