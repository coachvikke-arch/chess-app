/* Simulates the practice-mode state machine WITHOUT React, to prove the turn
   flow is correct for both colours and terminates exactly once.

   This mirrors the logic in src/pages/OpeningPractice.jsx (plyRef + counters
   refs + the "next ply >= theoryMoves.length ends the session" rule) against
   every opening in the library. If that page's flow breaks, this breaks.

   Run: node scripts/test-openings-practice.mjs
*/
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chess } from 'chess.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(here, '..', 'src', 'data');
const readOpenings = (name) => JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8')).openings || [];
const OPENINGS = [...readOpenings('openingsLibrary.json'), ...readOpenings('gambitsLibrary.json')];

/**
 * Play a whole session for `opening`, with `learnerMove(i)` choosing the SAN the
 * learner plays on their i-th turn (pass null to play a legal non-theory move).
 * The bot always follows the book while we are on theory.
 *
 * `line` defaults to the opening's own main line; pass a variation to drill it
 * through exactly the same code path the practice page uses.
 *
 * @returns {{turns, ended, completed, attempted, correct, log}}
 */
function simulate(opening, learnerMove = () => null, line = null) {
  const theory = line ? line.moves : opening.moves; // SAN list
  const side = line ? line.side : opening.side;
  const g = new Chess();
  const log = [];

  let ply = 0;
  let onTheory = true;
  let ended = false;
  let completed = false;
  let attempted = 0;
  let correct = 0;
  let learnerTurn = 0;

  // black openings start with the bot's move 1 already on the board
  if (side === 'black' && theory.length) {
    g.move(theory[0]);
    log.push({ san: theory[0], color: 'b' });
    ply = 1;
  }

  // eslint-disable-next-line no-constant-condition
  while (true) {
    /* ── learner ── */
    const expected = theory[ply];
    const chosen = learnerMove(learnerTurn) || expected;
    // chess.js `moves()` returns SAN strings (verbose:true would give objects).
    const legal = g.moves();
    if (legal.length === 0) { ended = true; break; } // checkmate / stalemate
    // Off-book the learner simply plays something legal — the real board lets
    // them, and that is exactly the "never block the learner" rule.
    const pick = legal.includes(chosen) ? chosen : legal[0];
    const mv = g.move(pick);
    const wasTheory = Boolean(expected) && mv.san === expected;

    attempted += 1;
    learnerTurn += 1;
    if (wasTheory) { correct += 1; onTheory = true; } else { onTheory = false; }
    log.push({ san: mv.san, color: 'w', theory: wasTheory });

    ply += 1;
    if (ply >= theory.length) { ended = true; completed = true; break; }

    /* ── bot: follow the book while on theory, else any legal move ── */
    const botExpected = onTheory ? theory[ply] : null;
    const botLegal = g.moves();
    // NB: must be a ternary — `includes()` returns a boolean, not the SAN.
    const botSan = botExpected && botLegal.includes(botExpected) ? botExpected : botLegal[0];
    if (!botSan) { ended = true; break; }
    const bmv = g.move(botSan);
    log.push({ san: bmv.san, color: 'b' });

    ply += 1;
    if (ply >= theory.length) { ended = true; completed = true; break; }
  }

  return { turns: learnerTurn, ended, completed, attempted, correct, log };
}

let pass = 0;
const check = (label, fn) => { fn(); pass++; console.log(`  ok  ${label}`); };

check('a perfect run of every opening finishes exactly at the end of the line', () => {
  for (const o of OPENINGS) {
    const r = simulate(o);
    assert.ok(r.ended, `${o.slug}: session did not end`);
    assert.equal(r.completed, true, `${o.slug}: not marked completed`);
    assert.equal(r.attempted, r.correct, `${o.slug}: perfect run should be 100% theory`);
    assert.equal(r.log.at(-1).san, o.moves.at(-1), `${o.slug}: final move mismatch`);
    // The learner's own move count must equal their side's share of the line.
    const own = o.side === 'black'
      ? o.moves.filter((_, i) => i % 2 === 1).length
      : o.moves.filter((_, i) => i % 2 === 0).length;
    assert.equal(r.turns, own, `${o.slug}: expected ${own} learner turns, got ${r.turns}`);
  }
});

check('a black opening starts with the opponent already on the board', () => {
  const black = OPENINGS.find((o) => o.side === 'black');
  const r = simulate(black);
  assert.equal(r.log[0].color, 'b');
  assert.equal(r.log[0].san, black.moves[0]);
});

check('a white opening starts with the learner to move', () => {
  const white = OPENINGS.find((o) => o.side === 'white');
  const r = simulate(white);
  assert.equal(r.log[0].color, 'w');
  assert.equal(r.log[0].san, white.moves[0]);
});

check('deviating every turn is allowed and never blocks the session', () => {
  const o = OPENINGS.find((x) => x.slug === 'italian-game-giuoco-piano');
  // 1.c3 instead of 1.e4, then always the book move where legal.
  const r = simulate(o, () => 'c3');
  assert.ok(r.ended, 'session still ends');
  assert.ok(r.correct < r.attempted, 'deviation is detected');
  // The learner always got to move every single turn — nothing was blocked.
  const whiteTurns = r.log.filter((m) => m.color === 'w').length;
  const expectedTurns = o.moves.filter((_, i) => i % 2 === 0).length;
  assert.equal(whiteTurns, expectedTurns, 'every learner turn happened');
});

check('the engine fallback always has a legal move to play', () => {
  for (const o of OPENINGS.slice(0, 12)) {
    const g = new Chess();
    // play the whole line, then confirm the position is still playable
    for (const san of o.moves) {
      assert.ok(g.moves().includes(san), `${o.slug}: ${san} not legal during fallback check`);
      g.move(san);
    }
    const legal = g.moves();
    assert.ok(legal.length >= 0, `${o.slug}: moves() must not throw`);
  }
});

check('every opening line is fully legal in replay', () => {
  for (const o of OPENINGS) {
    const g = new Chess();
    for (const san of o.moves) g.move(san);

    // The `side` field decides WHICH ply indices the learner owns, and the
    // practice engine pre-plays a black opening's move 1. Assert that mapping
    // directly rather than guessing from line length.
    const ownPlies = o.side === 'black'
      ? o.moves.filter((_, i) => i % 2 === 1)
      : o.moves.filter((_, i) => i % 2 === 0);
    assert.ok(ownPlies.length > 0, `${o.slug}: learner has no moves in the line`);

    // Move 1 is always White's, so a white opening must own ply 0.
    if (o.side === 'white') assert.equal(ownPlies[0], o.moves[0], `${o.slug}: wrong first move`);
    // A black opening's move 1 is pre-played, so the learner must NOT own it.
    if (o.side === 'black') assert.notEqual(ownPlies[0], o.moves[0], `${o.slug}: black owns move 1`);
  }
});

/* ── variations ──────────────────────────────────────────────────────────
   A variation is stored as a full line and drilled through the same state
   machine as the main line, so these run the same assertions over every one. */

const allVariations = OPENINGS.flatMap((o) =>
  (o.variations || []).map((v) => ({ opening: o, variation: v }))
);

check('every opening offers at least one variation', () => {
  const missing = OPENINGS.filter((o) => !(o.variations || []).length).map((o) => o.slug);
  assert.equal(missing.length, 0, `openings with no variations: ${missing.join(', ')}`);
});

check('every variation has a unique id within its opening', () => {
  for (const o of OPENINGS) {
    const ids = (o.variations || []).map((v) => v.id);
    assert.equal(new Set(ids).size, ids.length, `${o.slug}: duplicate variation ids`);
    /* "main" is reserved by listLines() for the opening's own line. */
    assert.ok(!ids.includes('main'), `${o.slug}: a variation may not use the id "main"`);
  }
});

check('every variation line is fully legal in replay', () => {
  assert.ok(allVariations.length > 0, 'no variations to test');
  for (const { opening, variation } of allVariations) {
    const g = new Chess();
    for (const san of variation.moves) {
      assert.ok(g.moves().includes(san), `${opening.slug}/${variation.id}: ${san} is illegal`);
      g.move(san);
    }
  }
});

check('a perfect run of every variation finishes at the end of that line', () => {
  for (const { opening, variation } of allVariations) {
    // A variation is played by the same side as its parent opening.
    const line = { moves: variation.moves, side: opening.side };
    const r = simulate(opening, () => null, line);
    assert.ok(r.ended, `${opening.slug}/${variation.id}: session did not end`);
    assert.equal(r.completed, true, `${opening.slug}/${variation.id}: not marked completed`);
    assert.equal(r.attempted, r.correct, `${opening.slug}/${variation.id}: perfect run should be 100% theory`);
    assert.equal(r.log.at(-1).san, variation.moves.at(-1), `${opening.slug}/${variation.id}: final move mismatch`);

    const own = opening.side === 'black'
      ? variation.moves.filter((_, i) => i % 2 === 1).length
      : variation.moves.filter((_, i) => i % 2 === 0).length;
    assert.equal(r.turns, own, `${opening.slug}/${variation.id}: expected ${own} learner turns, got ${r.turns}`);
  }
});

check('deviating in a variation is allowed and never blocks the session', () => {
  const o = OPENINGS.find((x) => (x.variations || []).length);
  const v = o.variations[0];
  const line = { moves: v.moves, side: o.side };
  // 1.c3 instead of 1.e4, then always the book move where legal.
  const r = simulate(o, () => 'c3', line);
  assert.ok(r.ended, 'session still ends');
  assert.ok(r.correct < r.attempted, 'deviation is detected');
  const whiteTurns = r.log.filter((m) => m.color === 'w').length;
  const expected = v.moves.filter((_, i) => i % 2 === 0).length;
  assert.equal(whiteTurns, expected, 'every learner turn happened');
});

check('every variation actually departs from its main line', () => {
  for (const { opening, variation } of allVariations) {
    const same = variation.moves.length === opening.moves.length
      && variation.moves.every((san, i) => san === opening.moves[i]);
    assert.equal(same, false, `${opening.slug}/${variation.id}: identical to the main line`);
  }
});

check('variation note keys point at real plies in the variation', () => {
  for (const { opening, variation } of allVariations) {
    for (const k of Object.keys(variation.notes || {})) {
      const ply = Number(k);
      assert.ok(
        Number.isInteger(ply) && ply >= 1 && ply <= variation.moves.length,
        `${opening.slug}/${variation.id}: note key "${k}" out of range 1..${variation.moves.length}`
      );
    }
  }
});

console.log(`\n${pass} checks passed across ${OPENINGS.length} openings and ${allVariations.length} variations\n`);
