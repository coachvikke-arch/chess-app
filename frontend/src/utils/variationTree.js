import { Chess } from 'chess.js';

/* ──────────────────────────────────────────────────────────────────────────
 * PURE move-tree model — no React, no browser APIs, unit-testable.
 *
 * The original game is the mainline: `m1…mN` are rebuilt from its SAN and are
 * never edited, truncated or re-parented. A user's different move always
 * attaches a new branch beside them, so the original line cannot be lost.
 *
 * State:
 *   { nodes: { [id]: node }, ids: ['root','m1',…], pointer, seq, promotedId }
 * Node:
 *   { id, parentId, san, uci, from, to, promotion, fen, ply,
 *     isMainline, children: [id], row }
 * ────────────────────────────────────────────────────────────────────────── */

export const ROOT_ID = 'root';
export const VARIATION_STORAGE_PREFIX = 'mz-variations-v1';

const STANDARD_START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const startFenOf = (fen) => (fen && fen !== 'start' ? fen : STANDARD_START);
const uciOf = (mv) => `${mv.from}${mv.to}${mv.promotion || ''}`;

function makeNode(id, parent, mv, fen, isMainline) {
  return {
    id,
    parentId: parent.id,
    san: mv.san,
    uci: uciOf(mv),
    from: mv.from,
    to: mv.to,
    promotion: mv.promotion || null,
    /* The verbose move's own identity, so a variation move can play the same
       sound / effect as the identical mainline move without re-walking a
       history the board no longer holds. */
    piece: mv.piece || null,
    color: mv.color || null,
    captured: mv.captured || null,
    flags: mv.flags || '',
    fen,
    ply: parent.ply + 1,
    isMainline,
    children: [],
    row: null,
  };
}

export function buildMainline(initialFen = 'start', sanList = []) {
  const g = new Chess(startFenOf(initialFen));
  const root = {
    id: ROOT_ID, parentId: null, san: null, uci: null, from: null, to: null,
    promotion: null, fen: g.fen(), ply: 0, isMainline: true, children: [], row: null,
  };
  const nodes = { [ROOT_ID]: root };
  const ids = [ROOT_ID];
  let prev = root;
  for (let i = 0; i < sanList.length; i += 1) {
    let mv = null;
    try { mv = g.move(sanList[i]); } catch { mv = null; }
    if (!mv) break;
    const node = makeNode(`m${prev.ply + 1}`, prev, mv, g.fen(), true);
    nodes[node.id] = node;
    prev.children.push(node.id);
    prev = node;
    ids.push(node.id);
  }
  return { nodes, ids };
}

export function initialPlyId(base, initialPly) {
  if (initialPly === 'end') return base.ids[base.ids.length - 1] || ROOT_ID;
  const ply = Math.max(0, Math.min(base.ids.length - 1, Math.floor(Number(initialPly)) || 0));
  return base.ids[ply] || ROOT_ID;
}

export function initialState(base, pointer = ROOT_ID) {
  return {
    nodes: base.nodes,
    ids: base.ids,
    pointer: base.nodes[pointer] ? pointer : ROOT_ID,
    seq: 0,
    promotedId: null,
  };
}

/* A mainline that GROWS (a live classroom PGN) keeps every branch attached to
 * the positional mainline ids. A replaced game returns null → fresh tree. */
export function mergeMainline(prev, base) {
  const grows = prev.ids.length <= base.ids.length && prev.ids.every((id, i) => base.ids[i] === id);
  if (!grows) return null;
  if (prev.ids.length === base.ids.length) return prev;
  const nodes = {};
  base.ids.forEach((id) => {
    const fresh = base.nodes[id];
    const old = prev.nodes[id];
    const extra = old ? old.children.filter((cid) => prev.nodes[cid] && !prev.nodes[cid].isMainline) : [];
    nodes[id] = { ...fresh, children: [...fresh.children, ...extra] };
  });
  Object.keys(prev.nodes).forEach((id) => {
    const node = prev.nodes[id];
    if (node && !node.isMainline) nodes[id] = node;
  });
  return { ...prev, nodes, ids: base.ids };
}

export function serializeTree(state) {
  return {
    v: 1,
    seq: state.seq || 0,
    pointer: state.pointer,
    promotedId: state.promotedId || null,
    nodes: Object.values(state.nodes)
      .filter((n) => n && !n.isMainline)
      .map((n) => ({
        id: n.id, parentId: n.parentId, san: n.san, uci: n.uci, fen: n.fen,
        ply: n.ply, row: n.row || null,
        piece: n.piece || null, color: n.color || null,
        captured: n.captured || null, flags: n.flags || '',
      })),
  };
}

/* A saved branch is only attached when its SAN is legal from the parent's
 * CURRENT position and lands on the recorded FEN. Mainline ids are positional
 * (`m3` is the third ply of ANY game), so an edited or corrected PGN would
 * otherwise adopt a branch that was played somewhere else. */
function branchFitsParent(savedNode, parent) {
  try {
    const g = new Chess(parent.fen);
    return Boolean(g.move(savedNode.san)) && g.fen() === savedNode.fen;
  } catch {
    return false;
  }
}

/* Attach saved branches to a freshly built mainline. A branch whose parent is
 * gone (a different game, an edited PGN) is dropped, never re-parented. */
export function hydrateTree(saved, base, fallbackPointer = null) {
  const pointer = fallbackPointer && base.nodes[fallbackPointer] ? fallbackPointer : initialPlyId(base, 'end');
  const empty = initialState(base, pointer);
  if (!saved || saved.v !== 1 || !Array.isArray(saved.nodes) || saved.nodes.length === 0) return empty;

  /* Clone the mainline nodes before attaching anything: a shallow spread shared
     each parent OBJECT with `base`, and every attach below pushes into its
     `children`, so hydrating twice (the classroom re-hydrates on every server
     snapshot) appended the same branches again and the list rendered them
     repeatedly. */
  const nodes = {};
  Object.entries(base.nodes).forEach(([id, n]) => {
    nodes[id] = { ...n, children: [...n.children] };
  });
  let pending = saved.nodes.filter((n) => n && n.id && n.parentId && n.fen && n.san);
  let progressed = true;
  while (pending.length && progressed) {
    progressed = false;
    const next = [];
    pending.forEach((n) => {
      const parent = nodes[n.parentId];
      /* The parent may itself be a saved branch that has not been rebuilt yet;
         keep waiting for it. */
      if (!parent) { next.push(n); return; }
      if (!branchFitsParent(n, parent)) return; // same id, different game — drop
      /* The parent already owns a move with this SAN (the mainline child, or an
         earlier saved branch): this is a duplicate of an existing line, not a
         new branch. */
      if (parent.children.some((cid) => nodes[cid] && nodes[cid].san === n.san)) return;
      const uci = typeof n.uci === 'string' ? n.uci : null;
      nodes[n.id] = {
        id: n.id, parentId: n.parentId, san: n.san, uci,
        from: uci ? uci.slice(0, 2) : null, to: uci ? uci.slice(2, 4) : null,
        promotion: uci && uci.length > 4 ? uci.slice(4) : null,
        piece: n.piece || null, color: n.color || null,
        captured: n.captured || null, flags: n.flags || '',
        fen: n.fen, ply: Number(n.ply) || parent.ply + 1,
        isMainline: false, row: n.row || null, children: [],
      };
      parent.children = [...parent.children, n.id];
      progressed = true;
    });
    pending = next;
  }
  const promotedId = saved.promotedId && nodes[saved.promotedId] ? saved.promotedId : null;
  const wanted = saved.pointer && nodes[saved.pointer] ? saved.pointer : pointer;
  return { nodes, ids: base.ids, pointer: wanted, seq: Number(saved.seq) || 0, promotedId };
}

/* ── reads ── */

export const currentOf = (state) => state.nodes[state.pointer] || state.nodes[ROOT_ID];

export function lineOf(state) {
  const out = [];
  let cur = state.nodes[state.pointer];
  while (cur) { out.unshift(cur.id); cur = state.nodes[cur.parentId]; }
  return out;
}

export function firstChildChain(state, startId, skipFirst = false) {
  const out = [];
  let cur = state.nodes[startId];
  if (!cur) return out;
  if (!skipFirst) out.push(startId);
  while (cur.children.length) {
    cur = state.nodes[cur.children[0]];
    if (!cur) break;
    out.push(cur.id);
  }
  return out;
}

export function siblingsOf(state) {
  const cur = currentOf(state);
  const parent = state.nodes[cur.parentId];
  const list = parent ? parent.children : [ROOT_ID];
  return { list, index: Math.max(0, list.indexOf(cur.id)) };
}

export function branchPointOf(state) {
  let cur = currentOf(state);
  while (cur && !cur.isMainline) cur = state.nodes[cur.parentId];
  return cur || state.nodes[ROOT_ID];
}

/* The line shown in the main grid. Normally the mainline; after a "promote to
 * mainline view" it is the promoted branch (display only — data unchanged). */
export function displayIdsOf(state) {
  if (!state.promotedId || !state.nodes[state.promotedId]) return state.ids;
  const path = [];
  let cur = state.nodes[state.promotedId];
  while (cur) { path.unshift(cur.id); cur = state.nodes[cur.parentId]; }
  return [...path, ...firstChildChain(state, state.promotedId, true)];
}

export const variationCountOf = (state) =>
  Object.values(state.nodes).filter((n) => n && !n.isMainline).length;

export function lineEndPly(state) {
  const chain = firstChildChain(state, state.pointer);
  const last = state.nodes[chain[chain.length - 1]] || currentOf(state);
  return last.ply;
}

/* ── navigation (pointer only) ── */

export function movePointer(state, id) {
  if (!id || !state.nodes[id] || state.pointer === id) return state;
  return { ...state, pointer: id };
}

export function backInTree(state) {
  const cur = currentOf(state);
  return cur.parentId ? movePointer(state, cur.parentId) : state;
}

export function forwardInTree(state) {
  const cur = currentOf(state);
  return cur.children.length ? movePointer(state, cur.children[0]) : state;
}

export const startOfTree = (state) => movePointer(state, ROOT_ID);

export function endOfTree(state) {
  const chain = firstChildChain(state, state.pointer);
  return movePointer(state, chain[chain.length - 1] || state.pointer);
}

export function toMainlinePly(state, ply) {
  const n = Math.max(0, Math.min(state.ids.length - 1, Math.floor(Number(ply)) || 0));
  return movePointer(state, state.ids[n]);
}

export function siblingInTree(state, delta) {
  const cur = currentOf(state);
  const parent = state.nodes[cur.parentId];
  if (!parent || parent.children.length < 2) return null;
  const idx = parent.children.indexOf(cur.id) + delta;
  if (idx < 0 || idx >= parent.children.length) return null;
  return movePointer(state, parent.children[idx]);
}

export function toMainline(state) {
  return movePointer(state, branchPointOf(state).id);
}

/* ── mutation ── */

/* Play a legal move at the pointer. An existing child with the same SAN is a
 * NAVIGATION, never a duplicate. A different move becomes a branch; the
 * mainline array and nodes are untouched. */
export function playMoveInTree(state, move) {
  const cur = currentOf(state);
  const g = new Chess(cur.fen);
  let mv = null;
  try {
    mv = typeof move === 'string'
      ? g.move(move)
      : g.move({ from: move.from, to: move.to, promotion: move.promotion || 'q' });
  } catch { mv = null; }
  if (!mv) return { state, node: cur, created: false, illegal: true };

  const fen = g.fen();
  const existingId = cur.children.find((cid) => state.nodes[cid] && state.nodes[cid].san === mv.san);
  if (existingId) {
    return { state: movePointer(state, existingId), node: state.nodes[existingId], created: false };
  }
  const id = `v${(state.seq || 0) + 1}`;
  const node = makeNode(id, cur, mv, fen, false);
  const nodes = {
    ...state.nodes,
    [cur.id]: { ...cur, children: [...cur.children, id] },
    [id]: node,
  };
  return {
    state: { ...state, nodes, pointer: id, seq: (state.seq || 0) + 1 },
    node,
    parent: cur,
    created: true,
  };
}

export function gradeNodeInTree(state, id, row) {
  const node = state.nodes[id];
  if (!node) return state;
  return { ...state, nodes: { ...state.nodes, [id]: { ...node, row: row || null } } };
}

function subtreeIds(state, id) {
  const out = [];
  const walk = (nid) => {
    const n = state.nodes[nid];
    if (!n) return;
    out.push(nid);
    n.children.forEach(walk);
  };
  walk(id);
  return out;
}

export function deleteVariationInTree(state, id) {
  const node = state.nodes[id];
  if (!node || node.isMainline || id === ROOT_ID) return null;
  const doomed = subtreeIds(state, id);
  const parent = state.nodes[node.parentId];
  const nodes = { ...state.nodes };
  doomed.forEach((nid) => { delete nodes[nid]; });
  if (parent) nodes[parent.id] = { ...parent, children: parent.children.filter((cid) => cid !== id) };
  const pointer = doomed.includes(state.pointer) ? (parent ? parent.id : ROOT_ID) : state.pointer;
  const promotedId = state.promotedId && doomed.includes(state.promotedId) ? null : state.promotedId;
  /* The mainline array must ride along: every reader indexes `ids`, and a
     state without it crashes the whole card on the next render. */
  return { ...state, nodes, pointer, promotedId };
}

export function togglePromotionInTree(state, id) {
  const node = state.nodes[id];
  if (!node || node.isMainline) return state;
  return { ...state, promotedId: state.promotedId === id ? null : id };
}

export function resetToMainline(state, base) {
  const pointer = currentOf(state).isMainline ? state.pointer : (state.ids[state.ids.length - 1] || ROOT_ID);
  return { nodes: base.nodes, ids: base.ids, pointer, seq: 0, promotedId: null };
}

/* Server-authoritative delta: add one branch node if it is not already here. */
export function applyRemoteNodeInTree(state, node, pointer) {
  if (!node || !node.id || !node.parentId) return state;
  let next = state;
  if (!state.nodes[node.id]) {
    const parent = state.nodes[node.parentId];
    if (!parent) return state;
    const uci = typeof node.uci === 'string' ? node.uci : null;
    next = {
      ...state,
      nodes: {
        ...state.nodes,
        [parent.id]: { ...parent, children: [...parent.children, node.id] },
        [node.id]: {
          id: node.id, parentId: node.parentId, san: node.san, uci,
          from: uci ? uci.slice(0, 2) : null, to: uci ? uci.slice(2, 4) : null,
          promotion: uci && uci.length > 4 ? uci.slice(4) : null,
          piece: node.piece || null, color: node.color || null,
          captured: node.captured || null, flags: node.flags || '',
          fen: node.fen, ply: Number(node.ply) || parent.ply + 1,
          isMainline: false, children: [], row: node.row || null,
        },
      },
      seq: Math.max(state.seq || 0, Number(node.seq) || 0),
    };
  }
  if (pointer && next.nodes[pointer]) next = { ...next, pointer };
  return next;
}
