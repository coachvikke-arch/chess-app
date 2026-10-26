/* Authoring tool: builds tactics.json from piece placements and verifies every
 * position and every move with chess.js before writing. Not shipped in the app.
 *
 * The one hard rule this tool enforces: white's solution is interleaved with
 * black's `opponentReplies`, because a two-move white idea (take the defender,
 * then take the piece) is NOT a two-item SAN list — the black reply sits between
 * them and has to be legal for the position to make sense. */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Chess } from 'chess.js';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'features', 'tactics', 'data', 'tactics.json');

function fen(pl, turn = 'w') {
  const rows = [];
  for (let r = 8; r >= 1; r--) {
    let run = 0, row = '';
    for (let f = 0; f < 8; f++) {
      const p = pl[`${'abcdefgh'[f]}${r}`];
      if (!p) { run++; continue; }
      if (run) { row += run; run = 0; }
      row += p;
    }
    if (run) row += run;
    rows.push(row);
  }
  return `${rows.join('/')} ${turn} - - 0 1`;
}

/** Interleaved white/black replay. Returns the final fen plus mate/check flags. */
function run(pl, white, black, turn = 'w') {
  const start = fen(pl, turn);
  const c = new Chess(start);
  if (c.isCheck()) return { err: 'the side to move is already in check — unreachable start', fen: start };
  const done = [];
  let bi = 0;
  for (let i = 0; i < white.length; i++) {
    let m = null;
    try { m = c.move(white[i]); } catch { m = null; }
    if (!m) return { err: `illegal white "${white[i]}" after [${done.join(' ')}]`, fen: start, opts: c.moves() };
    if (m.san !== white[i]) return { err: `white SAN: wrote "${white[i]}" engine "${m.san}"`, fen: start };
    done.push(m.san);
    if (bi < black.length) {
      let bm = null;
      try { bm = c.move(black[bi]); } catch { bm = null; }
      if (!bm) return { err: `illegal black "${black[bi]}" after [${done.join(' ')}]`, fen: start, opts: c.moves() };
      if (bm.san !== black[bi]) return { err: `black SAN: wrote "${black[bi]}" engine "${bm.san}"`, fen: start };
      done.push(bm.san);
      bi++;
    }
  }
  if (bi < black.length) return { err: 'more replies than white moves', fen: start };
  /* `start`, NOT c.fen(): the card must draw the position BEFORE the key move. */
  return { start, fen: start, mate: c.isCheckmate(), check: c.isCheck(), seq: done };
}

const RED = (s) => ({ square: s, color: 'red' });
const ORANGE = (s) => ({ square: s, color: 'orange' });
const GREEN = (s) => ({ square: s, color: 'green' });
const ARROW = (f, t) => ({ from: f, to: t });

const T = [];
const add = (e) => T.push(e);

/* ── Basic tactics ─────────────────────────────────────────────────────── */
add({ id: 1, slug: 'fork', category: 'Basic Tactics', title: 'Fork', tags: ['fork', 'knight', 'check'],
  pieces: { d8: 'q', h8: 'k', e5: 'N', g1: 'K' }, solution: ['Nf7+'], opponentReplies: [],
  highlights: [RED('d8'), RED('h8'), ORANGE('f7'), GREEN('e5')],
  arrows: [ARROW('e5', 'f7'), ARROW('f7', 'd8'), ARROW('f7', 'h8')],
  caption: 'Nf7+ one piece, two targets',
  whatItIs: 'A knight jumps to f7 with check, hitting the king and the queen at the same time.',
  whyItWins: 'The king must move out of check first. Then you take the queen for free.',
  doThis: 'Look for knight jumps that hit the king and a big piece at once. Knights fork best.' });

add({ id: 2, slug: 'pin', category: 'Basic Tactics', title: 'Pin', tags: ['pin', 'bishop'],
  pieces: { e8: 'k', c6: 'n', f1: 'B', g1: 'K' }, solution: ['Bb5'], opponentReplies: [],
  highlights: [RED('e8'), RED('c6'), ORANGE('b5')],
  arrows: [ARROW('f1', 'b5'), ARROW('b5', 'e8')],
  caption: 'Bb5 pins the knight to the king',
  whatItIs: 'The bishop takes aim along the diagonal and traps the knight in front of its own king.',
  whyItWins: 'A pinned piece cannot move, so it can never block a check or run away with anything.',
  doThis: 'Find lines where your piece, an enemy piece and their king sit in a straight line.' });

add({ id: 3, slug: 'skewer', category: 'Basic Tactics', title: 'Skewer', tags: ['skewer', 'rook', 'check'],
  pieces: { e5: 'k', h5: 'q', a1: 'R', g1: 'K' }, solution: ['Ra5+'], opponentReplies: [],
  highlights: [RED('h5'), ORANGE('e5'), GREEN('a5')],
  arrows: [ARROW('a1', 'a5'), ARROW('a5', 'e5'), ARROW('e5', 'h5')],
  caption: 'Ra5+ king moves, Rxh5',
  whatItIs: 'A rook checks the king, and the same line runs on to the queen behind him.',
  whyItWins: 'The king must step away, which opens the whole rank. The rook then takes the queen.',
  doThis: 'Check along a rank or file and see if a valuable piece is hiding behind the king.' });

add({ id: 4, slug: 'discovered-attack', category: 'Basic Tactics', title: 'Discovered Attack', tags: ['discoveredAttack', 'bishop'],
  pieces: { a8: 'q', h8: 'k', a2: 'B', a1: 'R', e1: 'K' }, solution: ['Bb3'], opponentReplies: [],
  highlights: [RED('a8'), GREEN('a2'), ORANGE('b3')],
  arrows: [ARROW('a2', 'b3'), ARROW('a1', 'a8')],
  caption: 'Bb3 clears the file, Ra1 wins the queen',
  whatItIs: 'Your own piece was blocking a line. Move it aside and the piece behind suddenly attacks.',
  whyItWins: 'The rook could not move while its own bishop stood in the way. Now the queen is loose.',
  doThis: 'Before you move, check what your own pieces are hiding. Stepping aside often attacks twice.' });

add({ id: 5, slug: 'discovered-check', category: 'Basic Tactics', title: 'Discovered Check', tags: ['discoveredCheck', 'bishop'],
  pieces: { a8: 'k', a2: 'B', a1: 'R', h1: 'K' }, solution: ['Bb3+'], opponentReplies: [],
  highlights: [RED('a8'), GREEN('a2'), ORANGE('b3')],
  arrows: [ARROW('a2', 'b3'), ARROW('a1', 'a8')],
  caption: 'Bb3+ uncovers the rook\u2019s check',
  whatItIs: 'The bishop steps aside and the rook behind it suddenly gives check along the file.',
  whyItWins: 'Black had no legal move while the bishop blocked the file. The check comes from nowhere.',
  doThis: 'If one of your pieces sits in front of a line to the enemy king, moving it may be a check.' });

add({ id: 6, slug: 'double-check', category: 'Basic Tactics', title: 'Double Check', tags: ['doubleCheck', 'bishop'],
  pieces: { a8: 'k', a6: 'B', a1: 'R', h1: 'K' }, solution: ['Bb7+'], opponentReplies: [],
  highlights: [RED('a8'), ORANGE('b7'), GREEN('a6')],
  arrows: [ARROW('a6', 'b7'), ARROW('a1', 'a8'), ARROW('b7', 'a8')],
  caption: 'Bb7+ two pieces give check at once',
  whatItIs: 'One move makes two different pieces check the king. That is called double check.',
  whyItWins: 'Only the king can move, because no single piece can block two separate lines at once.',
  doThis: 'After your move, count how many enemy pieces are checking. Two means the king must move.' });

add({ id: 7, slug: 'double-attack', category: 'Basic Tactics', title: 'Double Attack', tags: ['doubleAttack', 'queen'],
  pieces: { d8: 'q', h8: 'k', e5: 'r', c1: 'Q', g1: 'K' }, solution: ['Qg5'], opponentReplies: [],
  highlights: [RED('d8'), RED('e5'), ORANGE('g5'), GREEN('c1')],
  arrows: [ARROW('c1', 'g5'), ARROW('g5', 'e5'), ARROW('g5', 'd8')],
  caption: 'Qg5 hits the queen and the rook',
  whatItIs: 'The queen lands where one move threatens two different pieces at the same time.',
  whyItWins: 'Black can only save one of them. The other falls to the queen.',
  doThis: 'Check every square your piece can reach for two targets at once.' });

add({ id: 8, slug: 'removing-the-defender', category: 'Basic Tactics', title: 'Removing the Defender', tags: ['removingDefender', 'bishop'],
  pieces: { g8: 'k', g6: 'n', a5: 'R', e5: 'q', d3: 'B', g1: 'K' },
  solution: ['Bxg6', 'Rxe5'], opponentReplies: ['Kh8'],
  highlights: [RED('e5'), ORANGE('g6'), GREEN('d3'), GREEN('a5')],
  arrows: [ARROW('d3', 'g6'), ARROW('a5', 'e5')],
  caption: 'Bxg6 the knight guards the queen',
  whatItIs: 'The knight on g6 protects the black queen. White takes the knight first, not the queen.',
  whyItWins: 'With the knight gone nothing defends the queen, so the rook simply takes it next move.',
  doThis: 'Before you win a piece, find the enemy piece that saves it. Remove that one first.' });

add({ id: 9, slug: 'deflection', category: 'Basic Tactics', title: 'Deflection', tags: ['deflection', 'bishop'],
  pieces: { e8: 'k', d7: 'p', e7: 'p', f7: 'p', c7: 'b', e5: 'q', h5: 'Q', a1: 'R', g1: 'K' },
  solution: ['Ra8+', 'Qxe5'], opponentReplies: ['Bd8'],
  highlights: [RED('e8'), RED('e5'), ORANGE('c7'), GREEN('h5')],
  arrows: [ARROW('a1', 'a8'), ARROW('c7', 'd8'), ARROW('h5', 'e5')],
  caption: 'Ra8+ drags the bishop away, Qxe5 wins',
  whatItIs: 'The bishop is the only thing guarding the queen. White forces it to step out of the way.',
  whyItWins: 'Blocking the check on d8 means the bishop leaves c7, and the queen is suddenly free.',
  doThis: 'When a piece is defended, ask what would happen if that defender stood somewhere else.' });

add({ id: 10, slug: 'decoy', category: 'Basic Tactics', title: 'Decoy', tags: ['decoy', 'rook', 'check'],
  pieces: { e8: 'k', f7: 'q', d7: 'p', h1: 'R', b1: 'K' },
  solution: ['Re1+'], opponentReplies: ['Kd8'],
  highlights: [RED('f7'), ORANGE('e7'), GREEN('e1')],
  arrows: [ARROW('h1', 'e8')],
  caption: 'Re1+ the king is dragged off the queen',
  whatItIs: 'A check pulls the king away from the queen he was protecting, and the queen is left hanging.',
  whyItWins: 'The king must step away to e8’s neighbour squares, and neither of them touches f7.',
  doThis: 'When a piece is guarded by the king, check the king. He has to step away from it.' });

add({ id: 11, slug: 'interference', category: 'Basic Tactics', title: 'Interference', tags: ['interference', 'knight'],
  pieces: { e8: 'k', a5: 'r', e5: 'q', c3: 'N', e1: 'R', g1: 'K' },
  solution: ['Nd5', 'Rxe5'], opponentReplies: ['Kd8'],
  highlights: [RED('e5'), ORANGE('d5'), GREEN('c3')],
  arrows: [ARROW('c3', 'd5'), ARROW('e1', 'e5')],
  caption: 'Nd5! the knight steps in front of the rook',
  whatItIs: 'The knight jumps onto the fifth rank, between the black rook and the black queen.',
  whyItWins: 'The rook can no longer guard the queen, so the white rook simply picks the queen up.',
  doThis: 'If two enemy pieces are working together, put one of your pieces between them.' });

add({ id: 12, slug: 'overloading', category: 'Basic Tactics', title: 'Overloading', tags: ['overloading', 'knight'],
  pieces: { a8: 'k', d4: 'n', c1: 'R', e1: 'R', g1: 'K' },
  solution: ['Rc6'], opponentReplies: [],
  highlights: [RED('c6'), RED('e6'), ORANGE('d4'), GREEN('c1')],
  arrows: [ARROW('c1', 'c6')],
  caption: 'Rc6 the knight is doing two jobs',
  whatItIs: 'One black knight guards two squares, so it cannot be in both places at once.',
  whyItWins: 'Black cannot move the knight and still cover the other square, so one of them falls.',
  doThis: 'Count the jobs one enemy piece is doing. Attack the square it cannot cover.' });

add({ id: 13, slug: 'hanging-piece', category: 'Basic Tactics', title: 'Hanging Piece', tags: ['hangingPiece', 'rook'],
  pieces: { e8: 'k', a1: 'q', e1: 'R', g1: 'K' }, solution: ['Rxa1'], opponentReplies: [],
  highlights: [RED('a1'), GREEN('e1')],
  arrows: [ARROW('e1', 'a1')],
  caption: 'Rxa1 the queen has no friends',
  whatItIs: 'A piece is worth a lot and nothing is protecting it. That is a hanging piece.',
  whyItWins: 'The rook simply moves across the empty first rank and picks the queen up.',
  doThis: 'At the start of every game ask which of your pieces has no defender at all.' });

add({ id: 14, slug: 'trapped-piece', category: 'Basic Tactics', title: 'Trapped Piece', tags: ['trappedPiece', 'queen'],
  pieces: { e8: 'k', h8: 'n', c2: 'Q', f1: 'K' }, solution: ['Qf5'], opponentReplies: ['Ke7'],
  highlights: [RED('h8'), ORANGE('f7'), ORANGE('g6'), GREEN('c2')],
  arrows: [ARROW('c2', 'f5'), ARROW('f5', 'f7'), ARROW('f5', 'g6')],
  caption: 'Qf5! the knight has nowhere left to go',
  whatItIs: 'The queen covers both squares the knight could run to, so it is stuck on h8 for good.',
  whyItWins: 'A knight that cannot move is worth nothing, and the black king has to carry the game alone.',
  doThis: 'Push enemy pieces towards the edge, then cover the few squares they have left.' });

add({ id: 15, slug: 'x-ray-attack', category: 'Basic Tactics', title: 'X-Ray Attack', tags: ['xRayAttack', 'queen'],
  pieces: { d8: 'q', h8: 'k', d1: 'Q', g1: 'K' }, solution: ['Qd5'], opponentReplies: [],
  highlights: [RED('d8'), ORANGE('d5'), GREEN('d1')],
  arrows: [ARROW('d1', 'd5'), ARROW('d5', 'd8')],
  caption: 'Qd5 sees straight through to d8',
  whatItIs: 'You can see a valuable piece right through another piece, as if the blocker were glass.',
  whyItWins: 'Stepping onto the line attacks the piece behind, even though something stands in the way.',
  doThis: 'Look straight through pieces. A clear line of sight is often the whole point of a quiet move.' });

/* ── Forcing moves ─────────────────────────────────────────────────────── */
add({ id: 16, slug: 'zwischenzug', category: 'Forcing Moves', title: 'Zwischenzug', tags: ['zwischenzug', 'check', 'inBetween'],
  pieces: { e8: 'k', d5: 'q', d1: 'R', d3: 'B', g1: 'K' },
  solution: ['Bb5+', 'Rxd5+'], opponentReplies: ['Kd8'],
  highlights: [RED('d5'), ORANGE('b5'), GREEN('d3')],
  arrows: [ARROW('d3', 'b5'), ARROW('d1', 'd5')],
  caption: 'Bb5+ check first, then Rxd5+ wins the queen',
  whatItIs: 'A check played in the middle of a plan, before the main threat is finished.',
  whyItWins: 'A check has to be answered, so it buys a free tempo to take the piece you wanted.',
  doThis: 'When your plan needs two moves, check first. The answer is forced, so you keep control.' });

add({ id: 17, slug: 'desperado', category: 'Forcing Moves', title: 'Desperado', tags: ['desperado', 'pawn', 'rook'],
  pieces: { c3: 'k', a1: 'R', a2: 'P', g1: 'K' },
  solution: ['Rc1+', 'a4', 'a5'], opponentReplies: ['Kd4', 'Kd3'],
  highlights: [RED('c3'), ORANGE('c1'), GREEN('a2')],
  arrows: [ARROW('a1', 'c1'), ARROW('a2', 'a5')],
  caption: 'Rc1+ chase the king, then a4 and a5 run',
  whatItIs: 'You chase the enemy king with checks so a pawn that is far away can still race past him.',
  whyItWins: 'The king is always being pushed, so he never gets the chance to catch the pawn as it walks home.',
  doThis: 'Drive the enemy king to the edge with checks, then send a passed pawn after him.' });

add({ id: 18, slug: 'sacrifice', category: 'Forcing Moves', title: 'Sacrifice', tags: ['sacrifice', 'pawn'],
  pieces: { e8: 'k', f8: 'R', f6: 'q', e1: 'K', e5: 'P' },
  solution: ['exf6+'], opponentReplies: [],
  highlights: [RED('f6'), GREEN('e5')],
  arrows: [ARROW('e5', 'f6')],
  caption: 'exf6+! a pawn is thrown at the queen',
  whatItIs: 'A piece you do not mind losing is given away on purpose to win something much bigger.',
  whyItWins: 'The pawn is gone for good, but White has taken a whole queen. That trade is never close.',
  doThis: 'Give material away only when the enemy king cannot touch it. Then the trade is nearly free.' });

add({ id: 19, slug: 'clearance-sacrifice', category: 'Forcing Moves', title: 'Clearance Sacrifice', tags: ['clearanceSacrifice', 'bishop', 'rook'],
  pieces: { g8: 'k', f7: 'p', g7: 'p', h7: 'p', f2: 'P', g2: 'P', h2: 'P', b1: 'B', f1: 'R', g1: 'K' },
  solution: ['Bg6', 'Rd1'], opponentReplies: ['fxg6'],
  highlights: [RED('g7'), GREEN('b1'), ORANGE('g1')],
  arrows: [ARROW('b1', 'g6'), ARROW('f1', 'd1')],
  caption: 'Bg6! fxg6 the h-file opens',
  whatItIs: 'A piece is thrown away on purpose to empty a square or a line for another piece.',
  whyItWins: 'Taking the bishop is forced, the g-pawn steps out of the diagonal, and the rook is free to attack.',
  doThis: 'Ask which square you need empty, then find a piece willing to die for it.' });

add({ id: 20, slug: 'windmill', category: 'Forcing Moves', title: 'Windmill', tags: ['windmill', 'rook', 'checking'],
  pieces: { a8: 'k', b7: 'p', c7: 'p', a1: 'R', h1: 'K' },
  solution: ['Ra7+', 'Rxb7+'], opponentReplies: ['Kb8'],
  highlights: [RED('a8'), ORANGE('a7'), ORANGE('b7'), GREEN('a1')],
  arrows: [ARROW('a1', 'a7'), ARROW('a7', 'a8')],
  caption: 'Ra7+ Kb8 Rxb7+ the king runs out of squares',
  whatItIs: 'A rook checks, the king shuffles between two squares, and the rook collects as it goes.',
  whyItWins: 'The king has only two squares to shuffle between, so the rook can keep checking and taking.',
  doThis: 'When a king has no good squares, repeat the check and collect something each time.' });

/* ── Mating patterns ───────────────────────────────────────────────────── */
add({ id: 21, slug: 'back-rank-mate', category: 'Mating Patterns', title: 'Back Rank Mate', tags: ['backRankMate', 'rook', 'mateIn1'],
  pieces: { g8: 'k', f7: 'p', g7: 'p', h7: 'p', a1: 'R', g1: 'K' }, solution: ['Ra8#'], opponentReplies: [],
  highlights: [RED('g8'), ORANGE('a8'), GREEN('a1'), ORANGE('f7'), ORANGE('g7'), ORANGE('h7')],
  arrows: [ARROW('a1', 'a8'), ARROW('a8', 'g8')],
  caption: 'Ra8# the king is boxed in by his own pawns',
  whatItIs: 'The rook checks along the back rank, where the king cannot escape because its own pawns block it.',
  whyItWins: 'Every square next to the king is either attacked or filled by a black pawn. There is no answer.',
  doThis: 'Look for a king that has not moved. Its own pawns are a wall you can check over.' });

add({ id: 22, slug: 'smothered-mate', category: 'Mating Patterns', title: 'Smothered Mate', tags: ['smotheredMate', 'knight', 'mateIn1'],
  pieces: { h8: 'k', g8: 'r', g7: 'p', h7: 'p', g5: 'N', g1: 'K' }, solution: ['Nf7#'], opponentReplies: [],
  highlights: [RED('h8'), RED('g8'), RED('g7'), RED('h7'), ORANGE('f7'), GREEN('g5')],
  arrows: [ARROW('g5', 'f7'), ARROW('f7', 'h8')],
  caption: 'Nf7# the rook and pawns box the king in',
  whatItIs: 'A knight gives mate, and the king cannot move because its own pieces fill every square.',
  whyItWins: 'A knight check cannot be blocked, so the only escape would have to be a square, and there is none.',
  doThis: 'A smothered mate needs a rook boxed in near a corner. Then look for a knight jump to f7 or h7.' });

add({ id: 23, slug: 'scholars-mate', category: 'Mating Patterns', title: "Scholar's Mate", tags: ['scholarsMate', 'queen', 'mateIn2', 'opening'],
  pieces: { a8: 'r', b8: 'n', c8: 'b', d8: 'q', e8: 'k', f8: 'b', g8: 'n', h8: 'r',
            a7: 'p', b7: 'p', c7: 'p', d7: 'p', f7: 'p', g7: 'p', h7: 'p',
            c6: 'n', e5: 'p', c4: 'B', f3: 'Q', a2: 'P', b2: 'P', c2: 'P', d2: 'P', f2: 'P', g2: 'P', h2: 'P',
            a1: 'R', b1: 'N', c1: 'B', e1: 'K', h1: 'R' },
  solution: ['Qxf7#'], opponentReplies: [],
  highlights: [RED('e8'), RED('f7'), ORANGE('f3'), GREEN('c4')],
  arrows: [ARROW('f3', 'f7'), ARROW('f7', 'e8')],
  caption: 'Qxf7# mate in two',
  whatItIs: 'The classic four move finish. Play Bc4, then Qf3, and the queen is aimed at f7.',
  whyItWins: 'The king cannot help defend f7 and cannot run away, because the bishop already covers e8.',
  doThis: 'Memorise the pattern: Bc4, Qf3, and then Qxf7 wins. Look for it in every opening.' });

add({ id: 24, slug: 'fools-mate', category: 'Mating Patterns', title: "Fool's Mate", tags: ['foolsMate', 'queen', 'blunder', 'opening'],
  pieces: { a8: 'r', b8: 'n', c8: 'b', d8: 'q', e8: 'k', f8: 'b', g8: 'n', h8: 'r',
            a7: 'p', b7: 'p', c7: 'p', d7: 'p', f7: 'p', g7: 'p', h7: 'p',
            e5: 'p', g4: 'P', f3: 'P', a2: 'P', b2: 'P', c2: 'P', d2: 'P', e2: 'P', h2: 'P',
            a1: 'R', b1: 'N', c1: 'B', f1: 'B', d1: 'Q', e1: 'K', g1: 'N', h1: 'R' },
  turn: 'b',
  solution: ['Qh4#'], opponentReplies: [],
  highlights: [RED('e1'), ORANGE('d8'), ORANGE('h4'), ORANGE('g4')],
  arrows: [ARROW('d8', 'h4')],
  caption: 'Qh4# the pawn moves made this possible',
  whatItIs: 'Black mates in one move. White lost because his own pawns boxed his king in.',
  whyItWins: 'The f-pawn moved away, so the queen has a free diagonal straight into the corner.',
  doThis: 'Never move f3 or f4 early, and keep a piece near e1. This mate is White\u2019s own fault.' });

add({ id: 25, slug: 'anastasias-mate', category: 'Mating Patterns', title: "Anastasia's Mate", tags: ['anastasiasMate', 'knight', 'rook'],
  pieces: { h7: 'k', g6: 'p', h6: 'p', a8: 'R', f6: 'P', e6: 'N', g1: 'K' },
  solution: ['Nf8+'], opponentReplies: [],
  highlights: [RED('h7'), ORANGE('g8'), ORANGE('g7'), GREEN('e6')],
  arrows: [ARROW('e6', 'f8'), ARROW('f8', 'h7'), ARROW('a8', 'h8')],
  caption: 'Nf8+ the king is walled in by its own pawns',
  whatItIs: 'The king is already trapped on h7, and a knight jumps in to give the mate.',
  whyItWins: 'The rook covers h8, the pawn covers g7, and the two black pawns block the rest.',
  doThis: 'Spot a king boxed by its own men. Then look for a knight jump that nothing can stop.' });

add({ id: 26, slug: 'arabian-mate', category: 'Mating Patterns', title: 'Arabian Mate', tags: ['arabianMate', 'knight', 'rook'],
  pieces: { h8: 'k', h7: 'p', g1: 'R', d6: 'N', b1: 'K' },
  solution: ['Nf7#'], opponentReplies: [],
  highlights: [RED('h8'), ORANGE('g8'), ORANGE('g7'), GREEN('d6')],
  arrows: [ARROW('d6', 'f7'), ARROW('f7', 'h8'), ARROW('g1', 'g8')],
  caption: 'Nf7# the rook walls off g8, the knight mates',
  whatItIs: 'A rook and a knight work together to mate a king stuck on the edge of the board.',
  whyItWins: 'The rook covers the escape squares along the edge, so only the knight can give the final check.',
  doThis: 'Push the king to the rim, then switch between rook and knight to finish.' });

add({ id: 27, slug: 'bodens-mate', category: 'Mating Patterns', title: "Boden's Mate", tags: ['bodensMate', 'bishops', 'queen'],
  pieces: { h8: 'k', e8: 'q', h7: 'p', d5: 'B', g5: 'B', g1: 'K' },
  solution: ['Bf6#'], opponentReplies: [],
  highlights: [RED('h8'), ORANGE('g8'), ORANGE('h7'), GREEN('g5')],
  arrows: [ARROW('g5', 'f6'), ARROW('f6', 'h8'), ARROW('d5', 'g8')],
  caption: 'Bf6# two bishops cross around the king',
  whatItIs: 'Two bishops on crossing diagonals box the king in and deliver mate between them.',
  whyItWins: 'One bishop checks and the other covers g8, so the king has no square left to run to.',
  doThis: 'Bishops are strongest when their diagonals cross around the enemy king.' });

add({ id: 28, slug: 'hook-mate', category: 'Mating Patterns', title: 'Hook Mate', tags: ['hookMate', 'rook', 'pawn'],
  pieces: { h8: 'k', g7: 'p', h7: 'p', f7: 'p', a1: 'R', g1: 'K' },
  solution: ['Ra7', 'Ra8#'], opponentReplies: ['Kg8'],
  highlights: [RED('h8'), RED('g8'), ORANGE('a7'), GREEN('a1')],
  arrows: [ARROW('a1', 'a7'), ARROW('a7', 'g7')],
  caption: 'Ra7! Kg8 Ra8# the rook and the pawns hook the king',
  whatItIs: 'The rook comes in beside a pawn and the two of them hook the king against the wall.',
  whyItWins: 'The pawn covers g6, so the king cannot step down the g-file, and the rook covers the rank.',
  doThis: 'Rook plus pawn is often enough. Drive the king to the wall and use the pawn to seal it.' });

add({ id: 29, slug: 'epaulette-mate', category: 'Mating Patterns', title: 'Epaulette Mate', tags: ['epauletteMate', 'queen'],
  pieces: { e8: 'k', d8: 'r', f8: 'r', h4: 'Q', d6: 'P', g1: 'K' },
  solution: ['Qe7#'], opponentReplies: [],
  highlights: [RED('e8'), RED('d8'), RED('f8'), ORANGE('e7'), GREEN('h4')],
  arrows: [ARROW('h4', 'e7'), ARROW('e7', 'e8')],
  caption: 'Qe7# mate between the guards',
  whatItIs: 'The queen mates while the king\u2019s own two rooks sit beside him like epaulettes.',
  whyItWins: 'The rooks on d8 and f8 are the king\u2019s own walls, so it cannot step out of the way.',
  doThis: 'When a king is guarded, check it from straight in front. Its own guards become the walls.' });

add({ id: 30, slug: 'dovetail-mate', category: 'Mating Patterns', title: 'Dovetail Mate', tags: ['dovetailMate', 'queen'],
  pieces: { g8: 'k', f7: 'p', g7: 'p', h7: 'p', d1: 'Q', e6: 'N', g1: 'K' },
  solution: ['Qd8#'], opponentReplies: [],
  highlights: [RED('h8'), ORANGE('g7'), ORANGE('g8'), GREEN('e6')],
  arrows: [ARROW('d1', 'd8'), ARROW('d8', 'g7')],
  caption: 'Qd8+ Kh8 Qxg7# the king is caught in a V',
  whatItIs: 'The queen mates in the middle of the board, and the king\u2019s escapes fail in a V shape.',
  whyItWins: 'The queen takes g7 and the knight protects it, while the king\u2019s own pawns close the other squares.',
  doThis: 'A queen in the centre is worth more than on the edge. Check where the king can go and cover it.' });

add({ id: 31, slug: 'greek-gift', category: 'Mating Patterns', title: 'Greek Gift', tags: ['greekGift', 'queen', 'sacrifice'],
  pieces: { g8: 'k', f8: 'r', f7: 'p', g7: 'p', h7: 'p', f3: 'N', h3: 'Q', g1: 'K' },
  solution: ['Qxh7+', 'Ng5+'], opponentReplies: ['Kxh7'],
  highlights: [RED('g8'), RED('h7'), ORANGE('h3'), GREEN('f3')],
  arrows: [ARROW('h3', 'h7'), ARROW('f3', 'g5')],
  caption: 'Qxh7+ Kxh7 the knight lands with check',
  whatItIs: 'You hand over the queen on h7, on purpose, purely to drag the king out of the corner.',
  whyItWins: 'The king must take, because that is the only square left. Then it is loose in the open.',
  doThis: 'Sacrifice on h7 when the king has no good square. It buys the whole kingside for one queen.' });

add({ id: 32, slug: 'legals-mate', category: 'Mating Patterns', title: "Legal's Mate", tags: ['legalsMate', 'rook', 'bishop', 'opening'],
  pieces: { e8: 'k', d8: 'q', f8: 'r', d7: 'p', d6: 'p', g6: 'P', c4: 'B', c3: 'N', h1: 'R', a1: 'R', g1: 'K' },
  solution: ['Bf7+', 'Nd5#'], opponentReplies: ['Ke7'],
  highlights: [RED('e7'), RED('f7'), ORANGE('d5'), GREEN('c3')],
  arrows: [ARROW('c4', 'f7'), ARROW('c3', 'd5')],
  caption: 'Bxf7+ Ke7 Nd5# the knight seals it',
  whatItIs: 'A bishop check drives the king out, and a knight jumps in to mate on the new square.',
  whyItWins: 'The king has no safe square left and nothing can take the knight on d5.',
  doThis: 'A bishop check can push a king out of the way, and then a knight jump usually finishes it.' });

add({ id: 33, slug: 'opera-mate', category: 'Mating Patterns', title: 'Opera Mate', tags: ['operaMate', 'rook', 'bishop'],
  pieces: { e8: 'k', d8: 'r', e7: 'p', f8: 'r', c6: 'b', b7: 'p', f7: 'p', c7: 'P',
            f3: 'N', f2: 'P', g2: 'P', h2: 'P', d5: 'B', d1: 'R', c1: 'K' },
  solution: ['Bxc6+', 'Rxd8#'], opponentReplies: ['bxc6'],
  highlights: [RED('e8'), RED('d8'), ORANGE('d5'), GREEN('f3')],
  arrows: [ARROW('d5', 'c6'), ARROW('d1', 'd8')],
  caption: 'Bxc6 bxc6 Rxd8# the rook finishes it',
  whatItIs: 'A bishop goes deep to clear the path, then a rook delivers mate along the back rank.',
  whyItWins: 'Black must recapture with the c-pawn, which opens the d-file for the rook to come home.',
  doThis: 'Sometimes a piece is best used to remove a blocker so a long-range piece can do the mating.' });

add({ id: 34, slug: 'pillsburys-mate', category: 'Mating Patterns', title: "Pillsbury's Mate", tags: ['pillsburysMate', 'queen', 'bishop'],
  pieces: { e8: 'k', b7: 'p', d7: 'p', e7: 'p', f7: 'p', g7: 'p', h7: 'p',
            e5: 'B', b1: 'Q', a1: 'R', h1: 'R', g1: 'K' },
  solution: ['Qxb7', 'Qb8#'], opponentReplies: ['Kd8'],
  highlights: [RED('e8'), ORANGE('b8'), ORANGE('d8'), ORANGE('f8'), GREEN('e5')],
  arrows: [ARROW('b1', 'b7'), ARROW('b7', 'b8')],
  caption: 'Qxb7! Qb8# the queen walks in',
  whatItIs: 'The queen goes deep, takes on b7, and mates on b8, protected by the bishop on e5.',
  whyItWins: 'The bishop already covers b8, so the queen can sit there and give mate safely.',
  doThis: 'Send the queen into the corner. If your own bishop guards that square, the mate is free.' });

add({ id: 35, slug: 'ladder-mate', category: 'Mating Patterns', title: 'Ladder Mate', tags: ['ladderMate', 'rook'],
  pieces: { h7: 'k', g7: 'p', h6: 'p', g6: 'p', a1: 'R', h1: 'K' },
  solution: ['Ra7', 'Ra8+'], opponentReplies: ['Kg8'],
  highlights: [RED('h7'), RED('g8'), ORANGE('a7'), GREEN('a1')],
  arrows: [ARROW('a1', 'a7'), ARROW('a7', 'g7')],
  caption: 'Ra7+ Kg8 Ra8+ the king walks into the corner',
  whatItIs: 'A rook pushes the king along the board one square at a time, until there is nowhere left to go.',
  whyItWins: 'Each check takes one square away. The king is herded along the edge into a final mate.',
  doThis: 'When the king has no good squares, keep checking with the rook and shrink his board.' });

/* ── Endgame tactics ───────────────────────────────────────────────────── */
add({ id: 36, slug: 'underpromotion', category: 'Endgame Tactics', title: 'Underpromotion', tags: ['underpromotion', 'pawn', 'knight'],
  pieces: { g8: 'k', g6: 'K', f7: 'P' }, solution: ['f8=N'], opponentReplies: [],
  highlights: [RED('h8'), RED('g7'), ORANGE('e8'), GREEN('f7')],
  arrows: [ARROW('f7', 'e8'), ARROW('e8', 'g7')],
  caption: 'f8=N! the knight covers both escapes',
  whatItIs: 'A pawn reaches the last rank but becomes a knight instead of the usual queen.',
  whyItWins: 'The knight checks g7 and covers c7, so the king has no safe square. A queen could not do this.',
  doThis: 'Promote to a knight when the queen would be captured or would not give mate straight away.' });

add({ id: 37, slug: 'stalemate-trick', category: 'Endgame Tactics', title: 'Stalemate Trick', tags: ['stalemate', 'stalemateTrick', 'king'],
  pieces: { h8: 'k', g5: 'Q', g1: 'K' }, solution: ['Qg6'], opponentReplies: [],
  highlights: [RED('h8'), ORANGE('g8'), ORANGE('h7'), ORANGE('g7'), GREEN('g5')],
  arrows: [ARROW('g5', 'g6')],
  caption: 'Qg6! no legal move, but it is not check',
  whatItIs: 'The queen covers all three squares around the king without ever giving check.',
  whyItWins: 'That is stalemate, and the game ends in a draw. Use it when you are losing to force one.',
  doThis: 'Check every escape square. If none is left but you are not giving check, that is stalemate.' });

add({ id: 38, slug: 'zugzwang', category: 'Endgame Tactics', title: 'Zugzwang', tags: ['zugzwang', 'king', 'pawn'],
  pieces: { h5: 'k', g3: 'K', h4: 'P' }, solution: ['Kf3'], opponentReplies: ['Kg6'],
  highlights: [RED('h5'), RED('h4'), GREEN('g3')],
  arrows: [ARROW('g3', 'f3')],
  caption: 'Kf3! being forced to move is the disadvantage',
  whatItIs: 'White has only a king left, and every move he makes loses ground.',
  whyItWins: 'Every king move lets the black king nearer the pawn. White must step aside and hold on.',
  doThis: 'With pawns only, ask who has to move next. Whoever does is often the one who gets squeezed.' });

add({ id: 39, slug: 'opposition', category: 'Endgame Tactics', title: 'Opposition', tags: ['opposition', 'king', 'pawn'],
  pieces: { e7: 'k', e5: 'K', e2: 'P' }, solution: ['Kd5', 'e4'], opponentReplies: ['Kd7'],
  highlights: [RED('e6'), ORANGE('e7'), GREEN('e2')],
  arrows: [ARROW('e5', 'd5'), ARROW('d5', 'd6')],
  caption: 'Kd5! taking the opposition',
  whatItIs: 'Two kings face each other with one square between them. Whoever holds that square wins.',
  whyItWins: 'By stepping sideways, White keeps his king in front of the pawn and walks it up the board.',
  doThis: 'With one king and one pawn, get your king in front of the pawn, not level with it.' });

add({ id: 40, slug: 'perpetual-check', category: 'Endgame Tactics', title: 'Perpetual Check', tags: ['perpetualCheck', 'checking', 'king'],
  pieces: { h8: 'k', g7: 'p', f7: 'p', a1: 'R', h1: 'K' },
  solution: ['Ra8+', 'Ra7'], opponentReplies: ['Kh7', 'Kg8'],
  highlights: [RED('h8'), ORANGE('a8'), GREEN('a1')],
  arrows: [ARROW('a1', 'a8'), ARROW('a8', 'h8')],
  caption: 'Ra8+ Kg7 Ra7+ the checks never stop',
  whatItIs: 'Instead of trying to win, you keep giving check so the game can never be lost.',
  whyItWins: 'A player who is being checked cannot make threats, so the position is always a draw.',
  doThis: 'If you are short of material, check your way to a draw. Safety first, points second.' });

add({ id: 41, slug: 'lucena-position', category: 'Endgame Tactics', title: 'Lucena Position', tags: ['lucenaPosition', 'rook', 'building'],
  pieces: { b8: 'K', a7: 'P', c7: 'P', b5: 'k', a3: 'r', d1: 'R' },
  solution: ['Rd5+', 'Rd6'], opponentReplies: ['Kc4'],
  highlights: [RED('b5'), ORANGE('d5'), GREEN('a7'), GREEN('c7')],
  arrows: [ARROW('d1', 'd5'), ARROW('d5', 'd6')],
  caption: 'Rd5+ the rook must build the bridge',
  whatItIs: 'The classic rook and pawn endgame. The rook has to get in front of its pawn to make a bridge.',
  whyItWins: 'The white king is cut off and cannot help, so the rook alone must build the winning position.',
  doThis: 'Get the rook in front of the pawn first. Without that bridge the pawn is worth nothing.' });

add({ id: 42, slug: 'philidor-position', category: 'Endgame Tactics', title: 'Philidor Position', tags: ['philidorPosition', 'rook', 'defence'],
  pieces: { d8: 'k', d3: 'R', d2: 'P', d1: 'K' }, solution: ['Rd4+', 'Ke2'], opponentReplies: ['Kc7'],
  highlights: [RED('d8'), ORANGE('d3'), GREEN('d2')],
  arrows: [ARROW('d2', 'd3'), ARROW('d3', 'd7')],
  caption: 'Rd4! the Philidor defence',
  whatItIs: 'The weaker side keeps the rook side by side with its pawn and leans against the king.',
  whyItWins: 'The pawn reaches the seventh rank supported, and the attacking king cannot break through.',
  doThis: 'If you have the worse endgame, keep the rook behind the pawn and fight for the seventh rank.' });

/* ── Other ─────────────────────────────────────────────────────────────── */
add({ id: 43, slug: 'quiet-move', category: 'Other', title: 'Quiet Move', tags: ['quietMove', 'threat', 'improvement'],
  pieces: { h8: 'k', d5: 'q', a4: 'Q', g1: 'K' }, solution: ['Qd7'], opponentReplies: [],
  highlights: [RED('d7'), ORANGE('d5'), GREEN('a4')],
  arrows: [ARROW('a4', 'd7'), ARROW('d7', 'd5')],
  caption: 'Qd7 no check, no capture, better square',
  whatItIs: 'A move with no check and no capture, played because it improves where your piece stands.',
  whyItWins: 'From d7 the queen guards the seventh rank, so Black cannot safely take anything there.',
  doThis: 'Ask which square your piece would most like to stand on, and play a move that gets it there.' });

add({ id: 44, slug: 'pawn-breakthrough', category: 'Other', title: 'Pawn Breakthrough', tags: ['pawnBreakthrough', 'pawn', 'passedPawn'],
  pieces: { b7: 'p', c7: 'p', b5: 'P', a5: 'P', c6: 'P', a2: 'k', c1: 'K' },
  solution: ['b6', 'c7'], opponentReplies: ['cxb6'],
  highlights: [RED('b6'), RED('c7'), ORANGE('b5'), GREEN('a5'), GREEN('c6')],
  arrows: [ARROW('b5', 'b6'), ARROW('c7', 'b6'), ARROW('c6', 'c7')],
  caption: 'b6! cxb6 then c7 breaks through',
  whatItIs: 'Two pawns side by side push forward. Black cannot stop both, and one gets through.',
  whyItWins: 'If Black takes the wrong pawn, the other one walks straight to the last rank and queens.',
  doThis: 'With pawns next to each other, push one to force the capture, then race the other.' });

add({ id: 45, slug: 'battery', category: 'Other', title: 'Battery', tags: ['battery', 'queen', 'bishop'],
  pieces: { e8: 'k', c8: 'b', g2: 'B', d1: 'Q', g1: 'K' }, solution: ['Qd2'], opponentReplies: [],
  highlights: [RED('e8'), RED('c8'), ORANGE('d7'), GREEN('d1')],
  arrows: [ARROW('d1', 'd2'), ARROW('d2', 'd7'), ARROW('g2', 'd5')],
  caption: 'Qd2 queen and bishop on one line',
  whatItIs: 'Two heavy pieces line up on the same diagonal, so they shoot through each other.',
  whyItWins: 'The bishop covers e8, so when the queen arrives on d7 the king cannot step out of the way.',
  doThis: 'Put your queen and bishop on the same line early. Together they are stronger than either alone.' });

/* ── verify + write ────────────────────────────────────────────────────── */
const out = [];
const problems = [];
for (const e of T) {
  const r = run(e.pieces, e.solution, e.opponentReplies || [], e.turn || 'w');
  if (r.err) { problems.push(`#${e.id} ${e.slug}: ${r.err}${r.opts ? ` | options: ${r.opts.slice(0, 24).join(' ')}` : ''}`); continue; }
  const lastWhite = e.solution[e.solution.length - 1];
  if (/#/.test(lastWhite) && !r.mate) { problems.push(`#${e.id} ${e.slug}: claims mate but is not mate`); continue; }
  out.push({
    id: e.id, slug: e.slug, category: e.category, title: e.title, tags: e.tags,
    fen: r.fen, highlights: e.highlights, arrows: e.arrows, caption: e.caption,
    whatItIs: e.whatItIs, whyItWins: e.whyItWins, doThis: e.doThis,
    solution: e.solution, opponentReplies: e.opponentReplies || [],
  });
}

writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
console.log(`wrote ${out.length}/${T.length}`);
if (problems.length) { console.log('\nPROBLEMS:'); problems.forEach((p) => console.log('  ' + p)); }