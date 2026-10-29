/* Turn the Lichess candidate pool into the shipped practice puzzles.
 *
 * Run with: node scripts/build_tactics_samples.mjs   (from frontend/)
 * Input:    scripts/data/lichess-samples.json   (from extract_lichess_samples.py)
 * Output:   src/features/tactics/data/samples.json
 *
 * WHY THIS EXISTS
 * Lichess rows are not quite the shape a card needs. Their FEN is the position
 * BEFORE the opponent's blunder, and their move list starts with that blunder —
 * an even-length list of UCI plies that alternates opponent/solver/opponent/…
 * A student must not see the blunder as part of the solution, so the trigger is
 * played forward here and stripped: the shipped puzzle is the position the
 * reader actually looks at, and its solution starts with the solver's move.
 *
 * Every ply is replayed through chess.js before an entry is written, so a row
 * that does not parse — or a trigger that ends the game — is dropped instead of
 * shipping a broken diagram. Output is static JSON: the app never talks to
 * Lichess at runtime.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Chess } from 'chess.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const IN = join(ROOT, 'scripts', 'data', 'lichess-samples.json');
const OUT = join(ROOT, 'src', 'features', 'tactics', 'data', 'samples.json');

const RATING_MIN = 600;
const RATING_MAX = 1200;
const PER_TOPIC = 8;          // the brief asks for 5-10; eight keeps the file small
const MIN_PER_TOPIC = 5;

/* Topic order is also the dedupe priority: a puzzle whose row carries several
   themes is filed under the first topic that claims it. */
const TOPICS = [
  { theme: 'fork', label: 'Fork', blurb: 'One piece attacks two targets at the same time — only one can be saved.' },
  { theme: 'pin', label: 'Pin', blurb: 'A piece cannot move because something more valuable sits behind it.' },
  { theme: 'skewer', label: 'Skewer', blurb: 'The valuable piece is in front and must move, exposing what stands behind it.' },
  { theme: 'discoveredAttack', label: 'Discovered attack', blurb: 'Stepping one piece out of the way unmasks the piece behind it.' },
  { theme: 'doubleCheck', label: 'Double check', blurb: 'Two pieces give check at once, so the king must run — nothing else helps.' },
  { theme: 'backRankMate', label: 'Back-rank mate', blurb: 'A boxed-in king is mated along its own back rank.' },
  { theme: 'mateIn2', label: 'Mate in two', blurb: 'A forcing first move leaves Black no defence against mate next move.' },
  { theme: 'hangingPiece', label: 'Hanging piece', blurb: 'An undefended piece is simply there to be taken.' },
  { theme: 'deflection', label: 'Deflection', blurb: 'A defender is dragged away from the square it was guarding.' },
  { theme: 'sacrifice', label: 'Sacrifice', blurb: 'Material is given up now for something bigger — usually mate or the queen.' },
];

const SOURCE = {
  name: 'Lichess puzzle database',
  url: 'https://database.lichess.org/#puzzles',
  license: 'CC0 1.0 Universal',
  licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
  ratingBand: [RATING_MIN, RATING_MAX],
  note: 'Positions and solutions come from the Lichess puzzle database, which is engine-verified and released under CC0. Each puzzle shows the position after the opponent’s move, so the reader is to move.',
};

/** UCI ("e5f7", "a7a8q") -> the object shape chess.js accepts. */
function uci(move) {
  return {
    from: move.slice(0, 2),
    to: move.slice(2, 4),
    ...(move.length > 4 ? { promotion: move[4] } : {}),
  };
}

/** "1. Nf7+ Kg8 2. Nh6+" — numbering taken from the position's own FEN. */
function numberLine(fen, sanMoves) {
  const chess = new Chess(fen);
  const parts = [];
  for (const san of sanMoves) {
    const blackToMove = chess.turn() === 'b';
    if (!blackToMove) {
      parts.push(`${chess.moveNumber()}.`);
    } else if (parts.length === 0) {
      parts.push(`${chess.moveNumber()}...`);
    }
    parts.push(san);
    chess.move(san);
  }
  return parts.join(' ');
}

/**
 * Convert one Lichess row into a puzzle, or return a reason it cannot ship.
 * The trigger is played and discarded; the solver's moves keep their own list,
 * with the opponent's answers in a parallel one (TacticCard's contract).
 */
function toPuzzle(row) {
  const chess = new Chess(row.fen);
  try {
    chess.move(uci(row.moves[0]));
  } catch {
    return { error: 'trigger is not legal in the given FEN' };
  }
  if (chess.isGameOver()) return { error: 'the trigger ends the game' };

  const fen = chess.fen();
  const solution = [];
  const opponentReplies = [];
  for (let i = 1; i < row.moves.length; i += 2) {
    try {
      solution.push(chess.move(uci(row.moves[i])).san);
    } catch {
      return { error: `solver move ${i} is not legal` };
    }
    if (i + 1 >= row.moves.length) break;
    try {
      opponentReplies.push(chess.move(uci(row.moves[i + 1])).san);
    } catch {
      return { error: `reply ${i + 1} is not legal` };
    }
  }
  if (!solution.length) return { error: 'no solver move' };

  /* The last solver move must leave the opponent with no answer — either it is
     mate, or Lichess simply stops there. Anything longer than three solver moves
     is dropped because the card replays the whole line. */
  if (solution.length > 3) return { error: 'line is too long for the card' };

  const trigger = new Chess(row.fen).move(uci(row.moves[0]));
  const all = [];
  solution.forEach((san, i) => {
    all.push(san);
    if (opponentReplies[i]) all.push(opponentReplies[i]);
  });

  return {
    puzzle: {
      id: row.id,
      fen,
      turn: fen.split(' ')[1] === 'w' ? 'white' : 'black',
      trigger: trigger.san,
      solution,
      opponentReplies,
      line: numberLine(fen, all),
      mate: chess.isCheckmate(),
      rating: row.rating,
      themes: row.themes,
      url: `https://lichess.org/training/${row.id}`,
      ...(row.gameUrl ? { gameUrl: row.gameUrl } : {}),
    },
  };
}

/** Evenly spaced picks across the rating band, so a topic is not all one level. */
function spread(rows, count) {
  const sorted = [...rows].sort((a, b) => a.rating - b.rating || a.id.localeCompare(b.id));
  if (sorted.length <= count) return sorted;
  const step = sorted.length / count;
  const picked = [];
  for (let i = 0; i < count; i++) picked.push(sorted[Math.floor(i * step)]);
  return picked;
}

const pool = JSON.parse(readFileSync(IN, 'utf8'));
const used = new Set();
const topics = [];
const problems = [];

for (const topic of TOPICS) {
  const rows = (pool[topic.theme] || [])
    .filter((row) => row.rating >= RATING_MIN && row.rating <= RATING_MAX && !used.has(row.id));
  const candidates = [];
  for (const row of spread(rows, PER_TOPIC * 4)) {
    if (candidates.length >= PER_TOPIC) break;
    if (used.has(row.id)) continue;
    const { puzzle, error } = toPuzzle(row);
    if (error) { problems.push(`${row.id} (${topic.theme}): ${error}`); continue; }
    used.add(row.id);
    candidates.push(puzzle);
  }
  if (candidates.length < MIN_PER_TOPIC) {
    throw new Error(`${topic.theme}: only ${candidates.length} usable puzzles, need ${MIN_PER_TOPIC}`);
  }
  topics.push({
    theme: topic.theme,
    label: topic.label,
    blurb: topic.blurb,
    puzzles: candidates.sort((a, b) => a.rating - b.rating),
  });
}

const shipped = topics.reduce((n, t) => n + t.puzzles.length, 0);
writeFileSync(OUT, `${JSON.stringify({ source: SOURCE, topics }, null, 2)}\n`, 'utf8');

for (const t of topics) {
  const ratings = t.puzzles.map((p) => p.rating);
  console.log(`${t.label.padEnd(18)} ${String(t.puzzles.length).padStart(2)} puzzles  rating ${Math.min(...ratings)}-${Math.max(...ratings)}`);
}
console.log(`wrote ${shipped} puzzles to ${OUT}`);
if (problems.length) console.log(`dropped ${problems.length} candidate(s):\n  ${problems.join('\n  ')}`);
