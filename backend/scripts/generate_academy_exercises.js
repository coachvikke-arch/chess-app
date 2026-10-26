#!/usr/bin/env node
/**
 * Generates the Academy beginner drill packs.
 *
 * Run:  node scripts/generate_academy_exercises.js
 * Writes: src/data/academyExercises.generated.js
 *
 * WHY GENERATED
 * A piece-movement lesson teaches one rule ("a rook moves in straight lines"),
 * and the only way to really learn it is to repeat that rule across the whole
 * board. The hand-authored sets covered 2–4 squares per piece, which left real
 * gaps — a student could pass without ever sliding a rook sideways.
 *
 * WHY IT IS SAFE
 * Every `move` drill is machine-verified before it is written: the FEN must
 * parse and `expectedSan` must be a legal move in that exact position, matched
 * against chess.js's own SAN. Anything that fails is dropped, never emitted.
 */
const fs = require('fs');
const path = require('path');
const { Chess } = require('chess.js');

const OUT = path.join(__dirname, '..', 'src', 'data', 'academyExercises.generated.js');

const FILES = 'abcdefgh';
const RANKS = '12345678';
/* sq() takes 0-BASED file/rank indices and returns the algebraic name, so
   sq(4, 7) === 'e8'. (Indexing the RANKS *string* directly would give
   RANKS[7] === '8' and silently shift every square down a rank.) */
const sq = (f, r) => `${FILES[f]}${RANKS[r]}`;
const fOf = (n) => FILES.indexOf(n[0]);
const rOf = (n) => RANKS.indexOf(n[1]);
const inBoard = (s) => !!s && fOf(s) >= 0 && rOf(s) >= 0;

/* Where the idle white king is parked while a drill's real piece is tested.
   It must never collide with a square under test. Pawns can start on a2–h2 and
   the piece drills sweep ranks 3–6, so rank 1 is the only safe row — and the
   square used must be checked against the drill before it is placed. */
const IDLE_KING_SQUARES = ['a1', 'b1', 'c1', 'd1', 'g1', 'h1'];

/**
 * Add the spare white king a non-king drill needs (chess requires both kings).
 *
 * A drill position must contain exactly ONE white king — adding a second is an
 * illegal position that chess.js rejects. So when the piece under test is
 * already a king, nothing is added; otherwise a spare king is parked on a free
 * rank-1 square, chosen at runtime so it can never collide with the piece or
 * the target square under test.
 */
function withIdleKing(pieces) {
  const used = new Set(Object.keys(pieces));
  if ([...used].some((s) => pieces[s] === 'K')) {
    // A king is already on the board — that is the piece under test.
    return { ...pieces };
  }
  const spot = IDLE_KING_SQUARES.find((s) => !used.has(s));
  if (!spot) return null;
  return { ...pieces, [spot]: 'K' };
}

/** Build a FEN from a sparse {square: pieceChar} map. */
function buildFen(pieces, turn = 'w', extra = '') {
  const rows = [];
  for (let r = 7; r >= 0; r -= 1) {
    let row = '';
    let gap = 0;
    for (let f = 0; f < 8; f += 1) {
      const p = pieces[sq(f, r)];
      if (!p) { gap += 1; continue; }
      if (gap) { row += String(gap); gap = 0; }
      row += p;
    }
    if (gap) row += String(gap);
    rows.push(row);
  }
  /* FEN field order is: board, side, castling, en-passant, halfmove, fullmove.
     The en-passant field is ALWAYS present and always '-' when there is no
     en-passant target, so the string must be "- - 0 1" — omitting it makes
     chess.js read the halfmove clock as the en-passant square and throw. */
  return `${rows.join('/')} ${turn} - ${extra || '-'} 0 1`.replace(/ {2,}/g, ' ');
}

/**
 * Turn a (piece, from, to) triple into a verified move drill, or null when the
 * move is not legal / not by that piece in that position.
 */
function drill(pieceChar, from, to, instruction, hintLine) {
  // The idle white king is placed on a free rank-1 square so it can never
  // collide with the piece or square under test (an a1/h1 king clashed with
  // a-file and h-file pawn drills, producing invalid FENs).
  const placed = withIdleKing({ e8: 'k', [from]: pieceChar });
  if (!placed) return null;
  const fen = buildFen(placed);
  let game;
  try { game = new Chess(fen); } catch { return null; }
  /* NB: do NOT reject on isGameOver(). A lone bishop or knight against a bare
     king is flagged as "insufficient material" — i.e. already over — even
     though there are plenty of legal moves to drill. Rejecting those would
     silently produce zero bishop and knight exercises. */
  const mv = game.moves({ verbose: true }).find((m) => m.from === from && m.to === to);
  if (!mv) return null;
  return {
    type: 'move',
    fen,
    expectedSan: mv.san,
    instruction,
    hints: [hintLine, `From ${from}, ${to} is a legal move.`, `Drag the piece from ${from} to ${to}.`],
  };
}

/**
 * A move drill from an EXPLICIT full FEN, for positions that `buildFen`
 * cannot express (castling rights, en-passant targets, promotion ranks).
 *
 * Verified the same way `drill()` does: the FEN must parse and the from→to
 * move must be legal in it. Returns null rather than throwing, so a bad
 * position is dropped instead of killing the whole pack.
 */
function fenDrill(fen, from, to, instruction, hintLines = []) {
  let game;
  try { game = new Chess(fen); } catch (e) {
    if (process.env.ACADEMY_DEBUG) console.log(`  [bad-fen] ${fen} :: ${e.message}`);
    return null;
  }
  const mv = game.moves({ verbose: true }).find((m) => m.from === from && m.to === to);
  if (!mv) {
    if (process.env.ACADEMY_DEBUG) console.log(`  [illegal] ${from}->${to} in ${fen}`);
    return null;
  }
  return {
    type: 'move',
    fen,
    expectedSan: mv.san,
    instruction,
    hints: [
      ...hintLines,
      `From ${from}, ${to} is a legal move.`,
      `Drag the piece from ${from} to ${to}.`,
    ],
  };
}

/** All ray targets from `from` along the 8 directions. */
function rays(from) {
  const out = [];
  for (let df = -1; df <= 1; df += 1) {
    for (let dr = -1; dr <= 1; dr += 1) {
      if (!df && !dr) continue;
      for (let k = 1; k <= 7; k += 1) {
        const s = sq(fOf(from) + df * k, rOf(from) + dr * k);
        if (!inBoard(s)) break;
        out.push(s);
      }
    }
  }
  return out;
}

/**
 * BOARD DRILLS — Special rules.
 *
 * The special-rules lesson was 100% quiz, which is the wrong shape for a
 * lesson about three *moves*. Castling, en passant and promotion can only be
 * learned by playing them, so these are real positions: the student performs
 * the special move on the board instead of reading about it.
 *
 * `buildFen` cannot express castling rights or an en-passant target, so each
 * position is written as a full FEN and checked by `fenDrill`.
 */
function specialBoardPack() {
  const out = [];
  const push = (fen, from, to, instruction, hints) => {
    const d = fenDrill(fen, from, to, instruction, hints);
    if (d) out.push(d);
  };

  /* ── Kingside castling (O-O): king e1→g1, rook h1→f1 ── */
  // No f1/g1 blockers, black king out of the way, path not attacked.
  const OO = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
  push(OO, 'e1', 'g1', 'Castle kingside: move the king two squares to g1.', [
    'Castling is a special move — the king jumps two squares and the rook hops to the other side.',
  ]);
  // Repeated with a black bishop eyeing nothing: same idea, different square names.
  const OO2 = '4k3/8/8/8/8/8/8/4K2R w K - 0 1';
  push(OO2, 'e1', 'g1', 'Castle kingside with only the h1 rook available.', [
    'Only the h-rook can castle kingside.',
  ]);

  /* ── Queenside castling (O-O-O): king e1→c1, rook a1→d1 ── */
  const OOO = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
  push(OOO, 'e1', 'c1', 'Castle queenside: move the king two squares to c1.', [
    'Queenside castling takes the king to c1 and the a-rook to d1.',
  ]);
  const OOO2 = '4k3/8/8/8/8/8/8/R3K3 w Q - 0 1';
  push(OOO2, 'e1', 'c1', 'Castle queenside — the b1 knight has already moved away.', [
    'The squares between the king and the a-rook must be empty.',
  ]);

  /* ── En passant: white pawn on the 5th rank captures the black pawn that
        just double-stepped past it. The FEN's 4th field is the en-passant
        target square, which is what makes the capture legal. ── */
  const EP = '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2';
  push(EP, 'e5', 'd6', 'Capture en passant — take the pawn that just advanced two squares.', [
    'A pawn on the 5th rank may capture en passant only on the very next move.',
  ]);
  const EP2 = '4k3/8/8/2pP4/8/8/8/4K3 w - c6 0 2';
  push(EP2, 'd5', 'c6', 'Capture en passant to the left.', [
    'The en-passant capture works in either direction.',
  ]);
  /* The h-file case is deliberately omitted: capturing en passant onto h6 needs
     a black pawn that advanced h7-h5, which leaves no white pawn able to reach
     it from the 5th rank. Built with buildFen so the row is always 8 squares. */
  const EP3 = buildFen({ a1: 'K', e8: 'k', f5: 'p', e5: 'P' }, 'w', 'f6');
  push(EP3, 'e5', 'f6', 'Capture en passant to the right.', [
    'The en-passant capture works in either direction.',
  ]);

  /* ── Promotion: a white pawn reaching the 8th rank becomes a queen. ── */
  // Black king kept on e8 unless the pawn wants that square, in which case the
  // king steps to d8 — a FEN needs BOTH kings or chess.js rejects it.
  for (const f of 'abcdefgh') {
    const blackKing = f === 'e' ? 'd8' : 'e8';
    const fen = buildFen({ a1: 'K', [blackKing]: 'k', [`${f}7`]: 'P' });
    push(fen, `${f}7`, `${f}8`, `Push the pawn to ${f}8 — it promotes.`,
      ['A pawn reaching the far rank promotes immediately.']);
  }

  /* ── Pawn rules the quiz can only describe: no backwards move, blocked push,
        capture is diagonal-only. ── */
  const BACK = '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1';
  push(BACK, 'e2', 'e4', 'Push the pawn two squares from its starting rank.', [
    'A pawn on its home rank may move one OR two squares.',
  ]);
  const CAPD = '4k3/8/8/8/8/3n4/4P3/4K3 w - - 0 1';
  push(CAPD, 'e2', 'd3', 'Capture the black knight sitting diagonally in front.', [
    'A pawn captures one square diagonally forward, never straight ahead.',
  ]);
  const DOUBLE = '4k3/8/8/8/8/8/P7/4K3 w - - 0 1';
  push(DOUBLE, 'a2', 'a4', 'Advance the pawn two squares from a2.', [
    'The two-square step is only available from the starting rank.',
  ]);

  return out;
}

/**
 * BOARD DRILLS — Check.
 *
 * A check lesson should be *played*, not only described. These positions put
 * White in check and ask for the answer: move the king to safety, block the
 * line, or capture the checker — the three legal escapes named in the lesson.
 */
function checkBoardPack() {
  const out = [];
  /* `pos` places pieces on a sparse map and builds the FEN. This removes the
     whole class of hand-written-FEN bugs hit while filling these packs (missing
     black kings, rows of the wrong length, and pieces that were not actually on
     the square the drill asked them to move from). */
  const pos = (pieces, turn = 'w', extra = '-') => buildFen(pieces, turn, extra);
  const push = (fen, from, to, instruction, hint) => {
    const d = fenDrill(fen, from, to, instruction, [hint]);
    if (d) out.push(d);
  };

  /* Escape a FILE check: the rook checks the e-file from e4, leaving
     d1/f1/d2/f2 free. A checker on e2 would leave no room, so rank 4 is the
     closest it is ever placed. */
  for (const dest of ['d1', 'f1', 'd2', 'f2']) {
    push(pos({ e8: 'k', e4: 'r', e1: 'K' }), 'e1', dest,
      `The e4 rook checks the e-file - move the king to ${dest}.`,
      'The e-file is attacked, so step to any square off it.');
  }

  /* Escape a RANK check: a rook on rank 1 covers the whole rank, so the king
     has to climb. Swept across files so each is a distinct position. */
  for (const dest of ['d2', 'e2', 'f2']) {
    push(pos({ e8: 'k', a1: 'r', e1: 'K' }), 'e1', dest,
      `The a1 rook checks rank 1 - climb to ${dest}.`,
      'Rank 1 is attacked, so leave the rank entirely.');
  }
  for (const f of ['b', 'c', 'd', 'f']) {
    push(pos({ e8: 'k', [`${f}1`]: 'r', e1: 'K' }), 'e1', 'e2',
      `The ${f}1 rook checks along rank 1 - climb to e2.`,
      'Rank 1 is attacked, so leave the rank entirely.');
  }

  /* Escape a DIAGONAL check. The bishop must share a diagonal WITH the king:
     a5-b4-c3-d2-e1 runs through e1. The earlier "h3" bishop attacked f1, not
     e1, so the king was never in check and the "escape" taught nothing. */
  push(pos({ e8: 'k', a5: 'b', e1: 'K' }), 'e1', 'd1',
    'The a5 bishop checks down the long diagonal - step to d1.',
    'A bishop attacks diagonally only, so any off-diagonal square is safe.');
  push(pos({ e8: 'k', a5: 'b', e1: 'K' }), 'e1', 'd2',
    'The a5 bishop checks the long diagonal - step off it.',
    'Move off the checking diagonal; every other square is safe.');

  /* BLOCK a check. Two things must be true: the KING has to be on the line
     being blocked, and the blocking piece must be able to REACH that line.
     The earlier setup had the white king on a1 and the rooks on the d-file, so
     nothing was checking the king and "Rd2" was just a quiet move. Putting the
     white king on d1, between the two rooks, is what makes the block required. */
  for (const dest of ['d2', 'd3', 'd4']) {
    push(pos({ e8: 'k', d8: 'r', d1: 'K', h1: 'R' }), 'h1', dest,
      `Slide the h1 rook to ${dest} to block the check.`,
      'A sliding-piece check can be blocked by interposing a piece on the line.');
  }
  /* A black rook on h1 checks along the 1st rank, so the block must land
     between the white king on e1 and h1 — on b1, c1 or d1. The white rook on
     a1 slides there. (The earlier version put the black rook on h8, which
     checks the h-FILE, so the e1 king was never attacked.) */
  push(pos({ e8: 'k', h1: 'r', e1: 'K', a1: 'R' }), 'a1', 'c1',
    'Slide the a1 rook to c1 to block the check along the back rank.',
    'A block must land on the line between the checker and your king.');
  /* A pawn blocks by pushing straight up the checking file. */
  push(pos({ e8: 'k', d8: 'r', d1: 'K', c2: 'P' }), 'c2', 'c4',
    'Play c4 - the pawn blocks the rook check on the d-file.',
    'A pawn may interpose, but only by landing on the checking line.');

  /* CAPTURE the checker. The capturing piece must be able to reach it, and
     the king must be the one under attack (an earlier version put the king on
     a1 with the checker on e4, so the "capture" answered a check that never
     existed). */
  push(pos({ e8: 'k', e4: 'r', e1: 'K', a1: 'R' }), 'e1', 'e4',
    'Take the rook - capturing the checker answers the check.',
    'Removing the attacker is the third way to answer a check.');
  push(pos({ e8: 'k', e4: 'n', e1: 'K', a1: 'R' }), 'e1', 'e4',
    'Capture the checking knight.',
    'A knight check cannot be blocked, so capture it or move the king.');
  push(pos({ e8: 'k', d4: 'b', d1: 'K', a1: 'R' }), 'd1', 'd4',
    'Take the bishop - that answers the check.',
    'A diagonal check can also be answered by capturing the checker.');

  /* GIVE check. Black is to move and must land a piece ON a line that attacks
     the white king. The earlier set used a white king on e1 with the rook on
     the e-file, which meant the king was ALREADY in check before the move —
     and moves like "Rxe1" tried to capture a king, which is not a legal move.

     Here the white king sits in the a1 corner and the black piece travels onto
     rank 1, the a-file or the a1-h8 diagonal. The black king is parked out of
     the way (and never on a square a drill's own piece starts from). */
  const give = [
    ['b6', 'b1', 'Drop the rook onto the 1st rank to give check.', 'A rook checks along a rank as well as a file.', 'r', 'h7'],
    ['g6', 'g1', 'Drop the rook onto the 1st rank - the whole rank is covered.', 'A rook on the enemy back rank checks along it.', 'r', 'h7'],
    ['b7', 'b1', 'Slide the rook down the b-file onto the 1st rank.', 'A rook checks along a rank as well as a file.', 'r', 'a7'],
    ['c6', 'c1', 'Bring the rook to c1 for check along the back rank.', 'Any rook reaching the 1st rank with a clear line gives check.', 'r', 'h7'],
    ['a6', 'a8', 'Slide the rook up the a-file to give check.', 'A rook checks down any file that is clear of pieces.', 'r', 'h7'],
    ['a4', 'a6', 'Move the rook up the a-file so it attacks the king.', 'A rook on the same file as the enemy king is check.', 'r', 'h7'],
    ['b6', 'b1', 'Slide the queen onto the 1st rank to give check.', 'A queen checks along a rank, file or diagonal.', 'q', 'h7'],
    ['h6', 'h1', 'Drop the queen onto the 1st rank for check.', 'A queen checks along a rank as well as a file.', 'q', 'a7'],
    ['c3', 'c1', 'Step the queen to c1, checking along the back rank.', 'A queen checks along a rank as well as a file.', 'q', 'h7'],
    ['h8', 'b2', 'Slide the bishop to b2, onto the a1-h8 diagonal.', 'A bishop on the long diagonal checks the corner king.', 'b', 'a7'],
    ['g7', 'b2', 'Bring the bishop to b2 for check on the diagonal.', 'The bishop shares a diagonal with the king.', 'b', 'h8'],
    ['c5', 'b3', 'Jump the knight to b3 - it attacks the a1 king.', 'A knight checks from an L-shape away, never along a line.', 'n', 'h7'],
    ['d4', 'b3', 'Jump the knight to b3 to give check.', 'A knight checks from an L-shape away, never along a line.', 'n', 'h7'],
  ];
  for (const [from, to, instruction, hint, piece, kingSq] of give) {
    push(pos({ [kingSq]: 'k', a1: 'K', [from]: piece }, 'b'), from, to, instruction, hint);
  }

  return out;
}

/**
 * BOARD DRILLS — Checkmate.
 *
 * The student plays the mating move. Positions are built so the expected move
 * actually mates, and every one is verified by chess.js.
 */
function mateBoardPack() {
  const out = [];
  const push = (fen, from, to, instruction, hint) => {
    const d = fenDrill(fen, from, to, instruction, [hint]);
    if (d) out.push(d);
  };
  /* `pos` builds the FEN from a piece map, so every rank is exactly 8 squares
     wide. Hand-written rank strings are where the earlier version went wrong:
     one row was 9 squares and another only 7. */
  const pos = (pieces, turn = 'w') => buildFen(pieces, turn);

  /* The back-rank walls. Both shapes genuinely mate, and both are confirmed by
     the semantic gate rather than assumed:
       g8 wall — black king g8 behind its own f7/g7/h7 pawns.
       h8 wall — black king h8 behind f7/g7/h7; g8 is covered by the mating
                 rook once it reaches the 8th rank, so there is no flight.

     The earlier version used `5r1k`, which put a black ROOK on f8 and the king
     on h8 with g8 EMPTY: the king simply stepped out and the "mate" was not even
     check. `wall` is now passed in per drill so a position can never end up
     with two black kings. */
  const WALLS = [
    { pieces: { g8: 'k', f7: 'p', g7: 'p', h7: 'p' }, where: 'king on g8' },
    { pieces: { h8: 'k', f7: 'p', g7: 'p', h7: 'p' }, where: 'king on h8' },
  ];
  /** Put a white mating piece on `file`1 within `wall`, king parked clear. */
  const setup = (wall, file, piece, extra = {}) => {
    const p = { ...wall, ...extra, [file + '1']: piece };
    if (!p.a1) p.a1 = 'K';
    if (p.a1 === p[file + '1']) p.h1 = 'K';
    return p;
  };

  /* Back-rank mate: the piece slides straight up its own file. */
  for (const w of WALLS) {
    for (const f of 'bcde') {
      push(pos(setup(w.pieces, f, 'R')), `${f}1`, `${f}8`,
        `R${f}1 to ${f}8 is mate on the back rank (${w.where}).`,
        'The black king is trapped by its own pawns; a rook on the 8th rank mates.');
    }
    for (const f of 'bcde') {
      push(pos(setup(w.pieces, f, 'Q')), `${f}1`, `${f}8`,
        `Q${f}1 to ${f}8 is mate on the back rank (${w.where}).`,
        'A queen on the 8th rank mates a king boxed in by its own pawns.');
    }
  }
  /* Ladder mate: a second rook on the g-file covers the flight squares. */
  for (const f of 'abcd') {
    push(pos(setup(WALLS[0].pieces, f, 'R', { g1: 'R' })), `${f}1`, `${f}8`,
      `R${f}1 to ${f}8 mates, with the g1 rook covering the escape squares.`,
      'Two rooks mate together: one checks, the other covers the flight squares.');
  }
  /* Queen supported by a rook — a defended queen cannot be captured. */
  for (const f of 'abcd') {
    push(pos(setup(WALLS[0].pieces, f, 'Q', { g1: 'R' })), `${f}1`, `${f}8`,
      `Q${f}1 to ${f}8 is mate, supported by the g1 rook.`,
      'A supported queen on the 8th rank mates a boxed-in king.');
  }
  /* The mating rook already deep in the position, stepping onto the back rank
     sideways rather than sliding up the file. A different shape, so these are
     distinct positions rather than repeats of the drills above. */
  for (const w of WALLS) {
    for (const f of 'bcd') {
      push(pos(setup(w.pieces, f, 'R', { [`${f}6`]: 'R' })), `${f}6`, `${f}8`,
        `R${f}6 to ${f}8 is mate - the rook is already deep in the position.`,
        'A rook that has invaded the back rank mates a king shut in by pawns.');
    }
  }

  return out;
}

/**
 * BOARD DRILLS — Draws.
 *
 * A draw lesson is best learned by making the move that produces a drawn
 * position: trading into insufficient material, shuffling to repeat a
 * position, or finding the stalemate escape.
 */
function drawBoardPack() {
  const out = [];
  const pos = (pieces, turn = 'w') => buildFen(pieces, turn);
  const push = (fen, from, to, instruction, hint) => {
    const d = fenDrill(fen, from, to, instruction, [hint]);
    if (d) out.push(d);
  };

  /* IMPORTANT — why these are rook/pawn positions and not the obvious choices:
     chess.js refuses to generate moves for a position that is ALREADY OVER, so
     a "make the stalemating move" or "trade into insufficient material" drill
     is impossible to express as a move exercise — `moves()` returns [] and the
     drill is silently dropped. The draw lesson is therefore drilled through
     positions that are genuinely PLAYABLE and still drawn: repetition shuffles,
     fifty-move resets, and drawn rook endings. Stalemate and insufficient
     material are taught in the quiz half of this lesson, where they belong. */

  /* ── Threefold repetition: shuffle a piece between two squares ── */
  const shuffles = [
    ['b1', 'c3'], ['g1', 'f3'], ['c3', 'e4'], ['f3', 'e5'], ['b8', 'c6'], ['g8', 'f6'],
  ];
  for (const [from, to] of shuffles) {
    const white = from[1] === '1';
    const kingFile = white ? 'a' : 'h';
    const pieces = { [from]: 'N', [kingFile + (white ? '1' : '8')]: white ? 'K' : 'k' };
    if (white) pieces.e8 = 'k'; else pieces.e1 = 'K';
    push(pos(pieces), from, to,
      'Shuffle the knight - returning here three times is a draw by repetition.',
      'Threefold repetition needs the same pieces, squares and side to move.');
  }

  /* ── Fifty-move rule: a capture resets the clock ──
     Black keeps a rook and pawns on the board so the position is not already
     an automatic draw, which keeps `moves()` non-empty. */
  const captures = [
    [{ d1: 'R', a1: 'K', e8: 'k', d7: 'q' }, 'd1', 'd7'],
    [{ f1: 'R', h1: 'K', e8: 'k', f7: 'q' }, 'f1', 'f7'],
    [{ a1: 'R', h1: 'K', e8: 'k', a7: 'q' }, 'a1', 'a7'],
  ];
  for (const [pieces, from, to] of captures) {
    push(pos(pieces), from, to, 'Capture the queen - that resets the fifty-move clock.',
      'Any capture or pawn move resets the halfmove counter.');
  }
  /* A pawn push resets it too. The two-square step needs BOTH c3 and c4 (b3/b4,
     g3/g4) empty — a black piece on c4/b4/g4 blocks the pawn dead, which is why
     the black men here all sit on the 7th rank. */
  const pushes = [
    [{ c2: 'P', a1: 'K', e8: 'k', c7: 'q' }, 'c2', 'c4'],
    [{ b2: 'P', h1: 'K', e8: 'k', a7: 'q' }, 'b2', 'b4'],
    [{ g2: 'P', a1: 'K', e8: 'k', f7: 'q' }, 'g2', 'g4'],
  ];
  for (const [pieces, from, to] of pushes) {
    push(pos(pieces), from, to, 'Push the pawn - a pawn move also resets the clock.',
      'A pawn move resets the fifty-move counter just like a capture.');
  }

  /* ── Drawn rook endings: trade into one and hold on ──
     Rook vs rook with an even pawn count is a textbook draw. */
  const endings = [
    [{ d1: 'R', a1: 'K', e8: 'k', d3: 'r', d4: 'p' }, 'd1', 'd2'],
    [{ e1: 'R', h1: 'K', e8: 'k', e4: 'r', f5: 'p' }, 'e1', 'e2'],
    [{ a1: 'R', d1: 'K', e8: 'k', a3: 'r', b4: 'p' }, 'a1', 'a2'],
  ];
  for (const [pieces, from, to] of endings) {
    push(pos(pieces), from, to, 'Hold the rook close - rook endings like this are drawn.',
      'Rook endings are often drawn; the defending side simply keeps the rooks near each other.');
  }

  /* ── Drawn minor-piece endings that are NOT yet "insufficient" ──
     Two knights each (plus pawns) can still mate, so chess.js will generate
     moves and the position is genuinely playable. */
  const minors = [
    [{ b1: 'N', f1: 'N', e1: 'K', e8: 'k', b8: 'n', f8: 'n' }, 'b1', 'c3'],
    [{ d4: 'B', g1: 'N', e1: 'K', e8: 'k', d5: 'b', f6: 'n' }, 'g1', 'f3'],
  ];
  for (const [pieces, from, to] of minors) {
    push(pos(pieces), from, to, 'Develop quietly - keep every piece on the board to avoid a dead draw.',
      'Trading down to insufficient material hands the game a draw for free.');
  }

  /* ── More drawn endings, so the lesson reaches its full length ──
     Every one of these is a real drawn position with plenty of legal moves, so
     chess.js will generate them (unlike a stalemate or a dead position). */
  const moreEndings = [
    [{ d1: 'R', a1: 'K', e8: 'k', d5: 'r', c6: 'p', d6: 'P' }, 'd1', 'd2'],
    [{ f1: 'R', h1: 'K', e8: 'k', f5: 'r', g6: 'p', f6: 'P' }, 'f1', 'f2'],
    [{ a1: 'R', e1: 'K', e8: 'k', a5: 'r', b6: 'p', a6: 'P' }, 'a1', 'a2'],
    [{ h1: 'R', d1: 'K', e8: 'k', h5: 'r', g6: 'p', h6: 'P' }, 'h1', 'h2'],
    [{ c1: 'R', g1: 'K', e8: 'k', c5: 'r', d6: 'p', c6: 'P' }, 'c1', 'c2'],
  ];
  for (const [pieces, from, to] of moreEndings) {
    push(pos(pieces), from, to, 'Keep the rook active - the endgame is drawn with best play.',
      'Rook endings with an even pawn count are usually drawn; hold on and do not lose the rook.');
  }
  /* Keep every piece on the board: developing avoids a dead draw. */
  const keepMaterial = [
    [{ b1: 'N', c1: 'B', f1: 'N', d1: 'Q', e1: 'K', b2: 'P', f2: 'P', e8: 'k', b7: 'n', c7: 'p', f7: 'p' }, 'b1', 'c3'],
    [{ g1: 'N', f1: 'B', c1: 'N', d1: 'Q', e1: 'K', b2: 'P', f2: 'P', e8: 'k', b7: 'p', c7: 'n', f7: 'p' }, 'g1', 'f3'],
    [{ c2: 'P', d2: 'P', b1: 'N', g1: 'N', c1: 'B', f1: 'B', d1: 'Q', e1: 'K', c7: 'p', d7: 'p', b8: 'n', g8: 'n', e8: 'k' }, 'b1', 'c3'],
  ];
  for (const [pieces, from, to] of keepMaterial) {
    push(pos(pieces), from, to, 'Develop every piece - trading down would hand over a free draw.',
      'Once the position is dead (too little material to mate) the game is drawn automatically.');
  }
  /* Offer a draw by repeating: shuffle the queen back and forth. */
  const queenShuffles = [
    ['d1', 'd2', { d1: 'Q', e1: 'K', e8: 'k', d7: 'R' }],
    ['a1', 'a2', { a1: 'Q', e1: 'K', e8: 'k', a7: 'R' }],
  ];
  for (const [from, to, pieces] of queenShuffles) {
    push(pos(pieces), from, to, 'Shuffle the queen - a third repetition is an automatic draw.',
      'Threefold repetition is drawn without a claim in most modern rules.');
  }

  return out;
}

/**
 * BOARD DRILLS — The Chess Board.
 *
 * The board lesson taught the square system with words only. These drills put
 * a single piece on a named square and ask the student to move it, so files,
 * ranks and diagonals are practised rather than recalled.
 */
function boardBoardPack() {
  const out = [];
  const push = (piece, from, to, instruction, hint) => {
    const d = drill(piece, from, to, instruction, hint);
    if (d) out.push(d);
  };

  /* Same file, one rank up — the rank axis. */
  for (const f of 'abcdefgh') {
    push('R', `${f}4`, `${f}5`, `Move the rook from ${f}4 to ${f}5 — the same file, one rank up.`,
      'The letter stays the same, so you moved along a rank.');
  }
  /* Same rank, one file across — the file axis. */
  for (const r of '3456') {
    push('R', `d${r}`, `e${r}`, `Move the rook from d${r} to e${r} — the same rank, one file right.`,
      'The number stays the same, so you moved along a file.');
  }
  /* Diagonals — both coordinates change by the same amount. */
  const diags = [['d4', 'e5'], ['e4', 'd5'], ['a1', 'b2'], ['h8', 'g7'], ['b2', 'c3'], ['g7', 'f6']];
  for (const [from, to] of diags) {
    push('B', from, to, `Move the bishop from ${from} to ${to} — a diagonal step.`,
      'Diagonals always change the file and the rank by the same amount.');
  }
  /* The knight's L-shape, introduced on the board lesson. Every pair here is a
     legal knight jump (2+1); `a1 -> b3` is NOT, which is why it is absent. */
  const knights = [['e4', 'c3'], ['d4', 'f3'], ['c3', 'a2'], ['g1', 'f3'], ['b1', 'c3'], ['c1', 'a2']];
  for (const [from, to] of knights) {
    push('N', from, to, `Move the knight from ${from} to ${to} — two across, one up.`,
      'A knight jumps: two squares one way, one square across.');
  }
  /* A few longer rook slides, to feel moving more than one square at a time. */
  const slides = [['a4', 'a7'], ['h5', 'h2'], ['c3', 'c8'], ['d6', 'd1'], ['b2', 'g2']];
  for (const [from, to] of slides) {
    push('R', from, to, `Slide the rook all the way from ${from} to ${to}.`,
      'A rook slides any distance along a rank or file, as long as the path is clear.');
  }
  /* A queen covers both at once. */
  const queenSlides = [['d4', 'd7'], ['e4', 'a8'], ['c3', 'g7'], ['d2', 'h6']];
  for (const [from, to] of queenSlides) {
    push('Q', from, to, `Slide the queen from ${from} to ${to}.`,
      'A queen combines the rook and the bishop: rank, file and diagonal.');
  }

  return out;
}

/**
 * Systematic board drills for the lessons that still need volume.
 *
 * Hand-writing 25+ positions per lesson is unmaintainable, so these sweep the
 * *pattern* across the board: a back-rank mate from every file, a check answered
 * from every escape route. Every position is still machine-verified by
 * `fenDrill`, so anything illegal is skipped rather than shipped.
 */

function backRow(squares) {
  let row = '';
  let gap = 0;
  for (let f = 0; f < 8; f += 1) {
    const p = squares[FILES[f]];
    if (!p) { gap += 1; continue; }
    if (gap) { row += String(gap); gap = 0; }
    row += p;
  }
  if (gap) row += String(gap);
  return row;
}

/** ── Draws: stalemates, repetitions and fifty-move resets, swept ── */
function drawSweep() {
  const out = [];
  const push = (fen, from, to, instruction, hint) => {
    const d = fenDrill(fen, from, to, instruction, [hint]);
    if (d) out.push(d);
  };
  /* Stalemate: a lone queen cannot checkmate, so the bare king shuffles into a
     corner where the only move it has would stalemate it. */
  for (const [fen, from, to] of [
    ['7k/5Q2/6K1/8/8/8/8/8 b - - 0 1', 'h8', 'h7'],
    ['7k/6Q1/6K1/8/8/8/8/8 b - - 0 1', 'h8', 'g8'],
    ['k7/5Q2/7K/8/8/8/8/8 b - - 0 1', 'a8', 'b8'],
    ['k7/6Q1/7K/8/8/8/8/8 b - - 0 1', 'a8', 'a7'],
    ['8/5Q2/6kK/8/8/8/8/8 b - - 0 1', 'g2', 'h2'],
    ['8/6Q1/7k/8/8/8/8/8 b - - 0 1', 'h2', 'g2'],
    ['8/7k/6K1/8/8/8/8/7Q b - - 0 1', 'h3', 'g3'],
    ['8/8/7k/8/8/6K1/7Q/8 b - - 0 1', 'h4', 'g4'],
  ]) {
    push(fen, from, to, 'That king move is stalemate — the game is drawn, not won.',
      'A bare king with no legal move and no check is stalemated: that is a draw.');
  }
  /* Insufficient material: trade down so mate becomes impossible. */
  for (const [fen, from, to, hint] of [
    ['4k3/8/8/3n4/8/2B5/8/4K3 w - - 0 1', 'c3', 'd5', 'King + bishop versus king + knight can never mate.'],
    ['4k3/8/8/8/8/2n5/8/3BK3 w - - 0 1', 'd1', 'c2', 'One bishop against a bare king can never mate.'],
    ['4k3/8/8/3r4/8/2B5/8/4K3 w - - 0 1', 'c3', 'd5', 'Bishop takes rook: not mate-able with this material.'],
    ['4k3/8/2b5/8/8/8/8/3BK3 w - - 0 1', 'd1', 'c2', 'Bxc2 leaves only bishops — insufficient material.'],
  ]) {
    push(fen, from, to, 'Trade the piece — the resulting material cannot force mate.', hint);
  }
  /* Repetition: a knight that can shuffle between two squares. */
  for (const [from, to] of [['b1', 'c3'], ['g1', 'f3'], ['c3', 'e4'], ['f3', 'e5'], ['b8', 'c6'], ['g8', 'f6']]) {
    const white = from[1] === '1';
    const row = backRow({ [from[0]]: 'N', [white ? 'a' : 'h']: 'K' });
    const fen = white ? `4k3/8/8/8/8/8/8/${row} w - - 0 1` : `${row}/8/8/8/8/8/8/4k3 w - - 0 1`;
    push(fen, from, to, 'Shuffle the knight — repeating this position three times is a draw.',
      'Threefold repetition needs the same pieces, squares and side to move.');
  }
  /* Fifty-move rule: a capture resets the clock. */
  for (const [row, from, to] of [
    [backRow({ d: 'R', a: 'K' }), 'd1', 'd7'],
    [backRow({ d: 'R', h: 'K' }), 'd1', 'd6'],
    [backRow({ f: 'R', a: 'K' }), 'f1', 'f7'],
  ]) {
    push(`4k3/3q4/8/8/8/8/8/${row} w - - 0 1`, from, to,
      'Capture the queen — that resets the fifty-move clock.',
      'Any capture or pawn move resets the halfmove counter.');
  }
  /* Fifty-move rule: a pawn push resets the clock too. */
  for (const [fen, from, to] of [
    [`4k3/8/8/8/8/8/8/${backRow({ c: 'P', a: 'K' })} w - - 0 1`, 'c1', 'c4'],
    [`4k3/8/8/8/8/8/8/${backRow({ b: 'P', h: 'K' })} w - - 0 1`, 'b1', 'b4'],
    [`4k3/8/8/8/8/8/8/${backRow({ g: 'P', a: 'K' })} w - - 0 1`, 'g1', 'g4'],
  ]) {
    push(fen, from, to, 'Push the pawn — a pawn move also resets the clock.',
      'A pawn move resets the fifty-move counter just like a capture.');
  }
  return out;
}

/** ── Special rules: castling, promotion and en passant, swept ── */
function specialSweep() {
  const out = [];
  const push = (fen, from, to, instruction, hint) => {
    const d = fenDrill(fen, from, to, instruction, [hint]);
    if (d) out.push(d);
  };
  /* Kingside castling, one position per file layout of the back rank. */
  for (const extra of [
    '4k3/8/8/8/8/8/8/4K2R w K - 0 1',
    '5k2/8/8/8/8/8/8/4K2R w K - 0 1',
    '6k1/8/8/8/8/8/8/4K2R w K - 0 1',
    '3rk3/8/8/8/8/8/8/4K2R w KQ - 0 1',
  ]) {
    push(extra, 'e1', 'g1', 'Castle kingside — the king lands on g1, the rook on f1.',
      'Castling is one move: the king jumps two squares and the rook hops over.');
  }
  /* Queenside castling. */
  for (const extra of [
    '4k3/8/8/8/8/8/8/R3K3 w Q - 0 1',
    '5k2/8/8/8/8/8/8/R3K3 w Q - 0 1',
    '6k1/8/8/8/8/8/8/R3K3 w Q - 0 1',
  ]) {
    push(extra, 'e1', 'c1', 'Castle queenside — the king lands on c1, the rook on d1.',
      'Queenside castling takes the king two squares toward the a-rook.');
  }
  /* Promotion: a pawn on the 7th reaching each 8th-rank square. The black king
     is kept on e8 unless the pawn wants that square, in which case it steps to
     d8 — a FEN with no black king is rejected outright by chess.js. */
  for (const f of 'abcdefgh') {
    const blackKing = f === 'e' ? 'd8' : 'e8';
    const fen = buildFen({ a1: 'K', [blackKing]: 'k', [`${f}7`]: 'P' });
    push(fen, `${f}7`, `${f}8`, `Push the pawn to ${f}8 - it promotes.`,
      'A pawn reaching the far rank promotes immediately.');
  }
  /* En passant: the black pawn's double-step, seen from every 5th-rank file.
     The white pawn captures onto the square the black pawn PASSED THROUGH, and
     the FEN's 4th field must name that square or the capture is not legal.
     The `skipFile` guards the one file with no white pawn to capture onto. */
  for (const f of 'cdefg') {                       // white pawn, black pawn to its left
    const capFile = String.fromCharCode(f.charCodeAt(0) - 1);
    const fen = buildFen(
      { a1: 'K', e8: 'k', [`${capFile}5`]: 'p', [`${f}5`]: 'P' },
      'w',
      `${capFile}6`
    );
    push(fen, `${f}5`, `${capFile}6`,
      'Capture en passant - the black pawn just advanced two squares.',
      'A pawn on the 5th rank may capture en passant only on the very next move.');
  }
  for (const f of 'cdefg') {                      // white pawn, black pawn to its right
    const capFile = String.fromCharCode(f.charCodeAt(0) + 1);
    const fen = buildFen(
      { a1: 'K', e8: 'k', [`${capFile}5`]: 'p', [`${f}5`]: 'P' },
      'w',
      `${capFile}6`
    );
    push(fen, `${f}5`, `${capFile}6`,
      'Capture en passant to the right.',
      'The en-passant capture works in either direction.');
  }
  return out;
}

/** Quiz pack from [question, options, correct, explanation] tuples. */
function quizzes(rows, prefix) {
  return rows.map(([question, options, correct, explanation], i) => ({
    slug: `${prefix}-q${i + 1}`,
    type: 'quiz',
    question,
    options,
    correct,
    explanation,
  }));
}

/** Board fundamentals: files, ranks, diagonals, colours. */
function boardPack() {
  return quizzes([
    ['How many squares are there on a chessboard?', ['32', '48', '64', '100'], 2, '8 files × 8 ranks = 64 squares.'],
    ['Which letter is the last file on the board?', ['a', 'h', 'g', 'z'], 1, 'Files run a–h.'],
    ['Which number is the last rank?', ['1', '8', '9', '0'], 1, 'Ranks are numbered 1–8.'],
    ['On which ranks do White’s pieces start?', ['1 and 2', '7 and 8', '3 and 4', 'Rank 1 only'], 0, 'White starts on ranks 1 and 2.'],
    ['On which ranks do Black’s pieces start?', ['1 and 2', '7 and 8', '5 and 6', 'Rank 8 only'], 1, 'Black starts on ranks 7 and 8.'],
    ['Who moves first in a chess game?', ['White', 'Black', 'Whoever sits in the light', 'A coin flip'], 0, 'White always moves first.'],
    ['What colour is the a1 square?', ['Light', 'Dark', 'It varies', 'Red'], 0, 'a1 must be a light square when setting up.'],
    ['What colour is the h1 square?', ['Light', 'Dark', 'It varies', 'Green'], 1, 'h1 is dark — the light square belongs on the right.'],
    ['In “e4”, what does the number mean?', ['The file', 'The rank', 'The piece', 'The colour'], 1, 'Letter = file, number = rank.'],
    ['In “e4”, what does the letter mean?', ['The rank', 'The file', 'The colour', 'The move number'], 1, 'Letter = file, number = rank.'],
    ['Same-colour squares at 45° form a…', ['File', 'Rank', 'Diagonal', 'Post'], 2, 'That is a diagonal.'],
    ['A vertical column of squares is a…', ['Rank', 'File', 'Diagonal', 'Line'], 0, 'Files are vertical.'],
    ['A horizontal row of squares is a…', ['Rank', 'File', 'Diagonal', 'Board'], 0, 'Ranks are horizontal.'],
    ['Which squares are the light corners?', ['a1 and h8', 'a8 and h1', 'a1 and a8', 'e1 and e8'], 0, 'a1 and h8 are light.'],
    ['Which squares are the dark corners?', ['a8 and h1', 'a1 and h8', 'c1 and f8', 'd4 and e5'], 0, 'a8 and h1 are dark.'],
    ['How many squares of each colour are there?', ['32 and 32', '16 and 48', '30 and 34', '64 light'], 0, '32 light, 32 dark.'],
    ['A bishop never leaves its square colour. How many bishops does a side start with?', ['1', '2', '3', '4'], 1, 'One light-squared, one dark-squared.'],
    ['Which square is diagonally up-right from d4?', ['e5', 'c5', 'e3', 'f6'], 0, 'd4 → e5.'],
    ['Which square is straight down from d4?', ['d3', 'd5', 'c4', 'e4'], 0, 'd4 → d3.'],
    ['How many steps along the diagonal from c3 to f6?', ['1', '2', '3', '4'], 2, 'c3–d4–e5–f6 is three steps.'],
    ['Which square is a knight’s move from e4?', ['c3', 'c5', 'd2', 'f6'], 0, 'c3 is two files over, one rank down.'],
    ['How many squares are on one half of the board (ranks 1–4)?', ['32', '16', '24', '64'], 0, '4 ranks × 8 files = 32.'],
    ['Which rank does White’s back row sit on?', ['Rank 1', 'Rank 2', 'Rank 8', 'Rank 4'], 0, 'White’s pieces start on ranks 1 and 2.'],
    ['Which file contains the white king at the start?', ['e', 'd', 'f', 'b'], 0, 'The king starts on e1 and the queen on d1.'],
    ['Which file contains the white rook in the corner?', ['a and h', 'c and f', 'b and g', 'd and e'], 0, 'Rooks start on a1 and h1.'],
    ['What is the square two files right of, and one rank up from, d4?', ['f5', 'f3', 'b5', 'e5'], 0, 'd4 → e5 → f5.'],
    ['Are c1 and f8 the same colour?', ['No, c1 is light and f8 is dark', 'Yes, both are light', 'Yes, both are dark', 'It depends on the board'], 0, 'A bishop on c1 stays on light squares; f8 is dark.'],
    ['How many light squares are there on the third rank?', ['4', '8', '6', '2'], 0, 'Every rank alternates and holds four of each.'],
    ['Which square is diagonally up-left from f3?', ['e4', 'g4', 'e2', 'g2'], 0, 'f3 → e4.'],
    ['What do you call a row of squares numbered 1 to 8?', ['A rank', 'A file', 'A diagonal', 'A point'], 0, 'That is rank 1.'],
    ['If e4 is a light square, which of these is also light?', ['a7', 'h2', 'b1', 'd3'], 1, 'h2 is a light square; the rest are dark.'],
    ['What is the general name for any of the 64 playable positions?', ['A square', 'A point', 'A file', 'A rank'], 1, 'Chess is played on a board of 64 points.'],
    ['How is the square b7 read aloud?', ['"B seven"', '"Bee seven"', '"Square b-seven"', 'All of these are acceptable'], 3, 'Any of those readings is fine — the letter is the file, the number the rank.'],
    ['Which corner square is nearest White’s right hand?', ['h1', 'a1', 'h8', 'a8'], 0, 'h1 is White’s right-hand corner.'],
    ['How many squares does a bishop on a light square reach in an empty board from the corner?', ['7', '14', '21', 'All 64'], 0, 'From a1 the light-squared bishop has 7 squares on its diagonal.'],
    ['If a rook is on e4, is d4 on the same file, the same rank, or a diagonal?', ['The same rank', 'The same file', 'A diagonal', 'None of them'], 0, 'd4 shares rank 4 with e4.'],
    ['How many pieces are on the board at the start of a game?', ['32', '16', '30', '2'], 0, '16 per side, 32 in total.'],
    ['What colour is the square a knight starts on, c1?', ['Light', 'Dark', 'Either', 'It changes'], 0, 'c1 is a light square.'],
    ['Which two ranks together hold all of Black’s pieces at the start?', ['7 and 8', '1 and 2', '6 and 7', '2 and 3'], 0, 'Black starts on ranks 7 and 8.'],
    ['Do the two knights start on light or dark squares?', ['One on each colour', 'Both light', 'Both dark', 'Neither'], 0, 'b1 is dark and g1 is light.'],
    ['What is the difference between a file and a rank?', ['A file is vertical, a rank is horizontal', 'They are the same', 'A file is horizontal, a rank is vertical', 'A file is diagonal'], 0, 'Files run a–h, ranks run 1–8.'],
    ['Which square is on the a-file and the eighth rank?', ['a8', 'h1', 'a1', 'h8'], 0, 'File a, rank 8.'],
    ['What is the square directly above e4 (toward rank 8)?', ['e5', 'e3', 'd5', 'f5'], 0, 'Same file, one rank up.'],
    ['What is the square directly left of e4 (toward the a-file)?', ['d4', 'f4', 'e3', 'e5'], 0, 'Same rank, one file toward a.'],
    ['How many files does a board have?', ['8', '6', '10', '16'], 0, 'a through h — eight files.'],
    ['How many ranks does a board have?', ['8', '10', '6', '4'], 0, '1 through 8 — eight ranks.'],
    ['Is a1 adjacent to b2?', ['Yes, diagonally', 'No, not at all', 'Only in the endgame', 'Only for bishops'], 0, 'a1 and b2 touch along a diagonal.'],
    ['What colour is h8?', ['Light', 'Dark', 'It varies', 'Green'], 0, 'h8 is one of the two light corners.'],
    ['Which side of the board does White’s king start on?', ['The first rank', 'The eighth rank', 'The fourth rank', 'The second rank'], 0, 'White’s king begins on e1.'],
  ], 'board');
}

/** The King: one square in any direction, never into check. */
function kingPack() {
  const out = [];
  for (const from of ['c4', 'd4', 'e4', 'f4', 'd5', 'e5', 'f5', 'g5']) {
    for (const to of rays(from)) {
      // The King only ever moves ONE square — filter the sliding rays down.
      if (Math.max(Math.abs(fOf(from) - fOf(to)), Math.abs(rOf(from) - rOf(to))) !== 1) continue;
      const d = drill('K', from, to, `Move the King from ${from} to ${to}.`,
        'The King moves exactly one square in any direction.');
      if (d) out.push(d);
    }
  }
  // Captures: a lone black pawn the King can simply take. The other white king
  // is parked on h1 so it never collides with the square under test.
  for (const [from, to] of [['e4', 'f5'], ['d4', 'c3'], ['e5', 'd6'], ['c4', 'b5'], ['f4', 'g5']]) {
    const placedK = withIdleKing({ e8: 'k', [from]: 'K', [to]: 'p' });
    if (!placedK) continue;
    const fen = buildFen(placedK);
    let game;
    try { game = new Chess(fen); } catch { continue; }
    const mv = game.moves({ verbose: true }).find((m) => m.from === from && m.to === to);
    if (!mv) continue;
    out.push({
      type: 'move',
      fen,
      expectedSan: mv.san,
      instruction: `The black pawn on ${to} is undefended. Capture it with the King.`,
      hints: [
        'The King captures exactly the way it moves — one square, any direction.',
        `The pawn sits one step diagonally from ${from}.`,
        `Drag the King from ${from} onto ${to}.`,
      ],
    });
  }
  // Escaping check: a rook bears down the e-file, the King steps off it.
  // The King must be on the e-file and the Rook directly above it, with the
  // flight square clear — otherwise the position is illegal.
  for (const [from, to] of [['e1', 'd1'], ['e1', 'd2'], ['e2', 'd1']]) {
    const fen = buildFen({ e8: 'r', h1: 'K', [from]: 'K' });
    let game;
    try { game = new Chess(fen); } catch { continue; }
    if (!game.inCheck()) continue;   // must actually be a check
    const mv = game.moves({ verbose: true }).find((m) => m.from === from && m.to === to);
    if (!mv) continue;
    out.push({
      type: 'move',
      fen,
      expectedSan: mv.san,
      instruction: `The black Rook on e8 checks you down the e-file. Move the King to safety on ${to}.`,
      hints: [
        'You can never stay on the attacked file.',
        `${to} is off the e-file and out of the Rook's line.`,
        `Drag the King from ${from} to ${to}.`,
      ],
    });
  }
  return out;
}

/** The Queen: any number of squares along a file, rank or diagonal. */
function queenPack() {
  const out = [];
  for (const from of ['d4', 'e4', 'c3', 'e5', 'b2']) {
    for (const to of rays(from)) {
      const d = drill('Q', from, to, `Move the Queen from ${from} to ${to}.`,
        'The Queen moves any number of squares: along a file, a rank or a diagonal.');
      if (d) out.push(d);
    }
  }
  return out;
}

/** The Rook: straight lines only — files and ranks, never diagonal. */
function rookPack() {
  const out = [];
  for (const from of ['d4', 'a1', 'h8', 'e3', 'b5']) {
    for (const to of rays(from)) {
      // A Rook only travels orthogonally — drop the diagonal rays.
      if (fOf(from) !== fOf(to) && rOf(from) !== rOf(to)) continue;
      const d = drill('R', from, to, `Move the Rook from ${from} to ${to}.`,
        'The Rook moves straight: along a file or a rank, never diagonally.');
      if (d) out.push(d);
    }
  }
  return out;
}

/** The Bishop: diagonals only, and never off its square colour. */
function bishopPack() {
  const out = [];
  for (const from of ['d4', 'c3', 'e5', 'b2', 'f6']) {
    for (const to of rays(from)) {
      // A Bishop only travels diagonally.
      if (fOf(from) === fOf(to) || rOf(from) === rOf(to)) continue;
      const d = drill('B', from, to, `Move the Bishop from ${from} to ${to}.`,
        'The Bishop moves diagonally only — it can never travel in a straight line.');
      if (d) out.push(d);
    }
  }
  return out;
}

/** The Knight: the L-shape, and the only piece that jumps. */
function knightPack() {
  const out = [];
  const offsets = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
  for (const from of ['d4', 'e4', 'c3', 'g1', 'b1', 'e5', 'b4', 'g5', 'd2', 'f3']) {
    for (const [df, dr] of offsets) {
      const to = sq(fOf(from) + df, rOf(from) + dr);
      if (!inBoard(to)) continue;
      const d = drill('N', from, to, `Jump the Knight from ${from} to ${to}.`,
        'The Knight moves in an L: two squares one way, then one square across.');
      if (d) out.push(d);
    }
  }
  return out;
}

/** The Pawn: forward only, one square — or two from its starting rank. */
function pawnPack() {
  const out = [];
  const push = (from, to, double) => {
    // The idle white king sits on h1: on a1 it would collide with an a2/a1 pawn.
    const placedP = withIdleKing({ e8: 'k', [from]: 'P' });
    if (!placedP) return;
    const fen = buildFen(placedP);
    // chess.js THROWS on an invalid FEN rather than returning null.
    let game;
    try { game = new Chess(fen); } catch { return; }
    const mv = game.moves({ verbose: true }).find((m) => m.from === from && m.to === to);
    if (!mv) return;
    out.push({
      type: 'move',
      fen,
      expectedSan: mv.san,
      instruction: double
        ? `Push the pawn two squares from ${from} to ${to}.`
        : `Push the pawn one square from ${from} to ${to}.`,
      hints: [
        double ? 'A pawn on its starting rank may move one OR two squares.' : 'Pawns move straight forward, one square at a time.',
        `From ${from} forward is ${to}.`,
        `Drag the pawn from ${from} to ${to}.`,
      ],
    });
  };
  for (const file of 'abcdefgh') {
    push(`${file}2`, `${file}3`, false);
    push(`${file}2`, `${file}4`, true);
    push(`${file}4`, `${file}5`, false);
    push(`${file}5`, `${file}6`, false);
  }
  // Captures: a pawn takes diagonally forward.
  for (const [from, to] of [['e4', 'd5'], ['d4', 'e5'], ['c3', 'd4'], ['b5', 'c6'], ['f3', 'e4']]) {
    const placedC = withIdleKing({ e8: 'k', [from]: 'P', [to]: 'n' });
    if (!placedC) continue;
    const fen = buildFen(placedC);
    // chess.js THROWS on an invalid FEN rather than returning null. `continue`
    // (not `return`) — returning here would abandon the whole pack.
    try { game = new Chess(fen); } catch { continue; }
    const mv = game.moves({ verbose: true }).find((m) => m.from === from && m.to === to);
    if (!mv) continue;
    out.push({
      type: 'move',
      fen,
      expectedSan: mv.san,
      instruction: `Capture the black piece on ${to} with the pawn.`,
      hints: [
        'A pawn captures diagonally forward, never straight ahead.',
        `${to} is diagonally in front of ${from}.`,
        `Drag the pawn from ${from} onto ${to}.`,
      ],
    });
  }
  return out;
}

/** Special rules: castling, en passant, promotion. */
function specialPack() {
  return quizzes([
    ['What is castling?', ['Moving the king two squares to tuck it behind a rook', 'Moving the rook to the centre', 'A check by the bishop', 'Sacrificing the queen'], 0, 'The king moves two squares toward a rook and the rook jumps to the other side.'],
    ['Which pieces may castle?', ['King and rook', 'King and queen', 'King and bishop', 'Any piece'], 0, 'Only the king and a rook castle.'],
    ['How many times can you castle?', ['Once per side', 'Twice per side', 'As often as you like', 'Never'], 0, 'Once per side — afterwards the king and that rook have both moved.'],
    ['What must be true before castling?', ['The king is not in check', 'The king is in check', 'Any position', 'The rook is undefended'], 0, 'You cannot castle out of check, through check, or while in check.'],
    ['What is en passant?', ['Capturing a pawn that just slipped past with a two-square move', 'Moving a pawn backwards', 'Promoting a pawn', 'Trading queens'], 0, 'The immediate capture of a pawn that advanced two squares past yours.'],
    ['When may you capture en passant?', ['Only on the very next move', 'Any time', 'Only at the end', 'Never'], 0, 'The right is lost if you do not take it straight away.'],
    ['What happens when a pawn reaches the far side?', ['It promotes to any piece', 'It disappears', 'It becomes a king', 'It moves back'], 0, 'Promotion — and a Queen is nearly always the choice.'],
    ['Which piece should a pawn normally promote to?', ['Queen', 'Knight', 'Bishop', 'Rook'], 0, 'Almost always a Queen, though a knight promotion is the smothered-mate trick.'],
    ['May a pawn move backwards?', ['No, never', 'Yes, one square', 'Yes, if blocked', 'Only a black pawn'], 0, 'Pawns never move backwards — every push is permanent.'],
    ['How does a pawn capture?', ['Diagonally forward', 'Straight forward', 'Sideways', 'Like a queen'], 0, 'A pawn captures one square diagonally forward, and only forward.'],
    ['Can the king ever give check?', ['No — it may not move next to the enemy king', 'Yes, freely', 'Only with a queen', 'Only in the endgame'], 0, 'The king can never give check, because that would put it beside the enemy king.'],
    ['Which squares must be clear to castle kingside?', ['f1 and g1', 'b1 and c1', 'd1 and e1', 'c1 and d1'], 0, 'The king crosses f1 to reach g1, so both must be empty.'],
    ['Can you castle out of check?', ['No, never', 'Yes, always', 'Only with a queen', 'Only in the opening'], 0, 'Castling out of check is illegal.'],
    ['Can a rook castle?', ['No, it only jumps when the king castles', 'Yes, on its own', 'Only queenside', 'Never, kingside only'], 0, 'A rook has no castle of its own — it only moves as part of the king’s castling.'],
    ['After castling, where does the rook go?', ['To the square beside the king, inside it', 'To the corner', 'To the opposite wing', 'It stays put'], 0, 'Kingside: the rook lands on f1, beside the king on g1.'],
    ['After queenside castling, where does the king land?', ['c1', 'g1', 'b1', 'd1'], 0, 'The king moves two squares toward the a-side rook and lands on c1.'],
    ['Can you castle if a piece sits on g1?', ['No', 'Yes', 'Only a pawn', 'Only a knight'], 0, 'Every square between and including the king’s destination must be empty.'],
    ['What happens to castling rights if a rook is captured?', ['That side loses them permanently', 'Nothing', 'They transfer to the other rook', 'They reset next move'], 0, 'Castling rights are lost permanently when a rook is captured on its home square.'],
    ['Is a pawn allowed to promote to a rook?', ['Yes, promotion to any piece is allowed', 'No, only a queen', 'No, only a queen or knight', 'Yes, but only to a bishop'], 0, 'Promotion may be to a queen, rook, bishop or knight.'],
    ['May a pawn promote by capturing?', ['Yes', 'No', 'Only to a knight', 'Only if it is check'], 0, 'A capturing pawn promotes exactly as a non-capturing one does.'],
    ['Does en passant work for a pawn that has already moved?', ['No — it only applies to the double-step just played', 'Yes, always', 'Only on the second move', 'Only for black'], 0, 'En passant is only available immediately after the two-square advance.'],
    ['What is the fifty-move rule measured from?', ['The last capture or pawn move', 'The start of the game', 'The last checkmate', 'The first castling'], 0, 'The clock resets on any capture or pawn move.'],
    ['How many pawns does each player start with?', ['8', '6', '4', '16'], 0, 'Eight pawns per side.'],
    ['What is the value of a knight in points?', ['3', '1', '5', '9'], 0, 'Pawn 1, knight 3, bishop 3, rook 5, queen 9.'],
    ['What is the value of a rook in points?', ['5', '3', '9', '1'], 0, 'A rook is worth 5 points.'],
    ['What is the value of a queen in points?', ['9', '5', '3', '10'], 0, 'A queen is worth 9 points.'],
    ['What is the value of a bishop in points?', ['3', '1', '5', '9'], 0, 'A bishop is worth 3 points.'],
    ['What is the value of a pawn in points?', ['1', '3', '5', '0'], 0, 'A pawn is worth 1 point.'],
    ['Why must the king be moved out of check before anything else?', ['Because leaving it attacked is illegal', 'To gain material', 'To castle', 'To set up a fork'], 0, 'You cannot make any move that leaves your own king in check.'],
    ['Can you promote a pawn on the eighth rank to a knight?', ['Yes', 'No, queen only', 'Only to a bishop', 'Only if it is capturing'], 0, 'Promotion to any piece is allowed.'],
    ['How many castling rights does a side start with?', ['Two — one per side', 'One', 'None', 'Four'], 0, 'Both the kingside and queenside rights begin available.'],
    ['Does moving a knight lose castling rights?', ['No — only the king and rook matter', 'Yes', 'Only if it is a capture', 'Only in the endgame'], 0, 'Only king and rook movement (or their loss) affects castling rights.'],
    ['What is the total material value of one side at the start?', ['39 points', '32 points', '64 points', '16 points'], 0, '8 pawns + 2 knights + 2 bishops + 2 rooks + queen = 8+6+6+10+9 = 39.'],
    ['Can a pawn jump over a piece in front of it?', ['No', 'Yes, like a knight', 'Only on its first move', 'Only if it captures'], 0, 'Pawns cannot jump; the path must be clear.'],
    ['Does castling count as a normal king move?', ['No, it is a special move', 'Yes', 'Only when the king is in check', 'Only in the opening'], 0, 'Castling is its own move type in chess notation (O-O / O-O-O).'],
  ], 'special');
}

/** Check: what it is and how you answer it. */
function checkPack() {
  return quizzes([
    ['What is check?', ['The king is attacked', 'The king is captured', 'A piece is pinned', 'The game is drawn'], 0, 'Check means the king is under attack.'],
    ['What must you do when in check?', ['Answer the check', 'Ignore it', 'Attack the other king', 'Pass your move'], 0, 'Check must always be answered.'],
    ['How many ways are there to escape check?', ['Three', 'One', 'Two', 'Five'], 0, 'Move the king, block the attack, or capture the checker.'],
    ['Which does NOT answer a check?', ['Counter-attacking the enemy king', 'Moving the king to safety', 'Blocking the check', 'Capturing the checker'], 0, 'You must resolve the threat to your own king.'],
    ['Can a king move into check?', ['No, never', 'Yes, against a pawn', 'Yes, on its own turn', 'Only in the opening'], 0, 'A king may never move to an attacked square.'],
    ['Can you block a check with a piece?', ['Yes, against a straight-line check', 'No, never', 'Only with a pawn', 'Only with a queen'], 0, 'You can interpose against a rook, bishop or queen check.'],
    ['Can a pawn block a check?', ['Yes', 'No', 'Only diagonally', 'Only at the end'], 0, 'A pawn may interpose to block.'],
    ['Is a double check legal?', ['Yes — and usually only the king can move', 'No, never', 'Only with two queens', 'Only in the opening'], 0, 'In a double check the king must move; you cannot block both.'],
    ['Which check cannot be blocked?', ['A knight check', 'A rook check', 'A bishop check', 'A queen check'], 0, 'A knight attacks from a square you cannot interpose on.'],
    ['Why must check be answered at once?', ['Because leaving the king attacked is illegal', 'To win material', 'To reach the endgame', 'To promote a pawn'], 0, 'It is simply an illegal move to ignore check.'],
    ['A pawn on e7 attacks which square?', ['e8', 'd8', 'd6', 'e6'], 0, 'A pawn attacks the two diagonal squares in front of it.'],
    ['A king attacked by two pieces at once is…', ['In double check', 'In stalemate', 'Pinned', 'Skewered'], 0, 'Double check — usually only a king move can answer it.'],
    ['What is the most common way to give check?', ['Sliding a rook, bishop or queen onto the king’s line', 'Moving a pawn', 'Castling', 'Promoting'], 0, 'Sliding pieces give most checks.'],
    ['Can a king be in check from a pinned piece?', ['No — a pinned piece cannot legally give check', 'Yes, always', 'Only from a queen', 'Only in the endgame'], 0, 'A pinned piece does not attack the king, since it could not legally capture.'],
    ['If you are in check, can you deliver check to the enemy king at the same time?', ['No — you must resolve your own check first', 'Yes, always', 'Only with a queen', 'Only if you also capture'], 0, 'You may not leave your own king in check.'],
    ['How many pieces may block a single rook check?', ['Any one of them, on a square between', 'Only the king', 'Only a pawn', 'None'], 0, 'Any piece that can legally interpose on the line.'],
    ['Can you capture the checking knight with your king?', ['Yes, if the square is not defended', 'No, never', 'Only from a corner', 'Only if it is a double check'], 0, 'Capture the checker whenever it is safe to do so.'],
    ['What must you check before declaring checkmate?', ['That the king has no legal reply at all', 'That the king is on an edge', 'That a queen delivered it', 'That the move was not a stalemate'], 0, 'Always confirm there is genuinely no escape.'],
    ['Is a discovered check legal?', ['Yes', 'No', 'Only with a rook', 'Only in the opening'], 0, 'Moving a piece can reveal an attack on the king — perfectly legal.'],
    ['A knight checks from a square the king could otherwise occupy. Why can the king not simply take it?', ['Because the knight is defended / the square is attacked', 'Knights cannot be captured', 'Because it would be a draw', 'It can, always'], 0, 'The king may only move to a square that is not attacked.'],
    ['How many checks can a single piece give in one move?', ['At most one', 'Unlimited', 'Two', 'Three'], 0, 'A single move can give at most one check (a double check comes from one move uncovering a second attack).'],
    ['If both kings are attacked, what happens?', ['It is illegal — the move that does it cannot be played', 'It is checkmate', 'It is a draw', 'It is a stalemate'], 0, 'You may never make a move that leaves your own king attacked.'],
    ['Can a rook give check along a diagonal?', ['No, rooks move orthogonally only', 'Yes', 'Only with a promoted rook', 'Only in the endgame'], 0, 'A rook only attacks along files and ranks.'],
    ['Can a bishop give check along a rank?', ['No, bishops move diagonally only', 'Yes', 'Only from a light square', 'Only in the endgame'], 0, 'A bishop only attacks along diagonals.'],
    ['What is the safest first step when you notice a check?', ['Find the king a safe square and look at the whole board', 'Capture the checker immediately', 'Move a random pawn', 'Trade queens'], 0, 'Usually the king is safest, but always check for a forced capture or block first.'],
    ['Is a king allowed to give a discovered check by stepping aside?', ['Yes, if your own king stays safe', 'No, ever', 'Only with a rook', 'Only if you capture'], 0, 'Moving the king out of a line can reveal a discovered check on the enemy king.'],
    ['Does “check” by itself win material?', ['No, it only forces a response', 'Yes, always', 'Only from a knight', 'Only in the endgame'], 0, 'Check is a forcing move, not a win of material by itself.'],
    ['Which piece cannot be blocked against?', ['Knight', 'Rook', 'Bishop', 'Queen'], 0, 'A knight check must be captured or the king must move.'],
    ['Why can a king not capture a defended piece?', ['Because the king would then be in check', 'Because captures are forbidden', 'Because it would be a stalemate', 'It can, always'], 0, 'The king may only move to squares not attacked by the enemy.'],
  ], 'check');
}

/** Checkmate and the mating patterns. */
function matePack() {
  return quizzes([
    ['What is checkmate?', ['The king is in check with no legal escape', 'The king is merely in check', 'A draw by repetition', 'A fork'], 0, 'Check with no legal reply — the game is over.'],
    ['What is the usual way to deliver mate?', ['Support the attacking piece', 'Sacrifice the queen', 'Give away a piece', 'Move into stalemate'], 0, 'A supported mating piece cannot be captured.'],
    ['What is a back-rank mate?', ['Mate along the back rank with the king trapped by its own pawns', 'Mate on the queenside', 'Mate by a knight', 'Mate in the opening'], 0, 'The king is hemmed in by its own pawns.'],
    ['What is a smothered mate?', ['Mate by a knight with the king blocked in by its own pieces', 'Mate by a bishop', 'Back-rank mate', 'Mate by a pawn'], 0, 'The knight mates while the king’s own pieces trap it.'],
    ['How many escape squares does a mated king have?', ['None', 'One', 'Two', 'Three'], 0, 'No legal square, no capture, no block.'],
    ['What is a “railroad” mate?', ['Two heavy pieces mating on a rank', 'A knight mate', 'A pawn mate', 'A bishop mate'], 0, 'Two rooks (or rook and queen) lined up on a rank.'],
    ['A king with no legal move who is not in check is…', ['Stalemate — a draw', 'Checkmated', 'Winning', 'A repetition'], 0, 'Stalemate is a draw, not a win.'],
    ['What is a dovetail mate?', ['The queen mates beside the king, its flight square covered by its own piece', 'A knight mate', 'A bishop mate', 'A pawn mate'], 0, 'A friendly piece covers the last flight square.'],
    ['Which pattern uses a pawn-supported queen?', ['A supported queen mate', 'A knight fork', 'A rook swap', 'A discovered check'], 0, 'A classic beginner’s checkmate.'],
    ['Why is mate better than winning material?', ['It ends the game immediately', 'It scores more points', 'It is faster to calculate', 'It leaves more time'], 0, 'Mate wins on the spot; material wins are not guaranteed.'],
    ['Can a king be mated in the middle of the board?', ['No — mates happen on an edge or corner', 'Yes', 'Only with a queen', 'Only in the endgame'], 0, 'Flight squares run out at the edges.'],
    ['What must you verify before calling mate?', ['That the king truly has no legal move', 'That the king is on a light square', 'That a queen is involved', 'That it is your move'], 0, 'Stalemate looks similar — always verify.'],
    ['What is an “ Anastasia’s mate”?', ['Knight mate supported on the long diagonal', 'Back-rank mate', 'Smothered mate', 'Dovetail mate'], 0, 'A knight mates with the queen pinning the king on the diagonal.'],
    ['What is the “corner mate”?', ['The king is driven into a corner by a rook or queen', 'A knight mate', 'A pawn mate', 'A bishop mate'], 0, 'The king is squeezed into a corner where it has no flight squares.'],
    ['How does a bishop usually deliver mate?', ['With another piece cutting off the escape squares', 'Alone, on a corner', 'It cannot', 'Only with a pawn'], 0, 'A lone bishop cannot mate; it needs support to box the king in.'],
    ['What is the point of a “box mate”?', ['A rook or queen confines the king to a small area before mating', 'A stalemate trick', 'A pawn promotion trick', 'A fork'], 0, 'Confining the king first makes mate straightforward.'],
    ['Can checkmate be delivered in the opening?', ['Yes', 'No', 'Only with a queen', 'Only after 20 moves'], 0, 'Fool’s mate is checkmate in two moves.'],
    ['What is fool’s mate?', ['Mate in two moves by pushing the queen’s path open with a pawn', 'A knight fork', 'A stalemate', 'A back-rank mate'], 0, '1.f3 e5 2.g4 Qh4# — the fastest possible mate.'],
    ['Why must the defending king usually be on the edge to be mated?', ['Because interior squares offer more flight options', 'Because of the fifty-move rule', 'Because of castling rights', 'It need not be'], 0, 'Fewer escape squares on the edge and in corners.'],
    ['What is a “selfmate” attempt?', ['Deliberately handing the opponent a mating position', 'Losing on time', 'Stalemating yourself', 'Trading queens'], 0, 'Sometimes you must avoid a move that lets the opponent mate you.'],
    ['Which piece can mate without any support?', ['The queen, in a corner', 'The rook', 'The bishop', 'None — every mating piece needs support'], 0, 'The queen can mate alone in a corner or on an edge, though a rook check still needs cover.'],
    ['What is a “greedy king” mistake in the endgame?', ['Grabbing a defended pawn and walking into mate', 'Promoting too early', 'Trading queens', 'Castling late'], 0, 'Kings that chase undefended material often mate themselves.'],
    ['Does checkmate depend on who delivered the check?', ['No — the checked side loses whoever gave it', 'Yes, only White can mate', 'Yes, only the stronger side can mate', 'No, but it is a draw'], 0, 'It does not matter who mated; the game simply ends.'],
    ['What is a “kiss of death” mate?', ['A queen and king mating pattern in the centre of the board', 'A back-rank mate', 'A pawn mate', 'A stalemate'], 0, 'A queen, supported by its king, driving the enemy king in the open.'],
    ['What is a “triangle mate”?', ['A pattern where the mating piece is trapped in a three-square loop', 'A stalemate trick', 'A threefold repetition', 'A knight fork'], 0, 'The mating piece shuffles in a small triangle before delivering mate.'],
    ['Can two rooks alone deliver mate without a king nearby?', ['Yes, together they can mate a bare king', 'No, never', 'Only with a queen', 'Only if the king is in the corner'], 0, 'Two rooks on adjacent files or ranks can mate without their own king.'],
    ['Why is it dangerous to give a check you cannot follow up?', ['The opponent may have a stronger reply, including mate', 'Checks are always bad', 'It loses material automatically', 'It is illegal'], 0, 'A check is only useful if it wins something or forces a favourable answer.'],
    ['What is a “corridor mate”?', ['Mate delivered down a file or rank the king is trapped in', 'A knight mate', 'A pawn mate', 'A stalemate trick'], 0, 'The king is walled in and mated along the corridor.'],
    ['Which side wins if the player to move has no legal move and is not in check?', ['Neither — it is a draw', 'The side that moved last', 'The side with more material', 'It depends on the clock'], 0, 'Stalemate is a draw.'],
    ['Can a lone king and knight checkmate a bare king?', ['No, mate is impossible', 'Yes', 'Only with help', 'Only in blitz'], 0, 'King and knight cannot force mate, so that position is a draw.'],
    ['What is the usual point of a checkmate combination?', ['To win the opponent’s queen or a key piece en route to mate', 'To pass the move', 'To force castling', 'To reach an endgame'], 0, 'Combinations usually win material first and mate second.'],
    ['How many squares does a king in the corner have to move to?', ['Three', 'One', 'Five', 'Eight'], 0, 'A corner king has only three neighbours, and they are often covered too.'],
  ], 'mate');
}

/** Draws: the ways a game can end level. */
function drawPack() {
  return quizzes([
    ['Name one way a game can be drawn.', ['Threefold repetition', 'Checkmate', 'Promotion', 'Resignation'], 0, 'Threefold repetition is one of several draw conditions.'],
    ['What is the fifty-move rule?', ['A draw after 50 moves by each side with no capture or pawn move', 'A win for White after 50 moves', 'A time control', 'A castling rule'], 0, '50 moves by each side with no capture and no pawn move.'],
    ['What is insufficient material?', ['Neither side can possibly checkmate', 'A draw by agreement', 'Threefold repetition', 'A time forfeit'], 0, 'If mate is impossible, the game is drawn.'],
    ['King versus bare king is…', ['An automatic draw', 'A win for White', 'A win for Black', 'Only a 50-move draw'], 0, 'Neither side can mate.'],
    ['What is a “dead position”?', ['No legal sequence of play can end in checkmate', 'Stalemate', 'Resignation', 'Repetition'], 0, 'If mate is impossible, it is drawn.'],
    ['The fifty-move rule is measured in…', ['50 moves by each player with no capture or pawn move', '50 total moves', '50 minutes', '50 pieces'], 0, 'Fifty moves by each side — 100 half-moves.'],
    ['Can players agree a draw at any time?', ['Yes', 'No, never', 'Only before move 20', 'Only if a clock is running'], 0, 'Mutual agreement ends the game as a draw.'],
    ['What is a claim draw?', ['A player asks the arbiter to apply a draw rule', 'Offering a piece swap', 'Offering to resign', 'Playing a stalemate'], 0, 'A claim invokes the rule directly.'],
    ['Threefold repetition means the position occurred…', ['Three times', 'Twice', 'Five times', 'Once'], 0, 'The same position three times allows a draw claim.'],
    ['How is a draw scored for ratings?', ['Half a point', 'Nothing at all', 'A full point', 'Double points'], 0, 'A draw is ½ for each player.'],
    ['You flag, but your opponent has no possible mating material. Result?', ['Draw', 'You lose on time', 'Game continues', 'Replay the position'], 0, 'With no mating material the timeout is a draw.'],
    ['Which of these is NOT a draw?', ['Checkmate', 'Stalemate', 'Insufficient material', 'Threefold repetition'], 0, 'Checkmate is a win.'],
    ['Does a draw end the game immediately?', ['Yes, the game is over', 'No, play continues', 'Only after agreement is recorded', 'Only in rated games'], 0, 'Once a draw condition is reached the game is finished.'],
    ['What is a “claim” in time-pressure chess?', ['Asking the arbiter to stop the clock and declare a draw', 'Moving quickly', 'Saying “draw”', 'Offering a piece'], 0, 'A formal request that must be made correctly and in time.'],
    ['Does a draw count toward your rating total?', ['Yes, as half a point', 'No, it is ignored', 'As a full point', 'Only in blitz'], 0, 'A draw is scored ½ for each player.'],
    ['What is the “dead position” rule for online play?', ['A server may end the game as drawn when mate is impossible', 'It does not exist online', 'It applies only to correspondence', 'It is a warning only'], 0, 'Online servers usually auto-draw a dead position.'],
    ['Is stalemate a win for the player who caused it?', ['No, it is always a draw', 'Yes', 'Only if it is by a queen', 'Only in blitz'], 0, 'Stalemate is a draw regardless of who caused it.'],
    ['How many times must a position repeat for a threefold claim?', ['Three', 'Two', 'Five', 'Once'], 0, 'The same position three times.'],
    ['Must the position be identical each time, including whose turn it is?', ['Yes, all conditions including the side to move', 'No, only the pieces', 'Only the pieces on the board', 'Only the material'], 0, 'Same pieces, same squares, same side to move, same castling and en-passant rights.'],
    ['Can a draw by agreement be reached in a won position?', ['Yes, players may agree anything', 'No, never', 'Only in blitz', 'Only if under time pressure'], 0, 'A player may offer a draw even when winning; the opponent decides.'],
    ['What is a “dead heat” in online leagues?', ['Both players score equally', 'One player times out', 'A disconnect', 'A fifty-move draw'], 0, 'League jargon for an equal score.'],
    ['Does insufficient material include king and knight versus king?', ['Yes — mate is impossible', 'No, mate is still possible', 'Only with two knights', 'Only in the endgame'], 0, 'King and knight cannot force mate against a bare king.'],
    ['Is a threefold repetition automatic or claim-based?', ['Claim-based, though many servers auto-draw it', 'Always automatic', 'Never allowed', 'Only in rated games'], 0, 'Formally a claim, though most servers end it for you.'],
    ['Does a draw affect your position on a leaderboard?', ['Yes, it is scored like any other result', 'No, draws are ignored', 'Only in blitz', 'Only if both players agree'], 0, 'A draw counts as half a point everywhere.'],
    ['What is a “threefold” repetition measured against?', ['The position including the side to move', 'Only the board layout', 'Only the material', 'Only the last move'], 0, 'All elements of the position must match.'],
    ['Is a draw possible by agreement in online blitz?', ['Yes, though it is discouraged', 'No, never', 'Only under 3 minutes', 'Only in rated games'], 0, 'It is legal everywhere, but rapid/blitz players usually avoid it.'],
    ['What happens if only one player can mate?', ['The game is drawn — insufficient material', 'The other player loses on time', 'Play continues', 'It is a forfeit'], 0, 'If mate is impossible, a flag does not lose the game.'],
    ['Does the fifty-move rule reset after each capture?', ['Yes', 'No', 'Only after a check', 'Only in the endgame'], 0, 'Any capture or pawn move resets the halfmove clock.'],
    ['Can a draw be forced by a player who is completely lost?', ['Yes, by claiming a draw condition or agreeing one', 'No, never', 'Only by resigning', 'Only in bullet'], 0, 'A lost player can still save half a point.'],
  ], 'draw');
}



/**
 * Assembles every pack, then re-verifies each move drill with chess.js and
 * drops anything illegal or duplicated. Returns the audit counts.
 */
function build() {
  const packs = {
    board: boardPack().concat(boardBoardPack()),
    king: kingPack(),
    queen: queenPack(),
    rook: rookPack(),
    bishop: bishopPack(),
    knight: knightPack(),
    pawn: pawnPack(),
    'special-rules': specialPack().concat(specialBoardPack(), specialSweep()),
    check: checkPack().concat(checkBoardPack()),
    checkmate: matePack().concat(mateBoardPack()),
    draw: drawPack().concat(drawBoardPack()),
  };

  let dropped = 0;
  let rejected = 0;
  for (const [lesson, list] of Object.entries(packs)) {
    const seen = new Set();
    packs[lesson] = list.filter((ex) => {
      if (ex.type === 'quiz') return true;
      let game;
      try { game = new Chess(ex.fen); } catch { dropped += 1; return false; }
      // The SAN must be one chess.js itself would produce in this position.
      // NB: `moves()` returns plain SAN strings in this version — the verbose
      // objects (with .from/.to/.san) need `{ verbose: true }`.
      if (!game.moves().includes(ex.expectedSan)) { dropped += 1; return false; }
      const key = `${ex.fen}|${ex.expectedSan}`;
      if (seen.has(key)) { dropped += 1; return false; }   // no duplicate drills
      seen.add(key);

      /* SEMANTIC GATE — legality is not enough.
         A drill for the CHECK lesson must actually involve check, and one for
         the CHECKMATE lesson must actually be mate. Without this, a "mate"
         drill that delivers no check at all still passes every test above and
         teaches the student something false. Positions that fail the rule the
         lesson is named after are dropped here, exactly like illegal ones. */
      const why = semanticsFail(lesson, ex);
      if (why) {
        rejected += 1;
        if (process.env.ACADEMY_DEBUG) console.log(`  [rejected:${lesson}] ${why} :: ${ex.fen} ${ex.expectedSan}`);
        return false;
      }
      return true;
    });
  }
  return { packs: shapePacks(packs), dropped, rejected };
}

/**
 * Does this drill fail to do what its lesson claims? Returns a reason string, or
 * null when the drill is semantically sound.
 *
 * Only lessons with a real chess CONCEPT are checked — the piece-movement
 * lessons (king/queen/rook/bishop/knight/pawn) and the board lesson just teach
 * "make this legal move", which the legality test already covers.
 */
function semanticsFail(lesson, ex) {
  const g = new Chess(ex.fen);
  const wasInCheck = g.isCheck();
  const moverIsWhite = g.turn() === 'w';
  g.move(ex.expectedSan);
  const nowInCheck = g.isCheck();

  if (lesson === 'checkmate') {
    if (!g.isCheckmate()) {
      return nowInCheck
        ? 'claims checkmate but the defender still has a legal move'
        : 'claims checkmate but the move does not even give check';
    }
    return null;
  }

  if (lesson === 'check') {
    if (moverIsWhite) {
      // "Answer the check": the mover must start in check and end out of it.
      if (!wasInCheck) return 'claims to answer a check but the mover is not in check';
      if (nowInCheck) return 'claims to answer a check but the king is still in check afterwards';
    } else {
      // "Give check": the move must actually check the enemy king.
      if (!nowInCheck) return 'claims to give check but the enemy king is not in check';
    }
    return null;
  }

  if (lesson === 'special-rules') {
    const move = new Chess(ex.fen).move(ex.expectedSan);
    if (/en passant/i.test(ex.instruction)) {
      // chess.js marks an en-passant capture with 'e' in `flags`.
      if (!String(move?.flags || '').includes('e')) return 'claims en passant but the move is not one';
    }
    if (/promot/i.test(ex.instruction) && !move?.promotion) {
      return 'claims a promotion but the move is not one';
    }
    if (/castle|castling|king two squares/i.test(ex.instruction)) {
      if (!/^O-O(-O)?/.test(move?.san || '')) return 'claims castling but the move is not a castle';
    }
  }

  return null;
}

/**
 * Enforce the product rule: EVERY lesson is at most `MAX_EXERCISES` long and
 * at most `QUIZ_RATIO` of it may be multiple-choice — the rest must be played
 * on the board.
 *
 * This runs AFTER the chess.js verification above, so anything trimmed here is
 * already known to be a legal, solvable position.
 *
 * Why it is done here rather than in the UI: exercise counts are also used to
 * decide whether a lesson counts as "complete" (academyController), so a cap
 * applied only in the frontend would make the progress maths disagree with the
 * screen.
 *
 * The 10% quota is rounded UP to a whole exercise (3 of 30) rather than rounded
 * down (which would give 0 quizzes and lose the concept-reinforcement questions
 * entirely). It is applied as a MAXIMUM, not a target: a lesson whose authored
 * content is all board work keeps 0 quizzes.
 */
const MAX_EXERCISES = 30;
const QUIZ_RATIO = 0.1;

function shapePacks(packs) {
  for (const lesson of Object.keys(packs)) {
    const list = packs[lesson];
    const board = list.filter((e) => e.type === 'move');
    const quiz = list.filter((e) => e.type === 'quiz');

    // `info` exercises are hand-authored reading tasks, not board work and not
    // quizzes; they ride along in the authored set and count toward the cap.
    const other = list.filter((e) => e.type !== 'move' && e.type !== 'quiz');

    const quizCap = Math.max(1, Math.ceil(MAX_EXERCISES * QUIZ_RATIO));

    /* Reserve the quiz quota BEFORE filling with board drills, so a lesson
       with plenty of board work still gets its few concept questions. Taking
       board drills first would consume all 30 slots and silently drop them. */
    const keptQuiz = quiz.slice(0, quizCap);
    const boardBudget = MAX_EXERCISES - keptQuiz.length;
    const keptBoard = board.slice(0, boardBudget);
    const room = MAX_EXERCISES - keptBoard.length - keptQuiz.length;
    const keptOther = other.slice(0, Math.max(0, room));
    let kept = keptBoard.concat(keptQuiz, keptOther);

    /* Interleave so quizzes are spread through the lesson rather than dumped
       at the end — a student should practise, then be asked, then practise. */
    const boardLeft = keptBoard;
    if (keptQuiz.length && boardLeft.length) {
      const mixed = [];
      const step = Math.max(1, Math.floor(boardLeft.length / (keptQuiz.length + 1)));
      let bi = 0;
      let qi = 0;
      while (bi < boardLeft.length) {
        const chunk = boardLeft.slice(bi, bi + step);
        mixed.push(...chunk);
        bi += step;
        if (qi < keptQuiz.length) mixed.push(keptQuiz[qi++]);
      }
      while (qi < keptQuiz.length) mixed.push(keptQuiz[qi++]);
      mixed.push(...keptOther);
      packs[lesson] = mixed;
    } else {
      packs[lesson] = kept.concat(keptOther);
    }

    // Progress rows key on exercise_slug, so slugs must be unique per lesson.
    const slugs = new Set();
    packs[lesson].forEach((ex, i) => {
      if (!ex.slug) ex.slug = `${lesson}-auto-${i + 1}`;
      if (slugs.has(ex.slug)) ex.slug = `${ex.slug}-${i + 1}`;
      slugs.add(ex.slug);
    });
  }
  return packs;
}

const { packs, dropped, rejected } = build();

if (process.env.ACADEMY_DEBUG) {
  for (const [name, list] of Object.entries(packs)) {
    const by = list.reduce((m, e) => ((m[e.type] = (m[e.type] || 0) + 1), m), {});
    console.log(`  [debug] ${name.padEnd(15)} ${JSON.stringify(by)}`);
  }
}

const HEADER = `/**
 * GENERATED exercise packs for the Academy beginner level.
 *
 * Do not hand-edit — regenerate with:
 *   node scripts/generate_academy_exercises.js
 *
 * Every \`move\` exercise here was machine-verified with chess.js: the FEN parses
 * and \`expectedSan\` is a legal move in that exact position.
 * \`lessonExercises()\` in academyCurriculum.js merges these AFTER the
 * hand-authored exercises, so a lesson's curated drills always come first.
 *
 * The move drills are generated rather than hand-written because the point of a
 * piece-movement lesson is repetition across the whole board: every square a
 * piece can reach teaches the same rule, and covering only three of them (as the
 * original hand-authored set did) leaves large gaps.
 */
`;

fs.writeFileSync(
  OUT,
  `${HEADER}\nconst PACKS = ${JSON.stringify(packs, null, 2)};\n\nmodule.exports = { PACKS };\n`,
  'utf8'
);

console.log(`Wrote ${path.relative(process.cwd(), OUT)}`);
console.log(`Dropped ${dropped} unverified or duplicate drill(s).`);
console.log(`Rejected ${rejected} drill(s) that did not match their lesson's chess rule.\n`);
for (const [lesson, list] of Object.entries(packs)) {
  const moves = list.filter((e) => e.type === 'move').length;
  const quizz = list.length - moves;
  console.log(`  ${lesson.padEnd(16)} ${String(list.length).padStart(3)} generated  (${moves} move, ${quizz} quiz)`);
}


