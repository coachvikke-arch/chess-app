'use strict';

/**
 * Tournament engine - the DB-facing orchestration layer.
 *
 *   pure rules (pairing, scoring, standings)  -> tournamentLogic.js
 *   live boards (moves, clocks, forfeits)     -> tournamentGameService.js
 *   this file: start / rounds / tick / finish -> everything that touches the
 *   tournaments, tournament_registrations and tournament_pairings tables.
 *
 * Statuses: upcoming -> active <-> paused -> completed   (or cancelled)
 * Formats : swiss | arena | knockout
 *
 * roundProgressionService drives tickTournament()/enforceGames() from a durable
 * outbox plus a 3s scheduler, so a finished game advances the tournament even
 * if no browser is open.
 */

const db = require('../config/database');
const L = require('./tournamentLogic');
const rt = require('./tournamentRealtime');
const GS = require('./tournamentGameService');
const notificationService = require('./notificationService');
const TR = require('./tournamentRatingService');
const cfg = require('../config/tournamentConfig');

const httpError = (status, message) => Object.assign(new Error(message), { status });
const num = (v) => (v == null ? null : Number(v));

/* ── transaction helper ───────────────────────────────────────────────────── */

/* Runs fn(client, after) in one transaction. Anything pushed onto `after` runs
   only once the transaction has COMMITTED (sockets, tracking new boards). */
async function tx(fn) {
  const client = await db.pool.connect();
  const after = [];
  try {
    await client.query('BEGIN');
    const out = await fn(client, after);
    await client.query('COMMIT');
    for (const f of after) {
      try { await f(); } catch (e) { console.error('[tournament] post-commit', e.message); }
    }
    return out;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

/* ── reads ────────────────────────────────────────────────────────────────── */

const PLAYER_SQL = `
  SELECT u.id, u.name, COALESCE(s.current_rating, 1000)::int AS rating,
         tr.seed, tr.status AS reg_status, tr.paused
    FROM tournament_registrations tr
    JOIN users u ON u.id = tr.student_id
    LEFT JOIN students s ON s.user_id = u.id
   WHERE tr.tournament_id = $1`;

async function getTournament(id, q = db) {
  const r = await q.query('SELECT * FROM tournaments WHERE id = $1', [id]);
  return r.rows[0] || null;
}

async function getPlayers(id, { active = false } = {}, q = db) {
  const r = await q.query(`${PLAYER_SQL}${active ? " AND tr.status = 'active'" : ''} ORDER BY tr.joined_at, u.id`, [id]);
  return r.rows.map((p) => ({ ...p, id: Number(p.id), seed: num(p.seed) }));
}

async function getPairings(id, q = db) {
  const r = await q.query(
    'SELECT * FROM tournament_pairings WHERE tournament_id = $1 ORDER BY round_no, board_no NULLS LAST, id', [id]);
  return r.rows.map((p) => ({
    ...p,
    id: Number(p.id),
    white_player: num(p.white_player),
    black_player: num(p.black_player),
    winner_player: num(p.winner_player),
    white_points: p.white_points == null ? null : Number(p.white_points),
    black_points: p.black_points == null ? null : Number(p.black_points),
  }));
}

function standingsOf(t, players, pairings) {
  return L.computeStandings(t.format, players, pairings, { totalRounds: t.format === 'knockout' ? t.rounds : null });
}

async function getStandings(id, q = db) {
  const t = await getTournament(id, q);
  if (!t) throw httpError(404, 'Tournament not found');
  return standingsOf(t, await getPlayers(id, {}, q), await getPairings(id, q));
}

/* ── notifications ────────────────────────────────────────────────────────── */

async function notify(io, userIds, title, message, tournamentId) {
  for (const uid of [...new Set(userIds.filter(Boolean))]) {
    try {
      await notificationService.push(io, uid, title, message, { type: 'tournament', relatedId: tournamentId });
    } catch (_) { /* notifications never break a tournament */ }
  }
}

/* Best-effort audit trail: who did what, with before/after details. */
async function audit(tournamentId, actorId, action, details = {}) {
  try {
    await db.query(
      'INSERT INTO tournament_audit (tournament_id, actor_id, action, details) VALUES ($1,$2,$3,$4)',
      [tournamentId, actorId || null, action, JSON.stringify(details)]);
  } catch (err) { console.warn('[tournament] audit', err.message); }
}

async function getAudit(id) {
  const r = await db.query(
    `SELECT a.id, a.action, a.details, a.created_at, a.actor_id, u.name AS actor_name
       FROM tournament_audit a LEFT JOIN users u ON u.id = a.actor_id
      WHERE a.tournament_id = $1 ORDER BY a.id DESC LIMIT 200`, [id]);
  return r.rows.map((x) => ({
    id: Number(x.id), action: x.action, createdAt: x.created_at, actor: x.actor_name || null,
    details: typeof x.details === 'string' ? (() => { try { return JSON.parse(x.details); } catch (_) { return {}; } })() : (x.details || {}),
  }));
}

/* ── create / edit ────────────────────────────────────────────────────────── */

function cleanSettings(body, existing = {}) {
  const pick = (k, alt) => (body[k] !== undefined ? body[k] : body[alt] !== undefined ? body[alt] : existing[k]);
  const format = String(pick('format') || existing.format || 'swiss').toLowerCase();
  if (!L.FORMATS.includes(format)) throw httpError(400, 'Format must be swiss, arena or knockout');
  const name = String(pick('name') || '').trim();
  if (!name) throw httpError(400, 'Tournament name is required');
  const timeMinutes = Number(pick('time_minutes', 'timeMinutes') ?? 10);
  const incrementSeconds = Number(pick('increment_seconds', 'incrementSeconds') ?? 0);
  if (!(timeMinutes >= 1 && timeMinutes <= 180)) throw httpError(400, 'Time control must be between 1 and 180 minutes');
  if (!(incrementSeconds >= 0 && incrementSeconds <= 180)) throw httpError(400, 'Increment must be between 0 and 180 seconds');
  const rounds = pick('rounds') == null || pick('rounds') === '' ? null : Number(pick('rounds'));
  if (format === 'swiss' && rounds != null && !(rounds >= 1 && rounds <= 30)) throw httpError(400, 'Rounds must be between 1 and 30');
  const duration = pick('duration_minutes', 'durationMinutes') == null || pick('duration_minutes', 'durationMinutes') === ''
    ? null : Number(pick('duration_minutes', 'durationMinutes'));
  if (format === 'arena' && !(duration >= 5 && duration <= 720)) throw httpError(400, 'Arena duration must be between 5 and 720 minutes');
  const maxPlayers = pick('max_players', 'maxPlayers') == null || pick('max_players', 'maxPlayers') === ''
    ? null : Number(pick('max_players', 'maxPlayers'));
  if (maxPlayers != null && !(maxPlayers >= 2 && maxPlayers <= 500)) throw httpError(400, 'Max players must be between 2 and 500');
  const startRaw = pick('start_time', 'startTime');
  const startTime = startRaw ? new Date(startRaw) : null;
  if (startTime && Number.isNaN(startTime.getTime())) throw httpError(400, 'Invalid start time');
  const bool = (k, alt, d) => { const v = pick(k, alt); return v === undefined || v === null ? d : !!v; };
  const noShow = pick('no_show_seconds', 'noShowSeconds');
  return {
    name,
    description: pick('description') ? String(pick('description')).slice(0, 2000) : null,
    format,
    time_minutes: Math.round(timeMinutes),
    increment_seconds: Math.round(incrementSeconds),
    rounds: format === 'swiss' ? rounds : null,
    duration_minutes: format === 'arena' ? Math.round(duration) : null,
    max_players: maxPlayers,
    start_time: startTime,
    allow_berserk: format === 'arena' ? bool('allow_berserk', 'allowBerserk', true) : false,
    allow_draw_offers: bool('allow_draw_offers', 'allowDrawOffers', true),
    auto_advance: bool('auto_advance', 'autoAdvance', true),
    self_register: bool('self_register', 'selfRegister', true),
    auto_start: bool('auto_start', 'autoStart', false),
    no_show_seconds: noShow == null || noShow === '' ? null : Math.min(3600, Math.max(15, Number(noShow))),
    pairing_mode: String(pick('pairing_mode', 'pairingMode') || 'auto').toLowerCase() === 'manual' ? 'manual' : 'auto',
    transition_seconds: (() => {
      const v = pick('transition_seconds', 'transitionSeconds');
      return v == null || v === '' ? null : Math.min(600, Math.max(0, Math.round(Number(v)) || 0));
    })(),
  };
}

async function createTournament(io, body, actor) {
  const s = cleanSettings(body);
  const invited = [...new Set((body.invitedStudentIds || body.invited_student_ids || []).map(Number).filter(Boolean))];
  const t = await tx(async (client) => {
    const r = await client.query(
      `INSERT INTO tournaments
        (name, description, format, status, time_minutes, increment_seconds, rounds, start_time,
         duration_minutes, max_players, allow_berserk, allow_draw_offers, auto_advance, self_register,
         auto_start, no_show_seconds, created_by, pairing_mode, transition_seconds)
       VALUES ($1,$2,$3,'upcoming',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
      [s.name, s.description, s.format, s.time_minutes, s.increment_seconds, s.rounds, s.start_time,
        s.duration_minutes, s.max_players, s.allow_berserk, s.allow_draw_offers, s.auto_advance,
        s.self_register, s.auto_start, s.no_show_seconds, actor && actor.id, s.pairing_mode, s.transition_seconds]
    );
    const row = r.rows[0];
    if (invited.length) await addPlayersTx(client, row, invited);
    return row;
  });
  if (invited.length) {
    await notify(io, invited, 'Tournament invitation',
      `You were added to the tournament "${t.name}".`, t.id);
  }
  await audit(t.id, actor && actor.id, 'created', { name: t.name, format: t.format, invited: invited.length });
  rt.emitTournament(io, t.id, 'tournament.created', {});
  return t;
}

async function updateTournament(io, id, body, actor = null) {
  const t = await getTournament(id);
  if (!t) throw httpError(404, 'Tournament not found');
  if (t.status !== 'upcoming') throw httpError(409, 'Only an upcoming tournament can be edited');
  const s = cleanSettings(body, t);
  const r = await db.query(
    `UPDATE tournaments SET name=$2, description=$3, format=$4, time_minutes=$5, increment_seconds=$6,
       rounds=$7, start_time=$8, duration_minutes=$9, max_players=$10, allow_berserk=$11,
       allow_draw_offers=$12, auto_advance=$13, self_register=$14, auto_start=$15, no_show_seconds=$16,
       pairing_mode=$17, transition_seconds=$18, updated_at=NOW() WHERE id=$1 RETURNING *`,
    [id, s.name, s.description, s.format, s.time_minutes, s.increment_seconds, s.rounds, s.start_time,
      s.duration_minutes, s.max_players, s.allow_berserk, s.allow_draw_offers, s.auto_advance,
      s.self_register, s.auto_start, s.no_show_seconds, s.pairing_mode, s.transition_seconds]
  );
  await audit(id, actor, 'updated', { name: s.name });
  rt.emitTournament(io, id, 'tournament.updated', {});
  return r.rows[0];
}

async function deleteTournament(io, id, actor = null) {
  const t = await getTournament(id);
  if (!t) throw httpError(404, 'Tournament not found');
  if (['active', 'paused'].includes(t.status)) throw httpError(409, 'End or cancel a running tournament before deleting it');
  await db.query('DELETE FROM tournaments WHERE id = $1', [id]);
  console.log(`[tournament] ${id} deleted by user ${actor}`);
  rt.emitTournament(io, id, 'tournament.deleted', {});
  return { ok: true };
}

/* ── players ──────────────────────────────────────────────────────────────── */

async function addPlayersTx(client, t, studentUserIds) {
  const valid = await client.query(
    "SELECT id FROM users WHERE id = ANY($1) AND role = 'student'", [studentUserIds]);
  const ids = valid.rows.map((r) => Number(r.id));
  const current = (await client.query(
    "SELECT COUNT(*)::int AS c FROM tournament_registrations WHERE tournament_id=$1 AND status='active'", [t.id])).rows[0].c;
  let room = t.max_players ? t.max_players - current : Infinity;
  const added = [];
  for (const sid of ids) {
    if (room <= 0) break;
    const r = await client.query(
      `INSERT INTO tournament_registrations (tournament_id, student_id, status)
       VALUES ($1,$2,'active')
       ON CONFLICT (tournament_id, student_id)
       DO UPDATE SET status='active', paused=FALSE
          WHERE tournament_registrations.status <> 'active'
       RETURNING student_id`, [t.id, sid]);
    if (r.rows.length) { added.push(sid); room -= 1; }
  }
  return added;
}

async function addPlayers(io, tournamentId, studentUserIds, { self = false, actor = null } = {}) {
  const t = await getTournament(tournamentId);
  if (!t) throw httpError(404, 'Tournament not found');
  if (['completed', 'cancelled'].includes(t.status)) throw httpError(409, 'This tournament is over');
  /* Late entry: only an arena accepts players after the start. */
  if (t.status !== 'upcoming' && t.format !== 'arena') {
    throw httpError(409, 'Registration is closed - this tournament has already started');
  }
  if (self && !t.self_register) throw httpError(403, 'Registration is by invitation only');
  const added = await tx((client) => addPlayersTx(client, t, studentUserIds.map(Number)));
  if (!added.length && self) {
    const full = t.max_players && (await getPlayers(tournamentId, { active: true })).length >= t.max_players;
    if (full) throw httpError(409, 'This tournament is full');
  }
  if (!self && added.length) {
    await audit(tournamentId, actor, 'players_added', { added });
    await notify(io, added, 'Tournament invitation', `You were added to the tournament "${t.name}".`, t.id);
  }
  rt.emitTournament(io, tournamentId, 'tournament.players', {});
  return { added };
}

async function removePlayer(io, tournamentId, userId, { disqualify = false, actor = null } = {}) {
  const t = await getTournament(tournamentId);
  if (!t) throw httpError(404, 'Tournament not found');
  if (['completed', 'cancelled'].includes(t.status)) throw httpError(409, 'This tournament is over');
  if (t.status === 'upcoming') {
    await db.query('DELETE FROM tournament_registrations WHERE tournament_id=$1 AND student_id=$2', [tournamentId, userId]);
  } else {
    await db.query(
      'UPDATE tournament_registrations SET status=$3 WHERE tournament_id=$1 AND student_id=$2',
      [tournamentId, userId, disqualify ? 'disqualified' : 'withdrawn']);
    await audit(tournamentId, actor, disqualify ? 'player_disqualified' : 'player_withdrawn', { userId: Number(userId) });
    /* Their unfinished board is forfeited: the opponent is awarded the win. */
    const live = await db.query(
      `SELECT id, white_player, black_player FROM tournament_games
        WHERE tournament_id=$1 AND status IN ('pending','active') AND (white_player=$2 OR black_player=$2)`,
      [tournamentId, userId]);
    for (const g of live.rows) {
      const whiteLeft = Number(g.white_player) === Number(userId);
      if (t.format === 'arena') await GS.adminFinish(g.id, { result: 'abandon', reason: 'forfeit' });
      else {
        await GS.adminFinish(g.id, {
          result: whiteLeft ? 'black' : 'white', reason: 'forfeit',
          winnerId: whiteLeft ? g.black_player : g.white_player,
        });
      }
    }
  }
  rt.emitTournament(io, tournamentId, 'tournament.players', {});
  return { ok: true };
}

async function setArenaPaused(io, tournamentId, userId, paused) {
  const r = await db.query(
    "UPDATE tournament_registrations SET paused=$3 WHERE tournament_id=$1 AND student_id=$2 AND status='active' RETURNING paused",
    [tournamentId, userId, !!paused]);
  if (!r.rows.length) throw httpError(404, 'You are not playing in this tournament');
  rt.emitTournament(io, tournamentId, 'tournament.players', {});
  return { paused: r.rows[0].paused };
}

/* ── creating rounds ──────────────────────────────────────────────────────── */

/* Inserts the pairing rows for a round and a board (game row) for each real
   game. Byes are decided on the spot. Must run inside a transaction. */
async function insertRound(client, t, roundNo, pairs, after) {
  const gameIds = [];
  const involved = [];
  for (const [i, p] of pairs.entries()) {
    const board = p.board || i + 1;
    if (p.bye) {
      await client.query(
        `INSERT INTO tournament_pairings
           (tournament_id, round_no, board_no, white_player, black_player, bye, result, reason,
            winner_player, white_points, black_points, finished_at)
         VALUES ($1,$2,$3,$4,NULL,TRUE,'bye','bye',$4,$5,0,NOW())`,
        [t.id, roundNo, board, p.white, L.SWISS_POINTS.bye]);
      involved.push(p.white);
      continue;
    }
    const r = await client.query(
      `INSERT INTO tournament_pairings (tournament_id, round_no, board_no, white_player, black_player, bye)
       VALUES ($1,$2,$3,$4,$5,FALSE) RETURNING *`,
      [t.id, roundNo, board, p.white, p.black]);
    const pairing = r.rows[0];
    const game = await GS.createGameRow(client, { tournament: t, pairing, white: p.white, black: p.black });
    await client.query('UPDATE tournament_pairings SET game_id=$2 WHERE id=$1', [pairing.id, game.id]);
    gameIds.push(game.id);
    involved.push(p.white, p.black);
  }
  await client.query('UPDATE tournaments SET current_round=$2, updated_at=NOW() WHERE id=$1', [t.id, roundNo]);
  after.push(async () => { for (const id of gameIds) await GS.track(id); });
  return { gameIds, involved };
}

async function createSwissRound(client, t, after, io) {
  const players = await getPlayers(t.id, { active: true }, client);
  if (players.length < 2) return { finished: true };
  const prev = await getPairings(t.id, client);
  const roundNo = t.current_round + 1;
  const { pairings, warnings } = L.pairSwissRound(players, prev, roundNo);
  const { involved } = await insertRound(client, t, roundNo, pairings, after);
  after.push(async () => {
    await notify(io, involved, `Round ${roundNo} is ready`, `Your board for "${t.name}" round ${roundNo} is ready - open it and play!`, t.id);
    rt.emitTournament(io, t.id, 'round.started', { roundNo, warnings });
  });
  return { roundNo, warnings };
}

async function createKnockoutRound(client, t, after, io) {
  const roundNo = t.current_round + 1;
  const prev = await getPairings(t.id, client);
  let pairs;
  if (roundNo === 1) {
    const players = await getPlayers(t.id, { active: true }, client);
    const first = L.pairKnockoutFirstRound(players);
    pairs = first.pairings;
    for (const s of first.seeds) {
      await client.query('UPDATE tournament_registrations SET seed=$3 WHERE tournament_id=$1 AND student_id=$2', [t.id, s.id, s.seed]);
    }
    await client.query('UPDATE tournaments SET rounds=$2 WHERE id=$1', [t.id, first.totalRounds]);
    t.rounds = first.totalRounds;
  } else {
    pairs = L.pairKnockoutNextRound(prev.filter((p) => p.round_no === roundNo - 1)).pairings;
  }
  const { involved } = await insertRound(client, t, roundNo, pairs, after);
  after.push(async () => {
    await notify(io, involved, `Round ${roundNo} is ready`, `Your knockout board for "${t.name}" is ready - win to advance!`, t.id);
    rt.emitTournament(io, t.id, 'round.started', { roundNo });
  });
  return { roundNo };
}

/* ── lifecycle ────────────────────────────────────────────────────────────── */

async function startTournament(io, id, actor = null) {
  return tx(async (client, after) => {
    const t = (await client.query('SELECT * FROM tournaments WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!t) throw httpError(404, 'Tournament not found');
    if (t.status !== 'upcoming') throw httpError(409, 'This tournament has already started');
    const players = await getPlayers(id, { active: true }, client);
    if (players.length < 2) throw httpError(400, 'At least 2 players are needed to start');

    let rounds = t.rounds;
    if (t.format === 'swiss') {
      const cap = L.maxSwissRounds(players.length);
      rounds = Math.min(rounds || L.defaultSwissRounds(players.length), cap);
    }
    const endTime = t.format === 'arena' ? new Date(Date.now() + t.duration_minutes * 60000) : null;
    const upd = await client.query(
      `UPDATE tournaments SET status='active', started_at=NOW(), rounds=$2, end_time=$3, current_round=0, updated_at=NOW()
        WHERE id=$1 RETURNING *`, [id, rounds, endTime]);
    const fresh = upd.rows[0];

    const manual = fresh.pairing_mode === 'manual';
    if (manual && fresh.format === 'knockout') {
      /* Manual knockout: seed the field and fix the round count; the coach pairs the boards. */
      const first = L.pairKnockoutFirstRound(players);
      for (const sd of first.seeds) {
        await client.query('UPDATE tournament_registrations SET seed=$3 WHERE tournament_id=$1 AND student_id=$2', [id, sd.id, sd.seed]);
      }
      await client.query('UPDATE tournaments SET rounds=$2 WHERE id=$1', [id, first.totalRounds]);
      fresh.rounds = first.totalRounds;
    } else if (!manual && fresh.format === 'swiss') await createSwissRound(client, fresh, after, io);
    else if (!manual && fresh.format === 'knockout') await createKnockoutRound(client, fresh, after, io);
    /* arena: boards are made by tickTournament as players show up; manual: the coach pairs boards */
    after.push(() => audit(id, actor, 'started', { players: players.length, pairingMode: fresh.pairing_mode }));

    after.push(async () => {
      await notify(io, players.map((p) => p.id), 'Tournament started',
        `"${fresh.name}" has started${fresh.format === 'arena' ? ' - open it to be paired.' : '.'}`, id);
      rt.emitTournament(io, id, 'tournament.started', {});
    });
    return fresh;
  });
}

async function pauseTournament(io, id, actor = null) {
  const r = await db.query(
    "UPDATE tournaments SET status='paused', paused_at=NOW(), updated_at=NOW() WHERE id=$1 AND status='active' RETURNING *", [id]);
  if (!r.rows.length) throw httpError(409, 'Only a running tournament can be paused');
  await audit(id, actor, 'paused');
  rt.emitTournament(io, id, 'tournament.updated', { status: 'paused' });
  return r.rows[0];
}

async function resumeTournament(io, id, actor = null) {
  const r = await db.query(
    `UPDATE tournaments SET status='active',
        end_time = CASE WHEN end_time IS NOT NULL AND paused_at IS NOT NULL
                        THEN end_time + (NOW() - paused_at) ELSE end_time END,
        paused_at=NULL, updated_at=NOW()
      WHERE id=$1 AND status='paused' RETURNING *`, [id]);
  if (!r.rows.length) throw httpError(409, 'Only a paused tournament can be resumed');
  await audit(id, actor, 'resumed');
  rt.emitTournament(io, id, 'tournament.updated', { status: 'active' });
  return r.rows[0];
}

/* Voids every unfinished board (no points for anyone) - used by cancel / end. */
async function voidLiveGames(id) {
  const live = await db.query(
    "SELECT id FROM tournament_games WHERE tournament_id=$1 AND status IN ('pending','active')", [id]);
  for (const g of live.rows) await GS.adminFinish(g.id, { result: 'abandon', reason: 'admin' });
}

async function cancelTournament(io, id, actor = null) {
  const t = await getTournament(id);
  if (!t) throw httpError(404, 'Tournament not found');
  if (['completed', 'cancelled'].includes(t.status)) throw httpError(409, 'This tournament is already over');
  await voidLiveGames(id);
  await db.query("UPDATE tournaments SET status='cancelled', updated_at=NOW() WHERE id=$1", [id]);
  await audit(id, actor, 'cancelled');
  const players = await getPlayers(id, { active: true });
  await notify(io, players.map((p) => p.id), 'Tournament cancelled', `"${t.name}" was cancelled.`, id);
  rt.emitTournament(io, id, 'tournament.updated', { status: 'cancelled' });
  return { ok: true };
}

async function endTournament(io, id, actor = null) {
  const t = await getTournament(id);
  if (!t) throw httpError(404, 'Tournament not found');
  if (!['active', 'paused'].includes(t.status)) throw httpError(409, 'Only a running tournament can be ended');
  await voidLiveGames(id);
  await audit(id, actor, 'ended_early');
  return tx(async (client, after) => {
    const fresh = (await client.query('SELECT * FROM tournaments WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!['active', 'paused'].includes(fresh.status)) return fresh;
    return completeTx(client, fresh, after, io);
  });
}

async function completeTx(client, t, after, io) {
  const standings = standingsOf(t, await getPlayers(t.id, {}, client), await getPairings(t.id, client));
  const played = standings.some((s) => s.games > 0 || s.byes > 0);
  const winner = played && standings.length ? standings[0].playerId : null;
  const r = await client.query(
    "UPDATE tournaments SET status='completed', completed_at=NOW(), winner_id=$2, paused_at=NULL, updated_at=NOW() WHERE id=$1 RETURNING *",
    [t.id, winner]);
  after.push(async () => {
    for (const s of standings) {
      await notify(io, [s.playerId], 'Tournament finished',
        `"${t.name}" is over - you finished #${s.rank} of ${standings.length} with ${s.score} point(s).`, t.id);
    }
    rt.emitTournament(io, t.id, 'tournament.completed', { winnerId: winner });
  });
  return r.rows[0];
}

/* ── the heartbeat ────────────────────────────────────────────────────────── */

/* Called by roundProgressionService (outbox) and the 3s scheduler. Safe to run
   concurrently: the tournament row is locked for the whole decision. */
async function tickTournament(id, io = null) {
  const ioRef = io || (global.__tournamentIo || null);
  return tx(async (client, after) => {
    const t = (await client.query('SELECT * FROM tournaments WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!t || t.status !== 'active') return { advanced: false, skipped: 'status' };
    const pairings = await getPairings(id, client);
    const unfinished = pairings.filter((p) => !p.result);

    if (t.format === 'arena') {
      const ended = t.end_time && new Date(t.end_time).getTime() <= Date.now();
      if (ended) {
        if (unfinished.length === 0) { await completeTx(client, t, after, ioRef); return { advanced: true, completed: true }; }
        return { advanced: false };
      }
      const online = new Set(rt.onlineUserIds(id));
      const busy = new Set();
      unfinished.forEach((p) => { busy.add(p.white_player); if (p.black_player) busy.add(p.black_player); });
      const players = (await getPlayers(id, { active: true }, client))
        .filter((p) => !p.paused && online.has(p.id) && !busy.has(p.id));
      if (players.length < 2) return { advanced: false };
      const { pairings: pairs } = L.pairArenaWave(players, pairings);
      if (!pairs.length) return { advanced: false };
      const roundNo = t.current_round + 1;
      const { involved } = await insertRound(client, t, roundNo, pairs, after);
      after.push(() => notify(ioRef, involved, 'Your game is ready', `You have a new board in "${t.name}" - go play!`, t.id));
      return { advanced: true };
    }

    /* swiss + knockout are round based */
    const manual = t.pairing_mode === 'manual';
    if (t.current_round === 0) {
      if (manual) return { advanced: false, waiting: 'manual' };
      if (t.format === 'swiss') await createSwissRound(client, t, after, ioRef);
      else await createKnockoutRound(client, t, after, ioRef);
      return { advanced: true };
    }
    const roundPairings = pairings.filter((p) => p.round_no === t.current_round);
    if (roundPairings.some((p) => !p.result)) return { advanced: false };

    if (t.format === 'swiss') {
      if (t.current_round >= (t.rounds || 0)) {
        await completeTx(client, t, after, ioRef);
        return { advanced: true, completed: true };
      }
      if (manual) return { advanced: false, waiting: 'manual' };
      if (!t.auto_advance) return { advanced: false, waiting: 'admin' };
      if (Date.now() < transitionEnd(t, roundPairings)) return { advanced: false, waiting: 'transition' };
      const out = await createSwissRound(client, t, after, ioRef);
      if (out.finished) { await completeTx(client, t, after, ioRef); return { advanced: true, completed: true }; }
      after.push(() => rt.emitTournament(ioRef, id, 'round.completed', {}));
      return { advanced: true };
    }

    /* knockout */
    if (t.current_round >= t.rounds) {
      await completeTx(client, t, after, ioRef);
      return { advanced: true, completed: true };
    }
    if (manual) return { advanced: false, waiting: 'manual' };
    if (Date.now() < transitionEnd(t, roundPairings)) return { advanced: false, waiting: 'transition' };
    await createKnockoutRound(client, t, after, ioRef);
    return { advanced: true };
  });
}

/* When the pause after a finished round is over (ms epoch). */
function transitionEnd(t, roundPairings) {
  const last = Math.max(0, ...roundPairings.map((p) => (p.finished_at ? new Date(p.finished_at).getTime() : 0)));
  const ms = t.transition_seconds != null ? Number(t.transition_seconds) * 1000 : cfg.ROUND_TRANSITION_MS;
  return last + ms;
}

/* Admin: start the next Swiss round now (when auto-advance is off). */
async function nextRound(io, id, actor = null) {
  await audit(id, actor, 'next_round_requested');
  const res = await tickTournament(id, io);
  if (res.waiting === 'admin') {
    return tx(async (client, after) => {
      const t = (await client.query('SELECT * FROM tournaments WHERE id=$1 FOR UPDATE', [id])).rows[0];
      await createSwissRound(client, t, after, io);
      return { advanced: true };
    });
  }
  if (!res.advanced) throw httpError(409, 'The current round is not finished yet');
  return res;
}

async function enforceGames(id) {
  await GS.enforceTournament(id);
}

/* ── manual pairing (coach pairs two eligible players) ───────────────────── */

/* blackId = null creates a bye for whiteId (Swiss / knockout only).
   Round rules: Arena always opens a new wave. Swiss / knockout add the board to
   the current round while it is still open, or open the next round once the
   current one is fully settled. */
async function createManualPairing(io, tournamentId, whiteId, blackId, actor = null) {
  const w = Number(whiteId);
  const b = blackId == null || blackId === '' ? null : Number(blackId);
  if (!Number.isInteger(w) || w <= 0 || (b !== null && (!Number.isInteger(b) || b <= 0))) throw httpError(400, 'Choose valid players');
  if (b !== null && w === b) throw httpError(400, 'A player cannot be paired with themselves');
  const out = await tx(async (client, after) => {
    const t = (await client.query('SELECT * FROM tournaments WHERE id=$1 FOR UPDATE', [tournamentId])).rows[0];
    if (!t) throw httpError(404, 'Tournament not found');
    if (t.status !== 'active') throw httpError(409, 'Manual pairings can only be made while the tournament is running');
    if (b === null && t.format === 'arena') throw httpError(400, 'An arena has no byes');
    const active = await getPlayers(tournamentId, { active: true }, client);
    const ids = new Set(active.map((p) => p.id));
    if (!ids.has(w) || (b !== null && !ids.has(b))) throw httpError(400, 'Both players must be active participants of this tournament');
    const pairings = await getPairings(tournamentId, client);
    const live = new Set();
    pairings.filter((p) => !p.result).forEach((p) => { live.add(p.white_player); if (p.black_player) live.add(p.black_player); });
    if (live.has(w) || (b !== null && live.has(b))) throw httpError(409, 'A selected player is still playing an unfinished board');

    let roundNo = t.current_round;
    if (t.format === 'arena') roundNo += 1;
    else {
      const cur = pairings.filter((p) => p.round_no === roundNo);
      if (roundNo === 0 || (cur.length && cur.every((p) => p.result))) {
        if (roundNo > 0 && roundNo >= (t.rounds || 0)) throw httpError(409, 'All rounds have already been played');
        roundNo += 1;
      }
    }
    const inRound = pairings.filter((p) => p.round_no === roundNo);
    if (inRound.some((p) => [p.white_player, p.black_player].some((x) => x === w || (b !== null && x === b)))) {
      throw httpError(409, 'A selected player already has a board in this round');
    }
    if (t.format === 'swiss' && b !== null) {
      const h = L.buildHistory(active, pairings);
      if (h.played.has(`${w}|${b}`)) throw httpError(409, 'These two players have already met in this tournament');
    }
    if (t.format === 'knockout' && roundNo > 1) {
      const winners = new Set(pairings.filter((p) => p.round_no === roundNo - 1).map((p) => L.winnerOf(p)));
      if (!winners.has(w) || (b !== null && !winners.has(b))) throw httpError(400, 'Only winners of the previous round can be paired');
    }
    const board = inRound.reduce((m, p) => Math.max(m, p.board_no || 0), 0) + 1;
    const { involved } = await insertRound(client, t, roundNo, [{ white: w, black: b, bye: b === null, board }], after);
    after.push(async () => {
      await notify(io, involved, 'Your board is ready', `You were paired in "${t.name}" - open it and play!`, t.id);
      rt.emitTournament(io, t.id, 'round.started', { roundNo, manual: true });
    });
    return { roundNo, board };
  });
  await audit(tournamentId, actor, b === null ? 'manual_bye' : 'manual_pairing', { white: w, black: b, ...out });
  try { await require('./roundProgressionService').enqueue(tournamentId, 'manual_pairing'); } catch (_) { /* scheduler covers it */ }
  return out;
}

/* ── a game finished -> decide its pairing ────────────────────────────────── */

async function onGameFinished(io, G) {
  /* Ratings commit in the SAME transaction as the pairing result. If the rating
     schema is unavailable we still finish the board (a tournament must not
     stall because of a rating-table problem); the game is simply left unrated
     and can be settled by an admin correction later. */
  let ratingReady = true;
  try {
    ratingReady = await TR.ensureSchema();
  } catch (err) {
    console.warn('[tournament] rating schema unavailable:', err.message);
    ratingReady = false;
  }

  const outcome = await tx(async (client, after) => {
    const pairing = (await client.query(
      'SELECT * FROM tournament_pairings WHERE id=$1 FOR UPDATE', [G.pairingId])).rows[0];
    if (!pairing || pairing.result) return null;                  // already decided (admin override etc.)
    const t = (await client.query('SELECT * FROM tournaments WHERE id=$1', [pairing.tournament_id])).rows[0];
    if (!t) return null;

    /* Knockout: a drawn board is settled by an Armageddon game, colours swapped. */
    if (t.format === 'knockout' && G.result === 'draw' && !G.armageddon) {
      /* The DRAWN game is the rated chess game. The tiebreak below is an
         Armageddon board and is deliberately not rated (a pairing must move a
         player's rating exactly once). */
      if (ratingReady) {
        await TR.settleFinishedGame(client, {
          game: { id: G.id }, tournament: t, result: G.result, after,
        });
      }
      const game = await GS.createGameRow(client, {
        tournament: t, pairing, white: Number(pairing.black_player), black: Number(pairing.white_player), armageddon: true });
      await client.query('UPDATE tournament_pairings SET game_id=$2 WHERE id=$1', [pairing.id, game.id]);
      after.push(async () => {
        await GS.track(game.id);
        await notify(io, [pairing.white_player, pairing.black_player], 'Armageddon decider',
          `The game was drawn - play the Armageddon decider (White 5 min, Black 4 min, Black wins a draw).`, t.id);
      });
      return { armageddon: true, tournamentId: t.id };
    }

    const wp = Number(pairing.white_player);
    let result = G.result;
    let winner = G.winnerId;
    if (t.format === 'knockout' && result === 'abandon') {
      const seeds = (await client.query(
        'SELECT student_id, seed FROM tournament_registrations WHERE tournament_id=$1 AND student_id = ANY($2)',
        [t.id, [pairing.white_player, pairing.black_player]])).rows;
      const sd = (id) => { const r = seeds.find((x) => Number(x.student_id) === Number(id)); return r && r.seed != null ? Number(r.seed) : 9999; };
      winner = sd(pairing.white_player) <= sd(pairing.black_player) ? Number(pairing.white_player) : Number(pairing.black_player);
      result = winner === wp ? 'white' : 'black';
    } else if (result === 'white' || result === 'black') {
      result = Number(winner) === wp ? 'white' : 'black';
    }

    /* Arena points depend on each player's current streak. */
    let whiteOnFire = false; let blackOnFire = false;
    if (t.format === 'arena') {
      const prev = (await getPairings(t.id, client)).filter((p) => p.result && p.id !== pairing.id);
      whiteOnFire = L.isOnFire(pairing.white_player, prev);
      blackOnFire = L.isOnFire(pairing.black_player, prev);
    }
    const whiteIsGameWhite = Number(G.white) === wp;
    const pts = L.scoreGame({
      format: t.format, result, plies: G.chess.history().length, whiteOnFire, blackOnFire,
      whiteBerserk: whiteIsGameWhite ? G.berserk.w : G.berserk.b,
      blackBerserk: whiteIsGameWhite ? G.berserk.b : G.berserk.w,
    });
    await client.query(
      `UPDATE tournament_pairings SET result=$2, reason=$3, winner_player=$4, white_points=$5, black_points=$6,
         white_berserk=$7, black_berserk=$8, finished_at=NOW()
       WHERE id=$1 AND result IS NULL`,
      [pairing.id, result, G.reason, result === 'white' || result === 'black' ? winner : null, pts.white, pts.black,
        whiteIsGameWhite ? G.berserk.w : G.berserk.b, whiteIsGameWhite ? G.berserk.b : G.berserk.w]);

    /* Rate the GAME's own result, not the pairing's mapped result: a knockout
       abandon is converted to a winner for the bracket but stays unrated. */
    if (ratingReady) {
      await TR.settleFinishedGame(client, {
        game: { id: G.id }, tournament: t, result: G.result, after,
      });
    }
    return { tournamentId: t.id, result, white: pairing.white_player, black: pairing.black_player, tname: t.name };
  });

  if (!outcome) return;
  if (!outcome.armageddon) {
    try {
      await require('./analysis/enqueueHooks').tournamentGameFinished({
        id: G.id, white_player: G.white, black_player: G.black, pgn: G.chess.pgn() });
    } catch (_) { /* analysis is optional */ }
    const label = outcome.result === 'draw' ? 'ended in a draw'
      : outcome.result === 'abandon' ? 'was voided' : `finished (${outcome.result === 'white' ? 'White' : 'Black'} won)`;
    await notify(io, [outcome.white, outcome.black], 'Game finished', `Your game in "${outcome.tname}" ${label}.`, outcome.tournamentId);
  }
  rt.emitTournament(io, outcome.tournamentId, 'pairing.result', { gameId: G.id });
  try { await require('./roundProgressionService').enqueue(outcome.tournamentId, 'game_finalized'); } catch (_) { /* worker picks up via scheduler */ }
}

/* ── admin result override ────────────────────────────────────────────────── */

async function setPairingResult(io, tournamentId, pairingId, result, actor = null) {
  const t = await getTournament(tournamentId);
  if (!t) throw httpError(404, 'Tournament not found');
  if (['completed', 'cancelled'].includes(t.status)) throw httpError(409, 'This tournament is over');
  const pairing = (await db.query('SELECT * FROM tournament_pairings WHERE id=$1 AND tournament_id=$2', [pairingId, tournamentId])).rows[0];
  if (!pairing) throw httpError(404, 'Pairing not found');
  if (pairing.bye) throw httpError(400, 'A bye cannot be changed');
  const later = await db.query(
    'SELECT 1 FROM tournament_pairings WHERE tournament_id=$1 AND round_no > $2 LIMIT 1', [tournamentId, pairing.round_no]);
  const valid = [null, 'white', 'black', 'draw', 'abandon'];
  if (!valid.includes(result)) throw httpError(400, "Result must be 'white', 'black', 'draw', 'abandon' or null (revert)");
  if (t.format === 'knockout' && (result === 'draw' || result === 'abandon')) {
    throw httpError(400, 'A knockout board needs a winner');
  }
  if (result !== null && pairing.result === result) {
    /* Idempotent: the same result submitted twice is a no-op. Reversing and
       re-applying here would let other games played in between change the
       delta, so "save" would silently move ratings. */
    return { ok: true, unchanged: true };
  }

  let ratingReady = true;
  try { ratingReady = await TR.ensureSchema(); } catch (err) {
    console.warn('[tournament] rating schema unavailable:', err.message);
    ratingReady = false;
  }

  const live = pairing.game_id ? (await db.query('SELECT id, status FROM tournament_games WHERE id=$1', [pairing.game_id])).rows[0] : null;
  await audit(tournamentId, actor, 'result_override', {
    pairingId: Number(pairingId), round: pairing.round_no, board: pairing.board_no,
    before: pairing.result || null, after: result,
  });

  if (result === null) {
    if (!pairing.result) throw httpError(409, 'This board has no result to revert');
    if (later.rows.length && t.format !== 'arena') throw httpError(409, 'Cannot revert: a later round has already been paired');
    await tx(async (client, after) => {
      await client.query(
        `UPDATE tournament_pairings SET result=NULL, reason=NULL, winner_player=NULL, white_points=NULL,
           black_points=NULL, finished_at=NULL WHERE id=$1`, [pairingId]);
      /* Undo the rating this result produced before the replacement board is
         created. The new board starts unrated and settles when it finishes. */
      if (ratingReady) await TR.revertPairingRating(client, pairingId);
      const game = await GS.createGameRow(client, { tournament: t, pairing, white: pairing.white_player, black: pairing.black_player });
      await client.query('UPDATE tournament_pairings SET game_id=$2 WHERE id=$1', [pairingId, game.id]);
      after.push(() => GS.track(game.id));
    });
  } else if (live && live.status !== 'finished') {
    /* A live board: end it; onGameFinished then scores the pairing normally. */
    const winnerId = result === 'white' ? pairing.white_player : result === 'black' ? pairing.black_player : null;
    await GS.adminFinish(live.id, { result, reason: 'admin', winnerId });
  } else {
    if (later.rows.length && t.format !== 'arena') throw httpError(409, 'Cannot change: a later round has already been paired');
    const pts = L.scoreGame({ format: t.format, result, plies: 99 });
    await tx(async (client, after) => {
      await client.query(
        `UPDATE tournament_pairings SET result=$2, reason='admin', winner_player=$3, white_points=$4, black_points=$5,
           finished_at=NOW() WHERE id=$1`,
        [pairingId, result, result === 'white' ? pairing.white_player : result === 'black' ? pairing.black_player : null,
          pts.white, pts.black]);
      /* Recalculate the rating in the same transaction as the correction. */
      if (ratingReady) {
        await TR.correctPairingRating(client, { pairingId, tournament: t, newResult: result, after });
      }
    });
  }
  rt.emitTournament(io, tournamentId, 'pairing.result', { pairingId });
  try { await require('./roundProgressionService').enqueue(tournamentId, 'admin_result'); } catch (_) { /* scheduler covers it */ }
  return { ok: true };
}

/* ── read models for the API ──────────────────────────────────────────────── */

async function getDetail(id, viewerId = null) {
  const t = await getTournament(id);
  if (!t) throw httpError(404, 'Tournament not found');
  const players = await getPlayers(id);
  const pairingsRaw = (await db.query(
    `SELECT p.*, g.status AS game_status, g.moves_count, g.armageddon
       FROM tournament_pairings p LEFT JOIN tournament_games g ON g.id = p.game_id
      WHERE p.tournament_id = $1 ORDER BY p.round_no, p.board_no NULLS LAST, p.id`, [id])).rows;
  const pairings = await getPairings(id);
  const standings = standingsOf(t, players, pairings);
  const nameOf = Object.fromEntries(players.map((p) => [p.id, p]));
  const who = (uid) => (uid ? { id: Number(uid), name: (nameOf[uid] || {}).name || 'Player', rating: (nameOf[uid] || {}).rating || 0 } : null);
  const rounds = {};
  for (const p of pairingsRaw) {
    (rounds[p.round_no] = rounds[p.round_no] || []).push({
      id: Number(p.id), board: p.board_no, white: who(num(p.white_player)), black: who(num(p.black_player)),
      bye: !!p.bye, result: p.result, reason: p.reason, winnerId: num(p.winner_player),
      whitePoints: p.white_points == null ? null : Number(p.white_points),
      blackPoints: p.black_points == null ? null : Number(p.black_points),
      whiteBerserk: !!p.white_berserk, blackBerserk: !!p.black_berserk,
      gameId: num(p.game_id), gameStatus: p.game_status || null, moves: Number(p.moves_count) || 0,
      armageddon: !!p.armageddon,
    });
  }
  let myGame = null;
  let myRegistration = null;
  if (viewerId) {
    const reg = players.find((p) => p.id === Number(viewerId));
    if (reg) myRegistration = { status: reg.reg_status, paused: !!reg.paused, seed: reg.seed };
    const g = (await db.query(
      `SELECT id, status, white_player FROM tournament_games
        WHERE tournament_id=$1 AND status IN ('pending','active') AND (white_player=$2 OR black_player=$2)
        ORDER BY id DESC LIMIT 1`, [id, viewerId])).rows[0];
    if (g) myGame = { gameId: Number(g.id), status: g.status, color: Number(g.white_player) === Number(viewerId) ? 'white' : 'black' };
  }
  let waiting = null;
  let nextRoundAt = null;
  if (t.status === 'active' && t.format !== 'arena') {
    const cur = pairings.filter((p) => p.round_no === t.current_round);
    const done = t.current_round === 0 || (cur.length > 0 && cur.every((p) => p.result));
    if (done && t.current_round < (t.rounds || 0)) {
      if (t.pairing_mode === 'manual') waiting = 'manual';
      else if (t.format === 'swiss' && !t.auto_advance) waiting = 'admin';
      else if (t.current_round > 0) { waiting = 'transition'; nextRoundAt = transitionEnd(t, cur); }
    }
  }
  return {
    tournament: shapeTournament(t, players),
    waiting,
    nextRoundAt,
    standings,
    rounds: Object.keys(rounds).map(Number).sort((a, b) => a - b).map((n) => ({ roundNo: n, pairings: rounds[n] })),
    players: players.map((p) => ({ id: p.id, name: p.name, rating: p.rating, status: p.reg_status, paused: !!p.paused, seed: p.seed })),
    myGame,
    myRegistration,
    serverTime: Date.now(),
  };
}

function shapeTournament(t, players = null) {
  return {
    id: Number(t.id), name: t.name, description: t.description, format: t.format, status: t.status,
    timeMinutes: t.time_minutes, incrementSeconds: t.increment_seconds, rounds: t.rounds,
    currentRound: t.current_round, startTime: t.start_time, endTime: t.end_time,
    durationMinutes: t.duration_minutes, maxPlayers: t.max_players, allowBerserk: t.allow_berserk,
    allowDrawOffers: t.allow_draw_offers, autoAdvance: t.auto_advance, selfRegister: t.self_register,
    autoStart: t.auto_start, noShowSeconds: t.no_show_seconds, pairingMode: t.pairing_mode || 'auto',
    transitionSeconds: t.transition_seconds == null ? null : Number(t.transition_seconds), winnerId: num(t.winner_id),
    startedAt: t.started_at, completedAt: t.completed_at, createdAt: t.created_at,
    playerCount: players ? players.filter((p) => p.reg_status === 'active').length : undefined,
  };
}

async function listTournaments(viewer) {
  const r = await db.query(
    `SELECT t.*,
       (SELECT COUNT(*)::int FROM tournament_registrations tr WHERE tr.tournament_id=t.id AND tr.status='active') AS player_count,
       (SELECT tr.status FROM tournament_registrations tr WHERE tr.tournament_id=t.id AND tr.student_id=$1) AS my_status,
       (SELECT u.name FROM users u WHERE u.id = t.winner_id) AS winner_name
     FROM tournaments t
     ORDER BY CASE t.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 WHEN 'upcoming' THEN 2 ELSE 3 END,
              COALESCE(t.start_time, t.created_at) DESC`, [viewer.id]);
  return r.rows.map((t) => ({
    ...shapeTournament(t), playerCount: t.player_count, myStatus: t.my_status, winnerName: t.winner_name,
  }));
}

async function getReport(id) {
  const detail = await getDetail(id);
  const t = detail.tournament;
  const games = (await db.query(
    `SELECT COUNT(*) FILTER (WHERE status='finished')::int AS finished, COALESCE(SUM(moves_count),0)::int AS moves
       FROM tournament_games WHERE tournament_id=$1`, [id])).rows[0];
  return {
    ...detail,
    summary: {
      name: t.name, format: t.format, status: t.status, players: detail.players.length,
      gamesPlayed: games.finished, totalMoves: games.moves,
      winner: detail.standings[0] && t.status === 'completed' ? detail.standings[0].name : null,
    },
  };
}

module.exports = {
  tx, getTournament, getPlayers, getPairings, getStandings, getDetail, getReport, listTournaments, shapeTournament,
  createTournament, updateTournament, deleteTournament,
  addPlayers, removePlayer, setArenaPaused,
  startTournament, pauseTournament, resumeTournament, cancelTournament, endTournament,
  tickTournament, nextRound, enforceGames, onGameFinished, setPairingResult,
  createManualPairing, getAudit,
};
