const db = require('../config/database');
const fs = require('fs');
const path = require('path');

exports.uploadDocument = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file provided' });

    const result = await db.query(
      `INSERT INTO course_documents (course_id, original_name, file_name, file_type, file_size)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.body.courseId || null, req.file.originalname, req.file.filename, req.file.mimetype, req.file.size]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (req.file) { try { fs.unlinkSync(req.file.path); } catch {} }
    res.status(500).json({ message: 'Upload failed', error: err.message });
  }
};

exports.listDocuments = async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM course_documents ORDER BY uploaded_at DESC'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Failed to list documents', error: err.message });
  }
};

exports.deleteDocument = async (req, res) => {
  try {
    const result = await db.query(
      'DELETE FROM course_documents WHERE id = $1 RETURNING *',
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: 'Document not found' });

    const doc = result.rows[0];
    const filePath = path.join(__dirname, '..', '..', 'uploads', doc.file_name);
    if (fs.existsSync(filePath)) { try { fs.unlinkSync(filePath); } catch {} }

    res.json({ message: 'Document deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete document', error: err.message });
  }
};