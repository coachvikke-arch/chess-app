/* Validation test for all opening lines.
   Run with: node scripts/validate-openings.mjs
   This validates that every main line and variation in openingsLibrary.json
   can be replayed legally using chess.js. */

import { Chess } from 'chess.js';
import library from '../src/data/openingsLibrary.json' with { type: 'json' };
import gambits from '../src/data/gambitsLibrary.json' with { type: 'json' };

const OPENINGS = [...(library.openings || []), ...(gambits.openings || [])];

function replayLine(moves) {
  const game = new Chess();
  const plies = [];
  for (const san of moves) {
    const mv = game.move(san);
    if (!mv) {
      return { ok: false, fen: game.fen(), failedMove: san, ply: plies.length };
    }
    plies.push({
      san: mv.san,
      uci: `${mv.from}${mv.to}${mv.promotion || ''}`,
      fen: game.fen(),
    });
  }
  return { ok: true, plies, finalFen: game.fen() };
}

function validateOpening(opening) {
  const results = {
    opening: opening.name,
    slug: opening.slug,
    mainLine: null,
    variations: [],
    errors: [],
  };

  // Validate main line
  const mainResult = replayLine(opening.moves || []);
  results.mainLine = mainResult;
  if (!mainResult.ok) {
    results.errors.push(`Main line failed at ply ${mainResult.ply}: ${mainResult.failedMove}`);
  }

  // Validate variations
  for (const variation of opening.variations || []) {
    const varResult = replayLine(variation.moves || []);
    results.variations.push({
      id: variation.id,
      name: variation.name,
      result: varResult,
    });
    if (!varResult.ok) {
      results.errors.push(`Variation "${variation.name}" (${variation.id}) failed at ply ${varResult.ply}: ${varResult.failedMove}`);
    }
  }

  return results;
}

function main() {
  console.log('Validating all opening lines...\n');
  
  let totalLines = 0;
  let passedLines = 0;
  let failedLines = 0;
  const allErrors = [];

  for (const opening of OPENINGS) {
    const result = validateOpening(opening);
    totalLines += 1 + (opening.variations?.length || 0);
    
    if (result.mainLine.ok) passedLines++; else failedLines++;
    
    for (const v of result.variations) {
      if (v.result.ok) passedLines++; else failedLines++;
    }

    if (result.errors.length > 0) {
      allErrors.push(...result.errors.map(e => `${opening.name}: ${e}`));
    }
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Total openings: ${OPENINGS.length}`);
  console.log(`Total lines (main + variations): ${totalLines}`);
  console.log(`Passed: ${passedLines}`);
  console.log(`Failed: ${failedLines}`);

  if (allErrors.length > 0) {
    console.log(`\n=== ERRORS ===`);
    allErrors.forEach(e => console.log(`  ✗ ${e}`));
    process.exit(1);
  } else {
    console.log(`\n✓ All ${totalLines} lines are valid!`);
    process.exit(0);
  }
}

main();