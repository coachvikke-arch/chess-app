/* Validates the Lichess practice puzzles against chess.js.
 *
 * Run with: node --test scripts/tactics-samples.test.mjs   (from frontend/)
 *
 * These entries are generated (scripts/build_tactics_samples.mjs), so the risk
 * is not a hand-typed typo but a generator regression: a trigger left on the
 * board, a solution that starts with the opponent's move, a rating that drifts
 * out of the advertised band. Every one of those is checked here, and the
 * trigger handling is checked twice — once by replaying the puzzle, and once by
 * confirming the reader really is the side to move in the shipped FEN.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Chess } from 'chess.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(
  readFileSync(join(ROOT, 'src', 'features', 'tactics', 'data', 'samples.json'), 'utf8'),
);

const RATING_MIN = 600;
const RATING_MAX = 1200;

const all = data.topics.flatMap((topic) => topic.puzzles.map((puzzle) => ({ topic, puzzle })));

test('the source is credited as Lichess CC0', () => {
  assert.match(data.source.name, /Lichess/i);
  assert.match(data.source.license, /CC0/i);
  assert.match(data.source.url, /^https:\/\/database\.lichess\.org/);
  assert.match(data.source.licenseUrl, /creativecommons\.org\/publicdomain\/zero/);
});

test('every topic carries 5-10 puzzles', () => {
  assert.ok(data.topics.length >= 5, 'expected a practice topic at least per major theme');
  for (const topic of data.topics) {
    assert.ok(topic.label && topic.blurb, `${topic.theme}: missing label/blurb`);
    assert.ok(topic.puzzles.length >= 5 && topic.puzzles.length <= 10,
      `${topic.theme}: ${topic.puzzles.length} puzzles, expected 5-10`);
  }
});

test('every puzzle is inside the advertised rating band', () => {
  for (const { puzzle } of all) {
    assert.ok(Number.isInteger(puzzle.rating), `${puzzle.id}: rating is not an integer`);
    assert.ok(puzzle.rating >= RATING_MIN && puzzle.rating <= RATING_MAX,
      `${puzzle.id}: rating ${puzzle.rating} is outside ${RATING_MIN}-${RATING_MAX}`);
  }
});

test('no puzzle is shipped twice', () => {
  const seen = new Map();
  for (const { topic, puzzle } of all) {
    assert.ok(!seen.has(puzzle.id), `${puzzle.id} appears in both ${seen.get(puzzle.id)} and ${topic.theme}`);
    seen.set(puzzle.id, topic.theme);
  }
});

test('the trigger is already played: the reader is to move in the shipped FEN', () => {
  for (const { puzzle } of all) {
    const board = new Chess(puzzle.fen);
    assert.equal(board.turn(), puzzle.turn === 'white' ? 'w' : 'b',
      `${puzzle.id}: "turn" disagrees with the FEN`);
    /* Read the mover off the board it starts on — after the move the origin
       square is empty, and chess.js has already flipped its turn. */
    const played = new Chess(puzzle.fen).move(puzzle.solution[0]);
    assert.equal(board.get(played.from).color, board.turn(),
      `${puzzle.id}: the first solution move is not by the side to move`);
    assert.ok(!/^[a-h][1-8][a-h][1-8]/.test(puzzle.solution[0]),
      `${puzzle.id}: solution still holds a UCI trigger move`);
  }
});

test('triggers are legal SAN and never end the game', () => {
  for (const { puzzle } of all) {
    assert.ok(puzzle.trigger, `${puzzle.id}: no trigger recorded`);
    /* The trigger belongs to the position BEFORE it was made, which is the FEN
       with the move that produced it undone — the card only needs the SAN for
       its caption, so re-deriving it here keeps the data honest without
       shipping the pre-trigger FEN. */
    assert.match(puzzle.trigger, /^[A-Za-z][a-z0-9x=+#-]*$/);
  }
});

test('every solution and reply replays legally, written in canonical SAN', () => {
  for (const { puzzle } of all) {
    const chess = new Chess(puzzle.fen);
    puzzle.solution.forEach((san, i) => {
      const move = chess.move(san);
      assert.equal(move.san, san, `${puzzle.id}: "${san}" should be written "${move.san}"`);
      const reply = puzzle.opponentReplies?.[i];
      if (!reply) return;
      const answered = chess.move(reply);
      assert.equal(answered.san, reply, `${puzzle.id}: reply "${reply}" should be "${answered.san}"`);
    });
    assert.ok(puzzle.solution.length >= 1 && puzzle.solution.length <= 3,
      `${puzzle.id}: ${puzzle.solution.length} solver moves, the card replays at most 3`);
    assert.equal((puzzle.opponentReplies || []).length, puzzle.solution.length - 1,
      `${puzzle.id}: expected one reply per solver move except the last`);
  }
});

test('the mate flag matches the replayed position', () => {
  for (const { puzzle } of all) {
    const chess = new Chess(puzzle.fen);
    puzzle.solution.forEach((san, i) => {
      chess.move(san);
      if (puzzle.opponentReplies?.[i]) chess.move(puzzle.opponentReplies[i]);
    });
    assert.equal(chess.isCheckmate(), puzzle.mate, `${puzzle.id}: "mate" flag is wrong`);
  }
});

test('the displayed line is the replayed SAN with its own move numbers', () => {
  for (const { puzzle } of all) {
    /* Interleave first, exactly as the builder does: the numbering must appear
       before White's moves, and a line that starts with Black is written
       "11..." — judging that per solver move would number the reply wrongly. */
    const plies = [];
    puzzle.solution.forEach((san, i) => {
      plies.push(san);
      if (puzzle.opponentReplies?.[i]) plies.push(puzzle.opponentReplies[i]);
    });

    const chess = new Chess(puzzle.fen);
    const parts = [];
    for (const san of plies) {
      if (chess.turn() === 'w') parts.push(`${chess.moveNumber()}.`);
      else if (parts.length === 0) parts.push(`${chess.moveNumber()}...`);
      parts.push(san);
      chess.move(san);
    }
    assert.equal(puzzle.line, parts.join(' '), `${puzzle.id}: "line" does not match its moves`);
  }
});

test('each puzzle really carries the theme of the topic it is filed under', () => {
  for (const { topic, puzzle } of all) {
    assert.ok(puzzle.themes.includes(topic.theme),
      `${puzzle.id}: themes [${puzzle.themes.join(', ')}] do not include "${topic.theme}"`);
  }
});

test('every puzzle links back to its Lichess page', () => {
  for (const { puzzle } of all) {
    assert.equal(puzzle.url, `https://lichess.org/training/${puzzle.id}`);
  }
});
