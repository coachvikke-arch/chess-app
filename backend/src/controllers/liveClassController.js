const db = require('../config/database');
const { Chess } = require('chess.js');
const { userIsMemberOfClass } = require('../services/liveClassAccess');
const { notifyStudentUserIds, notifyMeeting } = require('./classController');
const { normalizeMeetingUrl } = require('../utils/meetingUrl');

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/* Classroom leaderboard scoring is drill points only - the coach-configured
   value on each assigned drill. There is no board-side constant to re-weight it,
   which is deliberate: any constant here would silently override the number the
   coach actually set for the drill. */

async function fetchMemberUserIds(classRow) {
  return await notifyStudentUserIds(classRow.id, classRow.group_id);
}

/* Auto-register attendance when a student joins a live class.
   Inserts `present` ONLY if no record exists yet (ON CONFLICT DO NOTHING),
   so an admin's manual mark — and any existing status — is never stomped.
   Best-effort: a write failure must never block the student from joining. */
async function registerAttendanceOnJoin(classId, userId) {
  try {
    const studentRes = await db.query(
      'SELECT id FROM students WHERE user_id = $1 LIMIT 1',
      [userId]
    );
    if (studentRes.rows.length === 0) return;
    await db.query(
      `INSERT INTO attendance (class_id, student_id, status)
       VALUES ($1, $2, 'present')
       ON CONFLICT (class_id, student_id) DO NOTHING`,
      [classId, studentRes.rows[0].id]
    );
  } catch (err) {
    console.warn('[registerAttendanceOnJoin] skipped:', err.message);
  }
}

exports.startClass = async (req, res) => {
  try {
    const classId = req.params.id;
    const classRes = await db.query('SELECT * FROM classes WHERE id = $1', [classId]);
    if (classRes.rows.length === 0) return res.status(404).json({ message: 'Class not found' });
    const classRow = classRes.rows[0];

    const access = await userIsMemberOfClass({ userId: req.user.id, userRole: req.user.role }, classRow);
    if (!access.authorized || !access.isInstructor) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    if (classRow.status === 'cancelled') {
      return res.status(400).json({ message: 'Cannot start a cancelled class' });
    }

    const updated = await db.query(
      "UPDATE classes SET status = 'live', started_at = NOW() WHERE id = $1 RETURNING *",
      [classId]
    );

    // Chess board state exists inside the integrated classroom, and for
    // external classes that use the integrated classroom (shared board + chat).
    if (classRow.class_type === 'integrated' || classRow.classroom_enabled !== false) {
      await db.query(
        `INSERT INTO chess_game_states (live_class_id, fen, pgn, current_turn, annotations)
         VALUES ($1, $2, '', 'w', '{"arrows":[],"highlights":[]}'::jsonb)
         ON CONFLICT (live_class_id) DO UPDATE SET
           fen = EXCLUDED.fen,
           pgn = EXCLUDED.pgn,
           current_turn = EXCLUDED.current_turn,
           annotations = EXCLUDED.annotations,
           last_move = NULL,
           updated_at = NOW()`,
        [classId, START_FEN]
      );
    }

    const memberUserIds = await fetchMemberUserIds(classRow);
    const usesClassroom = classRow.class_type === 'integrated' || classRow.classroom_enabled !== false;
    const joinHint = usesClassroom
      ? 'Open Mate Zone and join now!'
      : classRow.meeting_url
        ? `Join the meeting: ${normalizeMeetingUrl(classRow.meeting_url)}`
        : 'Open Mate Zone and join now!';
    await notifyMeeting(
      memberUserIds,
      `Class is now live: ${classRow.title}`,
      `"${classRow.title}" is now LIVE. ${joinHint} #class-${classId}`
    );

    const io = req.app.get('io');
    if (io) {
      io.to(`live-class:${classId}`).emit('class_started', { classId, classRow: updated.rows[0] });
      for (const uid of memberUserIds) {
        io.to(`user:${uid}`).emit('class_started', { classId, classRow: updated.rows[0] });
      }
    }

    res.json(updated.rows[0]);
  } catch (err) {
    console.error('[startClass] error', err);
    res.status(500).json({ message: 'Failed to start class', error: err.message });
  }
};

exports.endClass = async (req, res) => {
  try {
    const classId = req.params.id;
    const classRes = await db.query('SELECT * FROM classes WHERE id = $1', [classId]);
    if (classRes.rows.length === 0) return res.status(404).json({ message: 'Class not found' });
    const classRow = classRes.rows[0];

    const access = await userIsMemberOfClass({ userId: req.user.id, userRole: req.user.role }, classRow);
    if (!access.authorized || !access.isInstructor) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const updated = await db.query(
      "UPDATE classes SET status = 'completed', ended_at = NOW() WHERE id = $1 RETURNING *",
      [classId]
    );

    const io = req.app.get('io');
    if (io) {
      io.to(`live-class:${classId}`).emit('class_ended', { classId, classRow: updated.rows[0] });
    }

    res.json(updated.rows[0]);
  } catch (err) {
    console.error('[endClass] error', err);
    res.status(500).json({ message: 'Failed to end class', error: err.message });
  }
};

exports.cancelClass = async (req, res) => {
  try {
    const classId = req.params.id;
    const classRes = await db.query('SELECT * FROM classes WHERE id = $1', [classId]);
    if (classRes.rows.length === 0) return res.status(404).json({ message: 'Class not found' });
    const classRow = classRes.rows[0];

    const access = await userIsMemberOfClass({ userId: req.user.id, userRole: req.user.role }, classRow);
    if (!access.authorized || !access.isInstructor) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const updated = await db.query(
      "UPDATE classes SET status = 'cancelled' WHERE id = $1 RETURNING *",
      [classId]
    );

    const memberUserIds = await fetchMemberUserIds(classRow);
    await notifyMeeting(
      memberUserIds,
      `Class cancelled: ${classRow.title}`,
      `The class "${classRow.title}" scheduled for ${classRow.class_date} at ${classRow.start_time} has been cancelled. #class-${classId}`
    );

    const io = req.app.get('io');
    if (io) {
      io.to(`live-class:${classId}`).emit('class_cancelled', { classId, classRow: updated.rows[0] });
      for (const uid of memberUserIds) {
        io.to(`user:${uid}`).emit('class_cancelled', { classId, classRow: updated.rows[0] });
      }
    }

    res.json(updated.rows[0]);
  } catch (err) {
    console.error('[cancelClass] error', err);
    res.status(500).json({ message: 'Failed to cancel class', error: err.message });
  }
};

exports.getClassJoinToken = async (req, res) => {
  try {
    const classId = req.params.id;
    const classRes = await db.query(
      `SELECT cl.*, u.name AS coach_name
       FROM classes cl LEFT JOIN users u ON u.id = cl.coach_id
       WHERE cl.id = $1`,
      [classId]
    );
    if (classRes.rows.length === 0) return res.status(404).json({ message: 'Class not found' });
    const classRow = classRes.rows[0];

    const access = await userIsMemberOfClass({ userId: req.user.id, userRole: req.user.role }, classRow);
    if (!access.authorized) {
      return res.status(403).json({ message: 'You are not authorized to join this class' });
    }

    if (classRow.status !== 'live' && !access.isInstructor) {
      return res.status(400).json({ message: 'Class is not live' });
    }

    // Student successfully joined a live class → register attendance (present).
    if (!access.isInstructor && access.roleInClass === 'student') {
      await registerAttendanceOnJoin(classId, req.user.id);
    }

    let chessStateRow = (await db.query(
      'SELECT * FROM chess_game_states WHERE live_class_id = $1',
      [classId]
    )).rows[0];

    if (!chessStateRow) {
      if (access.isInstructor) {
        await db.query(
          `INSERT INTO chess_game_states (live_class_id, fen, pgn, current_turn, annotations)
           VALUES ($1, $2, '', 'w', '{"arrows":[],"highlights":[]}'::jsonb) RETURNING *`,
          [classId, START_FEN]
        );
        chessStateRow = (await db.query(
          'SELECT * FROM chess_game_states WHERE live_class_id = $1',
          [classId]
        )).rows[0];
      } else {
        chessStateRow = {
          fen: START_FEN,
          pgn: '',
          current_turn: 'w',
          annotations: { arrows: [], highlights: [] },
          last_move: null,
        };
      }
    }

    let chess;
    try {
      chess = new Chess();
      if (chessStateRow.pgn && chessStateRow.pgn.trim().length > 0) {
        chess.loadPgn(chessStateRow.pgn);
      } else if (chessStateRow.fen) {
        chess.load(chessStateRow.fen);
      }
    } catch (e) {
      chess = new Chess(START_FEN);
    }

    const moves = chess.history({ verbose: false });

    const chatMessagesRes = await db.query(
      `SELECT cm.id, cm.user_id, u.name AS user_name, u.role AS user_role, cm.message, cm.created_at
       FROM chat_messages cm JOIN users u ON u.id = cm.user_id
       WHERE cm.live_class_id = $1 AND cm.is_private IS NOT TRUE
       ORDER BY cm.created_at ASC LIMIT 100`,
      [classId]
    );

    /* private student → coach DMs — only the thread's own user (and the coach)
       ever sees them, never the whole room. */
    const privateChatRes = await db.query(
      /* COALESCE(sender_id, user_id): a classroom DM written before the sender_id
       fix has only user_id, and a JOIN on a NULL author drops the row. */
      `SELECT cm.id, COALESCE(cm.user_id, cm.sender_id) AS user_id, cm.sender_id,
              cm.recipient_id, u.name AS user_name, u.role AS user_role,
              cm.message, cm.created_at, cm.read_at
       FROM chat_messages cm
       JOIN users u ON u.id = COALESCE(cm.sender_id, cm.user_id)
       WHERE cm.live_class_id = $1 AND cm.is_private = TRUE
         AND (COALESCE(cm.sender_id, cm.user_id) = $2 OR cm.recipient_id = $2)
       ORDER BY cm.created_at ASC LIMIT 100`,
      [classId, req.user.id]
    );

    /* ── participants: who is genuinely in the room RIGHT NOW ──────────────
       The DB status goes stale (rows stay 'active' after server restarts or
       abrupt drops), so we derive the roster from the live Socket.IO rooms.
       Only if the room can't be queried do we fall back to DB 'active' rows. */
    let participantsRes = null;
    const io = req.app.get('io');
    if (io) {
      try {
        const roomName = `live-class:${classId}`;
        const sockets = await io.in(roomName).fetchSockets();
        const coachId = classRow.coach_id;
        participantsRes = sockets
          .map((sock) => {
            const uid = sock.user?.id;
            if (uid == null) return null;
            const isHost = ['admin', 'superadmin'].includes(sock.user?.role) || (coachId != null && uid === coachId);
            return {
              user_id: uid,
              name: sock.user?.name || `user-${uid}`,
              role_in_class: isHost ? 'host' : 'student',
              status: 'active',
              joined_at: new Date().toISOString(),
            };
          })
          .filter(Boolean);
      } catch (e) {
        console.warn('[getClassJoinToken] could not fetch room sockets', e.message);
        participantsRes = null;
      }
    }
    if (!participantsRes) {
      const res = await db.query(
        `SELECT lp.user_id, u.name, lp.role_in_class, lp.status, lp.joined_at
         FROM live_class_participants lp JOIN users u ON u.id = lp.user_id
         WHERE lp.live_class_id = $1 AND lp.status = 'active'
         ORDER BY lp.joined_at ASC`,
        [classId]
      );
      participantsRes = res.rows;
    }

    /* The snapshot is taken over HTTP, which on a refresh fires before the new
       socket has joined the room - so the requester can be missing from their
       own roster and the class briefly reads "0 participants". Guarantee they
       are listed with their true role; the socket-driven roster replaces this
       list a moment later with the authoritative view. */
    const selfId = req.user.id;
    const alreadyListed = participantsRes.some((p) => String(p.user_id) === String(selfId));
    if (!alreadyListed) {
      participantsRes.push({
        user_id: selfId,
        name: req.user.name || `user-${selfId}`,
        role_in_class: access.isInstructor ? 'host' : 'student',
        status: 'active',
        joined_at: new Date().toISOString(),
      });
    }

    const chatMode = classRow.chat_mode || 'open';
    const studentInteractionEnabled = !!classRow.student_interaction_enabled;
    const isInstructor = access.isInstructor;

    let moveGrants = [];
    try {
      const grantsRes = await db.query(
        'SELECT user_id, move_side FROM live_class_move_grants WHERE live_class_id = $1',
        [classId]
      );
      moveGrants = grantsRes.rows.map((r) => ({ userId: r.user_id, moveSide: r.move_side }));
    } catch (e) {}

    /* What THIS student's own game in the class is doing, so a page refresh
       after finishing still reveals "Watch classmates" without waiting for the
       next socket event. `null` = no game; 'playing' = still on the board;
       'finished' = their own board is done and they may watch others. */
    let selfGameStatus = null;
    if (!access.isInstructor) {
      try {
        const ownRes = await db.query(
          `SELECT status FROM online_games
           WHERE class_id = $1 AND (admin_id = $2 OR student_id = $2)
             AND status IN ('active', 'finished')
           ORDER BY updated_at DESC`,
          [classId, req.user.id]
        );
        if (ownRes.rows.some((r) => r.status === 'active')) selfGameStatus = 'playing';
        else if (ownRes.rows.length > 0) selfGameStatus = 'finished';
      } catch (e) {}
    }

    res.json({
      ok: true,
      selfGameStatus,
      classMeta: {
        id: classRow.id,
        title: classRow.title,
        description: classRow.description,
        status: classRow.status,
        instructorName: classRow.coach_name,
        scheduledDate: classRow.class_date,
        startTime: classRow.start_time,
        endTime: classRow.end_time,
        chatMode,
        studentInteractionEnabled,
        studentMoveSide: classRow.student_move_side || 'both',
        moveGrants,
        classType: classRow.class_type,
        classroomEnabled: classRow.classroom_enabled !== false,
        meetingUrl: classRow.meeting_url,
        /* Whether students may watch classmates once their own game finished.
           Instructors ignore this (they can always spectate). */
        spectateEnabled: classRow.spectate_enabled !== false,
      },
      isInstructor,
      permissions: {
        canControlBoard: isInstructor || studentInteractionEnabled,
        canDrawAnnotations: isInstructor,
        canSendChat: chatMode !== 'instructor-only' || isInstructor,
        canShareScreen: isInstructor,
        canModerate: isInstructor,
      },
      chessState: {
        fen: chess.fen(),
        pgn: chess.pgn(),
        currentTurn: chessStateRow.current_turn || (chess.turn() === 'w' ? 'w' : 'b'),
        lastMove: chessStateRow.last_move || null,
        annotations: chessStateRow.annotations || { arrows: [], highlights: [] },
        moves,
      },
      participants: participantsRes.map((p) => ({
        userId: p.user_id,
        name: p.name,
        roleInClass: p.role_in_class,
        status: p.status,
        joinedAt: p.joined_at,
      })),
      chatMessages: chatMessagesRes.rows.map((m) => ({
        id: m.id,
        userId: m.user_id,
        userName: m.user_name,
        userRole: m.user_role,
        message: m.message,
        createdAt: m.created_at,
      })),
      privateChat: privateChatRes.rows.map((m) => ({
        id: m.id,
        userId: m.user_id,
        senderId: m.sender_id,
        recipientId: m.recipient_id,
        userName: m.user_name,
        userRole: m.user_role,
        message: m.message,
        createdAt: m.created_at,
        readAt: m.read_at,
      })),
    });
  } catch (err) {
    console.error('[getClassJoinToken] error', err);
    res.status(500).json({ message: 'Failed to get join token', error: err.message });
  }
};

exports.joinExternalClass = async (req, res) => {
  try {
    const classId = req.params.id;
    const classRes = await db.query('SELECT * FROM classes WHERE id = $1', [classId]);
    if (classRes.rows.length === 0) return res.status(404).json({ message: 'Class not found' });
    const classRow = classRes.rows[0];

    if (classRow.class_type === 'integrated') {
      return res.status(400).json({ message: 'This is an integrated classroom — join from the app instead' });
    }
    if (!classRow.meeting_url) {
      return res.status(400).json({ message: 'No meeting link configured for this class' });
    }

    const access = await userIsMemberOfClass({ userId: req.user.id, userRole: req.user.role }, classRow);
    if (!access.authorized) {
      return res.status(403).json({ message: 'You are not authorized to join this class' });
    }

    if (classRow.status !== 'live' && !access.isInstructor) {
      return res.status(400).json({ message: 'Class is not live' });
    }

    // Student successfully joined a live external class → register attendance.
    if (!access.isInstructor && access.roleInClass === 'student') {
      await registerAttendanceOnJoin(classId, req.user.id);
    }

    res.json({
      ok: true,
      meetingUrl: classRow.meeting_url,
      classMeta: {
        id: classRow.id,
        title: classRow.title,
        status: classRow.status,
        instructorName: classRow.coach_name,
        scheduledDate: classRow.class_date,
        startTime: classRow.start_time,
        classType: classRow.class_type,
      },
    });
  } catch (err) {
    console.error('[joinExternalClass] error', err);
    res.status(500).json({ message: 'Failed to join class', error: err.message });
  }
};

exports.listChat = async (req, res) => {
  try {
    const classId = req.params.id;
    const classRes = await db.query('SELECT * FROM classes WHERE id = $1', [classId]);
    if (classRes.rows.length === 0) return res.status(404).json({ message: 'Class not found' });
    const classRow = classRes.rows[0];

    const access = await userIsMemberOfClass({ userId: req.user.id, userRole: req.user.role }, classRow);
    if (!access.authorized) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const beforeId = req.query.beforeId ? parseInt(req.query.beforeId, 10) : null;

    const params = [classId];
    let whereClause = 'WHERE cm.live_class_id = $1';
    if (beforeId != null && !isNaN(beforeId)) {
      whereClause += ` AND cm.id < $${params.length + 1}`;
      params.push(beforeId);
    }

    const result = await db.query(
      `SELECT cm.id, cm.user_id, u.name AS user_name, u.role AS user_role, cm.message, cm.created_at
       FROM chat_messages cm JOIN users u ON u.id = cm.user_id
       ${whereClause}
       ORDER BY cm.created_at ASC LIMIT 100`,
      params
    );

    res.json(result.rows.map((m) => ({
      id: m.id,
      userId: m.user_id,
      userName: m.user_name,
      userRole: m.user_role,
      message: m.message,
      createdAt: m.created_at,
    })));
  } catch (err) {
    console.error('[listChat] error', err);
    res.status(500).json({ message: 'Failed to list chat', error: err.message });
  }
};

exports.clearChat = async (req, res) => {
  try {
    const classId = req.params.id;
    const classRes = await db.query('SELECT * FROM classes WHERE id = $1', [classId]);
    if (classRes.rows.length === 0) return res.status(404).json({ message: 'Class not found' });
    const classRow = classRes.rows[0];

    const access = await userIsMemberOfClass({ userId: req.user.id, userRole: req.user.role }, classRow);
    const isAdmin = ['admin', 'superadmin'].includes(req.user.role);
    if (!access.isInstructor && !isAdmin) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    await db.query('DELETE FROM chat_messages WHERE live_class_id = $1', [classId]);

    const io = req.app.get('io');
    if (io) {
      io.to(`live-class:${classId}`).emit('chat_cleared', { classId });
    }

    res.json({ message: 'Chat cleared' });
  } catch (err) {
    console.error('[clearChat] error', err);
    res.status(500).json({ message: 'Failed to clear chat', error: err.message });
  }
};

exports.listInviteableStudents = async (req, res) => {
  try {
    const classId = req.params.id;
    const classRes = await db.query('SELECT * FROM classes WHERE id = $1', [classId]);
    if (classRes.rows.length === 0) return res.status(404).json({ message: 'Class not found' });
    const classRow = classRes.rows[0];

    const access = await userIsMemberOfClass({ userId: req.user.id, userRole: req.user.role }, classRow);
    const isAdmin = ['admin', 'superadmin'].includes(req.user.role);
    if (!access.isInstructor && !isAdmin) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    /* Invitee pool = every student this instructor handles (coach_id or the
       student_coaches join table), UNION the explicit class roster, so the card
       lists all their students — not just the class members. Admins see all
       students in the system. */
    const pool = await db.query(
      `SELECT u.id AS user_id
       FROM students s
       JOIN users u ON u.id = s.user_id
       WHERE s.user_id IS NOT NULL
         AND (
           $1::boolean OR
           s.coach_id = $2 OR
           EXISTS (SELECT 1 FROM student_coaches sc WHERE sc.student_id = s.id AND sc.coach_id = $2) OR
           EXISTS (SELECT 1 FROM class_students cs WHERE cs.class_id = $3 AND cs.student_id = s.id)
         )
       UNION
       SELECT s.user_id AS user_id
       FROM students s
       WHERE s.user_id IS NOT NULL
         AND $1::boolean`,
      [isAdmin, req.user.id, classId]
    );
    if (pool.rows.length === 0) return res.json([]);

    const inRoom = await db.query(
      `SELECT user_id FROM live_class_participants
       WHERE live_class_id = $1 AND status = 'active'`,
      [classId]
    );
    const inRoomSet = new Set(inRoom.rows.map((r) => r.user_id));
    const absentIds = pool.rows.map((r) => r.user_id).filter((uid) => !inRoomSet.has(uid));
    if (absentIds.length === 0) return res.json([]);

    const absent = await db.query(
      `SELECT u.id AS user_id, u.name, u.email
       FROM users u
       WHERE u.id = ANY($1::int[])
       ORDER BY u.name ASC`,
      [absentIds]
    );

    res.json(absent.rows.map((r) => ({
      userId: r.user_id,
      name: r.name,
      email: r.email,
    })));
  } catch (err) {
    console.error('[listInviteableStudents] error', err);
    res.status(500).json({ message: 'Failed to list students', error: err.message });
  }
};

/* Classroom leaderboard - DRILL POINTS from this class only.
 *
 * Scoped to exactly one thing: the assigned puzzle drills run in this live
 * class, scored from live_class_puzzle_progress.points_earned. Online games and
 * bot games deliberately do NOT feed this board. The coach sets drill points per
 * drill, so the board reports the one number the coach actually assigned, and a
 * student cannot top the class by grinding bots before the lesson.
 *
 * It is also not an all-time total: points from drills in OTHER classes, and
 * points earned in this class before it went live, never appear.
 *
 * Every enrolled student is listed, not only the ones who scored. A roster that
 * shows just the top three tells the coach nothing about the half of the class
 * that has not opened the drill yet, and hides the students most worth chasing.
 * `status` carries that: how far through the drills they are and whether they
 * have shown up at all.
 *
 * `drill_totals` is a single-row CTE so "solved every assigned drill" compares
 * against the real assignment count rather than a hardcoded total.
 *
 * Both presence sources are folded in and OR-ed, because either alone is
 * unreliable: live_class_participants only has a row once someone opens the
 * room, and attendance is written by the backend on join but can also be marked
 * by hand. attendance is aggregated first because a student can carry more than
 * one row for a class and must not be counted twice.
 */
const CLASS_LEADERBOARD_SQL = `
WITH members AS (
  SELECT lp.user_id, lp.user_id AS student_id, u.name, u.avatar_config, u.profile_image
  FROM live_class_participants lp
  JOIN users u ON u.id = lp.user_id
  WHERE lp.live_class_id = $1 AND lp.role_in_class = 'student'
  UNION
  SELECT s.user_id, s.id AS student_id, u.name, u.avatar_config, u.profile_image
  FROM class_students cs
  JOIN students s ON s.id = cs.student_id
  JOIN users u ON u.id = s.user_id
  WHERE cs.class_id = $1 AND s.user_id IS NOT NULL
    AND s.user_id NOT IN (
      SELECT user_id FROM live_class_participants WHERE live_class_id = $1 AND role_in_class = 'student'
    )
),
drill_totals AS (
  SELECT COUNT(*)::int AS assigned
  FROM live_class_puzzle_drills
  WHERE live_class_id = $1
),
progress AS (
  SELECT p.user_id,
         COALESCE(SUM(p.points_earned), 0)::int AS points,
         COUNT(*) FILTER (WHERE p.result = 'completed')::int AS solved,
         COUNT(*)::int AS attempted,
         MAX(p.updated_at) AS last_activity_at
  FROM live_class_puzzle_progress p
  JOIN live_class_puzzle_drills d ON d.id = p.drill_id
  WHERE d.live_class_id = $1
  GROUP BY p.user_id
),
presence AS (
  SELECT lp.user_id, BOOL_OR(lp.status = 'active') AS in_room
  FROM live_class_participants lp
  WHERE lp.live_class_id = $1 AND lp.role_in_class = 'student'
  GROUP BY lp.user_id
),
att AS (
  SELECT a.student_id, BOOL_OR(a.status = 'present') AS marked_present
  FROM attendance a
  WHERE a.class_id = $1
  GROUP BY a.student_id
),
scored AS (
  SELECT m.user_id, m.student_id, m.name, m.avatar_config, m.profile_image,
         COALESCE(pg.points, 0)::int AS total_points,
         COALESCE(pg.solved, 0)::int AS puzzles_solved,
         COALESCE(pg.attempted, 0)::int AS puzzles_attempted,
         dt.assigned AS drills_assigned,
         COALESCE(pr.in_room, false) AS in_room,
         COALESCE(at.marked_present, false) AS marked_present,
         pg.last_activity_at
  FROM members m
  CROSS JOIN drill_totals dt
  LEFT JOIN progress pg ON pg.user_id = m.user_id
  LEFT JOIN presence pr ON pr.user_id = m.user_id
  LEFT JOIN att at ON at.student_id = m.student_id
)
SELECT user_id, student_id, name, avatar_config, profile_image,
       total_points, puzzles_solved, puzzles_attempted, drills_assigned,
       in_room, marked_present, last_activity_at,
       /* One word the UI can colour. Ordered by how far along they are, so
          "not joined" is the only state that needs calling out loudly. */
       CASE
         WHEN puzzles_solved >= GREATEST(drills_assigned, 1)
              AND puzzles_attempted > 0 THEN 'completed'
         WHEN puzzles_attempted > 0          THEN 'in_progress'
         WHEN in_room OR marked_present     THEN 'joined'
         ELSE 'not_joined'
       END AS status
FROM scored
ORDER BY total_points DESC, puzzles_solved DESC, name ASC
LIMIT 200`;

exports.getClassLeaderboard = async (req, res) => {
  try {
    const classId = req.params.id;
    const classRes = await db.query('SELECT * FROM classes WHERE id = $1', [classId]);
    if (classRes.rows.length === 0) return res.status(404).json({ message: 'Class not found' });
    const classRow = classRes.rows[0];

    /* Everyone in the room may see the board - the students are the ones it is
       meant to motivate. Non-members still get nothing. */
    const access = await userIsMemberOfClass({ userId: req.user.id, userRole: req.user.role }, classRow);
    if (!access.authorized) {
      return res.status(403).json({ message: 'You are not authorized to view this class leaderboard' });
    }

    /* Drill points only, so this query touches neither online_games nor the
       optional bot tables - a database missing the bot schema scores the board
       exactly the same as one that has it. */
    const result = await db.query(CLASS_LEADERBOARD_SQL, [classId]);

    res.json({
      ok: true,
      classId,
      classTitle: classRow.title,
      source: 'drills',
      drillsAssigned: result.rows.length > 0 ? result.rows[0].drills_assigned : 0,
      rows: result.rows.map((r, i) => ({
        rank: i + 1,
        user_id: r.user_id,
        student_id: r.student_id,
        name: r.name,
        avatar_config: r.avatar_config,
        profile_image: r.profile_image,
        total_points: r.total_points,
        puzzle_points: r.total_points,
        puzzles_solved: r.puzzles_solved,
        puzzles_attempted: r.puzzles_attempted,
        drills_assigned: r.drills_assigned,
        status: r.status,
        in_room: r.in_room,
        marked_present: r.marked_present,
        last_activity_at: r.last_activity_at,
        /* `points` is the only alias the shared podium still needs. Wins/losses
           and games_played are deliberately absent: there is no game on this
           board, and reporting zeros for them would imply otherwise. */
        points: r.total_points,
        streak: 0,
      })),
    });
  } catch (err) {
    console.error('[getClassLeaderboard] error', err);
    res.status(500).json({ message: 'Failed to load class leaderboard', error: err.message });
  }
};

exports.listParticipants = async (req, res) => {
  try {
    const classId = req.params.id;
    const classRes = await db.query('SELECT * FROM classes WHERE id = $1', [classId]);
    if (classRes.rows.length === 0) return res.status(404).json({ message: 'Class not found' });
    const classRow = classRes.rows[0];

    const access = await userIsMemberOfClass({ userId: req.user.id, userRole: req.user.role }, classRow);
    const isAdmin = ['admin', 'superadmin'].includes(req.user.role);
    if (!access.isInstructor && !isAdmin) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const result = await db.query(
      `SELECT lp.user_id, u.name, u.email, lp.role_in_class, lp.status, lp.joined_at, lp.left_at
       FROM live_class_participants lp JOIN users u ON u.id = lp.user_id
       WHERE lp.live_class_id = $1
       ORDER BY lp.joined_at ASC`,
      [classId]
    );

    const io = req.app.get('io');
    const onlineUserIds = new Set();
    if (io) {
      try {
        const roomName = `live-class:${classId}`;
        const sockets = await io.in(roomName).fetchSockets();
        for (const sock of sockets) {
          if (sock.user && sock.user.id != null) {
            onlineUserIds.add(sock.user.id);
          }
        }
      } catch (e) {
        console.warn('[listParticipants] could not fetch sockets', e.message);
      }
    }

    res.json(result.rows.map((p) => ({
      userId: p.user_id,
      name: p.name,
      email: p.email,
      roleInClass: p.role_in_class,
      status: p.status,
      joinedAt: p.joined_at,
      leftAt: p.left_at,
      online: onlineUserIds.has(p.user_id),
    })));
  } catch (err) {
    console.error('[listParticipants] error', err);
    res.status(500).json({ message: 'Failed to list participants', error: err.message });
  }
};

/* Instructor-only switch for "students may watch their classmates' games".
   Persisted per class and echoed to the room so every client's button appears
   or disappears without a refresh. Enforcement is not done here — the HTTP and
   socket spectator gates read the same column at request time, so turning this
   off takes effect immediately even for a client that misses the event. */
exports.setSpectateEnabled = async (req, res) => {
  try {
    const classId = req.params.id;
    const classRes = await db.query('SELECT * FROM classes WHERE id = $1', [classId]);
    if (classRes.rows.length === 0) return res.status(404).json({ message: 'Class not found' });
    const classRow = classRes.rows[0];

    const access = await userIsMemberOfClass({ userId: req.user.id, userRole: req.user.role }, classRow);
    if (!access.isInstructor) {
      return res.status(403).json({ message: 'Only the instructor can change this setting' });
    }

    const enabled = req.body?.enabled !== false;
    await db.query('UPDATE classes SET spectate_enabled = $1 WHERE id = $2', [enabled, classId]);

    const io = req.app.get('io');
    if (io) io.to(`live-class:${classId}`).emit('spectate_toggled', { classId: Number(classId), enabled });

    res.json({ ok: true, spectateEnabled: enabled });
  } catch (err) {
    console.error('[setSpectateEnabled] error', err);
    res.status(500).json({ message: 'Failed to update the setting', error: err.message });
  }
};
