/*
 * Statistics computed exclusively from the user's imported game data
 * (chess_games). No invented numbers — everything below is derived from the
 * stored games, per platform or combined.
 */

const db = require('../config/database');
const { resolveOpeningName } = require('./pgnUtils');

async function gamesForUser(userId, platform = null) {
  const params = [userId];
  let sql = `SELECT g.*, a.platform, a.username AS account_username
             FROM chess_games g
             JOIN connected_chess_accounts a ON a.id = g.account_id
             WHERE a.user_id = $1`;
  if (platform) { params.push(platform); sql += ` AND a.platform = $${params.length}`; }
  sql += ' ORDER BY g.game_date ASC, g.id ASC';
  const res = await db.query(sql, params);
  return res.rows;
}

function userSide(game) {
  const me = String(game.account_username || '').toLowerCase();
  if (!me) return null;
  if (String(game.white_name || '').toLowerCase().indexOf(me) >= 0) return 'white';
  if (String(game.black_name || '').toLowerCase().indexOf(me) >= 0) return 'black';
  return null;
}

function classify(game) {
  const side = userSide(game);
  const userWon =
    side === 'white' ? game.result === 'white'
    : side === 'black' ? game.result === 'black'
    : null;
  return { side, userWon };
}

function pct(part, whole) {
  if (!whole) return 0;
  return Math.round((part / whole) * 100);
}

/* game_date is a DATE column — node-postgres returns it as a JS Date object.
   Normalise to a plain Date (and a YYYY-MM key) safely for either shape. */
function asDate(v) {
  if (!v) return null;
  return v instanceof Date ? v : new Date(String(v).slice(0, 10) + 'T00:00:00');
}
function monthKey(v) {
  if (!v) return null;
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}`;
  }
  return String(v).slice(0, 7);
}

/* longest win/loss streak + current streak */
function streaksRun(games) {
  let longestWin = 0, curWin = 0, longestLoss = 0, curLoss = 0;
  for (const g of games) {
    const { userWon } = classify(g);
    if (userWon === true) { curWin++; curLoss = 0; longestWin = Math.max(longestWin, curWin); }
    else if (userWon === false) { curLoss++; curWin = 0; longestLoss = Math.max(longestLoss, curLoss); }
    else { curWin = 0; curLoss = 0; }
  }
  return {
    longestWin, longestLoss, currentWin: curWin, currentLoss: curLoss,
    current: curWin > 0 ? `+${curWin}` : curLoss > 0 ? `-${curLoss}` : '–',
  };
}

async function buildStatistics(userId, platform = null) {
  const games = await gamesForUser(userId, platform);

  let wins = 0, losses = 0, draws = 0, unknown = 0;
  let movesSum = 0, movesN = 0, opponentRatingSum = 0, opponentRatingN = 0;
  const byTimeClass = {};
  const byColor = { white: { games: 0, wins: 0 }, black: { games: 0, wins: 0 } };
  const openingMap = new Map();

  for (const g of games) {
    const { side, userWon } = classify(g);
    if (userWon === true) wins++;
    else if (userWon === false) losses++;
    else if (g.result) draws++;
    else unknown++;

    movesSum += g.moves_count || 0;
    movesN++;

    const oppRating = side === 'white' ? g.black_rating : g.white_rating;
    if (oppRating) { opponentRatingSum += oppRating; opponentRatingN++; }

    const tc = g.time_class || 'other';
    byTimeClass[tc] = byTimeClass[tc] || { games: 0, wins: 0, losses: 0 };
    byTimeClass[tc].games++;
    if (userWon === true) byTimeClass[tc].wins++;
    else if (userWon === false) byTimeClass[tc].losses++;

    if (side) {
      byColor[side].games++;
      if (userWon === true) byColor[side].wins++;
    }

    const name = resolveOpeningName(g.opening || '', g.eco || '') || '(Unknown)';
    const key = `${(g.eco || '').trim()} ${name}`.trim().slice(0, 240);
    if (!openingMap.has(key)) {
      openingMap.set(key, { name, eco: g.eco || '', games: 0, wins: 0, losses: 0, draws: 0, oppSum: 0, oppN: 0 });
    }
    const row = openingMap.get(key);
    row.games++;
    if (userWon === true) row.wins++;
    else if (userWon === false) row.losses++;
    else if (g.result === 'draw') row.draws++;
    if (oppRating) { row.oppSum += oppRating; row.oppN++; }
  }

  const total = games.length;
  const byTimeClassRows = Object.entries(byTimeClass)
    .map(([key, v]) => ({ timeClass: key, ...v, winRate: pct(v.wins, v.games) }))
    .sort((a, b) => b.games - a.games);

  // games per month (last 12 calendar months, ascending)
  const now = new Date();
  const perMonth = [];
  const monthIndex = {};
  for (let k = 11; k >= 0; k--) {
    const d = new Date(now.getFullYear(), now.getMonth() - k, 1);
    const label = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const idx = perMonth.length;
    perMonth.push({ label, count: 0 });
    monthIndex[label] = idx;
  }
  for (const g of games) {
    const label = monthKey(g.game_date);
    if (!label) continue;
    if (label in monthIndex) perMonth[monthIndex[label]].count++;
  }

  // activity: last 30 days vs previous 30 days
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30);
  const cutoff2 = new Date(); cutoff2.setDate(cutoff2.getDate() - 60);
  let last30 = 0, prev30 = 0;
  for (const g of games) {
    const d = asDate(g.game_date);
    if (!d) continue;
    if (d >= cutoff) last30++;
    else if (d >= cutoff2) prev30++;
  }

  return {
    platform: platform || 'all',
    totalGames: total,
    wins, losses, draws,
    winRate: pct(wins, total),
    lossRate: pct(losses, total),
    drawRate: pct(draws, total),
    avgMoves: movesN ? Math.round((movesSum / movesN) * 10) / 10 : 0,
    avgOpponentRating: opponentRatingN ? Math.round(opponentRatingSum / opponentRatingN) : null,
    byTimeClass: byTimeClassRows,
    byColor: {
      white: { games: byColor.white.games, wins: byColor.white.wins, winRate: pct(byColor.white.wins, byColor.white.games) },
      black: { games: byColor.black.games, wins: byColor.black.wins, winRate: pct(byColor.black.wins, byColor.black.games) },
    },
    streaks: streaksRun(games),
    gamesPerMonth: perMonth,
    activity: { last30, prev30 },
  };
}

module.exports = { buildStatistics, gamesForUser };