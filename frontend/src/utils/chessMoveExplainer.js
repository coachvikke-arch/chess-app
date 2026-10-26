import { Chess } from 'chess.js';
import { REVIEW_ENGINE_VERSION, LIVE_ANALYSIS_DEPTH, LIVE_ANALYSIS_MULTIPV } from './reviewConfig.js';

/* Deterministic move-explanation engine for the GM replay card.
 *
 * Every statement is derived from an exact FEN + engine MultiPV lines through
 * chess.js — nothing is invented; anything unprovable degrades to an honest
 * "no clear purpose" with low confidence. Evals cross between the White and
 * the mover perspective only through the helpers below, so a Black move's
 * card can never quote a White-perspective number as its own.
 *
 * Input: { fen, side, playedUci, playedSan, moveNumber, lossCp, lines }
 *   - fen        position BEFORE the played move ('start' allowed).
 *   - side       mover ('w'|'b'); must match the FEN's side to move.
 *   - lossCp     centipawns the played move gave up vs the engine's best
 *                (the canonical row's mover-perspective `cpl`), optional.
 *   - lines      engine lines [{ uci, score, mate, pv }] with White-perspective
 *                scores, ordered best-first (the canonical review rows' shape).
 * Output: { movePurpose, strategicPlan, alternativeComparison,
 *           principalVariation, confidence }.
 */

export const EXPLANATION_VERSION = 1;

export const EXPLAIN_ENGINE_VERSION = `${REVIEW_ENGINE_VERSION}+d${LIVE_ANALYSIS_DEPTH}+m${LIVE_ANALYSIS_MULTIPV}`;

const PIECE_NAME = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const PIECE_VALUE_CP = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
const CENTER = new Set(['d4', 'd5', 'e4', 'e5']);
const NEAR_CENTER = /([c-f][3-6])$/;
const HOME_SQUARES = {
  w: { n: ['b1', 'g1'], b: ['c1', 'f1'], r: ['a1', 'h1'] },
  b: { n: ['b8', 'g8'], b: ['c8', 'f8'], r: ['a8', 'h8'] },
};
const BISHOP_HOME = { w: ['c1', 'f1'], b: ['c8', 'f8'] };
const PV_MAX = 6;
const ALT_MAX = 3;
const LINES_MAX = 4;
const NOISE_PAWNS = 0.1;

export function toMoverPerspective(whiteCp, side) {
  if (whiteCp == null || !Number.isFinite(Number(whiteCp))) return null;
  const cp = Number(whiteCp);
  return side === 'b' ? -cp : cp;
}

export function toWhitePerspective(moverCp, side) {
  if (moverCp == null || !Number.isFinite(Number(moverCp))) return null;
  const cp = Number(moverCp);
  return side === 'b' ? -cp : cp;
}

export function formatPawnEval(cp, mate) {
  if (mate != null && Number.isFinite(Number(mate))) {
    const m = Number(mate);
    return m > 0 ? `M${Math.abs(m)}` : `−M${Math.abs(m)}`;
  }
  if (cp == null || !Number.isFinite(Number(cp))) return null;
  const pawns = Number(cp) / 100;
  const text = Math.abs(pawns).toFixed(1);
  if (pawns > 0) return `+${text}`;
  if (pawns < 0) return `−${text}`;
  return '0.0';
}

/* The mover-perspective string for the card header: a Black move flips both
 * the centipawn eval and the mate sign, so "what is this worth for ME" reads
 * right on either colour. White-perspective input stays untouched. */
export function formatMoverEval(whiteCp, whiteMate, side) {
  const mate = whiteMate != null && Number.isFinite(Number(whiteMate))
    ? (side === 'b' ? -Number(whiteMate) : Number(whiteMate))
    : null;
  if (mate !== null) return formatPawnEval(null, mate);
  return formatPawnEval(toMoverPerspective(whiteCp, side), null);
}

function enemyOf(side) {
  return side === 'w' ? 'b' : 'w';
}

function nameOf(type) {
  return PIECE_NAME[type] || 'piece';
}

function safeGame(fen) {
  const source = typeof fen === 'string' && fen.trim() && fen.trim() !== 'start' ? fen.trim() : undefined;
  try {
    return new Chess(source);
  } catch {
    return null;
  }
}

function applyUci(game, uci) {
  if (!game || typeof uci !== 'string' || uci.length < 4) return null;
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const promotion = uci.length > 4 ? uci[4] : undefined;
  try {
    return game.move({ from, to, promotion });
  } catch {
    return null;
  }
}

/* Validate the engine's best line ply by ply in the EXACT position before the
 * played move. The first illegal entry ends the walk — only the surviving
 * legal prefix is returned, never extended. */
export function principalVariationFrom(fen, pv) {
  if (!Array.isArray(pv) || pv.length === 0) return null;
  const game = safeGame(fen);
  if (!game) return null;
  const sans = [];
  for (const entry of pv) {
    let move = null;
    if (entry && typeof entry === 'object' && typeof entry.san === 'string') {
      try {
        move = game.move(entry.san);
      } catch {
        move = null;
      }
    }
    if (!move) {
      const uci = entry && typeof entry === 'object' ? entry.uci : entry;
      move = applyUci(game, typeof uci === 'string' ? uci : null);
    }
    if (!move) break;
    sans.push(move.san);
    if (sans.length >= PV_MAX) break;
  }
  if (!sans.length) return null;
  return { sans, truncated: sans.length < Math.min(pv.length, PV_MAX) };
}

/* Pieces of `color` standing attacked and completely undefended in `fen`.
 * The king counts as a defender (attackers() includes it), so a piece held by
 * the king is never called hanging. */
function attackedUndefended(fen, color) {
  const game = safeGame(fen);
  if (!game) return [];
  const out = [];
  try {
    for (const row of game.board()) {
      for (const piece of row) {
        if (!piece || piece.color !== color) continue;
        const attackers = game.attackers(piece.square, enemyOf(color)).length;
        const defenders = game.attackers(piece.square, color).length;
        if (attackers > 0 && defenders === 0) out.push({ type: piece.type, square: piece.square });
      }
    }
  } catch {
    return out;
  }
  return out;
}

function isEndgame(fen) {
  const game = safeGame(fen);
  if (!game) return false;
  let heavy = 0;
  let queens = 0;
  try {
    for (const row of game.board()) {
      for (const piece of row) {
        if (!piece) continue;
        if (piece.type === 'n' || piece.type === 'b' || piece.type === 'r') heavy += 1;
        if (piece.type === 'q') queens += 1;
      }
    }
  } catch {
    return false;
  }
  return queens === 0 && heavy <= 6;
}

function fenSide(fen) {
  const match = typeof fen === 'string' ? fen.match(/\s([wb])\s/) : null;
  return match ? match[1] : 'w';
}

/* Validate engine lines for legality in the exact FEN. Illegal entries are
 * dropped, duplicates merged, rank order preserved, list capped. */
function validateLines(lines, fen) {
  const out = [];
  const seen = new Set();
  for (const entry of Array.isArray(lines) ? lines : []) {
    if (!entry || typeof entry !== 'object') continue;
    const uci = typeof entry.uci === 'string' ? entry.uci : null;
    if (!uci || uci.length < 4 || seen.has(uci)) continue;
    const mv = applyUci(safeGame(fen), uci);
    if (!mv || mv.color !== fenSide(fen)) continue;
    seen.add(uci);
    out.push({
      uci,
      san: mv.san,
      score: entry.score == null ? null : Number(entry.score),
      mate: entry.mate == null ? null : Number(entry.mate),
      pv: Array.isArray(entry.pv) ? entry.pv : null,
    });
    if (out.length >= LINES_MAX) break;
  }
  return out;
}

function extractPurposeFacts(fen, fenAfter, mv, side, moveNumber) {
  const gameBefore = safeGame(fen);
  const gameAfter = safeGame(fenAfter);
  const enemy = enemyOf(side);
  const facts = {
    piece: mv.piece,
    pieceName: nameOf(mv.piece),
    from: mv.from,
    to: mv.to,
    san: mv.san,
    check: mv.san.endsWith('+'),
    mate: mv.san.endsWith('#'),
    castling: mv.flags.includes('k') ? 'kingside' : mv.flags.includes('q') ? 'queenside' : null,
    promotion: mv.promotion ? nameOf(mv.promotion) : null,
    endgame: isEndgame(fen),
    capture: null,
    offer: null,
    rescue: null,
    freshTargets: [],
    development: null,
    central: null,
    openDiagonal: null,
    openFile: null,
    kingStep: null,
    pawnPush: mv.piece === 'p' && !mv.flags.includes('c') && !mv.flags.includes('e'),
  };

  if (mv.captured) {
    const square = mv.flags.includes('e')
      ? mv.to[0] + String(Number(mv.to[1]) + (side === 'w' ? -1 : 1))
      : mv.to;
    facts.capture = {
      piece: mv.captured,
      pieceName: nameOf(mv.captured),
      square,
      enPassant: mv.flags.includes('e'),
      defended: gameBefore ? gameBefore.attackers(square, enemy).length > 0 : false,
    };
  }

  if (gameAfter && !facts.castling) {
    const toAttackers = gameAfter.attackers(mv.to, enemy).length;
    const toDefenders = gameAfter.attackers(mv.to, side).length;
    const gained = mv.captured ? PIECE_VALUE_CP[mv.captured] : 0;
    if (toAttackers > 0 && toDefenders === 0 && PIECE_VALUE_CP[mv.piece] > gained) {
      facts.offer = { pieceName: facts.pieceName, square: mv.to };
    }
  }

  if (gameBefore && gameAfter && !facts.capture && !facts.castling) {
    const fromAttackers = gameBefore.attackers(mv.from, enemy).length;
    const fromDefenders = gameBefore.attackers(mv.from, side).length;
    if (fromAttackers > 0 && fromDefenders === 0) {
      const toAttackers = gameAfter.attackers(mv.to, enemy).length;
      const toDefenders = gameAfter.attackers(mv.to, side).length;
      if (toAttackers === 0 || toDefenders > toAttackers) {
        facts.rescue = { pieceName: facts.pieceName, from: mv.from };
      }
    }
  }

  if (gameAfter) {
    const beforeKeys = new Set(attackedUndefended(fen, enemy).map((f) => f.square));
    facts.freshTargets = attackedUndefended(fenAfter, enemy)
      .filter((f) => !beforeKeys.has(f.square))
      .slice(0, 3);
  }

  if (!facts.capture && (mv.piece === 'n' || mv.piece === 'b')) {
    const homes = HOME_SQUARES[side][mv.piece] || [];
    if (moveNumber <= 15 && homes.includes(mv.from)) {
      facts.development = { pieceName: facts.pieceName, from: mv.from };
    }
  }

  if (CENTER.has(mv.to)) facts.central = { square: mv.to };

  if (mv.piece === 'p' && gameBefore) {
    for (const home of BISHOP_HOME[side]) {
      const bishop = gameBefore.get(home);
      if (!bishop || bishop.color !== side) continue;
      const bf = home.charCodeAt(0) - 97;
      const br = Number(home[1]) - 1;
      const ff = mv.from.charCodeAt(0) - 97;
      const fr = Number(mv.from[1]) - 1;
      if (Math.abs(bf - ff) !== Math.abs(br - fr) || bf === ff) continue;
      if (diagonalClearThrough(gameAfter, home)) {
        facts.openDiagonal = { from: mv.from, bishop: home };
        break;
      }
    }
  }

  if (mv.piece === 'r' && gameAfter && mv.from[0] !== mv.to[0]) {
    const file = mv.to[0];
    let ownPawns = 0;
    let enemyPawns = 0;
    for (const row of gameAfter.board()) {
      for (const piece of row) {
        if (piece && piece.type === 'p' && piece.square[0] === file) {
          if (piece.color === side) ownPawns += 1;
          else enemyPawns += 1;
        }
      }
    }
    if (ownPawns === 0) facts.openFile = { file, halfOpen: enemyPawns > 0 };
  }

  if (mv.piece === 'k' && !facts.castling && facts.endgame && NEAR_CENTER.test(mv.to)) {
    facts.kingStep = { square: mv.to };
  }

  return facts;
}

/* Whether the diagonal from the bishop's home square reaches the board edge
 * unobstructed AFTER the position `game`. This is the check that turns "a
 * pawn moved" into the verifiable "a diagonal opened". */
function diagonalClearThrough(game, home) {
  try {
    const board = game.board();
    const bf = home.charCodeAt(0) - 97;
    const br = 8 - Number(home[1]);
    const sf = br === 0 ? 1 : -1;
    const f = bf + sf;
    const r = br + sf;
    if (r < 0 || r > 7 || f < 0 || f > 7) return false;
    return !board[r][f];
  } catch {
    return false;
  }
}

function buildPurpose(facts, side) {
  const color = side === 'w' ? 'White' : 'Black';
  if (facts.mate) return { headline: `${color} checkmates — the game ends on this very move.`, verified: true };
  if (facts.promotion) return { headline: `${color} promotes the pawn to a ${facts.promotion} on ${facts.to}.`, verified: true };
  if (facts.castling) return { headline: `${color} castles ${facts.castling}.`, verified: true };
  if (facts.capture) {
    const cap = facts.capture;
    const free = cap.defended ? '' : ', which nothing defended';
    if (facts.check) return { headline: `${color} gives check and collects the ${cap.pieceName} on ${cap.square}${free}.`, verified: true };
    return { headline: `${color} wins the ${cap.pieceName} on ${cap.square}${free}.`, verified: true };
  }
  if (facts.offer) {
    return { headline: `${color} leaves the ${facts.offer.pieceName} capturable on ${facts.to} — a material offer for what follows.`, verified: true };
  }
  if (facts.rescue) return { headline: `${color} moves the attacked ${facts.rescue.pieceName} out of fire and to ${facts.to}.`, verified: true };
  if (facts.freshTargets.length) {
    const target = facts.freshTargets[0];
    return { headline: `${color} opens an attack on the undefended ${nameOf(target.type)} on ${target.square}.`, verified: true };
  }
  if (facts.check) return { headline: `${color} checks from ${facts.to}, so the reply is forced.`, verified: true };
  if (facts.development) return { headline: `${color} develops the ${facts.development.pieceName} off its starting square toward the middle.`, verified: true };
  if (facts.central) return { headline: `${color} occupies the centre with the ${facts.pieceName} on ${facts.to}.`, verified: true };
  if (facts.openDiagonal) return { headline: `${color} opens the diagonal for the bishop on ${facts.openDiagonal.bishop}.`, verified: true };
  if (facts.openFile) return { headline: `${color} posts a rook onto the ${facts.openFile.halfOpen ? 'half-open' : 'open'} ${facts.openFile.file}-file.`, verified: true };
  if (facts.kingStep) return { headline: `${color} walks the king toward the middle — in the endgame the king is a piece.`, verified: true };
  if (facts.pawnPush && NEAR_CENTER.test(facts.to)) return { headline: `${color} gains space with a pawn on ${facts.to}.`, verified: true };
  return null;
}

function buildDetails(facts) {
  const details = [];
  if (facts.capture && facts.capture.enPassant) details.push('The capture is en passant — the pawn leaves along a diagonal.');
  if (facts.offer && facts.capture) {
    details.push(`The ${facts.pieceName} itself now stands attacked and undefended on ${facts.to}.`);
  }
  if (facts.freshTargets.length) {
    for (const target of facts.freshTargets.slice(0, 2)) {
      details.push(`The ${nameOf(target.type)} on ${target.square} now stands attacked and undefended.`);
    }
  }
  if (facts.check && !facts.mate) details.push('Check forces the reply before any other plan can start.');
  return details.slice(0, 4);
}

function buildPlan(facts, side, moveNumber) {
  let shortTerm;
  let longTerm;
  let contribution;

  if (facts.mate) {
    shortTerm = 'Nothing else is on the board any more — the mate is delivered.';
    longTerm = 'No long-term plan remains; the game is decided.';
    contribution = 'This move ends the game.';
  } else if (facts.promotion) {
    shortTerm = `Right away, a new ${facts.promotion} replaces the pawn on ${facts.to}.`;
    longTerm = 'The extra heavy piece decides how the rest of the game is steered.';
    contribution = 'This move converts a passed pawn into lasting material.';
  } else if (facts.castling) {
    shortTerm = 'Right away, the king leaves the centre and the rook enters the game.';
    longTerm = 'Connected rooks and a sheltered king give every later plan a base.';
    contribution = 'This move buys king safety and rook activation in one tempo.';
  } else if (facts.capture) {
    const cap = facts.capture;
    shortTerm = `Right away, the ${cap.pieceName} is collected on ${cap.square}${cap.defended ? ' — its defender stands, so a recapture is expected' : ' — it hung with no defender'}.`;
    longTerm = 'Secured material shapes the long-term plan: convert or suffocate.';
    contribution = facts.offer
      ? 'This move trades material and the fight continues.'
      : "This move shifts the material balance into the mover's favour.";
  } else if (facts.offer) {
    shortTerm = `Right away, material sits in the pot — the ${facts.offer.pieceName} can be taken on ${facts.to} and the follow-up decides the score.`;
    longTerm = 'The long-term idea only holds if the compensation survives the forced sequence.';
    contribution = 'This move offers material and leaves the count to the engine.';
  } else if (facts.rescue) {
    shortTerm = `Right away, the ${facts.rescue.pieceName} steps out of its attacker's reach.`;
    longTerm = 'Once the loose piece is safe, the position regroups at normal speed.';
    contribution = 'This move repairs the position where it was broken.';
  } else if (facts.freshTargets.length) {
    const target = facts.freshTargets[0];
    shortTerm = `Right away, the ${nameOf(target.type)} on ${target.square} has to answer for itself.`;
    longTerm = 'An exposed piece tends to decide the next few moves long before the endgame.';
    contribution = 'This move turns pressure into a problem the opponent must solve.';
  } else if (facts.check) {
    shortTerm = `Right away, the enemy king must answer the check from ${facts.to}.`;
    longTerm = 'Being checked burns a tempo, so the initiative stays with the mover.';
    contribution = 'This move earns a tempo by forcing the reply.';
  } else if (facts.development) {
    shortTerm = `Right away, a ${facts.development.pieceName} joins the game from ${facts.development.from}.`;
    longTerm = 'Development converts into options: castling, exchanges and tactics all run through it.';
    contribution = 'This move grows the coordinated army.';
  } else if (facts.central) {
    shortTerm = `Right away, the ${facts.pieceName} claims a central square (${facts.to}).`;
    longTerm = 'A central presence limits where the enemy pieces can ever settle.';
    contribution = 'This move builds lasting central control.';
  } else if (facts.openDiagonal) {
    shortTerm = 'Right away, the bishop takes its lane into the position.';
    longTerm = `The bishop on ${facts.openDiagonal.bishop} now works through a long, clear diagonal.`;
    contribution = 'This move frees a piece the pawn chain was holding back.';
  } else if (facts.openFile) {
    shortTerm = `Right away, the rook owns the ${facts.openFile.file}-file.`;
    longTerm = 'Open files carry rooks into the enemy camp long after this move.';
    contribution = 'This move commits a heavy piece to the open line.';
  } else if (facts.kingStep) {
    shortTerm = `Right away, the king steps to ${facts.to}, toward the middle.`;
    longTerm = 'A centralised king supports pawn pushes and hunts the enemy king.';
    contribution = 'This move activates the strongest piece of a small endgame.';
  } else if (facts.pawnPush && moveNumber <= 20) {
    shortTerm = `Right away, the pawn stakes out space on the ${facts.to[0]}-file.`;
    longTerm = 'Space decides where pieces commit, so each pawn step leaves a mark.';
    contribution = 'This move spends a tempo on space.';
  } else {
    shortTerm = 'No concrete short-term aim is visible in this exact position.';
    longTerm = 'No long-term consequence is provable from the position; the engine evaluation is the guide.';
    contribution = 'The measured contribution of this move is not provable from the facts on the board.';
  }
  return { shortTerm, longTerm, contribution };
}

/* What a candidate line's FIRST move visibly aims to do — derived by applying
 * it to the exact pre-move position, so it can never name a capture or check
 * that is not there. */
function aimOf(fen, uci) {
  const probe = safeGame(fen);
  const mv = applyUci(probe, uci);
  if (!mv) return null;
  let aims;
  if (mv.san.endsWith('#')) aims = 'delivers mate';
  else if (mv.captured) aims = `removes the ${nameOf(mv.captured)} on ${mv.to}`;
  else if (mv.san.endsWith('+')) aims = `gives check from ${mv.to}`;
  else if (mv.flags.includes('k') || mv.flags.includes('q')) aims = 'castles';
  else if (mv.promotion) aims = `promotes to a ${nameOf(mv.promotion)}`;
  else if (CENTER.has(mv.to)) aims = `takes the middle on ${mv.to}`;
  else aims = `re-routes the ${nameOf(mv.piece)} from ${mv.from} to ${mv.to}`;
  return { san: mv.san, uci, aims };
}

/* One verifiable comparison between the played move and an engine line: when
 * that line would have captured a piece that the played move left standing. */
function playedMoveLeaves(fenAfter, aims) {
  const game = safeGame(fenAfter);
  if (!game) return null;
  const match = aims.match(/^removes the ([a-z]+) on ([a-h][1-8])$/);
  if (!match) return null;
  return game.get(match[2]) ? `the ${match[1]} still stands on ${match[2]}` : null;
}

export function buildMoveExplanation(input) {
  if (!input || typeof input !== 'object') return null;
  const fen = typeof input.fen === 'string' && input.fen.trim() ? input.fen.trim() : null;
  if (!fen) {
    return lowConfidenceFallback('No position is known for this move, so nothing is claimed.');
  }

  const side = input.side === 'b' ? 'b' : 'w';
  const gameBefore = safeGame(fen);
  if (!gameBefore) {
    return lowConfidenceFallback('The position could not be read, so no verified reason exists.');
  }

  const moveNumber = (() => {
    const n = Number(input.moveNumber);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
    const fullmove = Number(fen.split(' ')[5]);
    return Number.isFinite(fullmove) && fullmove > 0 ? fullmove : 1;
  })();

  let playedUci = typeof input.playedUci === 'string' && input.playedUci.length >= 4 ? input.playedUci : null;
  if (!playedUci && typeof input.playedSan === 'string' && input.playedSan) {
    try {
      const mv = gameBefore.move(input.playedSan);
      playedUci = mv.from + mv.to + (mv.promotion || '');
    } catch {
      playedUci = null;
    }
  }
  if (!playedUci) return lowConfidenceFallback('The played move could not be identified in this position.');

  if (gameBefore.turn() !== side) {
    return lowConfidenceFallback('The move does not match the side to move in this position.');
  }

  const played = applyUci(gameBefore, playedUci);
  if (!played) {
    return lowConfidenceFallback('The played move is not legal in this exact position, so no explanation is offered.');
  }
  const san = played.san;
  const fenAfter = gameBefore.fen();

  const lossCpRaw = Number(input.lossCp);
  const lossPawns = Number.isFinite(lossCpRaw) ? lossCpRaw / 100 : null;

  const facts = extractPurposeFacts(fen, fenAfter, played, side, moveNumber);
  const purpose = buildPurpose(facts, side);
  const details = buildDetails(facts);

  const lines = validateLines(input.lines, fen);
  const best = lines.length ? lines[0] : null;
  const playedIsBest = Boolean(best && (best.uci === playedUci || best.san === san));

  /* "Better alternatives": every engine line that is not the played move,
   * engine order kept. When the played move IS the top choice this lists the
   * runner-ups (tied or worse); otherwise the FIRST entry is the engine's own
   * preference. */
  const alternatives = [];
  if (best) {
    for (const line of lines) {
      if (alternatives.length >= ALT_MAX) break;
      if (line.uci === playedUci || line.san === san) continue;
      const aim = aimOf(fen, line.uci);
      if (!aim) continue;
      const cost = evalCost(best, line, side);
      alternatives.push({
        ...aim,
        evalCostPawns: cost,
        costLabel: costLabel(cost),
        comparison: null,
      });
    }
    /* When the played move differs from the engine's choice, the FIRST
     * alternative is the engine's own line — it carries the verified note
     * about what the played move left on the board, and the exact cost of
     * not taking the engine's advice. */
    if (!playedIsBest) {
      const entry = alternatives[0];
      if (entry && entry.uci === best.uci) {
        const note = playedMoveLeaves(fenAfter, entry.aims);
        const costText = lossPawns != null ? `about ${lossPawns.toFixed(2)} pawns` : 'an engine-undisclosed amount';
        entry.comparison = note
          ? `${san} leaves ${note}; ${best.san} ${entry.aims} instead. Not playing it was worth ${costText}.`
          : `${best.san} ${entry.aims}. Not playing it was worth ${costText}.`;
      }
    }
  }

  const alternativeComparison = {
    isEngineChoice: best ? playedIsBest : null,
    bestSan: best ? best.san : null,
    bestUci: best ? best.uci : null,
    alternatives,
    summary: !best
      ? 'No verified engine line exists for this exact position, so nothing is compared.'
      : playedIsBest
        ? `${san} is the engine’s own first choice — nothing better was available.`
        : `The engine preferred ${best.san} over ${san}.`,
    /* How much choosing the played move gave up, in pawns (mover perspective).
     * Zero for the engine's own choice, null when the engine tells us nothing
     * — never a made-up number. */
    playedCostPawns: best ? (playedIsBest ? 0 : lossPawns) : null,
  };

  const principalVariation = best
    ? principalVariationFrom(fen, best.pv)
    : null;

  return {
    movePurpose: purpose
      ? { headline: purpose.headline, details, verified: true }
      : { headline: 'The engine does not show a clear tactical or strategic purpose for this move.', details, verified: false },
    strategicPlan: buildPlan(facts, side, moveNumber),
    alternativeComparison,
    principalVariation,
    confidence: purpose && best ? 'high' : purpose ? 'medium' : 'low',
  };
}

function evalCost(lineBest, lineAlt, side) {
  if (!lineBest || !lineAlt) return null;
  if (lineBest.mate != null || lineAlt.mate != null) return null;
  if (lineBest.score == null || lineAlt.score == null) return null;
  const best = toMoverPerspective(lineBest.score, side);
  const alt = toMoverPerspective(lineAlt.score, side);
  if (best == null || alt == null) return null;
  return (best - alt) / 100;
}

function costLabel(cost) {
  if (cost == null) return null;
  if (Math.abs(cost) <= NOISE_PAWNS) return 'just as strong, within engine noise';
  return `about ${cost.toFixed(2)} pawns weaker than the engine's best`;
}

function lowConfidenceFallback(reason) {
  return {
    movePurpose: { headline: reason, details: [], verified: false },
    strategicPlan: { shortTerm: null, longTerm: null, contribution: null },
    alternativeComparison: { isEngineChoice: null, bestSan: null, bestUci: null, alternatives: [], summary: 'No verified comparison exists for this move.' },
    principalVariation: null,
    confidence: 'low',
  };
}

/* ── cache ──────────────────────────────────────────────────────────────────
 * Explanations are keyed by FEN + mover + move + engine configuration +
 * explanation-logic version. Navigation therefore NEVER re-serves a card from
 * a different position, and a changed engine or explanation version invalidates
 * every stored naturally. Bounded LRU, like the analysis cache above it. */
const cache = new Map();
const CACHE_MAX = 240;

export function explanationCacheKey(input) {
  if (!input || typeof input !== 'object') return null;
  const fen = typeof input.fen === 'string' ? input.fen : '';
  if (!fen) return null;
  const side = input.side === 'b' ? 'b' : 'w';
  const move = (typeof input.playedUci === 'string' && input.playedUci) || input.playedSan || '';
  return [fen, side, move, EXPLAIN_ENGINE_VERSION, EXPLANATION_VERSION].join('|');
}

export function getMoveExplanation(input) {
  const key = explanationCacheKey(input);
  if (!key) return null;
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }
  const built = buildMoveExplanation(input);
  if (built) {
    cache.set(key, built);
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  }
  return built;
}

export function clearExplanationCache() {
  cache.clear();
}
