import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { getStudentPool, getTournament, listTournaments } from '../../services/tournamentsApi';

/*
 * Tournament report data for StudentReport.
 *
 * The list endpoint (GET /tournaments) carries the event fields but not the
 * standings, so rank / points are read from the existing detail endpoint
 * (GET /tournaments/:id) for each event in view. Nothing is derived from a
 * new backend field or a backend change.
 */

export const RANGE_OPTIONS = [
  { key: '30d', label: 'Last 30 days', days: 30 },
  { key: '3m', label: 'Last 3 months', days: 91 },
  { key: 'all', label: 'All time', days: 0 },
];

export const FORMAT_OPTIONS = [
  { key: 'all', label: 'All formats' },
  { key: 'swiss', label: 'Swiss' },
  { key: 'arena', label: 'Arena' },
  { key: 'knockout', label: 'Knockout' },
];

export const STATUS_OPTIONS = [
  { key: 'all', label: 'All statuses' },
  { key: 'completed', label: 'Completed' },
  { key: 'live', label: 'Live' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'cancelled', label: 'Cancelled' },
];

export const FORMAT_LABEL = { swiss: 'Swiss', arena: 'Arena', knockout: 'Knockout' };
export const STATUS_LABEL = {
  completed: 'Completed',
  live: 'Live',
  upcoming: 'Upcoming',
  cancelled: 'Cancelled',
};
export const STATUS_TONE = {
  completed: 'grey',
  live: 'green',
  upcoming: 'blue',
  cancelled: 'red',
};

function statusGroupOf(status) {
  if (status === 'active' || status === 'paused') return 'live';
  return status || 'upcoming';
}

export function tournamentDate(t) {
  return t?.startTime || t?.createdAt || t?.created_at || null;
}

function timeOf(t) {
  const ms = new Date(tournamentDate(t) || 0).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function shortName(name) {
  const s = String(name || 'Tournament');
  return s.length > 16 ? `${s.slice(0, 15)}…` : s;
}

function shortDay(value) {
  const d = new Date(value || 0);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

/* Small concurrency cap: a report may cover a dozen events and each needs one
   detail request. Firing them all at once would burst the API. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const at = cursor++;
      out[at] = await fn(items[at], at);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function enrichTournament(t, detail) {
  const info = detail?.tournament || t;
  const standings = Array.isArray(detail?.standings) ? detail.standings : [];
  return {
    ...t,
    ...info,
    playerCount: t.playerCount ?? info.playerCount ?? detail?.players?.length ?? standings.length,
    standings,
    statusGroup: statusGroupOf(info.status || t.status),
    winnerName:
      t.winnerName ||
      ((info.status || t.status) === 'completed' && standings.length ? standings[0].name : null),
  };
}

function monthBuckets(rows) {
  const map = new Map();
  for (const r of rows) {
    const d = new Date(tournamentDate(r) || 0);
    if (Number.isNaN(d.getTime())) continue;
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    const cur = map.get(key) || {
      key,
      ms: new Date(d.getFullYear(), d.getMonth(), 1).getTime(),
      year: d.getFullYear(),
      month: d.getMonth(),
      value: 0,
    };
    cur.value += 1;
    map.set(key, cur);
  }
  const buckets = [...map.values()].sort((a, b) => a.ms - b.ms);
  const multiYear = new Set(buckets.map((b) => b.year)).size > 1;
  return buckets.slice(-12).map((b) => {
    const d = new Date(b.year, b.month, 1);
    return {
      label: d.toLocaleDateString('en-IN', { month: 'short', year: multiYear ? '2-digit' : undefined }),
      value: b.value,
      tooltip: `${d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })} · ${b.value} tournament${b.value === 1 ? '' : 's'}`,
    };
  });
}

/*
 * Pure derivation shared by the on-screen section and the hidden print layout.
 * records: enriched tournament objects; opts: current filters + scope.
 */
export function buildTournamentPayload(records = [], opts = {}) {
  const {
    range = 'all',
    format = 'all',
    status = 'all',
    sortDir = 'desc',
    scopeIds = null,
    scopeName = 'All students',
    personal = false,
    isAdmin = false,
    allowMyStatus = false,
  } = opts;

  const cutoff =
    range === '30d'
      ? Date.now() - 30 * 86400000
      : range === '3m'
        ? Date.now() - 91 * 86400000
        : 0;

  const inScope = (t) => {
    if (!scopeIds) return true;
    if (t.standings.some((s) => scopeIds.has(String(s.playerId)))) return true;
    /* A registered student can survive a failed detail request: the event is
       still theirs, it just has no standings to read. */
    return !!(allowMyStatus && t.standings.length === 0 && t.myStatus != null);
  };

  const rows = (records || [])
    .filter((t) => {
      if (format !== 'all' && t.format !== format) return false;
      if (status !== 'all' && t.statusGroup !== status) return false;
      if (cutoff && timeOf(t) < cutoff) return false;
      return inScope(t);
    })
    .map((t) => {
      const entries = t.standings.filter(
        (s) => !scopeIds || scopeIds.has(String(s.playerId))
      );
      const ranked = entries
        .filter((s) => Number(s.rank) > 0)
        .sort((a, b) => Number(a.rank) - Number(b.rank));
      const display = ranked[0] || entries[0] || null;
      const played = t.statusGroup === 'completed' || t.statusGroup === 'live';
      return {
        ...t,
        entries,
        played,
        display,
        displayRank: played && display ? Number(display.rank) || null : null,
        displayPoints: played && display ? Number(display.score) || 0 : null,
      };
    })
    .sort((a, b) => (sortDir === 'asc' ? timeOf(a) - timeOf(b) : timeOf(b) - timeOf(a)));

  const playedRows = rows.filter((r) => r.played);
  let wins = 0;
  let draws = 0;
  let losses = 0;
  let totalPoints = 0;
  let podiums = 0;
  let bestRank = null;
  let entriesCount = 0;

  for (const r of playedRows) {
    for (const s of r.entries) {
      wins += Number(s.wins) || 0;
      draws += Number(s.draws) || 0;
      losses += Number(s.losses) || 0;
      totalPoints += Number(s.score) || 0;
      entriesCount += 1;
      const rank = Number(s.rank) || 0;
      if (rank > 0 && rank <= 3) podiums += 1;
      if (rank > 0 && (bestRank === null || rank < bestRank)) bestRank = rank;
    }
  }

  const timelineRows = playedRows
    .filter((r) => r.display)
    .slice()
    .sort((a, b) => timeOf(a) - timeOf(b));

  const pointsSeries = timelineRows.map((r) => {
    const value = Number(r.display.score) || 0;
    return {
      label: shortName(r.name),
      value,
      tooltip: `${r.name} · ${shortDay(tournamentDate(r))} · ${value} pt${value === 1 ? '' : 's'}`,
    };
  });

  const topTotals = new Map();
  for (const r of rows) {
    for (const s of r.entries) {
      const id = String(s.playerId);
      const cur = topTotals.get(id) || { id, name: s.name, value: 0 };
      cur.value += Number(s.score) || 0;
      topTotals.set(id, cur);
    }
  }
  const topPerformers = [...topTotals.values()]
    .filter((p) => p.value > 0)
    .sort((a, b) => b.value - a.value || String(a.name).localeCompare(String(b.name)))
    .slice(0, 5);

  const wdlTotal = wins + draws + losses;
  const filters = {
    range: (RANGE_OPTIONS.find((o) => o.key === range) || RANGE_OPTIONS[2]).label,
    format: (FORMAT_OPTIONS.find((o) => o.key === format) || FORMAT_OPTIONS[0]).label,
    status: (STATUS_OPTIONS.find((o) => o.key === status) || STATUS_OPTIONS[0]).label,
    scope: scopeName,
  };

  return {
    rows,
    playedRows,
    hasAny: (records || []).length > 0,
    hasPlayed: playedRows.length > 0,
    stats: {
      tournamentsPlayed: playedRows.length,
      wins,
      draws,
      losses,
      podiums,
      bestRank,
      totalPoints,
      avgScore: entriesCount ? totalPoints / entriesCount : 0,
      games: wdlTotal,
    },
    pointsSeries,
    participation: monthBuckets(rows),
    topPerformers: isAdmin ? topPerformers : [],
    personal,
    scopeName,
    filters,
  };
}

export function useTournamentReport({ active, studentMode }) {
  const { user } = useAuth();
  const [records, setRecords] = useState(null);
  const [pool, setPool] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [range, setRange] = useState('all');
  const [format, setFormat] = useState('all');
  const [status, setStatus] = useState('all');
  const [sortDir, setSortDir] = useState('desc');
  const [studentFilter, setStudentFilter] = useState('all');
  const [classFilter, setClassFilter] = useState('all');
  const inflight = useRef(null);

  const load = useCallback(() => {
    if (inflight.current) return inflight.current;
    setLoading(true);
    setError('');
    const promise = (async () => {
      try {
        const list = await listTournaments();
        /* A student's report only carries events they registered for; the
           detail call below supplies their rank / points. */
        const relevant = studentMode ? list.filter((t) => t.myStatus != null) : list;
        const details = await mapLimit(relevant, 5, async (t) => {
          try {
            return await getTournament(t.id);
          } catch {
            return null;
          }
        });
        const enriched = relevant.map((t, i) => enrichTournament(t, details[i]));
        setRecords(enriched);
        setError('');
        return enriched;
      } catch (e) {
        setError(e?.response?.data?.message || 'Could not load tournaments.');
        setRecords([]);
        return [];
      } finally {
        setLoading(false);
        inflight.current = null;
      }
    })();
    inflight.current = promise;
    return promise;
  }, [studentMode]);

  useEffect(() => {
    if (active && records === null && !inflight.current) load();
  }, [active, records, load]);

  useEffect(() => {
    if (studentMode || !active) return undefined;
    let alive = true;
    getStudentPool()
      .then((rows) => alive && setPool(Array.isArray(rows) ? rows : []))
      .catch(() => alive && setPool([]));
    return () => {
      alive = false;
    };
  }, [studentMode, active]);

  const classOptions = useMemo(() => {
    const names = new Set();
    for (const s of pool || []) if (s.group_name) names.add(s.group_name);
    return [...names].sort((a, b) => String(a).localeCompare(String(b)));
  }, [pool]);

  const studentOptions = useMemo(() => {
    const rows = (pool || []).filter(
      (s) => classFilter === 'all' || s.group_name === classFilter
    );
    return rows.slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }, [pool, classFilter]);

  useEffect(() => {
    if (studentFilter === 'all') return;
    if (!studentOptions.some((s) => String(s.id) === String(studentFilter))) {
      setStudentFilter('all');
    }
  }, [studentOptions, studentFilter]);

  const viewerId = user?.id != null ? String(user.id) : null;
  const focusId = studentMode
    ? viewerId
    : studentFilter !== 'all'
      ? String(studentFilter)
      : null;

  const classIds = useMemo(() => {
    if (studentMode || classFilter === 'all' || !pool) return null;
    const ids = new Set(
      pool.filter((s) => s.group_name === classFilter).map((s) => String(s.id))
    );
    return ids.size ? ids : null;
  }, [studentMode, classFilter, pool]);

  const scopeIds = useMemo(
    () => (focusId ? new Set([focusId]) : classIds),
    [focusId, classIds]
  );

  const scopeName = studentMode
    ? user?.name || 'You'
    : focusId
      ? (pool || []).find((s) => String(s.id) === focusId)?.name || 'Selected student'
      : classFilter !== 'all'
        ? `Class ${classFilter}`
        : 'All students';

  const personal = !!focusId;

  const buildOpts = useMemo(
    () => ({
      range,
      format,
      status,
      sortDir,
      scopeIds,
      scopeName,
      personal,
      isAdmin: !studentMode,
      allowMyStatus: studentMode,
    }),
    [range, format, status, sortDir, scopeIds, scopeName, personal, studentMode]
  );

  const payload = useMemo(
    () => (records ? buildTournamentPayload(records, buildOpts) : null),
    [records, buildOpts]
  );

  const ensureLoaded = useCallback(async () => {
    const rows = records || (await load());
    return buildTournamentPayload(rows || [], buildOpts);
  }, [records, load, buildOpts]);

  const resetFilters = useCallback(() => {
    setRange('all');
    setFormat('all');
    setStatus('all');
    setSortDir('desc');
    setStudentFilter('all');
    setClassFilter('all');
  }, []);

  return {
    records,
    payload,
    loading,
    error,
    reload: load,
    ensureLoaded,
    range,
    setRange,
    format,
    setFormat,
    status,
    setStatus,
    sortDir,
    setSortDir,
    studentFilter,
    setStudentFilter,
    classFilter,
    setClassFilter,
    studentOptions,
    classOptions,
    canFilterStudents: !studentMode && (pool || []).length > 0,
    scopeName,
    personal,
    resetFilters,
  };
}
