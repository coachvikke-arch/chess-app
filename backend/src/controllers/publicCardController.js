const db = require('../config/database');
const { levelForRating } = require('../services/ratingService');

/* Every value the gold player card can show. Deliberately a whitelist: the row
   also carries email, phone, birthdate, parent/guardian and internal ids, and
   none of those may ever reach an unauthenticated request. */
const CARD_SQL = `SELECT u.name, u.username, u.role, u.profile_image, u.avatar_config,
                         u.created_at, u.login_streak, u.public_token,
                         s.games_played, s.current_rating,
                         rt.rating AS rapid_rating,
                         (SELECT COUNT(*)::int
                            FROM students st
                           WHERE st.coach_id = u.id
                              OR EXISTS (SELECT 1 FROM student_coaches sc
                                          WHERE sc.coach_id = u.id AND sc.student_id = st.id)
                         ) AS students_count,
                         (SELECT COUNT(*)::int FROM classes c WHERE c.coach_id = u.id) AS classes_count
                    FROM users u
                    LEFT JOIN students s ON s.user_id = u.id
                    LEFT JOIN student_time_ratings rt
                           ON rt.student_id = s.id AND rt.time_class = 'rapid'
                   WHERE u.public_token = $1 AND u.card_public = TRUE
                   LIMIT 1`;

function cardFromRow(row) {
  const isStudent = row.role === 'student';
  /* Coaches have no rating of their own; the card shows "—" rather than a
     number borrowed from somewhere else. */
  const rating = isStudent ? (row.rapid_rating ?? row.current_rating ?? null) : null;
  const level = isStudent && rating != null ? levelForRating(Number(rating)) : null;
  return {
    name: row.name || '',
    username: row.username || null,
    roleLabel: isStudent ? 'STUDENT' : 'COACH',
    subtitle: isStudent
      ? (level ? `Level ${level.level} · ${level.name}` : 'Unrated')
      : (row.role === 'superadmin' ? 'Super Admin' : 'Head Coach'),
    level: level ? { number: level.level, name: level.name } : null,
    avatar: { config: row.avatar_config || null, image: row.profile_image || null },
    rating: rating != null ? Number(rating) : null,
    dayStreak: Number(row.login_streak || 0),
    puzzleRating: null,
    gamesPlayed: row.games_played != null ? Number(row.games_played) : null,
    joinedAt: row.created_at || null,
    /* Derived from the share token, never the sequential users.id. */
    memberId: `MZ-${String(row.public_token || '').slice(0, 6).toUpperCase()}`,
    studentsCount: isStudent ? null : Number(row.students_count || 0),
    classesCount: isStudent ? null : Number(row.classes_count || 0),
  };
}

exports.getCard = async (req, res) => {
  try {
    const token = String(req.params.token || '').trim();
    if (!token || token.length > 64) return res.status(404).json({ message: 'Card not available' });
    const result = await db.query(CARD_SQL, [token]);
    if (result.rows.length === 0) return res.status(404).json({ message: 'Card not available' });
    res.set('Cache-Control', 'public, max-age=60');
    res.json({ card: cardFromRow(result.rows[0]) });
  } catch (err) {
    console.error('Public card lookup failed:', err.message);
    res.status(500).json({ message: 'Card not available' });
  }
};
