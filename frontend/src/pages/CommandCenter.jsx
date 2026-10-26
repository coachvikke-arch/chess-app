import { useCallback, useEffect, useMemo, useState } from 'react';
import { useUrlTab } from '../hooks/useUrlTab';
import { useNavigate } from 'react-router-dom';
import { PageHeader, Chip, Spinner } from '../components/ui';
import ClassDetailModal from '../components/ClassDetailModal';
import api from '../services/api';
import { fetchLibrary } from '../utils/libraryApi';
import { formatTime12 } from '../utils/time';
import {
  DEFAULT_FILTER, FILTER_TYPES, normalizeFilter,
  countByFilterType, countsForDate, useFilteredEvents,
} from '../utils/eventFilter';

/* ─────────────────────────────────────────────────────────────────────────────
   Command Center — your academy command center: classes, homework,
   tournaments & more, as a monthly / weekly / daily / agenda calendar.
   Every dated entry (online classes, homework assignments, tournaments and
   course-folder files) appears as a chip on its own date; clicking a date
   opens the full agenda for that particular day with ALL of its details.
   ─────────────────────────────────────────────────────────────────────────── */

const VIEWS = [
  { key: 'monthly', label: 'Monthly' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'daily', label: 'Daily' },
  { key: 'agenda', label: 'Agenda' },
];

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function dayKey(d) {
  return d.toISOString().slice(0, 10);
}
function keyDaysAgo(n) {
  return dayKey(new Date(Date.now() - n * 86400000));
}
function dateKey(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function chipsForDate(events, date, max) {
  const list = events.filter((e) => e.date === date);
  return { list, visible: list.slice(0, max || 3), more: Math.max(0, (list.length || 0) - (max || 3)) };
}

/* Collapse puzzle events on the same date into a single entry per set folder
   (falling back to the set name when the set isn't filed in a folder), so a
   100-puzzle set shows as one line instead of 100 rows. `count` holds how many
   puzzles were folded in, and `samples` the first few puzzle labels. */
function collapsePuzzleChips(events) {
  const out = [];
  const seen = new Map();
  for (const e of events) {
    if (e.kind === 'puzzle' && (e.setName || e.folderName)) {
      const label = e.folderName || e.setName;
      const key = `${e.date}|${label}`;
      const prev = seen.get(key);
      if (prev) {
        prev.count += 1;
        if (prev.samples.length < 3) prev.samples.push(e.title);
        continue;
      }
      const merged = { ...e, title: label, count: 1, samples: [e.title], setName: e.setName || null, folderName: e.folderName || null };
      seen.set(key, merged);
      out.push(merged);
      continue;
    }
    out.push(e);
  }
  return out;
}

/** Recursive file count for a course folder (files in it + everything nested). */
function countFolderFiles(folders, folder) {
  const direct = (folder?.items || []).length;
  const nested = folders
    .filter((f) => f.parentId === folder.id)
    .reduce((n, f) => n + countFolderFiles(folders, f), 0);
  return direct + nested;
}

/* ── weekly agenda board helpers ─────────────────────────────────────────── */

/** Sort key for a time string ("09:52:00" / "9:52 AM" / ""). Untimed items sort
 *  first so an all-day or missing-time entry never trails the day's schedule. */
function timeKey(t) {
  const s = String(t || '').trim();
  if (!s) return -1;
  let m = s.match(/^(\d{1,2}):(\d{2})/);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = s.match(/^(\d{1,2}):(\d{2})\s*([ap]m)/i); // 12-hour form
  if (m) {
    let h = Number(m[1]) % 12;
    if (/pm/i.test(m[3])) h += 12;
    return h * 60 + Number(m[2]);
  }
  return -1;
}

/** How many chips a column shows before it collapses to "+N more". */
const AGENDA_CHIP_PREVIEW = 6;

/**
 * Group runs of identical consecutive chips into one "🏫 E2E ×14" row.
 *
 * Only ADJACENT equal items merge (same kind, title and time) so a column reads
 * top-to-bottom the way it actually ran, and a group can be opened back up.
 * Returns rows of the form { ...event, groupSize } where groupSize > 1 marks a
 * merged run and `ids` collects everything it stands for.
 */
function groupConsecutive(list) {
  const rows = [];
  for (const e of list) {
    const last = rows[rows.length - 1];
    if (
      last && last.groupSize >= 1 &&
      last.kind === e.kind && last.title === e.title && last.time === e.time
    ) {
      last.groupSize += 1;
      last.ids.push(e.id);
      continue;
    }
    rows.push({ ...e, groupSize: 1, ids: [e.id] });
  }
  /* A run of exactly one is not a group — drop the marker so the chip renders
     normally rather than as a "×1" row. */
  for (const r of rows) if (r.groupSize === 1) delete r.groupSize;
  return rows;
}

/** Split a column's sorted events into the visible preview and the overflow. */
function splitPreview(list, expanded, limit = AGENDA_CHIP_PREVIEW) {
  const grouped = groupConsecutive(list);
  if (expanded || grouped.length <= limit) return { rows: grouped, hidden: 0 };
  return { rows: grouped.slice(0, limit), hidden: grouped.length - limit };
}

/** Flatten every course file (recursively, subfolders first) into dated events. */
function collectCourseFiles(folders, folder, out) {
  for (const it of folder?.items || []) {
    out.push({
      kind: 'file', type: 'file', id: it.id,
      title: it.title || 'Course file',
      date: String(it.date || folder.createdAt || '').slice(0, 10),
      time: '',
      sub: `${it.type === 'pgn' ? 'PGN' : 'FEN'} · ${countFolderFiles(folders, folder)} file(s)`,
    });
  }
  for (const f of folders.filter((x) => x.parentId === folder?.id)) {
    collectCourseFiles(folders, f, out);
  }
  return out;
}

const chipMeta = {
  class:      { tone: 'gold', label: '🏫' },
  homework:   { tone: '',     label: '📝' },
  tournament: { tone: 'green', label: '🏆' },
  puzzle:     { tone: 'indigo', label: '🧩' },
  file:       { tone: 'amber', label: '📁' },
};

/* Order + wording for the daily status bar. */
const STATUS_KINDS = [
  { kind: 'class', label: 'Classes' },
  { kind: 'homework', label: 'Homework' },
  { kind: 'tournament', label: 'Tournaments' },
  { kind: 'puzzle', label: 'Puzzle sets' },
  { kind: 'file', label: 'Files' },
];

export default function CommandCenter() {
  const [view, setView] = useUrlTab('view', 'monthly');
  const [loading, setLoading] = useState(true);

  const [classes, setClasses] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [puzzleRows, setPuzzleRows] = useState([]);
  const [libraryFolders, setLibraryFolders] = useState([]);

  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() };
  });
  const today = dayKey(new Date());
  const [selectedDate, setSelectedDate] = useState(dayKey(new Date()));
  /* Which week the agenda board is showing. Anchored on the selected date so
     "Today" and day-header clicks move the board together. */
  const [agendaWeekOffset, setAgendaWeekOffset] = useState(0);
  const [expandedDays, setExpandedDays] = useState(() => new Set());
  const [expandedGroups, setExpandedGroups] = useState(() => new Set());
  const [detailClassId, setDetailClassId] = useState(null);
  /* The event-type filter lives here, above every view, so it survives switching
     tabs, paging weeks/months and opening a day's full agenda. Seeded from
     ?filter= so a filtered calendar is shareable and survives a reload. */
  const [typeFilter, setTypeFilter] = useState(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('filter');
    return fromUrl ? normalizeFilter(fromUrl) : DEFAULT_FILTER;
  });
  const navigate = useNavigate();

  /* Mirror the filter into the URL so it can be shared and restored. */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (typeFilter === DEFAULT_FILTER) params.delete('filter');
    else params.set('filter', typeFilter);
    const qs = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
  }, [typeFilter]);

  /* Back/forward navigation restores the filter. */
  useEffect(() => {
    const onPop = () => setTypeFilter(normalizeFilter(new URLSearchParams(window.location.search).get('filter')));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const goToRecord = (e) => {
    // Clicking a class opens the full class detail (students, time, attendance, duration).
    if (e.kind === 'class') {
      setDetailClassId(e.id);
      return;
    }
    const ROUTES = {
      homework: `/admin/assignments`,
      tournament: `/admin/tournaments/${e.id || ''}`,
      puzzle: `/admin/puzzle-assignments`,
      file: `/admin/courses`,
    };
    navigate(ROUTES[e.kind] || '/admin/command-center');
  };

  useEffect(() => {
    Promise.all([
      api.get('/classes', { cache: false }).then((r) => r.data).catch(() => []),
      api.get('/assignments').then((r) => r.data).catch(() => []),
      api.get('/puzzles/assignments/results').then((r) => r.data).catch(() => []),
    ]).then(([cls, asc, pzr]) => {
      setClasses(Array.isArray(cls) ? cls : []);
      setAssignments(Array.isArray(asc) ? asc : []);
      setPuzzleRows(Array.isArray(pzr) ? pzr : []);
      setLoading(false);
    });
    /* The shared library feeds the calendar too. A read-only fetch: the
       Command Center never writes, so a failure just leaves the calendar
       without library entries rather than breaking the page. */
    fetchLibrary()
      .then((lib) => setLibraryFolders(lib?.folders || []))
      .catch(() => setLibraryFolders([]));
  }, []);

  /* everything dated → one flat event list */
  const events = useMemo(() => {
    const out = [];
    for (const c of classes) {
      const date = String(c.class_date || c.date || c.scheduled_at || '').slice(0, 10);
      if (date) out.push({ kind: 'class', type: 'class', id: c.id, title: c.topic || c.name || c.title || 'Class', date, time: c.start_time || '', sub: 'Live class' });
    }
    for (const a of assignments) {
      const date = String(a.due_date || a.due || a.deadline || '').slice(0, 10);
      if (date) out.push({ kind: 'homework', type: 'assignment', id: a.id, title: a.title || a.name || 'Homework', date, time: a.time || '', sub: 'Homework' });
    }
    for (const r of puzzleRows) {
      const date = String(r.due_date || r.created_at || r.assigned_at || '').slice(0, 10);
      if (date) {
        const puzzleName = r.title || (r.set_name ? r.seq || 'Puzzle' : r.theme || 'Puzzle');
        const title = r.set_name ? `${r.set_name} - ${puzzleName}` : puzzleName;
        // Real reach: student_puzzle_assignments is where assignments actually
        // live; the legacy puzzle_assignments broadcast row means "all students".
        const perStudent = Number(r.assigned_students || 0);
        const allStudents = Number(r.assigned_all || 0);
        const reach = perStudent > 0 ? perStudent : allStudents > 0 ? 'all' : 0;
        out.push({
          kind: 'puzzle', type: 'puzzle', id: r.id, title, date, time: '',
          setName: r.set_name || null, folderName: r.folder_name || null,
          sub: r.difficulty
            ? `${r.difficulty} puzzle · ${reach === 'all' ? 'all students' : `${reach} assigned`}`
            : 'Assigned puzzle',
        });
      }
    }
    collectCourseFiles(libraryFolders, { id: 'root', items: [] }, out);
    return out.filter((e) => e.date);
  }, [classes, assignments, puzzleRows, libraryFolders]);

  /* One filter, applied ONCE here, before any grouping or sorting. Everything
     below — month cells, week columns, the daily agenda and the Agenda board —
     reads these filtered maps, so "+N more" and "E2E ×14" count only what the
     active pill shows rather than items the filter hid. */
  const visibleEvents = useMemo(() => useFilteredEvents(events, typeFilter), [events, typeFilter]);

  /* Calendar grid uses folder-level chips for puzzles; the full per-puzzle
     list is preserved in `visibleEvents` for the daily agenda detail. */
  const gridEvents = useMemo(() => collapsePuzzleChips(visibleEvents), [visibleEvents]);

  const byDate = useMemo(() => {
    const m = new Map();
    for (const e of visibleEvents) {
      if (!m.has(e.date)) m.set(e.date, []);
      m.get(e.date).push(e);
    }
    return m;
  }, [visibleEvents]);

  const byDateGrid = useMemo(() => {
    const m = new Map();
    for (const e of gridEvents) {
      if (!m.has(e.date)) m.set(e.date, []);
      m.get(e.date).push(e);
    }
    return m;
  }, [gridEvents]);

  const monthDays = useMemo(() => {
    const first = new Date(Date.UTC(cursor.y, cursor.m, 1));
    const startWeekday = (first.getUTCDay() + 6) % 7; // Mon-first
    const dim = new Date(Date.UTC(cursor.y, cursor.m + 1, 0)).getUTCDate();
    const cells = [];
    for (let i = 0; i < startWeekday; i++) cells.push(null);
    for (let d = 1; d <= dim; d++) cells.push({ date: dateKey(cursor.y, cursor.m, d), day: d });
    return cells;
  }, [cursor]);

  const selectedEvents = byDate.get(selectedDate) || [];
  /* The daily agenda uses the collapsed list, so a set folder shows as one
     entry instead of one row per puzzle. */
  const selectedAgenda = useMemo(
    () => gridEvents.filter((e) => e.date === selectedDate),
    [gridEvents, selectedDate]
  );

  /* Status bar: per-category counts for the selected date, plus how many of the
     day's items are still in the future. Always rendered, so an empty day still
     shows a clear "0 across the board" summary rather than a blank panel. */
  const dayStats = useMemo(() => {
    const counts = { class: 0, homework: 0, puzzle: 0, file: 0 };
    let puzzleTotal = 0;
    for (const e of selectedAgenda) {
      if (counts[e.kind] !== undefined) counts[e.kind] += 1;
      if (e.kind === 'puzzle') puzzleTotal += e.count || 1;
    }
    return { counts, puzzleTotal, total: selectedAgenda.length };
  }, [selectedAgenda]);

  const gotoPrev = () => {
    const ds = new Date(Date.UTC(cursor.y, cursor.m - 1, 1));
    setCursor({ y: ds.getUTCFullYear(), m: ds.getUTCMonth() });
  };
  const gotoNext = () => {
    const ds = new Date(Date.UTC(cursor.y, cursor.m + 1, 1));
    setCursor({ y: ds.getUTCFullYear(), m: ds.getUTCMonth() });
  };
  const gotoToday = () => setSelectedDate(today);

  const monthly = view === 'monthly';
  const weekly = view === 'weekly';
  const daily = view === 'daily';
  const agenda = view === 'agenda';

  // weekly: the 7 dates containing the selected date (Mon-first). Computed for
  // every view so the filter pills can show live counts in all of them.
  const weekDates = useMemo(() => {
    const sel = new Date(selectedDate + 'T00:00:00Z');
    const dow = (sel.getUTCDay() + 6) % 7;
    return Array.from({ length: 7 }, (_, i) => dayKey(new Date(Date.UTC(sel.getUTCFullYear(), sel.getUTCMonth(), sel.getUTCDate() - dow + i))));
  }, [selectedDate]);

  /* ── the visible week for the agenda board ──
     Monday-first, seven days, derived from `selectedDate` + the week offset so
     the header and the columns can never disagree about which week is on screen. */
  const agendaDays = useMemo(() => {
    const sel = new Date((selectedDate || today) + 'T00:00:00Z');
    const base = new Date(Date.UTC(
      sel.getUTCFullYear(), sel.getUTCMonth(), sel.getUTCDate() - ((sel.getUTCDay() + 6) % 7) + agendaWeekOffset * 7
    ));
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(base.getTime() + i * 86400000);
      const date = dayKey(d);
      const list = (byDateGrid.get(date) || []).slice()
        .sort((a, b) => (timeKey(a.time) - timeKey(b.time)) || String(a.title).localeCompare(String(b.title)));
      return {
        date,
        dayNumber: d.getUTCDate(),
        isToday: date === today,
        events: list,
        count: list.length,
      };
    });
  }, [selectedDate, today, agendaWeekOffset, byDateGrid]);

  /* "5 Oct – 11 Oct" — always month on BOTH ends. Collapsing to "5 Oct – 11"
     reads as two different months and is exactly the ambiguity that label
     exists to remove. */
  const agendaRangeLabel = useMemo(() => {
    const a = new Date(agendaDays[0].date + 'T00:00:00Z');
    const b = new Date(agendaDays[6].date + 'T00:00:00Z');
    const fmt = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    return `${fmt(a)} – ${fmt(b)}`;
  }, [agendaDays]);

  /* Total events in the cursor month — the "N events this month" line the top
     bar shows. Counted over collapsed chips so a folded puzzle set reads as one. */
  const monthEventTotal = useMemo(() => {
    const prefix = `${cursor.y}-${String(cursor.m + 1).padStart(2, '0')}`;
    return gridEvents.filter((e) => String(e.date || '').startsWith(prefix)).length;
  }, [gridEvents, cursor]);

  /* Which dates the current view is showing — month in Monthly, week in Weekly,
     the single day in Daily, the board's week in Agenda. Drives the live counts
     on the filter pills so they always describe what's actually on screen. */
  const rangeDates = useMemo(() => {
    if (monthly) return monthDays.filter(Boolean).map((c) => c.date);
    if (weekly) return weekDates;
    if (daily) return [selectedDate];
    return agendaDays.map((d) => d.date);
  }, [monthly, weekly, daily, monthDays, weekDates, selectedDate, agendaDays]);

  const rangeCounts = useMemo(() => {
    const inRange = new Set(rangeDates);
    return countByFilterType(events.filter((e) => inRange.has(e.date)));
  }, [rangeDates, events]);

  const activeTypeLabel = FILTER_TYPES.find((t) => t.key === typeFilter)?.label?.toLowerCase();

  const toggleExpandedDay = (date) => {
    setExpandedDays((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date); else next.add(date);
      return next;
    });
  };
  const toggleExpandedGroup = (key) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  return (
    <PageHeader title="Command Center" icon="♕" subtitle="Your academy command center — classes, homework, tournaments & more.">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          {VIEWS.map((v) => (
            <button key={v.key} type="button" onClick={() => setView(v.key)} className={`chess-chip ${view === v.key ? 'chess-chip-gold' : ''}`}>
              {v.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="chess-chip" onClick={gotoPrev}>◀</button>
          <span className="chess-chip chess-chip-gold">{MONTHS[cursor.m]} {cursor.y}</span>
          <button type="button" className="chess-chip" onClick={gotoNext}>▶</button>
          <button type="button" className="chess-chip" onClick={gotoToday}>Today</button>
        </div>
      </div>

      {/* Global event-type filter — one control for every view. Sits under the
          view tabs so it stays put while Monthly/Weekly/Daily/Agenda swap
          underneath it, and the counts follow the range each view is showing. */}
      <div className="cc-filter-bar mb-4" role="group" aria-label="Filter calendar by event type">
        <button
          type="button"
          data-filter={DEFAULT_FILTER}
          className={`cc-filter-pill ${typeFilter === DEFAULT_FILTER ? 'is-active' : ''}`}
          aria-pressed={typeFilter === DEFAULT_FILTER}
          onClick={() => setTypeFilter(DEFAULT_FILTER)}
        >
          All <span className="cc-filter-count">{rangeCounts.all}</span>
        </button>
        {FILTER_TYPES.map((t) => (
          <button
            key={t.key}
            type="button"
            data-filter={t.key}
            className={`cc-filter-pill ${typeFilter === t.key ? 'is-active' : ''}`}
            aria-pressed={typeFilter === t.key}
            onClick={() => setTypeFilter(t.key)}
          >
            <span aria-hidden="true">{t.emoji}</span> {t.label}{' '}
            <span className="cc-filter-count">{rangeCounts[t.key]}</span>
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-ivory-700/50 bg-white p-3 text-ivory-100">
        <div className="flex items-center gap-3 mb-3">
          <span className="text-lg">🗓</span>
          <div>
            <p className="text-sm font-semibold text-ivory-300">{view === 'agenda' ? 'Agenda' : `${MONTHS[cursor.m]} ${cursor.y}`}</p>
            <p className="text-[0.65rem] text-ivory-500">
              {monthEventTotal} event{monthEventTotal === 1 ? '' : 's'} this month · tap a day header for its full daily agenda
            </p>
          </div>
        </div>

        {loading ? <Spinner text="Loading the board…" /> : (
          <>
            {monthly && (
              <>
              <div className="grid grid-cols-7 gap-1">
                {WEEKDAYS.map((w) => (
                  <div key={w} className="py-1 text-center text-[0.6rem] font-semibold uppercase tracking-wider text-ivory-500">{w}</div>
                ))}
              </div>
              <div className="grid grid-cols-1 min-[560px]:grid-cols-7 gap-1" data-cal="month-grid">
                {monthDays.map((cell, i) => !cell ? (
                  <div key={`blank-${i}`} />
                ) : (
                  <button
                    key={cell.date}
                    type="button"
                    onClick={() => setSelectedDate(cell.date)}
                    className={`min-h-[4.5rem] min-[560px]:min-h-[5.5rem] rounded-lg border p-1.5 text-left transition md:p-1 ${cell.date === selectedDate ? 'border-gold-500 bg-gold-500/10' : cell.date === today ? 'border-gold-500/40' : 'border-ivory-700/40 bg-white/[0.02] hover:border-gold-500/40'}`}
                  >
                    <span className={`block text-[0.65rem] font-semibold ${cell.date === today ? 'text-gold-400' : 'text-ivory-400'}`}>{cell.day}</span>
                    {chipsForDate(gridEvents, cell.date).visible.map((e) => (
                      <span key={`${e.kind}-${e.id}`} onClick={(ev) => { ev.stopPropagation(); goToRecord(e); }} className="block cursor-pointer truncate rounded px-0.5 text-[0.55rem] leading-tight text-ivory-200">
                        {e.time && <b>{formatTime12(e.time, e.time)}</b>} {chipMeta[e.kind].label} {e.title}
                      </span>
                    ))}
                    {chipsForDate(gridEvents, cell.date).more > 0 && (
                      <span className="block rounded px-0.5 text-[0.55rem] font-semibold text-gold-400">+{chipsForDate(gridEvents, cell.date).more} more</span>
                    )}
                    {/* A day with nothing left under the active filter reads as
                        explicitly empty instead of silently blank. */}
                    {typeFilter !== DEFAULT_FILTER && chipsForDate(gridEvents, cell.date).list.length === 0 && (
                      <span className="block text-[0.55rem] italic text-ivory-400/70">—</span>
                    )}
                  </button>
                ))}
              </div>
              </>
            )}

            {weekly && (
              <>
              <div className="grid grid-cols-7 gap-1">
                {WEEKDAYS.map((w) => <div key={w} className="py-1 text-center text-[0.6rem] font-semibold uppercase tracking-wider text-ivory-500">{w}</div>)}
              </div>
              <div className="grid grid-cols-1 min-[560px]:grid-cols-7 gap-1" data-cal="week-grid">
                {weekDates.map((date) => (
                  <button
                    key={date}
                    type="button"
                    onClick={() => setSelectedDate(date)}
                    className={`min-h-[5.5rem] min-[560px]:min-h-[8rem] rounded-lg border p-1.5 text-left transition md:p-1 ${date === selectedDate ? 'border-gold-500 bg-gold-500/10' : date === today ? 'border-gold-500/40' : 'border-ivory-700/40 bg-white/[0.02] hover:border-gold-500/40'}`}
                  >
                    <span className={`flex items-baseline justify-between gap-1 text-[0.65rem] font-semibold ${date === today ? 'text-gold-400' : 'text-ivory-400'}`}>
                      <span className="truncate">
                        {new Date(date + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}
                      </span>
                      {/* Count follows the active filter, like every other view. */}
                      {(byDateGrid.get(date) || []).length > 0 && (
                        <span className="shrink-0 text-[0.55rem] tabular-nums text-gold-400">
                          {(byDateGrid.get(date) || []).length}
                        </span>
                      )}
                    </span>
                    {(byDateGrid.get(date) || []).slice(0, 8).map((e) => (
                      <span key={`${e.kind}-${e.id}`} onClick={(ev) => { ev.stopPropagation(); goToRecord(e); }} className="block cursor-pointer truncate rounded px-0.5 text-[0.55rem] leading-tight text-ivory-200">
                        {e.time && <b>{formatTime12(e.time, e.time)}</b>} {chipMeta[e.kind].label} {e.title}
                      </span>
                    ))}
                    {/* Faint empty marker so a filtered-out day is clearly empty. */}
                    {(byDateGrid.get(date) || []).length === 0 && (
                      <span className="block text-[0.55rem] italic text-ivory-400/70">No events</span>
                    )}
                  </button>
                ))}
              </div>
              </>
            )}

            {daily && (
              <div className="rounded-lg border border-gold-500/40 bg-gold-500/[0.06] p-3">
                <p className="text-sm font-semibold text-ivory-300">
                  {selectedEvents.length === 0
                    ? (activeTypeLabel ? `No ${activeTypeLabel}` : 'Nothing scheduled')
                    : `${selectedEvents.length} event${selectedEvents.length === 1 ? '' : 's'}`} · {new Date(selectedDate + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}
                </p>
                {selectedDate === today && <span className="text-gold-400 text-xs">Today</span>}
              </div>
            )}

            {/* daily agenda for the selected date (monthly/weekly/daily all show it) */}
            {!agenda && (
              <div className="mt-3 rounded-lg border border-ivory-700/50 bg-black/[0.03] p-3">
                <p className="mb-2 text-sm font-semibold text-ivory-300">
                  {new Date(selectedDate + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })}
                  {selectedDate === today && <span className="text-gold-400 text-xs ml-2">Today</span>}
                  <span className="block text-[0.65rem] font-normal text-ivory-500 mt-0.5">
                    {selectedAgenda.length === 0
                      ? (activeTypeLabel
                        ? `No ${activeTypeLabel} on this date.`
                        : 'No classes, homework, tournaments or course files on this date.')
                      : `All ${selectedAgenda.length} item${selectedAgenda.length === 1 ? '' : 's'} for this date:`}
                  </span>
                </p>

                {/* status bar — always visible, even on an empty day. Deliberately shows EVERY
                    category, not just the active filter: it is the full-day
                    breakdown, so a zero here explains why a filtered list is
                    shorter rather than looking like a failed filter. */}
                <div className="mb-3 flex flex-wrap items-center gap-1.5">
                  {typeFilter !== DEFAULT_FILTER && (
                    <span className="text-[0.65rem] italic text-ivory-500">full day:</span>
                  )}
                  {STATUS_KINDS.map(({ kind, label }) => {
                    const n = dayStats.counts[kind] || 0;
                    const active = n > 0;
                    return (
                      <span
                        key={kind}
                        className={`chess-chip text-[0.65rem] ${active ? (chipMeta[kind].tone ? `chess-chip-${chipMeta[kind].tone}` : 'chess-chip-gold') : 'opacity-45'}`}
                        title={`${n} ${label.toLowerCase()} on this date`}
                      >
                        {chipMeta[kind].label} {label}: <b>{n}</b>
                        {kind === 'puzzle' && dayStats.puzzleTotal > 0 && ` (${dayStats.puzzleTotal} puzzles)`}
                      </span>
                    );
                  })}
                  <span className="chess-chip text-[0.65rem] ml-auto">
                    {selectedDate === today ? 'Today' : 'Selected'} · {dayStats.total} item{dayStats.total === 1 ? '' : 's'}
                  </span>
                </div>
                {selectedAgenda.length === 0 ? (
                  <p className="text-xs text-ivory-500">
                    {activeTypeLabel
                      ? `No ${activeTypeLabel} on this date. Switch the filter to All to see everything scheduled.`
                      : 'Nothing scheduled for this date — the counts above are all zero. Pick another date, or add classes, homework, tournaments and puzzle sets to fill it.'}
                  </p>
                ) : (
                  <ul className="grid grid-cols-1 gap-2">
                    {selectedAgenda.map((e) => (
                      <li key={`${e.kind}-${e.id}`} onClick={() => goToRecord(e)} className="flex cursor-pointer items-center gap-2 rounded-md border border-ivory-700/50 bg-white/[0.03] px-2 py-1.5 hover:border-gold-500/40">
                        <Chip tone={chipMeta[e.kind].tone}>{chipMeta[e.kind].label}</Chip>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-ivory-300">
                            {e.title}
                            {e.kind === 'puzzle' && e.count > 1 && (
                              <span className="ml-2 text-[0.65rem] font-normal text-gold-400">{e.count} puzzles</span>
                            )}
                          </span>
                          <span className="block text-[0.65rem] text-ivory-500">
                            {e.kind === 'puzzle' && e.folderName && e.setName ? `${e.setName} · ` : ''}
                            {e.sub || ''}
                          </span>
                        </span>
                        {e.time && <span className="text-[0.65rem] font-semibold text-gold-400">{formatTime12(e.time, e.time)}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* agenda = a 7-column weekly board, one column per visible day */}
            {agenda && (
              <>
                {/* week navigation */}
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      className="chess-chip"
                      onClick={() => setAgendaWeekOffset((n) => n - 1)}
                      title="Previous week"
                      aria-label="Previous week"
                    >◀</button>
                    <span className="chess-chip chess-chip-gold tabular-nums">{agendaRangeLabel}</span>
                    <button
                      type="button"
                      className="chess-chip"
                      onClick={() => setAgendaWeekOffset((n) => n + 1)}
                      title="Next week"
                      aria-label="Next week"
                    >▶</button>
                    <button
                      type="button"
                      className="chess-chip"
                      onClick={() => { setAgendaWeekOffset(0); setSelectedDate(today); }}
                      title="Jump to the current week"
                    >Today</button>
                  </div>
                </div>

                {/* Desktop: 7 equal columns. Mobile: one scrolling row of
                    140px columns with scroll-snap, so all seven days stay
                    columns rather than collapsing into a stack. */}
                <div className="agenda-week-scroll">
                  <div className="agenda-week-grid">
                    {agendaDays.map((day, idx) => {
                      const expandedDay = expandedDays.has(day.date);
                      const { rows, hidden } = splitPreview(day.events, expandedDay);
                      return (
                        <section
                          key={day.date}
                          className={`agenda-col ${day.isToday ? 'is-today' : ''}`}
                          aria-label={`${WEEKDAYS[idx]} ${day.dayNumber}`}
                        >
                          {/* Sticky header: day + date + count. Opens that
                              day's full agenda, as the flat list did. The full
                              agenda only renders when !agenda, so this has to
                              switch view — selecting the date alone would leave
                              the user on the board with nothing happening. */}
                          <button
                            type="button"
                            className="agenda-col-head"
                            onClick={() => { setSelectedDate(day.date); setView('daily'); }}
                            title={`Open the full agenda for ${day.date}`}
                          >
                            <span className="agenda-col-day">{WEEKDAYS[idx]}</span>
                            <span className="agenda-col-date">{day.dayNumber}</span>
                            {day.count > 0 && (
                              <span className="agenda-col-count" aria-label={`${day.count} events`}>
                                {day.count}
                              </span>
                            )}
                          </button>

                          <div className="agenda-col-body">
                            {rows.length === 0 && (
                              <p className="agenda-col-empty">No events</p>
                            )}
                            {rows.map((r, i) => {
                              const meta = chipMeta[r.kind] || chipMeta.file;
                              const gk = `${day.date}|${r.kind}|${r.ids[0]}`;
                              const isGroup = r.groupSize > 1;
                              const isOpen = isGroup && expandedGroups.has(gk);
                              return (
                                <div key={`${r.kind}-${r.ids?.[0] ?? i}`} className="agenda-chip-group">
                                  <button
                                    type="button"
                                    className={`agenda-chip agenda-chip--${r.kind}`}
                                    onClick={() => {
                                      if (isGroup) toggleExpandedGroup(gk);
                                      else goToRecord(r);
                                    }}
                                    title={isGroup
                                      ? `${r.groupSize} × ${r.title} — tap to ${isOpen ? 'collapse' : 'expand'}`
                                      : `${r.time ? formatTime12(r.time, r.time) + ' · ' : ''}${r.title}`}
                                  >
                                    <span className="agenda-chip-emoji" aria-hidden="true">{meta.label}</span>
                                    {r.time && (
                                      <span className="agenda-chip-time">{formatTime12(r.time, r.time)}</span>
                                    )}
                                    <span className="agenda-chip-title">{r.title}</span>
                                    {isGroup && (
                                      <span className="agenda-chip-x">×{r.groupSize}</span>
                                    )}
                                  </button>
                                  {/* An opened group lists what it folded away. */}
                                  {isOpen && (
                                    <div className="agenda-group-list">
                                      {day.events
                                        .filter((e) => r.ids.includes(e.id) && e.id !== r.ids[0])
                                        .map((e) => (
                                          <button
                                            key={`sub-${e.id}`}
                                            type="button"
                                            className={`agenda-group-item agenda-chip--${e.kind}`}
                                            onClick={() => goToRecord(e)}
                                            title={e.title}
                                          >
                                            {e.time && <span className="agenda-chip-time">{formatTime12(e.time, e.time)}</span>}
                                            <span className="agenda-chip-title">{e.title}</span>
                                          </button>
                                        ))}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                            {hidden > 0 && (
                              <button
                                type="button"
                                className="agenda-more"
                                onClick={() => toggleExpandedDay(day.date)}
                              >
                                +{hidden} more
                              </button>
                            )}
                            {expandedDay && rows.length > AGENDA_CHIP_PREVIEW && (
                              <button
                                type="button"
                                className="agenda-more"
                                onClick={() => toggleExpandedDay(day.date)}
                              >
                                Show less
                              </button>
                            )}
                          </div>
                        </section>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </div>
      {detailClassId && (
        <ClassDetailModal
          classId={detailClassId}
          initial={classes.find((c) => c.id === detailClassId)}
          onClose={() => setDetailClassId(null)}
        />
      )}
    </PageHeader>
  );
}

