const db = require('../config/database');
const { LEVELS, lessonExercises } = require('../data/academyCurriculum');
const { checkAndUnlockForUser, rewardStatus } = require('../lib/rewards');

const XP_PER_CORRECT = 10;
const XP_LESSON_BONUS = 25;
const XP_LEVEL_BONUS = 100;

/* Coach/Admin/Super Admin accounts browse the academy in PREVIEW mode: every
   level, lesson and badge is open, and nothing they click is written back as
   progress, XP, streak or badges. `coach` is normally stored as `admin` —
   keeping it listed costs nothing and covers accounts shaped either way. */
const STAFF_ROLES = new Set(['superadmin', 'super_admin', 'admin', 'coach']);
const isStaff = (user) => Boolean(user && STAFF_ROLES.has(String(user.role)));

/* Hint penalty: fewer points for correct answers that used hints. */
function xpForResult(correct, hintsUsed) {
  if (!correct) return 0;
  const hints = Number(hintsUsed) || 0;
  if (hints <= 0) return XP_PER_CORRECT;
  if (hints === 1) return 7;
  if (hints === 2) return 4;
  return 2;
}

function findLevel(slug) {
  return LEVELS.find((l) => l.slug === slug) || null;
}

function findLesson(level, lessonSlug) {
  return (level && level.lessons.find((l) => l.slug === lessonSlug)) || null;
}

async function getStats(userId) {
  const r = await db.query(
    `SELECT total_xp, daily_streak, last_practice_date, sessions_completed,
            exercises_attempted, exercises_correct
     FROM academy_stats WHERE user_id = $1`,
    [userId]
  );
  if (r.rows.length === 0) {
    return { xp: 0, streak: 0, lastPracticeDate: null, sessionsCompleted: 0, exercisesAttempted: 0, exercisesCorrect: 0 };
  }
  const s = r.rows[0];
  return {
    xp: s.total_xp,
    streak: s.daily_streak,
    lastPracticeDate: s.last_practice_date,
    sessionsCompleted: s.sessions_completed,
    exercisesAttempted: s.exercises_attempted,
    exercisesCorrect: s.exercises_correct,
  };
}

async function ensureStats(userId) {
  return db.query(
    `INSERT INTO academy_stats (user_id) VALUES ($1)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );
}

/* Lesson completion: every exercise in the lesson has a completed progress row. */
async function completedExerciseCount(userId, levelSlug, lessonSlug) {
  const r = await db.query(
    `SELECT COUNT(*)::int AS n FROM academy_progress
     WHERE user_id = $1 AND level_slug = $2 AND lesson_slug = $3 AND completed = true`,
    [userId, levelSlug, lessonSlug]
  );
  return r.rows[0].n;
}

async function lessonIsComplete(lesson, userId) {
  const total = lessonExercises(lesson).length;
  /* Training + opening lessons complete by passing at least one practice session (≥70%). */
  if (lesson.kind === 'training' || lesson.kind === 'opening') {
    const s = await db.query(
      `SELECT COUNT(*)::int AS n FROM academy_sessions
       WHERE user_id = $1 AND level_slug = $2 AND lesson_slug = $3 AND total > 0 AND correct >= total * 0.7`,
      [userId, lesson.levelSlug, lesson.slug]
    );
    const passed = s.rows[0].n > 0;
    const synthetic = lesson.kind === 'opening' ? 1 : total;
    return { total: synthetic, done: passed ? synthetic : 0, complete: passed };
  }
  const done = await completedExerciseCount(userId, lesson.levelSlug, lesson.slug);
  return { total, done, complete: total > 0 && done >= total };
}

/* Per-level progress + unlock state. Staff preview reports every level as
   open while still returning the REAL progress numbers, so the card can show
   "0/5 lessons · 0%" next to a Coach access badge instead of a fake 100%. */
async function levelProgress(userId, staff = false) {
  const out = [];
  for (let i = 0; i < LEVELS.length; i++) {
    const level = LEVELS[i];
    let totalLessons = 0;
    let completedLessons = 0;
    for (const lesson of level.lessons) {
      const { total, complete } = await lessonIsComplete({ ...lesson, levelSlug: level.slug }, userId);
      totalLessons += total > 0 ? 1 : 0;
      if (total > 0 && complete) completedLessons += 1;
    }
    const pct = totalLessons ? Math.round((completedLessons / totalLessons) * 100) : 0;
    const prev = i > 0 ? out[i - 1] : null;
    const unlocked = staff || i === 0 || (prev && prev.pct >= level.unlockAfter);
    out.push({
      slug: level.slug,
      name: level.name,
      tagline: level.tagline,
      icon: level.icon,
      accent: level.accent,
      description: level.description,
      totalLessons,
      completedLessons,
      pct,
      unlocked,
      staffPreview: staff,
      unlockAfter: level.unlockAfter,
      lockedBy: unlocked ? null : prev ? prev.name : null,
      neededPct: unlocked ? 0 : level.unlockAfter,
    });
  }
  return out;
}

/* Badge codes earned by the state of the user's progress. */
async function earnedBadgeCodes(userId) {
  const codes = new Set();
  const progress = await levelProgress(userId);

  for (let i = 0; i < LEVELS.length; i++) {
    const level = LEVELS[i];
    for (const lesson of level.lessons) {
      const { total, complete } = await lessonIsComplete({ ...lesson, levelSlug: level.slug }, userId);
      if (total === 0 || !complete) continue;
      codes.add('first-lesson');
      const MAP = {
        board: 'board-explorer',
        king: 'king-master',
        queen: 'queen-master',
        rook: 'rook-master',
        bishop: 'bishop-master',
        knight: 'knight-master',
        pawn: 'pawn-master',
        'special-rules': 'rules-master',
      };
      if (MAP[lesson.slug]) codes.add(MAP[lesson.slug]);
      if (lesson.slug === 'training' && level.slug === 'beginner') codes.add('trained');
      if (lesson.kind === 'opening') codes.add('opening-beginner');
    }
  }

  const intermediate = progress.find((p) => p.slug === 'intermediate');
  const advanced = progress.find((p) => p.slug === 'advanced');
  if (intermediate && intermediate.pct >= 100) codes.add('opening-expert');
  if (advanced && advanced.pct >= 100) codes.add('chess-master');

  return codes;
}

/* Award any newly-earned badges; returns newly unlocked badge objects. */
async function applyBadges(userId) {
  const earned = await earnedBadgeCodes(userId);
  const earnedArr = [...earned];
  if (earnedArr.length === 0) return [];

  const r = await db.query('SELECT badge_code FROM user_academy_badges WHERE user_id = $1', [userId]);
  const have = new Set(r.rows.map((b) => b.badge_code));
  const fresh = earnedArr.filter((c) => !have.has(c));
  if (fresh.length === 0) return [];

  await db.query(
    `INSERT INTO user_academy_badges (user_id, badge_code)
     SELECT $1, code FROM unnest($2::text[]) AS code ON CONFLICT DO NOTHING`,
    [userId, fresh]
  );
  const badgeRes = await db.query(
    `SELECT code, name, icon, description, xp_value FROM academy_badges WHERE code = ANY($1)`,
    [fresh]
  );
  await db.query('UPDATE academy_stats SET total_xp = total_xp + $2 WHERE user_id = $1', [
    userId,
    badgeRes.rows.reduce((sum, b) => sum + b.xp_value, 0),
  ]);
  return badgeRes.rows;
}

/* Streak: consecutive practice days. Returns updated streak. */
function localYMD(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function touchStreak(userId) {
  const stats = await db.query(
    `SELECT daily_streak, to_char(last_practice_date, 'YYYY-MM-DD') AS last_date
     FROM academy_stats WHERE user_id = $1`,
    [userId]
  );
  const now = new Date();
  const today = localYMD(now);
  const last = stats.rows[0]?.last_date || null;

  let streak = stats.rows[0]?.daily_streak || 0;
  if (last === today) {
    /* same day: no change */
  } else {
    const y = new Date(now);
    y.setDate(y.getDate() - 1);
    const yesterday = localYMD(y);
    streak = last === yesterday ? streak + 1 : 1;
  }
  await db.query(
    `UPDATE academy_stats
     SET daily_streak = $2, last_practice_date = $3, updated_at = NOW()
     WHERE user_id = $1`,
    [userId, streak, today]
  );
  return streak;
}

async function addXp(userId, xp) {
  if (!xp || xp <= 0) return;
  await db.query('UPDATE academy_stats SET total_xp = total_xp + $1, updated_at = NOW() WHERE user_id = $2', [xp, userId]);
}

/* Record an exercise result + inner XP streak bookkeeping. */
async function recordExercise(userId, levelSlug, lessonSlug, exerciseSlug, { correct, hintsUsed = 0, timeMs = 0 }) {
  const prev = await db.query(
    `SELECT attempts, correct, hints_used, completed FROM academy_progress
     WHERE user_id = $1 AND level_slug = $2 AND lesson_slug = $3 AND exercise_slug = $4`,
    [userId, levelSlug, lessonSlug, exerciseSlug]
  );
  const p = prev.rows[0];
  const attempts = (p?.attempts || 0) + 1;
  const correctCount = (p?.correct || 0) + (correct ? 1 : 0);
  const hints = (p?.hints_used || 0) + (hintsUsed || 0);
  const completed = correct || !!p?.completed;
  const time = (p?.total_time_ms || 0) + (timeMs || 0);

  await db.query(
    `INSERT INTO academy_progress
       (user_id, level_slug, lesson_slug, exercise_slug, attempts, correct, hints_used, total_time_ms, completed, completed_at, last_practiced_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, CASE WHEN $9 THEN NOW() ELSE NULL END, NOW())
     ON CONFLICT (user_id, level_slug, lesson_slug, exercise_slug) DO UPDATE SET
       attempts = EXCLUDED.attempts,
       correct = EXCLUDED.correct,
       hints_used = EXCLUDED.hints_used,
       total_time_ms = EXCLUDED.total_time_ms,
       completed = EXCLUDED.completed,
       completed_at = CASE WHEN EXCLUDED.completed AND academy_progress.completed_at IS NULL THEN NOW() ELSE academy_progress.completed_at END,
       last_practiced_at = NOW()`,
    [userId, levelSlug, lessonSlug, exerciseSlug, attempts, correctCount, hints, time, completed]
  );
  return { completed };
}

/* Award the level-completion XP bonus once, when a level first hits 100%.
   `prevFields` = map of level slug → {pct} captured before the activity. */
async function awardLevelBonuses(userId, prevLevels) {
  const nowLevels = await levelProgress(userId);
  const prevMap = {};
  for (const l of prevLevels) prevMap[l.slug] = l.pct;
  for (const l of nowLevels) {
    if (l.pct >= 100 && (prevMap[l.slug] || 0) < 100) {
      await addXp(userId, XP_LEVEL_BONUS);
    }
  }
  return nowLevels;
}

/* ────────────────────────── GET / overview ────────────────────────── */
exports.getOverview = async (req, res) => {
  try {
    const staff = isStaff(req.user);
    /* A staff preview must not create stats rows or award badges. */
    if (!staff) {
      await ensureStats(req.user.id);
      await applyBadges(req.user.id);
    }
    let levels;
    let stats;
    let badges;
    [levels, stats, badges] = await Promise.all([
      levelProgress(req.user.id, staff),
      getStats(req.user.id),
      db.query(
        `SELECT b.code, b.name, b.icon, b.description, b.xp_value,
                ub.unlocked_at
         FROM academy_badges b
         LEFT JOIN user_academy_badges ub ON ub.badge_code = b.code AND ub.user_id = $1
         ORDER BY b.xp_value ASC`,
        [req.user.id]
      ),
    ]);

    const reward = await rewardStatus(req.user);
    res.json({
      levels,
      stats,
      reward,
      badges: badges.rows.map((b) => ({
        code: b.code,
        name: b.name,
        icon: b.icon,
        description: b.description,
        xpValue: b.xp_value,
        /* Preview: every badge reads as unlocked for staff WITHOUT inserting a
           user_academy_badges row — the flag is response-only. */
        unlocked: staff || !!b.unlocked_at,
        unlockedAt: b.unlocked_at,
        staffPreview: staff,
      })),
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to load academy', error: err.message });
  }
};

/* ────────────────────────── GET / levels/:slug ────────────────────────── */
exports.getLevel = async (req, res) => {
  try {
    const level = findLevel(req.params.slug);
    if (!level) return res.status(404).json({ message: 'Level not found' });

    const staff = isStaff(req.user);
    if (!staff) await ensureStats(req.user.id);
    const levels = await levelProgress(req.user.id, staff);
    const meta = levels.find((l) => l.slug === level.slug);
    if (!staff && !meta.unlocked && level.slug !== 'beginner') {
      return res.status(403).json({ message: `Complete ${meta.neededPct}% of the ${meta.lockedBy} level to unlock ${meta.name}.`, level: meta });
    }

    const lessons = [];
    for (const lesson of level.lessons) {
      const { total, done, complete } = await lessonIsComplete({ ...lesson, levelSlug: level.slug }, req.user.id);
      lessons.push({
        slug: lesson.slug,
        title: lesson.title,
        icon: lesson.icon,
        kind: lesson.kind,
        openingSlug: lesson.openingSlug || null,
        exerciseCount: total,
        completedExercises: done,
        pct: total ? Math.round((done / total) * 100) : 0,
        complete,
      });
    }

    res.json({ level: meta, lessons });
  } catch (err) {
    res.status(500).json({ message: 'Failed to load level', error: err.message });
  }
};

/* ────────────────────────── GET / lessons/:level/:lesson ────────────────────────── */
exports.getLesson = async (req, res) => {
  try {
    const level = findLevel(req.params.levelSlug);
    const lesson = level && findLesson(level, req.params.lessonSlug);
    if (!lesson) return res.status(404).json({ message: 'Lesson not found' });

    const staff = isStaff(req.user);
    if (!staff) await ensureStats(req.user.id);
    const levels = await levelProgress(req.user.id, staff);
    const meta = levels.find((l) => l.slug === level.slug);
    if (!meta.unlocked) {
      return res.status(403).json({ message: `Complete ${meta.neededPct}% of the ${meta.lockedBy} level to unlock ${meta.name}.` });
    }

    const exercises = lessonExercises(lesson);
    const progressRows = await db.query(
      `SELECT exercise_slug, attempts, correct, hints_used, completed
       FROM academy_progress
       WHERE user_id = $1 AND level_slug = $2 AND lesson_slug = $3`,
      [req.user.id, level.slug, lesson.slug]
    );
    const progress = {};
    for (const p of progressRows.rows) {
      progress[p.exercise_slug] = {
        attempts: p.attempts,
        correct: p.correct,
        hintsUsed: p.hints_used,
        completed: p.completed,
      };
    }

    res.json({
      lesson: {
        slug: lesson.slug,
        title: lesson.title,
        icon: lesson.icon,
        kind: lesson.kind,
        openingSlug: lesson.openingSlug || null,
        sections: lesson.sections || [],
        tips: lesson.tips || [],
        exercises,
      },
      progress,
      level: meta,
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to load lesson', error: err.message });
  }
};

/* ────────────────────────── POST / exercises/complete ────────────────────────── */
exports.completeExercise = async (req, res) => {
  try {
    const { levelSlug, lessonSlug, exerciseSlug, correct, hintsUsed = 0, timeMs = 0 } = req.body;
    if (!levelSlug || !lessonSlug || !exerciseSlug) {
      return res.status(400).json({ message: 'levelSlug, lessonSlug and exerciseSlug are required' });
    }
    const level = findLevel(levelSlug);
    const lesson = findLesson(level, lessonSlug);
    const exercise = lesson && lessonExercises(lesson).find((e) => e.slug === exerciseSlug);
    if (!exercise) return res.status(404).json({ message: 'Exercise not found' });

    /* Staff preview: acknowledge the answer so the lesson keeps working, but do
       not record progress, XP, streak or badges for an admin account. */
    if (isStaff(req.user)) {
      return res.json({
        preview: true,
        xpEarned: 0,
        streak: 0,
        lessonCompletedNow: false,
        newBadges: [],
        levels: await levelProgress(req.user.id, true),
      });
    }

    await ensureStats(req.user.id);
    let prevLevels = await levelProgress(req.user.id);
    let wasComplete = (await lessonIsComplete({ ...lesson, levelSlug }, req.user.id)).complete;
    await recordExercise(req.user.id, levelSlug, lessonSlug, exerciseSlug, { correct, hintsUsed, timeMs });

    const streak = await touchStreak(req.user.id);
    const xp = xpForResult(correct, hintsUsed);
    await addXp(req.user.id, xp);

    let lessonCompletedNow = false;
    if (correct) {
      const { complete } = await lessonIsComplete({ ...lesson, levelSlug }, req.user.id);
      if (complete && !wasComplete) {
        await addXp(req.user.id, XP_LESSON_BONUS);
        lessonCompletedNow = true;
      }
    }

    const newBadges = await applyBadges(req.user.id);
    const levels = await awardLevelBonuses(req.user.id, prevLevels);
    const intermediate = levels.find((level) => level.slug === 'intermediate');
    if (intermediate) await checkAndUnlockForUser(req.user.id, 'intermediate', intermediate.pct);
    res.json({
      xpEarned: xp,
      streak,
      lessonCompletedNow,
      newBadges,
      levels,
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to record exercise', error: err.message });
  }
};

/* ────────────────────────── POST / sessions/complete ────────────────────────── */
exports.completeSession = async (req, res) => {
  try {
    const { levelSlug, lessonSlug, sessionKind = 'beginner-training', total = 0, correct = 0, timeMs = 0, exercises = [] } = req.body;
    const level = findLevel(levelSlug);
    const lesson = findLesson(level, lessonSlug);
    if (!lesson) return res.status(404).json({ message: 'Lesson not found' });

    if (isStaff(req.user)) {
      return res.json({
        preview: true,
        passed: total > 0 && correct / total >= 0.7,
        correct,
        total,
        xpEarned: 0,
        lessonCompletedNow: false,
        newBadges: [],
        levels: await levelProgress(req.user.id, true),
      });
    }

    await ensureStats(req.user.id);
    let prevLevels = await levelProgress(req.user.id);
    let wasComplete = (await lessonIsComplete({ ...lesson, levelSlug }, req.user.id)).complete;

    await db.query(
      `INSERT INTO academy_sessions
         (user_id, session_kind, level_slug, lesson_slug, total, correct, accuracy, total_time_ms, completed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
      [req.user.id, sessionKind, levelSlug, lessonSlug, total, correct, total ? correct / total : 0, timeMs]
    );

    let xp = 0;
    const pool = lessonExercises(lesson);
    const validSlugs = new Set(pool.map((e) => e.slug));
    for (const ex of exercises) {
      if (!ex || !validSlugs.has(ex.slug)) continue;
      await recordExercise(req.user.id, levelSlug, lessonSlug, ex.slug, {
        correct: !!ex.correct,
        hintsUsed: ex.hintsUsed || 0,
        timeMs: ex.timeMs || 0,
      });
      xp += xpForResult(!!ex.correct, ex.hintsUsed || 0);
    }
    await db.query(
      `UPDATE academy_stats SET exercises_attempted = exercises_attempted + $2,
         exercises_correct = exercises_correct + $3, sessions_completed = sessions_completed + 1,
         total_xp = total_xp + GREATEST(0, $4), updated_at = NOW()
       WHERE user_id = $1`,
      [req.user.id, total, correct, total ? Math.round(correct * 1.5) : 0]
    );
    await touchStreak(req.user.id);

    let passed = total > 0 && correct / total >= 0.7;
    let lessonCompletedNow = false;
    if (passed) {
      const { complete } = await lessonIsComplete({ ...lesson, levelSlug }, req.user.id);
      if (complete && !wasComplete) {
        await addXp(req.user.id, XP_LESSON_BONUS);
        lessonCompletedNow = true;
      }
    }

    const newBadges = await applyBadges(req.user.id);
    const levels = await awardLevelBonuses(req.user.id, prevLevels);
    const intermediate = levels.find((level) => level.slug === 'intermediate');
    if (intermediate) await checkAndUnlockForUser(req.user.id, 'intermediate', intermediate.pct);
    res.json({ passed, correct, total, xpEarned: xp, lessonCompletedNow, newBadges, levels });
  } catch (err) {
    res.status(500).json({ message: 'Failed to record session', error: err.message });
  }
};

/* ────────────────────────── GET / badges ────────────────────────── */
exports.getBadges = async (req, res) => {
  try {
    const staff = isStaff(req.user);
    if (!staff) await ensureStats(req.user.id);
    const r = await db.query(
      `SELECT b.code, b.name, b.icon, b.description, b.xp_value, ub.unlocked_at
       FROM academy_badges b
       LEFT JOIN user_academy_badges ub ON ub.badge_code = b.code AND ub.user_id = $1
       ORDER BY b.xp_value ASC`,
      [req.user.id]
    );
    res.json({
      badges: r.rows.map((b) => ({
        ...b,
        unlocked: staff || !!b.unlocked_at,
        staffPreview: staff,
      })),
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to load badges', error: err.message });
  }
};