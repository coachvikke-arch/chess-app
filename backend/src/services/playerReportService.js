/*
 * Player Report aggregation.
 *
 * New, additive service. It reads only data already stored by the existing
 * Chess.com/Lichess sync and the in-app game tables, and reuses the existing
 * analysis queue functions without modifying them.
 */

const db = require('../config/database');
const config = require('../config/playerReportConfig');
const math = require('./playerReportMath');
const cache = require('./playerReportCache');
const { resolveParticipants } = require('../utils/gameParticipants');
const { movesFromPgn } = require('./pgnUtils');
const { loadGame } = require('./analysis/gameLoader');
const { enqueueGame } = require('./analysis/analysisStore');

const ACC_MAX = 103.1668;
const ACC_DECAY = 0.04354;
const ACC_FLOOR = 3.1669;
const VERDICT_ACCURACY = {
  brilliant: 100, sigma: 100, great: 100, best: 100,
  excellent: 92, good: 85, book: 100,
  inaccuracy: 50, mistake: 25, miss: 10, blunder: 0,
};
const SKILL_ACTIONS = {
  opening: 'Review the first 10 moves of your last five losses and note the first tactical oversights.',
  tactics: 'Solve 15 tactic puzzles daily, focusing on forks, pins and sacrifices.',
  positional: 'Study pawn structures and bad-piece exercises after each reviewed game.',
  endgame: 'Practise rook and pawn endings and the 40th-move decision point.',
  timeManagement: 'Use a simple time budget: 90 seconds opening, 3 minutes middlegame, 2 minutes endgame.',
  consistency: 'Play fewer, longer sessions; review two games deeply instead of ten quickly.',
};

const toDateString = (d) => {
  const x = new Date(d);
  return Number.isNaN(x.getTime()) ? new Date().toISOString().slice(0, 10) : x.toISOString().slice(0, 10);
};

/* Computer games still appear in the report, but carry half weight in the
   skill scores and the FIDE readiness estimate. */
function weightedMean(rows, selector) {
  const pairs = (rows || []).map((row) => ({
    value: Number(selector(row)),
    weight: Number(row.weight),
  })).filter((p) => Number.isFinite(p.value) && Number.isFinite(p.weight) && p.weight > 0);
  if (!pairs.length) return 0;
  const total = pairs.reduce((sum, p) => sum + p.weight, 0);
  return pairs.reduce((sum, p) => sum + p.value * p.weight, 0) / total;
}

function windowDates() {
  const end = new Date();
  const start = new Date(end.getTime() - config.window.days * 24 * 60 * 60 * 1000);
  return { from: toDateString(start), to: toDateString(end) };
}

async function safeRows(sql, params = []) {
  try {
    const res = await db.query(sql, params);
    return res.rows || [];
  } catch (err) {
    if (/does not exist|undefined_table|undefined_column/i.test(err.message || '')) return [];
    throw err;
  }
}

const isoWeek = (date) => {
  const d = new Date(`${toDateString(date)}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const fday = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - fday + 3);
  const week = 1 + Math.round((d - firstThursday) / (7 * 24 * 60 * 60 * 1000));
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
};

function resultFrom(rawResult, myColor) {
  if (!rawResult) return null;
  const result = String(rawResult).trim().toLowerCase().replace(/[–—]/g, '-');
  if (['draw', 'drawn', '1/2-1/2', '½-½', '1/2', '0.5-0.5'].includes(result)) return 'draw';
  if (result === myColor || (result === '1-0' && myColor === 'white') || (result === '0-1' && myColor === 'black')) return 'win';
  if (['white', 'black', '1-0', '0-1'].includes(result)) return 'loss';
  return null;
}

function timeClassFromMinutes(minutes) {
  const m = Number(minutes) || 5;
  if (m >= 15) return 'classical';
  if (m >= 5) return 'rapid';
  return 'blitz';
}

function moveCountFromPgn(pgn) {
  const plies = movesFromPgn(pgn || '').length;
  return Math.floor(plies / 2);
}

function normaliseVerdict(verdict) {
  return verdict === 'sigma' ? 'brilliant' : (verdict || 'good');
}

function moveAccuracy(row) {
  const wpd = Number(row.wpd);
  if (Number.isFinite(wpd)) {
    return math.clamp(ACC_MAX * Math.exp(-ACC_DECAY * Math.max(0, wpd)) - ACC_FLOOR);
  }
  const key = normaliseVerdict(row.verdict);
  return VERDICT_ACCURACY[key] ?? 60;
}

function movePhase(row) {
  const moveNumber = Math.floor((Number(row.ply) || 0) / 2) + 1;
  const pieces = ((row.fen_before || '').split(' ')[0] || '').replace(/[^pnbrqkPNBRQK]/g, '').length;
  if (moveNumber <= config.phases.openingLastMove) return 'opening';
  if (moveNumber >= config.phases.endgameFirstMove || pieces <= config.phases.simpleEndingPieces) return 'endgame';
  return 'middlegame';
}

function themeForMove(row) {
  const verdict = normaliseVerdict(row.verdict);
  const moveNumber = Math.floor((Number(row.ply) || 0) / 2) + 1;
  const cpl = Number(row.cpl) || 0;
  if (verdict === 'miss') return 'missed tactic';
  if (cpl >= 600 && !row.sigma_type) return 'hanging piece';
  if (moveNumber >= config.phases.endgameFirstMove) return 'endgame error';
  if (cpl >= 400) return 'back rank';
  return 'time trouble';
}

/* ── candidate games ─────────────────────────────────────────────────────── */

async function loadExternalGames(userId, from, to) {
  const rows = await safeRows(
    `SELECT g.id, a.platform, g.game_date, g.white_name, g.black_name,
            g.white_rating, g.black_rating, g.result, g.my_color,
            g.time_control, g.time_class, g.opening, g.eco, g.pgn,
            g.moves_count, g.platform_game_id
       FROM chess_games g
       JOIN connected_chess_accounts a ON a.id = g.account_id
      WHERE a.user_id = $1 AND g.game_date::date BETWEEN $2::date AND $3::date`,
    [userId, from, to]
  );
  return rows.map((g) => {
    const myColor = g.my_color || 'white';
    const source = g.platform === 'lichess' ? 'lichess' : 'chesscom';
    return {
      key: `chess_profile:${g.id}`,
      gameSource: 'chess_profile',
      gameId: Number(g.id),
      source,
      date: g.game_date,
      myColor,
      /* Normalised to the OPPONENT's rating, not the owner's. */
      opponentRating: myColor === 'white' ? g.black_rating : g.white_rating,
      result: resultFrom(g.result, myColor),
      timeClass: g.time_class || 'rapid',
      opening: g.opening || g.eco || '',
      pgn: g.pgn || '',
      movesCount: Number(g.moves_count) || moveCountFromPgn(g.pgn),
      isComputer: false,
      resultReason: null,
      finished: true,
    };
  });
}

async function loadOnlineGames(userId, from, to) {
  const rows = await safeRows(
    `SELECT g.id, g.status, g.result, g.result_reason, g.admin_color,
            g.pgn, g.admin_id, g.student_id, g.is_bot, g.bot_color,
            g.created_at, g.updated_at
       FROM online_games g
      WHERE (g.admin_id = $1 OR g.student_id = $1)
        AND COALESCE(g.updated_at, g.created_at)::date BETWEEN $2::date AND $3::date`,
    [userId, from, to]
  );
  const opponentIds = [];
  const mapped = rows.map((g) => {
    const p = resolveParticipants(g, userId);
    const myColor = p.myColor || 'white';
    if (p.opponentId != null) opponentIds.push(Number(p.opponentId));
    const finished = g.status === 'finished' && g.result !== 'abandoned' && g.result !== 'aborted';
    return {
      key: `online:${g.id}`,
      gameSource: 'online',
      gameId: Number(g.id),
      source: 'matezone',
      date: toDateString(g.updated_at || g.created_at),
      myColor,
      opponentRating: null,
      opponentId: p.opponentId == null ? null : Number(p.opponentId),
      result: finished ? resultFrom(g.result, myColor) : null,
      timeClass: 'rapid',
      opening: '',
      pgn: g.pgn || '',
      movesCount: moveCountFromPgn(g.pgn),
      isComputer: Boolean(g.is_bot),
      resultReason: g.result_reason || null,
      finished,
    };
  });
  if (opponentIds.length) {
    const ratings = await safeRows(
      'SELECT user_id, current_rating FROM students WHERE user_id = ANY($1::int[])',
      [opponentIds]
    );
    const byUser = new Map(ratings.map((r) => [Number(r.user_id), Number(r.current_rating)]));
    mapped.forEach((g) => { g.opponentRating = byUser.get(g.opponentId) || null; });
  }
  return mapped;
}

async function loadComputerGames(userId, from, to) {
  const rows = await safeRows(
    `SELECT id, player_color, computer_level, pgn, status, result, result_reason,
            moves_count, time_base_minutes, created_at
       FROM computer_games
      WHERE student_user_id = $1 AND status = 'finished'
        AND created_at::date BETWEEN $2::date AND $3::date`,
    [userId, from, to]
  );
  return rows.map((g) => ({
    key: `computer:${g.id}`,
    gameSource: 'computer',
    gameId: Number(g.id),
    source: 'matezone',
    date: toDateString(g.created_at),
    myColor: g.player_color || 'white',
    opponentRating: null,
    result: resultFrom(g.result, g.player_color),
    timeClass: timeClassFromMinutes(g.time_base_minutes),
    opening: '',
    pgn: g.pgn || '',
    movesCount: Number(g.moves_count) || moveCountFromPgn(g.pgn),
    isComputer: true,
    resultReason: g.result_reason || null,
    finished: true,
  }));
}

async function loadTournamentGames(userId, from, to) {
  const rows = await safeRows(
    `SELECT tg.id, tg.white_player, tg.black_player, tg.pgn, tg.moves_count,
            tg.status, tg.result, tg.reason, tg.finished_at, tg.updated_at, tg.created_at,
            COALESCE((
              SELECT current_rating FROM students
               WHERE user_id = CASE WHEN tg.white_player = $1 THEN tg.black_player ELSE tg.white_player END
            ), 0)::int AS opponent_rating
       FROM tournament_games tg
      WHERE tg.status = 'finished' AND (tg.white_player = $1 OR tg.black_player = $1)
        AND COALESCE(tg.finished_at, tg.updated_at, tg.created_at)::date BETWEEN $2::date AND $3::date`,
    [userId, from, to]
  );
  return rows.map((g) => {
    const myColor = Number(g.white_player) === Number(userId) ? 'white' : 'black';
    return {
      key: `tournament:${g.id}`,
      gameSource: 'tournament',
      gameId: Number(g.id),
      source: 'matezone',
      date: toDateString(g.finished_at || g.updated_at || g.created_at),
      myColor,
      opponentRating: Number(g.opponent_rating) || null,
      result: resultFrom(g.result, myColor),
      timeClass: 'rapid',
      opening: '',
      pgn: g.pgn || '',
      movesCount: Number(g.moves_count) || moveCountFromPgn(g.pgn),
      isComputer: false,
      resultReason: g.reason || null,
      finished: true,
    };
  });
}

async function loadCandidates(userId, from, to, source) {
  const [external, online, computer, tournament, appRating] = await Promise.all([
    loadExternalGames(userId, from, to),
    loadOnlineGames(userId, from, to),
    loadComputerGames(userId, from, to),
    loadTournamentGames(userId, from, to),
    safeRows('SELECT current_rating FROM students WHERE user_id = $1', [userId]),
  ]);
  const hasAppRating = appRating[0]?.current_rating != null;
  const seen = new Set();
  const all = [...external, ...online, ...computer, ...tournament]
    .filter((g) => {
      if (source !== 'all' && g.source !== source) return false;
      /* Mate Zone rule: only finished games with at least 10 moves. */
      if (g.source === 'matezone' && (!g.finished || g.movesCount < config.window.minInAppMoves)) return false;
      if (seen.has(g.key)) return false;
      seen.add(g.key);
      return true;
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, config.window.maxGames)
    .map((g) => ({
      ...g,
      /* Games with no in-app rating still count everywhere EXCEPT the
         Elo-based FIDE estimate. */
      hasOwnRating: g.source !== 'matezone' || hasAppRating,
    }));

  return { all, pendingInApp: all.filter((g) => g.source === 'matezone') };
}

/* ── stored analysis ─────────────────────────────────────────────────────── */

async function loadAnalysis(userId, candidates) {
  if (!candidates.length) return { summaries: new Map(), moves: new Map() };
  const summaries = new Map();
  const moves = new Map();

  const summaryRows = await safeRows(
    `SELECT game_source, game_id, status, accuracy_white, accuracy_black,
            opening_name, eco_code, game_classification, analyzed_at, result
       FROM game_stockfish_analysis
      WHERE owner_user_id = $1 AND status = 'done'`,
    [userId]
  );
  const done = new Set();
  summaryRows.forEach((r) => {
    summaries.set(`${r.game_source}:${Number(r.game_id)}`, r);
    done.add(`${r.game_source}:${Number(r.game_id)}`);
  });

  const sources = [...new Set(candidates.map((g) => g.gameSource))];
  const ids = [...new Set(candidates.map((g) => String(g.gameId)))];
  const moveRows = await safeRows(
    `SELECT game_source, game_id, ply, player, verdict, move_san, move_uci,
            fen_before, eval_best, eval_played, cpl, wpd, sigma_type
       FROM move_stockfish_analysis
      WHERE game_source = ANY($1::text[]) AND game_id::text = ANY($2::text[])
      ORDER BY game_source, game_id, ply`,
    [sources, ids]
  );
  moveRows.forEach((r) => {
    const key = `${r.game_source}:${Number(r.game_id)}`;
    if (!moves.has(key)) moves.set(key, []);
    moves.get(key).push(r);
  });

  return { summaries, moves, done };
}

async function queueMissingAnalysis(candidates, done) {
  let queued = 0;
  const missing = candidates
    .filter((g) => g.source === 'matezone' && !done.has(`${g.gameSource}:${g.gameId}`))
    .slice(0, 25);
  const results = await Promise.allSettled(missing.map(async (g) => {
    const loaded = await loadGame(g.gameSource, g.gameId);
    if (!loaded.ok) return { queued: false };
    return enqueueGame({
      gameSource: g.gameSource,
      gameId: g.gameId,
      ownerUserId: loaded.game.ownerUserId,
      pgn: loaded.game.pgn,
      movesCount: loaded.game.movesCount,
    });
  }));
  results.forEach((r) => {
    if (r.status === 'fulfilled' && r.value?.queued) queued += 1;
  });
  return queued;
}

/* ── metric aggregation ─────────────────────────────────────────────────── */

function aggregateGame(candidate, summary, moveRows) {
  const myPlayer = candidate.myColor === 'black' ? 'b' : 'w';
  const rows = (moveRows || []).filter((r) => r.player === myPlayer);
  const counts = {};
  rows.forEach((r) => {
    const v = normaliseVerdict(r.verdict);
    counts[v] = (counts[v] || 0) + 1;
  });
  const accuracy = candidate.myColor === 'black'
    ? Number(summary.accuracy_black)
    : Number(summary.accuracy_white);

  const phaseBuckets = { opening: [], middlegame: [], endgame: [] };
  rows.forEach((r) => phaseBuckets[movePhase(r)].push(moveAccuracy(r)));
  /* In-app games have no opening column of their own; the stored analysis does. */
  const opening = candidate.opening || summary.opening_name || '';

  const blunders = counts.blunder || 0;
  const misses = counts.miss || 0;
  const goodMoves = (counts.brilliant || 0) + (counts.great || 0) + (counts.best || 0);
  const totalMoves = rows.length || 1;
  const earlyBlunders = rows.filter((r) => {
    const moveNumber = Math.floor((Number(r.ply) || 0) / 2) + 1;
    return normaliseVerdict(r.verdict) === 'blunder'
      && moveNumber <= config.timeManagement.quickBlunderMoveThreshold;
  }).length;

  return {
    candidate: { ...candidate, opening },
    summary,
    rows,
    counts,
    weight: candidate.isComputer ? config.weights.computer : config.weights.human,
    accuracy: Number.isFinite(accuracy) ? math.clamp(accuracy) : math.mean(rows.map(moveAccuracy)),
    score: candidate.result === 'win' ? 1 : candidate.result === 'draw' ? 0.5 : 0,
    blunders,
    misses,
    goodMoves,
    totalMoves,
    earlyBlunders,
    timeTrouble: candidate.resultReason === 'timeout' || earlyBlunders > 0,
    phase: Object.fromEntries(Object.entries(phaseBuckets).map(([k, v]) => [k, math.mean(v)])),
  };
}

function buildSkills(games, globalBlunderThemes) {
  if (!games.length) {
    return { values: Object.fromEntries(Object.keys(SKILL_ACTIONS).map((k) => [k, 0])), phase: {}, themes: [] };
  }
  const avgAccuracy = weightedMean(games, (g) => g.accuracy);

  const phase = {
    opening: weightedMean(games, (g) => g.phase.opening),
    middlegame: weightedMean(games, (g) => g.phase.middlegame),
    endgame: weightedMean(games, (g) => g.phase.endgame),
  };

  const missRate = weightedMean(games, (g) => (g.misses / g.totalMoves) * 100);
  const greatRate = weightedMean(games, (g) => (g.goodMoves / g.totalMoves) * 100);
  const blunderRate = weightedMean(games, (g) => (g.blunders / g.totalMoves) * 100);
  const tactics = math.clamp(
    100 - (missRate * config.skillMix.tactics.tacticalMiss)
      + (greatRate * config.skillMix.tactics.brilliantGreat)
      - (blunderRate * config.skillMix.tactics.blunderPenalty)
  );

  const opening = math.clamp(
    (Number.isFinite(phase.opening) ? phase.opening : avgAccuracy) * 0.7 + avgAccuracy * 0.3
  );
  const positionalErrors = weightedMean(
    games,
    (g) => ((g.counts.inaccuracy || 0) + (g.counts.mistake || 0)) / g.totalMoves * 100
  );
  const positional = math.clamp(avgAccuracy * 0.8 + (100 - positionalErrors) * 0.2);
  const endgame = math.clamp(
    (Number.isFinite(phase.endgame) ? phase.endgame : avgAccuracy) * config.skillMix.endgame.lateAccuracy
      + avgAccuracy * config.skillMix.endgame.simpleEndingAccuracy
  );
  const timeoutRate = weightedMean(games, (g) => (g.candidate.resultReason === 'timeout' ? 100 : 0));
  const fastBlunders = weightedMean(games, (g) => g.earlyBlunders);
  const timeManagement = math.clamp(
    (100 - timeoutRate) * config.skillMix.timeManagement.noTimeout
      + (100 - Math.min(100, fastBlunders * 20)) * config.skillMix.timeManagement.fastBlunderPenalty
  );

  /* A weighted standard deviation keeps half-weight computer games from
     swamping the consistency signal. */
  const accuracyVariance = weightedMean(games, (g) => (g.accuracy - avgAccuracy) ** 2);
  const accuracySd = Math.sqrt(Math.max(0, accuracyVariance));
  const avgScore = weightedMean(games, (g) => g.score * 100);
  const scoreVariance = weightedMean(games, (g) => (g.score * 100 - avgScore) ** 2);
  const scoreSd = Math.sqrt(Math.max(0, scoreVariance));
  const consistency = math.clamp(
    (100 - Math.min(100, accuracySd * 4)) * config.skillMix.consistency.accuracyStdDev
      + (100 - Math.min(100, scoreSd)) * config.skillMix.consistency.ratingSwing
  );

  const values = { opening, tactics, positional, endgame, timeManagement, consistency };
  Object.keys(values).forEach((k) => { values[k] = math.round(math.clamp(values[k])); });

  const themes = config.blunderThemes.map((theme) => ({
    theme,
    count: globalBlunderThemes[theme] || 0,
  })).filter((t) => t.count > 0);

  return { values, phase, themes };
}

function playerTypeFor(skills, games, themes) {
  const s = skills.values || skills;
  if (s.timeManagement < 50) return 'Blitz Gambler';
  if (s.opening >= 78 && s.opening >= s.tactics) return 'Opening Theorist';
  if (s.endgame >= 78 && s.endgame >= s.tactics) return 'Endgame Grinder';
  if (s.tactics >= 78) return 'Aggressive Tactician';
  if (s.positional >= 75) return 'Solid Positional Player';
  const hanging = (themes.find((t) => t.theme === 'hanging piece')?.count || 0);
  if (hanging > 0 && games.some((g) => g.candidate.result === 'loss')) return 'Defensive Counter-Puncher';
  return 'Solid Positional Player';
}

function strengthsAndWeaknesses(skills) {
  const entries = Object.entries(skills.values).sort((a, b) => b[1] - a[1]);
  const label = (k) => ({
    opening: 'Opening play', tactics: 'Tactical vision', positional: 'Positional play',
    endgame: 'Endgame technique', timeManagement: 'Time management', consistency: 'Consistency',
  }[k] || k);
  return {
    strengths: entries.filter(([, v]) => v >= 55).slice(0, 3).map(([k, v]) => ({ label: label(k), evidence: `${v}/100` })),
    weaknesses: [...entries].reverse().filter(([, v]) => v < 75).slice(0, 3).map(([k, v]) => ({ label: label(k), evidence: `${v}/100` })),
  };
}

function openingsReport(games) {
  const byOpening = new Map();
  games.forEach((g) => {
    /* Computer games never count towards opening win rate against humans. */
    if (g.candidate.isComputer || !g.candidate.opening) return;
    const name = g.candidate.opening;
    if (!byOpening.has(name)) byOpening.set(name, { name, score: 0, games: 0 });
    const o = byOpening.get(name);
    o.score += g.score * 100;
    o.games += 1;
  });
  const all = [...byOpening.values()]
    .map((o) => ({ ...o, score: math.round(o.score / o.games) }))
    .sort((a, b) => b.score - a.score);
  return { best: all.slice(0, 3), worst: all.slice(-3).reverse() };
}

function sourceComparison(games) {
  return ['chesscom', 'lichess', 'matezone'].map((source) => {
    const rows = games.filter((g) => g.candidate.source === source);
    return {
      source,
      games: rows.length,
      accuracy: math.round(math.mean(rows.map((g) => g.accuracy))),
      winRate: math.round(math.mean(rows.map((g) => g.score * 100))),
      blundersPerGame: math.round(math.mean(rows.map((g) => g.blunders)), 2),
    };
  });
}

function weeklyTrend(games) {
  const buckets = new Map();
  games.forEach((g) => {
    const week = isoWeek(g.candidate.date);
    if (!buckets.has(week)) buckets.set(week, { week, chesscom: [], lichess: [], matezone: [] });
    buckets.get(week)[g.candidate.source].push(g.accuracy);
  });
  return [...buckets.values()]
    .sort((a, b) => a.week.localeCompare(b.week))
    .map((b) => ({
      week: b.week.slice(5).replace('-', '/'),
      chesscom: b.chesscom.length ? math.round(math.mean(b.chesscom)) : null,
      lichess: b.lichess.length ? math.round(math.mean(b.lichess)) : null,
      matezone: b.matezone.length ? math.round(math.mean(b.matezone)) : null,
    }));
}

function improvementPlan(skills) {
  const priorities = Object.entries(skills.values)
    .sort((a, b) => a[1] - b[1])
    .slice(0, 3)
    .map(([skill, score]) => ({ skill, score, action: SKILL_ACTIONS[skill] }));
  const weeks = [1, 2, 3, 4].map((week) => {
    const p = priorities[(week - 1) % Math.max(1, priorities.length)];
    return {
      week,
      focus: p ? p.skill : 'review',
      tasks: p ? p.action : 'Review two lost games and write one lesson from each.',
    };
  });
  return { priorities, weeks };
}

/* ── ratings & FIDE estimate ─────────────────────────────────────────────── */

async function loadRatings(userId) {
  const names = await safeRows('SELECT name FROM users WHERE id = $1', [userId]);
  const rows = await safeRows(
    `SELECT a.platform, r.category, r.rating
       FROM chess_ratings r
       JOIN connected_chess_accounts a ON a.id = r.account_id
      WHERE a.user_id = $1 AND r.category IN ('rapid', 'classical', 'blitz')`,
    [userId]
  );
  const app = await safeRows(
    `SELECT s.current_rating
       FROM students s WHERE s.user_id = $1`,
    [userId]
  );
  const time = await safeRows(
    `SELECT time_class, rating FROM student_time_ratings
      WHERE student_id = (SELECT id FROM students WHERE user_id = $1)`,
    [userId]
  );
  const header = rows.map((r) => ({
    source: r.platform === 'lichess' ? 'lichess' : 'chesscom',
    label: `${String(r.category).replace(/^./, (c) => c.toUpperCase())}`,
    value: Number(r.rating),
  }));
  if (app[0]?.current_rating != null) {
    header.push({ source: 'matezone', label: 'Mate Zone', value: Number(app[0].current_rating) });
  }

  const estimates = [];
  rows.forEach((r) => {
    const platform = r.platform === 'lichess' ? 'lichess' : 'chesscom';
    const offset = config.ratingOffsets[platform]?.[r.category];
    if (Number.isFinite(offset)) estimates.push(Number(r.rating) + offset);
  });
  time.forEach((r) => {
    const offset = config.ratingOffsets.matezone?.[r.time_class] ?? 0;
    estimates.push(Number(r.rating) + offset);
  });
  if (app[0]?.current_rating != null) estimates.push(Number(app[0].current_rating));

  return {
    header: { name: names[0]?.name || null, ratings: header },
    estimates,
    hasInAppRating: estimates.length > 0,
  };
}

function fideReadiness(games, ratings, fieldRating) {
  const field = Number.isFinite(Number(fieldRating)) ? Number(fieldRating) : config.fide.defaultFieldRating;

  /* Games without an in-app rating still count towards accuracy, skills,
     themes and openings, but they must not move an Elo-based estimate. */
  const eloGames = ratings.estimates.length > 0
    ? games.filter((g) => g.candidate.hasOwnRating !== false)
    : games;
  const excludedFromElo = games.length - eloGames.length;
  const avgAccuracy = weightedMean(eloGames, (g) => g.accuracy);
  const sorted = [...eloGames].sort((a, b) => new Date(a.candidate.date) - new Date(b.candidate.date));
  const half = Math.max(1, Math.floor(sorted.length / 2));
  const early = weightedMean(sorted.slice(0, half), (g) => g.accuracy);
  const late = weightedMean(sorted.slice(-half), (g) => g.accuracy);
  const trendDelta = late - early;
  const trendAdjustment = math.clamp(
    trendDelta * config.fide.trendPointsPerAccuracyPoint,
    -config.fide.maxTrendAdjustment,
    config.fide.maxTrendAdjustment
  );
  const accuracyMean = weightedMean(eloGames, (g) => g.accuracy);
  const accuracyVariance = weightedMean(eloGames, (g) => (g.accuracy - accuracyMean) ** 2);
  const consistencyPenalty = Math.min(
    config.fide.consistencyPenaltyMax,
    (Math.sqrt(Math.max(0, accuracyVariance)) / config.fide.consistencyStdDevFullPenalty)
      * config.fide.consistencyPenaltyMax
  );

  const hasRating = ratings.estimates.length > 0;
  const base = hasRating ? math.mean(ratings.estimates) : 1400;
  const estimate = Math.round(base + trendAdjustment - consistencyPenalty);
  const readiness = math.clamp(
    50 + (estimate - field) / 10 + (avgAccuracy - 70) * 0.4 + trendDelta * 0.2
  );

  const chances = math.simulateTournaments({
    rating: estimate,
    fieldRating: field,
    tournamentCount: config.fide.tournamentCount,
    rounds: config.fide.rounds,
    fieldSize: config.fide.fieldSize,
    topTenPlaces: config.fide.topTenPlaces,
  });

  return {
    readiness: math.round(readiness),
    range: [estimate - 40, estimate + 40],
    expectedScore: math.round(config.fide.rounds * math.eloExpected(estimate, field), 2),
    chances: {
      positiveScore: chances.positiveScore,
      topTen: chances.topTen,
      winTournament: chances.winTournament,
      ratingGain: chances.ratingGain,
    },
    note: hasRating
      ? `Estimates, not guarantees. Simulated from ${config.fide.tournamentCount.toLocaleString()} tournaments against an average field rating of ${field}.`
      : 'No stored rating was available for these sources; this accuracy-based estimate is rough and is not a guarantee.',
    excludedFromElo,
  };
}

async function fingerprint(userId) {
  /* Each signal is queried separately so an optional table missing on an older
     installation cannot invalidate the whole fingerprint. */
  const [sync, analysis, online, computer, tournament] = await Promise.all([
    safeRows(
      'SELECT MAX(last_synced_at)::text AS value FROM connected_chess_accounts WHERE user_id = $1',
      [userId]
    ),
    safeRows(
      `SELECT MAX(analyzed_at)::text AS value,
              COUNT(*) FILTER (WHERE status = 'done')::text AS done_count
         FROM game_stockfish_analysis WHERE owner_user_id = $1`,
      [userId]
    ),
    safeRows(
      'SELECT MAX(updated_at)::text AS value FROM online_games WHERE admin_id = $1 OR student_id = $1',
      [userId]
    ),
    safeRows(
      'SELECT MAX(updated_at)::text AS value FROM computer_games WHERE student_user_id = $1',
      [userId]
    ),
    safeRows(
      'SELECT MAX(updated_at)::text AS value FROM tournament_games WHERE white_player = $1 OR black_player = $1',
      [userId]
    ),
  ]);
  return JSON.stringify({
    sync: sync[0]?.value || null,
    analysis: analysis[0]?.value || null,
    done: analysis[0]?.done_count || '0',
    online: online[0]?.value || null,
    computer: computer[0]?.value || null,
    tournament: tournament[0]?.value || null,
  });
}

/* ── report builder ──────────────────────────────────────────────────────── */

async function buildReport(userId, source, fieldRating) {
  const { from, to } = windowDates();
  const { all, pendingInApp } = await loadCandidates(userId, from, to, source);
  const analysis = await loadAnalysis(userId, all);
  const doneKeys = analysis.done || new Set();
  await queueMissingAnalysis(pendingInApp, doneKeys);
  /* Count every in-app game already waiting in the queue, not just the ones
     this request happened to enqueue — the finish hooks may have queued some. */
  const queuedInAppGames = pendingInApp
    .filter((g) => !doneKeys.has(`${g.gameSource}:${g.gameId}`)).length;

  const analysed = all
    .filter((g) => analysis.summaries.has(`${g.gameSource}:${g.gameId}`))
    .map((g) => aggregateGame(
      g,
      analysis.summaries.get(`${g.gameSource}:${g.gameId}`),
      analysis.moves.get(`${g.gameSource}:${g.gameId}`) || []
    ))
    .filter((g) => Number.isFinite(g.accuracy));

  const globalThemes = {};
  analysed.forEach((g) => {
    g.rows.forEach((r) => {
      if (['blunder', 'miss'].includes(normaliseVerdict(r.verdict))) {
        const theme = themeForMove(r);
        globalThemes[theme] = (globalThemes[theme] || 0) + 1;
      }
    });
  });

  const skills = buildSkills(analysed, globalThemes);
  const ratings = await loadRatings(userId);
  const computerGames = analysed.filter((g) => g.candidate.isComputer);
  const humanGames = analysed.filter((g) => !g.candidate.isComputer);
  const scores = humanGames.map((g) => g.score * 100);
  const split = { chesscom: 0, lichess: 0, matezone: 0, total: analysed.length };
  analysed.forEach((g) => { split[g.candidate.source] += 1; });

  return {
    studentId: userId,
    source,
    generatedAt: new Date().toISOString(),
    window: { from, to, days: config.window.days, maxGames: config.window.maxGames },
    header: ratings.header,
    playerType: playerTypeFor(skills, analysed, skills.themes),
    gamesAnalysed: analysed.length,
    needsMoreGames: analysed.length < config.window.minGamesForAccurateReport,
    minGames: config.window.minGamesForAccurateReport,
    queuedInAppGames,
    overview: {
      avgAccuracy: math.round(math.mean(analysed.map((g) => g.accuracy))),
      winRate: math.round(math.mean(scores)),
      blundersPerGame: math.round(math.mean(analysed.map((g) => g.blunders)), 2),
      timeTroublePct: math.round(analysed.length ? (analysed.filter((g) => g.timeTrouble).length / analysed.length) * 100 : 0),
      gamesAnalysed: split,
    },
    skills: skills.values,
    strengths: [],
    weaknesses: [],
    phaseAccuracy: {
      opening: math.round(skills.phase.opening || 0),
      middlegame: math.round(skills.phase.middlegame || 0),
      endgame: math.round(skills.phase.endgame || 0),
    },
    blunderThemes: skills.themes,
    openingsReport: openingsReport(analysed),
    sourceComparison: sourceComparison(analysed),
    computerBreakdown: {
      games: computerGames.length,
      accuracy: math.round(math.mean(computerGames.map((g) => g.accuracy))),
      winRate: math.round(math.mean(computerGames.map((g) => g.score * 100))),
      weight: config.weights.computer,
    },
    trend: weeklyTrend(analysed),
    improvementPlan: improvementPlan(skills),
    fideReadiness: fideReadiness(analysed, ratings, fieldRating),
  };
}

async function getReport(userId, source = 'all', fieldRating) {
  const key = `${userId}|${source}`;
  const fp = await fingerprint(userId);
  const report = await cache.getOrCompute(key, fp, () => buildReport(userId, source, fieldRating));
  const { strengths, weaknesses } = strengthsAndWeaknesses({ values: report.skills });
  return { ...report, strengths, weaknesses };
}

/* ── per-game coach feedback ─────────────────────────────────────────────── */

function gameSourceFromHint(hint) {
  const h = String(hint || '').toLowerCase();
  if (h === 'chess.com' || h === 'chesscom' || h === 'lichess') return 'chess_profile';
  if (['online', 'computer', 'tournament'].includes(h)) return h;
  return null;
}

function coachTextFor(row, theme, moveNumber) {
  const verdict = normaliseVerdict(row.verdict);
  if (verdict === 'brilliant' || verdict === 'great' || verdict === 'best') {
    return `Move ${moveNumber} (${row.move_san || '—'}) was a strong choice. Keep finding this kind of move in your training games.`;
  }
  const cpl = Math.round(Number(row.cpl) || 0);
  if (verdict === 'miss') {
    return `Move ${moveNumber} missed a clear tactic (${theme}). The engine's best move was ${row.best_uci || 'not recorded'}; pause on forcing moves before committing.`;
  }
  return `Move ${moveNumber} (${row.move_san || '—'}) was a ${verdict}. The ${theme} theme cost about ${cpl} centipawns — compare it with the engine line before your next game.`;
}

/* Resolve the viewer's side from the game row itself. This also verifies that
   the game really belongs to the requested student, so the endpoint cannot be
   used to read somebody else's feedback by guessing an id. */
async function myPlayerForGame(userId, gameSource, gameId) {
  const id = Number(gameId);
  if (gameSource === 'chess_profile') {
    const rows = await safeRows(
      `SELECT g.my_color
         FROM chess_games g
         JOIN connected_chess_accounts a ON a.id = g.account_id
        WHERE g.id = $1 AND a.user_id = $2`,
      [id, userId]
    );
    if (!rows.length) return null;
    return rows[0].my_color === 'black' ? 'b' : 'w';
  }
  if (gameSource === 'online') {
    const rows = await safeRows(
      'SELECT id, admin_id, student_id, admin_color FROM online_games WHERE id = $1',
      [id]
    );
    if (!rows.length) return null;
    const p = resolveParticipants(rows[0], userId);
    if (!p.isParticipant) return null;
    return p.myColor === 'black' ? 'b' : 'w';
  }
  if (gameSource === 'computer') {
    const rows = await safeRows(
      'SELECT player_color FROM computer_games WHERE id = $1 AND student_user_id = $2',
      [id, userId]
    );
    if (!rows.length) return null;
    return rows[0].player_color === 'black' ? 'b' : 'w';
  }
  if (gameSource === 'tournament') {
    const rows = await safeRows(
      `SELECT white_player, black_player FROM tournament_games
        WHERE id = $1 AND (white_player = $2 OR black_player = $2)`,
      [id, userId]
    );
    if (!rows.length) return null;
    return Number(rows[0].white_player) === Number(userId) ? 'w' : 'b';
  }
  return null;
}

function evalSwingFor(row) {
  const best = Number(row.eval_best);
  const played = Number(row.eval_played);
  if (Number.isFinite(best) && Number.isFinite(played)) return Math.round(Math.abs(best - played));
  return Math.round(Number(row.cpl) || 0);
}

async function getGameFeedback(userId, gameId, hint) {
  const requested = gameSourceFromHint(hint);
  const sources = requested ? [requested] : ['chess_profile', 'online', 'computer', 'tournament'];
  const rows = await safeRows(
    `SELECT game_source, game_id, status, accuracy_white, accuracy_black,
            opening_name, game_classification, result, analyzed_at
       FROM game_stockfish_analysis
      WHERE owner_user_id = $1 AND game_id::text = $2 AND game_source = ANY($3::text[])
      ORDER BY CASE status WHEN 'done' THEN 0 ELSE 1 END, analyzed_at DESC NULLS LAST`,
    [userId, String(gameId), sources]
  );

  let summary = null;
  let player = null;
  for (const row of rows) {
    const side = await myPlayerForGame(userId, row.game_source, gameId);
    if (side) {
      summary = row;
      player = side;
      break;
    }
  }
  if (!summary) return null;

  const gameSource = summary.game_source;
  const phaseBuckets = { opening: [], middlegame: [], endgame: [] };
  let critical = [];

  if (summary.status === 'done') {
    const allMoves = await safeRows(
      `SELECT ply, player, verdict, move_san, cpl, wpd, eval_best, eval_played,
              fen_before, best_uci, sigma_type
         FROM move_stockfish_analysis
        WHERE game_source = $1 AND game_id::text = $2
        ORDER BY ply`,
      [gameSource, String(gameId)]
    );
    const mine = allMoves.filter((r) => r.player === player);
    mine.forEach((r) => phaseBuckets[movePhase(r)].push(moveAccuracy(r)));

    critical = mine
      .filter((r) => ['blunder', 'miss', 'mistake', 'brilliant', 'great'].includes(normaliseVerdict(r.verdict)))
      .sort((a, b) => evalSwingFor(b) - evalSwingFor(a))
      .slice(0, 6)
      .map((r) => {
        const moveNumber = Math.floor((Number(r.ply) || 0) / 2) + 1;
        const theme = themeForMove(r);
        return {
          /* DB plies are 0-based; +1 is the move count the viewer needs. */
          ply: Number(r.ply) + 1,
          moveNumber,
          move: r.move_san || '',
          type: normaliseVerdict(r.verdict),
          evalSwing: evalSwingFor(r),
          theme,
          coachText: coachTextFor(r, theme, moveNumber),
        };
      });
  }

  const strongest = Object.entries(phaseBuckets)
    .map(([k, v]) => [k, math.mean(v)])
    .filter(([, v]) => Number.isFinite(v))
    .sort((a, b) => b[1] - a[1])[0];
  const weakest = Object.entries(phaseBuckets)
    .map(([k, v]) => [k, math.mean(v)])
    .filter(([, v]) => Number.isFinite(v))
    .sort((a, b) => a[1] - b[1])[0];
  const accuracy = player === 'b' ? Number(summary.accuracy_black) : Number(summary.accuracy_white);

  let coachSummary;
  if (summary.status !== 'done') {
    coachSummary = `Stored analysis is ${summary.status}. The coach feedback will be ready once the engine finishes this game.`;
  } else {
    coachSummary = `Estimated accuracy ${Number.isFinite(accuracy) ? math.round(accuracy) : '—'}%. `
      + (strongest ? `Your best phase was ${strongest[0]}. ` : '')
      + (weakest ? `Focus next on ${weakest[0]} decisions. ` : '')
      + 'Review the listed moments with the engine before your next game.';
  }

  return {
    gameId: Number(gameId),
    gameSource,
    status: summary.status,
    opening: summary.opening_name || null,
    coachSummary,
    phaseAccuracy: {
      opening: math.round(math.mean(phaseBuckets.opening) || 0),
      middlegame: math.round(math.mean(phaseBuckets.middlegame) || 0),
      endgame: math.round(math.mean(phaseBuckets.endgame) || 0),
    },
    criticalMoments: critical,
  };
}

module.exports = {
  getReport,
  getGameFeedback,
  invalidate: cache.invalidate,
  windowDates,
  __testing: { buildReport, loadCandidates, aggregateGame },
};
