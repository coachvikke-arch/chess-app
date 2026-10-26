/* Fallback computer engine — compact pure-JS alpha-beta negamax over a raw
   8x8 array board (no WASM, no chess.js inside the search). Only used when the
   Stockfish worker cannot boot (offline / blocked worker / boot timeout), so
   computer-vs-students games still play at roughly the strength the instructor
   configured. The returned move is validated against chess.js by the caller.
*/

const EMPTY = 0;
const P = 1, N = 2, B = 3, R = 4, Q = 5, K = 6;
const W = 0, BL = 1;

const VAL = [0, 100, 320, 330, 500, 900, 20000];
const MATE = 1000000;

/* white-perspective PSTs, indexed a8(0)..h1(63). */
const PST = {
  p: [0,0,0,0,0,0,0,0,50,50,50,50,50,50,50,50,10,10,20,30,30,20,10,10,5,5,10,25,25,10,5,5,0,0,0,20,20,0,0,0,5,-5,-10,0,0,-10,-5,5,5,10,10,-20,-20,10,10,5,0,0,0,0,0,0,0,0],
  n: [-50,-40,-30,-30,-30,-30,-40,-50,-40,-20,0,0,0,0,-20,-40,-30,0,10,15,15,10,0,-30,-30,5,15,20,20,15,5,-30,-30,0,15,20,20,15,0,-30,-30,5,10,15,15,10,5,-30,-40,-20,0,5,5,0,-20,-40,-50,-40,-30,-30,-30,-30,-40,-50],
  b: [-20,-10,-10,-10,-10,-10,-10,-20,-10,0,0,0,0,0,0,-10,-10,0,5,10,10,5,0,-10,-10,5,5,10,10,5,5,-10,-10,0,10,10,10,10,0,-10,-10,10,10,10,10,10,10,-10,-10,5,0,0,0,0,5,-10,-20,-10,-10,-10,-10,-10,-10,-20],
  r: [0,0,0,0,0,0,0,0,5,10,10,10,10,10,10,5,-5,0,0,0,0,0,0,-5,-5,0,0,0,0,0,0,-5,-5,0,0,0,0,0,0,-5,-5,0,0,0,0,0,0,-5,-5,0,0,0,0,0,0,-5,0,0,0,5,5,0,0,0],
  q: [-20,-10,-10,-5,-5,-10,-10,-20,-10,0,0,0,0,0,0,-10,-10,0,5,5,5,5,0,-10,-5,0,5,5,5,5,0,-5,0,0,5,5,5,5,0,-5,-10,5,5,5,5,5,0,-10,-10,0,5,0,0,0,0,-10,-20,-10,-10,-5,-5,-10,-10,-20],
  k: [-30,-40,-40,-50,-50,-40,-40,-30,-30,-40,-40,-50,-50,-40,-40,-30,-30,-40,-40,-50,-50,-40,-40,-30,-30,-40,-40,-50,-50,-40,-40,-30,-20,-30,-30,-40,-40,-30,-30,-20,-10,-20,-20,-20,-20,-20,-20,-10,20,20,0,0,0,0,20,20,20,30,10,0,0,10,30,20],
};

const FILES = 'abcdefgh';
const RANKS = '87654321';
const PC_CH = { [P]: 'p', [N]: 'n', [B]: 'b', [R]: 'r', [Q]: 'q', [K]: 'k' };
const CH_PC = { p: P, n: N, b: B, r: R, q: Q, k: K };

let Z = null;
function zobristInit() {
  let s = 0x9e3779b9;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) | 0; return s; };
  Z = {
    pc: Array.from({ length: 64 }, () => Array.from({ length: 13 }, () => rnd())),
    turn: rnd(),
    castling: { K: rnd(), Q: rnd(), k: rnd(), q: rnd() },
    ep: Array.from({ length: 8 }, () => rnd()),
  };
}

function hashOf(state) {
  if (!Z) zobristInit();
  const { board, turn, castling, ep } = state;
  let h = 0;
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const v = board[r][f];
    if (v !== 0) h ^= Z.pc[r * 8 + f][v + 6];
  }
  if (turn === BL) h ^= Z.turn;
  if (castling.K) h ^= Z.castling.K;
  if (castling.Q) h ^= Z.castling.Q;
  if (castling.k) h ^= Z.castling.k;
  if (castling.q) h ^= Z.castling.q;
  if (ep) h ^= Z.ep[ep[1]];
  return h;
}

const KNIGHT_D = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
const KING_D = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
const ROOK_D = [[-1,0],[1,0],[0,-1],[0,1]];
const BI_D = [[-1,-1],[-1,1],[1,-1],[1,1]];

function opp(color) { return color === W ? BL : W; }

function newBoard() {
  const b = Array(8);
  for (let r = 0; r < 8; r++) b[r] = new Array(8).fill(0);
  return b;
}

export function parseFen(fen) {
  const [placement, turn, castling, epStr] = fen.split(/\s+/);
  const board = newBoard();
  const ranks = placement.split('/');
  for (let r = 0; r < 8; r++) {
    let f = 0;
    for (const ch of ranks[r]) {
      if (ch >= '1' && ch <= '8') { f += Number(ch); continue; }
      const t = CH_PC[ch.toLowerCase()];
      const c = ch === ch.toUpperCase() ? W : BL;
      board[r][f] = c === W ? t : -t;
      f++;
    }
  }
  const cast = { K: false, Q: false, k: false, q: false };
  if (castling !== '-') {
    cast.K = castling.includes('K');
    cast.Q = castling.includes('Q');
    cast.k = castling.includes('k');
    cast.q = castling.includes('q');
  }
  const state = {
    board,
    turn: turn === 'w' ? W : BL,
    castling: cast,
    ep: epStr && epStr !== '-' ? [8 - Number(epStr[1]), FILES.indexOf(epStr[0])] : null,
    undoStack: [],
    _path: [],
  };
  state.hash = hashOf(state);
  return state;
}

function sqName(r, f) { return FILES[f] + RANKS[r]; }

function sqFrom(sq) {
  return [RANKS.indexOf(sq[1]), FILES.indexOf(sq[0])];
}

function findKing(board, color) {
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const v = board[r][f];
    if (v !== 0 && (v > 0) === (color === W) && v === (color === W ? K : -K)) return [r, f];
  }
  return [-1, -1];
}

function hasKings(board) {
  let wk = false, bk = false;
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const v = board[r][f];
    if (v === K) wk = true;
    else if (v === -K) bk = true;
  }
  return wk && bk;
}

function attacked(board, r, f, byColor) {
  const own = (v) => v !== 0 && (v > 0) === (byColor === W);
  // pawn attacks (diagonal, forward for the attacker)
  const prow = byColor === W ? r + 1 : r - 1;
  for (const df of [-1, 1]) {
    const pf = f + df;
    if (prow >= 0 && prow <= 7 && pf >= 0 && pf <= 7 && own(board[prow][pf]) && board[prow][pf] === (byColor === W ? P : -P)) return true;
  }
  // knights
  for (const [dr, df] of KNIGHT_D) {
    const pr = r + dr, pf = f + df;
    if (pr >= 0 && pr <= 7 && pf >= 0 && pf <= 7 && own(board[pr][pf]) && board[pr][pf] === (byColor === W ? N : -N)) return true;
  }
  // king
  for (const [dr, df] of KING_D) {
    const pr = r + dr, pf = f + df;
    if (pr >= 0 && pr <= 7 && pf >= 0 && pf <= 7 && own(board[pr][pf]) && board[pr][pf] === (byColor === W ? K : -K)) return true;
  }
  // sliding
  for (const [dr, df] of ROOK_D) {
    let pr = r + dr, pf = f + df;
    while (pr >= 0 && pr <= 7 && pf >= 0 && pf <= 7) {
      const v = board[pr][pf];
      if (v !== 0) {
        if (own(v) && (v === R || v === -R || v === Q || v === -Q)) return true;
        break;
      }
      pr += dr; pf += df;
    }
  }
  for (const [dr, df] of BI_D) {
    let pr = r + dr, pf = f + df;
    while (pr >= 0 && pr <= 7 && pf >= 0 && pf <= 7) {
      const v = board[pr][pf];
      if (v !== 0) {
        if (own(v) && (v === B || v === -B || v === Q || v === -Q)) return true;
        break;
      }
      pr += dr; pf += df;
    }
  }
  return false;
}

function perPieceMoves(state, r, f, out) {
  const { board, turn, castling, ep } = state;
  const me = turn;
  const v = board[r][f];
  const absT = Math.abs(v);
  const push = (toR, toF, prom) => {
    if (toR < 0 || toR > 7 || toF < 0 || toF > 7) return;
    const d = board[toR][toF];
    if (d !== 0 && (d > 0) === (me === W)) return;
    if (absT === P && toR === (me === W ? 0 : 7)) {
      out.push({ from: sqName(r, f), to: sqName(toR, toF), promotion: 'q' });
      out.push({ from: sqName(r, f), to: sqName(toR, toF), promotion: 'n' });
      out.push({ from: sqName(r, f), to: sqName(toR, toF), promotion: 'r' });
      out.push({ from: sqName(r, f), to: sqName(toR, toF), promotion: 'b' });
    } else {
      out.push({ from: sqName(r, f), to: sqName(toR, toF), promotion: null });
    }
  };

  if (absT === P) {
    const fwd = me === W ? -1 : 1;
    const startRow = me === W ? 6 : 1;
    const oneR = r + fwd;
    if (oneR >= 0 && oneR <= 7 && board[oneR][f] === 0) {
      push(oneR, f, null);
      if (r === startRow && oneR + fwd >= 0 && oneR + fwd <= 7 && board[oneR + fwd][f] === 0) push(oneR + fwd, f, null);
    }
    for (const df of [-1, 1]) {
      const pf = f + df;
      if (pf < 0 || pf > 7 || oneR < 0 || oneR > 7) continue;
      const d = board[oneR][pf];
      if (d !== 0 && (d > 0) !== (me === W)) push(oneR, pf, null);
      else if (ep && oneR === ep[0] && pf === ep[1]) push(oneR, pf, null);
    }
    return;
  }
  if (absT === N) {
    for (const [dr, df] of KNIGHT_D) push(r + dr, f + df, null);
    return;
  }
  if (absT === K) {
    for (const [dr, df] of KING_D) push(r + dr, f + df, null);
    const krow = me === W ? 7 : 0;
    if ((me === W ? castling.K : castling.k) && board[krow][5] === 0 && board[krow][6] === 0 &&
        board[krow][7] !== 0 && board[krow][7] > 0 === (me === W) && board[krow][7] * (me === W ? 1 : -1) > 0 && Math.abs(board[krow][7]) === R) {
      if (!attacked(board, krow, 4, opp(me)) && !attacked(board, krow, 5, opp(me)) && !attacked(board, krow, 6, opp(me))) push(krow, 6, null);
    }
    if ((me === W ? castling.Q : castling.q) && board[krow][3] === 0 && board[krow][2] === 0 && board[krow][1] === 0 &&
        board[krow][0] !== 0 && board[krow][0] > 0 === (me === W) && Math.abs(board[krow][0]) === R) {
      if (!attacked(board, krow, 4, opp(me)) && !attacked(board, krow, 3, opp(me)) && !attacked(board, krow, 2, opp(me))) push(krow, 2, null);
    }
    return;
  }
  const dirs = absT === B ? BI_D : absT === R ? ROOK_D : [...ROOK_D, ...BI_D];
  for (const [dr, df] of dirs) {
    let pr = r + dr, pf = f + df;
    while (pr >= 0 && pr <= 7 && pf >= 0 && pf <= 7) {
      const d = board[pr][pf];
      if (d === 0) { push(pr, pf, null); }
      else {
        if ((d > 0) !== (me === W)) push(pr, pf, null);
        break;
      }
      pr += dr; pf += df;
    }
  }
}

function genPseudo(state, legalOnly) {
  const { board, turn } = state;
  const moves = [];
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const v = board[r][f];
    if (v === 0 || (v > 0) !== (turn === W)) continue;
    perPieceMoves(state, r, f, moves);
  }
  if (!legalOnly) return moves;
  const legal = [];
  const me = turn;
  for (const m of moves) {
    applyMove(state, m);
    const kingsOk = hasKings(state.board);
    const king = findKing(state.board, me);
    const safe = kingsOk && king[0] >= 0 && !attacked(state.board, king[0], king[1], opp(me));
    unapplyMove(state);
    if (safe) legal.push(m);
  }
  return legal;
}

function makeUndo(state, m, captured) {
  return {
    fromR: sqFrom(m.from)[0], fromF: sqFrom(m.from)[1],
    toR: sqFrom(m.to)[0], toF: sqFrom(m.to)[1],
    piece: m._piece, captured,
    castling: { K: state.castling.K, Q: state.castling.Q, k: state.castling.k, q: state.castling.q },
    ep: state.ep,
    _prevHash: state.hash,
    castled: false, enPassantCap: false,
  };
}

function applyMove(state, m) {
  const { board } = state;
  const fromR = sqFrom(m.from)[0], fromF = sqFrom(m.from)[1];
  const toR = sqFrom(m.to)[0], toF = sqFrom(m.to)[1];
  const piece = board[fromR][fromF];
  m._piece = piece;
  const captured = board[toR][toF];
  const u = makeUndo(state, m, captured);
  const me = piece > 0 ? W : BL;
  const wasCastle = Math.abs(piece) === K && Math.abs(toF - fromF) === 2;

  if (wasCastle) {
    if (toF === 6) { board[fromR][5] = board[fromR][7]; board[fromR][7] = 0; }
    else { board[fromR][3] = board[fromR][0]; board[fromR][0] = 0; }
    u.castled = true;
  }
  const wasEp = Math.abs(piece) === P && state.ep && toR === state.ep[0] && toF === state.ep[1];
  if (wasEp) {
    board[fromR][toF] = 0;
    u.enPassantCap = true;
  }

  board[toR][toF] = m.promotion ? (me === W ? CH_PC[m.promotion] : -CH_PC[m.promotion]) : piece;
  board[fromR][fromF] = 0;

  if (Math.abs(piece) === K) {
    if (me === W) { state.castling.K = false; state.castling.Q = false; }
    else { state.castling.k = false; state.castling.q = false; }
  }
  if (piece === R) { if (fromR === 7 && fromF === 7) state.castling.K = false; if (fromR === 7 && fromF === 0) state.castling.Q = false; }
  if (piece === -R) { if (fromR === 0 && fromF === 7) state.castling.k = false; if (fromR === 0 && fromF === 0) state.castling.q = false; }
  if (toR === 7 && toF === 7) state.castling.K = false;
  if (toR === 7 && toF === 0) state.castling.Q = false;
  if (toR === 0 && toF === 7) state.castling.k = false;
  if (toR === 0 && toF === 0) state.castling.q = false;

  state.ep = Math.abs(piece) === P && Math.abs(toR - fromR) === 2 ? [fromR + (me === W ? 1 : -1), fromF] : null;
  state.turn = opp(me);
  state.hash = hashOf(state);
  state._path.push(u._prevHash);
  state.undoStack.push(u);
}

function unapplyMove(state) {
  const u = state.undoStack.pop();
  if (!u) return;
  const { board } = state;
  if (state._path.length) state._path.pop();
  board[u.fromR][u.fromF] = u.piece;
  board[u.toR][u.toF] = u.captured;
  if (u.castled) {
    if (u.toF === 6) { board[u.fromR][7] = board[u.fromR][5]; board[u.fromR][5] = 0; }
    else { board[u.fromR][0] = board[u.fromR][3]; board[u.fromR][3] = 0; }
  }
  if (u.enPassantCap) board[u.fromR][u.toF] = u.piece > 0 ? -P : P;
  state.castling = { ...u.castling };
  state.ep = u.ep;
  state.turn = state.turn === W ? BL : W;
}

function evaluate(board) {
  let score = 0;
  const cnt = { W: { P: 0, N: 0, B: 0, R: 0, Q: 0 }, BL: { P: 0, N: 0, B: 0, R: 0, Q: 0 } };
  const kW = [-1, -1], kB = [-1, -1];
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const v = board[r][f];
    if (v === 0) continue;
    const absT = Math.abs(v);
    const white = v > 0;
    const key = white ? 'W' : 'BL';
    if (absT === K) { (white ? kW : kB)[0] = r; (white ? kW : kB)[1] = f; continue; }
    cnt[key][PC_CH[absT]]++;
    const pst = PST[PC_CH[absT]][white ? r * 8 + f : (7 - r) * 8 + f];
    score += white ? VAL[absT] + pst : -(VAL[absT] + pst);
  }
  // center pawns (files d/e => 3/4)
  for (let r = 2; r <= 5; r++) for (const f of [2, 3, 4, 5]) {
    const v = board[r][f];
    if (v === 0 || Math.abs(v) !== P) continue;
    const white = v > 0;
    if (f === 3 || f === 4) score += white ? 8 : -8;
    else score += white ? 3 : -3;
  }
  // development: minors off home square
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const v = board[r][f];
    if (v === 0) continue;
    const absT = Math.abs(v);
    if (absT !== N && absT !== B) continue;
    const white = v > 0;
    const homeR = white ? 7 : 0;
    if (r === homeR && (f === 1 || f === 6 || f === 2 || f === 5)) continue; // never moved
    score += white ? 4 : -4;
  }
  // KRK / KQK driving gradient
  const wExtra = cnt.W.P + cnt.W.N + cnt.W.B + cnt.W.R + cnt.W.Q;
  const bExtra = cnt.BL.P + cnt.BL.N + cnt.BL.B + cnt.BL.R + cnt.BL.Q;
  const rookAligned = (attackerColor, rookRow, rookFile) => {
    const ek = attackerColor === W ? kB : kW;
    return (rookRow === ek[0] || rookFile === ek[1]) ? 2 : 0;
  };
  let wRr = -1, wRf = -1, bRr = -1, bRf = -1;
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    if (board[r][f] === R) { wRr = r; wRf = f; }
    else if (board[r][f] === -R) { bRr = r; bRf = f; }
  }
  const grad = (own, enemy) => {
    const d = Math.max(Math.abs(own[0] - enemy[0]), Math.abs(own[1] - enemy[1]));
    const cenR = enemy[0] <= 3 ? enemy[0] : 7 - enemy[0];
    const cenF = enemy[1] <= 3 ? enemy[1] : 7 - enemy[1];
    return 12 * (7 - d) + 6 * (3 - Math.max(cenR, cenF));
  };
  if (bExtra === 0 && cnt.W.Q === 1 && wExtra === 1 && cnt.W.R === 0) score += grad(kW, kB);
  else if (bExtra === 0 && cnt.W.R === 1 && wExtra === 1 && cnt.W.Q === 0) score += grad(kW, kB) + (wRr >= 0 ? rookAligned(W, wRr, wRf) : 0);
  else if (wExtra === 0 && cnt.BL.Q === 1 && bExtra === 1 && cnt.BL.R === 0) score -= grad(kB, kW);
  else if (wExtra === 0 && cnt.BL.R === 1 && bExtra === 1 && cnt.BL.Q === 0) score -= grad(kB, kW) + (bRr >= 0 ? rookAligned(BL, bRr, bRf) : 0);
  return score;
}

function orderMoves(state, moves) {
  const board = state.board;
  return moves
    .map((m) => {
      const toR = sqFrom(m.to)[0], toF = sqFrom(m.to)[1];
      const fromR = sqFrom(m.from)[0], fromF = sqFrom(m.from)[1];
      let s = 0;
      if (m.promotion) s += 1000;
      const capV = Math.abs(board[toR][toF]);
      if (capV) s += 10 * VAL[capV] - (VAL[Math.abs(board[fromR][fromF])] / 100);
      else if (m.promotion) { /* keep +1000 */ }
      else {
        // quiet-move preference so openings feel principled on equal scores
        const absT = Math.abs(board[fromR][fromF]);
        if (absT === K) {
          if (toF === 6 || toF === 2) s += 45; // castle (only kingside to 6, queenside to 2)
          else s += 2;
        } else if (absT === N) {
          const home = (fromR === 7 || fromR === 0) && (fromF === 1 || fromF === 6);
          if (home) { if ((toF === 3 || toF === 4) && toR >= 2 && toR <= 5) s += 14; else s += 10; }
          else s += 3;
        } else if (absT === B) {
          const home = (fromR === 7 || fromR === 0) && (fromF === 2 || fromF === 5);
          s += home ? 8 : 3;
        } else if (absT === Q) {
          s += 2;
        } else if (absT === R) {
          s += 1;
        } else if (absT === P) {
          const centerFile = toF === 3 || toF === 4;
          const adv = state.turn === W ? 6 - toR : toR - 1;
          if (centerFile && adv >= 2) s += 12;
          else if (centerFile && adv === 1) s += 7;
          else if (adv >= 2) s += 6;
          else if ((toF === 2 || toF === 5) && adv === 1) s += 4;
          else s += 1;
        }
      }
      return { m, s };
    })
    .sort((a, b) => b.s - a.s)
    .map((x) => x.m);
}

function quiesce(state, alpha, beta, nodesRef) {
  if (++nodesRef.n > nodesRef.maxNodes && nodesRef.maxNodes > 0) { nodesRef.aborted = true; return 0; }
  if (Date.now() - nodesRef.start >= nodesRef.timeMs) { nodesRef.aborted = true; return 0; }
  if (state._path && state._path.length) {
    const h = state.hash;
    let c = 0;
    for (let i = state._path.length - 1; i >= 0; i--) {
      if (state._path[i] === h && ++c >= 2) return 0; // threefold along search path
    }
  }
  const board = state.board;
  const stand = evaluate(board);
  const side = state.turn === W ? stand : -stand;
  if (side >= beta) return side;
  if (side > alpha) alpha = side;
  const raw = genPseudo(state, false);
  raw.sort((a, b) => {
    const av = (a.promotion ? 900 : Math.abs(board[sqFrom(a.to)[0]][sqFrom(a.to)[1]]));
    const bv = (b.promotion ? 900 : Math.abs(board[sqFrom(b.to)[0]][sqFrom(b.to)[1]]));
    return bv - av;
  });
  for (const m of raw) {
    const capV = m.promotion ? 900 : Math.abs(board[sqFrom(m.to)[0]][sqFrom(m.to)[1]]);
    if (capV === 0) continue; // quiet in quiesce
    applyMove(state, m);
    const child = quiesce(state, -beta, -alpha, nodesRef);
    unapplyMove(state);
    if (nodesRef.aborted) return 0;
    const score = -child;
    if (score >= beta) return score;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

function negamax(state, depth, alpha, beta, nodesRef) {
  if (++nodesRef.n > nodesRef.maxNodes && nodesRef.maxNodes > 0) { nodesRef.aborted = true; return 0; }
  if (Date.now() - nodesRef.start >= nodesRef.timeMs) { nodesRef.aborted = true; return 0; }
  if (depth <= 0) return quiesce(state, alpha, beta, nodesRef);

  let best = -Infinity;
  const moves = orderMoves(state, genPseudo(state, true));
  if (moves.length === 0) {
    const board = state.board;
    const king = findKing(board, state.turn);
    const mate = king[0] >= 0 && attacked(board, king[0], king[1], state.turn === W ? BL : W);
    // shorter mates must score higher for the mating side: distance in moves
    const pliesPlayed = nodesRef.rootDepth - depth;
    const distMoves = Math.max(1, (pliesPlayed + 1) / 2);
    return mate ? -(MATE - distMoves) : 0;
  }
  for (const m of moves) {
    applyMove(state, m);
    const child = negamax(state, depth - 1, -beta, -alpha, nodesRef);
    unapplyMove(state);
    if (nodesRef.aborted) return 0;
    const score = -child;
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

export function bestMove(fen, { maxDepth = 8, timeMs = 800, skillLevel = 20, history = [] } = {}) {
  const state = parseFen(fen);
  if (!hasKings(state.board)) return null;
  const root = orderMoves(state, genPseudo(state, true));
  if (root.length === 0) return null;

  // seed repetition path with prior game positions so the engine avoids looping
  if (history && history.length) {
    state._path = [];
    for (const hf of history) {
      try { state._path.push(parseFen(hf).hash); } catch (e) { /* ignore bad fen */ }
    }
  }

  const skill = Math.max(0, Math.min(20, skillLevel));
  const depth = Math.min(maxDepth, skill <= 3 ? 1 : skill <= 7 ? 2 : skill <= 11 ? 3 : skill <= 14 ? 4 : skill <= 18 ? 5 : Math.min(8, maxDepth));
  const budget = Math.max(50, timeMs);
  const NEGMATE = -MATE - 200;

  let bestEntry = null;
  let alphaRoot = -Infinity;
  const nodesRef = { n: 0, maxNodes: 60000, start: Date.now(), timeMs: budget, aborted: false, rootDepth: 0 };

  for (let d = 1; d <= depth; d++) {
    nodesRef.rootDepth = d;
    let alpha = alphaRoot;
    let curBest = null;
    let curScore = null;
    for (const m of root) {
      applyMove(state, m);
      const child = negamax(state, d - 1, NEGMATE, -alpha, nodesRef);
      unapplyMove(state);
      if (nodesRef.aborted) break;
      const score = -child;
      if (!curBest || score > curScore) { curBest = m; curScore = score; }
      if (score > alpha) alpha = score;
      if (alpha >= MATE) break;
    }
    if (nodesRef.aborted) break;
    if (!curBest) break;
    bestEntry = { move: curBest, score: curScore };
    alphaRoot = alpha;
    if (curScore >= MATE - 500 || (d > 2 && Date.now() - nodesRef.start >= budget * 0.85)) break;
  }

  if (!bestEntry || !bestEntry.move) return null;
  return { from: bestEntry.move.from, to: bestEntry.move.to, promotion: bestEntry.move.promotion || null };
}

/* test hook — legal moves for a fen as {from,to,promotion}[] */
export function _testMoves(fen) {
  const state = parseFen(fen);
  return genPseudo(state, true);
}