/*
 * Opening analysis — computed from the imported chess_games, grouped by
 * opening name (with ECO where available).
 */

const db = require('../config/database');
const { gamesForUser } = require('./statisticsService');
const { resolveOpeningName } = require('./pgnUtils');

function pct(part, whole) {
  if (!whole) return 0;
  return Math.round((part / whole) * 100);
}

/** color side ('white'|'black') the account owner played in a game */
function userSide(game, accountUsername) {
  const me = String(accountUsername || '').toLowerCase();
  if (!me) return null;
  if (String(game.white_name || '').toLowerCase().indexOf(me) >= 0) return 'white';
  if (String(game.black_name || '').toLowerCase().indexOf(me) >= 0) return 'black';
  return null;
}

function userWonFor(game, side) {
  if (!side) return null;
  return side === 'white' ? game.result === 'white' : game.result === 'black';
}

async function buildOpenings(userId, platform = null) {
  const games = await gamesForUser(userId, platform);

  const map = new Map();
  const sideBuckets = { white: new Map(), black: new Map() };

  const bump = (bucket, key, game, side) => {
    if (!bucket.has(key)) bucket.set(key, { eco: game.eco || '', games: 0, wins: 0, losses: 0, draws: 0, oppSum: 0, oppN: 0 });
    const row = bucket.get(key);
    row.games++;
    const won = userWonFor(game, side);
    if (won === true) row.wins++;
    else if (won === false) row.losses++;
    else row.draws++;
    const opp = side === 'white' ? game.black_rating : game.white_rating;
    if (opp) { row.oppSum += opp; row.oppN++; }
  };

  for (const g of games) {
    const name = resolveOpeningName(g.opening || '', g.eco || '') || '(Unknown)';
    const key = `${(g.eco || '').trim()}|${name}`.slice(0, 240);
    const side = userSide(g, g.account_username);
    bump(map, key, g, side);
    if (side) bump(sideBuckets[side], key, g, side);
  }

  const shape = (buckets) => [...buckets.entries()]
    .map(([key, row]) => ({
      eco: row.eco,
      name: key.split('|')[1] || 'Unknown',
      ...row,
      winRate: pct(row.wins, row.games),
      avgOpponentRating: row.oppN ? Math.round(row.oppSum / row.oppN) : null,
    }))
    .sort((a, b) => b.games - a.games);

  const all = shape(map);
  const withGames = all.filter((o) => o.games >= 3);

  return {
    platform: platform || 'all',
    mostPlayed: all.slice(0, 12),
    best: withGames.slice().sort((a, b) => b.winRate - a.winRate).slice(0, 8),
    worst: withGames.slice().sort((a, b) => a.winRate - b.winRate).slice(0, 8),
    bySide: {
      white: shape(sideBuckets.white).slice(0, 12),
      black: shape(sideBuckets.black).slice(0, 12),
    },
  };
}

module.exports = { buildOpenings };