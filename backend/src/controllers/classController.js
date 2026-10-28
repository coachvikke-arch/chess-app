const db = require('../config/database');
const { normalizeMeetingUrl } = require('../utils/meetingUrl');

async function notifyStudentUserIds(classId, groupId) {
  if (classId) {
    const explicit = await db.query(
      `SELECT s.user_id FROM class_students cs
       JOIN students s ON s.id = cs.student_id
       WHERE cs.class_id = $1 AND s.user_id IS NOT NULL`,
      [classId]
    );
    if (explicit.rows.length > 0) return explicit.rows.map((x) => x.user_id);
  }
  if (groupId) {
    const r = await db.query(
      'SELECT user_id FROM students WHERE group_id = $1 AND user_id IS NOT NULL',
      [groupId]
    );
    return r.rows.map((x) => x.user_id);
  }
  const r = await db.query(
    'SELECT user_id FROM students WHERE user_id IS NOT NULL'
  );
  return r.rows.map((x) => x.user_id);
}

async function notifyMeeting(userIds, title, message) {
  if (!userIds.length) return;
  for (const userId of userIds) {
    await db.query(
      'INSERT INTO notifications (user_id, title, message) VALUES ($1, $2, $3)',
      [userId, title, message]
    );
  }
}

async function sendMeetingReminders(minutes = 30) {  const r = await db.query(
    `SELECT cl.id, cl.title, cl.meeting_url, cl.class_date, cl.start_time, cl.group_id, cl.class_type, cl.classroom_enabled,
            (cl.class_date + cl.start_time)::timestamp AS starts_at,
            s.user_id
     FROM classes cl
     JOIN students s ON (
       EXISTS (SELECT 1 FROM class_students cs WHERE cs.class_id = cl.id AND cs.student_id = s.id)
       OR (
         NOT EXISTS (SELECT 1 FROM class_students cs2 WHERE cs2.class_id = cl.id)
         AND (cl.group_id IS NULL OR cl.group_id = s.group_id)
       )
     )
     WHERE cl.is_online = TRUE
       AND s.user_id IS NOT NULL
       AND (cl.class_date + cl.start_time)::timestamp > NOW()
       AND (cl.class_date + cl.start_time)::timestamp <= NOW() + ($1 || ' minutes')::interval
AND (cl.meeting_url IS NOT NULL OR cl.class_type = 'integrated')
      AND NOT EXISTS (
        SELECT 1 FROM notifications n
        WHERE n.user_id = s.user_id
          AND n.title LIKE 'Class starting soon:%'
          AND n.message LIKE '%#class-' || cl.id::text || '%'
      )`,
    [minutes]
  );
  for (const row of r.rows) {
    const usesClassroom = row.class_type === 'integrated' || row.classroom_enabled !== false;
    const joinInfo = usesClassroom
      ? `Open the app and go to Live Classes. #class-${row.id}`
      : `Join here: ${row.meeting_url} #class-${row.id}`;
    await notifyMeeting(
      [row.user_id],
      `Class starting soon: ${row.title}`,
      `Your online class "${row.title}" starts at ${row.start_time} today. ${joinInfo}`
    );
  }
  return r.rows.length;
}

exports.listClasses = async (req, res) => {
  try {
    /* `rl` is the roster a class actually teaches: the explicit class_students
       list when there is one, otherwise the batch roster — the same scope
       getClassDetail resolves. The Completed cards need it per row (names for
       the avatars and for student-name search) without an N+1 fetch. */
    let from = `FROM classes cl
      LEFT JOIN groups g ON g.id = cl.group_id
      LEFT JOIN users cu ON cu.id = cl.coach_id
      LEFT JOIN LATERAL (
        SELECT COALESCE(json_agg(roster.name ORDER BY roster.name), '[]'::json) AS student_list
        FROM (
          SELECT su.name
            FROM class_students cs
            JOIN students s ON s.id = cs.student_id
            JOIN users su ON su.id = s.user_id
           WHERE cs.class_id = cl.id
          UNION
          SELECT su2.name
            FROM students s2
            JOIN users su2 ON su2.id = s2.user_id
           WHERE cl.group_id IS NOT NULL
             AND s2.group_id = cl.group_id
             AND NOT EXISTS (SELECT 1 FROM class_students cx WHERE cx.class_id = cl.id)
        ) roster
      ) rl ON TRUE`;
    const params = [];
    const conditions = [];
    if (req.user.role === 'student') {
      from += ' JOIN students st ON st.user_id = $1';
      conditions.push(`(EXISTS (SELECT 1 FROM class_students cs WHERE cs.class_id = cl.id AND cs.student_id = st.id)
          OR (
            NOT EXISTS (SELECT 1 FROM class_students cs2 WHERE cs2.class_id = cl.id)
            AND (cl.group_id IS NULL OR cl.group_id = st.group_id)
          ))`);
      params.push(req.user.id);
    }

    /* Optional filters for the Completed section. Both are additive: a caller
       that sends neither gets exactly the list it got before. `status` is
       bound as a parameter, and `q` matches the title, topic, coach or any
       student on the resolved roster. */
    const statusFilter = String(req.query.status || '').trim();
    if (statusFilter) {
      params.push(statusFilter);
      conditions.push(`cl.status = $${params.length}`);
    }
    const search = String(req.query.q || '').trim().slice(0, 80);
    if (search) {
      params.push(`%${search}%`);
      const at = `$${params.length}`;
      conditions.push(`(cl.title ILIKE ${at} OR cl.topic ILIKE ${at} OR cu.name ILIKE ${at} OR rl.student_list::text ILIKE ${at})`);
    }
    const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    /* Completed cards are ordered by when the class actually ended so the most
       recently finished one leads. Every other list keeps date-then-time. */
    const orderSql = statusFilter === 'completed'
      ? `ORDER BY COALESCE(cl.ended_at, cl.class_date + cl.start_time) DESC NULLS LAST,
           cl.class_date DESC, cl.start_time DESC`
      : 'ORDER BY cl.class_date DESC, cl.start_time DESC';

    /* Unpaged callers (the student dashboard and every existing consumer) keep
       getting the flat array they always got. Pagination is opt-in via ?page or
       ?limit so nothing else has to change. */
    if (req.query.page === undefined && req.query.limit === undefined) {
      const result = await db.query(
        `SELECT cl.*, g.name AS group_name,
            (SELECT COUNT(*) FROM class_students cs WHERE cs.class_id = cl.id) AS student_count,
            (SELECT string_agg(u.name, ', ' ORDER BY u.name)
               FROM class_students cs
               JOIN students s ON s.id = cs.student_id
               JOIN users u ON u.id = s.user_id
               WHERE cs.class_id = cl.id) AS student_names
          ${from}
          ${whereSql}
          ${orderSql}`,
        params
      );
      return res.json(result.rows);
    }

    const limitRaw = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 25;
    const countResult = await db.query(`SELECT COUNT(*)::int AS total ${from} ${whereSql}`, params);
    const total = countResult.rows[0]?.total || 0;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const pageRaw = parseInt(req.query.page, 10);
    const page = Math.min(Math.max(Number.isFinite(pageRaw) ? pageRaw : 1, 1), totalPages);

    const result = await db.query(
      `SELECT cl.*, g.name AS group_name, cu.name AS coach_name, rl.student_list,
          (SELECT COUNT(*) FROM class_students cs WHERE cs.class_id = cl.id) AS student_count,
          (SELECT string_agg(u.name, ', ' ORDER BY u.name)
             FROM class_students cs
             JOIN students s ON s.id = cs.student_id
             JOIN users u ON u.id = s.user_id
             WHERE cs.class_id = cl.id) AS student_names,
          CASE WHEN cl.started_at IS NOT NULL AND cl.ended_at IS NOT NULL
               THEN GREATEST(0, ROUND(EXTRACT(EPOCH FROM (cl.ended_at - cl.started_at)) / 60)::int)
          END AS actual_minutes,
          CASE WHEN cl.end_time IS NOT NULL
               THEN GREATEST(0, ROUND(EXTRACT(EPOCH FROM (
                      CASE WHEN cl.end_time >= cl.start_time
                           THEN cl.end_time - cl.start_time
                           ELSE cl.end_time - cl.start_time + interval '24 hours'
                      END
                    )) / 60)::int)
          END AS scheduled_minutes
        ${from}
        ${whereSql}
        ${orderSql}
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, (page - 1) * limit]
    );
    const classes = result.rows.map(({ actual_minutes, scheduled_minutes, ...row }) => ({
      ...row,
      duration_minutes: actual_minutes != null ? actual_minutes : scheduled_minutes,
      duration_source: actual_minutes != null ? 'actual' : scheduled_minutes != null ? 'scheduled' : null,
    }));
    res.json({ classes, total, page, totalPages, limit });
  } catch (err) {
    res.status(500).json({ message: 'Failed to list classes', error: err.message });
  }
};

exports.listOnlineClasses = async (req, res) => {
  try {
    await sendMeetingReminders(30);
    const result = await db.query(
      `SELECT cl.*, g.name AS group_name, u.name AS coach_name,
              (SELECT string_agg(u.name, ', ' ORDER BY u.name)
                 FROM class_students cs
                 JOIN students s ON s.id = cs.student_id
                 JOIN users u ON u.id = s.user_id
                 WHERE cs.class_id = cl.id) AS student_names,
              (cl.class_date + cl.start_time)::timestamp AS starts_at,
              CASE
                WHEN cl.status = 'live' THEN 'live'::text
                WHEN cl.status = 'cancelled' THEN 'cancelled'::text
                WHEN cl.status = 'completed' THEN 'completed'::text
                WHEN (cl.class_date + cl.start_time)::timestamp <= NOW() + interval '30 minutes'
                     THEN 'starting-soon'::text
                ELSE 'upcoming'::text
              END AS live_status,
              a.status AS my_status
       FROM classes cl
       LEFT JOIN groups g ON g.id = cl.group_id
       LEFT JOIN users u ON u.id = cl.coach_id
       JOIN students st ON st.user_id = $1
       LEFT JOIN attendance a ON a.class_id = cl.id AND a.student_id = st.id
       WHERE cl.is_online = TRUE
         AND (cl.meeting_url IS NOT NULL OR cl.class_type = 'integrated')
         AND (
           EXISTS (SELECT 1 FROM class_students cs WHERE cs.class_id = cl.id AND cs.student_id = st.id)
           OR (
             NOT EXISTS (SELECT 1 FROM class_students cs2 WHERE cs2.class_id = cl.id)
             AND (cl.group_id IS NULL OR cl.group_id = st.group_id)
           )
         )
       ORDER BY (cl.class_date + cl.start_time)::timestamp ASC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Failed to list online classes', error: err.message });
  }
};

exports.myUpcomingClasses = async (req, res) => {
  try {
    const stu = await db.query('SELECT id, group_id FROM students WHERE user_id = $1', [req.user.id]);
    if (stu.rows.length === 0) return res.status(404).json({ message: 'Student record not found' });
    const student = stu.rows[0];
    const result = await db.query(
      `SELECT cl.id, cl.title, cl.topic, cl.description, cl.class_date, cl.start_time, cl.end_time,
              cl.is_online, cl.meeting_url, cl.status, cl.class_type, cl.classroom_enabled,
              cu.name AS coach_name
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
       LIMIT 15`,
      [student.group_id, student.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Failed to load upcoming classes', error: err.message });
  }
};

exports.createClass = async (req, res) => {
  try {
    const { title, description, topic, classDate, startTime, endTime, meetingUrl, materialUrl, groupId, isOnline, studentIds, classType, status, thumbnail, studentInteractionEnabled, classroomEnabled } = req.body;
    const classTypeVal = classType === 'integrated' ? 'integrated' : 'external';
    const isOnlineFlag = classTypeVal === 'integrated' ? true : (isOnline === true || isOnline === 'true');
    const statusVal = status || 'scheduled';
    const thumbnailVal = thumbnail || null;
    const studentInteractionVal = studentInteractionEnabled === true || studentInteractionEnabled === 'true';
    const classroomEnabledVal = classTypeVal === 'external' ? (classroomEnabled !== false && classroomEnabled !== 'false') : true;

    let studentIdsArr = Array.isArray(studentIds)
      ? [...new Set(studentIds)].filter((n) => Number.isInteger(Number(n)) && Number(n) > 0).map(Number)
      : [];
    let groupIdVal = groupId || null;

    const client = await db.pool.connect();
    let created;
    try {
      await client.query('BEGIN');

      const result = await client.query(
        `INSERT INTO classes (title, description, topic, class_date, start_time, end_time, meeting_url, material_url, group_id, coach_id, is_online, class_type, status, thumbnail, student_interaction_enabled, classroom_enabled)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
        [title, description, topic, classDate, startTime, endTime, meetingUrl, materialUrl, groupIdVal, req.user.id, isOnlineFlag, classTypeVal, statusVal, thumbnailVal, studentInteractionVal, classroomEnabledVal]
      );
      created = result.rows[0];

      if (studentIdsArr.length > 0) {
        const sRes = await client.query(
          'SELECT id FROM students WHERE id = ANY($1)', [studentIdsArr]
        );
        studentIdsArr = sRes.rows.map((r) => r.id);
        if (studentIdsArr.length > 0) {
          await client.query(
            `INSERT INTO class_students (class_id, student_id)
             SELECT $1, unnest($2::int[])
             ON CONFLICT (class_id, student_id) DO NOTHING`,
            [created.id, studentIdsArr]
          );
        }
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    if (created) {
      const userIds = await notifyStudentUserIds(created.id, groupIdVal);
      if (classTypeVal === 'integrated') {
        await notifyMeeting(
          userIds,
          `New live class scheduled: ${title}`,
          `A new Integrated Live Classroom "${title}" is scheduled for ${classDate} at ${startTime}. Topic: ${topic || 'General'}. Open Mate Zone to join. #class-${created.id}`
        );
      } else if (isOnlineFlag && meetingUrl) {
        await notifyMeeting(
          userIds,
          `New online class: ${title}`,
          `A new live class "${title}" is scheduled for ${classDate} at ${startTime}. Topic: ${topic || 'General'}. Join: ${normalizeMeetingUrl(meetingUrl)} #class-${created.id}`
        );
      }
    }
    res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ message: 'Failed to create class', error: err.message });
  }
};

exports.updateClass = async (req, res) => {
  try {
    const existing = await db.query('SELECT * FROM classes WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) return res.status(404).json({ message: 'Class not found' });
    const prev = existing.rows[0];

    const { title, description, topic, classDate, startTime, endTime, meetingUrl, materialUrl, groupId, status, classType, thumbnail, chatMode, studentInteractionEnabled, classroomEnabled } = req.body;

    const classTypeVal = classType ? (classType === 'integrated' ? 'integrated' : 'external') : prev.class_type;
    const isOnlineVal = classTypeVal === 'integrated' ? true : prev.is_online;
    const classroomEnabledVal = classroomEnabled === undefined
      ? (classTypeVal === 'external' ? prev.classroom_enabled !== false : true)
      : (classTypeVal === 'external' ? (classroomEnabled !== false && classroomEnabled !== 'false') : true);

    const result = await db.query(
      `UPDATE classes SET title=COALESCE($1,title), description=COALESCE($2,description), topic=COALESCE($3,topic),
       class_date=COALESCE($4,class_date), start_time=COALESCE($5,start_time), end_time=COALESCE($6,end_time),
       meeting_url=COALESCE($7,meeting_url), material_url=COALESCE($8,material_url), group_id=COALESCE($9,group_id),
       status=COALESCE($10,status), class_type=COALESCE($11,class_type), thumbnail=COALESCE($12,thumbnail),
       chat_mode=COALESCE($13,chat_mode), student_interaction_enabled=COALESCE($14,student_interaction_enabled),
       is_online=COALESCE($15,is_online), classroom_enabled=$16
       WHERE id=$17 RETURNING *`,
      [title, description, topic, classDate, startTime, endTime, meetingUrl, materialUrl, groupId || null,
       status, classTypeVal, thumbnail, chatMode, studentInteractionEnabled, isOnlineVal, classroomEnabledVal, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: 'Class not found' });
    const updated = result.rows[0];

    const dateChanged = (classDate && classDate !== String(prev.class_date)) ||
                        (startTime && startTime !== String(prev.start_time));
    if (dateChanged && (updated.meeting_url || updated.class_type === 'integrated') && updated.is_online) {
      const userIds = await notifyStudentUserIds(updated.id, updated.group_id);
      await notifyMeeting(
        userIds,
        `Class time changed: ${updated.title}`,
        `The time for class "${updated.title}" has changed. New date/time: ${updated.class_date} at ${updated.start_time}. #class-${updated.id}`
      );
    }

    res.json(updated);
  } catch (err) {
    res.status(500).json({ message: 'Failed to update class', error: err.message });
  }
};

exports.deleteClass = async (req, res) => {
  try {
    const existing = await db.query('SELECT coach_id FROM classes WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) return res.status(404).json({ message: 'Class not found' });
    // Ownership rule: the super admin may delete any class; any other admin may
    // only delete classes they created themselves (coach_id == their user id).
    const isSuper = req.user.role === 'superadmin';
    const isOwner = existing.rows[0].coach_id === req.user.id;
    if (!isSuper && !isOwner) {
      return res.status(403).json({ message: 'Forbidden: you can only delete classes you created' });
    }
    await db.query('DELETE FROM classes WHERE id = $1', [req.params.id]);
    res.json({ message: 'Class deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete class', error: err.message });
  }
};

exports.markAttendance = async (req, res) => {
  try {
    const { studentId, status } = req.body;
    const result = await db.query(
      `INSERT INTO attendance (class_id, student_id, status) VALUES ($1,$2,$3)
       ON CONFLICT (class_id, student_id) DO UPDATE SET status = EXCLUDED.status RETURNING *`,
      [req.params.id, studentId, status]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Failed to mark attendance', error: err.message });
  }
};

exports.getAttendanceForClass = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT s.id AS student_id, u.name, COALESCE(a.status, 'absent') AS status
       FROM class_students cs
       JOIN students s ON s.id = cs.student_id
       JOIN users u ON u.id = s.user_id
       LEFT JOIN attendance a ON a.class_id = $1 AND a.student_id = s.id
       WHERE cs.class_id = $1
       ORDER BY u.name`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch attendance', error: err.message });
  }
};

/* ─── single-class detail: full meta + allocated students + attendance + duration ───
   Eligibility for "allocated students" mirrors listClasses: an explicit
   class_students roster wins; otherwise the class's batch (group) members;
   otherwise every student. Attendance status per student is included so a
   completed/cancelled class can show who was present/late/absent. Duration is
   the REAL session length (ended_at − started_at) when the class was
   started/ended, falling back to the scheduled start_time→end_time span. */
exports.getClassDetail = async (req, res) => {
  try {
    const classRes = await db.query(
      `SELECT cl.*, g.name AS group_name, u.name AS coach_name, u.email AS coach_email
       FROM classes cl
       LEFT JOIN groups g ON g.id = cl.group_id
       LEFT JOIN users u ON u.id = cl.coach_id
       WHERE cl.id = $1`,
      [req.params.id]
    );
    if (classRes.rows.length === 0) return res.status(404).json({ message: 'Class not found' });
    const cls = classRes.rows[0];

    const explicitRes = await db.query('SELECT student_id FROM class_students WHERE class_id = $1', [req.params.id]);
    let scope;
    let students = [];
    if (explicitRes.rows.length > 0) {
      scope = 'explicit';
      const ids = explicitRes.rows.map((r) => r.student_id);
      const sRes = await db.query(
        `SELECT s.id AS student_id, u.name, u.email, g.name AS group_name, COALESCE(a.status, 'absent') AS attendance
         FROM students s
         JOIN users u ON u.id = s.user_id
         LEFT JOIN groups g ON g.id = s.group_id
         LEFT JOIN attendance a ON a.class_id = $1 AND a.student_id = s.id
         WHERE s.id = ANY($2::int[])
         ORDER BY u.name`,
        [req.params.id, ids]
      );
      students = sRes.rows;
    } else if (cls.group_id) {
      scope = 'group';
      const sRes = await db.query(
        `SELECT s.id AS student_id, u.name, u.email, g.name AS group_name, COALESCE(a.status, 'absent') AS attendance
         FROM students s
         JOIN users u ON u.id = s.user_id
         LEFT JOIN groups g ON g.id = s.group_id
         LEFT JOIN attendance a ON a.class_id = $1 AND a.student_id = s.id
         WHERE s.group_id = $2
         ORDER BY u.name`,
        [req.params.id, cls.group_id]
      );
      students = sRes.rows;
    } else {
      scope = 'all';
      const sRes = await db.query(
        `SELECT s.id AS student_id, u.name, u.email, g.name AS group_name, COALESCE(a.status, 'absent') AS attendance
         FROM students s
         JOIN users u ON u.id = s.user_id
         LEFT JOIN groups g ON g.id = s.group_id
         LEFT JOIN attendance a ON a.class_id = $1 AND a.student_id = s.id
         ORDER BY u.name`,
        [req.params.id]
      );
      students = sRes.rows;
    }

    const attendance = { present: 0, late: 0, absent: 0, total: students.length };
    for (const st of students) {
      if (st.attendance === 'present') attendance.present++;
      else if (st.attendance === 'late') attendance.late++;
      else attendance.absent++;
    }

    let actualMinutes = null;
    if (cls.started_at && cls.ended_at) {
      actualMinutes = Math.max(0, Math.round((new Date(cls.ended_at) - new Date(cls.started_at)) / 60000));
    }
    let scheduledMinutes = null;
    if (cls.start_time && cls.end_time) {
      const [sh, sm] = String(cls.start_time).split(':').map(Number);
      const [eh, em] = String(cls.end_time).split(':').map(Number);
      let mins = eh * 60 + em - (sh * 60 + sm);
      if (mins < 0) mins += 24 * 60;
      scheduledMinutes = mins;
    }

    res.json({
      id: cls.id,
      title: cls.title,
      description: cls.description,
      topic: cls.topic,
      class_date: cls.class_date,
      start_time: cls.start_time,
      end_time: cls.end_time,
      meeting_url: cls.meeting_url,
      material_url: cls.material_url,
      is_online: cls.is_online,
      status: cls.status,
      class_type: cls.class_type,
      thumbnail: cls.thumbnail,
      created_at: cls.created_at,
      started_at: cls.started_at,
      ended_at: cls.ended_at,
      group_id: cls.group_id,
      group_name: cls.group_name,
      coach_id: cls.coach_id,
      coach_name: cls.coach_name,
      coach_email: cls.coach_email,
      allocated_count: students.length,
      roster_scope: scope,
      students,
      attendance,
      duration: { actual_minutes: actualMinutes, scheduled_minutes: scheduledMinutes },
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to load class detail', error: err.message });
  }
};

/* Attendance register: every class × every eligible student, with the stored
   status per pair. Eligibility mirrors listClasses (explicit class_students
   wins; otherwise group_id membership; otherwise everyone). */
exports.getAttendanceRecords = async (req, res) => {
  try {
    const [classesRes, studentsRes, attRes, csRes] = await Promise.all([
      db.query(
        `SELECT cl.id, cl.title, cl.class_date, cl.start_time, cl.group_id,
                cl.status, cl.class_type,
                (SELECT COUNT(*) FROM class_students cs WHERE cs.class_id = cl.id) AS explicit_count
         FROM classes cl
         ORDER BY cl.class_date DESC, cl.start_time DESC`
      ),
      db.query(
        `SELECT s.id, u.name AS name, s.group_id, g.name AS group_name
         FROM students s
         JOIN users u ON u.id = s.user_id
         LEFT JOIN groups g ON g.id = s.group_id
         ORDER BY u.name`
      ),
      db.query(`SELECT class_id, student_id, status FROM attendance`),
      db.query(`SELECT class_id, student_id FROM class_students`),
    ]);

    const explicitMap = {};
    for (const r of csRes.rows) {
      (explicitMap[r.class_id] = explicitMap[r.class_id] || new Set()).add(r.student_id);
    }
    const groupsMap = {};
    const allStudentIds = new Set();
    for (const r of studentsRes.rows) {
      allStudentIds.add(r.id);
      if (r.group_id != null) {
        (groupsMap[r.group_id] = groupsMap[r.group_id] || new Set()).add(r.id);
      }
    }

    const classes = classesRes.rows.map((c) => {
      const explicit = explicitMap[c.id];
      const eligible = explicit && explicit.size > 0
        ? explicit
        : c.group_id != null
          ? groupsMap[c.group_id] || new Set()
          : allStudentIds;
      return {
        id: c.id,
        title: c.title,
        class_date: c.class_date,
        start_time: c.start_time,
        status: c.status,
        class_type: c.class_type,
        eligible: [...eligible],
      };
    });

    const statuses = {};
    for (const r of attRes.rows) {
      (statuses[r.student_id] = statuses[r.student_id] || {})[r.class_id] = r.status;
    }

    res.json({ classes, students: studentsRes.rows, statuses });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch attendance records', error: err.message });
  }
};

exports.sendMeetingReminders = sendMeetingReminders;
exports.notifyStudentUserIds = notifyStudentUserIds;
exports.notifyMeeting = notifyMeeting;
