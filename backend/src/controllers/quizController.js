const db = require('../config/database');

exports.listQuizzes = async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM quizzes ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Failed to list quizzes', error: err.message });
  }
};

exports.getQuiz = async (req, res) => {
  try {
    const quiz = await db.query('SELECT * FROM quizzes WHERE id = $1', [req.params.id]);
    if (quiz.rows.length === 0) return res.status(404).json({ message: 'Quiz not found' });
    // correct_answer withheld until submission
    const questions = await db.query(
      'SELECT id, question, question_type, fen, options FROM questions WHERE quiz_id = $1',
      [req.params.id]
    );
    res.json({ ...quiz.rows[0], questions: questions.rows });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch quiz', error: err.message });
  }
};

exports.createQuiz = async (req, res) => {
  try {
    const { title, courseId, description, questions } = req.body;
    const quizResult = await db.query(
      'INSERT INTO quizzes (title, course_id, description) VALUES ($1,$2,$3) RETURNING *',
      [title, courseId, description]
    );
    const quiz = quizResult.rows[0];

    if (Array.isArray(questions)) {
      for (const q of questions) {
        await db.query(
          `INSERT INTO questions (quiz_id, question, question_type, fen, options, correct_answer, explanation)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [quiz.id, q.question, q.questionType || 'multiple_choice', q.fen, JSON.stringify(q.options || []), q.correctAnswer, q.explanation]
        );
      }
    }
    res.status(201).json(quiz);
  } catch (err) {
    res.status(500).json({ message: 'Failed to create quiz', error: err.message });
  }
};

exports.submitQuiz = async (req, res) => {
  try {
    const { answers } = req.body; // { questionId: answer }
    const questions = await db.query('SELECT id, correct_answer, explanation FROM questions WHERE quiz_id = $1', [req.params.id]);

    let correctCount = 0;
    const feedback = questions.rows.map((q) => {
      const submitted = answers[q.id];
      const correct = submitted === q.correct_answer;
      if (correct) correctCount++;
      return { questionId: q.id, correct, correctAnswer: q.correct_answer, explanation: q.explanation };
    });

    const score = questions.rows.length > 0 ? Math.round((correctCount / questions.rows.length) * 100) : 0;

    const studentRes = await db.query('SELECT id FROM students WHERE user_id = $1', [req.user.id]);
    const studentId = studentRes.rows[0]?.id;
    if (studentId) {
      await db.query('INSERT INTO quiz_results (quiz_id, student_id, score) VALUES ($1,$2,$3)', [
        req.params.id, studentId, score,
      ]);
    }

    res.json({ score, feedback });
  } catch (err) {
    res.status(500).json({ message: 'Failed to submit quiz', error: err.message });
  }
};

// Leaderboard: aggregate points from puzzles, assignments, quizzes
exports.getLeaderboard = async (req, res) => {
  try {
    const result = await db.query(`
      SELECT u.id AS user_id, u.name, u.avatar_config, u.profile_image, s.id AS student_id,
        COALESCE(pz.points, 0) AS puzzle_points,
        COALESCE(asg.points, 0) AS assignment_points,
        COALESCE(qz.points, 0) AS quiz_points,
        (COALESCE(pz.points,0) + COALESCE(asg.points,0) + COALESCE(qz.points,0)) AS total_points
      FROM students s
      JOIN users u ON u.id = s.user_id
      LEFT JOIN (SELECT student_id, SUM(score) AS points FROM puzzle_attempts GROUP BY student_id) pz ON pz.student_id = s.id
      LEFT JOIN (SELECT student_id, SUM(COALESCE(score,0)) AS points FROM assignment_submissions GROUP BY student_id) asg ON asg.student_id = s.id
      LEFT JOIN (SELECT student_id, SUM(score) AS points FROM quiz_results GROUP BY student_id) qz ON qz.student_id = s.id
      WHERE s.hide_from_leaderboard = FALSE
      ORDER BY total_points DESC
      LIMIT 50
    `);
    res.json(result.rows.map((r, i) => ({ rank: i + 1, ...r })));
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch leaderboard', error: err.message });
  }
};
