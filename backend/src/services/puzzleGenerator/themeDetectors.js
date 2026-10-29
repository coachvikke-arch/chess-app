/* Rule-based tactic detectors for engine-mined puzzles.
 *
 * Everything here reads a *legal* line (start FEN + SAN moves, solver first)
 * and answers "which tactics actually occur in this line?". The generator keeps
 * an engine puzzle only when the selected topic's detector agrees, so the theme
 * label on a saved puzzle is never a guess.
 *
 * Only themes with an honest geometric test live here. Motifs that need opening
 * knowledge or judgement (Zugzwang, Quiet Move, Interference, Clearance,
 * Overloading, Zwischenzug, X-Ray, Stalemate Trick, …) deliberately have no
 * detector — those topics are Lichess-only.
 */

const { Chess } = require('chess.js');

const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const FILES = 'abcdefgh';
const KNIGHT_OFFSETS = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const BISHOP_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const ROOK_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const ALL_DIRS = [...BISHOP_DIRS, ...ROOK_DIRS];
const KING_OFFSETS = ALL_DIRS;

const fileOf = (sq) => sq.charCodeAt(0) - 97;
const rankOf = (sq) => Number(sq[1]) - 1;
const nameOf = (f, r) => (f >= 0 && f < 8 && r >= 0 && r < 8 ? FILES[f] + (r + 1) : null);

/* Piece value with an optional promotion fudge — a pawn about to queen is not a
 * pawn. Kept separate so `VALUE` stays the plain material scale. */
function valueOf(piece) {
  return piece ? VALUE[piece.type] ?? 0 : 0;
}

/**
 * Every square a piece on `from` attacks (empty squares included, own-piece
 * squares excluded). Board geometry is walked directly rather than through
 * move generation so pins and checks cannot be filtered out of the answer.
 */
function attackedSquares(chess, from) {
  const piece = chess.get(from);
  const out = new Set();
  if (!piece) return out;
  const f0 = fileOf(from);
  const r0 = rankOf(from);

  const walk = (dirs) => {
    for (const [df, dr] of dirs) {
      let f = f0 + df;
      let r = r0 + dr;
      while (true) {
        const sq = nameOf(f, r);
        if (!sq) break;
        const target = chess.get(sq);
        if (!target) { out.add(sq); }
        else {
          if (target.color !== piece.color) out.add(sq);
          break;
        }
        f += df;
        r += dr;
      }
    }
  };

  if (piece.type === 'n') {
    for (const [df, dr] of KNIGHT_OFFSETS) {
      const sq = nameOf(f0 + df, r0 + dr);
      if (!sq) continue;
      const target = chess.get(sq);
      if (!target || target.color !== piece.color) out.add(sq);
    }
  } else if (piece.type === 'b') walk(BISHOP_DIRS);
  else if (piece.type === 'r') walk(ROOK_DIRS);
  else if (piece.type === 'q') walk(ALL_DIRS);
  else if (piece.type === 'k') {
    for (const [df, dr] of KING_OFFSETS) {
      const sq = nameOf(f0 + df, r0 + dr);
      const target = sq ? chess.get(sq) : null;
      if (sq && (!target || target.color !== piece.color)) out.add(sq);
    }
  } else if (piece.type === 'p') {
    // Pawns attack diagonally only.
    const dr = piece.color === 'w' ? 1 : -1;
    for (const df of [-1, 1]) {
      const sq = nameOf(f0 + df, r0 + dr);
      if (!sq) continue;
      const target = chess.get(sq);
      if (!target || target.color !== piece.color) out.add(sq);
    }
  }
  return out;
}

/** `from>to` pairs for every piece of `color` attacking an enemy piece. */
function attackPairs(chess, color) {
  const pairs = new Set();
  for (let f = 0; f < 8; f += 1) {
    for (let r = 0; r < 8; r += 1) {
      const sq = nameOf(f, r);
      const piece = chess.get(sq);
      if (!piece || piece.color !== color) continue;
      for (const to of attackedSquares(chess, sq)) {
        const target = chess.get(to);
        if (target && target.color !== color) pairs.add(`${sq}>${to}`);
      }
    }
  }
  return pairs;
}

function kingSquare(chess, color) {
  for (let f = 0; f < 8; f += 1) {
    for (let r = 0; r < 8; r += 1) {
      const sq = nameOf(f, r);
      const piece = chess.get(sq);
      if (piece && piece.type === 'k' && piece.color === color) return sq;
    }
  }
  return null;
}

const other = (color) => (color === 'w' ? 'b' : 'w');

/**
 * Replay a line into per-ply snapshots. Each entry keeps a Chess instance for
 * the position *after* the move (cloned, so callers can inspect freely).
 */
function buildLine(startFen, moves) {
  const chess = new Chess(startFen);
  const solver = chess.turn();
  const plies = [];
  moves.forEach((san, i) => {
    let move;
    try {
      move = chess.move(san);
    } catch {
      move = null;
    }
    if (!move) return;
    const isSolver = move.color === solver;
    plies.push({
      ply: i,
      move,
      isSolver,
      solverIndex: isSolver ? plies.filter((p) => p.isSolver).length : -1,
      after: new Chess(chess.fen()),
      isCheck: chess.isCheck(),
      isCheckmate: chess.isCheckmate(),
    });
  });
  return { solver, plies, final: chess };
}

/** Enemy pieces (other side of `color`) that `color` now attacks, worth ≥3. */
function valuableTargets(chess, color, attackedFrom) {
  const targets = [];
  for (const sq of attackedSquares(chess, attackedFrom)) {
    const piece = chess.get(sq);
    if (piece && piece.color !== color && (piece.type === 'k' || valueOf(piece) >= 3)) {
      targets.push({ square: sq, piece });
    }
  }
  return targets;
}

/* ── individual motifs ─────────────────────────────────────────────────── */

function isFork(ply) {
  const { after, move } = ply;
  const color = move.color;
  const targets = valuableTargets(after, color, move.to);
  const royals = targets.filter((t) => t.piece.type === 'k').length;
  const strong = targets.filter((t) => t.piece.type !== 'k' && valueOf(t.piece) >= 3).length;
  // A pawn forking two pawns is not a tactic worth a puzzle.
  if (move.piece === 'p' && strong >= 2 && royals === 0) {
    return targets.some((t) => valueOf(t.piece) >= 5);
  }
  return strong >= 2 || (royals >= 1 && strong >= 1);
}

/** Enemy pieces pinned in front of their king (absolute) or queen/rook. */
function pinnedSquares(chess, color) {
  const pinned = new Set();

  for (let f = 0; f < 8; f += 1) {
    for (let r = 0; r < 8; r += 1) {
      const from = nameOf(f, r);
      const slider = chess.get(from);
      if (!slider || slider.color !== color) continue;
      const dirs = slider.type === 'b' ? BISHOP_DIRS
        : slider.type === 'r' ? ROOK_DIRS
          : slider.type === 'q' ? ALL_DIRS : [];
      for (const [df, dr] of dirs) {
        let f2 = f + df;
        let r2 = r + dr;
        let blocker = null;
        while (nameOf(f2, r2)) {
          const sq = nameOf(f2, r2);
          const piece = chess.get(sq);
          if (piece) {
            if (piece.color === color) break;          // our own piece stops the ray
            if (!blocker) {
              blocker = { sq, piece };
            } else {
              // Second enemy piece: is it worth more than the blocker?
              const anchorVal = piece.type === 'k' ? 100 : valueOf(piece);
              if (anchorVal >= 5 && anchorVal > valueOf(blocker.piece)) pinned.add(blocker.sq);
              break;
            }
          }
          f2 += df;
          r2 += dr;
        }
      }
    }
  }
  return pinned;
}

function isPin(ply, before) {
  const beforePins = before ? pinnedSquares(before, ply.move.color) : new Set();
  const afterPins = pinnedSquares(ply.after, ply.move.color);
  for (const sq of afterPins) if (!beforePins.has(sq)) return true;
  return false;
}

/** Slider alignments where a valuable piece sits in front of a lesser one. */
function skewerSignatures(chess, color) {
  const found = new Set();
  for (let f = 0; f < 8; f += 1) {
    for (let r = 0; r < 8; r += 1) {
      const from = nameOf(f, r);
      const slider = chess.get(from);
      if (!slider || slider.color !== color) continue;
      const dirs = slider.type === 'b' ? BISHOP_DIRS
        : slider.type === 'r' ? ROOK_DIRS
          : slider.type === 'q' ? ALL_DIRS : [];
      for (const [df, dr] of dirs) {
        let f2 = f + df;
        let r2 = r + dr;
        const seen = [];
        while (nameOf(f2, r2)) {
          const sq = nameOf(f2, r2);
          const piece = chess.get(sq);
          if (piece) {
            if (piece.color === color) break;
            seen.push({ sq, piece });
            if (seen.length === 2) break;
          }
          f2 += df;
          r2 += dr;
        }
        if (seen.length === 2) {
          const [front, back] = seen;
          const frontVal = front.piece.type === 'k' ? 100 : valueOf(front.piece);
          const backVal = back.piece.type === 'k' ? 100 : valueOf(back.piece);
          if (frontVal >= 5 && backVal >= 3) found.add(`${from}|${front.sq}|${back.sq}`);
        }
      }
    }
  }
  return found;
}

/** A skewer the move just created (or one the moved slider now delivers). */
function isSkewer(ply, before) {
  const after = skewerSignatures(ply.after, ply.move.color);
  if (!after.size) return false;
  const prior = before ? skewerSignatures(before, ply.move.color) : new Set();
  for (const sig of after) {
    if (!prior.has(sig)) return true;
    if (sig.startsWith(`${ply.move.to}|`)) return true;
  }
  return false;
}

function isDiscoveredAttack(ply, before) {
  if (!before) return false;
  const color = ply.move.color;
  const beforePairs = attackPairs(before, color);
  const afterPairs = attackPairs(ply.after, color);
  for (const pair of afterPairs) {
    if (beforePairs.has(pair)) continue;
    const [from, to] = pair.split('>');
    if (from === ply.move.to) continue;         // the moved piece itself
    if (from === ply.move.from) continue;
    const target = ply.after.get(to);
    if (target && (target.type === 'k' || valueOf(target) >= 3)) return true;
  }
  return false;
}

function isDiscoveredCheck(ply) {
  if (!ply.isCheck) return false;
  const enemyKing = kingSquare(ply.after, other(ply.move.color));
  if (!enemyKing) return false;
  const checkers = ply.after.attackers(enemyKing, ply.move.color);
  return checkers.some((sq) => sq !== ply.move.to);
}

function isDoubleCheck(ply) {
  if (!ply.isCheck) return false;
  const enemyKing = kingSquare(ply.after, other(ply.move.color));
  if (!enemyKing) return false;
  return ply.after.attackers(enemyKing, ply.move.color).length >= 2;
}

/** Mate on the home rank, the king boxed in by its own men. */
function isBackRankMate(ply) {
  if (!ply.isCheckmate) return false;
  if (ply.move.piece !== 'r' && ply.move.piece !== 'q') return false;
  const mated = other(ply.move.color);
  const kingSq = kingSquare(ply.after, mated);
  if (!kingSq) return false;
  const homeRank = mated === 'w' ? 0 : 7;
  if (rankOf(kingSq) !== homeRank) return false;
  if (rankOf(ply.move.to) !== homeRank) return false;   // delivered along the back rank
  const kf = fileOf(kingSq);
  const inward = mated === 'w' ? 1 : -1;

  let pawnWall = 0;
  let rankBlockers = 0;
  for (const df of [-1, 0, 1]) {
    const front = nameOf(kf + df, homeRank + inward);
    const frontPiece = front ? ply.after.get(front) : null;
    if (frontPiece && frontPiece.color === mated && frontPiece.type === 'p') pawnWall += 1;

    const beside = nameOf(kf + df, homeRank);
    if (!beside) { rankBlockers += 1; continue; }
    const besidePiece = ply.after.get(beside);
    if (beside === kingSq) rankBlockers += 1;
    else if (besidePiece && besidePiece.color === mated) rankBlockers += 1;
  }
  return pawnWall >= 2 || rankBlockers >= 2;
}

function isSmotheredMate(ply) {
  if (!ply.isCheckmate || ply.move.piece !== 'n') return false;
  const mated = other(ply.move.color);
  const kingSq = kingSquare(ply.after, mated);
  if (!kingSq) return false;
  const kf = fileOf(kingSq);
  const kr = rankOf(kingSq);
  let own = 0;
  let open = 0;
  for (const [df, dr] of KING_OFFSETS) {
    const sq = nameOf(kf + df, kr + dr);
    if (!sq) continue;
    const piece = ply.after.get(sq);
    if (piece && piece.color === mated) own += 1;
    else open += 1;
  }
  return open === 0 && own >= 2;
}

function isArabianMate(ply) {
  if (!ply.isCheckmate) return false;
  const color = ply.move.color;
  const mated = other(color);
  const kingSq = kingSquare(ply.after, mated);
  if (!kingSq) return false;
  const kf = fileOf(kingSq);
  const kr = rankOf(kingSq);
  const corner = (kf === 0 || kf === 7) && (kr === 0 || kr === 7);
  if (!corner) return false;
  if (ply.move.piece !== 'r') return false;
  // A friendly knight must cover the king's flight squares.
  let knightCovers = false;
  for (let f = 0; f < 8; f += 1) {
    for (let r = 0; r < 8; r += 1) {
      const sq = nameOf(f, r);
      const piece = ply.after.get(sq);
      if (!piece || piece.color !== color || piece.type !== 'n') continue;
      const reach = attackedSquares(ply.after, sq);
      if (KING_OFFSETS.some(([df, dr]) => {
        const t = nameOf(kf + df, kr + dr);
        return t && reach.has(t);
      })) knightCovers = true;
    }
  }
  return knightCovers;
}

function isAnastasiaMate(ply) {
  if (!ply.isCheckmate) return false;
  const color = ply.move.color;
  const mated = other(color);
  const kingSq = kingSquare(ply.after, mated);
  if (!kingSq) return false;
  const kf = fileOf(kingSq);
  if (kf !== 0 && kf !== 7) return false;              // king pinned to an edge file
  if (rankOf(kingSq) === 0 || rankOf(kingSq) === 7) return false; // not a corner (that is Arabian)
  if (ply.move.piece !== 'r' && ply.move.piece !== 'q') return false;
  // The mating slider attacks along the edge file.
  if (fileOf(ply.move.to) !== kf) return false;
  let knightCovers = false;
  for (let f = 0; f < 8; f += 1) {
    for (let r = 0; r < 8; r += 1) {
      const sq = nameOf(f, r);
      const piece = ply.after.get(sq);
      if (!piece || piece.color !== color || piece.type !== 'n') continue;
      const reach = attackedSquares(ply.after, sq);
      const inward = nameOf(kf === 0 ? 1 : 6, rankOf(kingSq));
      if (inward && reach.has(inward)) knightCovers = true;
    }
  }
  return knightCovers;
}

/** The solver's first move takes a loose piece worth at least a minor. */
function isHangingPiece(ply) {
  if (!ply.isSolver) return false;
  const { move, after } = ply;
  if (!move.captured) return false;
  const capturedValue = VALUE[move.captured] ?? 0;
  if (capturedValue < 3) return false;
  // Was the captured piece defended?
  const defenders = after.attackers(move.to, after.turn());
  return defenders.length === 0;
}

/* ── line-level detection ──────────────────────────────────────────────── */

/**
 * Detect every theme the line genuinely shows.
 *
 * @param {string} startFen  position with the solver to move
 * @param {string[]} moves   SAN moves, solver first
 * @returns {{ themes: string[], solverMoves: number, mateIn: number|null }}
 */
function detectThemes(startFen, moves) {
  const themes = new Set();
  let line;
  try {
    line = buildLine(startFen, moves);
  } catch {
    return { themes: [], solverMoves: 0, mateIn: null };
  }
  const { plies, solver, final } = line;
  if (!plies.length) return { themes: [], solverMoves: 0, mateIn: null };

  let mateIn = null;
  let promotions = false;

  for (let i = 0; i < plies.length; i += 1) {
    const ply = plies[i];
    const before = i > 0 ? plies[i - 1].after : null;
    const prev = before ? new Chess(before.fen()) : new Chess(startFen);

    if (ply.isSolver) {
      if (isFork(ply)) themes.add('fork');
      if (isPin(ply, prev)) themes.add('pin');
      if (isSkewer(ply, prev)) themes.add('skewer');
      if (isDiscoveredAttack(ply, prev)) themes.add('discoveredAttack');
      if (isDoubleCheck(ply)) themes.add('doubleCheck');
      if (isDiscoveredCheck(ply)) themes.add('discoveredCheck');
      if (isHangingPiece(ply)) themes.add('hangingPiece');
      if (ply.move.promotion) promotions = true;
      if (ply.isCheckmate) {
        const n = ply.solverIndex + 1;
        if (mateIn == null) mateIn = n;
        if (isBackRankMate(ply)) themes.add('backRankMate');
        if (isSmotheredMate(ply)) themes.add('smotheredMate');
        if (isArabianMate(ply)) themes.add('arabianMate');
        if (isAnastasiaMate(ply)) themes.add('anastasiaMate');
      }
    }
  }

  if (promotions) themes.add('promotion');
  if (mateIn === 1) themes.add('mateIn1');
  if (mateIn === 2) themes.add('mateIn2');
  if (mateIn === 3) themes.add('mateIn3');

  return {
    themes: [...themes],
    solverMoves: plies.filter((p) => p.isSolver).length,
    mateIn,
    solver,
    finalFen: final.fen(),
  };
}

module.exports = {
  detectThemes,
  attackedSquares,
  kingSquare,
  valueOf,
  VALUE,
};
