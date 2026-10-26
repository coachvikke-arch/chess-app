const db = require('../config/database');
const path = require('path');
const fs = require('fs');

/* Top Performances showcase.
 *
 * WRITE SIDE (POST / DELETE): any coach or the Super Admin. The author's user
 * id is stamped as created_by from the session — never from the request body.
 *
 * READ SIDE (GET /): role-shaped, so one endpoint serves both audiences:
 *   - student    -> items created by the Super Admin (visible to all) plus
 *                   items created by any of THEIR coaches (primary coach_id or
 *                   a student_coaches row). Everyone else's uploads are simply
 *                   absent, never 403s — there is nothing to enumerate.
 *   - admin/superadmin (manage page) -> only the items THEY created, so each
 *                   author curates their own shelf.
 */

async function coachIdsForUser(userId) {
  const r = await db.query(
    `SELECT s.coach_id AS id FROM students s WHERE s.user_id = $1
     UNION
     SELECT sc.coach_id AS id FROM student_coaches sc
     JOIN students s ON s.id = sc.student_id WHERE s.user_id = $1`,
    [userId]
  );
  return r.rows.map((x) => x.id).filter((v) => v != null);
}

exports.list = async (req, res) => {
  try {
    const role = req.user?.role;
    if (role === 'student') {
      const coachIds = await coachIdsForUser(req.user.id);
      const result = await db.query(
        `SELECT tp.id, tp.title, tp.details, tp.image_url, tp.created_at,
                u.name AS creator_name, u.role AS creator_role
         FROM top_performances tp
         JOIN users u ON u.id = tp.created_by
         WHERE u.role = 'superadmin'
            OR tp.created_by = ANY($1::int[])
         ORDER BY tp.created_at DESC`,
        [coachIds]
      );
      return res.json(result.rows);
    }
    if (role === 'admin' || role === 'superadmin') {
      const result = await db.query(
        `SELECT tp.id, tp.title, tp.details, tp.image_url, tp.created_at,
                u.name AS creator_name, u.role AS creator_role
         FROM top_performances tp
         LEFT JOIN users u ON u.id = tp.created_by
         WHERE tp.created_by = $1
         ORDER BY tp.created_at DESC`,
        [req.user.id]
      );
      return res.json(result.rows);
    }
    return res.status(403).json({ message: 'Forbidden' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to load performances', error: err.message });
  }
};

exports.create = async (req, res) => {
  try {
    const title = String(req.body?.title || '').trim();
    const details = String(req.body?.details || '').trim();
    if (!title) return res.status(400).json({ message: 'A title is required' });
    if (title.length > 120) return res.status(400).json({ message: 'Title must be 120 characters or less' });
    if (details.length > 2000) return res.status(400).json({ message: 'Details must be 2000 characters or less' });
    const imageUrl = req.file ? `/uploads/${req.file.filename}` : null;
    const result = await db.query(
      `INSERT INTO top_performances (title, details, image_url, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id, title, details, image_url, created_at`,
      [title, details || '', imageUrl, req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Failed to save performance', error: err.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const found = await db.query('SELECT id, image_url, created_by FROM top_performances WHERE id = $1', [
      req.params.id,
    ]);
    if (found.rows.length === 0) return res.status(404).json({ message: 'Performance not found' });
    const row = found.rows[0];
    /* Authors curate their own shelf; the Super Admin may clear anyone's. */
    if (req.user.role !== 'superadmin' && Number(row.created_by) !== Number(req.user.id)) {
      return res.status(403).json({ message: 'You can only delete your own performances' });
    }
    await db.query('DELETE FROM top_performances WHERE id = $1', [req.params.id]);
    /* Tidy the upload so deleted posts do not pile up files nobody references.
       Only touch files under /uploads (never an absolute or remote URL). */
    if (row.image_url && row.image_url.startsWith('/uploads/')) {
      const file = path.join(__dirname, '..', '..', 'uploads', path.basename(row.image_url));
      fs.unlink(file, () => {});
    }
    res.json({ message: 'Performance deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete performance', error: err.message });
  }
};
