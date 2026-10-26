/* eslint-disable no-console */
const { enqueueGame } = require('./analysisStore');

/* ──────────── The enqueue hooks ────────────

   Four places finish or import a game; each one calls the hook for its source
   here, immediately after the row is durably written.

   WHY A HOOK AND NOT A POLLER
   A poller would have to sweep every game table on a timer to notice new games,
   which means both a scan cost and a window (up to one tick) where a student has
   finished a game and nothing is queued for it. Calling enqueue at the write site
   makes the queue lag the game by milliseconds and nothing more.

   WHY NONE OF THESE MAY THROW
   Every hook is called from the middle of someone else's request — saving a game,
   importing a profile, ending a match. An analysis queue that is down or a
   database hiccup while INSERTing a job must NOT roll back the game or turn a
   successful save into a 500. So every hook is wrapped: a failure logs and the
   game is still saved. The degraded state is "this game was not queued", which
   the review page covers by falling back to analysing in the browser, exactly as
   it did before this feature existed.

   WHY enqueueGame IS SAFE TO CALL ON EVERY SAVE
   It is an ON CONFLICT DO NOTHING upsert, so a duplicate finish event, a
   re-sync and a manual retry all collapse to one row, and an already-DONE game is
   left completely alone. */

async function safeEnqueue(label, args) {
  try {
    return await enqueueGame(args);
  } catch (err) {
    console.error(`[analysis] ${label} hook failed:`, err.message);
    return { queued: false, reason: 'hook_failed', error: err.message };
  }
}

/**
 * An online (coach-vs-student) match has finished.
 *
 * Owner is the STUDANT, not "whoever was moving". The student's history is where
 * this game belongs; the coach can still read it, because mayRead admits both
 * participants of an online game.
 */
async function onlineGameFinished(row) {
  if (!row || !row.id) return { queued: false, reason: 'no_row' };
  return safeEnqueue('online', {
    gameSource: 'online',
    gameId: row.id,
    ownerUserId: row.student_id,
    /* The PGN as stored. A game abandoned before a single move has none, and
       enqueueGame rejects it as not analysable rather than burning a job. */
    pgn: row.pgn,
  });
}

/** A game against the in-app computer was saved. */
async function computerGameSaved(row) {
  if (!row || !row.id) return { queued: false, reason: 'no_row' };
  return safeEnqueue('computer', {
    gameSource: 'computer',
    gameId: row.id,
    ownerUserId: row.student_user_id || row.studentUserId,
    pgn: row.pgn,
    movesCount: row.moves_count,
  });
}

/**
 * A game arrived from a connected chess.com / Lichess account.
 *
 * Called per imported game inside the sync loop, which is why the store caps how
 * many profile_import jobs may be in flight: one sync can carry hundreds of
 * games, and queueing all of them would put a student's just-finished game
 * behind an hour of backfill.
 */
async function profileGameImported(row, ownerUserId) {
  if (!row || !row.id) return { queued: false, reason: 'no_row' };
  return safeEnqueue('chess_profile', {
    gameSource: 'chess_profile',
    gameId: row.id,
    ownerUserId,
    pgn: row.pgn,
    movesCount: row.moves_count,
  });
}

/** A tournament pairing game has finished. Owner is the white player if present. */
async function tournamentGameFinished(row) {
  if (!row || !row.id) return { queued: false, reason: 'no_row' };
  return safeEnqueue('tournament', {
    gameSource: 'tournament',
    gameId: row.id,
    ownerUserId: row.white_player || row.black_player,
    pgn: row.pgn,
  });
}

module.exports = {
  onlineGameFinished,
  computerGameSaved,
  profileGameImported,
  tournamentGameFinished,
};
