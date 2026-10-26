/* eslint-disable no-console */
const db = require('../../config/database');

/* ──────────── Loading a queued game into something the review pipeline can run ────────────

   The four sources store a game differently, so each one gets its own loader that
   answers the SAME four questions:

     ownerUserId  — whose analysis this is (decides who may read the result)
     initialFen   — the position the game started from
     moves        — the moves, as SAN, in order
     playedAt     — WHEN THE GAME WAS PLAYED, not when it was analysed

   The last one is not a detail. Every date filter on the review screen buckets
   by when the game was played; defaulting to "now" would make a game analysed
   hours later appear in "today", and the student's own history would disagree
   with the review screen about the same game.

   WHY A PGN AND NOT A MOVE ARRAY
   Every source stores a PGN, and the review pipeline (frontend/src/utils/
   gameReview.js reviewGame) takes (initialFen, moves) with moves as SAN. The PGN
   is parsed here, once, and the pipeline's chess.js replay does the validation:
   a PGN that will not replay throws in reviewGame, which the worker records as a
   real failure rather than storing verdicts for a game nobody can replay.

   A PGN carries its own [FEN "..."] tag for a game that started from a setup,
   so `fen` from the row is only a fallback — the tag is the more specific
   record of where the game actually began. */

const SOURCES = {
  /* Coach-vs-student live match. online_games stores both players as users.id,
     so BOTH may read the analysis; owner_user_id is the student (the person
     whose history this appears in), while the reader check below admits the
     coach too. */
  online: {
    sql: `SELECT g.id, g.fen, g.pgn, g.status, g.result, g.admin_id, g.student_id,
                 g.created_at, g.updated_at
            FROM online_games g WHERE g.id = $1`,
    owner: (r) => r.student_id,
    /* An unfinished game has moves so far but no result — reviewing it would
       publish verdicts for a game that is still being played, and the PGN would
       grow afterwards, making the stored analysis stale by definition. */
    isAnalysable: (r) => r.status === 'finished',
    playedAt: (r) => r.updated_at || r.created_at,
  },

  /* Game against the in-app computer. Owned outright by one student. */
  computer: {
    sql: `SELECT id, fen, pgn, status, result, moves_count, student_user_id, created_at
            FROM computer_games WHERE id = $1`,
    owner: (r) => r.student_user_id,
    isAnalysable: (r) => r.status === 'finished',
    playedAt: (r) => r.created_at,
  },

  /* Synced from a connected chess.com / Lichess account. The owner is one hop
     away, through connected_chess_accounts.
     Note there is no `fen` column here — chess_games stores the game as the
     platform's PGN, and a synced game always starts from the initial position.
     `initialFen` therefore comes from the PGN's own [FEN] tag or falls back to
     'start'; selecting a non-existent fen would make every imported job fail. */
  chess_profile: {
    sql: `SELECT g.id, g.pgn, g.moves_count, g.game_date, g.end_time_ms,
                 g.white_name, g.black_name, g.opening, g.eco, a.user_id
            FROM chess_games g
            JOIN connected_chess_accounts a ON a.id = g.account_id
           WHERE g.id = $1`,
    owner: (r) => r.user_id,
    isAnalysable: () => true,
    /* A synced game has no TIMESTAMP column, only a DATE (and sometimes the
       platform's epoch-ms end time). Date wins when present — it is what the
       review screen's own filters read — and the epoch is the fallback. */
    playedAt: (r) => r.game_date || (r.end_time_ms ? new Date(Number(r.end_time_ms)) : null),
  },

  /* Tournament pairing game, played in-app by two students. */
  tournament: {
    sql: `SELECT id, fen, pgn, status, result, white_player, black_player, updated_at, created_at
            FROM tournament_games WHERE id = $1`,
    owner: (r) => r.white_player || r.black_player,
    isAnalysable: (r) => r.status === 'finished',
    playedAt: (r) => r.updated_at || r.created_at,
  },
};

/** The [FEN "..."] tag of a PGN, if it has one. */
function fenTagOf(pgn) {
  const m = String(pgn || '').match(/\[FEN\s+"([^"]+)"/i);
  return m ? m[1] : null;
}

/**
 * Fetch and normalise a queued game.
 *
 * Returns { ok: true, game } or { ok: false, reason }. `reason` is a stable
 * token the worker can distinguish so it does not retry a game that will never
 * be analysable (a deleted row, an unfinished game) against one that might be
 * (a transient read failure).
 */
async function loadGame(gameSource, gameId) {
  const spec = SOURCES[gameSource];
  if (!spec) return { ok: false, reason: 'unknown_source' };

  let row;
  try {
    const { rows } = await db.query(spec.sql, [gameId]);
    if (!rows.length) return { ok: false, reason: 'game_not_found' };
    [row] = rows;
  } catch (err) {
    console.error(`[analysis] could not load ${gameSource}#${gameId}:`, err.message);
    return { ok: false, reason: 'load_failed', error: err };
  }

  if (!spec.isAnalysable(row)) {
    return { ok: false, reason: 'game_not_finished' };
  }

  const pgn = row.pgn || '';
  if (!pgn.trim()) return { ok: false, reason: 'no_moves' };

  /* The row's fen is the fallback; the PGN's own [FEN] tag is the more precise
     record and wins when both exist. 'start' is the review pipeline's token for
     the initial position — passing a literal start FEN string works too, but
     'start' keeps the stored value identical to what the browser sends. */
  const initialFen = fenTagOf(pgn) || row.fen || 'start';

  const ownerUserId = spec.owner(row);
  if (!Number.isInteger(ownerUserId) || ownerUserId <= 0) {
    /* A tournament pairing whose players were deleted has no owner, so the
       NOT NULL owner_user_id cannot be satisfied. Nothing to analyse for. */
    return { ok: false, reason: 'no_owner' };
  }

  return {
    ok: true,
    game: {
      gameSource,
      gameId: Number(gameId),
      ownerUserId,
      initialFen,
      pgn,
playedAt: spec.playedAt(row) || null,
      whiteName: row.white_name || null,
      blackName: row.black_name || null,
      movesCount: Number(row.moves_count) || null,
      /* Whatever the SOURCE already knows about the opening. chess.com/Lichess
         hand us a real ECO classification, which is strictly better than
         anything inferrable from a local book, so the runner prefers it. */
      openingName: row.opening || null,
      ecoCode: row.eco || null,
    },
  };
}

module.exports = { SOURCES, loadGame, fenTagOf };
