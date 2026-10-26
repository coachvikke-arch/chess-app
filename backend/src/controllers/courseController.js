const db = require('../config/database');

exports.listCourses = async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM courses ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Failed to list courses', error: err.message });
  }
};

exports.getCourse = async (req, res) => {
  try {
    const course = await db.query('SELECT * FROM courses WHERE id = $1', [req.params.id]);
    if (course.rows.length === 0) return res.status(404).json({ message: 'Course not found' });

    const modules = await db.query(
      'SELECT * FROM modules WHERE course_id = $1 ORDER BY order_number ASC',
      [req.params.id]
    );
    const moduleIds = modules.rows.map((m) => m.id);
    let lessons = [];
    if (moduleIds.length > 0) {
      const lessonResult = await db.query(
        `SELECT * FROM lessons WHERE module_id = ANY($1::int[]) ORDER BY order_number ASC`,
        [moduleIds]
      );
      lessons = lessonResult.rows;
    }
    const modulesWithLessons = modules.rows.map((m) => ({
      ...m,
      lessons: lessons.filter((l) => l.module_id === m.id),
    }));

    res.json({ ...course.rows[0], modules: modulesWithLessons });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch course', error: err.message });
  }
};

exports.createCourse = async (req, res) => {
  try {
    const { title, description, level, thumbnail } = req.body;
    if (!title) return res.status(400).json({ message: 'Title is required' });
    const result = await db.query(
      'INSERT INTO courses (title, description, level, thumbnail) VALUES ($1,$2,$3,$4) RETURNING *',
      [title, description, level || 'Beginner', thumbnail]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Failed to create course', error: err.message });
  }
};

exports.updateCourse = async (req, res) => {
  try {
    const { title, description, level, thumbnail } = req.body;
    const result = await db.query(
      `UPDATE courses SET title = COALESCE($1,title), description = COALESCE($2,description),
       level = COALESCE($3,level), thumbnail = COALESCE($4,thumbnail) WHERE id = $5 RETURNING *`,
      [title, description, level, thumbnail, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: 'Course not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Failed to update course', error: err.message });
  }
};

exports.deleteCourse = async (req, res) => {
  try {
    await db.query('DELETE FROM courses WHERE id = $1', [req.params.id]);
    res.json({ message: 'Course deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete course', error: err.message });
  }
};

// Modules
exports.createModule = async (req, res) => {
  try {
    const { courseId, title, description, orderNumber } = req.body;
    const result = await db.query(
      'INSERT INTO modules (course_id, title, description, order_number) VALUES ($1,$2,$3,$4) RETURNING *',
      [courseId, title, description, orderNumber || 0]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Failed to create module', error: err.message });
  }
};

// Lessons
exports.createLesson = async (req, res) => {
  try {
    const { moduleId, title, description, videoUrl, content, fen, pgn, orderNumber } = req.body;
    const result = await db.query(
      `INSERT INTO lessons (module_id, title, description, video_url, content, fen, pgn, order_number)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [moduleId, title, description, videoUrl, content, fen, pgn, orderNumber || 0]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Failed to create lesson', error: err.message });
  }
};

exports.getLesson = async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM lessons WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ message: 'Lesson not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch lesson', error: err.message });
  }
};

exports.updateLesson = async (req, res) => {
  try {
    const { title, description, videoUrl, content, fen, pgn, orderNumber } = req.body;
    const result = await db.query(
      `UPDATE lessons SET title=COALESCE($1,title), description=COALESCE($2,description),
       video_url=COALESCE($3,video_url), content=COALESCE($4,content), fen=COALESCE($5,fen),
       pgn=COALESCE($6,pgn), order_number=COALESCE($7,order_number) WHERE id=$8 RETURNING *`,
      [title, description, videoUrl, content, fen, pgn, orderNumber, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: 'Lesson not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Failed to update lesson', error: err.message });
  }
};

exports.deleteLesson = async (req, res) => {
  try {
    await db.query('DELETE FROM lessons WHERE id = $1', [req.params.id]);
    res.json({ message: 'Lesson deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete lesson', error: err.message });
  }
};

exports.completeLesson = async (req, res) => {
  try {
    const studentRes = await db.query('SELECT id FROM students WHERE user_id = $1', [req.user.id]);
    const studentId = studentRes.rows[0]?.id;
    if (!studentId) return res.status(404).json({ message: 'Student profile not found' });
    await db.query(
      `INSERT INTO lesson_completion (lesson_id, student_id) VALUES ($1,$2)
       ON CONFLICT (lesson_id, student_id) DO NOTHING`,
      [req.params.id, studentId]
    );
    res.json({ message: 'Lesson marked as completed' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to mark lesson complete', error: err.message });
  }
};
