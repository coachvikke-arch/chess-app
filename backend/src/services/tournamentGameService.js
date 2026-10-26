'use strict';

/**
 * Live tournament games. The SERVER is authoritative: it validates every move
 * with chess.js, runs both clocks, enforces no-show / first-move / flag-fall /
 * disconnect rules and finishes the game. Browsers only render what it sends.
 *
 * Game lifecycle:  pending  ->  active  ->  finished
 *   pending  both players have not opened the board yet (no-show timer runs)
 *   active   both connected; White has FIRST_MOVE_COUNTDOWN_MS for move 1
 * Clocks only run from ply 1 (after White's first move) for the side to move.
 */

const { Chess } = require('chess.js');
const db = require('../config/database');
const cfg = require('../config/tournamentConfig');
const L = require('./tournamentLogic');
const rt = require('./tournamentRealtime');

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const games = new Map();      // gameId -> in-memory game (unfinished only)
const presence = new Map();   // gameId -> Map(userId -> Set(socketId))
const locks = new Map();      // gameId -> promise chain
let ioRef = null;
let tickTimer = null;

const httpError = (status, message) => Object.assign(new Error(message), { status });
const num = (v) => (v == null ? null : Number(v));

/* One action at a time per game: a move, a flag-fall and a resign can never
   interleave and finish the same game twice. */
function withLock(id, fn) {
  const prev = locks.get(id) || Promise.resolve();
  const run = prev.then(fn, fn);
  locks.set(id, run.catch(() => {}));
  return run;
}

/* ── build / hydrate ──────────────────────────────────────────────────────── */

async function createGameRow(client, { tournament, pairing, white, black, armageddon = false }) {
  const clock = L.initialClock(tournament, { armageddon });
  const noShowMs = tournament.no_show_seconds
    ? Number(tournament.no_show_seconds) * 1000
    : cfg.NO_SHOW_TIMEOUT_MS;
  const r = await client.query(
    `INSERT INTO tournament_games
       (tournament_id, pairing_id, white_player, black_player, fen, pgn, status, turn,
        white_ms, black_ms, white_inc_ms, black_inc_ms, no_show_deadline, armageddon, offer_meta)
     VALUES ($1,$2,$3,$4,$5,'','pending','w',$6,$7,$8,$8,$9,$10,$11)
     RETURNING *`,
    [tournament.id, pairing.id, white, black, START_FEN, clock.whiteMs, clock.blackMs,
      clock.incrementMs, Date.now() + noShowMs, !!armageddon, JSON.stringify({ lastOffer: {} })]
  );
  return r.rows[0];
}

async function hydrate(row) {
  const chess = new Chess();
  if (row.pgn && row.pgn.trim()) {
    try { chess.loadPgn(row.pgn); } catch (_) { try { chess.load(row.fen); } catch (e) { /* start */ } }
  }
  const t = (await db.query(
    `SELECT id, format, time_minutes, increment_seconds, allow_berserk, allow_draw_offers
       FROM tournaments WHERE id = $1`, [row.tournament_id])).rows[0] || {};
  const ids = [row.white_player, row.black_player].filter(Boolean);
  const users = ids.length ? (await db.query(
    `SELECT u.id, u.name, COALESCE(s.current_rating, 1000)::int AS rating
       FROM users u LEFT JOIN students s ON s.user_id = u.id WHERE u.id = ANY($1)`, [ids])).rows : [];
  const info = (id) => {
    const u = users.find((x) => Number(x.id) === Number(id));
    return u ? { id: Number(u.id), name: u.name, rating: u.rating } : { id: num(id), name: 'Player', rating: 0 };
  };
  const meta = row.offer_meta || {};
  return {
    id: Number(row.id),
    tournamentId: Number(row.tournament_id),
    pairingId: num(row.pairing_id),
    format: t.format || 'swiss',
    allowBerserk: t.allow_berserk !== false,
    allowDrawOffers: t.allow_draw_offers !== false,
    baseMs: L.toMs(t.time_minutes || 0),
    white: Number(row.white_player),
    black: Number(row.black_player),
    players: { white: info(row.white_player), black: info(row.black_player) },
    chess,
    status: row.status,
    result: row.result,
    reason: row.reason,
    winnerId: num(row.winner_player),
    whiteMs: Number(row.white_ms),
    blackMs: Number(row.black_ms),
    incMs: { w: Number(row.white_inc_ms) || 0, b: Number(row.black_inc_ms) || 0 },
    lastMoveAt: num(row.last_move_at),
    noShowDeadline: num(row.no_show_deadline),
    firstMoveDeadline: num(row.first_move_deadline),
    drawOfferBy: num(row.draw_offer_by),
    lastOffer: (meta && meta.lastOffer) || {},
    berserk: { w: !!row.white_berserk, b: !!row.black_berserk },
    armageddon: !!row.armageddon,
    disconnectedAt: {},
    startedAt: row.started_at,
  };
}

async function loadGame(id) {
  const key = Number(id);
  if (games.has(key)) return games.get(key);
  const r = await db.query('SELECT * FROM tournament_games WHERE id = $1', [key]);
  if (!r.rows.length) return null;
  const G = await hydrate(r.rows[0]);
  if (G.status !== 'finished') games.set(key, G);
  return G;
}

/* ── clocks / state ───────────────────────────────────────────────────────── */

const plies = (G) => G.chess.history().length;
const turnColor = (G) => G.chess.turn(); // 'w' | 'b'
const userOf = (G, c) => (c === 'w' ? G.white : G.black);
const colorOf = (G, userId) => (Number(userId) === G.white ? 'w' : Number(userId) === G.black ? 'b' : null);

/* Remaining time right now. Nothing runs before ply 1 or once finished. */
function clockNow(G, now = Date.now()) {
  let w = G.whiteMs;
  let b = G.blackMs;
  if (G.status === 'active' && plies(G) >= 1 && G.lastMoveAt) {
    const spent = Math.max(0, now - G.lastMoveAt);
    if (turnColor(G) === 'w') w -= spent; else b -= spent;
  }
  return { whiteMs: Math.max(0, Math.round(w)), blackMs: Math.max(0, Math.round(b)) };
}

function isConnected(G, userId) {
  const m = presence.get(G.id);
  return !!(m && m.get(Number(userId)) && m.get(Number(userId)).size);
}

function lastMoveOf(G) {
  const h = G.chess.history({ verbose: true });
  const m = h[h.length - 1];
  return m ? { from: m.from, to: m.to } : null;
}

function publicState(G, now = Date.now()) {
  const c = clockNow(G, now);
  const hist = G.chess.history({ verbose: true });
  return {
    gameId: G.id,
    tournamentId: G.tournamentId,
    pairingId: G.pairingId,
    format: G.format,
    status: G.status,
    white: G.players.white,
    black: G.players.black,
    fen: G.chess.fen(),
    pgn: G.chess.pgn(),
    moves: hist.map((m) => ({ san: m.san, from: m.from, to: m.to })),
    plies: hist.length,
    turn: turnColor(G),
    lastMove: lastMoveOf(G),
    inCheck: G.chess.inCheck(),
    clock: {
      whiteMs: c.whiteMs,
      blackMs: c.blackMs,
      turn: turnColor(G),
      running: G.status === 'active' && hist.length >= 1,
      finished: G.status === 'finished',
      at: now,
    },
    incrementMs: G.incMs,
    result: G.result,
    reason: G.reason,
    winnerId: G.winnerId,
    drawOfferBy: G.drawOfferBy,
    berserk: { white: G.berserk.w, black: G.berserk.b },
    canBerserk: { white: canBerserk(G, 'w'), black: canBerserk(G, 'b') },
    armageddon: G.armageddon,
    noShowDeadline: G.status === 'pending' ? G.noShowDeadline : null,
    firstMoveDeadline: G.status === 'active' && hist.length === 0 ? G.firstMoveDeadline : null,
    connected: { white: isConnected(G, G.white), black: isConnected(G, G.black) },
    serverTime: now,
  };
}

function broadcast(G) {
  if (!ioRef) return;
  const state = publicState(G);
  ioRef.to(rt.gameRoom(G.id)).emit('tournament:game:state', state);
  rt.emitTournament(ioRef, G.tournamentId, 'tournament:game', { gameId: G.id, status: G.status });
}

async function persist(G, extra = {}) {
  const h = plies(G);
  await db.query(
    `UPDATE tournament_games SET
       fen=$2, pgn=$3, moves_count=$4, status=$5, result=$6, reason=$7, winner_player=$8,
       turn=$9, white_ms=$10, black_ms=$11, white_inc_ms=$12, black_inc_ms=$13, last_move_at=$14,
       first_move_deadline=$15, draw_offer_by=$16, white_berserk=$17, black_berserk=$18,
       offer_meta=$19, started_at=COALESCE(started_at, $20), finished_at=$21, updated_at=NOW()
     WHERE id=$1`,
    [G.id, G.chess.fen(), G.chess.pgn(), h, G.status, G.result, G.reason, G.winnerId,
      turnColor(G), Math.round(G.whiteMs), Math.round(G.blackMs), G.incMs.w, G.incMs.b,
      G.lastMoveAt, G.firstMoveDeadline, G.drawOfferBy, G.berserk.w, G.berserk.b,
      JSON.stringify({ lastOffer: G.lastOffer }),
      extra.startedAt || null, extra.finishedAt || null]
  );
}

/* ── rules helpers ────────────────────────────────────────────────────────── */

/* Can this colour still deliver mate? King + a lone minor piece cannot. */
function hasMatingMaterial(G, color) {
  let minors = 0;
  for (const row of G.chess.board()) {
    for (const sq of row) {
      if (!sq || sq.color !== color) continue;
      if (sq.type === 'p' || sq.type === 'r' || sq.type === 'q') return true;
      if (sq.type === 'n' || sq.type === 'b') minors += 1;
    }
  }
  return minors >= 2;
}

function canBerserk(G, c) {
  if (G.format !== 'arena' || !G.allowBerserk || !cfg.BERSERK_ENABLED) return false;
  if (G.status === 'finished' || G.berserk[c] || G.armageddon || G.baseMs <= 0) return false;
  const h = plies(G);
  return c === 'w' ? h === 0 : h <= 1;
}

const ownMoves = (G, c) => (c === 'w' ? Math.ceil(plies(G) / 2) : Math.floor(plies(G) / 2));

/* ── finishing ────────────────────────────────────────────────────────────── */

async function finish(G, { result, reason, winnerId = null }) {
  if (G.status === 'finished') return;
  const c = clockNow(G);
  G.whiteMs = c.whiteMs;
  G.blackMs = c.blackMs;
  /* Armageddon: Black has draw odds, a draw is a Black win. */
  if (G.armageddon && result === 'draw') {
    result = 'black';
    winnerId = G.black;
    reason = 'armageddon';
  }
  if (result === 'white') winnerId = G.white;
  if (result === 'black') winnerId = G.black;
  G.status = 'finished';
  G.result = result;
  G.reason = reason;
  G.winnerId = result === 'white' || result === 'black' ? winnerId : null;
  G.drawOfferBy = null;
  await persist(G, { finishedAt: new Date() });
  broadcast(G);
  games.delete(G.id);
  setTimeout(() => presence.delete(G.id), 60 * 1000).unref?.();
  try {
    await require('./tournamentEngine').onGameFinished(ioRef, G);
  } catch (err) {
    console.error('[tournament] onGameFinished failed', err);
  }
}

/* A player failed to show / move / stay connected. */
function forfeit(G, loserColor, reason) {
  const winnerColor = loserColor === 'w' ? 'b' : 'w';
  /* Arena: a forfeit before real play scores nobody (no point-farming). */
  if (G.format === 'arena' && plies(G) < L.ARENA_BERSERK_MIN_PLIES) {
    return finish(G, { result: 'abandon', reason });
  }
  return finish(G, {
    result: winnerColor === 'w' ? 'white' : 'black',
    reason,
    winnerId: userOf(G, winnerColor),
  });
}

async function markArenaAbsent(G, colors) {
  if (G.format !== 'arena') return;
  for (const c of colors) {
    await db.query(
      'UPDATE tournament_registrations SET paused = TRUE WHERE tournament_id=$1 AND student_id=$2',
      [G.tournamentId, userOf(G, c)]
    ).catch(() => {});
  }
}

/* The periodic rules check for ONE game. Always runs under the game lock. */
async function check(G, now = Date.now()) {
  if (G.status === 'finished') return;

  if (G.status === 'pending') {
    if (G.noShowDeadline && now > G.noShowDeadline) {
      const w = isConnected(G, G.white);
      const b = isConnected(G, G.black);
      if (w && !b) { await markArenaAbsent(G, ['b']); return forfeit(G, 'b', 'forfeit_no_show'); }
      if (b && !w) { await markArenaAbsent(G, ['w']); return forfeit(G, 'w', 'forfeit_no_show'); }
      await markArenaAbsent(G, ['w', 'b']);
      return finish(G, { result: 'abandon', reason: 'forfeit_no_show' });
    }
    return undefined;
  }

  /* active */
  const h = plies(G);
  if (h === 0 && G.firstMoveDeadline && now > G.firstMoveDeadline) {
    await markArenaAbsent(G, ['w']);
    return forfeit(G, 'w', 'forfeit_no_show');
  }
  if (h >= 1) {
    const c = clockNow(G, now);
    const t = turnColor(G);
    if ((t === 'w' ? c.whiteMs : c.blackMs) <= 0) {
      const winner = t === 'w' ? 'b' : 'w';
      /* Out of time against a bare king is a draw, not a loss (FIDE 6.9). */
      if (!hasMatingMaterial(G, winner)) return finish(G, { result: 'draw', reason: 'timeout_vs_insufficient' });
      return finish(G, { result: winner === 'w' ? 'white' : 'black', reason: 'timeout', winnerId: userOf(G, winner) });
    }
  }
  for (const c of ['w', 'b']) {
    const at = G.disconnectedAt[c];
    if (at && now - at > cfg.DISCONNECT_TIMEOUT_MS && !isConnected(G, userOf(G, c))) {
      await markArenaAbsent(G, [c]);
      return forfeit(G, c, 'abandon');
    }
  }
  return undefined;
}

/* ── actions (called by REST + socket) ────────────────────────────────────── */

async function requirePlayer(gameId, userId) {
  const G = await loadGame(gameId);
  if (!G) throw httpError(404, 'Game not found');
  const color = colorOf(G, userId);
  if (!color) throw httpError(403, 'You are not a player in this game');
  return { G, color };
}

function move(gameId, userId, { from, to, promotion } = {}) {
  return withLock(Number(gameId), async () => {
    const { G, color } = await requirePlayer(gameId, userId);
    if (G.status !== 'active') throw httpError(409, G.status === 'pending' ? 'Waiting for your opponent to join' : 'Game is over');
    if (turnColor(G) !== color) throw httpError(409, 'Not your turn');
    const now = Date.now();
    /* Flag first: a move made after the clock ran out is not a move. */
    await check(G, now);
    if (G.status === 'finished') return publicState(G);

    /* Clock of the mover BEFORE the move is applied (chess still pre-move). */
    const pre = clockNow(G, now);
    let made;
    try {
      made = G.chess.move({ from, to, promotion: promotion || 'q' });
    } catch (_) { made = null; }
    if (!made) throw httpError(400, 'Illegal move');

    const h = plies(G); // plies AFTER this move
    /* White's very first move is free (clocks start at ply 1); every later
       move banks the mover's increment. */
    const spentMs = h === 1 ? (color === 'w' ? G.whiteMs : G.blackMs)
      : (color === 'w' ? pre.whiteMs : pre.blackMs) + G.incMs[color];
    if (color === 'w') G.whiteMs = spentMs; else G.blackMs = spentMs;
    G.lastMoveAt = now;
    if (G.drawOfferBy && G.drawOfferBy !== Number(userId)) G.drawOfferBy = null; // moving ignores an offer
    delete G.disconnectedAt[color];

    let end = null;
    if (G.chess.isCheckmate()) end = { result: color === 'w' ? 'white' : 'black', reason: 'checkmate', winnerId: userId };
    else if (G.chess.isStalemate()) end = { result: 'draw', reason: 'stalemate' };
    else if (G.chess.isInsufficientMaterial()) end = { result: 'draw', reason: 'insufficient_material' };
    else if (G.chess.isThreefoldRepetition()) end = { result: 'draw', reason: 'repetition' };
    else if (typeof G.chess.isDrawByFiftyMoves === 'function' ? G.chess.isDrawByFiftyMoves() : G.chess.isDraw()) {
      end = { result: 'draw', reason: 'fifty_move' };
    }
    if (end) {
      await finish(G, end);
    } else {
      await persist(G);
      broadcast(G);
    }
    return publicState(G);
  });
}

function resign(gameId, userId) {
  return withLock(Number(gameId), async () => {
    const { G, color } = await requirePlayer(gameId, userId);
    if (G.status === 'finished') throw httpError(409, 'Game is over');
    const winner = color === 'w' ? 'b' : 'w';
    await finish(G, { result: winner === 'w' ? 'white' : 'black', reason: 'resign', winnerId: userOf(G, winner) });
    return publicState(G);
  });
}

function offerDraw(gameId, userId) {
  return withLock(Number(gameId), async () => {
    const { G, color } = await requirePlayer(gameId, userId);
    if (G.status !== 'active') throw httpError(409, 'Game is not in progress');
    if (!G.allowDrawOffers || !cfg.DRAW_OFFER_ENABLED) throw httpError(403, 'Draw offers are disabled in this tournament');
    if (G.drawOfferBy && G.drawOfferBy !== Number(userId)) {
      /* They already offered: offering back is accepting. */
      await finish(G, { result: 'draw', reason: 'agreement' });
      return publicState(G);
    }
    if (G.drawOfferBy === Number(userId)) return publicState(G);
    const mine = ownMoves(G, color);
    if (mine < 1) throw httpError(409, 'Make a move before offering a draw');
    const last = G.lastOffer[color];
    if (last != null && mine - last < cfg.DRAW_OFFER_COOLDOWN_MOVES) {
      throw httpError(429, `You can offer a draw again in ${cfg.DRAW_OFFER_COOLDOWN_MOVES - (mine - last)} move(s)`);
    }
    G.lastOffer[color] = mine;
    G.drawOfferBy = Number(userId);
    await persist(G);
    broadcast(G);
    return publicState(G);
  });
}

function respondDraw(gameId, userId, accept) {
  return withLock(Number(gameId), async () => {
    const { G } = await requirePlayer(gameId, userId);
    if (G.status !== 'active') throw httpError(409, 'Game is not in progress');
    if (!G.drawOfferBy || G.drawOfferBy === Number(userId)) throw httpError(409, 'There is no draw offer to answer');
    if (accept) {
      await finish(G, { result: 'draw', reason: 'agreement' });
    } else {
      G.drawOfferBy = null;
      await persist(G);
      broadcast(G);
    }
    return publicState(G);
  });
}

function berserk(gameId, userId) {
  return withLock(Number(gameId), async () => {
    const { G, color } = await requirePlayer(gameId, userId);
    if (!canBerserk(G, color)) throw httpError(409, 'Berserk is not available');
    G.berserk[color] = true;
    G.incMs[color] = 0;
    if (color === 'w') G.whiteMs = Math.round(G.whiteMs / 2); else G.blackMs = Math.round(G.blackMs / 2);
    await persist(G);
    broadcast(G);
    return publicState(G);
  });
}

/* Admin / system ending of a live game. */
function adminFinish(gameId, { result, reason = 'admin', winnerId = null }) {
  return withLock(Number(gameId), async () => {
    const G = await loadGame(gameId);
    if (!G || G.status === 'finished') return null;
    await finish(G, { result, reason, winnerId });
    return publicState(G);
  });
}

/* ── presence ─────────────────────────────────────────────────────────────── */

async function playerJoined(gameId, userId, socketId) {
  return withLock(Number(gameId), async () => {
    const G = await loadGame(gameId);
    if (!G) return null;
    const key = G.id;
    if (!presence.has(key)) presence.set(key, new Map());
    const m = presence.get(key);
    if (!m.has(Number(userId))) m.set(Number(userId), new Set());
    m.get(Number(userId)).add(socketId);
    const c = colorOf(G, userId);
    if (c) {
      delete G.disconnectedAt[c];
      if (G.status === 'pending' && isConnected(G, G.white) && isConnected(G, G.black)) {
        G.status = 'active';
        G.firstMoveDeadline = Date.now() + cfg.FIRST_MOVE_COUNTDOWN_MS;
        await persist(G, { startedAt: new Date() });
      }
      broadcast(G);
    }
    return publicState(G);
  });
}

async function playerLeft(gameId, userId, socketId) {
  const key = Number(gameId);
  const m = presence.get(key);
  if (!m) return;
  const set = m.get(Number(userId));
  if (set) { set.delete(socketId); if (!set.size) m.delete(Number(userId)); }
  const G = games.get(key);
  if (!G || G.status === 'finished') return;
  const c = colorOf(G, userId);
  if (c && !isConnected(G, userId)) {
    G.disconnectedAt[c] = Date.now();
    broadcast(G);
  }
}

function socketDisconnected(userId, socketId) {
  for (const gameId of [...presence.keys()]) playerLeft(gameId, userId, socketId);
}

/* Who may watch a board. Players always; coaches always; other registered
   students only once they have no unfinished board of their own in the same
   tournament (so nobody can peek at a live game to get help). */
async function canView(user, G) {
  if (!user) return false;
  if (user.role === 'admin' || user.role === 'superadmin') return true;
  if (colorOf(G, user.id)) return true;
  const reg = await db.query(
    "SELECT 1 FROM tournament_registrations WHERE tournament_id=$1 AND student_id=$2 AND status NOT IN ('withdrawn','disqualified')",
    [G.tournamentId, user.id]);
  if (!reg.rows.length) return false;
  if (G.status === 'finished') return true;
  const busy = await db.query(
    `SELECT 1 FROM tournament_games WHERE tournament_id=$1 AND status IN ('pending','active')
       AND (white_player=$2 OR black_player=$2) LIMIT 1`, [G.tournamentId, user.id]);
  return busy.rows.length === 0;
}

/* ── lifecycle ────────────────────────────────────────────────────────────── */

/* Called by the engine right after it commits a new game row. */
async function track(gameId) {
  const G = await loadGame(gameId);
  if (!G) return null;
  if (ioRef) {
    for (const c of ['w', 'b']) {
      rt.emitToUser(ioRef, userOf(G, c), 'tournament:game:ready', {
        tournamentId: G.tournamentId, gameId: G.id, color: c === 'w' ? 'white' : 'black',
        opponent: c === 'w' ? G.players.black.name : G.players.white.name,
      });
    }
  }
  return G;
}

function enforceTournament(tournamentId) {
  const jobs = [...games.values()]
    .filter((G) => G.tournamentId === Number(tournamentId))
    .map((G) => withLock(G.id, () => check(G)));
  return Promise.all(jobs);
}

async function restore() {
  const r = await db.query("SELECT * FROM tournament_games WHERE status IN ('pending','active')");
  for (const row of r.rows) {
    const G = await hydrate(row);
    /* Everybody counts as disconnected after a restart; they get the normal
       disconnect window to come back before anything is forfeited. */
    if (G.status === 'active') { G.disconnectedAt = { w: Date.now(), b: Date.now() }; }
    if (G.status === 'pending' && G.noShowDeadline && G.noShowDeadline < Date.now() + 15000) {
      G.noShowDeadline = Date.now() + 15000;
    }
    games.set(G.id, G);
  }
}

function init(io) {
  ioRef = io;
  restore().catch((e) => console.error('[tournament] restore failed', e.message));
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = setInterval(() => {
    const now = Date.now();
    for (const G of [...games.values()]) {
      withLock(G.id, () => check(G, now)).catch((e) => console.error('[tournament] tick', e.message));
    }
  }, 1000);
  if (tickTimer.unref) tickTimer.unref();
}

module.exports = {
  init,
  createGameRow,
  loadGame,
  publicState,
  track,
  move,
  resign,
  offerDraw,
  respondDraw,
  berserk,
  adminFinish,
  playerJoined,
  playerLeft,
  socketDisconnected,
  enforceTournament,
  canView,
  colorOf,
  clockNow,
  START_FEN,
  /* test hook: forget every cached game / presence entry */
  __reset() { games.clear(); presence.clear(); locks.clear(); },
};
