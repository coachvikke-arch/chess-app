const db = require('../config/database');

/* PGN-library folders for the Puzzle Generator's save panel.
 *
 * Reads the SAME `library_folders` / `library_items` tables as the admin
 * PGN/FEN library (controllers/libraryController.js) — this is a read-only
 * tree view with subtree game counts, not a second library.
 */

/** Flat folder rows + direct item counts → nested tree with subtree totals. */
function buildTree(folders, counts) {
  const nodes = new Map();
  for (const f of folders) {
    nodes.set(f.id, {
      id: f.id,
      name: f.name,
      parentId: f.parent_id,
      gameCount: counts.get(f.id) || 0,
      children: [],
    });
  }
  const roots = [];
  for (const node of nodes.values()) {
    const parent = node.parentId != null ? nodes.get(node.parentId) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const total = (node) => {
    node.gameCount = (counts.get(node.id) || 0)
      + node.children.reduce((sum, child) => sum + total(child), 0);
    return node.gameCount;
  };
  roots.forEach(total);
  return roots;
}

exports.getFolders = async (req, res) => {
  try {
    const [folders, counts] = await Promise.all([
      db.query('SELECT id, name, parent_id FROM library_folders ORDER BY position ASC, id ASC'),
      db.query(`SELECT folder_id, COUNT(*)::int AS n FROM library_items GROUP BY folder_id`),
    ]);
    const countMap = new Map(counts.rows.map((r) => [r.folder_id, r.n]));
    res.json({ tree: buildTree(folders.rows, countMap) });
  } catch (err) {
    res.status(500).json({ message: 'Could not load the PGN library folders.', error: err.message });
  }
};

/* Creating a folder reuses the library controller verbatim, so name rules,
 * case-insensitive duplicate checks and parent validation stay in one place. */
exports.createFolder = require('./libraryController').createFolder;
