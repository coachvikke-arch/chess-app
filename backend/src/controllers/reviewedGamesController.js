const db = require('../config/database');

/* "Reviewed" marks — see migrations/add_reviewed_games.sql.
 *
 * A mark says: this viewer watched a Stockfish review of this game reach the
 * end. It is written by the browser at the moment the review is genuinely
 * complete, and it is deliberately permanent — re-opening the game and running
 * the analysis again is a no-op, which is why the insert conflicts are ignored
 * rather than treated as an error.
 *
 * The viewer, the platform and the game are all resolved server-side:
 * `req.user.id` comes from the JWT (middleware/authMiddleware.js) and is the
 * ONLY owner value used. Nothing here reads a user id from the body or the
 * query, so one user can never mark or list another user's games.
 */

/* The three platforms a mark can belong to. 'chess.com' and 'lichess' are the
   spellings the rest of the schema already uses (connected_chess_accounts),
   'matezone' is the app's own games. The CHECK constraint in the migration is
   the same list — a value outside it is rejected here rather than at the DB,
   so the caller gets a 400 with the allowed set instead of a 500. */
const PLATFORMS = ['matezone', 'chess.com', 'lichess'];

/* Matches the column width. Longer input is a mistake, not a game we support. */
const MAX_GAME_ID_LENGTH = 160;

exports.list = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT platform, game_id FROM reviewed_games
        WHERE user_id = $1
        ORDER BY reviewed_at DESC`,
      [req.user.id]
    );
    /* `platform:game_id` — the exact key shape the card looks up, so the
       frontend Set and the server can never disagree about what identifies a
       game. */
    res.json({ reviewed: result.rows.map((r) => `${r.platform}:${r.game_id}`) });
  } catch (err) {
    res.status(500).json({ message: 'Failed to load reviewed games', error: err.message });
  }
};

exports.mark = async (req, res) => {
  try {
    const { platform, gameId } = req.body || {};

    if (!PLATFORMS.includes(platform)) {
      return res.status(400).json({ message: `Unknown platform '${platform}'`, platforms: PLATFORMS });
    }
    /* Numbers are accepted because the imported-game id is a serial integer in
       the browser; it is stored as text either way. */
    const id = typeof gameId === 'number' ? String(gameId) : gameId;
    if (typeof id !== 'string' || id.trim() === '') {
      return res.status(400).json({ message: 'gameId must be a non-empty string' });
    }
    if (id.length > MAX_GAME_ID_LENGTH) {
      return res.status(400).json({ message: `gameId must be ${MAX_GAME_ID_LENGTH} characters or fewer` });
    }

    const trimmed = id.trim();
    const result = await db.query(
      `INSERT INTO reviewed_games (user_id, platform, game_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, platform, game_id) DO NOTHING
       RETURNING reviewed_at`,
      [req.user.id, platform, trimmed]
    );

    /* Idempotent: a repeat mark returns 200 like the first one. `already` only
       tells the browser whether the row is new, which it does not act on. */
    res.json({ ok: true, already: result.rowCount === 0 });
  } catch (err) {
    res.status(500).json({ message: 'Failed to save reviewed game', error: err.message });
  }
};
