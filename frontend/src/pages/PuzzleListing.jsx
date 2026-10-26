import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../services/api';
import { PageHeader, Spinner } from '../components/ui';
import Button from '../components/Button';
import PuzzleCard from '../components/PuzzleCard';
import AssignModal from '../components/AssignModal';
import FolderTree from '../components/FolderTree';
import { usePuzzleSelection, togglePuzzle, addPuzzles, deselectAll, clearSelection, MAX_SELECT } from '../stores/puzzleSelection';

const PER_PAGE_OPTIONS = [10, 25, 50, 100];
const DEFAULT_PER_PAGE = 25;

/* Ellipsis pager: returns entries like [1, '…', 5, 6, 7, '…', 46]. */
function pager(current, total, radius = 1) {
  const nums = [
    ...new Set([1, total, ...Array.from({ length: radius * 2 + 1 }, (_, i) => current - radius + i)]),
  ]
    .filter((n) => n >= 1 && n <= total)
    .sort((a, b) => a - b);
  const out = [];
  let prev = null;
  for (const n of nums) {
    if (prev != null && n - prev > 1) out.push('…');
    out.push(n);
    prev = n;
  }
  return out;
}

/* MODULE LEVEL ON PURPOSE. This was declared inside PuzzleListing's render body,
 * which made it a new function identity - and so a new component TYPE to React -
 * on every render. React reconciles a changed type by unmounting the old subtree
 * and mounting a new one, so every chip in the rail was rebuilt on every render,
 * including the render caused by picking a set. That is what made the strip look
 * like it refreshed and snapped its horizontal scroll back to the start.
 *
 * memo'd as well: the rail is handed the active code, the deleting code and
 * three stable callbacks, so a puzzle page, a search box or a toast changing
 * does not re-render a single chip. The key is always `set_code`, never the
 * index. */
const SetChip = memo(function SetChip({ set, active, deleting, onSelect, onRename, onDelete }) {
  const frame = active
    ? 'border-gold-500 bg-gold-500/20 shadow-[0_0_14px_rgba(96,165,250,0.18)]'
    : 'border-ink-200 bg-white/70 hover:border-ink-300 hover:bg-ink-100';
  return (
    <div className={`max-w-[10rem] shrink-0 flex items-stretch rounded-lg border transition ${frame}`}>
      <button
        type="button"
        title={`${set.set_name} · ${set.puzzle_count} puzzles`}
        onClick={() => onSelect(set)}
        className="min-w-0 flex-1 px-2.5 py-1.5 text-xs font-bold text-black transition"
      >
        <span className="block truncate">{set.set_name}</span>
      </button>
      <button
        type="button"
        title={`Rename ${set.set_name}`}
        aria-label={`Rename ${set.set_name}`}
        onClick={() => onRename(set)}
        className="px-1.5 py-1.5 text-xs font-bold text-black hover:text-gray-500 transition"
      >
        ✎
      </button>
      <button
        type="button"
        title={`Delete ${set.set_name}`}
        aria-label={`Delete ${set.set_name}`}
        disabled={deleting}
        onClick={() => onDelete(set)}
        className={`px-1.5 py-1.5 text-xs font-bold transition ${
          deleting ? 'text-gray-300 cursor-not-allowed' : 'text-black hover:text-red-600'
        }`}
      >
        {deleting ? '…' : '🗑'}
      </button>
    </div>
  );
});

export default function PuzzleListing() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [sets, setSets] = useState([]);
  const [setsError, setSetsError] = useState('');
  const [puzzles, setPuzzles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const selected = usePuzzleSelection();
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const [setFilter, setSetFilter] = useState(''); // filters the set-name chips
  const [folderFilter, setFolderFilter] = useState('all'); // 'all' | 'unfiled' | folder id (number)
  const [folderBrowserOpen, setFolderBrowserOpen] = useState(false);
  const [folderTreeKey, setFolderTreeKey] = useState(0);
  const [assignOpen, setAssignOpen] = useState(false);
  const [applyToAllAssign, setApplyToAllAssign] = useState(true);
  const [toast, setToast] = useState('');
  const [renaming, setRenaming] = useState(null); // { set_code, set_name }
  const [nameInput, setNameInput] = useState('');
  const [renameErr, setRenameErr] = useState('');
  const [deletingSet, setDeletingSet] = useState(null); // set_code being deleted
  const [refreshKey, setRefreshKey] = useState(0);
  const lastIdxRef = useRef(null);
  const toastTimerRef = useRef(null);

  useEffect(() => () => clearTimeout(toastTimerRef.current), []);

  const rawSet = searchParams.get('set');
  const perPageRaw = Number(searchParams.get('perPage')) || DEFAULT_PER_PAGE;
  const perPage = PER_PAGE_OPTIONS.includes(perPageRaw) ? perPageRaw : DEFAULT_PER_PAGE;
  const pageFromUrl = Math.max(1, Number(searchParams.get('page')) || 1);
  // "All puzzles" is the landing view: across is active when the URL says so
  // (across=1) OR when no specific set is requested at all.
  const across = searchParams.get('across') === '1' || !searchParams.get('set');

  const currentSet = sets.find((s) => s.set_code === rawSet) || sets[0] || null;
  const setCode = currentSet?.set_code ?? null;
  const setIndex = sets.findIndex((s) => s.set_code === setCode);
  const page = Math.min(pageFromUrl, Math.max(1, totalPages));

  /* Folder-based filtering. `folderTree` is loaded with the sets (below); when a
     folder filter is active we gather the selected folder's subtree ids and keep
     only sets whose folder_id lands in that subtree. */
  const [folderTree, setFolderTree] = useState(null);
  const folderDescendantIds = useMemo(() => {
    if (!folderTree || typeof folderFilter === 'string' || folderFilter == null) return null;
    const out = new Set();
    const walk = (nodes) => {
      for (const n of nodes) {
        if (n.id === folderFilter || out.has(n.id)) {
          out.add(n.id);
          walk(n.children || []);
        } else {
          walk(n.children || []);
        }
      }
    };
    walk(Array.isArray(folderTree) ? folderTree : folderTree.tree || []);
    return out;
  }, [folderTree, folderFilter]);

  const folderSetIds = (() => {
    if (folderFilter === 'all') return null;
    if (folderFilter === 'unfiled') {
      return new Set(sets.filter((s) => s.folder_id == null).map((s) => s.set_code));
    }
    return new Set(sets.filter((s) => s.folder_id != null && folderDescendantIds?.has(s.folder_id)).map((s) => s.set_code));
  })();

  const setFilterText = setFilter.trim().toLowerCase();
  const filteredSets = useMemo(() => {
    let list = setFilterText ? sets.filter((s) => s.set_name.toLowerCase().includes(setFilterText)) : sets;
    if (folderSetIds) list = list.filter((s) => folderSetIds.has(s.set_code));
    return list;
  }, [sets, folderSetIds, setFilterText]);

  /* Flattened folder options ("<name>" with indentation) for the filter dropdown. */
  const folderOptions = useMemo(() => {
    const out = [];
    const walk = (nodes, depth) => {
      for (const n of nodes) {
        out.push({ id: n.id, label: `${'\u00a0\u00a0'.repeat(depth)}${n.name}`, setCount: n.setCount || 0 });
        walk(n.children || [], depth + 1);
      }
    };
    walk(Array.isArray(folderTree) ? folderTree : folderTree?.tree || [], 0);
    return out;
  }, [folderTree]);

  const activeFolderLabel =
    folderFilter === 'all'
      ? 'All folders'
      : folderFilter === 'unfiled'
        ? 'Unfiled sets'
        : folderOptions.find((f) => f.id === folderFilter)?.label?.trim() || 'Folder';

  /* Nav-chip pagination operates on the folder-filtered list. */
  const chipIndex = filteredSets.findIndex((s) => s.set_code === setCode);

  function showToast(msg) {
    setToast(msg);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(''), 3500);
  }

  // Load set metadata (set_code, set_name, puzzle_count) for the nav bar.
  useEffect(() => {
    api
      .get('/puzzles/sets')
      .then((res) => {
        const data = res.data?.data ?? res.data ?? {};
        setSets(data.sets || []);
      })
      .catch((e) => setSetsError(e.response?.data?.message || e.message || 'Failed to load puzzle sets'))
      .finally(() => {});
    refreshFolderTree();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshFolderTree = () => {
    api
      .get('/folders/tree')
      .then((res) => {
        const data = res.data?.tree ?? res.data ?? [];
        setFolderTree(Array.isArray(data) ? data : data.tree || []);
      })
      .catch(() => {});
  };

  // Reset selections whenever the active set changes.
  useEffect(() => {
    if (!across) {
      clearSelection();
      lastIdxRef.current = null;
    }
  }, [setCode, across]);

  // When a folder filter is applied and the current set is not part of it, hop
  // to the first matching set (or the combined "All" view when nothing matches).
  useEffect(() => {
    if (folderFilter === 'all') return;
    if (across) return;
    if (filteredSets.length && filteredSets.some((s) => s.set_code === setCode)) return;
    if (filteredSets.length) go({ set: filteredSets[0].set_code, page: 1 });
    else go({ all: true, page: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderFilter, sets.length]);

  // Fetch puzzles for the active set (or the combined "All" view).
  useEffect(() => {
    if (!setCode && !across) return;
    setLoading(true);
    setError('');
    const params = { page: pageFromUrl, pageSize: perPage };
    let req;
    if (across) {
      req = api.get('/puzzles/search', { params });
    } else {
      req = api.get(`/puzzles/sets/${setCode}`, { params });
    }
    req
      .then((res) => {
        const data = res.data?.data ?? res.data ?? {};
        setPuzzles(data.puzzles || []);
        setTotal(data.total || 0);
        const pages = data.totalPages || 1;
        setTotalPages(pages);
        if (pageFromUrl > pages) {
          // Clamp: current page no longer exists after a size change.
          const sp = new URLSearchParams();
          if (setCode) sp.set('set', setCode);
          sp.set('page', '1');
          sp.set('perPage', String(perPage));
          if (across) sp.set('across', '1');
          setSearchParams(sp, { replace: true });
        }
      })
      .catch((e) => setError(e.response?.data?.message || e.message || 'Failed to load puzzles'))
      .finally(() => setLoading(false));
  }, [setCode, pageFromUrl, perPage, across, refreshKey, setSearchParams]);

  // go() pushes a real history entry so the global Back button can step
  // back through sets/pages/search states one at a time.
  //   next.all  → leave any set and open the combined "All" view
  //   next.set  → explicit set target, which exits the "All" view
  const go = (next) => {
    const sp = new URLSearchParams();
    const sel = next.all ? null : next.set ?? setCode;
    if (sel) sp.set('set', sel);
    sp.set('page', String(next.page ?? 1));
    sp.set('perPage', String(next.perPage ?? perPage));
    if (next.all) {
      sp.set('across', '1');
    } else if (next.set) {
      // explicit set → leave the combined "All" view
    } else if (across) {
      sp.set('across', '1');
    }
    setSearchParams(sp);
  };
  const goBy = (delta) => {
    if (filteredSets.length === 0 || across) return;
    let idx = filteredSets.findIndex((s) => s.set_code === setCode);
    if (idx < 0) idx = 0;
    const next = (idx + delta + filteredSets.length) % filteredSets.length;
    go({ set: filteredSets[next].set_code, page: 1 });
  };

  const openRename = (set) => {
    setRenaming(set);
    setNameInput(set.set_name);
    setRenameErr('');
  };

  const saveRename = () => {
    if (!renaming) return;
    const name = nameInput.trim();
    if (!name) return;
    api
      .patch(`/puzzles/sets/${renaming.set_code}`, { name })
      .then((res) => {
        const updated = res.data?.set ?? res.data;
        setSets((prev) =>
          prev.map((s) => (s.set_code === updated.set_code ? { ...s, set_name: updated.set_name } : s))
        );
        setRenaming(null);
        setRenameErr('');
        setRefreshKey((k) => k + 1); // titles are server-derived → refetch cards
        showToast(
          `Set renamed to "${updated.set_name}"` +
            (res.data?.puzzlesRenamed
              ? ` — ${res.data.puzzlesRenamed} puzzle title${res.data.puzzlesRenamed === 1 ? '' : 's'} updated`
              : '')
        );
      })
      .catch((e) => setRenameErr(e.response?.data?.message || e.message || 'Failed to rename set'));
  };

  const deleteSet = async (set) => {
    if (!window.confirm(
      `Delete "${set.set_name}"?\n\nThis will permanently remove all ${set.puzzle_count} puzzle${set.puzzle_count === 1 ? '' : 's'} in this set. This cannot be undone.`
    )) return;

    setDeletingSet(set.set_code);
    try {
      const res = await api.delete(`/puzzles/sets/${set.set_code}`);
      setSets((prev) => prev.filter((s) => s.set_code !== set.set_code));
      if (setCode === set.set_code) {
        const remaining = sets.filter((s) => s.set_code !== set.set_code);
        if (remaining.length > 0) go({ set: remaining[0].set_code, page: 1 });
        else go({ all: true, page: 1 });
      }
      showToast(res.data?.message || 'Set deleted');
    } catch (e) {
      showToast(`Failed to delete set: ${e.response?.data?.message || e.message}`);
    } finally {
      setDeletingSet(null);
    }
  };

  const toggleCard = (id, idx, ev) => {
    if (ev?.shiftKey && lastIdxRef.current != null) {
      const [a, b] = [Math.min(lastIdxRef.current, idx), Math.max(lastIdxRef.current, idx)];
      const ids = [];
      for (let i = a; i <= b; i++) ids.push(puzzles[i].id);
      const { added, blocked } = addPuzzles(ids);
      if (blocked > 0) {
        showToast(
          added > 0
            ? `Selection limit of ${MAX_SELECT} reached — ${added} selected, ${blocked} dropped.`
            : `Selection limit of ${MAX_SELECT} reached — no more puzzles can be selected.`
        );
      }
    } else {
      const result = togglePuzzle(id);
      if (result === 'limit') {
        showToast(`Selection limit of ${MAX_SELECT} reached — deselect something first.`);
      }
    }
    lastIdxRef.current = idx;
  };

  const handleAssigned = (res) => {
    setAssignOpen(false);
    showToast(res?.message || 'Assigned.');
    clearSelection();
    lastIdxRef.current = null;
  };

  const rangeStart = puzzles.length ? (page - 1) * perPage + 1 : 0;
  const rangeEnd = (page - 1) * perPage + puzzles.length;
  const totalPuzzles = sets.reduce((sum, s) => sum + s.puzzle_count, 0);

  /* ── The chip rail must survive a selection ────────────────────────────────
   * Picking a set writes the query string, which re-renders this page and
   * refetches the puzzle grid. That is fine and expected - but the rail itself
   * must not move: its horizontal offset is captured before the change and
   * reapplied afterwards, so a set far to the right of the strip stays where the
   * reader left it instead of snapping back to the first chip. */
  const setStripRef = useRef(null);
  const savedStripScroll = useRef(0);

  /* Stable identities. SetChip is memo'd, so an inline arrow here would defeat
   * the memo on every render and re-render all ~40 chips each time. */
  const goRef = useRef(go);
  useEffect(() => { goRef.current = go; });
  const pickSet = useCallback((s) => {
    savedStripScroll.current = setStripRef.current?.scrollLeft || 0;
    goRef.current({ set: s.set_code, page: 1 });
  }, []);

  const renameRef = useRef(openRename);
  useEffect(() => { renameRef.current = openRename; });
  const renameSet = useCallback((s) => renameRef.current(s), []);

  const deleteRef = useRef(deleteSet);
  useEffect(() => { deleteRef.current = deleteSet; });
  const removeSet = useCallback((s) => deleteRef.current(s), []);

  useEffect(() => {
    const el = setStripRef.current;
    if (el && savedStripScroll.current) el.scrollLeft = savedStripScroll.current;
  }, [setCode]);

  /* Plain render helper, NOT a component: it returns JSX inline, so React does
   * not see a new component type and the chips are not remounted. The key is the
   * stable set_code. */
  const renderSetChip = (s) => (
    <SetChip
      key={s.set_code}
      set={s}
      active={s.set_code === setCode && !across}
      deleting={deletingSet === s.set_code}
      onSelect={pickSet}
      onRename={renameSet}
      onDelete={removeSet}
    />
  );

  /* Shared pagination bar ("1 2 3 … 8" style) rendered both above and below the
     puzzle grid. */
  const paginator =
    totalPages > 1 ? (
      <div className="flex flex-wrap items-center justify-center gap-1.5 mt-5">
        <button
          type="button"
          title="Previous page"
          disabled={page <= 1}
          onClick={() => (across ? go({ all: true, page: page - 1 }) : go({ set: setCode, page: page - 1 }))}
          className="h-8 px-2.5 grid place-items-center rounded-lg border border-amber-500/50 bg-amber-400/15 text-sm font-bold text-amber-700 hover:bg-amber-400/25 disabled:opacity-30 disabled:cursor-not-allowed transition"
        >
          ‹
        </button>
        {pager(page, totalPages).map((item, i) =>
          item === '…' ? (
            <span key={`pg-${i}`} className="px-1 text-ink-400 select-none">
              …
            </span>
          ) : (
            <button
              key={item}
              type="button"
              onClick={() => (across ? go({ all: true, page: item }) : go({ set: setCode, page: item }))}
              className={`h-8 w-8 grid place-items-center rounded-lg border text-xs font-bold transition ${
                item === page
                  ? 'border-gold-500 bg-gold-500 text-white shadow-[0_4px_12px_rgba(37,99,235,0.3)]'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              {item}
            </button>
          )
        )}
        <button
          type="button"
          title="Next page"
          disabled={page >= totalPages}
          onClick={() => (across ? go({ all: true, page: page + 1 }) : go({ set: setCode, page: page + 1 }))}
          className="h-8 px-2.5 grid place-items-center rounded-lg border border-amber-500/50 bg-amber-400/15 text-sm font-bold text-amber-700 hover:bg-amber-400/25 disabled:opacity-30 disabled:cursor-not-allowed transition"
        >
          ›
        </button>
      </div>
    ) : null;

  return (
    <PageHeader
      wide
      icon="♟"
      title="Puzzle Library"
      subtitle={sets.length ? `Browse ${sets.length} sets · ${totalPuzzles} puzzles` : 'Loading puzzle sets…'}
    >
      {setsError && !sets.length && (
        <p className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 mb-4">{setsError}</p>
      )}

      {currentSet && (
        /* ONE card for browsing AND selecting.
           These were two separate cards - a white sticky bar and an amber panel
           below it - with different borders, backgrounds and padding, so the
           controls read as unrelated. The same folder state also appeared twice:
           a "All folders" dropdown up top and a "Folder browser - All folders"
           label underneath. Now: one card, one border, one padding scale, split
           into labelled rows by a hairline. The folder dropdown stays the filter;
           the disclosure becomes "Manage folders", which is what it actually is. */
        <div className="sticky top-[64px] md:top-[70px] z-30 mb-5 rounded-2xl border border-ink-200 bg-white/90 backdrop-blur-xl shadow-[0_6px_16px_rgba(0,0,0,0.08)] overflow-hidden">
          {/* ── row 1: where you are, navigation, page size ── */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 pt-3">
            <h2 className="text-sm font-bold text-black whitespace-nowrap">
              <span className="text-black">{across ? 'All' : currentSet.set_name}</span>
              <span className="mx-1.5 text-black">›</span>
              <span className="text-black">{across ? 'Combined' : 'Exercises'}</span>
            </h2>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                title={across ? 'Browse a single set first' : 'Previous set'}
                disabled={filteredSets.length < 2 || across}
                onClick={() => goBy(-1)}
                className="h-8 w-8 grid place-items-center rounded-lg border border-ink-200 bg-white/70 text-sm font-bold text-black hover:bg-ink-100 disabled:opacity-30 disabled:cursor-not-allowed transition"
              >
                ◀
              </button>
              <button
                type="button"
                title={across ? 'Browse a single set first' : 'Next set'}
                disabled={filteredSets.length < 2 || across}
                onClick={() => goBy(1)}
                className="h-8 w-8 grid place-items-center rounded-lg border border-ink-200 bg-white/70 text-sm font-bold text-black hover:bg-ink-100 disabled:opacity-30 disabled:cursor-not-allowed transition"
              >
                ▶
              </button>
            </div>

            <span className="hidden sm:inline text-xs font-bold text-black whitespace-nowrap">
              {across
                ? `All sets · ${totalPuzzles} puzzles`
                : `${filteredSets.findIndex((s) => s.set_code === setCode) + 1} / ${filteredSets.length} · ${currentSet.puzzle_count} puzzles`}
            </span>

            <label className="ml-auto flex items-center gap-1.5 text-xs font-bold text-black whitespace-nowrap">
              <span className="hidden sm:inline">Show</span>
              <select
                value={perPage}
                onChange={(e) =>
                  across
                    ? go({ all: true, page: 1, perPage: Number(e.target.value) })
                    : go({ set: setCode, page: 1, perPage: Number(e.target.value) })
                }
                className="rounded-lg border border-ink-200 bg-white/70 px-2 py-1 font-bold text-black outline-none focus:border-gold-500 cursor-pointer"
              >
                {PER_PAGE_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              <span>/ page</span>
            </label>
          </div>

          {/* ── row 2: folder filter + search, then the set chips ── */}
          <div ref={setStripRef} className="mt-2.5 flex items-center gap-1.5 overflow-x-auto scrollbar-thin px-4 pb-3">
            <div className="relative shrink-0">
              <select
                value={folderFilter}
                onChange={(e) => {
                  const v = e.target.value;
                  setFolderFilter(v === 'unfiled' ? 'unfiled' : v === 'all' ? 'all' : Number(v));
                }}
                title="Filter sets by folder"
                className="rounded-lg border border-ink-200 bg-white/70 pl-2 pr-7 py-1.5 text-xs font-bold text-black outline-none focus:border-gold-500 cursor-pointer"
              >
                <option value="all">📁 All folders</option>
                <option value="unfiled">🗂 Unfiled sets</option>
                {folderOptions.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label.trim()} ({f.setCount})
                  </option>
                ))}
              </select>
            </div>

            <div className="relative shrink-0">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-black text-xs pointer-events-none select-none">⌕</span>
              <input
                value={setFilter}
                onChange={(e) => setSetFilter(e.target.value)}
                placeholder="Filter sets…"
                className="w-36 rounded-lg border border-ink-200 bg-white/70 pl-7 pr-6 py-1.5 text-xs font-bold text-black outline-none focus:border-gold-500 placeholder:text-ink-400 transition"
              />
              {setFilter && (
                <button
                  type="button"
                  title="Clear set filter"
                  aria-label="Clear set filter"
                  onClick={() => setSetFilter('')}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-black hover:text-black text-xs font-bold transition"
                >
                  ✕
                </button>
              )}
            </div>

            <button
              type="button"
              title={`All sets combined · ${totalPuzzles} puzzles`}
              onClick={() => go({ all: true, page: 1 })}
              className={`max-w-[8.5rem] shrink-0 rounded-lg border px-2.5 py-1.5 text-xs font-bold transition ${
                across
                  ? 'border-gold-500 bg-gold-500/20 text-black shadow-[0_0_14px_rgba(96,165,250,0.18)]'
                  : 'border-ink-200 bg-white/70 text-black hover:border-ink-300 hover:bg-ink-100'
              }`}
            >
              <span className="block truncate">All ({totalPuzzles})</span>
            </button>

            {setFilterText ? (
              filteredSets.length === 0 ? (
                <span className="shrink-0 px-3 py-1.5 text-xs text-ink-500 whitespace-nowrap">
                  No sets found for “{setFilter.trim()}”
                </span>
              ) : (
                filteredSets.map((set) => renderSetChip(set))
              )
            ) : (
              pager(chipIndex, filteredSets.length).map((item, i) =>
                item === '…' ? (
                  <span key={`gap-${i}`} className="px-1 text-ink-500 select-none">
                    …
                  </span>
                ) : (
                  renderSetChip(filteredSets[item - 1])
                )
              )
            )}
          </div>

          {/* ── row 3: folder MANAGEMENT (create/rename/move), not a second filter.
              Labelled "Manage folders" on purpose: the dropdown in row 2 already
              filters by folder, and calling this a second "browser" made the two
              look like duplicate controls for one piece of state. ── */}
          <div className="border-t border-ink-200 px-4 py-2.5">
            <button
              type="button"
              onClick={() => setFolderBrowserOpen((o) => !o)}
              className="flex items-center gap-2 text-xs font-bold text-ink-600 hover:text-gold-600 transition"
              aria-expanded={folderBrowserOpen}
            >
              <span className={`inline-grid h-5 w-5 place-items-center rounded border border-ink-300 bg-white/70 text-ink-600 transition-transform ${folderBrowserOpen ? 'rotate-90' : ''}`}>›</span>
              Manage folders
              {folderBrowserOpen && (
                <span className="font-bold text-gold-600">{activeFolderLabel}</span>
              )}
            </button>
            {folderBrowserOpen && (
              <div className="mt-2.5">
                <FolderTree
                  key={`tree-${folderTreeKey}`}
                  compact
                  selectedId={typeof folderFilter === 'number' ? folderFilter : null}
                  onSelect={(id) => setFolderFilter(id ?? 'all')}
                  onChanged={() => {
                    refreshFolderTree();
                    setFolderTreeKey((k) => k + 1);
                    setRefreshKey((k) => k + 1);
                  }}
                />
              </div>
            )}
          </div>

          {/* ── row 4: what is selected + what you can do with it ── */}
          <div className="border-t border-ink-200 px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-sm font-bold text-slate-700 whitespace-nowrap">
          Selected:{' '}
          <span
            className={
              selected.size >= MAX_SELECT
                ? 'text-amber-600'
                : selected.size > 0
                  ? 'text-amber-600'
                  : 'text-ink-500'
            }
          >
            {selected.size}
          </span>
          <span className="text-ink-500"> / {MAX_SELECT}</span>
        </span>
        {selected.size >= MAX_SELECT && (
          <span className="text-xs font-semibold text-amber-600 whitespace-nowrap">Limit reached</span>
        )}
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <label
            className={`flex items-center gap-2 px-2.5 py-1 rounded-lg border text-xs transition ${
              applyToAllAssign
                ? 'border-amber-500/60 bg-amber-400/20 text-amber-700'
                : 'border-ink-200 bg-black/[0.04] text-ink-500'
            } ${selected.size > 0 ? 'cursor-pointer' : 'opacity-40 pointer-events-none'}`}
            title="Bulk-applies one setting set to every selected puzzle; toggle off to set values per puzzle."
          >
            <input
              type="checkbox"
              checked={applyToAllAssign}
              onChange={(e) => setApplyToAllAssign(e.target.checked)}
              className="accent-amber-500 w-3.5 h-3.5"
            />
            Apply same settings to all puzzles
          </label>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              const { added, blocked } = addPuzzles(puzzles.map((p) => p.id));
              if (blocked > 0) {
                showToast(
                  added > 0
                    ? `Selection limit of ${MAX_SELECT} reached — ${added} of ${puzzles.length} added this page.`
                    : `Selection limit of ${MAX_SELECT} reached — this page couldn't select anything.`
                );
              }
              lastIdxRef.current = null;
            }}
          >
            Select all
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={selected.size === 0}
            onClick={() => {
              deselectAll();
              lastIdxRef.current = null;
            }}
          >
            Deselect all
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={selected.size === 0}
            onClick={() => setAssignOpen(true)}
          >
            Assign to Student{selected.size === 1 ? '' : 's'}
          </Button>
        </div>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-x-4 gap-y-1">
          <span className="hidden md:inline text-xs font-semibold text-amber-600/90 whitespace-nowrap">click to select · shift+click to select a range</span>
          <span className="text-xs font-bold text-amber-700 whitespace-nowrap tabular-nums">
            {rangeStart}–{rangeEnd} of {total}
          </span>
        </div>
          </div>

          {/* ── row 5: page controls, sharing the card's own border ── */}
          {paginator && (
            <div className="border-t border-ink-200 px-4 py-3 flex justify-center">
              {paginator}
            </div>
          )}
        </div>
      )}

      {/* A failed load is a page-level problem, not a navigation control, so it
          sits outside the card rather than inside it. */}
      {error && (
        <p className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 mb-4">{error}</p>
      )}

      {loading ? (
        <div className="grid place-items-center py-24">
          <Spinner text="Loading puzzles…" />
        </div>
      ) : (
        /* min-h keeps the document tall while a set with few puzzles is shown,
         * so switching sets cannot shrink the page under the reader and clamp
         * the window scroll - which is what made the chip strip appear to jump. */
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-4 min-h-[60vh]">
          {puzzles.map((p, idx) => (
            <div key={p.id} className={`relative flex flex-col ${!across && setCode ? 'pb-10' : ''}`}>
              <PuzzleCard
                puzzle={p}
                selected={selected.has(p.id)}
                onSelect={() => toggleCard(p.id, idx, { shiftKey: false })}
                onKey={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleCard(p.id, idx, { shiftKey: e.shiftKey });
                  }
                }}
              />
            </div>
          ))}
        </div>
      )}

      {!loading && !error && puzzles.length === 0 && (
        <p className="text-center text-ink-500 py-16">No puzzles found.</p>
      )}

      {/* Within-set/across-set pagination, repeated below the grid. Styled to match the
          merged navigation card exactly - it used to be an amber panel, which was
          the reason the page had two different card styles floating around it. */}
      <div className="rounded-2xl border border-ink-200 bg-white/90 shadow-[0_6px_16px_rgba(0,0,0,0.08)] px-4 py-3 mt-8 flex justify-center">
{paginator && <div className="flex justify-center">{paginator}</div>}
      </div>

      {/* Rename set dialog */}
      {renaming && (
        <div
          className="fixed inset-0 z-[var(--z-modal-backdrop)] grid place-items-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setRenaming(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-[min(92vw,26rem)] rounded-2xl border border-ivory-700/50 bg-ink-800 p-5 shadow-[0_20px_60px_rgba(0,0,0,0.55)]"
          >
            <h3 className="text-base font-semibold text-ivory-300 mb-1">Rename set</h3>
            <p className="text-xs text-ivory-500 mb-4">
              Set code <span className="font-mono text-gold-400">{renaming.set_code}</span> is kept — puzzles and
              existing assignments keep working; only the display name changes.
            </p>
            <input
              autoFocus
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveRename();
                if (e.key === 'Escape') setRenaming(null);
              }}
              placeholder={renaming.set_name}
              maxLength={200}
              className="w-full rounded-lg border border-ivory-700/50 bg-black/[0.04] px-3 py-2 text-sm text-ivory-300 outline-none focus:border-gold-500/50 placeholder:text-ivory-500 transition"
            />
            {renameErr && <p className="mt-2 text-xs text-red-600">{renameErr}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setRenaming(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={!nameInput.trim() || nameInput.trim() === renaming.set_name}
                onClick={saveRename}
              >
                Save
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk assign dialog */}
      {assignOpen && (
        <AssignModal
          puzzleIds={[...selected]}
          applyToAll={applyToAllAssign}
          onApplyToAllChange={setApplyToAllAssign}
          onClose={() => setAssignOpen(false)}
          onAssigned={handleAssigned}
        />
      )}

      {/* Toast */}
      {toast && (
        <div
          className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[var(--z-modal-backdrop)] px-4 py-2.5 rounded-xl border border-gold-500/40 bg-ink-800 text-sm text-ivory-300 shadow-[0_10px_30px_rgba(0,0,0,0.5)]"
          style={{ animation: 'board-pop .3s both' }}
        >
          {toast}
        </div>
      )}
    </PageHeader>
  );
}