import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../services/api';
import Button from './Button';

/* Recursively find a node by id in the nested tree. */
function findNode(nodes, id) {
  for (const n of nodes) {
    if (n.id === id) return n;
    const hit = findNode(n.children || [], id);
    if (hit) return hit;
  }
  return null;
}

/* Collect every descendant id (including the node itself). */
function collectSubtree(nodes, id) {
  const out = new Set();
  const walk = (list) => {
    for (const n of list) {
      if (n.id === id || out.has(n.id)) {
        out.add(n.id);
        (n.children || []).forEach((c) => { out.add(c.id); walk([c]); });
      } else {
        walk(n.children || []);
      }
    }
  };
  walk(nodes);
  return out;
}

/* Build a nested tree from a flat [{id,name,parentId,items,…}] list. Counts
   become the subtree total of items (own + descendants). */
function buildLocalTree(folders, itemCount) {
  const nodes = new Map();
  (folders || []).forEach((f) => nodes.set(f.id, { ...f, children: [] }));
  const roots = [];
  (folders || []).forEach((f) => {
    const node = nodes.get(f.id);
    const parent = f.parentId != null ? nodes.get(f.parentId) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  });
  const count = (node) => {
    const own = itemCount ? itemCount(node) : node.items?.length || 0;
    node.setCount = own + node.children.reduce((n, c) => n + count(c), 0);
    return node.setCount;
  };
  roots.forEach(count);
  return roots;
}

const Chevron = ({ open, size = 'h-3 w-3' }) => (
  <svg viewBox="0 0 16 16" className={`shrink-0 transition-transform ${open ? 'rotate-90' : ''} ${size}`} fill="none" stroke="currentColor" strokeWidth="1.6">
    <path d="M6 3.5l5 4.5-5 4.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const FolderIcon = ({ size = 'h-3.5 w-3.5' }) => (
  <svg viewBox="0 0 20 20" className={`shrink-0 text-gold-400 ${size}`} fill="currentColor">
    <path d="M2 4.5A1.5 1.5 0 013.5 3h4.6l2 2h6.4A1.5 1.5 0 0118 6.5v9a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 012 15.5v-11z" opacity="0.9" />
  </svg>
);

/* Reusable nested folder tree.
   Server mode (default): reads/writes the puzzle-set folders via /api/folders.
   Local mode   (pass `localFolders`): reads a flat [{id,name,parentId,items,…}]
     array and mutates via `onLocalCreate/Rename/Move/Delete` callbacks, which
     return an error string (or ''/null on success). Parent re-renders with new
     data to trigger the rebuild.

   Modes:
     - 'pick'   : single-select destination (CSV import wizard). No mgmt buttons.
     - 'browse' : full management (create / rename / move / delete) + selection.
   Props:
     selectedId, onSelect(id|null), onChanged() (tree mutated), className, compact,
     localFolders, localItemCount(node), onLocalCreate, onLocalRename,
     onLocalMove, onLocalDelete
*/
export default function FolderTree({
  selectedId,
  onSelect,
  onChanged,
  className = '',
  compact = false,
  large = false,
  allowCreate = true,
  maxDepth,          // undefined = unlimited; 1 = root folders only
  localFolders,
  localItemCount,
  onLocalCreate,
  onLocalRename,
  onLocalMove,
  onLocalDelete,
}) {
  const local = Boolean(localFolders);
  const [tree, setTree] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(() => new Set());
  const [collapsed, setCollapsed] = useState(() => new Set()); // user-collapsed overrides for browsing
  const [creatingFor, setCreatingFor] = useState(null);       // 'root' | folderId | null
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [movingId, setMovingId] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);   // { id, name, setCount, deleteInner }
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    if (local) {
      setTree(buildLocalTree(localFolders, localItemCount));
      setLoading(false);
      return;
    }
    try {
      const res = await api.get('/folders/tree');
      const t = res.data?.tree ?? res.data ?? [];
      setTree(t);
    } catch (e) {
      setError(e.response?.data?.message || e.message || 'Could not load folders');
    } finally {
      setLoading(false);
    }
  }, [local, localFolders, localItemCount]);

  useEffect(() => {
    load();
  }, [load]);

  /* Auto-expand ancestors of the selection, and roots by default in pick mode. */
  useEffect(() => {
    const next = new Set(expanded);
    if (selectedId && tree.length) {
      const chain = [];
      let cur = findNode(tree, selectedId);
      // walk up: find parent of selectedId
      const ancestors = [];
      const walk = (list, trail) => {
        for (const n of list) {
          if (n.id === selectedId) { ancestors.push(...trail); return; }
          walk(n.children || [], [...trail, n.id]);
        }
      };
      walk(tree, []);
      ancestors.forEach((id) => next.add(id));
    }
    setExpanded(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, tree]);

  const isCollapsed = (id) => collapsed.has(id) && !expanded.has(id);

  const toggle = (id) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setExpanded((prev) => new Set([...prev, id]));
  };

  const createFolder = async (parentId) => {
    const name = newName.trim();
    if (!name) return;
    setBusy('creating');
    if (local) {
      const err = onLocalCreate ? onLocalCreate(parentId, name) : '';
      setNewName('');
      setCreatingFor(null);
      if (parentId != null) setCollapsed((prev) => { const n = new Set(prev); n.delete(parentId); return n; });
      onChanged?.();
      setBusy('');
      if (err) setError(err);
      else { setError(''); load(); }
      return;
    }
    try {
      await api.post('/folders', { name, parent_folder_id: parentId });
      setNewName('');
      setCreatingFor(null);
      if (parentId != null) setCollapsed((prev) => { const n = new Set(prev); n.delete(parentId); return n; });
      onChanged?.();
      await load();
    } catch (e) {
      setError(e.response?.data?.message || e.message || 'Could not create folder');
    } finally {
      setBusy('');
    }
  };

  const saveRename = async () => {
    if (!editingId) return;
    const name = editName.trim();
    if (!name) { setEditingId(null); return; }
    setBusy('renaming');
    if (local) {
      const err = onLocalRename ? onLocalRename(editingId, name) : '';
      setEditingId(null);
      onChanged?.();
      setBusy('');
      if (err) setError(err);
      else { setError(''); load(); }
      return;
    }
    try {
      await api.patch(`/folders/${editingId}`, { name });
      setEditingId(null);
      onChanged?.();
      await load();
    } catch (e) {
      setError(e.response?.data?.message || e.message || 'Could not rename folder');
    } finally {
      setBusy('');
    }
  };

  const moveFolder = async (targetId) => {
    if (movingId == null) return;
    setBusy('moving');
    if (local) {
      const err = onLocalMove ? onLocalMove(movingId, targetId) : '';
      setMovingId(null);
      onChanged?.();
      setBusy('');
      if (err) setError(err);
      else { setError(''); load(); }
      return;
    }
    try {
      await api.patch(`/folders/${movingId}/move`, { new_parent_folder_id: targetId });
      setMovingId(null);
      onChanged?.();
      await load();
    } catch (e) {
      setError(e.response?.data?.message || e.message || 'Could not move folder');
    } finally {
      setBusy('');
    }
  };

  const deleteFolder = async () => {
    if (!confirmDelete) return;
    const { id } = confirmDelete;
    setBusy('deleting');
    if (local) {
      const err = onLocalDelete ? onLocalDelete(id, { force: confirmDelete.deleteInner }) : '';
      if (err) {
        setConfirmDelete((prev) => (prev ? { ...prev, blockReason: err } : prev));
      } else {
        setConfirmDelete(null);
        onChanged?.();
        setError('');
        load();
      }
      setBusy('');
      return;
    }
    try {
      await api.delete(`/folders/${id}`, { params: { force: confirmDelete.deleteInner ? true : '' } });
      setConfirmDelete(null);
      onChanged?.();
      await load();
    } catch (e) {
      const msg = e.response?.data?.message || e.message || 'Could not delete folder';
      if (e.response?.status === 409) {
        setConfirmDelete((prev) => (prev ? { ...prev, blockReason: msg } : prev));
      } else {
        setError(msg);
      }
    } finally {
      setBusy('');
    }
  };

  // For move-target mode, disallow dropping into a descendant of the source.
  const disabledTargets = useMemo(
    () => (movingId != null ? collectSubtree(tree, movingId) : new Set()),
    [tree, movingId]
  );

  const renderNode = (node, depth) => {
    const kids = node.children || [];
    const open = !isCollapsed(node.id);
    const isSelected = selectedId === node.id;
    const isMoveTarget = movingId != null;
    const targetDisabled = isMoveTarget && disabledTargets.has(node.id);
    const isEditing = editingId === node.id;
    const isMoving = movingId === node.id;

    return (
      <div key={node.id}>
        <div
          className={`group flex items-center transition ${large ? 'gap-2.5 rounded-xl px-3 py-3 text-base' : 'gap-1 rounded-md px-1.5 text-sm'
            } ${isSelected && !isMoving ? 'bg-gold-700/25 text-gold-500' : isMoving ? 'bg-gold-500/15 text-gold-500' : 'text-ivory-300 hover:bg-black/[0.06]'
            } ${targetDisabled ? 'opacity-35 cursor-not-allowed' : 'cursor-pointer'}`}
          style={{ paddingLeft: `${depth * 1.1 + 0.4}rem` }}
          onClick={() => {
            if (isMoveTarget) { if (!targetDisabled) moveFolder(node.id); return; }
            toggle(node.id);
            onSelect?.(node.id);
          }}
          title={isSelected ? 'Selected' : isMoving ? isMoveTarget ? 'Not available (inside this folder)' : 'Drop here' : node.name}
        >
          <span className={`${kids.length && (maxDepth == null || depth + 1 < maxDepth) ? 'text-ivory-500' : 'opacity-0'} flex items-center`}>
            <Chevron open={open && !isCollapsed(node.id)} size={large ? 'h-4 w-4' : 'h-3 w-3'} />
          </span>
          <FolderIcon size={large ? 'h-5 w-5' : 'h-3.5 w-3.5'} />
          {isEditing ? (
            <input
              autoFocus
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => { if (e.key === 'Enter') saveRename(); if (e.key === 'Escape') setEditingId(null); }}
              className={`min-w-0 rounded border border-gold-500/50 bg-ink-900 outline-none ${large ? 'w-40 px-2.5 py-1.5 text-base' : 'w-28 px-1 py-0.5 text-xs'
                }`}
            />
          ) : (
            <span className="min-w-0 flex-1 truncate">{node.name}</span>
          )}
          <span className={`hidden xs:inline text-ivory-500 ${large ? 'text-sm' : 'text-[0.65rem]'}`}>{node.setCount ?? 0}</span>
          <span className={`ml-auto flex items-center ${large ? 'gap-1' : 'gap-0.5'} opacity-0 group-hover:opacity-100`}>
            {isMoving ? (
              <>
                <button
                  title="Cancel move"
                  onClick={(e) => { e.stopPropagation(); setMovingId(null); }}
                  className={`rounded text-ivory-400 hover:bg-black/5 hover:text-ivory-300 ${large ? 'px-2.5 py-1.5 text-base' : 'px-1.5 py-0.5 text-xs'}`}
                >
                  ✕
                </button>
                <button
                  title="Move to top level"
                  onClick={(e) => { e.stopPropagation(); moveFolder(null); }}
                  className={`rounded text-gold-400 hover:bg-gold-700/20 ${large ? 'px-2.5 py-1.5 text-sm' : 'px-1.5 py-0.5 text-[0.65rem]'}`}
                >
                  top
                </button>
              </>
            ) : (
              <>
                {allowCreate && (
                  <button
                    title="New subfolder"
                    onClick={(e) => { e.stopPropagation(); setCreatingFor(node.id); setNewName(''); }}
                    className={`rounded text-ivory-500 hover:bg-black/5 hover:text-emerald-600 ${large ? 'px-2.5 py-1 text-base' : 'px-1.5 py-0.5 text-xs'}`}
                  >
                    +
                  </button>
                )}
                {!compact && (
                  <>
                    <button
                      title="Rename folder"
                      onClick={(e) => { e.stopPropagation(); setEditingId(node.id); setEditName(node.name); }}
                      className={`rounded text-ivory-500 hover:bg-black/5 hover:text-gold-400 ${large ? 'px-2.5 py-1 text-base' : 'px-1.5 py-0.5 text-xs'}`}
                    >
                      ✎
                    </button>
                    <button
                      title="Move folder"
                      onClick={(e) => { e.stopPropagation(); setMovingId(node.id); }}
                      className={`rounded text-ivory-500 hover:bg-black/5 hover:text-gold-400 ${large ? 'px-2.5 py-1 text-base' : 'px-1.5 py-0.5 text-xs'}`}
                    >
                      ⇄
                    </button>
                    <button
                      title="Delete folder"
                      onClick={(e) => { e.stopPropagation(); setConfirmDelete({ id: node.id, name: node.name, setCount: node.setCount ?? 0, deleteInner: false, blockReason: '' }); }}
                      className={`rounded text-ivory-500 hover:bg-black/5 hover:text-red-600 ${large ? 'px-2.5 py-1 text-base' : 'px-1.5 py-0.5 text-xs'}`}
                    >
                      🗑
                    </button>
                  </>
                )}
              </>
            )}
          </span>
        </div>

        {isMoveTarget && !targetDisabled && (
          <div className="ml-7 text-[0.6rem] text-gold-500/80 select-none pointer-events-none">⇩ move here</div>
        )}

        {(open || isMoveTarget) && kids.length > 0 && (maxDepth == null || depth + 1 < maxDepth) && (
          <div className={open ? '' : 'hidden'}>
            {kids.map((c) => renderNode(c, depth + 1))}
          </div>
        )}

        {creatingFor === node.id && (
          <div className="flex items-center gap-1 pl-[2.2rem] pr-1" style={{ paddingLeft: `${depth * 1.1 + 1.9}rem` }}>
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') createFolder(node.id); if (e.key === 'Escape') setCreatingFor(null); }}
              placeholder="New subfolder name"
              className={`w-full rounded border border-gold-500/40 bg-ink-900 text-ivory-300 outline-none placeholder:text-ivory-500 ${large ? 'px-3 py-2 text-base' : 'px-2 py-1 text-xs'}`}
            />
            <Button variant="primary" size="sm" disabled={!newName.trim() || busy === 'creating'} onClick={() => createFolder(node.id)}>Add</Button>
            <Button variant="ghost" size="sm" onClick={() => setCreatingFor(null)} aria-label="Cancel">✕</Button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={`rounded-xl border border-ivory-700/50 bg-black/[0.02] p-2 ${className}`}>
      <div className="flex items-center justify-between px-1.5 pb-1.5">
        <p className={`font-semibold uppercase tracking-wider text-ivory-500 ${large ? 'text-sm px-1 py-1' : 'text-[0.65rem]'}`}>Folders</p>
        {allowCreate && (
          <Button
            variant="secondary"
            size="sm"
            title="New top-level folder"
            onClick={() => setCreatingFor('root')}
          >
            + New
          </Button>
        )}
      </div>

      {loading && <p className="px-2 py-3 text-xs text-ivory-500 animate-pulse">Loading folders…</p>}
      {error && <p className="px-2 py-3 text-xs text-red-600">{error}</p>}

      {!loading && !error && (
        tree.length === 0 ? (
          <div className="px-2 py-3">
            <p className={`${large ? 'text-sm text-ivory-300' : 'text-xs'} text-ivory-500`}>No folders yet{allowCreate ? ' — create one to organise sets.' : '.'}</p>
            {allowCreate && (
              <Button
                variant="secondary"
                size="sm"
                fullWidth
                className="mt-2"
                onClick={() => setCreatingFor('root')}
              >
                + New top-level folder
              </Button>
            )}
          </div>
        ) : (
          <div className={large ? 'space-y-1' : 'space-y-0.5'}>
            {tree.map((n) => renderNode(n, 0))}

            {/* "No folder" (root) actions for pick mode */}
            {allowCreate && creatingFor === 'root' && (
              <div className={`flex items-center ${large ? 'gap-1.5 pl-2 pr-1 py-1' : 'gap-1 pl-2 pr-1'}`}>
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') createFolder(null); if (e.key === 'Escape') setCreatingFor(null); }}
                  placeholder="New folder name"
                  className={`w-full rounded border border-gold-500/40 bg-ink-900 text-ivory-300 outline-none placeholder:text-ivory-500 ${large ? 'px-3 py-2 text-base' : 'px-2 py-1 text-xs'}`}
                />
                <Button variant="primary" size="sm" disabled={!newName.trim() || busy === 'creating'} onClick={() => createFolder(null)}>Add</Button>
                <Button variant="ghost" size="sm" onClick={() => setCreatingFor(null)} aria-label="Cancel">✕</Button>
              </div>
            )}
          </div>
        )
      )}

      {/* Move hint bar */}
      {movingId != null && (
        <div className="mt-2 rounded-lg border border-gold-500/30 bg-gold-500/10 px-2 py-1.5 text-xs text-gold-500">
          Click a folder to move there · press ✕ to cancel
        </div>
      )}

      {/* Delete confirm dialog (safe default: block when non-empty; force opt-in) */}
      {confirmDelete && (
        <div className="fixed inset-0 z-[var(--z-modal-backdrop)] grid place-items-center bg-black/60 p-4" onClick={() => setConfirmDelete(null)}>
          <div className="w-[min(92vw,30rem)] rounded-2xl border border-ivory-700/50 bg-ink-800 p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-ivory-300">Delete folder “{confirmDelete.name}”?</h3>
            {confirmDelete.blockReason && (
              <p className="mt-2 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600">
                {confirmDelete.blockReason}
              </p>
            )}
            <p className="mt-2 text-xs text-ivory-500">
              {confirmDelete.setCount > 0
                ? `This folder contains ${confirmDelete.setCount} item(s) — deleting is blocked unless you also delete everything inside.`
                : 'This folder is empty and can be removed.'}
            </p>
            <label className="mt-3 flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={confirmDelete.deleteInner}
                onChange={(e) => setConfirmDelete((prev) => ({ ...prev, deleteInner: e.target.checked }))}
                className="accent-[#93c5fd]"
              />
              <span className="text-xs text-ivory-300">Force-delete everything inside (subfolders + their contents)</span>
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setConfirmDelete(null)}>Cancel</Button>
              <Button
                variant="danger"
                size="sm"
                disabled={busy === 'deleting' || (confirmDelete.blockReason && !confirmDelete.deleteInner)}
                onClick={deleteFolder}
              >
                {confirmDelete.deleteInner || !confirmDelete.blockReason ? 'Delete' : 'Cannot delete yet'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}