/* Child process that actually builds a batch of puzzles.
 *
 * Forked by jobs.js so Stockfish never competes with the API event loop. Talks
 * to the parent only through IPC messages: {type:'progress'|'done'|'failed'}.
 */

require('dotenv').config();
const db = require('../../config/database');
const { getTopic } = require('./topics');
const { pickLichessPuzzles } = require('./lichessSource');
const { mineEnginePuzzles } = require('./engineSource');
const { createEnginePool, EngineUnavailableError } = require('./stockfish');
const { fenKeyOf } = require('./fenKey');
const { buildPgn } = require('../savePuzzleService');

const ENGINE_DEPTH = Number(process.env.PUZZLE_ENGINE_DEPTH || 18);

const STEP = {
  lichessQuery: 'Querying Lichess puzzle database',
  trigger: 'Applying trigger move and removing it',
  loadPositions: 'Loading positions from your games',
  stockfish: `Running Stockfish (depth ${ENGINE_DEPTH}, MultiPV 2)`,
  uniqueBest: 'Checking unique best move',
  detect: 'Detecting theme',
  dedupe: 'Removing duplicates',
};

function send(msg) {
  if (process.send) process.send(msg);
}

function progress(step, pct, counts) {
  send({ type: 'progress', step, progress: pct, counts });
}

function shuffle(list) {
  const arr = list.slice();
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function shape(p) {
  return {
    id: p.id,
    source: p.source,
    fen: p.fen,
    solverColor: p.solverColor,
    theme: p.theme,
    themes: p.themes || [],
    difficulty: p.difficulty,
    rating: p.rating ?? null,
    gameUrl: p.gameUrl ?? null,
    solutionSan: p.solutionSan,
    solutionUci: p.solutionUci,
    pgn: buildPgn(p),
  };
}

async function tableIsEmpty() {
  try {
    const r = await db.query('SELECT 1 FROM lichess_puzzles LIMIT 1');
    return r.rows.length === 0;
  } catch {
    return true;
  }
}

async function run(config) {
  const topic = getTopic(config.topic);
  if (!topic) throw new Error('Unknown tactic topic.');

  const count = Math.max(1, Math.min(100, Number(config.count) || 12));
  const difficulty = ['easy', 'medium', 'hard'].includes(config.difficulty) ? config.difficulty : 'any';
  /* The label is what every puzzle carries: the app's difficulty vocabulary is
     capitalised, so never let the lowercase request value reach a puzzle. */
  const difficultyLabel = difficulty === 'any'
    ? null
    : difficulty.charAt(0).toUpperCase() + difficulty.slice(1);
  let source = ['lichess', 'engine', 'lichess+engine'].includes(config.source) ? config.source : 'lichess+engine';

  const warnings = [];
  const counts = { lichess: 0, engine: 0 };

  if (source === 'engine' && !topic.engine) {
    return {
      puzzles: [],
      counts,
      warnings: [`No engine theme detector for ${topic.label} yet. Switch the source to Lichess only or Lichess + Engine.`],
    };
  }
  if (source === 'lichess+engine' && !topic.engine) {
    source = 'lichess';
    warnings.push(`${topic.label} has no engine theme detector yet, so this run used Lichess only.`);
  }

  let lichessPoolAvailable = true;
  if (source !== 'engine') {
    lichessPoolAvailable = !(await tableIsEmpty());
    if (!lichessPoolAvailable) {
      const missing = 'Lichess puzzle file not found. Set LICHESS_PUZZLE_CSV or use Engine only.';
      if (source === 'lichess') return { puzzles: [], counts, warnings: [missing] };
      warnings.push(missing);
      source = 'engine';
    }
  }

  /* ── Source A: Lichess ─────────────────────────────────────────────── */
  const exclude = new Set();
  let lichessPuzzles = [];
  if (source !== 'engine') {
    progress(STEP.lichessQuery, 12, counts);
    const picked = await pickLichessPuzzles({ topic, difficulty, count, exclude });
    lichessPuzzles = picked.puzzles.map(shape);
    if (lichessPuzzles.length) progress(STEP.trigger, 26, counts);
    if (picked.scanned === 0) {
      warnings.push(`The Lichess database has no puzzles tagged for ${topic.label}.`);
    }
  }

  const half = Math.ceil(count / 2);
  const lichessTake = Math.min(lichessPuzzles.length, source === 'lichess' ? count : half);
  const engineNeeded = source === 'engine' ? count : count - lichessTake;

  /* ── Source B: engine mining ───────────────────────────────────────── */
  let enginePuzzles = [];
  let pool = null;
  try {
    if (engineNeeded > 0 && topic.engine) {
      progress(STEP.loadPositions, 32, counts);
      pool = createEnginePool(2, { hashMb: 256, threads: 1 });
      const mined = await mineEnginePuzzles({
        pool,
        topic,
        count: engineNeeded,
        difficulty: difficultyLabel,
        exclude: new Set(lichessPuzzles.slice(0, lichessTake).map((p) => fenKeyOf(p.fen))),
        onProgress: (pct, step) => progress(step || STEP.stockfish, pct, counts),
      });
      enginePuzzles = mined.puzzles.map(shape);
      if (mined.warning) warnings.push(mined.warning);
      progress(STEP.uniqueBest, 88, counts);
      if (enginePuzzles.length) progress(STEP.detect, 93, counts);
    }
  } catch (err) {
    if (err instanceof EngineUnavailableError || err.code === 'ENGINE_UNAVAILABLE') {
      warnings.push(`${err.message} Engine puzzles were skipped.`);
    } else {
      warnings.push(`Engine mining stopped early: ${err.message}`);
    }
  } finally {
    if (pool) pool.quit();
  }

  /* ── Combine, de-duplicate, shuffle, cap ───────────────────────────── */
  progress(STEP.dedupe, 97, counts);
  const combined = shuffle([...lichessPuzzles.slice(0, lichessTake), ...enginePuzzles]);
  const seen = new Set();
  const finalPuzzles = [];
  for (const p of combined) {
    if (finalPuzzles.length >= count) break;
    const key = fenKeyOf(p.fen);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    finalPuzzles.push(p);
    counts[p.source] = (counts[p.source] || 0) + 1;
  }

  if (finalPuzzles.length === 0) {
    warnings.push(
      `No puzzles found for ${topic.label}. Try another topic, another source, or add more source games.`
    );
  } else if (finalPuzzles.length < count) {
    warnings.push(
      `Found ${finalPuzzles.length} of ${count} puzzles for ${topic.label}. `
      + 'Try another topic, another source, or add more source games.'
    );
  }

  return { puzzles: finalPuzzles, counts, warnings };
}

async function main() {
  let config;
  try {
    config = JSON.parse(process.argv[2] || '{}');
  } catch {
    send({ type: 'failed', error: 'Invalid generator request.' });
    process.exit(1);
  }

  try {
    const result = await run(config);
    send({ type: 'done', ...result });
    await db.pool.end();
    process.exit(0);
  } catch (err) {
    send({ type: 'failed', error: err.message || 'Generation failed' });
    try { await db.pool.end(); } catch { /* ignore */ }
    process.exit(1);
  }
}

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));

main();
