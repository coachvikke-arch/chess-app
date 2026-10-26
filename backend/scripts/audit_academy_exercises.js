/**
 * SEMANTIC AUDIT for the generated exercise packs.
 *
 * The generator only proves a drill is LEGAL (the FEN parses and expectedSan is
 * a legal move). It does NOT prove the drill TEACHES what its lesson claims —
 * an "escape the check" position need not be a check at all, and a "mate" move
 * need not actually mate. This script checks the chess RULES, not the syntax.
 *
 * Per lesson it asserts:
 *   check      → the side to move is genuinely in check, AND after the reply
 *                the mover is no longer in check (it answered it).
 *   checkmate  → after the move the side to move is IN CHECKMATE (in check and
 *                no legal reply), not merely in check.
 *   castling   → the move really is a castle (O-O / O-O-O).
 *   en passant → the move really is an en-passant capture.
 *   promotion  → the move really is a promotion.
 *
 * Run: node scripts/audit_academy_exercises.js
 */
const { Chess } = require('chess.js');
const { PACKS } = require('../src/data/academyExercises.generated');

let problems = 0;
const fail = (slug, ex, why) => {
  problems += 1;
  console.log(`  ✗ [${slug}] ${why}`);
  console.log(`      fen: ${ex.fen}`);
  console.log(`      san: ${ex.expectedSan}`);
  console.log(`      says: ${ex.instruction}`);
};

/** Replay a drill and describe what actually happened. */
function replay(ex) {
  const game = new Chess(ex.fen);
  const before = {
    turn: game.turn(),
    inCheck: game.inCheck(),
  };
  const move = game.move(ex.expectedSan);
  if (!move) return { error: 'move did not apply' };
  return {
    before,
    move,
    after: {
      inCheck: game.inCheck(),
      isCheckmate: game.isCheckmate(),
      isStalemate: game.isStalemate(),
      isGameOver: game.isGameOver(),
    },
    san: move.san,
  };
}

/* ── Per-lesson semantic rules ─────────────────────────────────────────── */
const RULES = {
  check(ex, r) {
    const errs = [];
    if (r.error) return [r.error];
    // White-to-move drills are "answer the check"; black-to-move are "give check".
    if (r.before.turn === 'w' && !r.before.inCheck) {
      errs.push('LESSON SAYS ANSWER-CHECK but White is NOT in check to start with');
    }
    if (r.before.turn === 'b') {
      if (!r.after.inCheck) {
        errs.push('LESSON SAYS GIVE-CHECK but Black is not giving check after the move');
      }
    } else {
      if (r.after.inCheck) {
        errs.push('LESSON SAYS ANSWER-CHECK but the king is STILL in check after the move');
      }
    }
    return errs;
  },
  checkmate(ex, r) {
    if (r.error) return [r.error];
    if (!r.after.isCheckmate) {
      const why = r.after.inCheck
        ? 'it is CHECK but not checkmate (the defender still has a legal move)'
        : 'it is not even check';
      return [`LESSON SAYS CHECKMATE but ${why}`];
    }
    return [];
  },
  'special-rules'(ex, r) {
    if (r.error) return [r.error];
    const errs = [];
    if (/castle|king two squares/i.test(ex.instruction)) {
      if (!/^O-O(-O)?/.test(r.move.san)) {
        errs.push(`LESSON SAYS CASTLE but the move is "${r.move.san}" (not a castling move)`);
      }
    }
    if (/en passant/i.test(ex.instruction)) {
      /* chess.js has no `enPassant` boolean — an en-passant capture is flagged
         with 'e' in `flags`, and the tell-tale is that the captured pawn's
         square (one BEHIND the destination, e5xd6 clears d5) ends up empty. */
      const isEp = (r.move.flags || '').includes('e');
      const after = new Chess(ex.fen); after.move(ex.expectedSan);
      const behindFile = r.move.to[0];
      const behind = `${behindFile}${(Number(r.move.to[1]) - 1)}`;
      const cleared = !after.get(behind);
      if (!isEp || !cleared) {
        errs.push(`LESSON SAYS EN PASSANT but the move is not one (flags="${r.move.flags}", captured square still occupied: ${!cleared})`);
      }
    }
    if (/promot/i.test(ex.instruction)) {
      if (!r.move.promotion) errs.push('LESSON SAYS PROMOTE but the move is not a promotion');
    }
    return errs;
  },
};

/* ── Run the audit ─────────────────────────────────────────────────────── */
for (const [slug, list] of Object.entries(PACKS)) {
  const rule = RULES[slug];
  if (!rule) { console.log(`— ${slug}: no semantic rule defined (structural check only)`); continue; }
  let checked = 0;
  for (const ex of list) {
    if (ex.type !== 'move') continue;
    const errs = rule(ex, replay(ex));
    checked += 1;
    for (const e of errs) fail(slug, ex, e);
  }
  console.log(`— ${slug}: ${checked} board drills checked`);
}

console.log(problems === 0 ? '\nPASS: every drill does what its lesson claims' : `\n${problems} PROBLEM(S) FOUND`);
process.exit(problems === 0 ? 0 : 1);
