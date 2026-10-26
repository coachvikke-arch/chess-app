const db = require('../config/database');

async function userIsMemberOfClass({ userId, userRole }, classRow) {
  if (userRole === 'admin' || userRole === 'superadmin') {
    return { authorized: true, isInstructor: true, roleInClass: 'host' };
  }

  if (classRow.coach_id === userId) {
    return { authorized: true, isInstructor: true, roleInClass: 'host' };
  }

  const studentRes = await db.query(
    'SELECT id, group_id FROM students WHERE user_id = $1 LIMIT 1',
    [userId]
  );

  if (studentRes.rows.length === 0) {
    return { authorized: false, isInstructor: false, roleInClass: 'student' };
  }

  const student = studentRes.rows[0];
  const classId = classRow.id;

  const explicitMembersRes = await db.query(
    'SELECT EXISTS (SELECT 1 FROM class_students WHERE class_id = $1) AS has_explicit',
    [classId]
  );
  const hasExplicitMembers = explicitMembersRes.rows[0].has_explicit;

  if (hasExplicitMembers) {
    const isInClassRes = await db.query(
      'SELECT EXISTS (SELECT 1 FROM class_students WHERE class_id = $1 AND student_id = $2) AS is_member',
      [classId, student.id]
    );
    if (!isInClassRes.rows[0].is_member) {
      return { authorized: false, isInstructor: false, roleInClass: 'student' };
    }
  } else {
    if (classRow.group_id !== null && classRow.group_id !== student.group_id) {
      return { authorized: false, isInstructor: false, roleInClass: 'student' };
    }
  }

  return { authorized: true, isInstructor: false, roleInClass: 'student' };
}

module.exports = { userIsMemberOfClass };
