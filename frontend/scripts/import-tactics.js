#!/usr/bin/env node
// Import script: Replace all 45 tactics positions/solutions with new PGN file
import fs from 'fs';
import path from 'path';
import { Chess } from 'chess.js';

const args = process.argv.slice(2);
let pgnPath = null;
let dryRun = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--pgn' && i + 1 < args.length) {
    pgnPath = args[++i];
  } else if (args[i] === '--dry-run') {
    dryRun = true;
  }
}

if (!pgnPath) {
  console.error('Usage: node scripts/import-tactics.js --pgn <path-to-pgn> [--dry-run]');
  process.exit(1);
}

const TACTICS_JSON = path.resolve('frontend/src/features/tactics/data/tactics.json');
const BACKUP_DIR = path.resolve('frontend/src/features/tactics/data/backup');
/** Parse a PGN string into games. Each game: [Event "01 The Fork"], [FEN ...], moves. */
function parsePGN(pgnText) {
  const games = [];
  const gameBlocks = pgnText.split(/\n\s*\n/);
  for (const block of gameBlocks) {
    const eventMatch = block.match(/\[Event\s+"(\d+)\s+(.+?)"/);
    if (!eventMatch) continue;
    const number = parseInt(eventMatch[1], 10);
    const fenMatch = block.match(/\[FEN\s+"([^"]+)"\]/);
    if (!fenMatch) continue;
    const fen = fenMatch[1];
    let moves = [];
    const sanLines = block.match(/(\S+)(?:\s+\S+)*\s+\*/g);
    if (sanLines) {
      sanLines.forEach((line) => {
        const m = line.match(/^(\S+)(?:\s+\S+)*\s+\*/);
        if (m) {
          const san = m[1].trim();
          san.split(/\s+/).forEach((s) => { if (s) moves.push(s); });
        }
      });
    }
    const afterLastFen = block.match(/\[FEN\s+"[^"]+"\]\s*(.*)$/);
    if (afterLastFen && afterLastFen[1]) {
      const textAfter = afterLastFen[1].trim();
      const cleaned = textAfter.replace(/\*$/, '').trim();
      if (cleaned) { cleaned.split(/\s+/).forEach((s) => { if (s) moves.push(s); }); }
    }
    const seen = new Set();
    moves = moves.filter((m) => { if (seen.has(m)) return false; seen.add(m); return true; });
    const titleMatch = block.match(/\[Event\s+\d+\s+"[^"]*"\]\s*$\n?(.+)(?=\n\[|\n$)/m);
    let title = `Tactic ${number}`;
    if (titleMatch) { title = titleMatch[1].trim(); }
    games.push({ number, title, fen, moves });
  }
  return games;
}

/** Validate a FEN string using chess.js */
function validateFEN(fen) {
  const chess = new Chess();
  try {
    chess.loadFEN(fen);
    return { valid: true, error: null };
  } catch (e) {
    return { valid: false, error: e.message };
  }
}

/** Validate that solution moves are legal from the given FEN */
function validateMovesFromFEN(fen, moves) {
  const chess = new Chess();
  try {
    chess.loadFEN(fen);
    for (const moveSan of moves) {
      const result = chess.move(moveSan);
      if (!result) return { valid: false, error: `Invalid SAN move: ${moveSan}` };
    }
    return { valid: true, error: null };
  } catch (e) {
    return { valid: false, error: e.message };
  }
}

/** Generate arrows from solution moves based on FEN and move list. */
function generateArrowsFromFEN(fen, moves) {
  const chess = new Chess();
  chess.loadFEN(fen);
  const arrows = [];
  let halfMove = 1;
  for (const moveSan of moves) {
    const result = chess.move(moveSan);
    if (!result) break;
    const isWhite = halfMove % 2 === 1;
    const color = isWhite ? 'white' : 'black';
    arrows.push({ from: result.from, to: result.to, color });
    halfMove++;
  }
  return arrows;
}

/** Check if the teaching text is generic (placeholder) or specific to the position. */
function isGenericText(text) {
  if (!text) return true;
  const lower = text.toLowerCase();
  const specificPatterns = [
    /knight/i, /bishop/i, /rook/i, /queen/i, /king/i, /pawn/i,
    /check/m, /mate/i, /fork/i, /pin/i, /skewer/i,
  ];
  const hasSpecificRef = specificPatterns.some((p) => p.test(lower));
  const generalPatterns = [
    /look for/i, /find/i, /search for/i, /try to/i, /you should/i,
  ];
  const isVeryGeneral = generalPatterns.some((p) => p.test(lower));
  if (hasSpecificRef && !isVeryGeneral) return false;
  if (isVeryGeneral) return true;
  return false;
}

/** Check if explanation text should be kept or flagged for review. */
function shouldKeepExplanation(text) {
  if (!text) return true;
  const lower = text.toLowerCase();
  const general = /look for|find|search for|try to|you should/.test(lower);
  const specific = /\bknight\b|\bbishop\b|\brook\b|\bqueen\b|\bking\b|\bpawn\b/.test(lower);
  if (specific && !general) return false;
  return true;
}

/** Main import function */
async function main() {
  console.log('=== Tactics Import Script ===');
  console.log(`PGN file: ${PGN_FILE}`);
  console.log(`Dry run: ${dryRun}`);
  console.log('');

  // Read PGN
  let pgnText;
  try {
    pgnText = fs.readFileSync(PGN_FILE, 'utf-8');
  } catch (e) {
    console.error(`ERROR: Cannot read PGN file: ${PGN_FILE}`);
    process.exit(1);
  }

  // Parse games
  const parsedGames = parsePGN(pgnText);
  console.log(`Parsed ${parsedGames.length} games from PGN`);

  if (parsedGames.length === 0) {
    console.error('No games parsed from PGN. Check the format.');
    process.exit(1);
  }

  // Read current tactics data
  let tacticsData;
  try {
    tacticsData = JSON.parse(fs.readFileSync(TACTICS_JSON, 'utf-8'));
  } catch (e) {
    console.error(`ERROR: Cannot read tactics.json`);
    process.exit(1);
  }

  // Create backup
  if (!dryRun) {
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(BACKUP_DIR, `tactics-backup-${timestamp}.json`);
    fs.copyFileSync(TACTICS_JSON, backupPath);
    console.log(`Backup created: ${backupPath}`);
  }

  // Build lookup: id -> tactic entry
  const byId = {};
  tacticsData.forEach((t) => { byId[t.id] = t; });

  // Validate and process each game
  let replaced = 0;
  let skipped = 0;
  let needsReview = [];
  let errors = [];

  for (const game of parsedGames) {
    const number = game.number;

    if (byId[number] === undefined) {
      errors.push({ number, reason: `Tactic ${number} not found in current tactics data` });
      skipped++;
      continue;
    }

    const tactic = byId[number];

    // Validate FEN
    const fenValid = validateFEN(game.fen);
    if (!fenValid.valid) {
      errors.push({ number, reason: `Invalid FEN: ${fenValid.error}` });
      skipped++;
      continue;
    }

    // Validate moves
    let movesValid = true;
    if (game.moves.length > 0) {
      const chess = new Chess();
      chess.loadFEN(game.fen);
      const moveValidate = validateMovesFromFEN(game.fen, game.moves);
      if (!moveValidate.valid) {
        movesValid = false;
        errors.push({ number, reason: `Invalid moves: ${moveValidate.error}` });
        skipped++;
        continue;
      }
    }

    // If dry-run, just report
    if (dryRun) {
      console.log(`[DRY-RUN] Would replace tactic ${number}: "${tactic.title}"`);
      replaced++;
      continue;
    }

    // Generate arrows from solution moves
    const newArrows = generateArrowsFromFEN(game.fen, game.moves);

    // Determine which explanation texts to keep or flag
    const keepWhatItIs = shouldKeepExplanation(tactic.whatItIs);
    const keepWhyItWins = shouldKeepExplanation(tactic.whyItWins);
    const keepDoThis = shouldKeepExplanation(tactic.doThis);

    if (!keepWhatItIs) needsReview.push({ number, reason: 'Specific position text' });
    if (!keepWhyItWins) needsReview.push({ number, reason: 'Specific whyItWins text' });
    if (!keepDoThis) needsReview.push({ number, reason: 'Specific doThis text' });

    // Replace the tactic data, preserving id, number, title, category, order
    const idx = tacticsData.findIndex((t) => t.id === tactic.id);
    if (idx >= 0) {
      const newEntry = {
        id: tactic.id,
        number: tactic.number,
        slug: tactic.slug,
        category: tactic.category,
        title: tactic.title,
        tags: tactic.tags,
        fen: game.fen,
        arrows: newArrows,
        caption: `${tactic.title} - solution`,
        whatItIs: keepWhatItIs ? tactic.whatItIs : '',
        whyItWins: keepWhyItWins ? tactic.whyItWins : '',
        doThis: keepDoThis ? tactic.doThis : '',
        solution: game.moves,
        opponentReplies: tactic.opponentReplies,
      };
      tacticsData[idx] = Object.freeze(newEntry);
      replaced++;
    }
  }

  // If not dry-run, write the updated data
  if (!dryRun) {
    fs.writeFileSync(TACTICS_JSON, JSON.stringify(tacticsData, null, 2));
    console.log('Updated tactics.json');
  }

  // Report
  console.log('');
  console.log('=== Import Report ===');
  console.log(`Total games parsed: ${parsedGames.length}`);
  console.log(`Tactics replaced: ${replaced}`);
  console.log(`Tactics skipped: ${skipped}`);
  if (errors.length > 0) {
    console.log('Errors (skipped):');
    errors.forEach((e) => console.log(`  - Tactic ${e.number}: ${e.reason}`));
  }
  if (needsReview.length > 0) {
    console.log('Tactics needing explanation review:');
    needsReview.forEach((t) => console.log(`  - Tactic ${t.number}: ${t.reason}`));
  } else {
    console.log('No tactics need explanation text review (all are generic or were preserved).');
  }
  console.log('=== Import Complete ===');
}