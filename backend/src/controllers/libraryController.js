const db = require('../config/database');

/* ═══════════════════════════════════════════════════════════════════════════
 * Shared Chess Library — folders of PGN/FEN entries.
 *
 * ONE library for every admin and the superadmin. There is no owner scoping:
 * `created_by` is recorded on insert as an audit trail and is NEVER used in a
 * WHERE clause. A folder one coach adds is immediately visible to all others,
 * which is the entire point of moving this off per-browser localStorage.
 *
 * The response deliberately keeps the SAME SHAPE the old localStorage library
 * had, so the frontend needs no reshaping:
 *   { folders: [ { id, name, parentId, type, description, createdAt,
 *                  items: [ { id, title, type, notation, fen, pgn, createdAt } ] } ] }
 * Only the differences are made explicit: folder/item ids are database ids
 * (integers) rather than per-browser uid()/nextItemId(), and item order comes
 * from `position` rather than array order.
 * ═══════════════════════════════════════════════════════════════════════════ */

const INVALID_NAME = /[/\\:*?"<>|]/;

/** Folder shape -> the nested folder shape the UI consumes. */
function toFolder(row, items) {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parent_id,
    type: row.type,
    description: row.description,
    createdAt: row.created_at,
    items,
  };
}

/** Item row -> item shape. */
function toItem(row) {
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    notation: row.notation,
    fen: row.fen ?? undefined,
    pgn: row.pgn ?? undefined,
    createdAt: row.created_at,
  };
}

/* The whole library in one payload. Ordering is explicit on both tables; no
 * owner filter appears anywhere (see the file header).
 *
 * `SELECT *` is used deliberately: created_by is never read back out, so it
 * can never leak through a response even if a column is added later. */
async function readLibrary() {
  const [folders, items] = await Promise.all([
    db.query('SELECT * FROM library_folders ORDER BY position ASC, id ASC'),
    db.query('SELECT * FROM library_items ORDER BY folder_id ASC, position ASC, id ASC'),
  ]);
  const byFolder = new Map();
  for (const row of items.rows) {
    if (!byFolder.has(row.folder_id)) byFolder.set(row.folder_id, []);
    byFolder.get(row.folder_id).push(toItem(row));
  }
  return { folders: folders.rows.map((f) => toFolder(f, byFolder.get(f.id) || [])) };
}

exports.getLibrary = async (req, res) => {
  try {
    res.json(await readLibrary());
  } catch (err) {
    res.status(500).json({ message: 'Failed to load library', error: err.message });
  }
};

/**
 * Read-only library for ANY signed-in user, students included.
 *
 * The classroom's Course tab (CourseFilesPanel) is shown to students during a
 * live lesson, but the full GET /api/library is admin-only. This is the same
 * data with the same shape — built by the same helpers, which already expose
 * only id / name / parentId / type / description / createdAt / items — so
 * `created_by` is NOT present in the response and cannot be inferred from it.
 * No owner filtering applies here either: the library is global.
 */
exports.getLibraryPublic = async (req, res) => {
  try {
    res.json(await readLibrary());
  } catch (err) {
    res.status(500).json({ message: 'Failed to load library', error: err.message });
  }
};

/**
 * Rename many entries atomically. Every rename lands or none does — one
 * transaction, so a failure part-way cannot leave the folder half-renamed
 * (the old client-side version could).
 */
exports.bulkRenameItems = async (req, res) => {
  const renames = Array.isArray(req.body?.renames) ? req.body.renames : null;
  if (!renames || renames.length === 0) {
    return res.status(400).json({ message: 'renames must be a non-empty array' });
  }
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    let changed = 0;
    for (const r of renames) {
      const id = Number(r?.id);
      const title = String(r?.title ?? '').trim();
      if (!Number.isInteger(id) || !title) continue;
      const res1 = await client.query(
        'UPDATE library_items SET title = $1 WHERE id = $2 RETURNING id', [title, id]
      );
      changed += res1.rowCount;
    }
    await client.query('COMMIT');
    res.json({ ok: true, renamed: changed });
  } catch (e) {
    await client.query('ROLLBACK');
    return res.status(500).json({ message: 'Could not rename the entries.', error: e.message });
  } finally {
    client.release();
  }
};

/* ── Folders ──────────────────────────────────────────────────────────── */

/** Duplicate-name check within the same parent, case-insensitive. */
async function assertUniqueName(name, parentId, excludeId, res) {
  const dupe = await db.query(
    `SELECT 1 FROM library_folders
      WHERE lower(name) = lower($1)
        AND parent_id IS NOT DISTINCT FROM $2
        AND ($3::int IS NULL OR id <> $3::int)
      LIMIT 1`,
    [name, parentId ?? null, excludeId ?? null]
  );
  if (dupe.rows.length) {
    res.status(400).json({ message: `A folder named "${name}" already exists in this location.` });
    return false;
  }
  return true;
}

/**
 * Refuse a move that would make a folder its own ancestor. PostgreSQL would
 * otherwise accept it and leave an orphaned cycle nobody can render.
 */
async function assertNoCycle(folderId, newParentId) {
  if (newParentId == null) return true;
  if (Number(newParentId) === Number(folderId)) return false;
  const res = await db.query(
    `WITH RECURSIVE descendants AS (
       SELECT id FROM library_folders WHERE parent_id = $1
       UNION ALL
       SELECT f.id FROM library_folders f
         JOIN descendants d ON f.parent_id = d.id
     )
     SELECT 1 FROM descendants WHERE id = $2 LIMIT 1`,
    [folderId, newParentId]
  );
  return res.rows.length === 0;
}

exports.createFolder = async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ message: 'Folder name cannot be empty.' });
    if (INVALID_NAME.test(name)) {
      return res.status(400).json({ message: 'Folder name cannot contain / \\ : * ? " < > |' });
    }
    const parentId = req.body?.parentId ?? null;
    if (parentId != null) {
      const parent = await db.query('SELECT 1 FROM library_folders WHERE id = $1', [parentId]);
      if (parent.rows.length === 0) return res.status(400).json({ message: 'Parent folder not found.' });
    }
    if (!(await assertUniqueName(name, parentId, null, res))) return undefined;

    const row = await db.query(
      `INSERT INTO library_folders (name, parent_id, type, description, position, created_by)
       VALUES ($1, $2, $3, $4,
               COALESCE((SELECT MAX(position) + 1 FROM library_folders
                          WHERE parent_id IS NOT DISTINCT FROM $2), 0),
               $5)
       RETURNING *`,
      [name, parentId, req.body?.type || 'general', req.body?.description ?? null, req.user.id]
    );
    res.status(201).json(toFolder(row.rows[0], []));
  } catch (err) {
    res.status(500).json({ message: 'Failed to create folder', error: err.message });
  }
};

exports.updateFolder = async (req, res) => {
  try {
    const id = req.params.id;
    const existing = await db.query('SELECT * FROM library_folders WHERE id = $1', [id]);
    if (existing.rows.length === 0) return res.status(404).json({ message: 'Folder not found' });
    const current = existing.rows[0];

    const name = req.body?.name === undefined ? current.name : String(req.body.name).trim();
    if (!name) return res.status(400).json({ message: 'Folder name cannot be empty.' });
    if (INVALID_NAME.test(name)) {
      return res.status(400).json({ message: 'Folder name cannot contain / \\ : * ? " < > |' });
    }

    // A move (parentId) is only validated when the client actually sends one;
    // `undefined` means "leave the parent alone", `null` means "move to root".
    const moving = Object.prototype.hasOwnProperty.call(req.body || {}, 'parentId');
    const parentId = moving ? (req.body.parentId ?? null) : current.parent_id;
    if (moving && parentId != null) {
      const parent = await db.query('SELECT 1 FROM library_folders WHERE id = $1', [parentId]);
      if (parent.rows.length === 0) return res.status(400).json({ message: 'Parent folder not found.' });
      if (!(await assertNoCycle(id, parentId))) {
        return res.status(400).json({ message: 'A folder cannot be moved inside itself or its own subfolders.' });
      }
    }
    if (!(await assertUniqueName(name, parentId, id, res))) return undefined;

    const row = await db.query(
      `UPDATE library_folders
          SET name = $1, parent_id = $2,
              type = COALESCE($3, type), description = COALESCE($4, description)
        WHERE id = $5
        RETURNING *`,
      [name, parentId, req.body?.type ?? null, req.body?.description ?? null, id]
    );
    const items = await db.query(
      'SELECT * FROM library_items WHERE folder_id = $1 ORDER BY position ASC, id ASC', [id]
    );
    res.json(toFolder(row.rows[0], items.rows.map(toItem)));
  } catch (err) {
    res.status(500).json({ message: 'Failed to update folder', error: err.message });
  }
};

/**
 * Delete a folder. The whole subtree goes with it: library_folders.parent_id
 * is ON DELETE CASCADE, so descendants (and their items) are removed by the
 * database rather than by a hand-written recursive delete.
 */
exports.deleteFolder = async (req, res) => {
  try {
    const id = req.params.id;
    const existing = await db.query('SELECT id FROM library_folders WHERE id = $1', [id]);
    if (existing.rows.length === 0) return res.status(404).json({ message: 'Folder not found' });

    // Report how much goes, so the UI can say "folder and N files deleted".
    const counts = await db.query(
      `WITH RECURSIVE sub AS (
         SELECT id FROM library_folders WHERE id = $1
         UNION ALL
         SELECT f.id FROM library_folders f JOIN sub s ON f.parent_id = s.id
       )
       SELECT (SELECT COUNT(*)::int FROM sub) AS folders,
              (SELECT COUNT(*)::int FROM library_items WHERE folder_id IN (SELECT id FROM sub)) AS items`,
      [id]
    );

    await db.query('DELETE FROM library_folders WHERE id = $1', [id]);
    res.json({ ok: true, deleted: counts.rows[0] });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete folder', error: err.message });
  }
};

/* ── Import of a browser's old localStorage library ─────────────────────── */

/**
 * Upload a browser's old per-machine library into the shared one.
 *
 * Any admin may run this at any time. The imported tree is placed inside a
 * fresh top-level folder named "Imported - <admin name or email>" rather than
 * being merged at the root, so it can never collide with or overwrite folders
 * other admins are already using.
 *
 * The whole import is ONE transaction: either every folder and item lands, or
 * none does. The client only clears its localStorage copy after this returns
 * success, so a failure leaves the local data intact.
 */
exports.importLibrary = async (req, res) => {
  try {
    const folders = Array.isArray(req.body?.folders) ? req.body.folders : null;
    if (!folders) return res.status(400).json({ message: 'folders array is required' });

    const who = String(req.user?.name || req.user?.email || 'admin').trim();
    const containerName = `Imported - ${who}`;
    const client = await db.pool.connect();
    const idMap = new Map(); // old id (string) -> new id (number)
    let containerId = null;
    let foldersImported = 0;
    let itemsImported = 0;
    try {
      await client.query('BEGIN');

      // The container the whole import is nested under.
      const cont = await client.query(
        `INSERT INTO library_folders (name, parent_id, type, description, position, created_by)
         VALUES ($1, NULL, 'import', $2,
                 COALESCE((SELECT MAX(position) + 1 FROM library_folders WHERE parent_id IS NULL), 0),
                 $3)
         RETURNING id`,
        [containerName, `Uploaded from a browser's local library by ${who}`, req.user.id]
      );
      containerId = cont.rows[0].id;

      // Pass 1: create every imported folder (parents before children so a
      // self-reference always resolves). Root folders of the old library hang
      // off the container.
      for (const f of folders) {
        if (!f?.name) continue;
        const row = await client.query(
          `INSERT INTO library_folders (name, parent_id, type, description, position, created_by)
           VALUES ($1, NULL, $2, $3, $4, $5) RETURNING id`,
          [String(f.name).trim(), f.type || 'general', f.description ?? null, 0, req.user.id]
        );
        idMap.set(String(f.id), row.rows[0].id);
        foldersImported++;
      }
      // Pass 2: wire parents now that every id exists. An old root folder
      // (parentId null) is attached to the container instead.
      for (const f of folders) {
        if (!f?.name) continue;
        const newId = idMap.get(String(f.id));
        if (!newId) continue;
        const newParent = f.parentId == null
          ? containerId
          : idMap.get(String(f.parentId));
        if (newParent) {
          await client.query('UPDATE library_folders SET parent_id = $1 WHERE id = $2', [newParent, newId]);
        }
      }
      // Pass 3: the entries inside each folder.
      for (const f of folders) {
        const newId = idMap.get(String(f.id));
        if (!newId || !Array.isArray(f.items)) continue;
        let pos = 0;
        for (const it of f.items) {
          if (!it?.title || !it?.notation) continue;
          await client.query(
            `INSERT INTO library_items (folder_id, title, type, notation, fen, pgn, position, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [newId, String(it.title).trim(), it.type === 'fen' ? 'fen' : 'pgn',
              String(it.notation), it.fen ?? null, it.pgn ?? null, pos++, req.user.id]
          );
          itemsImported++;
        }
      }

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    res.status(201).json({
      ok: true,
      containerId,
      containerName,
      foldersImported,
      itemsImported,
      library: await readLibrary(),
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to import library', error: err.message });
  }
};

/* ── Items ────────────────────────────────────────────────────────────── */

exports.createItem = async (req, res) => {
  try {
    const folderId = req.body?.folderId;
    if (folderId == null) return res.status(400).json({ message: 'folderId is required' });
    const folder = await db.query('SELECT id FROM library_folders WHERE id = $1', [folderId]);
    if (folder.rows.length === 0) return res.status(404).json({ message: 'Folder not found' });

    const title = String(req.body?.title || '').trim();
    if (!title) return res.status(400).json({ message: 'Title is required' });
    const notation = String(req.body?.notation || '').trim();
    if (!notation) return res.status(400).json({ message: 'Notation is required' });
    const type = req.body?.type === 'fen' ? 'fen' : 'pgn';

    const row = await db.query(
      `INSERT INTO library_items (folder_id, title, type, notation, fen, pgn, position, created_by)
       VALUES ($1, $2, $3, $4, $5, $6,
               COALESCE((SELECT MAX(position) + 1 FROM library_items WHERE folder_id = $1), 0),
               $7)
       RETURNING *`,
      [folderId, title, type, notation, req.body?.fen ?? null, req.body?.pgn ?? null, req.user.id]
    );
    res.status(201).json(toItem(row.rows[0]));
  } catch (err) {
    res.status(500).json({ message: 'Failed to create entry', error: err.message });
  }
};

/** Bulk create — used by the PGN/FEN upload, which adds many at once. */
exports.createItems = async (req, res) => {
  try {
    const folderId = req.body?.folderId;
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (folderId == null) return res.status(400).json({ message: 'folderId is required' });
    if (items.length === 0) return res.status(400).json({ message: 'No entries supplied' });

    const folder = await db.query('SELECT id FROM library_folders WHERE id = $1', [folderId]);
    if (folder.rows.length === 0) return res.status(404).json({ message: 'Folder not found' });

    // One transaction so a failed row cannot leave half an upload behind.
    const client = await db.pool.connect();
    const created = [];
    try {
      await client.query('BEGIN');
      const start = await client.query(
        'SELECT COALESCE(MAX(position) + 1, 0) AS pos FROM library_items WHERE folder_id = $1', [folderId]
      );
      let pos = start.rows[0].pos;
      for (const it of items) {
        const title = String(it?.title || '').trim();
        const notation = String(it?.notation || '').trim();
        if (!title || !notation) continue;
        const row = await client.query(
          `INSERT INTO library_items (folder_id, title, type, notation, fen, pgn, position, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
          [folderId, title, it.type === 'fen' ? 'fen' : 'pgn', notation,
            it.fen ?? null, it.pgn ?? null, pos++, req.user.id]
        );
        created.push(toItem(row.rows[0]));
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ message: 'Failed to add entries', error: err.message });
  }
};

exports.updateItem = async (req, res) => {
  try {
    const id = req.params.id;
    const existing = await db.query('SELECT * FROM library_items WHERE id = $1', [id]);
    if (existing.rows.length === 0) return res.status(404).json({ message: 'Entry not found' });
    const current = existing.rows[0];

    const row = await db.query(
      `UPDATE library_items
          SET title = COALESCE($1, title),
              notation = COALESCE($2, notation),
              fen = COALESCE($3, fen),
              pgn = COALESCE($4, pgn),
              -- folderId is only touched when the client sends it (a move).
              folder_id = COALESCE($5::int, folder_id)
        WHERE id = $6
        RETURNING *`,
      [req.body?.title ?? null, req.body?.notation ?? null, req.body?.fen ?? null,
        req.body?.pgn ?? null, req.body?.folderId ?? null, id]
    );
    res.json(toItem(row.rows[0]));
  } catch (err) {
    res.status(500).json({ message: 'Failed to update entry', error: err.message });
  }
};

exports.deleteItem = async (req, res) => {
  try {
    const del = await db.query('DELETE FROM library_items WHERE id = $1 RETURNING id', [req.params.id]);
    if (del.rows.length === 0) return res.status(404).json({ message: 'Entry not found' });
    res.json({ ok: true, id: del.rows[0].id });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete entry', error: err.message });
  }
};

/**
 * Reorder one entry by a single step, mirroring the ▲ / ▼ buttons. `dir` is
 * -1 (up) or +1 (down); the swap is done in SQL against `position` so two
 * admins reordering at once cannot interleave into a corrupt order.
 */
exports.reorderItem = async (req, res) => {
  try {
    const id = req.params.id;
    const dir = Number(req.body?.dir);
    if (dir !== -1 && dir !== 1) return res.status(400).json({ message: 'dir must be -1 or 1' });

    const item = await db.query('SELECT id, folder_id, position FROM library_items WHERE id = $1', [id]);
    if (item.rows.length === 0) return res.status(404).json({ message: 'Entry not found' });
    const { folder_id: folderId, position } = item.rows[0];

    // Down = the nearest entry below it; up = the nearest entry above it.
    const neighbour = await db.query(
      dir === 1
        ? `SELECT id, position FROM library_items
            WHERE folder_id = $1 AND position > $2
            ORDER BY position ASC LIMIT 1`
        : `SELECT id, position FROM library_items
            WHERE folder_id = $1 AND position < $2
            ORDER BY position DESC LIMIT 1`,
      [folderId, position]
    );
    // Already at that end — nothing to do.
    if (neighbour.rows.length === 0) return res.json({ ok: true, moved: false });

    const a = item.rows[0];
    const b = neighbour.rows[0];
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE library_items SET position = $1 WHERE id = $2', [b.position, a.id]);
      await client.query('UPDATE library_items SET position = $1 WHERE id = $2', [a.position, b.id]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    res.json({ ok: true, moved: true });
  } catch (err) {
    res.status(500).json({ message: 'Failed to reorder entry', error: err.message });
  }
};