/**
 * Pure replay maths for the per-time-control rating repair.
 *
 * Shared by scripts/fix_per_control_ratings.js and the offline regression test,
 * so the numbers the migration writes are produced by exactly one implementation
 * — the same expectation/ K-factor functions the live service uses.
 *
 * INPUT is one history table's rows (rating_history OR
 * time_control_rating_history). Both carry the same columns, so either can be
 * replayed on its own:
 *   { id, student_id, time_class, time_control, opponent_id, result, played_at,
 *     online_game_id, tournament_game_id }
 *
 * OUTPUT is a Map of history-row id → { timeClass, ratingBefore, ratingAfter,
 * ratingChange }, plus the final state of every (student, class) pool.
 *
 * A "game" is the pair of rows one match wrote (one per player). Rows carrying
 * an online_game_id / tournament_game_id are grouped by it. Legacy rows have no
 * game reference, so they are paired by unordered player pair + class, taking
 * consecutive complementary results (win/loss or draw/draw) in time order —
 * the same pairing the backfill uses.
 */
const rating = require('../../src/services/ratingService');

const RESULT_SCORE = { win: 1, draw: 0.5, loss: 0 };

function scoreOf(result) {
  const s = RESULT_SCORE[result];
  return s === undefined ? null : s;
}

function normaliseClass(row) {
  if (row.time_class && rating.TIME_CLASSES.includes(row.time_class)) return row.time_class;
  return rating.classifyTimeControl(row.time_control);
}

function gameRef(row) {
  if (row.online_game_id != null) return `online:${row.online_game_id}`;
  if (row.tournament_game_id != null) return `tournament:${row.tournament_game_id}`;
  return null;
}

function at(row) {
  return new Date(row.played_at).getTime();
}

/**
 * Turn history rows into chronological games.
 *
 * Returns { games, skipped, duplicates }:
 *   games ... [{ ref, playedAt, order, sides: [row…] }]
 *   skipped ... rows whose class/result cannot be replayed (left untouched)
 *   duplicates ... rows for a gameId already replayed (neutralised, not deleted)
 */
function buildGames(rows) {
  const skipped = [];
  const duplicates = [];
  const byRef = new Map();
  const legacy = new Map();

  for (const row of rows) {
    const timeClass = normaliseClass(row);
    const score = scoreOf(row.result);
    if (!timeClass || score === null) {
      skipped.push({ id: row.id, time_class: row.time_class, time_control: row.time_control, result: row.result });
      continue;
    }
    const side = {
      id: row.id,
      studentId: row.student_id,
      timeClass,
      score,
      opponentId: row.opponent_id ?? null,
      playedAt: row.played_at,
    };
    const ref = gameRef(row);
    if (ref) {
      if (!byRef.has(ref)) byRef.set(ref, []);
      byRef.get(ref).push(side);
    } else {
      const lo = side.opponentId == null
        ? `solo:${side.studentId}`
        : `p:${Math.min(side.studentId, side.opponentId)}:${Math.max(side.studentId, side.opponentId)}`;
      const key = `${lo}:${timeClass}`;
      if (!legacy.has(key)) legacy.set(key, []);
      legacy.get(key).push(side);
    }
  }

  const games = [];

  /* Referenced games: one entry per gameId. A repeated side for the same
     student under one gameId is a duplicate rating of that game — it must not
     move a pool a second time. */
  for (const [ref, sides] of byRef) {
    sides.sort((a, b) => at(a) - at(b) || a.id - b.id);
    const seen = new Set();
    const unique = [];
    for (const s of sides) {
      if (seen.has(s.studentId)) {
        /* The first row for this student wins; the repeat keeps its own id but
           is neutralised after the replay (before = after = the applied value). */
        const kept = unique.find((u) => u.studentId === s.studentId);
        duplicates.push({ id: s.id, ref, studentId: s.studentId, keptId: kept.id });
        continue;
      }
      seen.add(s.studentId);
      unique.push(s);
    }
    if (!unique.length) continue;
    games.push({
      ref,
      playedAt: unique[0].playedAt,
      order: Math.min(...unique.map((s) => s.id)),
      sides: unique,
    });
  }

  /* Legacy games: consecutive complementary results involving the same pair.
     An odd leftover (the opponent's row was never written) is replayed as a
     standalone result against the player's own rating. */
  for (const [key, sides] of legacy) {
    sides.sort((a, b) => at(a) - at(b) || a.id - b.id);
    let i = 0;
    while (i < sides.length) {
      const a = sides[i];
      const b = sides[i + 1];
      const complementary = b
        && a.studentId !== b.studentId
        && ((a.score === 1 && b.score === 0) || (a.score === 0 && b.score === 1)
          || (a.score === 0.5 && b.score === 0.5));
      const pair = complementary ? [a, b] : [a];
      games.push({
        ref: `legacy:${key}:${a.id}`,
        playedAt: a.playedAt,
        order: Math.min(...pair.map((s) => s.id)),
        sides: pair,
      });
      i += pair.length;
    }
  }

  games.sort((a, b) => at(a) - at(b) || a.order - b.order);
  return { games, skipped, duplicates };
}

/**
 * Replay every pool from STARTING_RATING.
 *
 * All pools are walked together in chronological order, so each side is scored
 * against the opponent's rating in the SAME class as it stood before that game
 * — exactly what the live transaction does.
 */
function replayGames(games) {
  const states = new Map(); // `${studentId}:${timeClass}` → { rating, peak, gamesPlayed }
  const byRow = new Map(); // row id → change

  const stateFor = (studentId, timeClass) => {
    const key = `${studentId}:${timeClass}`;
    if (!states.has(key)) {
      states.set(key, { studentId, timeClass, rating: rating.STARTING_RATING, peak: rating.STARTING_RATING, gamesPlayed: 0 });
    }
    return states.get(key);
  };

  for (const game of games) {
    const pre = new Map();
    for (const side of game.sides) {
      pre.set(side.studentId, stateFor(side.studentId, side.timeClass).rating);
    }

    for (const side of game.sides) {
      const st = stateFor(side.studentId, side.timeClass);
      const other = game.sides.find((s) => s !== side);
      const opponentId = side.opponentId ?? other?.studentId ?? null;
      const opponentRating = opponentId != null
        ? (pre.get(opponentId) ?? st.rating)
        : st.rating;

      const { k } = rating.kFactorDetailed({ gamesPlayed: st.gamesPlayed, age: null, peakRating: st.peak });
      const expected = rating.expectedScore(st.rating, opponentRating);
      const next = rating.newRating(st.rating, k, expected, side.score);

      byRow.set(side.id, {
        timeClass: side.timeClass,
        ratingBefore: st.rating,
        ratingAfter: next,
        ratingChange: next - st.rating,
      });

      st.rating = next;
      st.peak = Math.max(st.peak, next);
      st.gamesPlayed += 1;
    }
  }

  return { byRow, states };
}

/** Convenience: rows → { byRow, states, games, skipped, duplicates }. */
function replayRows(rows) {
  const { games, skipped, duplicates } = buildGames(rows);
  const { byRow, states } = replayGames(games);
  return { games, skipped, duplicates, byRow, states };
}

module.exports = { buildGames, replayGames, replayRows, normaliseClass, scoreOf };
