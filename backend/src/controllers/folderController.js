/* Nested folder tree for puzzle sets — unlimited depth.
   The `set_folders` table is self-referencing (parent_folder_id → itself), so
   a folder can live at any depth. Sets attach to ANY folder via sets.folder_id.

   Endpoints (mounted at /api/folders):
     GET    /tree                     full nested tree [{ id, name, children, setCount }]
     GET    /:id/sets                 sets directly inside one folder (lazy-load for browse)
     POST   /                         create folder  { name, parent_folder_id? }
     PATCH  /:id                       rename folder  { name }
     PATCH  /:id/move                  move folder    { new_parent_folder_id } (circular-ref guarded)
     DELETE /:id?force=1|true          delete folder (blocks if non-empty; force cascades)
*/

const db = require('../config/database');
const { pool } = require('../config/database');

/* Load every folder (flat) with its direct set + child counts, then build the
   nested tree recursively in JS. Folder counts are small (tens/hundreds), so a
   single flat query + in-memory assembly is faster and simpler than recursive CTEs. */
async function loadFolderRows() {
  const { rows } = await db.query(
    `SELECT f.id, f.name, f.parent_folder_id, f.sort_order,
            (SELECT COUNT(*)::int FROM sets s WHERE s.folder_id = f.id) AS set_count,
            (SELECT COUNT(*)::int FROM set_folders c WHERE c.parent_folder_id = f.id) AS child_count
     FROM set_folders f
     ORDER BY f.sort_order ASC, f.name ASC, f.id ASC`
  );
  return rows;
}

/* Build the nested tree from flat rows. Returns the array of root nodes. */
function buildTree(rows) {
  const byId = new Map(rows.map((r) => [r.id, { id: r.id, name: r.name, parentId: r.parent_folder_id, setCount: r.set_count, childCount: r.child_count, children: [] }]));
  const roots = [];
  for (const node of byId.values()) {
    if (node.parentId != null && byId.has(node.parentId)) {
      byId.get(node.parentId).children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

/* Recursively prune ids not matching `pred` (used for move previews). */
function pruneTree(nodes, pred) {
  const out = [];
  for (const n of nodes) {
    const keptKids = pruneTree(n.children, pred);
    if (pred(n) || keptKids.length) {
      out.push({ ...n, children: keptKids });
    }
  }
  return out;
}

/* Export-shaped node: strips internal fields and keeps { id, name, children, setCount }. */
function serialize(nodes) {
  return nodes.map((n) => ({
    id: n.id,
    name: n.name,
    setCount: n.setCount || 0,
    children: serialize(n.children),
  }));
}

/* Walk up from `folderId`'s parent collecting the full ancestor chain (ids).
   Used to reject circular moves: moving a folder into one of its own
   descendants would make it its own ancestor. */
async function ancestorChain(folderId) {
  const chain = [];
  let cur = folderId;
  while (cur != null) {
    chain.push(Number(cur));
    const { rows } = await db.query('SELECT parent_folder_id FROM set_folders WHERE id = $1', [cur]);
    cur = rows[0]?.parent_folder_id ?? null;
  }
  return chain;
}

/* Verify a parent_folder_id (if given) resolves. Returns normalized id or null. */
async function resolveParent(rawParent, { allowNull = true } = {}) {
  if (rawParent == null || rawParent === '' ) return allowNull ? null : null;
  const id = Number(rawParent);
  if (!Number.isInteger(id) || id <= 0) return null;
  const { rows } = await db.query('SELECT id FROM set_folders WHERE id = $1', [id]);
  return rows.length ? id : null;
}

/* ── GET /api/folders/tree ─────────────────────────────────────── */
exports.getFolderTree = async (_req, res) => {
  try {
    const rows = await loadFolderRows();
    res.json({ tree: serialize(buildTree(rows)), total: rows.length });
  } catch (err) {
    res.status(500).json({ message: 'Failed to load folder tree', error: err.message });
  }
};

/* ── GET /api/folders/:id/sets ───────────────────────────────────
   Lazy-load the sets directly inside one folder (browse view). */
exports.getFolderSets = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ message: 'Invalid folder id' });
    const { rows } = await db.query(
      `SELECT s.code AS set_code, s.name AS set_name, s.type_tag,
              (SELECT COUNT(*)::int FROM puzzles p WHERE p.set_code = s.code) AS puzzle_count,
              s.updated_at
       FROM sets s
       WHERE s.folder_id = $1
       ORDER BY s.name ASC, s.id ASC`,
      [id]
    );
    res.json({ folder_id: id, sets: rows });
  } catch (err) {
    res.status(500).json({ message: 'Failed to load sets in folder', error: err.message });
  }
};

/* ── POST /api/folders ─────────────────────────────────────────── */
exports.createFolder = async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ message: 'Folder name is required' });
    if (name.length > 200) return res.status(400).json({ message: 'Folder name must be at most 200 characters' });

    const parentId = await resolveParent(req.body.parent_folder_id);
    if (req.body.parent_folder_id != null && req.body.parent_folder_id !== '' && parentId == null) {
      return res.status(400).json({ message: 'Parent folder does not exist' });
    }
    if (parentId != null && parentId === req.user?.id) {
      return res.status(400).json({ message: 'Cannot nest a folder inside itself' });
    }

    // sort_order = max sibling order + 1 (siblings share the same parent)
    const orderRes = await db.query(
      `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order
       FROM set_folders WHERE parent_folder_id IS NOT DISTINCT FROM $1`,
      [parentId]
    );
    const sortOrder = orderRes.rows[0]?.next_order ?? 0;

    const { rows } = await db.query(
      `INSERT INTO set_folders (name, parent_folder_id, created_by, sort_order)
       VALUES ($1, $2, $3, $4) RETURNING id, name, parent_folder_id, sort_order, created_at`,
      [name, parentId, req.user?.id || null, sortOrder]
    );
    res.status(201).json({ folder: rows[0] });
  } catch (err) {
    res.status(500).json({ message: 'Failed to create folder', error: err.message });
  }
};

/* ── PATCH /api/folders/:id ── rename ──────────────────────────── */
exports.renameFolder = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ message: 'Invalid folder id' });
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ message: 'Folder name is required' });
    if (name.length > 200) return res.status(400).json({ message: 'Folder name must be at most 200 characters' });

    const { rows } = await db.query(
      `UPDATE set_folders SET name = $1 WHERE id = $2 RETURNING id, name, parent_folder_id, sort_order`,
      [name, id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Folder not found' });
    res.json({ folder: rows[0] });
  } catch (err) {
    res.status(500).json({ message: 'Failed to rename folder', error: err.message });
  }
};

/* ── PATCH /api/folders/:id/move ─────────────────────────────────
   Move a folder (and everything inside it) under a new parent.
   CIRCULAR-REFERENCE GUARD: the folder being moved is rejected if it appears
   anywhere in the NEW parent's ancestry — moving a folder into its own
   descendant would corrupt the tree. */
exports.moveFolder = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ message: 'Invalid folder id' });

    const folderRes = await db.query('SELECT id, name FROM set_folders WHERE id = $1', [id]);
    if (!folderRes.rows.length) return res.status(404).json({ message: 'Folder not found' });

    const newParent = await resolveParent(req.body.new_parent_folder_id);
    if (req.body.new_parent_folder_id != null && req.body.new_parent_folder_id !== '' && newParent == null) {
      return res.status(400).json({ message: 'New parent folder does not exist' });
    }

    // Root folders: new_parent null means "make it a top-level folder" — fine.
    if (newParent === id) return res.status(400).json({ message: 'Cannot move a folder into itself' });

    // Walk up the new parent's ancestry — if `id` is anywhere in it, the folder
    // would end up inside one of its own descendants.
    const chain = await ancestorChain(newParent);
    if (chain.includes(id)) {
      return res.status(400).json({ message: 'Cannot move a folder into one of its own subfolders' });
    }

    const { rows } = await db.query(
      `UPDATE set_folders SET parent_folder_id = $1 WHERE id = $2 RETURNING id, name, parent_folder_id`,
      [newParent, id]
    );
    res.json({ folder: rows[0], ok: true });
  } catch (err) {
    res.status(500).json({ message: 'Failed to move folder', error: err.message });
  }
};

/* ── DELETE /api/folders/:id?force=1 ─────────────────────────────
   Option B (safer default): BLOCK deletion when the folder still has child
   folders or sets. Passing force=true cascades: it recursively deletes every
   descendant folder and every set inside (each set's puzzles too, matching the
   existing deleteSet behaviour). */
exports.deleteFolder = async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ message: 'Invalid folder id' });

  const force = ['1', 'true', 'yes'].includes(String(req.query.force || '').toLowerCase());

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const folderRes = await client.query('SELECT id, name FROM set_folders WHERE id = $1', [id]);
    if (!folderRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Folder not found' });
    }
    const folderName = folderRes.rows[0].name;

    // Collect all descendant folder ids (self + every child, recursively).
    const allIds = new Set([id]);
    let frontier = [id];
    while (frontier.length) {
      const { rows } = await client.query(
        'SELECT id FROM set_folders WHERE parent_folder_id = ANY($1::int[])',
        [frontier]
      );
      frontier = rows.map((r) => r.id).filter((fid) => !allIds.has(fid));
      frontier.forEach((fid) => allIds.add(fid));
    }
    const idArr = [...allIds];

    // Count what lives inside (direct children + direct sets) for the block message.
    const childRes = await client.query(
      'SELECT COUNT(*)::int AS n FROM set_folders WHERE parent_folder_id = ANY($1::int[])',
      [idArr]
    );
    const setRes = await client.query(
      'SELECT COUNT(*)::int AS n, COALESCE(SUM((SELECT COUNT(*)::int FROM puzzles p WHERE p.set_code = s.code)), 0)::int AS puzzles FROM sets s WHERE s.folder_id = ANY($1::int[])',
      [idArr]
    );
    const childCount = childRes.rows[0]?.n ?? 0;
    const setCount = setRes.rows[0]?.n ?? 0;
    const puzzleCount = setRes.rows[0]?.puzzles ?? 0;

    if (!force && (childCount > 0 || setCount > 0)) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        message: `Folder "${folderName}" is not empty — it contains ${childCount} subfolder${childCount === 1 ? '' : 's'} and ${setCount} set${setCount === 1 ? '' : 's'} (${puzzleCount} puzzles). Move or delete them first, or force-delete everything inside.`,
        empty: false,
        childCount,
        setCount,
        puzzleCount,
      });
    }

    // Cascade: delete every set inside (and its puzzles) before the folders.
    const { rows: setCodes } = await client.query(
      'SELECT code FROM sets WHERE folder_id = ANY($1::int[])',
      [idArr]
    );
    if (setCodes.length) {
      await client.query('DELETE FROM puzzles WHERE set_code = ANY($1::text[])', [setCodes.map((r) => r.code)]);
      await client.query('DELETE FROM sets WHERE folder_id = ANY($1::int[])', [idArr]);
    }
    await client.query('DELETE FROM set_folders WHERE id = ANY($1::int[])', [idArr]);
    await client.query('COMMIT');

    res.json({
      message: `Folder "${folderName}" deleted${force ? ' (everything inside erased)' : ''}`,
      deleted_folder_id: id,
      subfolders_deleted: idArr.length - 1,
      sets_deleted: setCount,
      puzzles_deleted: puzzleCount,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ message: 'Failed to delete folder', error: err.message });
  } finally {
    client.release();
  }
};