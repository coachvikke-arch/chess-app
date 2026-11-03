const db = require('../config/database');

/* One profile read, shared by every endpoint that hands the client a user
   object: /auth/me, the preferences save, the photo upload/removal and both
   avatar endpoints (self and admin). The frontend rewrites its auth cache and
   every avatar in the app straight from those responses, so any shorter column
   list silently drops fields — coach names, student id, board prefs — from the
   signed-in user the moment one of them is used. */
const PROFILE_SQL = `SELECT u.id, u.name, u.email, u.username, u.phone, u.country_code, u.role, u.profile_image, u.avatar_config, u.board_theme, u.board_light_color, u.board_dark_color, u.piece_set, u.board_frame, u.created_at, u.updated_at,
               u.must_change_password,
               s.default_board_theme AS recommended_board_theme,
               s.id AS student_id, s.group_id, s.active, s.nickname, s.birthdate, s.parent_name,
               s.gender, s.preferred_language, g.name AS group_name,
               COALESCE(cu.name, gc.name) AS coach_name,
               COALESCE((
                 SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name)
                                 ORDER BY (c.id = s.coach_id) DESC, c.name)
                 FROM student_coaches sc JOIN users c ON c.id = sc.coach_id
                 WHERE sc.student_id = s.id
               ), '[]'::jsonb) AS coach_names
        FROM users u
        LEFT JOIN students s ON s.user_id = u.id
        LEFT JOIN groups g ON g.id = s.group_id
        LEFT JOIN users cu ON cu.id = s.coach_id
        LEFT JOIN users gc ON gc.id = g.coach_id
        WHERE u.id = $1`;

/** The same user object /auth/me returns, or null when the id has no account. */
async function fetchProfile(userId) {
  const result = await db.query(PROFILE_SQL, [userId]);
  return result.rows.length === 0 ? null : result.rows[0];
}

module.exports = { fetchProfile, PROFILE_SQL };
