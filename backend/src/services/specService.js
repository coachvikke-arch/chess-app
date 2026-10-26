/* ── Live (watchable) chess sessions ─────────────────────────────────────
   In-memory registry for COMPUTER-vs-student games, which run entirely in the
   student's browser and therefore must be announced on the socket so coaches
   (and other players) can spectate them live.

   Player-vs-player online matches live in `online_games` (server-authoritative)
   and are merged into the same "live games" list by the online controller.

   Sessions are ephemeral: they only exist while the game is active and the
   registering socket is connected. The spectator payload shape is shared with
   the online matches so one SpectatorBoard component can render both.        */

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const sessions = new Map();

function register(session) {
  if (!session || !session.key) return null;
  const now = Date.now();
  const prev = sessions.get(session.key) || null;
  const next = {
    type: 'computer',
    key: session.key,
    ownerUserId: session.ownerUserId ?? null,
    whiteId: session.whiteId ?? (session.ownerUserId ?? null),
    blackId: session.blackId ?? null,
    whiteName: session.whiteName || 'Player',
    blackName: session.blackName || 'Computer',
    fen: session.fen || START_FEN,
    pgn: session.pgn || '',
    whiteMs: Number(session.whiteMs) || 0,
    blackMs: Number(session.blackMs) || 0,
    turn: session.turn === 'black' ? 'black' : 'white',
    status: session.status === 'finished' ? 'finished' : 'active',
    result: session.result || null,
    level: session.level || null,
    baseMinutes: Number(session.baseMinutes) || 5,
    incrementSeconds: Number(session.incrementSeconds) || 0,
    startedAt: prev ? prev.startedAt : now,
    serverNow: now,
    updatedAt: now,
    updatedMs: now,
  };
  sessions.set(session.key, next);
  return next;
}

function update(key, patch) {
  const cur = sessions.get(key);
  if (!cur) return null;
  if (patch == null) return cur;
  if (patch.fen != null) cur.fen = patch.fen;
  if (patch.pgn != null) cur.pgn = patch.pgn;
  if (patch.whiteMs != null) cur.whiteMs = Math.max(0, Number(patch.whiteMs) || 0);
  if (patch.blackMs != null) cur.blackMs = Math.max(0, Number(patch.blackMs) || 0);
  if (patch.turn != null) cur.turn = patch.turn === 'black' ? 'black' : 'white';
  if (patch.status != null) cur.status = patch.status;
  if (patch.result != null) cur.result = patch.result;
  const now = Date.now();
  cur.serverNow = now;
  cur.updatedAt = now;
  cur.updatedMs = now;
  return cur;
}

function get(key) {
  return sessions.get(key) || null;
}

function remove(key) {
  sessions.delete(key);
}

function removeWhereOwner(userId) {
  const keys = [];
  for (const [key, s] of sessions.entries()) {
    if (s.ownerUserId === userId) keys.push(key);
  }
  for (const k of keys) sessions.delete(k);
  return keys;
}

function list() {
  const out = [];
  for (const s of sessions.values()) out.push({ ...s });
  return out;
}

module.exports = { register, update, get, remove, removeWhereOwner, list };