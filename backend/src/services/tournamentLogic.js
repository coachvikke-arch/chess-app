'use strict';

/**
 * Pure tournament logic - NO database, NO sockets, NO chess.js.
 *
 * Everything here is a plain function over plain rows so it can be unit tested
 * in isolation. The DB-facing orchestration lives in tournamentEngine.js and
 * the live game rules live in tournamentGameService.js.
 *
 * Row shapes (snake_case, exactly as stored in tournament_pairings):
 *   pairing = { id, round_no, board_no, white_player, black_player, bye,
 *               result, winner_player, white_points, black_points,
 *               white_berserk, black_berserk, finished_at }
 *   player  = { id, name, rating, seed? }
 *
 * Result codes on a pairing: 'white' | 'black' | 'draw' | 'bye' | 'abandon'
 *   abandon = nobody scored (both players no-showed / admin voided the board).
 */

const cfg = require('../config/tournamentConfig');

const FORMATS = ['swiss', 'arena', 'knockout'];

/* ── scoring ──────────────────────────────────────────────────────────────── */

const SWISS_POINTS = { win: 1, draw: 0.5, loss: 0, bye: 1 };
const ARENA_POINTS = { win: 2, draw: 1, loss: 0 };
const ARENA_BERSERK_BONUS = 1;
/* A berserk win only earns the bonus when the game lasted at least this many
   half-moves, so nobody can farm it by berserking against a no-show. */
const ARENA_BERSERK_MIN_PLIES = 4;

const isByePairing = (p) => !!p.bye || !p.black_player;

/**
 * Points each side earns for a finished game.
 *   opts.format       'swiss' | 'arena' | 'knockout'
 *   opts.result       'white' | 'black' | 'draw' | 'abandon'
 *   opts.plies        half-moves played (arena draw rule + berserk bonus)
 *   opts.whiteOnFire  white won its previous two games in a row (arena)
 *   opts.blackOnFire  same for black
 *   opts.whiteBerserk / opts.blackBerserk
 */
function scoreGame(opts) {
  const { format, result } = opts;
  if (result === 'abandon') return { white: 0, black: 0 };
  if (format !== 'arena') {
    if (result === 'white') return { white: SWISS_POINTS.win, black: SWISS_POINTS.loss };
    if (result === 'black') return { white: SWISS_POINTS.loss, black: SWISS_POINTS.win };
    if (result === 'draw') return { white: SWISS_POINTS.draw, black: SWISS_POINTS.draw };
    throw new Error('Invalid result: ' + result);
  }
  /* Arena */
  const plies = Number(opts.plies) || 0;
  const fullMoves = Math.ceil(plies / 2);
  let w = 0;
  let b = 0;
  if (result === 'white') {
    w = ARENA_POINTS.win * (opts.whiteOnFire ? 2 : 1);
    if (opts.whiteBerserk && plies >= ARENA_BERSERK_MIN_PLIES) w += ARENA_BERSERK_BONUS;
  } else if (result === 'black') {
    b = ARENA_POINTS.win * (opts.blackOnFire ? 2 : 1);
    if (opts.blackBerserk && plies >= ARENA_BERSERK_MIN_PLIES) b += ARENA_BERSERK_BONUS;
  } else if (result === 'draw') {
    /* A quick draw scores nothing - stops two friends farming points. */
    if (fullMoves >= cfg.ARENA_DRAW_POINT_MIN_MOVES) {
      w = ARENA_POINTS.draw * (opts.whiteOnFire ? 2 : 1);
      b = ARENA_POINTS.draw * (opts.blackOnFire ? 2 : 1);
    }
  } else {
    throw new Error('Invalid result: ' + result);
  }
  return { white: w, black: b };
}

/**
 * Is `playerId` "on fire" in an arena: their last two finished games were both
 * wins. `pairings` may contain any pairings; only that player's decided,
 * non-bye ones count, oldest first by finished_at / id.
 */
function isOnFire(playerId, pairings) {
  const id = String(playerId);
  const mine = pairings
    .filter((p) => !isByePairing(p) && p.result && p.result !== 'abandon'
      && (String(p.white_player) === id || String(p.black_player) === id))
    .sort((a, b) => (new Date(a.finished_at || 0) - new Date(b.finished_at || 0)) || (a.id - b.id));
  if (mine.length < 2) return false;
  const won = (p) => (p.result === 'white' && String(p.white_player) === id)
    || (p.result === 'black' && String(p.black_player) === id);
  return won(mine[mine.length - 1]) && won(mine[mine.length - 2]);
}

/* ── standings ────────────────────────────────────────────────────────────── */

/** Winner user id of a decided pairing (null for a draw / abandon / undecided). */
function winnerOf(p) {
  if (p.winner_player) return p.winner_player;
  if (isByePairing(p)) return p.white_player || null;
  if (p.result === 'white') return p.white_player;
  if (p.result === 'black') return p.black_player;
  return null;
}

function computeStandings(format, players, pairings, opts = {}) {
  const map = new Map(players.map((p) => [String(p.id), {
    playerId: p.id,
    name: p.name,
    rating: Number(p.rating) || 0,
    seed: p.seed == null ? null : Number(p.seed),
    score: 0, wins: 0, draws: 0, losses: 0, games: 0, byes: 0,
    opponents: [], buchholz: 0, eliminatedRound: null, champion: false,
    berserks: 0, streak: 0, onFire: false,
  }]));

  const decided = pairings
    .filter((p) => p.result !== null && p.result !== undefined)
    .sort((a, b) => (a.round_no || 0) - (b.round_no || 0) || (a.id || 0) - (b.id || 0));

  for (const p of decided) {
    const w = map.get(String(p.white_player));
    if (isByePairing(p)) {
      if (w) {
        w.score += p.white_points != null ? Number(p.white_points) : SWISS_POINTS.bye;
        w.byes += 1;
      }
      continue;
    }
    const b = map.get(String(p.black_player));
    let wp = p.white_points;
    let bp = p.black_points;
    if (wp == null || bp == null) {
      const s = scoreGame({ format, result: p.result, plies: 99 });
      wp = s.white; bp = s.black;
    }
    if (w) { w.score += Number(wp); if (p.result !== 'abandon') { w.games += 1; w.opponents.push(String(p.black_player)); } }
    if (b) { b.score += Number(bp); if (p.result !== 'abandon') { b.games += 1; b.opponents.push(String(p.white_player)); } }
    if (p.white_berserk && w) w.berserks += 1;
    if (p.black_berserk && b) b.berserks += 1;

    if (p.result === 'draw') {
      if (w) { w.draws += 1; w.streak = 0; }
      if (b) { b.draws += 1; b.streak = 0; }
    } else if (p.result === 'white' || p.result === 'black') {
      const winnerId = winnerOf(p);
      const win = String(winnerId) === String(p.white_player) ? w : b;
      const lose = win === w ? b : w;
      if (win) { win.wins += 1; win.streak += 1; }
      if (lose) { lose.losses += 1; lose.streak = 0; }
      if (format === 'knockout' && lose && lose.eliminatedRound == null) lose.eliminatedRound = p.round_no;
    }
  }

  for (const s of map.values()) {
    s.buchholz = s.opponents.reduce((t, id) => t + (map.get(id) ? map.get(id).score : 0), 0);
    s.onFire = format === 'arena' && s.streak >= 2;
  }

  if (format === 'knockout' && opts.totalRounds) {
    const finalPairing = decided.find((p) => p.round_no === opts.totalRounds && !isByePairing(p));
    if (finalPairing) {
      const champ = map.get(String(winnerOf(finalPairing)));
      if (champ) champ.champion = true;
    }
  }

  const list = [...map.values()];
  const byName = (a, b) => String(a.name).localeCompare(String(b.name));
  if (format === 'knockout') {
    /* Furthest round reached first; still-alive players (never eliminated)
       outrank everyone who went out; champion on top of the survivors. */
    const reached = (s) => (s.eliminatedRound == null ? Infinity : s.eliminatedRound);
    list.sort((a, b) => (Number(b.champion) - Number(a.champion))
      || (reached(b) - reached(a)) || (b.wins - a.wins) || (b.rating - a.rating) || byName(a, b));
  } else if (format === 'arena') {
    list.sort((a, b) => (b.score - a.score) || (b.wins - a.wins) || (b.rating - a.rating) || byName(a, b));
  } else {
    list.sort((a, b) => (b.score - a.score) || (b.buchholz - a.buchholz) || (b.wins - a.wins)
      || (b.rating - a.rating) || byName(a, b));
  }
  list.forEach((s, i) => { s.rank = i + 1; });
  return list;
}

/* ── history helpers ─────────────────────────────────────────────────────── */

function buildHistory(players, pairings) {
  const played = new Set();
  const whites = {};
  const blacks = {};
  const last = {};
  const byes = new Set();
  const lastOpponent = {};
  players.forEach((p) => { whites[p.id] = 0; blacks[p.id] = 0; last[p.id] = []; });
  [...pairings]
    .sort((a, b) => (a.round_no || 0) - (b.round_no || 0) || (a.id || 0) - (b.id || 0))
    .forEach((p) => {
      if (isByePairing(p)) { byes.add(String(p.white_player)); return; }
      const a = String(p.white_player);
      const b = String(p.black_player);
      played.add(a + '|' + b); played.add(b + '|' + a);
      whites[a] = (whites[a] || 0) + 1; blacks[b] = (blacks[b] || 0) + 1;
      (last[a] = last[a] || []).push('W'); (last[b] = last[b] || []).push('B');
      lastOpponent[a] = b; lastOpponent[b] = a;
    });
  return { played, whites, blacks, last, byes, lastOpponent };
}

/** Pick colours for a pair using colour balance, then streak, then rank. */
function assignColors(x, y, h) {
  const diff = (id) => (h.whites[id] || 0) - (h.blacks[id] || 0); // >0 = has had more whites
  const streak = (id) => {
    const l = h.last[id] || [];
    const c = l[l.length - 1];
    let n = 0;
    for (let i = l.length - 1; i >= 0 && l[i] === c; i--) n++;
    return { c, n };
  };
  const sx = streak(x.id);
  const sy = streak(y.id);
  /* Never a third identical colour in a row if it can be avoided. */
  if (sx.c === 'W' && sx.n >= 2 && !(sy.c === 'W' && sy.n >= 2)) return { white: y, black: x };
  if (sx.c === 'B' && sx.n >= 2 && !(sy.c === 'B' && sy.n >= 2)) return { white: x, black: y };
  if (sy.c === 'W' && sy.n >= 2 && !(sx.c === 'W' && sx.n >= 2)) return { white: x, black: y };
  if (sy.c === 'B' && sy.n >= 2 && !(sx.c === 'B' && sx.n >= 2)) return { white: y, black: x };
  const dx = diff(x.id);
  const dy = diff(y.id);
  if (dx !== dy) return dx < dy ? { white: x, black: y } : { white: y, black: x };
  /* Equal balance: whoever did NOT have white last time gets it. */
  const lx = (h.last[x.id] || []).slice(-1)[0];
  const ly = (h.last[y.id] || []).slice(-1)[0];
  if (lx === 'W' && ly !== 'W') return { white: y, black: x };
  if (ly === 'W' && lx !== 'W') return { white: x, black: y };
  return { white: x, black: y };
}

/* ── Swiss ────────────────────────────────────────────────────────────────── */

/** Sensible default round count: ceil(log2(n)), at least 3 when n allows. */
function defaultSwissRounds(n) {
  if (n < 2) return 0;
  const r = Math.ceil(Math.log2(n));
  return Math.max(Math.min(3, n - 1), r);
}

/** The most rounds a Swiss can run without forcing rematches. */
function maxSwissRounds(n) {
  return Math.max(0, n - 1);
}

function pairSwissRound(players, previousPairings, roundNo) {
  const warnings = [];
  if (players.length < 2) throw new Error('At least 2 players are needed to pair a round');
  const h = buildHistory(players, previousPairings);
  const standings = computeStandings('swiss', players, previousPairings);
  const scoreOf = Object.fromEntries(standings.map((s) => [String(s.playerId), s.score]));
  const byRank = (a, b) => (b.score - a.score) || ((b.rating || 0) - (a.rating || 0))
    || String(a.name).localeCompare(String(b.name));
  let pool = players.map((p) => ({ ...p, score: scoreOf[String(p.id)] || 0 })).sort(byRank);

  const out = [];
  /* Odd field: bye to the lowest-ranked player who has not had one yet. */
  if (pool.length % 2 === 1) {
    let idx = -1;
    for (let i = pool.length - 1; i >= 0; i--) {
      if (!h.byes.has(String(pool[i].id))) { idx = i; break; }
    }
    if (idx === -1) { idx = pool.length - 1; warnings.push('Every player already had a bye; repeating one.'); }
    out.push({ white: pool[idx].id, black: null, bye: true });
    pool = pool.filter((_, i) => i !== idx);
  }

  const rankIndex = new Map(pool.map((p, i) => [String(p.id), i]));
  function candidates(p, rest) {
    const group = [p, ...rest.filter((r) => r.score === p.score)];
    const half = Math.ceil(group.length / 2);
    /* Top half meets bottom half inside a score group. */
    const preferred = group.slice(half);
    const sameGroupTop = group.slice(1, half);
    const others = rest.filter((r) => r.score !== p.score)
      .sort((a, b) => Math.abs(a.score - p.score) - Math.abs(b.score - p.score)
        || rankIndex.get(String(a.id)) - rankIndex.get(String(b.id)));
    return [...preferred, ...sameGroupTop, ...others];
  }

  let nodes = 0;
  const NODE_LIMIT = 250000;
  function solve(list, allowRematch) {
    if (!list.length) return [];
    if (++nodes > NODE_LIMIT) return null;
    const [p, ...rest] = list;
    for (const q of candidates(p, rest)) {
      if (!allowRematch && h.played.has(String(p.id) + '|' + String(q.id))) continue;
      const sub = solve(rest.filter((r) => r.id !== q.id), allowRematch);
      if (sub) return [[p, q], ...sub];
    }
    return null;
  }

  let pairs;
  if (roundNo === 1) {
    /* Round 1: top half v bottom half by rating (1 v n/2+1, 2 v n/2+2 ...). */
    const half = pool.length / 2;
    pairs = pool.slice(0, half).map((p, i) => [p, pool[half + i]]);
  } else {
    nodes = 0;
    pairs = solve(pool, false);
    if (!pairs) {
      nodes = 0;
      pairs = solve(pool, true);
      if (pairs) warnings.push('Rematches were unavoidable in this round.');
    }
    if (!pairs) throw new Error('Could not generate pairings');
  }

  pairs.forEach(([x, y], i) => {
    if (h.played.has(String(x.id) + '|' + String(y.id)) && !warnings.some((w) => w.startsWith('Rematches'))) {
      warnings.push('Rematch: ' + x.name + ' vs ' + y.name);
    }
    let c = assignColors(x, y, h);
    if (roundNo === 1) c = i % 2 === 0 ? { white: x, black: y } : { white: y, black: x };
    out.push({ white: c.white.id, black: c.black.id, bye: false });
  });
  return { pairings: out, warnings };
}

/* ── Knockout ─────────────────────────────────────────────────────────────── */

function bracketSize(n) {
  let s = 1;
  while (s < n) s *= 2;
  return Math.max(2, s);
}

function knockoutRounds(n) {
  return Math.log2(bracketSize(n));
}

/** Standard seeding order for a bracket: 1 v size, then so the top seeds meet last. */
function seedOrder(size) {
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((s) => [s, n + 1 - s]);
  }
  return order;
}

/**
 * Round 1 of a knockout. Players are seeded by rating. Missing opponents
 * (when the field is not a power of two) become byes for the top seeds.
 * Returns pairings in board order plus the seed assigned to every player.
 */
function pairKnockoutFirstRound(players) {
  if (players.length < 2) throw new Error('At least 2 players are needed for a knockout');
  const seeded = [...players].sort((a, b) => ((b.rating || 0) - (a.rating || 0))
    || String(a.name).localeCompare(String(b.name)));
  const n = seeded.length;
  const size = bracketSize(n);
  const order = seedOrder(size);
  const pairs = [];
  for (let i = 0; i < size / 2; i++) {
    const a = order[2 * i];
    const b = order[2 * i + 1];
    const pa = seeded[a - 1];
    const pb = b <= n ? seeded[b - 1] : null;
    if (!pa) continue;
    if (!pb) pairs.push({ white: pa.id, black: null, bye: true, board: i + 1 });
    else if (i % 2 === 0) pairs.push({ white: pa.id, black: pb.id, bye: false, board: i + 1 });
    else pairs.push({ white: pb.id, black: pa.id, bye: false, board: i + 1 });
  }
  const seeds = seeded.map((p, i) => ({ id: p.id, seed: i + 1 }));
  return { pairings: pairs, seeds, totalRounds: Math.log2(size) };
}

/** Next knockout round: winners of boards (1,2) meet, (3,4) meet, ... */
function pairKnockoutNextRound(previousRoundPairings) {
  const prev = [...previousRoundPairings].sort((a, b) => (a.board_no || 0) - (b.board_no || 0) || a.id - b.id);
  const winners = prev.map((p) => winnerOf(p));
  if (winners.some((w) => !w)) throw new Error('Previous round is not fully decided');
  const pairs = [];
  for (let i = 0; i + 1 < winners.length; i += 2) {
    const a = winners[i];
    const b = winners[i + 1];
    pairs.push({ white: i % 4 === 0 ? a : b, black: i % 4 === 0 ? b : a, bye: false, board: i / 2 + 1 });
  }
  if (winners.length === 1) return { pairings: [], champion: winners[0] };
  return { pairings: pairs, champion: null };
}

/* ── Arena ────────────────────────────────────────────────────────────────── */

/**
 * Pair the players that are free right now. `waiting` = ready players with a
 * current `score`; `previousPairings` = every pairing so far (for colours and
 * to avoid an instant rematch).
 */
function pairArenaWave(waiting, previousPairings) {
  const h = buildHistory(waiting, previousPairings);
  const standings = computeStandings('arena', waiting, previousPairings);
  const scoreOf = Object.fromEntries(standings.map((s) => [String(s.playerId), s.score]));
  const pool = waiting.map((p) => ({ ...p, score: scoreOf[String(p.id)] || 0 }))
    .sort((a, b) => (b.score - a.score) || ((b.rating || 0) - (a.rating || 0))
      || String(a.name).localeCompare(String(b.name)));
  const out = [];
  while (pool.length >= 2) {
    const p = pool.shift();
    let qi = pool.findIndex((q) => h.lastOpponent[String(p.id)] !== String(q.id)
      && h.lastOpponent[String(q.id)] !== String(p.id));
    if (qi === -1) {
      /* Only the previous opponent is free. Let them rematch only when there is
         nobody else in the whole arena they could meet. */
      qi = 0;
    }
    const q = pool.splice(qi, 1)[0];
    const c = assignColors(p, q, h);
    out.push({ white: c.white.id, black: c.black.id, bye: false });
  }
  return { pairings: out, warnings: [] };
}

/* ── clocks ───────────────────────────────────────────────────────────────── */

const toMs = (minutes) => Math.round(Number(minutes) * 60 * 1000);

function initialClock(tournament, { berserkWhite = false, berserkBlack = false, armageddon = false } = {}) {
  if (armageddon) {
    return {
      whiteMs: cfg.ARMAGEDDON_WHITE_MS, blackMs: cfg.ARMAGEDDON_BLACK_MS, incrementMs: 0,
    };
  }
  const base = toMs(tournament.time_minutes);
  const inc = Math.round(Number(tournament.increment_seconds || 0) * 1000);
  return {
    whiteMs: berserkWhite ? Math.round(base / 2) : base,
    blackMs: berserkBlack ? Math.round(base / 2) : base,
    incrementMs: inc,
  };
}

module.exports = {
  FORMATS,
  SWISS_POINTS,
  ARENA_POINTS,
  ARENA_BERSERK_BONUS,
  ARENA_BERSERK_MIN_PLIES,
  isByePairing,
  scoreGame,
  isOnFire,
  winnerOf,
  computeStandings,
  buildHistory,
  assignColors,
  defaultSwissRounds,
  maxSwissRounds,
  pairSwissRound,
  bracketSize,
  knockoutRounds,
  seedOrder,
  pairKnockoutFirstRound,
  pairKnockoutNextRound,
  pairArenaWave,
  initialClock,
  toMs,
};
