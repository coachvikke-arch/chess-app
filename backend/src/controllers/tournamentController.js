'use strict';

const db = require('../config/database');
const engine = require('../services/tournamentEngine');
const GS = require('../services/tournamentGameService');
const { ensureTournamentSchema } = require('../services/tournamentSchema');

/* Wrap an async handler: engine errors carry an HTTP status, anything else is a 500. */
const h = (fn) => async (req, res) => {
  try {
    await ensureTournamentSchema();
    await fn(req, res);
  } catch (err) {
    if (!err.status || err.status >= 500) console.error('[tournaments]', err);
    res.status(err.status || 500).json({ message: err.message || 'Something went wrong' });
  }
};

const io = (req) => req.app.get('io');
const id = (req, k = 'id') => {
  const n = Number(req.params[k]);
  if (!Number.isInteger(n) || n <= 0) throw Object.assign(new Error('Invalid id'), { status: 400 });
  return n;
};

/* ── tournaments ──────────────────────────────────────────────────────────── */

exports.list = h(async (req, res) => {
  res.json({ tournaments: await engine.listTournaments(req.user) });
});

exports.create = h(async (req, res) => {
  const t = await engine.createTournament(io(req), req.body || {}, req.user);
  res.status(201).json({ tournament: engine.shapeTournament(t) });
});

exports.get = h(async (req, res) => {
  res.json(await engine.getDetail(id(req), req.user.id));
});

exports.update = h(async (req, res) => {
  const t = await engine.updateTournament(io(req), id(req), req.body || {}, req.user.id);
  res.json({ tournament: engine.shapeTournament(t) });
});

exports.remove = h(async (req, res) => {
  res.json(await engine.deleteTournament(io(req), id(req), req.user.id));
});

exports.report = h(async (req, res) => {
  res.json(await engine.getReport(id(req)));
});

/* PATCH /:id/status  { status: 'active' | 'paused' | 'completed' | 'cancelled' } */
exports.setStatus = h(async (req, res) => {
  const tid = id(req);
  const status = String((req.body || {}).status || '').toLowerCase();
  const t = await engine.getTournament(tid);
  if (!t) throw Object.assign(new Error('Tournament not found'), { status: 404 });
  if (status === 'active') {
    if (t.status === 'upcoming') await engine.startTournament(io(req), tid, req.user.id);
    else if (t.status === 'paused') await engine.resumeTournament(io(req), tid, req.user.id);
    else throw Object.assign(new Error(`Tournament is already ${t.status}`), { status: 409 });
  } else if (status === 'paused') await engine.pauseTournament(io(req), tid, req.user.id);
  else if (status === 'completed') await engine.endTournament(io(req), tid, req.user.id);
  else if (status === 'cancelled') await engine.cancelTournament(io(req), tid, req.user.id);
  else throw Object.assign(new Error('Status must be active, paused, completed or cancelled'), { status: 400 });
  res.json(await engine.getDetail(tid, req.user.id));
});

exports.generatePairings = h(async (req, res) => {
  const tid = id(req);
  await engine.nextRound(io(req), tid, req.user.id);
  res.json(await engine.getDetail(tid, req.user.id));
});

/* ── players ──────────────────────────────────────────────────────────────── */

exports.studentPool = h(async (req, res) => {
  const r = await db.query(
    `SELECT u.id, u.name, COALESCE(s.current_rating, 1000)::int AS rating, g.name AS group_name
       FROM users u
       JOIN students s ON s.user_id = u.id
       LEFT JOIN groups g ON g.id = s.group_id
      WHERE u.role = 'student' AND COALESCE(s.active, TRUE) = TRUE
      ORDER BY u.name`);
  res.json({ students: r.rows });
});

exports.addPlayers = h(async (req, res) => {
  const tid = id(req);
  const ids = ((req.body || {}).studentIds || (req.body || {}).student_ids || []).map(Number).filter(Boolean);
  if (!ids.length) throw Object.assign(new Error('Choose at least one student'), { status: 400 });
  const out = await engine.addPlayers(io(req), tid, ids, { actor: req.user.id });
  res.json({ ...out, ...(await engine.getDetail(tid, req.user.id)) });
});

exports.removePlayer = h(async (req, res) => {
  const tid = id(req);
  await engine.removePlayer(io(req), tid, id(req, 'userId'), {
    disqualify: req.query.disqualify === '1' || req.query.disqualify === 'true', actor: req.user.id });
  res.json(await engine.getDetail(tid, req.user.id));
});

exports.join = h(async (req, res) => {
  const tid = id(req);
  const out = await engine.addPlayers(io(req), tid, [req.user.id], { self: true });
  if (!out.added.length) {
    const mine = (await engine.getPlayers(tid)).find((p) => p.id === req.user.id);
    if (!mine || mine.reg_status !== 'active') {
      throw Object.assign(new Error('Could not join this tournament'), { status: 409 });
    }
  }
  res.json(await engine.getDetail(tid, req.user.id));
});

exports.leave = h(async (req, res) => {
  const tid = id(req);
  await engine.removePlayer(io(req), tid, req.user.id);
  res.json(await engine.getDetail(tid, req.user.id));
});

exports.arenaPause = h(async (req, res) => {
  res.json(await engine.setArenaPaused(io(req), id(req), req.user.id, true));
});

exports.arenaResume = h(async (req, res) => {
  res.json(await engine.setArenaPaused(io(req), id(req), req.user.id, false));
});

/* ── results ──────────────────────────────────────────────────────────────── */

/* POST /pairings/:pairingId/result  or  /:id/pairings/:pairingId/result
   body { result: 'white' | 'black' | 'draw' | 'abandon' | null }  (null = revert) */
exports.setResult = h(async (req, res) => {
  const pairingId = id(req, 'pairingId');
  let tid = req.params.id ? id(req) : null;
  if (!tid) {
    const r = await db.query('SELECT tournament_id FROM tournament_pairings WHERE id=$1', [pairingId]);
    if (!r.rows.length) throw Object.assign(new Error('Pairing not found'), { status: 404 });
    tid = Number(r.rows[0].tournament_id);
  }
  const body = req.body || {};
  if (!('result' in body)) throw Object.assign(new Error('result is required (use null to revert)'), { status: 400 });
  await engine.setPairingResult(io(req), tid, pairingId, body.result, req.user.id);
  res.json(await engine.getDetail(tid, req.user.id));
});

/* POST /:id/manual-pairing  { whiteId, blackId }  (blackId null/omitted = bye) */
exports.manualPairing = h(async (req, res) => {
  const tid = id(req);
  const { whiteId, blackId } = req.body || {};
  await engine.createManualPairing(io(req), tid, whiteId, blackId, req.user.id);
  res.json(await engine.getDetail(tid, req.user.id));
});

exports.audit = h(async (req, res) => {
  res.json({ audit: await engine.getAudit(id(req)) });
});

/* ── live games ───────────────────────────────────────────────────────────── */

exports.getGame = h(async (req, res) => {
  const G = await GS.loadGame(id(req, 'gameId'));
  if (!G) throw Object.assign(new Error('Game not found'), { status: 404 });
  if (!(await GS.canView(req.user, G))) {
    throw Object.assign(new Error('Finish your own game before watching other boards'), { status: 403 });
  }
  const t = await engine.getTournament(G.tournamentId);
  res.json({ game: GS.publicState(G), tournament: t ? engine.shapeTournament(t) : null, myColor: GS.colorOf(G, req.user.id) });
});

exports.move = h(async (req, res) => {
  const { from, to, promotion } = req.body || {};
  res.json({ game: await GS.move(id(req, 'gameId'), req.user.id, { from, to, promotion }) });
});

exports.resign = h(async (req, res) => {
  res.json({ game: await GS.resign(id(req, 'gameId'), req.user.id) });
});

exports.offerDraw = h(async (req, res) => {
  res.json({ game: await GS.offerDraw(id(req, 'gameId'), req.user.id) });
});

exports.respondDraw = h(async (req, res) => {
  res.json({ game: await GS.respondDraw(id(req, 'gameId'), req.user.id, !!(req.body || {}).accept) });
});

exports.berserk = h(async (req, res) => {
  res.json({ game: await GS.berserk(id(req, 'gameId'), req.user.id) });
});
