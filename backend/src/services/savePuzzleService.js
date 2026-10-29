/* Saving generated puzzles.
 *
 * Every included puzzle becomes BOTH:
 *   · a PGN game in the shared PGN library (library_items), so it shows up in
 *     Admin → Courses exactly like imported games, and
 *   · a row in `puzzles`, so the student Puzzles and Homework pages can use it.
 *
 * Both writes happen in one transaction: a half-saved batch would leave the
 * library and the puzzle collection disagreeing about what exists.
 */

const { Chess } = require('chess.js');
const db = require('../config/database');
const { fenKeyOf } = require('./puzzleGenerator/fenKey');

const MAX_PGN_LENGTH = 200000;

function clean(value, fallback = '') {
  return String(value == null ? fallback : value).replace(/"/g, "'").replace(/\s+/g, ' ').trim();
}

/** Solution as SAN with move numbers, ending in the usual `*` result token. */
function numberedSolution(fen, sanMoves) {
  const parts = String(fen || '').trim().split(/\s+/);
  const turn = parts[1] === 'b' ? 'b' : 'w';
  let moveNo = Number(parts[5]) || 1;
  const tokens = [];
  let i = 0;
  if (turn === 'b' && sanMoves.length) {
    tokens.push(`${moveNo}...`, sanMoves[0]);
    moveNo += 1;
    i = 1;
  }
  while (i < sanMoves.length) {
    tokens.push(`${moveNo}.`, sanMoves[i]);
    if (sanMoves[i + 1]) tokens.push(sanMoves[i + 1]);
    i += 2;
    moveNo += 1;
  }
  tokens.push('*');
  return tokens.join(' ');
}

function topicTag(puzzle) {
  return clean(puzzle.theme || 'Tactics');
}

/** The exact PGN block the spec asks for — no extra headers. */
function buildPgn(puzzle) {
  const fen = String(puzzle.fen || '').trim();
  const sanMoves = Array.isArray(puzzle.solutionSan) ? puzzle.solutionSan : [];
  const source = puzzle.source === 'engine' ? 'Engine' : 'Lichess';
  const headers = [
    `[Event "Mate Zone Puzzle"]`,
    `[Site "Mate Zone"]`,
    `[Theme "${topicTag(puzzle)}"]`,
    `[Difficulty "${clean(puzzle.difficulty, 'Medium')}"]`,
    `[Source "${source}"]`,
    `[SetUp "1"]`,
    `[FEN "${fen}"]`,
    `[Solution "${sanMoves.map((m) => clean(m)).join(' ')}"]`,
  ];
  return `${headers.join('\n')}\n\n${numberedSolution(fen, sanMoves)}\n`;
}

/** "PGN library / Tactics practice / Fork" for a folder id. */
async function folderPathOf(folderId) {
  const all = await db.query('SELECT id, name, parent_id FROM library_folders');
  const byId = new Map(all.rows.map((r) => [r.id, r]));
  const names = [];
  let cur = byId.get(Number(folderId));
  const guard = new Set();
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id);
    names.unshift(cur.name);
    cur = cur.parent_id != null ? byId.get(cur.parent_id) : null;
  }
  return ['PGN library', ...names].join(' / ');
}

function validatePuzzle(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const fen = String(raw.fen || '').trim();
  if (!fen) return null;
  try {
    new Chess(fen);                       // rejects a malformed FEN outright
  } catch {
    return null;
  }
  const san = Array.isArray(raw.solutionSan) ? raw.solutionSan.map((m) => String(m)) : [];
  const uci = Array.isArray(raw.solutionUci) ? raw.solutionUci.map((m) => String(m)) : [];
  if (!san.length || san.length !== uci.length) return null;
  if (san.length > 16) return null;
  return {
    fen,
    fenKey: fenKeyOf(fen),
    theme: clean(raw.theme, 'Tactics'),
    themes: Array.isArray(raw.themes) ? raw.themes.filter((t) => typeof t === 'string').slice(0, 20) : [],
    difficulty: ['Easy', 'Medium', 'Hard'].includes(raw.difficulty) ? raw.difficulty : 'Medium',
    rating: Number.isFinite(Number(raw.rating)) && Number(raw.rating) > 0 ? Math.round(Number(raw.rating)) : null,
    source: raw.source === 'engine' ? 'engine' : 'lichess',
    solutionSan: san,
    solutionUci: uci,
  };
}

/**
 * Save the included puzzles into one PGN-library folder.
 *
 * @returns {Promise<{saved:number, skipped:number, folderPath:string}>}
 */
async function savePuzzles({ puzzles, folderId, userId }) {
  const folder = await db.query('SELECT id, name FROM library_folders WHERE id = $1', [folderId]);
  if (!folder.rows.length) {
    const err = new Error('That folder no longer exists. Pick another one.');
    err.status = 400;
    throw err;
  }

  const folderPath = await folderPathOf(folderId);
  const valid = (Array.isArray(puzzles) ? puzzles : []).map(validatePuzzle).filter(Boolean);
  if (!valid.length) {
    const err = new Error('None of these puzzles could be saved (invalid position or solution).');
    err.status = 400;
    throw err;
  }

  // Duplicates: same piece placement + side to move, within the batch and
  // against everything already in the puzzles collection.
  const keys = [...new Set(valid.map((p) => p.fenKey))];
  const existing = await db.query(
    'SELECT fen_key FROM puzzles WHERE fen_key = ANY($1::text[])',
    [keys]
  );
  const taken = new Set(existing.rows.map((r) => r.fen_key));

  const client = await db.pool.connect();
  let saved = 0;
  let skipped = 0;
  try {
    await client.query('BEGIN');
    const posRow = await client.query(
      'SELECT COALESCE(MAX(position) + 1, 0) AS pos FROM library_items WHERE folder_id = $1',
      [folderId]
    );
    let position = posRow.rows[0].pos;

    for (const puzzle of valid) {
      if (taken.has(puzzle.fenKey)) { skipped += 1; continue; }
      taken.add(puzzle.fenKey);

      const pgn = buildPgn(puzzle);
      if (pgn.length > MAX_PGN_LENGTH) { skipped += 1; continue; }

      await client.query(
        `INSERT INTO library_items (folder_id, title, type, notation, fen, pgn, position, created_by)
         VALUES ($1, $2, 'pgn', $3, $4, $3, $5, $6)`,
        [folderId, `${puzzle.theme} puzzle ${saved + 1}`, pgn, puzzle.fen, position, userId || null]
      );
      position += 1;

      await client.query(
        `INSERT INTO puzzles
           (fen, solution, solution_san, theme, themes, difficulty, rating, source, pgn_folder_id,
            title, is_published, fen_key)
         VALUES ($1, $2::jsonb, $3::jsonb, $4, $5::text[], $6, $7, $8, $9, $10, TRUE, $11)`,
        [
          puzzle.fen,
          JSON.stringify(puzzle.solutionUci),
          JSON.stringify(puzzle.solutionSan),
          puzzle.theme,
          puzzle.themes.length ? puzzle.themes : [puzzle.theme],
          puzzle.difficulty,
          puzzle.rating,
          puzzle.source,
          folderId,
          `${puzzle.theme} puzzle ${saved + 1}`,
          puzzle.fenKey,
        ]
      );
      saved += 1;
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return { saved, skipped, folderPath };
}

module.exports = { savePuzzles, buildPgn, numberedSolution, folderPathOf };
