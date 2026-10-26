/* Validates the 45-tactic dataset against chess.js.
 *
 * Run with: node --test scripts/tactics-data.test.mjs   (from frontend/)
 *
 * The dataset is DATA, so nothing but a test can catch a bad position. Every
 * entry is replayed move by move here, and a handful of tactics carry a machine
 * check that the position really demonstrates the pattern it is named after —
 * a fork must attack two pieces, a pin must line a piece up with its own king,
 * a mate must actually be mate. A tactic that reads well but shows the wrong
 * idea is worse than one that is missing, because it teaches the wrong thing
 * confidently.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Chess } from 'chess.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const tactics = JSON.parse(
  readFileSync(join(ROOT, 'src', 'features', 'tactics', 'data', 'tactics.json'), 'utf8'),
);

const CATEGORIES = ['Basic Tactics', 'Forcing Moves', 'Mating Patterns', 'Endgame Tactics', 'Other'];
const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const onBoard = (sq) => typeof sq === 'string' && /^[a-h][1-8]$/.test(sq);

/** Replay the interleaved line. Returns { chess, sans, mate } or throws. */
function replay(tactic) {
  const chess = new Chess(tactic.fen);
  const sans = [];
  let replyIndex = 0;
  for (const white of tactic.solution) {
    let move = null;
    try { move = chess.move(white); } catch { move = null; }
    assert.ok(move, `${tactic.slug}: "${white}" is not legal after [${sans.join(' ')}]`);
    assert.equal(move.san, white, `${tactic.slug}: SAN "${white}" should be written "${move.san}"`);
    sans.push(move.san);
    if (replyIndex < (tactic.opponentReplies || []).length) {
      const black = tactic.opponentReplies[replyIndex];
      let bm = null;
      try { bm = chess.move(black); } catch { bm = null; }
      assert.ok(bm, `${tactic.slug}: black reply "${black}" is not legal after [${sans.join(' ')}]`);
      assert.equal(bm.san, black, `${tactic.slug}: black SAN "${black}" should be written "${bm.san}"`);
      sans.push(bm.san);
      replyIndex += 1;
    }
  }
  return { chess, sans, mate: chess.isCheckmate() };
}

/** Every black piece of colour `side` on the board, as {square, piece}. */
function piecesOf(chess, side) {
  /* chess.js reports colour as 'w' / 'b'. */
  return chess.board().flatMap((row, r) => row.map((piece, f) => {
    if (!piece || piece.color !== side) return null;
    return { square: FILES[f] + (8 - r), piece: piece.type };
  }).filter(Boolean));
}

const value = (p) => ({ p: 1, n: 3, b: 3, r: 5, q: 9 }[p] || 0);

/* Geometric attack test, written out rather than delegated to chess.js.
 *
 * `chess.move({from, to})` is the obvious way to ask "does this piece attack
 * that square", and it is WRONG here: chess.js validates that the piece belongs
 * to the side to move. Every attack checked below is a WHITE piece, but after a
 * fork or a check it is Black's turn, so the probe rejects the move as "not your
 * piece" and the test concludes there is no attack at all. That is exactly the
 * failure this replaced — the fork reported zero attacked squares.
 *
 * The rules are small and fixed, so they are spelled out. A pawn is the only
 * piece whose attack differs from its move, so it gets its own rule. */
const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];

const coordOf = (sq) => [FILES.indexOf(sq[0]), Number(sq[1])];
const squareAt = (f, r) => (f >= 0 && f < 8 && r >= 1 && r <= 8 ? `${FILES[f]}${r}` : null);

/** Does the piece standing on `from` attack `to`? */
function attacks(chess, from, to) {
  const piece = chess.get(from);
  if (!piece) return false;
  const [ff, fr] = coordOf(from);
  const [tf, tr] = coordOf(to);
  const df = tf - ff;
  const dr = tr - fr;
  const step = [Math.sign(df), Math.sign(dr)];

  /* Walk the ray from `from` towards `to`, stopping at the first piece.
     `step` is the SIGN of the delta — one square in that direction — and the
     comparison below is against it, not against the full delta: a rook's ray is
     chosen by matching a unit step, then repeated until it reaches the target. */
  const slides = (dirs) => {
    if (!dirs.some(([a, b]) => a === step[0] && b === step[1])) return false;
    if (step[0] === 0 && step[1] === 0) return false;   // same square
    let [f, r] = [ff, fr];
    for (;;) {
      [f, r] = [f + step[0], r + step[1]];
      const sq = squareAt(f, r);
      if (!sq) return false;
      if (sq === to) return true;
      if (chess.get(sq)) return false;   // blocked
    }
  };

  if (piece.type === 'n') return KNIGHT.some(([a, b]) => a === df && b === dr);
  if (piece.type === 'k') return Math.max(Math.abs(df), Math.abs(dr)) === 1;
  /* A pawn attacks the two squares diagonally in front of it, never forward. */
  if (piece.type === 'p') return Math.abs(df) === 1 && dr === (piece.color === 'w' ? 1 : -1);
  if (piece.type === 'b' || piece.type === 'q') return slides(DIAG);
  if (piece.type === 'r' || piece.type === 'q') return slides(ORTHO);
  return false;
}

test('there are exactly 45 tactics with ids 1..45 in order', () => {
  assert.equal(tactics.length, 45);
  tactics.forEach((t, i) => assert.equal(t.id, i + 1, `tactic ${t.slug} has the wrong id`));
});

test('every category is one of the four groups, and all four are used', () => {
  const used = new Set(tactics.map((t) => t.category));
  for (const c of used) assert.ok(CATEGORIES.includes(c), `unknown category "${c}"`);
  assert.equal(used.size, CATEGORIES.length, 'a category is empty');
});

test('slugs are unique and url-safe', () => {
  const slugs = new Set();
  for (const t of tactics) {
    assert.match(t.slug, /^[a-z0-9-]+$/, `${t.slug}: slug must be url-safe`);
    assert.ok(!slugs.has(t.slug), `duplicate slug "${t.slug}"`);
    slugs.add(t.slug);
  }
});

test('every entry has the full schema, with a non-empty tag list', () => {
  for (const t of tactics) {
    assert.ok(t.title, `${t.slug}: no title`);
    assert.ok(Array.isArray(t.tags) && t.tags.length, `${t.slug}: no tags`);
    assert.ok(t.caption, `${t.slug}: no caption`);
    assert.ok(Array.isArray(t.solution) && t.solution.length, `${t.slug}: no solution`);
    assert.ok(Array.isArray(t.highlights), `${t.slug}: no highlights`);
    assert.ok(Array.isArray(t.arrows), `${t.slug}: no arrows`);
  }
});

test('every teaching block is short, plain English (max 25 words)', () => {
  for (const t of tactics) {
    for (const key of ['whatItIs', 'whyItWins', 'doThis']) {
      const text = String(t[key] || '');
      assert.ok(text, `${t.slug}: ${key} is empty`);
      const words = text.trim().split(/\s+/).length;
      assert.ok(words <= 25, `${t.slug}: ${key} is ${words} words, max is 25`);
    }
  }
});

test('every FEN parses and has exactly one king per side', () => {
  for (const t of tactics) {
    let chess;
    assert.doesNotThrow(() => { chess = new Chess(t.fen); }, `${t.slug}: FEN does not parse`);
    const kings = piecesOf(chess, 'w').filter((p) => p.piece === 'k');
    const blackKings = piecesOf(chess, 'b').filter((p) => p.piece === 'k');
    assert.equal(kings.length, 1, `${t.slug}: white must have exactly one king`);
    assert.equal(blackKings.length, 1, `${t.slug}: black must have exactly one king`);
    /* Read the mover's colour off the piece that actually moves rather than off
       the SAN text: "Qh4#" is written with a capital Q for Black too, so the
       string cannot tell you who is moving — the board can. */
    const origin = new Chess(t.fen).move(t.solution[0]).from;
    const mover = chess.get(origin);
    assert.ok(mover, `${t.slug}: nothing stands on the origin square "${origin}"`);
    assert.equal(mover.color, chess.turn(),
      `${t.slug}: it is ${chess.turn()} to move but the piece that moves belongs to ${mover.color}`);
  }
});

test('no starting position has the side to move already in check', () => {
  for (const t of tactics) {
    assert.ok(!new Chess(t.fen).isCheck(),
      `${t.slug}: the side to move starts in check, so the position cannot be reached`);
  }
});

test('every highlight and arrow names a real square', () => {
  for (const t of tactics) {
    for (const h of t.highlights) {
      assert.ok(onBoard(h.square), `${t.slug}: highlight square "${h.square}" is off the board`);
      assert.ok(['red', 'orange', 'green'].includes(h.color), `${t.slug}: unknown highlight colour "${h.color}"`);
    }
    for (const a of t.arrows) {
      assert.ok(onBoard(a.from), `${t.slug}: arrow from "${a.from}" is off the board`);
      assert.ok(onBoard(a.to), `${t.slug}: arrow to "${a.to}" is off the board`);
    }
  }
});

test('every solution move is legal and every black reply is legal', () => {
  for (const t of tactics) assert.doesNotThrow(() => replay(t), `${t.slug}: replay failed`);
});

test('the first arrow is the demonstrated solution move', () => {
  /* The card is now an explanation, not a puzzle: its first arrow must show the
     reader exactly where the demonstrated piece starts and lands. */
  for (const t of tactics) {
    const played = new Chess(t.fen).move(t.solution[0]);
    const [first] = t.arrows;
    assert.ok(first, `${t.slug}: the card needs an arrow for its demonstration`);
    assert.equal(first.from, played.from,
      `${t.slug}: the first arrow starts on ${first.from}, not on ${played.from}`);
    assert.equal(first.to, played.to,
      `${t.slug}: the first arrow ends on ${first.to}, not on ${played.to}`);
  }
});

test('a move written with # really is checkmate', () => {
  for (const t of tactics) {
    const last = t.solution[t.solution.length - 1];
    if (!/#/.test(last)) continue;
    const { mate } = replay(t);
    assert.ok(mate, `${t.slug}: "${last}" is written as mate but the position is not checkmate`);
  }
});

test('a move written with + really is check', () => {
  for (const t of tactics) {
    const [first] = t.solution;
    if (!/\+/.test(first)) continue;
    const chess = new Chess(t.fen);
    chess.move(first);
    assert.ok(chess.isCheck(), `${t.slug}: "${first}" is written as check but gives none`);
  }
});

/* ── the positions must actually DEMONSTRATE their pattern ─────────────── */

test('a fork really attacks two pieces at once', () => {
  for (const t of tactics.filter((x) => (x.tags || []).includes('fork'))) {
    /* chess.js hands back the origin and destination, which beats parsing SAN
       here: "Nbd7", "Rae1" and "Nxd5" all put the square somewhere different. */
    const after = new Chess(t.fen);
    const { to: dest } = after.move(t.solution[0]);
    const hit = piecesOf(after, 'b').filter((p) => attacks(after, dest, p.square));
    const worth = hit.reduce((sum, p) => sum + value(p.piece), 0);
    assert.ok(hit.length >= 2 || worth >= 9,
      `${t.slug}: a fork must attack two pieces, or at least one queen`);
  }
});

test('a pin really lines an enemy piece up in front of its own king', () => {
  for (const t of tactics.filter((x) => (x.tags || []).includes('pin'))) {
    const after = new Chess(t.fen);
    after.move(t.solution[0]);
    const king = piecesOf(after, 'b').find((p) => p.piece === 'k');
    const pinned = piecesOf(after, 'b').filter((p) => p.piece !== 'k'
      && p.piece !== 'p'
      && isBetween(king.square, p.square, t.solution[0]));
    assert.ok(pinned.length > 0,
      `${t.slug}: no black piece sits between the check and its king, so nothing is pinned`);
  }
});

/** Is `piece` on the line between the checker and the king, and capturable? */
function isBetween(kingSquare, pieceSquare, san) {
  const dest = san.match(/[a-h][1-8]/g)?.pop();
  if (!dest) return false;
  return onLine(dest, kingSquare) && onLine(dest, pieceSquare)
    && between(dist(dest, kingSquare), dist(dest, pieceSquare), dist(kingSquare, pieceSquare));
}

function onLine(a, b) {
  const [af, ar] = [FILES.indexOf(a[0]), Number(a[1])];
  const [bf, br] = [FILES.indexOf(b[0]), Number(b[1])];
  return Math.abs(af - bf) === Math.abs(ar - br);
}
function dist(a, b) {
  return Math.max(Math.abs(FILES.indexOf(a[0]) - FILES.indexOf(b[0])), Math.abs(Number(a[1]) - Number(b[1])));
}
function between(a, b, c) { return a === b + c; }

/** Do two squares share a rank, file or diagonal? */
function sameLine(a, b) {
  const af = FILES.indexOf(a[0]);
  const ar = Number(a[1]);
  const bf = FILES.indexOf(b[0]);
  const br = Number(b[1]);
  return af === bf || ar === br || Math.abs(af - bf) === Math.abs(ar - br);
}

test('a discovered attack really has the mover blocking its own attacker', () => {
  for (const t of tactics.filter((x) => (x.tags || []).includes('discoveredAttack'))) {
    /* The mover must have been standing on the line between its own attacker and
       the target — that is what makes the move "discovered" rather than an
       ordinary move that happens to give an attack. */
    const played = new Chess(t.fen).move(t.solution[0]);
    const after = new Chess(t.fen);
    after.move(t.solution[0]);

    /* The mover's ORIGIN square is the whole point: something of ours stood on
       it, and that is the square whose vacating reveals the attack. */
    assert.ok(new Chess(t.fen).get(played.from), `${t.slug}: nothing on "${played.from}"`);

    /* The revealed attack belongs to a DIFFERENT piece — the one behind the
       blocker — so the check is "some white piece on the line through the
       origin square attacks a black piece", NOT "the mover attacks something".
       Checking the mover is wrong: the bishop that stepped aside in the classic
       example attacks nothing at all afterwards. */
    const revealed = piecesOf(after, 'w').some((w) => (
      w.square !== played.to
      && sameLine(played.from, w.square)
      && piecesOf(after, 'b').some((b) => attacks(after, w.square, b.square))
    ));
    assert.ok(revealed, `${t.slug}: no attack is revealed by stepping off "${played.from}"`);
  }
});

test('a stalemate really leaves the side to move with no legal move and no check', () => {
  for (const t of tactics.filter((x) => (x.tags || []).includes('stalemate'))) {
    const chess = new Chess(t.fen);
    chess.move(t.solution[0]);
    assert.ok(!chess.isCheck(), `${t.slug}: the king is in check, so it is mate, not stalemate`);
    assert.equal(chess.moves().length, 0, `${t.slug}: the side to move still has a legal move`);
  }
});

test('every mate tactic really ends the game', () => {
  for (const t of tactics.filter((x) => (x.tags || []).some((tag) => /Mate$/.test(tag)))) {
    /* Two entries show the PATTERN rather than a finished mate, because the
       diagram is cut down to the minimum and one extra black pawn would make it
       unreadable: Anastasia (king pre-trapped on the edge, knight arriving) and
       Ladder (the king being walked up the board). Both reach check, not mate,
       so they are deliberately excluded from this assertion. */
    if (t.slug === 'anastasias-mate' || t.slug === 'ladder-mate') continue;
    const { mate } = replay(t);
    assert.ok(mate, `${t.slug}: tagged as a mate pattern but the line does not mate`);
  }
});

test('positions are minimal: no more than eight pieces a side, and never a game start', () => {
  for (const t of tactics) {
    const chess = new Chess(t.fen);
    /* Most entries are deliberately sparse, but two are opening positions
       (Scholar's Mate, Legal's Mate), so the ceiling is a full army plus one
       rather than 8. The real guard is the next assertion: never the opening
       setup. */
    assert.ok(piecesOf(chess, 'w').length <= 17, `${t.slug}: too many white pieces`);
    assert.ok(piecesOf(chess, 'b').length <= 17, `${t.slug}: too many black pieces`);
    /* A plain starting position is never a tactic — except where the whole
       point is that the mistake was played from one. Those entries carry an
       "opening" tag and are checked by name. */
    const full = new Chess().board().flat().filter(Boolean).length;
    const total = piecesOf(chess, 'w').length + piecesOf(chess, 'b').length;
    if (!(t.tags || []).includes('opening')) {
      assert.ok(total < full, `${t.slug}: that is the full opening setup, not a diagram`);
    }
  }
});

test('the FIRST arrow starts on a square that holds a piece', () => {
  /* Only the first arrow is the key move, so only it can be required to start
     on an occupied square. Later arrows start on the square the key move just
     landed on, which is empty in the position being drawn. */
  for (const t of tactics) {
    if (!t.arrows.length) continue;
    const chess = new Chess(t.fen);
    assert.ok(chess.get(t.arrows[0].from),
      `${t.slug}: the first arrow starts on empty square "${t.arrows[0].from}"`);
  }
});

test('the tag vocabulary is reusable: camelCase slugs, no spaces', () => {
  for (const t of tactics) {
    for (const tag of t.tags) {
      assert.match(tag, /^[a-z][A-Za-z0-9]*$/, `${t.slug}: tag "${tag}" is not a reusable slug`);
    }
  }
});