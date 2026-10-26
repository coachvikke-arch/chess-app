/* Verifies the chess.com move-cue classification and the "did exactly one move
   just happen?" detector that drives sounds for bot / opponent / coach moves.
   Run with:  node scripts/test-move-sounds.mjs   (from frontend/) */
import { Chess } from 'chess.js';

import { classifyMove } from '../src/utils/sound.js';

/* Mirrors exactlyOnePly() in components/ChessBoard.jsx. Duplicated here on
   purpose: this script runs in plain Node and cannot import the .jsx module. */
function positionKey(fen) { return String(fen).split(' ').slice(0, 4).join(' '); }
function exactlyOnePly(prevFen, nextFen) {
  if (!prevFen || !nextFen || prevFen === nextFen) return null;
  let g;
  try { g = new Chess(prevFen); } catch { return null; }
  for (const m of g.moves({ verbose: true })) {
    try {
      g.move(m.san);
      if (positionKey(g.fen()) === positionKey(nextFen)) return m;
      g.undo();
    } catch { /* keep scanning */ }
  }
  return null;
}

let pass = 0, fail = 0;
function ok(cond, name, extra = '') {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
}
function eq(actual, expected, name) {
  ok(actual === expected, name, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

console.log('\nclassifyMove — cue selection');
{
  const g = new Chess(START);
  eq(classifyMove(g.move('e4')), 'move-self', 'quiet own move -> move-self');
  eq(classifyMove(g.move('e5'), { isSelf: false }), 'move-opponent', 'quiet opponent move -> move-opponent');

  /* Capture: own knight takes the e5 pawn. */
  const g2 = new Chess(START);
  g2.move('e4'); g2.move('e5'); g2.move('Nf3'); g2.move('Nc6');
  eq(classifyMove(g2.move('Nxe5')), 'capture', 'capture -> capture');

  /* En passant: flags contain 'e' and no `captured` piece object. */
  const g3 = new Chess('rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3');
  const ep = g3.moves({ verbose: true }).find((m) => m.flags.includes('e'));
  ok(Boolean(ep), 'en-passant move is generated');
  if (ep) eq(classifyMove(ep), 'capture', 'en passant -> capture (via flags e)');
}
{
  /* Castling must beat the generic capture branch (O-O-O can capture on h8). */
  const g = new Chess('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  g.move('O-O');
  eq(classifyMove(g.history({ verbose: true }).at(-1)), 'castle', 'O-O -> castle');
  const g2 = new Chess('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  g2.move('O-O-O');
  eq(classifyMove(g2.history({ verbose: true }).at(-1)), 'castle', 'O-O-O -> castle');

  const g3 = new Chess('8/P6k/8/8/8/8/8/K7 w - - 0 1');
  const promo = g3.moves({ verbose: true }).find((m) => m.san.includes('='));
  ok(Boolean(promo), 'promotion move is generated');
  if (promo) eq(classifyMove(promo), 'promotion', 'promotion -> promotion');
}

console.log('\nclassifyMove — defensive');
eq(classifyMove(null), 'move-self', 'null move defaults to move-self');
eq(classifyMove(null, { isSelf: false }), 'move-opponent', 'null opponent move -> move-opponent');
eq(classifyMove({ san: 'Nf3', color: 'w' }, { isSelf: true }), 'move-self', 'no flags/captured is a quiet move');
ok(!('move' === classifyMove({ san: 'Nf3' })), 'the old generic "move" kind is not used for own moves');

console.log('\nexactlyOnePly — detecting moves applied from outside the board');
{
  const g = new Chess(START);
  const after = (() => { g.move('e4'); return g.fen(); })();
  const m = exactlyOnePly(START, after);
  ok(Boolean(m), 'detects a single move');
  eq(m && m.san, 'e4', 'reports the correct SAN');
}
{
  /* Two plies at once must NOT be reported as one move (a load/replay). */
  const g = new Chess(START);
  g.move('e4'); g.move('e5');
  ok(exactlyOnePly(START, g.fen()) === null, 'bulk load of 2 plies -> null (silent)');
  const g2 = new Chess(START);
  g2.move('d4'); g2.move('d5'); g2.move('c4'); g2.move('c5');
  ok(exactlyOnePly(START, g2.fen()) === null, 'bulk load of 4 plies -> null (silent)');
}
{
  /* Counters must not matter: the same position with a bumped clock still matches. */
  const g = new Chess(START);
  g.move('e4');
  const bumped = g.fen().replace(/ \d+ \d+$/, ' 99 99');
  ok(Boolean(exactlyOnePly(START, bumped)), 'move counters ignored when matching');
}
{
  ok(exactlyOnePly(START, START) === null, 'identical FENs -> null');
  ok(exactlyOnePly(null, START) === null, 'no previous FEN -> null');
  ok(exactlyOnePly('not a fen', START) === null, 'malformed previous FEN -> null (no throw)');
  /* A completely different position must not be mistaken for a move. */
  ok(exactlyOnePly(START, '8/8/8/8/8/8/8/K6k w - - 0 1') === null, 'unrelated position -> null');
}
{
  /* A real opponent reply: one ply, and it is Black's move. */
  const g = new Chess(START);
  g.move('e4');
  const mine = g.fen();
  g.move('e5');
  const m = exactlyOnePly(mine, g.fen());
  ok(Boolean(m), 'detects the opponent reply');
  eq(m && m.color, 'b', 'reply is attributed to black');
  eq(m && classifyMove(m, { isSelf: false }), 'move-opponent', 'reply is classified as an opponent move');
}
{
  /* Castling and capture as externally-applied moves (coaches drive boards). */
  const g = new Chess('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  const before = g.fen();
  g.move('O-O');
  const castle = exactlyOnePly(before, g.fen());
  eq(castle && classifyMove(castle), 'castle', 'external castling -> castle cue');

  const g2 = new Chess(START);
  g2.move('e4'); g2.move('e5'); g2.move('Nf3'); g2.move('Nc6');
  const b2 = g2.fen();
  g2.move('Nxe5');
  const cap = exactlyOnePly(b2, g2.fen());
  eq(cap && classifyMove(cap), 'capture', 'external capture -> capture cue');
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
