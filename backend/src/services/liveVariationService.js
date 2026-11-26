const { Chess } = require('chess.js');

/* Shared classroom variation tree.
 *
 * The class game itself stays where it has always lived: `chess_game_states`
 * holds the authoritative PGN/FEN and `chess.js` in the socket cache is the
 * single game instance. Variations are a SEPARATE, additive layer: every node
 * here hangs off a positional mainline id (`root`, `m1…mN`) or off another
 * variation node, and nothing in this module ever rewrites the class line.
 *
 * The stored shape is exactly what the frontend `serializeTree` writes, so a
 * browser can hydrate it with the same `hydrateTree`/`mergeMainline` helpers it
 * uses for Game Review — one model, no drift between the two surfaces. */

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const MAINLINE_RE = /^m([1-9]\d*)$/;

const startFenOf = (fen) => (fen && fen !== 'start' ? fen : START_FEN);
const isMainlineId = (id) => MAINLINE_RE.test(String(id || ''));

function emptyVariation() {
  return { v: 1, seq: 0, pointer: null, promotedId: null, nodes: [] };
}

/* Normalizes whatever came out of JSONB (or a socket) into the stored shape.
   Bad rows are dropped rather than trusted; a corrupt tree must never take the
   classroom board down with it. */
function normalizeVariation(raw) {
  let src = raw;
  if (typeof src === 'string') {
    try { src = JSON.parse(src); } catch { src = null; }
  }
  const empty = emptyVariation();
  if (!src || typeof src !== 'object') return empty;
  const nodes = Array.isArray(src.nodes)
    ? src.nodes.filter((n) => n
      && typeof n.id === 'string'
      && typeof n.parentId === 'string'
      && typeof n.san === 'string'
      && typeof n.fen === 'string'
      && Number.isFinite(Number(n.ply)))
      .map((n) => ({
        id: n.id,
        parentId: n.parentId,
        san: n.san,
        uci: typeof n.uci === 'string' ? n.uci : null,
        fen: n.fen,
        ply: Number(n.ply),
        piece: n.piece || null,
        color: n.color || null,
        captured: n.captured || null,
        flags: n.flags || '',
        row: n.row || null,
      }))
    : [];
  return {
    v: 1,
    seq: Number(src.seq) || nodes.length,
    pointer: typeof src.pointer === 'string' && src.pointer ? src.pointer : null,
    promotedId: null,
    nodes,
  };
}

function nodeById(state, id) {
  if (!state || !id) return null;
  return state.nodes.find((n) => n.id === id) || null;
}

function historyOf(chess) {
  try { return chess.history({ verbose: true }); } catch { return []; }
}

/* The FEN after `ply` plies of the authoritative class game. Replayed from the
   position the game was loaded from, so a set-up FEN class behaves the same. */
function fenAtPly(baseFen, history, ply) {
  const g = new Chess(startFenOf(baseFen));
  const n = Math.max(0, Math.min(history.length, Number(ply) || 0));
  for (let i = 0; i < n; i += 1) {
    try {
      g.move({ from: history[i].from, to: history[i].to, promotion: history[i].promotion || 'q' });
    } catch {
      return null;
    }
  }
  return g.fen();
}

/* Resolves a tree id to the position it stands for. Mainline ids are
   positional, so they are only valid while the class game is that long. */
function resolvePosition(state, chess, baseFen, id) {
  const history = historyOf(chess);
  if (!id || id === 'root') {
    return { id: 'root', fen: startFenOf(baseFen), ply: 0 };
  }
  const m = MAINLINE_RE.exec(String(id));
  if (m) {
    const ply = Number(m[1]);
    if (ply > history.length) return null;
    const fen = fenAtPly(baseFen, history, ply);
    return fen ? { id: String(id), fen, ply } : null;
  }
  const node = nodeById(state, id);
  if (!node) return null;
  return { id: node.id, fen: node.fen, ply: node.ply };
}

/* The SAN a position's existing children already carry: the mainline's next
   move (when there is one) plus every variation node hanging off the id. */
function existingChild(state, chess, baseFen, atId, san) {
  const history = historyOf(chess);
  let mainlineChildPly = null;
  if (!atId || atId === 'root') mainlineChildPly = history.length > 0 ? 1 : null;
  else {
    const m = MAINLINE_RE.exec(String(atId));
    if (m) {
      const ply = Number(m[1]);
      if (ply < history.length) mainlineChildPly = ply + 1;
    }
  }
  if (mainlineChildPly != null) {
    const mv = history[mainlineChildPly - 1];
    if (mv && mv.san === san) return { id: `m${mainlineChildPly}` };
  }
  const child = state.nodes.find((n) => n.parentId === (atId || 'root') && n.san === san);
  return child ? { id: child.id } : null;
}

/* Plays one move at `atId`. A move that already exists is a NAVIGATION to that
   node; any other legal move becomes a new variation. The class mainline is
   never touched, so a branch can never erase the original lesson line. */
function playVariationMove(state, atId, move, { chess, baseFen }) {
  const pos = resolvePosition(state, chess, baseFen, atId);
  if (!pos) return { ok: false, error: 'That position is no longer on the board' };
  if (!move || !move.from || !move.to) return { ok: false, error: 'from and to required' };

  const g = new Chess(pos.fen);
  let mv = null;
  try {
    mv = g.move({ from: move.from, to: move.to, promotion: move.promotion || 'q' });
  } catch {
    mv = null;
  }
  if (!mv) return { ok: false, error: 'Illegal move' };

  const existing = existingChild(state, chess, baseFen, pos.id, mv.san);
  if (existing) return { ok: true, created: false, navigateTo: existing.id };

  const seq = (Number(state.seq) || 0) + 1;
  const node = {
    id: `v${seq}`,
    parentId: pos.id,
    san: mv.san,
    uci: `${mv.from}${mv.to}${mv.promotion || ''}`,
    fen: g.fen(),
    ply: pos.ply + 1,
    piece: mv.piece || null,
    color: mv.color || null,
    captured: mv.captured || null,
    flags: mv.flags || '',
    row: null,
  };
  return {
    ok: true,
    created: true,
    node,
    next: { ...state, seq, nodes: [...state.nodes, node] },
  };
}

/* Pointer / mode are room-wide (the coach leads the room). */
function withPointer(state, pointer) {
  return { ...state, pointer: pointer || null };
}

function isPointerValid(state, chess, baseFen, pointer) {
  if (!pointer) return true;
  return resolvePosition(state, chess, baseFen, pointer) != null;
}

/* Everything a client needs to rebuild the classroom tree; the frontend feeds
   `nodes` straight into `hydrateTree`. */
function toClientState(state, rev, mode) {
  return {
    v: 1,
    seq: Number(state.seq) || 0,
    pointer: state.pointer || null,
    mode: mode === 'free' ? 'free' : 'follow',
    nodes: state.nodes,
    rev: Number(rev) || 0,
  };
}

module.exports = {
  START_FEN,
  emptyVariation,
  normalizeVariation,
  resolvePosition,
  playVariationMove,
  withPointer,
  isPointerValid,
  toClientState,
  isMainlineId,
  nodeById,
};
