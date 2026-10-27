import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../services/api';
import { Spinner } from './ui';
import Button from './Button';
import Pagination from './Pagination';
import { useOverlayHistory } from '../hooks/useOverlayHistory';

const PAGE_SIZE = 10;
const DIFFICULTIES = ['Easy', 'Medium', 'Hard', 'Expert'];

/* Readable label for a Lichess theme id ("backRankMate" → "Back Rank Mate"). */
function prettyTheme(id) {
  return String(id || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .split(' ')
    .map((w) => (/^\d+$/.test(w) || w === 'in' || w === 'of' ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

function defaultTitle() {
  return `Puzzle homework — ${new Date().toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })}`;
}

/**
 * Assign-puzzles card used by Admin Homework.
 *
 * It browses the same catalogue the Puzzle Library lists (GET /api/puzzles with
 * its theme/difficulty/set filters), pages with the shared Pagination and posts
 * to the existing puzzle-assignment endpoints:
 *   POST /api/assignments/puzzle-assignments        → the assignment + puzzles
 *   POST /api/assignments/puzzle-assignments/:id/assign → the students
 *
 * Desktop: a 900px-centred dialog whose list is the only scrolling region.
 * Phones: the same card fills the screen as a bottom sheet.
 */
export default function PuzzleAssignPicker({ onClose, onAssigned }) {
  const [puzzles, setPuzzles] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');

  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [theme, setTheme] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [setCode, setSetCode] = useState('');

  const [sets, setSets] = useState([]);
  const [themeGroups, setThemeGroups] = useState([]);
  const [classes, setClasses] = useState([]);
  const [students, setStudents] = useState([]);
  const [metaLoading, setMetaLoading] = useState(true);

  /* Selection survives paging and filtering; it is dropped when the card
     unmounts, which is what "clears on close" means. */
  const [selected, setSelected] = useState(() => new Map());

  const [title, setTitle] = useState(defaultTitle);
  const [dueDate, setDueDate] = useState('');
  const [target, setTarget] = useState('all'); // all | class | students
  const [classId, setClassId] = useState('');
  const [studentIds, setStudentIds] = useState(() => new Set());
  const [studentQuery, setStudentQuery] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  /* If the create succeeds but the student step fails, a retry must reuse the
     assignment instead of creating a second copy. */
  const createdRef = useRef(null);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => { setPage(1); }, [query, theme, difficulty, setCode]);

  const load = useCallback(async () => {
    setLoading(true);
    setListError('');
    try {
      const params = { page, limit: PAGE_SIZE, sort: 'id' };
      if (query) params.search = query;
      if (theme) params.theme = theme;
      if (difficulty) params.difficulty = difficulty;
      if (setCode) params.setCode = setCode;
      const res = await api.get('/puzzles', { params });
      setPuzzles(res.data?.puzzles || []);
      setTotal(res.data?.total || 0);
    } catch (err) {
      setListError(err.response?.data?.message || 'Failed to load puzzles');
    } finally {
      setLoading(false);
    }
  }, [page, query, theme, difficulty, setCode]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    let alive = true;
    Promise.all([
      api.get('/puzzles/sets').then((r) => r.data?.data ?? r.data ?? {}),
      api.get('/puzzles/themes').then((r) => r.data?.categories || {}),
      api.get('/groups').then((r) => r.data || []),
      api.get('/students').then((r) => r.data || []),
    ])
      .then(([setData, categories, classRows, studentRows]) => {
        if (!alive) return;
        setSets(setData.sets || []);
        setThemeGroups(
          Object.entries(categories)
            .map(([key, cat]) => ({
              key,
              label: cat?.label || key,
              items: (cat?.items || []).map((i) => i.id),
            }))
            .filter((g) => g.items.length > 0)
        );
        setClasses(Array.isArray(classRows) ? classRows : []);
        setStudents(Array.isArray(studentRows) ? studentRows : []);
      })
      .catch(() => {})
      .finally(() => alive && setMetaLoading(false));
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, []);

  const requestClose = useCallback(() => {
    if (busy) return;
    if (selected.size > 0) {
      const ok = window.confirm(
        `Discard ${selected.size} selected puzzle${selected.size === 1 ? '' : 's'}?`
      );
      if (!ok) return;
    }
    onClose();
  }, [busy, selected, onClose]);

  useOverlayHistory('puzzle-assign-picker', true, requestClose);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        requestClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [requestClose]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageAllSelected = puzzles.length > 0 && puzzles.every((p) => selected.has(p.id));

  function toggle(p) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(p.id)) next.delete(p.id);
      else next.set(p.id, p);
      return next;
    });
  }

  function togglePage() {
    setSelected((prev) => {
      const next = new Map(prev);
      if (pageAllSelected) puzzles.forEach((p) => next.delete(p.id));
      else puzzles.forEach((p) => next.set(p.id, p));
      return next;
    });
  }

  function clearListFilters() {
    setSearch('');
    setQuery('');
    setTheme('');
    setDifficulty('');
    setSetCode('');
    setPage(1);
  }

  const classStudents = useMemo(
    () => students.filter((s) => String(s.group_id) === String(classId)),
    [students, classId]
  );

  const rosterQuery = studentQuery.trim().toLowerCase();
  const roster = useMemo(() => {
    const src = target === 'class' && classId ? classStudents : students;
    if (!rosterQuery) return src;
    return src.filter(
      (s) =>
        String(s.name || '').toLowerCase().includes(rosterQuery) ||
        String(s.group_name || '').toLowerCase().includes(rosterQuery)
    );
  }, [students, classStudents, target, classId, rosterQuery]);

  function toggleStudent(id) {
    setStudentIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const targetStudentIds = useMemo(() => {
    if (target === 'all') return null;
    if (target === 'class') return classStudents.map((s) => s.id);
    return [...studentIds];
  }, [target, classStudents, studentIds]);

  const targetReady =
    target === 'all' ||
    (target === 'class' ? classStudents.length > 0 : studentIds.size > 0);
  const canAssign = selected.size > 0 && title.trim() !== '' && targetReady && !busy;

  async function submit() {
    if (!canAssign) return;
    setBusy(true);
    setError('');
    try {
      let id = createdRef.current;
      if (!id) {
        const setCodes = new Set([...selected.values()].map((p) => p.set_code).filter(Boolean));
        const layout = {
          title: title.trim(),
          puzzleIds: [...selected.keys()],
          maxAttempts: 1,
          dueDate: dueDate || null,
          status: 'active',
        };
        if (setCodes.size === 1) layout.setCode = [...setCodes][0];
        const created = await api.post('/assignments/puzzle-assignments', layout);
        id = created.data?.id;
        createdRef.current = id;
      }

      const body = target === 'all' ? { allStudents: true } : { studentIds: targetStudentIds };
      const res = await api.post(`/assignments/puzzle-assignments/${id}/assign`, body);
      const count = selected.size;
      const assigned = res.data?.students ?? (target === 'all' ? null : targetStudentIds.length);
      const who = assigned == null ? 'all students' : `${assigned} student${assigned === 1 ? '' : 's'}`;
      onAssigned(`${count} puzzle${count === 1 ? '' : 's'} assigned to ${who}.`);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to assign puzzles');
      setBusy(false);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-stretch justify-center bg-black/60 p-0 sm:items-center sm:p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) requestClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Assign puzzles"
        className="chess-card flex h-full w-full flex-col overflow-hidden rounded-none sm:h-auto sm:max-h-[85vh] sm:w-[900px] sm:max-w-[900px] sm:rounded-2xl"
        onMouseDown={(e) => e.stopPropagation()}
        style={{ animation: 'board-pop .3s both' }}
      >
        {/* ── header ─────────────────────────────────────────────────────── */}
        <div className="flex shrink-0 items-center gap-3 border-b border-slate-200 px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-lg font-bold text-ivory-100">Assign puzzles</h2>
            <p className="text-xs text-ivory-500">
              {selected.size > 0
                ? `${selected.size} selected · ${total} matches in the current filters`
                : `${total} puzzle${total === 1 ? '' : 's'} available`}
            </p>
          </div>
          <button
            type="button"
            onClick={requestClose}
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
          >
            ✕
          </button>
        </div>

        {/* ── filters ────────────────────────────────────────────────────── */}
        <div className="grid shrink-0 grid-cols-2 items-center gap-2 border-b border-slate-200 px-4 py-2 sm:flex sm:flex-wrap">
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search puzzles…"
            className="chess-input !text-xs col-span-2 w-full sm:w-48"
          />
          <select
            value={setCode}
            onChange={(e) => setSetCode(e.target.value)}
            className="chess-input !text-xs w-full sm:w-44"
            aria-label="Filter by puzzle set"
          >
            <option value="">All sets</option>
            {sets.map((s) => (
              <option key={s.set_code} value={s.set_code}>
                {s.set_name} ({s.puzzle_count})
              </option>
            ))}
          </select>
          <select
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            className="chess-input !text-xs w-full sm:w-40"
            aria-label="Filter by theme"
          >
            <option value="">All themes</option>
            {themeGroups.map((g) => (
              <optgroup key={g.key} label={g.label}>
                {g.items.map((id) => (
                  <option key={id} value={id}>{prettyTheme(id)}</option>
                ))}
              </optgroup>
            ))}
          </select>
          <select
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value)}
            className="chess-input !text-xs w-full sm:w-32"
            aria-label="Filter by difficulty"
          >
            <option value="">All levels</option>
            {DIFFICULTIES.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
          <label className="col-span-2 flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[0.68rem] font-semibold text-slate-600 sm:col-auto">
            <input
              type="checkbox"
              checked={pageAllSelected}
              onChange={togglePage}
              disabled={!puzzles.length}
              className="h-3.5 w-3.5 accent-blue-600"
            />
            Select page
          </label>
        </div>

        {/* ── list (the only scrolling region) ───────────────────────────── */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {loading ? (
            <div className="grid place-items-center py-16">
              <Spinner text="Loading puzzles…" />
            </div>
          ) : listError ? (
            <div className="py-12 text-center">
              <p className="chess-error">{listError}</p>
              <Button onClick={load} variant="secondary" size="sm" className="mt-3">Retry</Button>
            </div>
          ) : puzzles.length === 0 ? (
            <div className="py-12 text-center">
              <span className="mb-3 block text-4xl text-gold-500/40">♞</span>
              <p className="text-base font-semibold text-ivory-300">No puzzles match these filters.</p>
              <button
                type="button"
                onClick={clearListFilters}
                className="mt-2 text-sm font-semibold text-blue-600 hover:underline"
              >
                Clear filters
              </button>
            </div>
          ) : (
            <ul className="space-y-2">
              {puzzles.map((p) => {
                const isSelected = selected.has(p.id);
                const label = p.title || `Puzzle #${p.id}`;
                return (
                  <li key={p.id}>
                    <label
                      className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2 transition ${
                        isSelected
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-slate-200 bg-white hover:border-blue-300 hover:bg-slate-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggle(p)}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-blue-600"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-ivory-100">{label}</span>
                        <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[0.68rem] text-ivory-500">
                          <span>#{p.id}</span>
                          {p.set_name && <span className="truncate">📚 {p.set_name}</span>}
                          {p.theme && <span>{prettyTheme(p.theme)}</span>}
                          {p.difficulty && <span>{p.difficulty}</span>}
                          {p.nb_plays != null && <span>{p.nb_plays} plays</span>}
                        </span>
                      </span>
                      {isSelected && <span className="shrink-0 text-xs font-bold text-blue-600">✓</span>}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}

          <Pagination
            currentPage={page}
            totalPages={totalPages}
            totalItems={total}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
            itemLabel="puzzles"
            className="mt-4"
          />
        </div>

        {/* ── assignment settings + actions ──────────────────────────────── */}
        <div className="shrink-0 border-t border-slate-200 bg-slate-50 px-4 py-3">
          {error && (
            <p className="mb-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>
          )}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <label className="col-span-2 block min-w-0 sm:col-span-1">
              <span className="mb-1 block text-[0.65rem] font-semibold uppercase tracking-wider text-slate-500">Homework title</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="chess-input !text-xs w-full"
                placeholder="e.g. Back-rank mates"
              />
            </label>

            <div className="min-w-0">
              <label className="block">
                <span className="mb-1 block text-[0.65rem] font-semibold uppercase tracking-wider text-slate-500">Assign to</span>
                <select
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  className="chess-input !text-xs w-full"
                  aria-label="Assign to"
                >
                  <option value="all">All students</option>
                  <option value="class">A class</option>
                  <option value="students">Chosen students</option>
                </select>
              </label>
              {target === 'class' && (
                <select
                  value={classId}
                  onChange={(e) => { setClassId(e.target.value); setStudentQuery(''); }}
                  className="chess-input !text-xs mt-2 w-full"
                  aria-label="Class"
                >
                  <option value="">Select a class…</option>
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.student_count})
                    </option>
                  ))}
                </select>
              )}
            </div>

            <label className="block min-w-0">
              <span className="mb-1 block text-[0.65rem] font-semibold uppercase tracking-wider text-slate-500">Due date (optional)</span>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="chess-input !text-xs w-full"
              />
            </label>
          </div>

          {target === 'students' && (
            <div className="mt-2 rounded-lg border border-slate-200 bg-white p-2">
              <input
                value={studentQuery}
                onChange={(e) => setStudentQuery(e.target.value)}
                placeholder="Search students…"
                className="chess-input !text-xs mb-2 w-full"
              />
              {metaLoading ? (
                <p className="py-3 text-center text-xs text-ivory-500">Loading students…</p>
              ) : roster.length === 0 ? (
                <p className="py-3 text-center text-xs text-ivory-500">No students match.</p>
              ) : (
                <ul className="max-h-32 space-y-1 overflow-y-auto">
                  {roster.map((s) => (
                    <li key={s.id}>
                      <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-xs text-slate-700 hover:bg-slate-50">
                        <input
                          type="checkbox"
                          checked={studentIds.has(s.id)}
                          onChange={() => toggleStudent(s.id)}
                          className="h-3.5 w-3.5 accent-blue-600"
                        />
                        <span className="min-w-0 flex-1 truncate">{s.name}</span>
                        {s.group_name && <span className="shrink-0 text-[0.65rem] text-ivory-500">{s.group_name}</span>}
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-slate-700">
              {selected.size} selected
            </span>
            {selected.size > 0 && (
              <button
                type="button"
                onClick={() => setSelected(new Map())}
                className="text-xs font-semibold text-blue-600 hover:underline"
              >
                Clear
              </button>
            )}
            <span className="ml-auto" />
            <Button type="button" variant="secondary" size="sm" onClick={requestClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="button" variant="primary" size="sm" onClick={submit} disabled={!canAssign} loading={busy}>
              Assign{selected.size > 0 ? ` ${selected.size}` : ''}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
