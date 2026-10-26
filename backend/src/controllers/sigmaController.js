const db = require('../config/database');
/* The one place that decides whose games/members a signed-in user may see. */
const visibility = require('../services/reviewVisibilityService');

/* ──────────── Σ Sigma Moves ────────────
   The brilliant moves found in a review, stored so they can be listed across
   games and across the four places a game can come from.

   OWNERSHIP MODEL
   A Sigma belongs to the person who PLAYED the game (owner_user_id), not to
   whoever reviewed it. That is the whole reason the screen works for a coach:
   a coach reviewing a student gets their own screen by default and can ask for
   a student's with ?userId=, but the rows still belong to the player.

   WHY (game_source, game_id) AND NOT game_id ALONE
   chess_games, online_games, computer_games and tournament_games each have
   their own SERIAL starting at 1. A Sigma in imported game #3 and a Sigma in
   the 3rd computer game are different moves in different games, and a plain
   game_id would silently merge them — and the merge would be invisible until
   someone's count was quietly wrong.

   RE-REVIEWING A GAME
   The unique key is (game_source, game_id, ply) and the write is an upsert, so
   re-analysing a game replaces its Sigmas rather than duplicating them. Moves
   that are no longer Sigma (the detector was fixed, the engine got a new
   depth) are deleted in the same call — otherwise a stale row would survive
   forever and the screen would report moves the current engine rejects. */

/** The four sources a game can come from. Mirrors the table's CHECK. */
const GAME_SOURCES = ['chess_profile', 'online', 'computer', 'tournament'];

const SIGMA_TYPES = [
  'queen_sacrifice',
  'rook_sacrifice',
  'bishop_sacrifice',
  'knight_sacrifice',
  'underpromotion',
];

const SOURCE_LABELS = {
  chess_profile: 'chess.com',
  online: 'Coach game',
  computer: 'Computer',
  tournament: 'Tournament',
};

/* Range presets for the screen's date filter. `all` is a real entry with null
   days, NOT a missing key: the filter must resolve `all` to itself so it can
   emit no date predicate at all. Leaving it out of the map made it fall through
   to the 90-day default, which quietly hid every older Sigma from the widest
   window on the screen. */
const RANGES = { d7: 7, d30: 30, d90: 90, y1: 365, all: null };

/**
 * Validate the POSTed moves before touching the database.
 *
 * Returns { moves, error }. Anything not an array of well-formed moves is
 * rejected as a whole rather than silently filtered: a partial write would
 * leave the screen showing some of a game's Sigmas and imply that is all of
 * them, which is worse than no write at all.
 */
function validateMoves(raw) {
  /* An EMPTY ARRAY IS VALID, and deliberately so. It is how a game stops having
     Sigmas: re-analysing after a detector fix can leave a move that is no longer
     brilliant, and the only way to clear its row is to post the new (empty) set.
     Rejecting it here meant a stale row survived forever — the exact opposite of
     what the replace-semantics below promise.
     What must be present is the GAME, so the caller sends gameSource/gameId at
     the top level alongside the array. */
  if (!Array.isArray(raw)) {
    return { error: 'moves must be an array (it may be empty)' };
  }
  const moves = [];
  for (const m of raw) {
    if (!m || typeof m !== 'object') return { error: 'each move must be an object' };
    const ply = Number(m.ply);
    if (!Number.isInteger(ply) || ply < 0) {
      return { error: 'each move needs a non-negative integer ply' };
    }
    if (!SIGMA_TYPES.includes(m.sigmaType)) {
      return { error: `unknown sigmaType '${m.sigmaType}'` };
    }
    const gameId = Number(m.gameId);
    if (!Number.isInteger(gameId) || gameId <= 0) {
      return { error: 'each move needs a positive integer gameId' };
    }
    if (!GAME_SOURCES.includes(m.gameSource)) {
      return { error: `unknown gameSource '${m.gameSource}'` };
    }
    moves.push({
      ply,
      gameId,
      gameSource: m.gameSource,
      sigmaType: m.sigmaType,
      moveSan: m.moveSan ? String(m.moveSan).slice(0, 20) : null,
      fromSquare: m.fromSquare ? String(m.fromSquare).slice(0, 2) : null,
      toSquare: m.toSquare ? String(m.toSquare).slice(0, 2) : null,
      fenBefore: m.fenBefore ? String(m.fenBefore).slice(0, 120) : null,
      playedAt: m.playedAt || null,
      whiteName: m.whiteName ? String(m.whiteName).slice(0, 120) : null,
      blackName: m.blackName ? String(m.blackName).slice(0, 120) : null,
      whiteRating: Number.isFinite(Number(m.whiteRating)) ? Number(m.whiteRating) : null,
      blackRating: Number.isFinite(Number(m.blackRating)) ? Number(m.blackRating) : null,
    });
  }
  return { moves };
}

/**
 * Confirm the target game exists and really belongs to `ownerUserId`.
 *
 * Without this a caller could write Sigmas against any game id in the system
 * and have them appear on someone else's screen — the row's own owner column
 * is set from this request, so an unchecked id is an authorisation hole, not a
 * cosmetic one. Each source has a different ownership shape, hence the switch.
 */
async function gameBelongsTo(source, gameId, ownerUserId) {
  if (source === 'chess_profile') {
    const r = await db.query(
      `SELECT 1 FROM chess_games g
         JOIN connected_chess_accounts a ON a.id = g.account_id
        WHERE g.id = $1 AND a.user_id = $2`,
      [gameId, ownerUserId]
    );
    return r.rows.length > 0;
  }
  if (source === 'computer') {
    const r = await db.query(
      `SELECT 1 FROM computer_games WHERE id = $1 AND student_user_id = $2`,
      [gameId, ownerUserId]
    );
    return r.rows.length > 0;
  }
  if (source === 'online') {
    /* online_games stores both players as users.id directly. */
    const r = await db.query(
      `SELECT 1 FROM online_games WHERE id = $1 AND (admin_id = $2 OR student_id = $2)`,
      [gameId, ownerUserId]
    );
    return r.rows.length > 0;
  }
  if (source === 'tournament') {
    const r = await db.query(
      `SELECT 1 FROM tournament_games
        WHERE id = $1 AND (white_player = $2 OR black_player = $2)`,
      [gameId, ownerUserId]
    );
    return r.rows.length > 0;
  }
  return false;
}

/**
 * Which of `userIds` (the caller's visible set) owns this game?
 *
 * The visibility-aware sibling of gameBelongsTo(): same four ownership shapes,
 * but tested against a SET rather than a single id, and it returns WHICH id
 * matched instead of a boolean — because the caller then has to read and write
 * rows keyed by the owning player, not by the viewer.
 *
 * Matches on ANY of the candidates, which is what "a coach may see a game
 * between their student and an opponent they cannot see" means.
 *
 * @returns {Promise<number|null>} the owning users.id, or null if none of the
 *   candidates owns this game (which is the caller's answer to "not visible")
 */
async function findGameOwnerIn(source, gameId, userIds) {
  const ids = (userIds || []).map(Number).filter((n) => n > 0);
  /* No candidates means no match by construction. Short-circuiting keeps
     `= ANY('{}')` off the wire for the common "coach with no students" case. */
  if (ids.length === 0) return null;

  /* EVERY branch must project the same column NAME. Without the alias the
     computer branch comes back as `student_user_id`, the two-player branches as
     an unnameable `case`, and the single `rows[0].user_id` read below silently
     yields undefined - i.e. a 404 for a game the caller is entitled to see. */
  const bySource = {
    chess_profile: `SELECT a.user_id AS user_id
                       FROM chess_games g
                       JOIN connected_chess_accounts a ON a.id = g.account_id
                      WHERE g.id = $1 AND a.user_id = ANY($2::int[])
                      LIMIT 1`,
    computer: `SELECT cg.student_user_id AS user_id
                 FROM computer_games cg
                WHERE cg.id = $1 AND cg.student_user_id = ANY($2::int[])
                LIMIT 1`,
    /* online_games stores both players as users.id, so either may be the match. */
    online: `SELECT (CASE WHEN og.admin_id = ANY($2::int[])
                           THEN og.admin_id ELSE og.student_id END) AS user_id
               FROM online_games og
              WHERE og.id = $1
                AND (og.admin_id = ANY($2::int[]) OR og.student_id = ANY($2::int[]))
              LIMIT 1`,
    tournament: `SELECT (CASE WHEN tg.white_player = ANY($2::int[])
                               THEN tg.white_player ELSE tg.black_player END) AS user_id
                   FROM tournament_games tg
                  WHERE tg.id = $1
                    AND (tg.white_player = ANY($2::int[]) OR tg.black_player = ANY($2::int[]))
                  LIMIT 1`,
  };
  const sql = bySource[source];
  if (!sql) return null;
  const r = await db.query(sql, [gameId, ids]);
  return r.rows.length > 0 && r.rows[0].user_id != null ? Number(r.rows[0].user_id) : null;
}

/**
 * Replace a game's Sigma rows with the set just reviewed.
 *
 * Runs as one transaction so a failure cannot leave the game with half its
 * Sigmas replaced. The DELETE is scoped to the exact (source, game, owner) so
 * one player's Sigmas in a shared game — a coach game has two players — are
 * never removed when the other player re-analyses the same game.
 */
async function replaceGameSigmas(ownerUserId, source, gameId, moves) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM sigma_moves
        WHERE owner_user_id = $1 AND game_source = $2 AND game_id = $3`,
      [ownerUserId, source, gameId]
    );
    for (const m of moves) {
      await client.query(
        `INSERT INTO sigma_moves (
           owner_user_id, game_source, game_id, ply, sigma_type,
           move_san, from_square, to_square, fen_before, played_at,
           white_name, black_name, white_rating, black_rating
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (game_source, game_id, ply) DO UPDATE SET
           owner_user_id = EXCLUDED.owner_user_id,
           sigma_type    = EXCLUDED.sigma_type,
           move_san      = EXCLUDED.move_san,
           from_square   = EXCLUDED.from_square,
           to_square     = EXCLUDED.to_square,
           fen_before    = EXCLUDED.fen_before,
           played_at     = EXCLUDED.played_at,
           white_name    = EXCLUDED.white_name,
           black_name    = EXCLUDED.black_name,
           white_rating  = EXCLUDED.white_rating,
           black_rating  = EXCLUDED.black_rating,
           updated_at    = NOW()`,
        [
          ownerUserId, source, gameId, m.ply, m.sigmaType,
          m.moveSan, m.fromSquare, m.toSquare, m.fenBefore, m.playedAt,
          m.whiteName, m.blackName, m.whiteRating, m.blackRating,
        ]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

function shape(row) {
  return {
    id: row.id,
    gameSource: row.game_source,
    sourceLabel: SOURCE_LABELS[row.game_source] || row.game_source,
    gameId: row.game_id,
    ply: row.ply,
    moveNumber: Math.floor(row.ply / 2) + 1,
    sigmaType: row.sigma_type,
    moveSan: row.move_san,
    fromSquare: row.from_square,
    toSquare: row.to_square,
    fenBefore: row.fen_before,
    playedAt: row.played_at,
    /* Whether the move was the viewer's own or a student's, for the "these are
       X's moves" note. The COLOUR is separate and comes from owner_color — the
       two must not be conflated, or a coach looking at a student's Black game
       would be told the move was theirs. */
    playedBy: row.owner_user_id === row.viewer_user_id
      ? 'self'
      : (row.owner_color === 'white' || row.owner_color === 'black' ? row.owner_color : 'self'),
    whiteName: row.white_name,
    blackName: row.black_name,
    whiteRating: row.white_rating,
    blackRating: row.black_rating,
    /* The colour the owner played, so a card can be drawn from their side.
       Resolved in SQL per source (see the list query) because no single column
       name carries it across all four game tables. */
    ownerColor: row.owner_color || null,
  };
}

/* WHICH COLOUR THE OWNER PLAYED, resolved per source in SQL.
   Each source records it differently and none of them share a column name:
     chess_profile — my_color on the imported game (the account owner's side)
     computer      — player_color on the game
     online        — admin_color is the ADMIN's side, so the student's is the
                     other one, and which of the two is the owner decides it
     tournament    — white_player / black_player are users ids
   A single column name does not exist across all four, so the alias is a
   per-source CASE. Selecting chess_games.white_player (which does not exist —
   the column is my_color) made every request 500 in an earlier draft. */
const RESOLVED_SQL = `
  SELECT sm.id, sm.owner_user_id, sm.game_source, sm.game_id, sm.ply, sm.sigma_type,
         sm.move_san, sm.from_square, sm.to_square, sm.fen_before, sm.played_at,
         sm.white_name, sm.black_name, sm.white_rating, sm.black_rating,
         CASE sm.game_source
           WHEN 'chess_profile' THEN cp.my_color
           WHEN 'computer'      THEN cg.player_color
           WHEN 'online'        THEN CASE
                                      WHEN og.admin_id = sm.owner_user_id THEN og.admin_color
                                      WHEN og.student_id = sm.owner_user_id
                                        THEN CASE WHEN og.admin_color = 'white'
                                                  THEN 'black' ELSE 'white' END
                                      ELSE NULL
                                    END
           WHEN 'tournament'    THEN CASE
                                      WHEN tg.white_player = sm.owner_user_id THEN 'white'
                                      WHEN tg.black_player = sm.owner_user_id THEN 'black'
                                      ELSE NULL
                                    END
           ELSE NULL
         END AS owner_color
    FROM sigma_moves sm
    LEFT JOIN chess_games cp
           ON sm.game_source = 'chess_profile' AND cp.id = sm.game_id
    LEFT JOIN computer_games cg
           ON sm.game_source = 'computer' AND cg.id = sm.game_id
    LEFT JOIN online_games og
           ON sm.game_source = 'online' AND og.id = sm.game_id
    LEFT JOIN tournament_games tg
           ON sm.game_source = 'tournament' AND tg.id = sm.game_id
`;
const RESOLVED_CTE = `WITH resolved AS (${RESOLVED_SQL})`;

/* The owner's OWN moves only. A review files every Sigma in a game under the
   player who OWNS it — including the opponent's, and a coach game has two
   players — so the list must keep only the side the owner actually played.
   White moves sit on even plies, Black on odd. A move whose colour could not
   be resolved is KEPT: hiding an unattributable move is worse than drawing one
   card from the wrong side of the board. */
const OWN_MOVE_SQL = `(r.owner_color IS NULL
    OR (r.owner_color = 'white' AND r.ply % 2 = 0)
    OR (r.owner_color = 'black' AND r.ply % 2 = 1))`;

/**
 * GET /api/sigma/moves — one player's Sigmas across every source.
 *
 * `?userId=` is honoured for coaches only, and a coach may only ask for a user
 * who is actually one of their students; a student asking for anyone else is
 * silently reduced to their own id rather than 403'd, so the screen keeps
 * working for them without leaking whether the other account exists.
 */
exports.list = async (req, res) => {
  try {
    const visibleIds = await visibility.getVisibleUserIds(req.user);
    let ownerUserId = req.user.id;
    const requested = req.query.userId ? Number(req.query.userId) : null;
    if (requested && requested !== req.user.id) {
      /* A student asking for anyone else is silently reduced to their own id
         rather than 403'd, so the screen keeps working for them without leaking
         whether the other account exists. Staff get a hard refusal: a coach's
         reach must be their own students, not "every account in the database". */
      if (req.user.role === 'student') {
        ownerUserId = req.user.id;
      } else if (!visibility.canSeeUser(visibleIds, requested)) {
        return res.status(403).json({ message: 'That player is not one of your students' });
      } else {
        ownerUserId = requested;
      }
    }

    const range = RANGES[req.query.range] !== undefined ? req.query.range : 'd90';
    const days = RANGES[range];
    const type = SIGMA_TYPES.includes(req.query.type) ? req.query.type : null;
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(60, Math.max(1, Number(req.query.pageSize) || 12));

    const params = [ownerUserId];
    const where = ['r.owner_user_id = $1', OWN_MOVE_SQL];

    /* A game with no known date must NOT be hidden by a date filter — the
       screen would then look like the player has fewer Sigmas than they do.
       So "all time" is a plain filter and every other range keeps undated rows
       in rather than pretending they are outside the window. */
    if (days) {
      params.push(days);
      where.push(`(r.played_at IS NULL OR r.played_at >= NOW() - ($${params.length} || ' days')::interval)`);
    }
    if (type) {
      params.push(type);
      where.push(`r.sigma_type = $${params.length}`);
    }

    const whereSql = where.join(' AND ');
    const countRes = await db.query(
      `${RESOLVED_CTE} SELECT COUNT(*)::int AS total FROM resolved r WHERE ${whereSql}`,
      params
    );
    const total = countRes.rows[0].total;

    /* Counts for the filter chips come from the date-filtered set but NOT from
       the type filter — otherwise selecting "Queen Sacrifice" would empty every
       other chip and make the counts unreadable. Unknown/legacy type strings are
       ignored rather than added, so the chip row always matches the five the UI
       can render. The owner-only predicate is the same as the list's, so the
       chips can never disagree with the grid they sit above. */
    const typeCountRes = await db.query(
      `${RESOLVED_CTE}
       SELECT r.sigma_type, COUNT(*)::int AS n
         FROM resolved r
        WHERE r.owner_user_id = $1
          AND ${OWN_MOVE_SQL}
          ${days ? `AND (r.played_at IS NULL OR r.played_at >= NOW() - ($2 || ' days')::interval)` : ''}
        GROUP BY r.sigma_type`,
      days ? [ownerUserId, days] : [ownerUserId]
    );
    const typeCounts = {};
    for (const t of SIGMA_TYPES) typeCounts[t] = 0;
    for (const row of typeCountRes.rows) {
      if (SIGMA_TYPES.includes(row.sigma_type)) typeCounts[row.sigma_type] = row.n;
    }

    const rowsRes = await db.query(
      `${RESOLVED_CTE}
       SELECT r.* FROM resolved r
        WHERE ${whereSql}
        ORDER BY r.played_at DESC NULLS LAST, r.game_id DESC, r.ply ASC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, (page - 1) * pageSize]
    );

    res.json({
      moves: rowsRes.rows.map((r) => shape({ ...r, viewer_user_id: req.user.id })),
      typeCounts,
      range,
      page,
      pageSize,
      total,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
      ownerUserId,
      /* Sent to the client so the screen can say whose list it is showing —
         otherwise a coach looking at a student sees their own name and thinks
         the data is wrong. */
      ownerName: ownerUserId === req.user.id
        ? 'you'
        : (await db.query('SELECT name FROM users WHERE id = $1', [ownerUserId]))
          .rows[0]?.name || null,
      sources: GAME_SOURCES.map((s) => ({ key: s, label: SOURCE_LABELS[s] })),
      sigmaTypes: SIGMA_TYPES,
    });
  } catch (err) {
    console.error('sigma list error:', err);
    res.status(500).json({ message: 'Failed to load Sigma moves', error: err.message });
  }
};

/**
 * POST /api/sigma/moves — persist the Sigmas from a finished review.
 *
 * Replaces the whole set for that one game, so it is safe to call on every
 * re-analysis. All moves must belong to the SAME game: the endpoint is "these
 * are the Sigmas of game X", and silently splitting a mixed batch across games
 * would make a bug in the caller look like a successful write.
 */
exports.save = async (req, res) => {
  try {
    const { moves: raw, userId, gameSource, gameId } = req.body || {};

    const visibleIds = await visibility.getVisibleUserIds(req.user);
    let ownerUserId = req.user.id;
    const requested = userId ? Number(userId) : null;
    if (requested && requested !== req.user.id) {
      if (req.user.role === 'student') {
        return res.status(403).json({ message: 'You can only save your own Sigma moves' });
      }
      if (!visibility.canSeeUser(visibleIds, requested)) {
        return res.status(403).json({ message: 'That player is not one of your students' });
      }
      ownerUserId = requested;
    }

    const { moves, error } = validateMoves(raw);
    if (error) return res.status(400).json({ message: error });

    /* WHICH GAME — from the moves themselves, or from the top level when the
       batch is empty. An empty batch names no move, so the caller MUST say which
       game it is clearing; without that there is nothing to delete and a 400 is
       the only honest answer. */
    const first = moves[0];
    let source = first ? first.gameSource : gameSource;
    let id = first ? first.gameId : Number(gameId);
    if (!first) {
      if (!GAME_SOURCES.includes(gameSource)) {
        return res.status(400).json({
          message: 'an empty batch must name the game it clears: gameSource is required',
        });
      }
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({
          message: 'an empty batch must name the game it clears: gameId is required',
        });
      }
    } else if (moves.some((m) => m.gameId !== first.gameId || m.gameSource !== first.gameSource)) {
      return res.status(400).json({
        message: 'All moves must belong to the same game — post one game at a time',
      });
    }
    /* A top-level gameSource/gameId must not contradict the moves, or a buggy
       caller could clear one game's rows while writing another's. */
    if (first && gameSource && gameSource !== first.gameSource) {
      return res.status(400).json({ message: 'gameSource disagrees with the moves' });
    }
    if (first && gameId && Number(gameId) !== first.gameId) {
      return res.status(400).json({ message: 'gameId disagrees with the moves' });
    }

    /* A game with no Sigmas is a legitimate review outcome and must be able to
       clear its previous rows, so the ownership check runs even when the list
       is empty. */
    const owned = await gameBelongsTo(source, id, ownerUserId);
    if (!owned) {
      return res.status(404).json({ message: 'Game not found for that player' });
    }

    await replaceGameSigmas(ownerUserId, source, id, moves);

    res.json({ ok: true, saved: moves.length, gameId: id, gameSource: source });
  } catch (err) {
    console.error('sigma save error:', err);
    res.status(500).json({ message: 'Failed to save Sigma moves', error: err.message });
  }
};

/** GET /api/sigma/moves/:source/:gameId — the Sigmas of one game. */
exports.forGame = async (req, res) => {
  try {
    const { source, gameId } = req.params;
if (!GAME_SOURCES.includes(source)) {
      return res.status(400).json({ message: `Unknown game source '${source}'` });
    }
    const gid = Number(gameId);
    if (!Number.isInteger(gid) || gid <= 0) {
      return res.status(400).json({ message: 'Invalid game id' });
    }
    /* The game is visible when AT LEAST ONE of its players is visible: a coach
       reviews their student's games and may see the opponent by name, without
       gaining any route to the opponent's other games. */
    const visibleIds = await visibility.getVisibleUserIds(req.user);
    const ids = visibility.visibleIdArray(visibleIds);
    const owner = await findGameOwnerIn(source, gid, ids);
    if (!owner) {
      return res.status(404).json({ message: 'Game not found' });
    }
    const r = await db.query(
      `SELECT * FROM sigma_moves
        WHERE owner_user_id = $1 AND game_source = $2 AND game_id = $3
        ORDER BY ply ASC`,
      [owner, source, gid]
    );
    res.json({
      moves: r.rows.map((row) => shape({ ...row, white_player_id: null, viewer_user_id: req.user.id })),
    });
  } catch (err) {
    console.error('sigma forGame error:', err);
    res.status(500).json({ message: 'Failed to load Sigma moves', error: err.message });
  }
};

exports.GAME_SOURCES = GAME_SOURCES;
exports.SIGMA_TYPES = SIGMA_TYPES;