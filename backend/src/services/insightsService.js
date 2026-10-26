/*
 * Performance insights — rule-based observations generated ONLY from the
 * data actually imported (games + statistics + ratings). No invented stats.
 */

const { buildStatistics, gamesForUser } = require('./statisticsService');
const { buildOpenings } = require('./openingService');
const db = require('../config/database');

async function buildInsights(userId) {
  const insights = [];
  const push = (tone, text) => insights.push({ tone, text });

  const total = await countGames(userId);
  if (total === 0) return { insights: [], hasData: false };

  const combined = await buildStatistics(userId, null);
  const openings = await buildOpenings(userId, null);

  if (total < 3) {
    return { insights: [{ tone: 'info', text: 'Connect more games to unlock insights — we need at least a few imported games.' }], hasData: true };
  }

  /* 1 · time-control comparison (blitz vs rapid vs bullet) */
  const tc = {}
  combined.byTimeClass.forEach((c) => { tc[c.timeClass] = c; });

  if (tc.blitz && tc.rapid && tc.blitz.games >= 10 && tc.rapid.games >= 10) {
    if (tc.rapid.winRate > tc.blitz.winRate + 8) {
      push('good', `You perform better in rapid (${tc.rapid.winRate}% wins) than in blitz (${tc.blitz.winRate}%).`);
    } else if (tc.blitz.winRate > tc.rapid.winRate + 8) {
      push('good', `You perform better in blitz (${tc.blitz.winRate}% wins) than in rapid (${tc.rapid.winRate}%).`);
    } else {
      push('info', `Your win rate is steady across blitz (${tc.blitz.winRate}%) and rapid (${tc.rapid.winRate}%).`);
    }
  }

  /* 2 · colour strength */
  const w = combined.byColor.white, b = combined.byColor.black;
  if (w.games >= 10 && b.games >= 10) {
    const diff = w.winRate - b.winRate;
    if (diff >= 10) push('good', `You are noticeably stronger with White (${w.winRate}% wins) than Black (${b.winRate}%).`);
    else if (diff <= -10) push('good', `You are noticeably stronger with Black (${b.winRate}% wins) than White (${w.winRate}%).`);
    else push('info', `Balanced play with both colours (White ${w.winRate}% / Black ${b.winRate}% win rate).`);
  }

  /* 3 · late-game vs early-game losses (move 30+ cutoff) */
  const games = await gamesForUser(userId, null);
  let lateWins = 0, lateLosses = 0, earlyWins = 0, earlyLosses = 0;
  for (const g of games) {
    const side = userSideObj(g);
    const won = side === 'white' ? g.result === 'white' : side === 'black' ? g.result === 'black' : null;
    if (won == null) continue;
    const late = (g.moves_count || 0) > 30;
    if (late) { if (won) lateWins++; else lateLosses++; }
    else { if (won) earlyWins++; else earlyLosses++; }
  }
  const lateTotal = lateWins + lateLosses;
  const earlyTotal = earlyWins + earlyLosses;
  const lateLossPct = lateTotal ? Math.round((lateLosses / lateTotal) * 100) : 0;
  const earlyLossPct = earlyTotal ? Math.round((earlyLosses / earlyTotal) * 100) : 0;
  if (lateTotal >= 10 && earlyTotal >= 10 && lateLossPct > earlyLossPct + 10) {
    push('warn', `You lose more games after move 30 (${lateLossPct}% of long games) than in short games (${earlyLossPct}%). Endgames deserve attention.`);
  }

  /* 4 · best / worst openings */
  const best = openings.best && openings.best[0];
  if (best && best.games >= 5 && best.winRate >= 50) {
    push('good', `Your most successful opening is ${best.name || 'an unnamed opening'} (${best.winRate}% win rate over ${best.games} games).`);
  }
  const worst = openings.worst && openings.worst[0];
  if (worst && worst.games >= 5 && worst.winRate <= 30) {
    push('warn', `Your weakest opening is ${worst.name || 'an unnamed opening'} (${worst.winRate}% win rate over ${worst.games} games). A quick review could pay off.`);
  }

  /* 5 · rating trend in the most played category */
  try {
    const ratingTrend = await ratingTrendFor(userId);
    if (ratingTrend) push(ratingTrend.tone, ratingTrend.text);
  } catch { /* non-fatal */ }

  /* 6 · activity trend */
  const a = combined.activity;
  if (a.last30 + a.prev30 >= 20 && a.last30 > a.prev30 * 1.5) {
    push('good', `You've played significantly more this month (${a.last30} games in the last 30 days vs ${a.prev30} in the previous 30).`);
  } else if (a.prev30 > a.last30 * 1.5 && a.last30 + a.prev30 >= 10) {
    push('warn', `Game activity has dropped (${a.last30} games in the last 30 days vs ${a.prev30} before). A couple of games a week keeps ratings fresh.`);
  }

  if (insights.length === 0) {
    push('info', 'Not enough variation in your data yet — play a few more games and insights will sharpen.');
  }

  return { insights, hasData: true };
}

function userSideObj(game) {
  const me = String(game.account_username || '').toLowerCase();
  if (me && String(game.white_name || '').toLowerCase().indexOf(me) >= 0) return 'white';
  if (me && String(game.black_name || '').toLowerCase().indexOf(me) >= 0) return 'black';
  return null;
}

async function countGames(userId) {
  const res = await db.query(
    'SELECT COUNT(*) AS n FROM chess_games g JOIN connected_chess_accounts a ON a.id = g.account_id WHERE a.user_id = $1',
    [userId]
  );
  return Number(res.rows[0].n);
}

async function ratingTrendFor(userId) {
  const res = await db.query(
    `SELECT h.category, h.point_date, h.rating
       FROM chess_rating_history h
       JOIN connected_chess_accounts a ON a.id = h.account_id
      WHERE a.user_id = $1
      ORDER BY h.point_date ASC`,
    [userId]
  );
  if (!res.rows.length) return null;
  const per = {};
  for (const r of res.rows) {
    if (!per[r.category]) per[r.category] = [];
    per[r.category].push(r);
  }
  const cat = Object.keys(per).sort((x, y) => per[y].length - per[x].length)[0];
  const points = per[cat];
  if (points.length < 10) return null;
  const first = points[0].rating;
  const last = points[points.length - 1].rating;
  const delta = last - first;
  const days = Math.max(1, Math.round((new Date(points[points.length - 1].point_date) - new Date(points[0].point_date)) / 86400000));
  const catLabel = cat.charAt(0).toUpperCase() + cat.slice(1);
  if (Math.abs(delta) >= 25 && days >= 14) {
    return {
      tone: delta > 0 ? 'good' : 'warn',
      text: `Your ${catLabel} rating ${delta > 0 ? 'increased' : 'dropped'} by ${Math.abs(delta)} points over the last ${days} days.`,
    };
  }
  return null;
}

module.exports = { buildInsights };