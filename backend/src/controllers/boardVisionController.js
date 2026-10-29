const db = require('../config/database');

/* Board Vision keeps one JSON document per user. The browser still writes
   localStorage on every change (offline backup); these two endpoints are the
   cross-device copy. The document shape is owned by the frontend store
   (`boardVisionStore.js`), so the server only validates that it IS an object
   and bounds its size — it never interprets the training fields. */
const MAX_PROGRESS_BYTES = 1024 * 1024;

exports.getProgress = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT progress, updated_at FROM board_vision_progress WHERE user_id = $1`,
      [req.user.id]
    );
    const row = result.rows[0];
    res.json({
      progress: row ? row.progress : null,
      updatedAt: row ? row.updated_at : null,
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to load Board Vision progress', error: err.message });
  }
};

exports.saveProgress = async (req, res) => {
  try {
    const progress = req.body?.progress;
    if (!progress || typeof progress !== 'object' || Array.isArray(progress)) {
      return res.status(400).json({ message: 'progress must be an object' });
    }
    const serialized = JSON.stringify(progress);
    if (serialized.length > MAX_PROGRESS_BYTES) {
      return res.status(413).json({ message: 'Board Vision progress is too large to save' });
    }

    const result = await db.query(
      `INSERT INTO board_vision_progress (user_id, progress, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (user_id)
       DO UPDATE SET progress = EXCLUDED.progress, updated_at = NOW()
       RETURNING updated_at`,
      [req.user.id, serialized]
    );

    res.json({ ok: true, updatedAt: result.rows[0].updated_at });
  } catch (err) {
    res.status(500).json({ message: 'Failed to save Board Vision progress', error: err.message });
  }
};
