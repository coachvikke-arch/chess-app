const db = require('../config/database');
const { Chess } = require('chess.js');

/* ═══════════════════════════════════════════════════════════════════════════
 * PGN / FEN Library folders → Puzzle Listing sets.
 *
 * The Library stores every uploaded file as a `library_items` row. The Puzzle
 * Listing reads the `puzzles` table. This service projects a library folder
 * holding solvable entries into exactly ONE `sets` row, code `lib<folderId>`,
 * and derives its puzzles from those items — so the Listing name, count and
 * puzzle list are the folder's, never an independent copy:
 *
 *   · name       — read from library_folders on every sync (renames follow)
 *   · contents   — derived from library_items (adds/edits/deletes follow)
 *   · identity   — fen_key 'lib<itemId>' links a derived row back to its item
 *                  (generated puzzles saved by savePuzzleService are adopted
 *                  by matching content within the same folder instead)
 *
 * Sync points: server boot + first listing read (backfill), and every library
 * mutation (folder create/rename/delete, item create/edit/move/delete, order),
 * plus after the puzzle generator saves into a folder.
 *
 * Deleting a folder removes its set row; derived puzzle rows are kept when an
 * assignment or attempt still references them, so student history is never
 * destroyed by a library edit. Everything else stale is removed.
 * ═══════════════════════════════════════════════════════════════════════════ */

const LIB_TAG = 'LIB';
const LIB_PREFIX = 'lib';
const UCI_RE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

const librarySetCode = (folderId) => `${LIB_PREFIX}${Number(folderId)}`;
const isLibrarySetCode = (code) => /^lib\d+$/.test(String(code || ''));
const folderIdFromSetCode = (code) => Number(String(code).slice(LIB_PREFIX.length));

function solutionToUci(fen, moves) {
  const game = new Chess(fen);
  const out = [];
  const list = Array.isArray(moves) ? moves : String(moves ?? '').split(/[\s,]+/).filter(Boolean);
  for (const raw of list) {
    const token = String(raw || '').trim();
    if (!token) continue;
    const applied = UCI_RE.test(token)
      ? game.move({ from: token.slice(0, 2), to: token.slice(2, 4), promotion: token.length > 4 ? token[4] : undefined })
      : game.move(token);
    if (!applied) throw new Error(`Illegal move: ${token}`);
    out.push(`${applied.from}${applied.to}${applied.promotion || ''}`);
  }
  return out;
}

/* One library item → a solvable puzzle, or null when it isn't one: FEN-only
   entries carry no solution, and ordinary game PGNs start from the standard
   position (no [FEN] header), which is exactly how CSV puzzle entries differ. */
function itemToPuzzle(item) {
  if (item.type !== 'pgn') return null;
  const notation = String(item.pgn || item.notation || '').trim();
  if (!notation) return null;

  let game;
  try { game = new Chess(); game.loadPgn(notation); } catch { return null; }
  const startFen = game.header().FEN;
  if (!startFen) return null;
  try { new Chess(startFen); } catch { return null; }

  let moves;
  try { moves = game.history({ verbose: true }); } catch { return null; }
  if (!moves.length) return null;

  let solution;
  try { solution = solutionToUci(startFen, moves.map((m) => `${m.from}${m.to}${m.promotion || ''}`)); } catch { return null; }

  return {
    itemId: item.id,
    fen: startFen,
    solution,
    title: item.title,
    orderIndex: Number(item.position) || 0,
    key: `${startFen}|${solution.join(' ')}`,
  };
}

function contentKey(row) {
  try {
    return `${row.fen}|${solutionToUci(row.fen, row.solution).join(' ')}`;
  } catch {
    return null;
  }
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

async function readFolderPuzzles(client, folderId) {
  const res = await client.query(
    `SELECT id, title, type, notation, pgn, position
       FROM library_items WHERE folder_id = $1 ORDER BY position ASC, id ASC`,
    [folderId]
  );
  const out = [];
  for (const item of res.rows) {
    const p = itemToPuzzle(item);
    if (p) out.push(p);
  }
  return out;
}

/* A CSV upload used to copy itself into a stand-alone CST set as well as the
   folder. When such a set holds exactly this folder's puzzles, adopt it in
   place (re-keyed as lib<folderId>) instead of showing both. */
async function adoptMatchingCustomSet(client, folder, derived, code) {
  const hasSet = await client.query('SELECT 1 FROM sets WHERE code = $1', [code]);
  if (hasSet.rows.length) return false;

  /* Only custom sets holding the same number of puzzles can match, so the
     replay below never walks the whole import history for an unrelated folder. */
  const rows = await client.query(
    `SELECT p.set_code, p.fen, p.solution
       FROM puzzles p
      WHERE p.set_code IN (
              SELECT q.set_code FROM puzzles q
                JOIN sets s ON s.code = q.set_code
               WHERE s.type_tag = 'CST'
               GROUP BY q.set_code
              HAVING COUNT(*) = $1
            )`,
    [derived.length]
  );
  const bySet = new Map();
  for (const row of rows.rows) {
    const key = contentKey(row);
    if (!key) continue;
    if (!bySet.has(row.set_code)) bySet.set(row.set_code, []);
    bySet.get(row.set_code).push(key);
  }

  const want = derived.map((p) => p.key).sort().join('\n');
  for (const [cstCode, keys] of bySet) {
    if (keys.length !== derived.length) continue;
    if (keys.slice().sort().join('\n') !== want) continue;

    await client.query(
      `UPDATE puzzles
          SET set_code = $1, pgn_folder_id = COALESCE(pgn_folder_id, $2), updated_at = NOW()
        WHERE set_code = $3`,
      [code, folder.id, cstCode]
    );
    await client.query(
      `UPDATE sets SET code = $1, name = $2, type_tag = $3, updated_at = NOW() WHERE code = $4`,
      [code, folder.name, LIB_TAG, cstCode]
    );
    return true;
  }
  return false;
}

async function dropStaleRows(client, staleIds) {
  if (!staleIds.length) return 0;
  const res = await client.query(
    `DELETE FROM puzzles p
      WHERE p.id = ANY($1::int[])
        AND NOT EXISTS (SELECT 1 FROM assignment_puzzles ap WHERE ap.puzzle_id = p.id)
        AND NOT EXISTS (SELECT 1 FROM puzzle_assignments pa WHERE pa.puzzle_id = p.id)`,
    [staleIds]
  );
  return res.rowCount;
}

/* Bring the set for ONE folder in line with its items. Safe to call often:
   unchanged rows are left untouched, so the ETag signal stays quiet. */
async function reconcileFolder(client, folderId) {
  const code = librarySetCode(folderId);
  const folderRes = await client.query('SELECT id, name FROM library_folders WHERE id = $1', [folderId]);
  const folder = folderRes.rows[0];

  if (!folder) {
    await client.query('DELETE FROM sets WHERE code = $1', [code]);
    return { set_code: code, count: 0, removed: true };
  }

  const derived = await readFolderPuzzles(client, folderId);

  if (!derived.length) {
    /* Folder emptied (or nothing in it is solvable): no set, and no rows of
       ours left pointing at a set that no longer exists. */
    await client.query('DELETE FROM sets WHERE code = $1', [code]);
    const stale = await client.query('SELECT id FROM puzzles WHERE set_code = $1', [code]);
    await dropStaleRows(client, stale.rows.map((r) => r.id));
    return { set_code: code, count: 0, removed: true };
  }

  await adoptMatchingCustomSet(client, folder, derived, code);

  await client.query(
    `INSERT INTO sets (code, name, type_tag) VALUES ($1, $2, $3)
     ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, type_tag = EXCLUDED.type_tag, updated_at = NOW()
     WHERE sets.name IS DISTINCT FROM EXCLUDED.name OR sets.type_tag IS DISTINCT FROM EXCLUDED.type_tag`,
    [code, folder.name, LIB_TAG]
  );

  const existing = await client.query(
    `SELECT id, fen, solution, title, order_index, set_code, pgn_folder_id
       FROM puzzles WHERE set_code = $1 OR pgn_folder_id = $2`,
    [code, folderId]
  );

  const byKey = new Map();
  for (const row of existing.rows) {
    const key = contentKey(row);
    if (!key) continue;
    const prev = byKey.get(key);
    if (!prev || (row.set_code === code && prev.set_code !== code)) byKey.set(key, row);
  }

  const keepIds = new Set();
  const inserts = [];
  for (const p of derived) {
    const row = byKey.get(p.key);
    if (row && !keepIds.has(row.id)) {
      keepIds.add(row.id);
      const changed =
        row.set_code !== code ||
        Number(row.pgn_folder_id) !== Number(folderId) ||
        String(row.title ?? '') !== String(p.title ?? '') ||
        Number(row.order_index) !== p.orderIndex;
      if (changed) {
        await client.query(
          `UPDATE puzzles SET set_code = $1, pgn_folder_id = $2, title = $3, order_index = $4, updated_at = NOW()
            WHERE id = $5`,
          [code, folderId, p.title, p.orderIndex, row.id]
        );
      }
    } else {
      inserts.push(p);
    }
  }

  for (const part of chunk(inserts, 200)) {
    const values = [];
    const tuples = part.map((p, i) => {
      const n = i * 10;
      values.push(p.fen, JSON.stringify(p.solution), 'Tactics', [], 'Medium', p.title, p.orderIndex, code, folderId, `lib${p.itemId}`);
      return `($${n + 1}, $${n + 2}::jsonb, $${n + 3}, $${n + 4}::text[], $${n + 5}, $${n + 6}, $${n + 7}, $${n + 8}, $${n + 9}, 'library', $${n + 10}, TRUE)`;
    });
    await client.query(
      `INSERT INTO puzzles
         (fen, solution, theme, themes, difficulty, title, order_index, set_code, pgn_folder_id, source, fen_key, is_published)
       VALUES ${tuples.join(',')}
       ON CONFLICT (fen_key) WHERE fen_key IS NOT NULL DO UPDATE SET
         fen = EXCLUDED.fen, solution = EXCLUDED.solution, title = EXCLUDED.title,
         order_index = EXCLUDED.order_index, set_code = EXCLUDED.set_code,
         pgn_folder_id = EXCLUDED.pgn_folder_id, updated_at = NOW()`,
      values
    );
  }

  const derivedKeys = new Set(derived.map((p) => p.key));
  const staleIds = [];
  for (const row of existing.rows) {
    if (keepIds.has(row.id)) continue;
    const key = contentKey(row);
    if (key && derivedKeys.has(key)) continue;
    staleIds.push(row.id);
  }
  await dropStaleRows(client, staleIds);

  return { set_code: code, count: derived.length, removed: false };
}

async function run(fn) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

function syncLibraryFolder(folderId) {
  return run((client) => reconcileFolder(client, folderId));
}

function syncLibraryFolders(folderIds) {
  const ids = [...new Set((folderIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  return run(async (client) => {
    const out = [];
    for (const id of ids) out.push(await reconcileFolder(client, id));
    return out;
  });
}

/* Drop the sets of a folder subtree BEFORE the folders are deleted. */
async function forgetLibraryFolders(folderIds) {
  const ids = [...new Set((folderIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length) return 0;
  const codes = ids.map(librarySetCode);
  const res = await db.query('DELETE FROM sets WHERE code = ANY($1::text[])', [codes]);
  return res.rowCount;
}

async function syncAllLibraryFolders() {
  const folders = await db.query('SELECT id FROM library_folders');
  const live = new Set(folders.rows.map((r) => librarySetCode(r.id)));

  const libSets = await db.query(`SELECT code FROM sets WHERE type_tag = $1`, [LIB_TAG]);
  const gone = libSets.rows.map((r) => r.code).filter((code) => isLibrarySetCode(code) && !live.has(code));
  if (gone.length) await db.query('DELETE FROM sets WHERE code = ANY($1::text[])', [gone]);

  for (const row of folders.rows) await syncLibraryFolder(row.id);
  return folders.rows.length;
}

/* Deleting a derived puzzle from the Listing must delete the item it came from,
   or the next sync would put it straight back. `fen_key` names the item for
   rows this service created; adopted puzzle-generator rows are matched by
   content instead. Returns true when an item was removed. */
async function removeLibraryItemForPuzzle(folderId, fen, solution) {
  const items = await db.query(
    'SELECT id, title, type, notation, pgn, position FROM library_items WHERE folder_id = $1',
    [folderId]
  );
  const key = contentKey({ fen, solution });
  if (!key) return false;
  for (const item of items.rows) {
    const p = itemToPuzzle(item);
    if (p && p.key === key) {
      await db.query('DELETE FROM library_items WHERE id = $1', [p.itemId]);
      return true;
    }
  }
  return false;
}

/* Per-process backfill, so a listing read can never render before the first
   folder projection has run — but also never repeats the expensive pass. */
let initialPass = null;
function ensureLibrarySetsSynced() {
  if (!initialPass) {
    initialPass = syncAllLibraryFolders().catch((err) => {
      initialPass = null;
      throw err;
    });
  }
  return initialPass;
}

module.exports = {
  LIB_TAG,
  librarySetCode,
  isLibrarySetCode,
  folderIdFromSetCode,
  itemToPuzzle,
  syncLibraryFolder,
  syncLibraryFolders,
  forgetLibraryFolders,
  removeLibraryItemForPuzzle,
  syncAllLibraryFolders,
  ensureLibrarySetsSynced,
};
