import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../services/api';
import { PageHeader, Spinner } from './ui';
import Button from './Button';
import PuzzleCard, { MiniBoard } from './PuzzleCard';
import AssignModal from './AssignModal';
import FolderTree from './FolderTree';
import CsvImportSetWizard from './CsvImportSetWizard';
import { usePuzzleSelection, togglePuzzle, addPuzzles, deselectAll, MAX_SELECT } from '../stores/puzzleSelection';

const PER_PAGE_OPTIONS = [10, 25, 50, 100];
const DEFAULT_PER_PAGE = 10;

const SORT_OPTIONS = [
  { value: 'default', label: 'Set order' },
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'title', label: 'Title A–Z' },
];

const DIFFICULTIES = ['Easy', 'Medium', 'Hard'];

const FIELD =
  'w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-800 outline-none transition focus:border-gold-500 focus:ring-2 focus:ring-gold-500/20';
const LABEL = 'mb-1 block text-[0.65rem] font-bold uppercase tracking-wider text-slate-500';

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

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadCsv(fileName, rows) {
  const csv = rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
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
 * index. Rename/delete are only offered where set management is allowed. */
const SetChip = memo(function SetChip({ set, active, deleting, onSelect, onRename, onDelete }) {
  const frame = active
    ? 'border-gold-500 bg-gold-500/15 shadow-[0_0_14px_rgba(96,165,250,0.18)]'
    : 'border-slate-300 bg-white hover:border-slate-400 hover:bg-slate-50';
  return (
    <div className={`flex max-w-[10rem] shrink-0 items-stretch rounded-lg border transition ${frame}`}>
      <button
        type="button"
        title={`${set.set_name} · ${set.puzzle_count} puzzles`}
        onClick={() => onSelect(set)}
        className="min-w-0 flex-1 rounded-l-lg px-2.5 py-1.5 text-xs font-bold text-slate-700 transition"
      >
        <span className="block truncate">{set.set_name}</span>
      </button>
      {onRename && (
        <button
          type="button"
          title={`Rename ${set.set_name}`}
          aria-label={`Rename ${set.set_name}`}
          onClick={() => onRename(set)}
          className="px-1.5 py-1.5 text-xs font-bold text-slate-500 transition hover:text-gold-600"
        >
          ✎
        </button>
      )}
      {onDelete && (
        <button
          type="button"
          title={`Delete ${set.set_name}`}
          aria-label={`Delete ${set.set_name}`}
          disabled={deleting}
          onClick={() => onDelete(set)}
          className={`rounded-r-lg px-1.5 py-1.5 text-xs font-bold transition ${
            deleting ? 'cursor-not-allowed text-slate-300' : 'text-slate-500 hover:text-red-600'
          }`}
        >
          {deleting ? '…' : '🗑'}
        </button>
      )}
    </div>
  );
});

/* Non-interactive preview of one puzzle: the position, the solution line and
   the tags the cards already show. Read-only on purpose — nothing here can
   change data, so it is safe in every surface that renders the listing. */
function PuzzlePreviewModal({ puzzle, onClose }) {
  const boardRef = useRef(null);
  const [width, setWidth] = useState(320);

  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const update = () => setWidth(Math.max(220, Math.min(el.clientWidth, 380)));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const sideToMove = String(puzzle.fen || '').trim().split(/\s+/)[1] === 'b' ? 'Black to move' : 'White to move';
  const solution = Array.isArray(puzzle.san) && puzzle.san.length ? puzzle.san : puzzle.uci || [];

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal-backdrop)] grid place-items-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Puzzle preview"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-[min(94vw,28rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.25)]"
        style={{ animation: 'board-pop .25s both' }}
      >
        <div className="flex items-start gap-3 border-b border-slate-200 px-4 py-3">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-bold text-slate-900" title={puzzle.title}>
              {puzzle.title}
            </h3>
            <p className="truncate text-xs font-semibold text-slate-500">
              {puzzle.set_name}
              {puzzle.rating != null ? ` · ${puzzle.rating} rating` : ''}
              {puzzle.difficulty ? ` · ${puzzle.difficulty}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-slate-200 text-slate-500 transition hover:bg-slate-50"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <div ref={boardRef} className="flex justify-center">
            <MiniBoard fen={puzzle.fen} width={width} />
          </div>

          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <p className={LABEL}>Solution</p>
            {solution.length ? (
              <div className="flex flex-wrap gap-1">
                {solution.map((move, i) => (
                  <span
                    key={`${move}-${i}`}
                    className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[0.7rem] font-bold text-slate-700"
                  >
                    {i % 2 === 0 ? `${i / 2 + 1}.` : ''} {move}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500">No solution recorded.</p>
            )}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[0.68rem] font-semibold text-slate-600">
            <span className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5">{sideToMove}</span>
            {puzzle.theme && <span className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5">{puzzle.theme}</span>}
            {(puzzle.themes || []).slice(0, 4).map((t) => (
              <span key={t} className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5">
                {t}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* Create / edit one puzzle. Adding writes to the chosen set; editing replaces
   title, rating, difficulty and — when both are provided — the position and
   solution together, because a new FEN with the old line cannot replay. */
function PuzzleEditorModal({ puzzle, sets, defaultSetCode, onClose, onSaved }) {
  const editing = !!puzzle;
  const [targetSet, setTargetSet] = useState(defaultSetCode || sets[0]?.set_code || '');
  const [title, setTitle] = useState(puzzle?.title || '');
  const [fen, setFen] = useState(puzzle?.fen || '');
  const [moves, setMoves] = useState(puzzle?.uci?.join(' ') || '');
  const [rating, setRating] = useState(puzzle?.rating != null ? String(puzzle.rating) : '');
  const [difficulty, setDifficulty] = useState(puzzle?.difficulty || 'Medium');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (!fen.trim() || !moves.trim()) {
      setError('A FEN position and the solution moves are required.');
      return;
    }
    if (!editing && !targetSet) {
      setError('Pick the set this puzzle belongs to.');
      return;
    }

    const body = {
      title: title.trim(),
      fen: fen.trim(),
      moves: moves.trim(),
      rating: rating === '' ? null : Number(rating),
      difficulty,
    };

    setBusy(true);
    setError('');
    try {
      if (editing) {
        await api.patch(`/puzzles/sets/${puzzle.set_code}/puzzles/${puzzle.id}`, body);
      } else {
        await api.post(`/puzzles/sets/${targetSet}/puzzles`, body);
      }
      onSaved(editing ? 'Puzzle updated' : 'Puzzle added');
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to save puzzle');
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal-backdrop)] grid place-items-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={editing ? 'Edit puzzle' : 'Add puzzle'}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-[min(94vw,42rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.25)]"
        style={{ animation: 'board-pop .25s both' }}
      >
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-bold text-slate-900">{editing ? 'Edit puzzle' : 'Add a puzzle'}</h3>
            <p className="text-xs font-semibold text-slate-500">
              {editing ? `${puzzle.set_name} · puzzle #${puzzle.id}` : 'The FEN is the puzzle position; the moves are the full solution line.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-slate-200 text-slate-500 transition hover:bg-slate-50"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {!editing && (
              <label className="block min-w-0">
                <span className={LABEL}>Set</span>
                <select value={targetSet} onChange={(e) => setTargetSet(e.target.value)} className={FIELD}>
                  {sets.map((s) => (
                    <option key={s.set_code} value={s.set_code}>
                      {s.set_name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label className={`block min-w-0 ${editing ? 'sm:col-span-2' : ''}`}>
              <span className={LABEL}>Title (optional)</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                placeholder="e.g. Back-rank mate in 2"
                className={FIELD}
              />
            </label>

            <label className="block min-w-0 sm:col-span-2">
              <span className={LABEL}>FEN</span>
              <textarea
                value={fen}
                onChange={(e) => setFen(e.target.value)}
                rows={3}
                spellCheck={false}
                placeholder="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
                className={`${FIELD} font-mono leading-relaxed`}
              />
            </label>

            <label className="block min-w-0 sm:col-span-2">
              <span className={LABEL}>Solution moves</span>
              <textarea
                value={moves}
                onChange={(e) => setMoves(e.target.value)}
                rows={2}
                spellCheck={false}
                placeholder="e3e5 f1c4 … (SAN or UCI, space separated)"
                className={`${FIELD} font-mono leading-relaxed`}
              />
              <span className="mt-1 block text-[0.68rem] text-slate-500">
                Solver move first, then the opponent's reply, alternating.
              </span>
            </label>

            <label className="block min-w-0">
              <span className={LABEL}>Rating</span>
              <input
                type="number"
                min="0"
                max="5000"
                value={rating}
                onChange={(e) => setRating(e.target.value)}
                placeholder="Optional"
                className={FIELD}
              />
            </label>

            <label className="block min-w-0">
              <span className={LABEL}>Difficulty</span>
              <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)} className={FIELD}>
                {DIFFICULTIES.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {error && (
            <p className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs font-semibold text-red-600">{error}</p>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={busy}>
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Add puzzle'}
          </Button>
        </div>
      </form>
    </div>
  );
}

/**
 * The puzzle catalogue: set rail, folder filter, search, cards and pagination.
 *
 * Used twice:
 *  - the Puzzle Library page (this file's page wrapper): URL-driven state,
 *    full set management (rename / delete / assign to students), puzzle
 *    authoring (add / edit / delete / CSV import / export) and the shared
 *    `puzzleSelection` store.
 *  - the Admin Homework "Assign puzzles" card: `embedded`, no URL writes (a
 *    modal must not rewrite the page's query string), no destructive
 *    management, and selection handed in through `selection` so the homework
 *    assignment can keep its own map of puzzle ids.
 *
 * Everything — controls and grid — lives in ONE bordered card so the whole
 * surface reads as a single tool instead of stacked panels.
 *
 * `selection` shape:
 *   { size, has(id), toggle(id, puzzle), addMany(puzzles) -> { added, blocked },
 *     clear(), max }
 * When omitted the library's shared store is used.
 */
export default function PuzzleListing({
  embedded = false,
  selectable = true,
  selection = null,
  showHeader = true,
  manageSets = !embedded,
  preserveSelection = embedded,
  title = 'Puzzle Library',
  subtitle,
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [sets, setSets] = useState([]);
  const [setsError, setSetsError] = useState('');
  const [puzzles, setPuzzles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const storeSelection = usePuzzleSelection();
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  /* Embedded mode browses with local state; the page keeps using the query
     string (real history entries, shareable URLs). */
  const [nav, setNav] = useState({ set: null, across: true, page: 1, perPage: DEFAULT_PER_PAGE });
  const syncUrl = !embedded;

  const [puzzleSearch, setPuzzleSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [sort, setSort] = useState('default');
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
  const [deletingPuzzle, setDeletingPuzzle] = useState(null); // puzzle id being deleted
  const [previewPuzzle, setPreviewPuzzle] = useState(null);
  const [editingPuzzle, setEditingPuzzle] = useState(null); // puzzle | null
  const [addingPuzzle, setAddingPuzzle] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const lastIdxRef = useRef(null);
  const toastTimerRef = useRef(null);

  useEffect(() => () => clearTimeout(toastTimerRef.current), []);

  const rawSet = syncUrl ? searchParams.get('set') : nav.set;
  const perPageRaw = syncUrl
    ? Number(searchParams.get('perPage')) || DEFAULT_PER_PAGE
    : nav.perPage;
  const perPage = PER_PAGE_OPTIONS.includes(perPageRaw) ? perPageRaw : DEFAULT_PER_PAGE;
  const pageFromUrl = syncUrl
    ? Math.max(1, Number(searchParams.get('page')) || 1)
    : Math.max(1, nav.page || 1);
  // "All puzzles" is the landing view: across is active when the URL says so
  // (across=1) OR when no specific set is requested at all.
  const across = syncUrl
    ? searchParams.get('across') === '1' || !searchParams.get('set')
    : nav.across;

  const currentSet = sets.find((s) => s.set_code === rawSet) || sets[0] || null;
  const setCode = currentSet?.set_code ?? null;
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

  const loadSets = useCallback(() => {
    return api
      .get('/puzzles/sets')
      .then((res) => {
        const data = res.data?.data ?? res.data ?? {};
        setSets(data.sets || []);
        setSetsError('');
      })
      .catch((e) => setSetsError(e.response?.data?.message || e.message || 'Failed to load puzzle sets'));
  }, []);

  const refreshFolderTree = useCallback(() => {
    api
      .get('/folders/tree')
      .then((res) => {
        const data = res.data?.tree ?? res.data ?? [];
        setFolderTree(Array.isArray(data) ? data : data.tree || []);
      })
      .catch(() => {});
  }, []);

  // Load set metadata (set_code, set_name, puzzle_count) for the rail.
  useEffect(() => {
    loadSets();
    refreshFolderTree();
  }, [loadSets, refreshFolderTree]);

  /* Selection adapter. The library reads the shared store so a selection
     survives route changes; embedded surfaces pass their own map in. */
  const sel = selection || {
    size: storeSelection.size,
    has: (id) => storeSelection.has(id),
    toggle: (id) => togglePuzzle(id),
    addMany: (list) => addPuzzles(list.map((p) => p.id)),
    clear: () => deselectAll(),
    max: MAX_SELECT,
  };

  // Reset selections whenever the active set changes (library only — the
  // homework card keeps its picks across sets and pages).
  useEffect(() => {
    if (preserveSelection) return;
    if (!across) {
      deselectAll();
      lastIdxRef.current = null;
    }
  }, [setCode, across, preserveSelection]);

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

  // Fetch puzzles for the active set (or the combined "All" view). A late
  // response from a previous query is dropped so fast typing cannot overwrite
  // newer results.
  useEffect(() => {
    if (!setCode && !across) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    const params = { page: pageFromUrl, pageSize: perPage, sort };
    let req;
    if (across) {
      if (appliedSearch) params.q = appliedSearch;
      req = api.get('/puzzles/search', { params });
    } else {
      if (appliedSearch) params.search = appliedSearch;
      req = api.get(`/puzzles/sets/${setCode}`, { params });
    }
    req
      .then((res) => {
        if (cancelled) return;
        const data = res.data?.data ?? res.data ?? {};
        setPuzzles(data.puzzles || []);
        setTotal(data.total || 0);
        const pages = data.totalPages || 1;
        setTotalPages(pages);
        if (pageFromUrl > pages) {
          // Clamp: current page no longer exists after a size change.
          if (!syncUrl) {
            setNav((n) => ({ ...n, page: 1 }));
            return;
          }
          const sp = new URLSearchParams();
          if (setCode) sp.set('set', setCode);
          sp.set('page', '1');
          sp.set('perPage', String(perPage));
          if (across) sp.set('across', '1');
          setSearchParams(sp, { replace: true });
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.response?.data?.message || e.message || 'Failed to load puzzles');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [setCode, pageFromUrl, perPage, across, refreshKey, setSearchParams, syncUrl, appliedSearch, sort]);

  // go() pushes a real history entry so the global Back button can step
  // back through sets/pages/search states one at a time.
  //   next.all  → leave any set and open the combined "All" view
  //   next.set  → explicit set target, which exits the "All" view
  const go = (next) => {
    const selCode = next.all ? null : next.set ?? setCode;
    const nextPerPage = next.perPage ?? perPage;
    const nextPage = next.page ?? 1;

    if (!syncUrl) {
      const nextAcross = next.all ? true : next.set ? false : across;
      setNav({ set: selCode, across: nextAcross, page: nextPage, perPage: nextPerPage });
      return;
    }

    const sp = new URLSearchParams();
    if (selCode) sp.set('set', selCode);
    sp.set('page', String(nextPage));
    sp.set('perPage', String(nextPerPage));
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

  const goRef = useRef(go);
  useEffect(() => { goRef.current = go; });

  /* Typing is debounced; the query is applied once it settles. Harmless on
     mount (both values are ''), so no first-run guard is needed. */
  useEffect(() => {
    const timer = setTimeout(() => {
      const next = puzzleSearch.trim();
      if (next === appliedSearch) return;
      setAppliedSearch(next);
      goRef.current({ page: 1 });
    }, 300);
    return () => clearTimeout(timer);
  }, [puzzleSearch, appliedSearch]);

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

  const deletePuzzle = async (puzzle) => {
    if (!window.confirm(`Delete "${puzzle.title}"?\n\nThis cannot be undone.`)) return;
    setDeletingPuzzle(puzzle.id);
    try {
      await api.delete(`/puzzles/${puzzle.id}`);
      setPuzzles((prev) => prev.filter((p) => p.id !== puzzle.id));
      setTotal((t) => Math.max(0, t - 1));
      setSets((prev) =>
        prev.map((s) =>
          s.set_code === puzzle.set_code
            ? { ...s, puzzle_count: Math.max(0, (s.puzzle_count || 0) - 1) }
            : s
        )
      );
      showToast('Puzzle deleted');
      setRefreshKey((k) => k + 1);
    } catch (e) {
      showToast(`Failed to delete puzzle: ${e.response?.data?.message || e.message}`);
    } finally {
      setDeletingPuzzle(null);
    }
  };

  const puzzleSaved = (message) => {
    setEditingPuzzle(null);
    setAddingPuzzle(false);
    showToast(message);
    loadSets();
    setRefreshKey((k) => k + 1);
  };

  /* Export what is currently on screen — same set, same search, same order —
     by walking every page. 100 is the backend's maximum page size. */
  const exportCsv = async () => {
    setExporting(true);
    try {
      const rows = [];
      for (let pageNo = 1; ; pageNo++) {
        const params = { page: pageNo, pageSize: 100, sort };
        let res;
        if (across) {
          if (appliedSearch) params.q = appliedSearch;
          res = await api.get('/puzzles/search', { params });
        } else {
          if (appliedSearch) params.search = appliedSearch;
          res = await api.get(`/puzzles/sets/${setCode}`, { params });
        }
        const data = res.data?.data ?? res.data ?? {};
        const list = data.puzzles || [];
        rows.push(...list);
        if (pageNo >= (data.totalPages || 1) || list.length === 0) break;
      }

      downloadCsv(
        `mate-zone-${across ? 'all-puzzles' : setCode}.csv`,
        [
          ['Title', 'Set', 'FEN', 'Moves', 'Rating', 'Difficulty', 'Themes'],
          ...rows.map((p) => [
            p.title,
            p.set_name,
            p.fen,
            (p.uci || []).join(' '),
            p.rating ?? '',
            p.difficulty ?? '',
            (p.themes || []).join(' '),
          ]),
        ]
      );
      showToast(`Exported ${rows.length} puzzle${rows.length === 1 ? '' : 's'}`);
    } catch (e) {
      showToast(`Export failed: ${e.response?.data?.message || e.message}`);
    } finally {
      setExporting(false);
    }
  };

  const toggleCard = (id, idx, ev) => {
    if (!selectable) return;
    if (ev?.shiftKey && lastIdxRef.current != null) {
      const [a, b] = [Math.min(lastIdxRef.current, idx), Math.max(lastIdxRef.current, idx)];
      const items = [];
      for (let i = a; i <= b; i++) if (puzzles[i]) items.push(puzzles[i]);
      const { added, blocked } = sel.addMany(items);
      if (blocked > 0) {
        showToast(
          added > 0
            ? `Selection limit of ${sel.max} reached — ${added} selected, ${blocked} dropped.`
            : `Selection limit of ${sel.max} reached — no more puzzles can be selected.`
        );
      }
    } else {
      const result = sel.toggle(id, puzzles[idx]);
      if (result === 'limit') {
        showToast(`Selection limit of ${sel.max} reached — deselect something first.`);
      }
    }
    lastIdxRef.current = idx;
  };

  const selectPage = () => {
    const { added, blocked } = sel.addMany(puzzles);
    if (blocked > 0) {
      showToast(
        added > 0
          ? `Selection limit of ${sel.max} reached — ${added} of ${puzzles.length} added this page.`
          : `Selection limit of ${sel.max} reached — this page couldn't select anything.`
      );
    }
    lastIdxRef.current = null;
  };

  const handleAssigned = (res) => {
    setAssignOpen(false);
    showToast(res?.message || 'Assigned.');
    sel.clear();
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
      onRename={manageSets ? renameSet : undefined}
      onDelete={manageSets ? removeSet : undefined}
    />
  );

  const paginator = totalPages > 1 ? (
    <div className="flex flex-wrap items-center justify-center gap-1.5">
      <button
        type="button"
        title="Previous page"
        disabled={page <= 1}
        onClick={() => (across ? go({ all: true, page: page - 1 }) : go({ set: setCode, page: page - 1 }))}
        className="grid h-8 place-items-center rounded-lg border border-slate-300 bg-white px-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-30"
      >
        ‹
      </button>
      {pager(page, totalPages).map((item, i) =>
        item === '…' ? (
          <span key={`pg-${i}`} className="select-none px-1 text-slate-400">
            …
          </span>
        ) : (
          <button
            key={item}
            type="button"
            onClick={() => (across ? go({ all: true, page: item }) : go({ set: setCode, page: item }))}
            className={`grid h-8 w-8 place-items-center rounded-lg border text-xs font-bold transition ${
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
        className="grid h-8 place-items-center rounded-lg border border-slate-300 bg-white px-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-30"
      >
        ›
      </button>
    </div>
  ) : null;

  const body = (
    <>
      {setsError && !sets.length && (
        <p className="mb-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600">{setsError}</p>
      )}

      {currentSet && (
        /* ONE card for browsing, filtering, authoring and selecting. Everything
           shares one border, one padding scale and hairline separators, so the
           whole catalogue reads as a single tool. */
        <div className="mb-5 overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-[0_6px_20px_rgba(15,23,42,0.06)]">
          {/* ── header: where you are + sort + page size ── */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-ink-200 px-4 py-3">
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-sm font-bold text-black">
                {across ? 'All puzzles' : currentSet.set_name}
              </h2>
              <p className="mt-0.5 truncate text-[0.7rem] font-semibold text-slate-500">
                {across
                  ? `${sets.length} set${sets.length === 1 ? '' : 's'}`
                  : `Set ${filteredSets.findIndex((s) => s.set_code === setCode) + 1} of ${filteredSets.length}`}
                {' · '}
                {total} puzzle{total === 1 ? '' : 's'}
                {appliedSearch ? ` · matching “${appliedSearch}”` : ''}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  title={across ? 'Browse a single set first' : 'Previous set'}
                  disabled={filteredSets.length < 2 || across}
                  onClick={() => goBy(-1)}
                  className="grid h-8 w-8 place-items-center rounded-lg border border-slate-300 bg-white text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  ◀
                </button>
                <button
                  type="button"
                  title={across ? 'Browse a single set first' : 'Next set'}
                  disabled={filteredSets.length < 2 || across}
                  onClick={() => goBy(1)}
                  className="grid h-8 w-8 place-items-center rounded-lg border border-slate-300 bg-white text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  ▶
                </button>
              </div>

              <label className="flex items-center gap-1.5 text-xs font-bold text-slate-600">
                <span className="hidden sm:inline">Sort</span>
                <select
                  value={sort}
                  onChange={(e) => {
                    setSort(e.target.value);
                    go({ page: 1 });
                  }}
                  aria-label="Sort puzzles"
                  className="h-8 rounded-lg border border-slate-300 bg-white px-2 text-xs font-bold text-slate-800 outline-none focus:border-gold-500"
                >
                  {SORT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex items-center gap-1.5 text-xs font-bold text-slate-600">
                <span className="hidden sm:inline">Show</span>
                <select
                  value={perPage}
                  onChange={(e) =>
                    across
                      ? go({ all: true, page: 1, perPage: Number(e.target.value) })
                      : go({ set: setCode, page: 1, perPage: Number(e.target.value) })
                  }
                  aria-label="Puzzles per page"
                  className="h-8 rounded-lg border border-slate-300 bg-white px-2 text-xs font-bold text-slate-800 outline-none focus:border-gold-500"
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
          </div>

          {/* ── search + filters, then the set rail ── */}
          <div className="border-b border-ink-200 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[10rem] flex-1">
                <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 select-none text-sm text-slate-400">⌕</span>
                <input
                  value={puzzleSearch}
                  onChange={(e) => setPuzzleSearch(e.target.value)}
                  placeholder={across ? 'Search puzzles across all sets…' : `Search in ${currentSet.set_name}…`}
                  aria-label="Search puzzles"
                  className="h-9 w-full rounded-lg border border-slate-300 bg-white pl-8 pr-8 text-xs font-semibold text-slate-800 outline-none transition focus:border-gold-500 placeholder:text-slate-400"
                />
                {puzzleSearch && (
                  <button
                    type="button"
                    title="Clear search"
                    aria-label="Clear search"
                    onClick={() => setPuzzleSearch('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 transition hover:text-slate-700"
                  >
                    ✕
                  </button>
                )}
              </div>

              <select
                value={folderFilter}
                onChange={(e) => {
                  const v = e.target.value;
                  setFolderFilter(v === 'unfiled' ? 'unfiled' : v === 'all' ? 'all' : Number(v));
                }}
                title="Filter sets by folder"
                aria-label="Filter by folder"
                className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-xs font-bold text-slate-800 outline-none focus:border-gold-500"
              >
                <option value="all">📁 All folders</option>
                <option value="unfiled">🗂 Unfiled sets</option>
                {folderOptions.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label.trim()} ({f.setCount})
                  </option>
                ))}
              </select>

              <div className="relative">
                <input
                  value={setFilter}
                  onChange={(e) => setSetFilter(e.target.value)}
                  placeholder="Filter sets…"
                  aria-label="Filter sets by name"
                  className="h-9 w-32 rounded-lg border border-slate-300 bg-white pl-2.5 pr-6 text-xs font-bold text-slate-800 outline-none transition focus:border-gold-500 placeholder:font-semibold placeholder:text-slate-400"
                />
                {setFilter && (
                  <button
                    type="button"
                    title="Clear set filter"
                    aria-label="Clear set filter"
                    onClick={() => setSetFilter('')}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 transition hover:text-slate-700"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            <div ref={setStripRef} className="mt-2 flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
              <button
                type="button"
                title={`All sets combined · ${totalPuzzles} puzzles`}
                onClick={() => go({ all: true, page: 1 })}
                className={`max-w-[8.5rem] shrink-0 rounded-lg border px-2.5 py-1.5 text-xs font-bold transition ${
                  across
                    ? 'border-gold-500 bg-gold-500/15 text-gold-700 shadow-[0_0_14px_rgba(96,165,250,0.18)]'
                    : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50'
                }`}
              >
                <span className="block truncate">All ({totalPuzzles})</span>
              </button>

              {setFilterText ? (
                filteredSets.length === 0 ? (
                  <span className="shrink-0 whitespace-nowrap px-3 py-1.5 text-xs text-slate-500">
                    No sets found for “{setFilter.trim()}”
                  </span>
                ) : (
                  filteredSets.map((set) => renderSetChip(set))
                )
              ) : (
                pager(chipIndex, filteredSets.length).map((item, i) =>
                  item === '…' ? (
                    <span key={`gap-${i}`} className="select-none px-1 text-slate-400">
                      …
                    </span>
                  ) : (
                    renderSetChip(filteredSets[item - 1])
                  )
                )
              )}
            </div>
          </div>

          {/* ── authoring toolbar (library only) ── */}
          {manageSets && (
            <div className="flex flex-wrap items-center gap-2 border-b border-ink-200 bg-slate-50/70 px-4 py-2.5">
              <Button type="button" variant="secondary" size="sm" onClick={() => setImportOpen(true)}>
                Import CSV
              </Button>
              <Button type="button" variant="secondary" size="sm" disabled={exporting || loading} onClick={exportCsv}>
                {exporting ? 'Exporting…' : 'Export CSV'}
              </Button>
              <span className="ml-auto text-xs font-bold tabular-nums text-slate-600">
                {rangeStart}–{rangeEnd} of {total}
              </span>
            </div>
          )}

          {/* ── folder MANAGEMENT (create/rename/move), not a second filter ── */}
          {manageSets && (
            <div className="border-b border-ink-200 px-4 py-2.5">
              <button
                type="button"
                onClick={() => setFolderBrowserOpen((o) => !o)}
                className="flex items-center gap-2 text-xs font-bold text-slate-600 transition hover:text-gold-600"
                aria-expanded={folderBrowserOpen}
              >
                <span className={`inline-grid h-5 w-5 place-items-center rounded border border-slate-300 bg-white text-slate-600 transition-transform ${folderBrowserOpen ? 'rotate-90' : ''}`}>›</span>
                Manage folders
                {folderBrowserOpen && <span className="font-bold text-gold-600">{activeFolderLabel}</span>}
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
          )}

          {/* ── selection + actions ── */}
          <div className="flex flex-wrap items-center gap-2 border-b border-ink-200 px-4 py-2.5">
            <span className="whitespace-nowrap text-sm font-bold text-slate-700">
              Selected: <span className={sel.size > 0 ? 'text-gold-600' : 'text-slate-400'}>{sel.size}</span>
              {Number.isFinite(sel.max) && <span className="text-slate-400"> / {sel.max}</span>}
            </span>

            {manageSets && (
              <label
                className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[0.68rem] font-semibold transition ${
                  applyToAllAssign
                    ? 'border-gold-500/50 bg-gold-500/10 text-gold-700'
                    : 'border-slate-200 bg-white text-slate-500'
                } ${sel.size > 0 ? 'cursor-pointer' : 'pointer-events-none opacity-40'}`}
                title="Bulk-applies one setting set to every selected puzzle; toggle off to set values per puzzle."
              >
                <input
                  type="checkbox"
                  checked={applyToAllAssign}
                  onChange={(e) => setApplyToAllAssign(e.target.checked)}
                  className="h-3.5 w-3.5 accent-amber-500"
                />
                Same settings for all
              </label>
            )}

            <Button type="button" variant="secondary" size="sm" onClick={selectPage} disabled={!puzzles.length}>
              {manageSets ? 'Select all' : 'Select this page'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={sel.size === 0}
              onClick={() => {
                sel.clear();
                lastIdxRef.current = null;
              }}
            >
              Deselect all
            </Button>
            {manageSets && (
              <Button type="button" size="sm" disabled={sel.size === 0} onClick={() => setAssignOpen(true)}>
                Assign to Student{sel.size === 1 ? '' : 's'}
              </Button>
            )}

            <div className="ml-auto flex items-center gap-3">
              <span className="hidden whitespace-nowrap text-[0.68rem] font-semibold text-slate-500 md:inline">
                click to select · shift+click for a range
              </span>
              {!manageSets && (
                <span className="whitespace-nowrap text-xs font-bold tabular-nums text-slate-700">
                  {rangeStart}–{rangeEnd} of {total}
                </span>
              )}
            </div>
          </div>

          {/* ── the grid itself, inside the same card ── */}
          <div className="px-3 py-3 sm:px-4 sm:py-4">
            {error && (
              <p className="mb-3 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600">{error}</p>
            )}

            {loading ? (
              <div className="grid place-items-center py-20">
                <Spinner text="Loading puzzles…" />
              </div>
            ) : puzzles.length === 0 ? (
              <p className="py-16 text-center text-sm font-semibold text-slate-500">
                {appliedSearch ? `No puzzles match “${appliedSearch}”.` : 'No puzzles found.'}
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {puzzles.map((p, idx) => (
                  <div key={p.id} className="flex min-w-0 flex-col">
                    <PuzzleCard
                      puzzle={p}
                      selected={selectable && sel.has(p.id)}
                      onSelect={selectable ? () => toggleCard(p.id, idx, { shiftKey: false }) : undefined}
                      onKey={
                        selectable
                          ? (e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                toggleCard(p.id, idx, { shiftKey: e.shiftKey });
                              }
                            }
                          : undefined
                      }
                    />

                    <div className="mt-1 flex items-center justify-end gap-1 px-0.5">
                      <button
                        type="button"
                        onClick={() => setPreviewPuzzle(p)}
                        className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[0.68rem] font-bold text-slate-600 transition hover:border-gold-500/50 hover:text-gold-700"
                      >
                        👁 Preview
                      </button>
                      {manageSets && (
                        <>
                          <button
                            type="button"
                            onClick={() => setEditingPuzzle(p)}
                            className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[0.68rem] font-bold text-slate-600 transition hover:border-gold-500/50 hover:text-gold-700"
                          >
                            ✎ Edit
                          </button>
                          <button
                            type="button"
                            disabled={deletingPuzzle === p.id}
                            onClick={() => deletePuzzle(p)}
                            className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[0.68rem] font-bold text-slate-600 transition hover:border-red-300 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {deletingPuzzle === p.id ? '…' : '🗑 Delete'}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── page controls, sharing the card's own border ── */}
          {paginator && <div className="border-t border-ink-200 px-4 py-3">{paginator}</div>}
        </div>
      )}

      {/* Rename set dialog */}
      {manageSets && renaming && (
        <div
          className="fixed inset-0 z-[var(--z-modal-backdrop)] grid place-items-center bg-black/60 p-4"
          onClick={() => setRenaming(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-[min(92vw,26rem)] rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_20px_60px_rgba(15,23,42,0.25)]"
            style={{ animation: 'board-pop .25s both' }}
          >
            <h3 className="mb-1 text-base font-bold text-slate-900">Rename set</h3>
            <p className="mb-4 text-xs font-semibold text-slate-500">
              Set code <span className="font-mono text-gold-600">{renaming.set_code}</span> is kept — puzzles and
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
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-gold-500 placeholder:text-slate-400"
            />
            {renameErr && <p className="mt-2 text-xs font-semibold text-red-600">{renameErr}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => setRenaming(null)}>
                Cancel
              </Button>
              <Button
                type="button"
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

      {/* Puzzle preview / editor / import (library only) */}
      {previewPuzzle && <PuzzlePreviewModal puzzle={previewPuzzle} onClose={() => setPreviewPuzzle(null)} />}

      {manageSets && (addingPuzzle || editingPuzzle) && (
        <PuzzleEditorModal
          puzzle={editingPuzzle}
          sets={sets}
          defaultSetCode={setCode}
          onClose={() => {
            setAddingPuzzle(false);
            setEditingPuzzle(null);
          }}
          onSaved={puzzleSaved}
        />
      )}

      {manageSets && importOpen && (
        <CsvImportSetWizard
          onClose={() => setImportOpen(false)}
          onImported={() => {
            loadSets();
            setRefreshKey((k) => k + 1);
          }}
        />
      )}

      {/* Bulk assign dialog */}
      {manageSets && assignOpen && (
        <AssignModal
          puzzleIds={[...storeSelection]}
          applyToAll={applyToAllAssign}
          onApplyToAllChange={setApplyToAllAssign}
          onClose={() => setAssignOpen(false)}
          onAssigned={handleAssigned}
        />
      )}

      {/* Toast */}
      {toast && (
        <div
          className="fixed bottom-5 left-1/2 z-[var(--z-modal-backdrop)] -translate-x-1/2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-[0_10px_30px_rgba(15,23,42,0.18)]"
          style={{ animation: 'board-pop .3s both' }}
        >
          {toast}
        </div>
      )}
    </>
  );

  if (!showHeader) return body;

  return (
    <PageHeader
      wide
      className="puzzle-listing-page"
      icon="♟"
      title={title}
      subtitle={subtitle ?? (sets.length ? `Browse ${sets.length} sets · ${totalPuzzles} puzzles` : 'Loading puzzle sets…')}
    >
      {body}
    </PageHeader>
  );
}
