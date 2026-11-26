const db = require('../config/database');
const service = require('../services/performanceReportService');
const { studentIdForUser } = require('./studentController');

/*
 * Access rules for the Performance Report. Checked on EVERY request — GET and
 * POST, staff and student — never inferred from a client-supplied flag:
 *   student  → only their own student row (explicit id must match the session)
 *   admin    → only students allocated to them (primary coach or student_coaches)
 *   superadmin → any student
 */

function positiveId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function staffCanAccess(user, studentId) {
  if (user?.role === 'superadmin') return true;
  const r = await db.query(
    `SELECT 1 FROM students s
      WHERE s.id = $1
        AND (s.coach_id = $2 OR EXISTS (
          SELECT 1 FROM student_coaches sc
           WHERE sc.student_id = s.id AND sc.coach_id = $2))`,
    [studentId, user?.id]
  );
  return r.rows.length > 0;
}

async function resolveStudent(req, res, requestedId) {
  const role = req.user?.role;

  if (role === 'student') {
    const ownId = await studentIdForUser(req.user.id);
    if (!ownId) {
      res.status(404).json({ message: 'Student profile not found' });
      return null;
    }
    if (requestedId != null && String(requestedId) !== 'me') {
      const id = positiveId(requestedId);
      if (!id || id !== Number(ownId)) {
        res.status(403).json({ message: 'You can only view your own report' });
        return null;
      }
    }
    return Number(ownId);
  }

  if (role !== 'admin' && role !== 'superadmin') {
    res.status(403).json({ message: 'Forbidden' });
    return null;
  }

  const id = positiveId(requestedId);
  if (!id) {
    res.status(400).json({ message: 'studentId is required' });
    return null;
  }
  if (!(await staffCanAccess(req.user, id))) {
    res.status(403).json({ message: 'You can only view students assigned to you' });
    return null;
  }
  return id;
}

exports.getPerformance = async (req, res) => {
  try {
    const { from, to } = service.parseRange(req.query);
    const studentId = await resolveStudent(req, res, req.query.studentId);
    if (studentId == null) return;

    const report = await service.buildReport({ studentId, from, to });
    if (!report) return res.status(404).json({ message: 'Student not found' });
    return res.json(report);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error('[performance report] failed:', err.message);
    return res.status(500).json({ message: 'Failed to load performance report' });
  }
};

exports.saveRemarks = async (req, res) => {
  try {
    const role = req.user?.role;
    if (role !== 'admin' && role !== 'superadmin') {
      return res.status(403).json({ message: 'Only coaches can save remarks' });
    }

    const { studentId, text } = req.body || {};
    if (!req.body?.from || !req.body?.to) {
      return res.status(400).json({ message: 'A valid from/to date range is required' });
    }
    const { from, to } = service.parseRange(req.body);
    const id = await resolveStudent(req, res, studentId);
    if (id == null) return;

    const remarks = await service.saveRemarks({
      studentId: id,
      from,
      to,
      text: String(text ?? '').slice(0, 5000),
      userId: req.user.id,
    });
    return res.json(remarks);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error('[performance report] remarks failed:', err.message);
    return res.status(500).json({ message: 'Failed to save remarks' });
  }
};
