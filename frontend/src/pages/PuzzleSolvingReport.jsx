import { useEffect, useState, useMemo, useCallback } from 'react';
import api from '../services/api';
import { Chip, Spinner, Bar, Stat } from '../components/ui';
import Button from '../components/Button';
import usePageTitle from '../hooks/usePageTitle';

const THEME_LABELS = {
  fork: 'Fork', pin: 'Pin', skewer: 'Skewer', sacrifice: 'Sacrifice',
  discoveredAttack: 'Discovered Attack', doubleCheck: 'Double Check',
  trappedPiece: 'Trapped Piece', deflection: 'Deflection',
  attraction: 'Attraction', intermezzo: 'Intermezzo',
  xrayAttack: 'X-Ray Attack', zugzwang: 'Zugzwang',
  hangingPiece: 'Hanging Piece', capturedDefender: 'Capture Defender',
  mateIn1: 'Mate in 1', mateIn2: 'Mate in 2', mateIn3: 'Mate in 3',
  mateIn4: 'Mate in 4', mateIn5: 'Mate in 5+',
  smotheredMate: 'Smothered Mate', operaMate: 'Opera Mate',
  backRankMate: 'Back-Rank Mate', middlegame: 'Middlegame', endgame: 'Endgame',
  opening: 'Opening', short: 'Short', long: 'Long', veryLong: 'Very Long',
  oneMove: 'One-Move', advantage: 'Advantage', crushing: 'Crushing', equality: 'Equality',
};

const SORT_OPTIONS = [
  { key: 'name', label: 'Name' },
  { key: 'assigned', label: 'Assigned' },
  { key: 'solved', label: 'Solved' },
  { key: 'accuracy', label: 'Accuracy' },
  { key: 'points', label: 'Points' },
  { key: 'last', label: 'Last active' },
  { key: 'finish', label: 'Finish %' },
];

const FINISH_META = {
  completed:    { label: 'Completed',    tone: 'green' },
  in_progress:  { label: 'In progress',  tone: 'amber' },
  not_started:  { label: 'Not started',  tone: '' },
};

const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);

function fmtDate(v) {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtTime(sec) {
  if (sec == null) return '—';
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

function PuzzleRow({ p, studentId }) {
  return (
    <tr>
      <td className="text-ivory-500">#{p.puzzle_id}</td>
      <td>
        <span className="flex items-center gap-2">
          <span className="text-gold-400">♞</span>
          <span className="text-ivory-300">{THEME_LABELS[p.theme] || p.theme || 'Tactics'}</span>
          {!p.is_published && <span className="text-[0.6rem] text-ivory-500">(unpublished)</span>}
        </span>
      </td>
      <td className="text-ivory-500">{p.difficulty}</td>
      <td>
        <span className="flex flex-col leading-tight">
          <span className="text-ivory-300">{p.set_name || '—'}</span>
          {p.folder_name && <span className="text-[0.65rem] text-ivory-500">📁 {p.folder_name}</span>}
        </span>
      </td>
      <td className="text-ivory-500">
        {p.is_explicit ? <Chip tone="gold">Assigned</Chip> : p.is_assigned ? <Chip>All students</Chip> : <Chip>Self</Chip>}
      </td>
      <td>
        {p.solved ? (
          <Chip tone="green">✓ Solved</Chip>
        ) : p.attempted ? (
          <Chip tone="amber">Tried · {p.correct}/{p.attempts} correct</Chip>
        ) : (
          <Chip>Not attempted</Chip>
        )}
      </td>
      <td className="text-right text-ivory-500">{p.attempted ? `${p.correct}/${p.attempts}` : '—'}</td>
      <td className="text-right text-ivory-500">{p.attempted ? `${p.points} pts` : '—'}</td>
      <td className="text-ivory-500">{fmtDate(p.last_attempt_at)}</td>
      <td className="text-right">
        <Button
          href={`/students/${studentId}/report`}
          variant="secondary" size="sm" className="!px-2.5 !py-1 text-[0.65rem] whitespace-nowrap"
          title="Open the full student report"
        >
          Report
        </Button>
      </td>
    </tr>
  );
}

export default function PuzzleSolvingReport() {
  usePageTitle('Puzzle Solving Report');
  const [students, setStudents] = useState([]);
  const [sets, setSets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('name');
  const [setFilter, setSetFilter] = useState('all');
  const [activeOnly, setActiveOnly] = useState(false);
  const [expanded, setExpanded] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/puzzles/student-report');
      setStudents(res.data?.students || []);
      setSets(res.data?.sets || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // When a set is selected, every count is recomputed from that set's puzzles
  // only, so the table always reflects the active filter.
  const scoped = useMemo(() => {
    if (setFilter === 'all') return students;
    return students.map((s) => {
      const puzzles = (s.puzzles || []).filter((p) => p.set_code === setFilter);
      if (puzzles.length === 0 && (s.assigned_count || 0) === 0) return s;
      const assigned = puzzles.filter((p) => p.is_assigned).length;
      const solved = puzzles.filter((p) => p.solved).length;
      const attempts = puzzles.reduce((n, p) => n + (p.attempts || 0), 0);
      const correct = puzzles.reduce((n, p) => n + (p.correct || 0), 0);
      const pending = Math.max(assigned - solved, 0);
      let finish_status = 'not_started';
      if (assigned > 0 && pending === 0) finish_status = 'completed';
      else if (solved > 0) finish_status = 'in_progress';
      return {
        ...s,
        puzzles,
        set_progress: (s.set_progress || []).filter((sp) => sp.set_code === setFilter),
        assigned_count: assigned,
        puzzles_solved: solved,
        puzzles_attempted: puzzles.filter((p) => p.attempted).length,
        puzzles_pending: pending,
        attempts,
        correct,
        incorrect: Math.max(attempts - correct, 0),
        points: puzzles.reduce((n, p) => n + (p.points || 0), 0),
        finish_status,
        finish_pct: assigned > 0 ? Math.round((solved / assigned) * 100) : 0,
      };
    });
  }, [students, setFilter]);

  const filtered = useMemo(() => {
    let src = scoped;
    if (activeOnly) src = src.filter((s) => (s.assigned_count || 0) > 0 || (s.attempts || 0) > 0);
    if (search) {
      const q = search.toLowerCase();
      src = src.filter(
        (s) =>
          (s.name || '').toLowerCase().includes(q) ||
          (s.email || '').toLowerCase().includes(q) ||
          (s.group_name || '').toLowerCase().includes(q)
      );
    }
    const acc = (s) => pct(s.correct, s.attempts);
    const cmp = {
      name: (a, b) => (a.name || '').localeCompare(b.name || ''),
      assigned: (a, b) => (b.assigned_count || 0) - (a.assigned_count || 0),
      solved: (a, b) => (b.puzzles_solved || 0) - (a.puzzles_solved || 0),
      accuracy: (a, b) => acc(b) - acc(a),
      points: (a, b) => (b.points || 0) - (a.points || 0),
      last: (a, b) => new Date(b.last_attempt_at || 0) - new Date(a.last_attempt_at || 0),
      finish: (a, b) => (b.finish_pct || 0) - (a.finish_pct || 0),
    }[sortKey];
    return [...src].sort(cmp);
  }, [scoped, search, sortKey, activeOnly]);

  const totals = useMemo(() => {
    const assigned = filtered.reduce((n, s) => n + (s.assigned_count || 0), 0);
    const solved = filtered.reduce((n, s) => n + (s.puzzles_solved || 0), 0);
    const attempts = filtered.reduce((n, s) => n + (s.attempts || 0), 0);
    const correct = filtered.reduce((n, s) => n + (s.correct || 0), 0);
    const points = filtered.reduce((n, s) => n + (s.points || 0), 0);
    return { assigned, solved, attempts, correct, points, accuracy: pct(correct, attempts) };
  }, [filtered]);

  if (loading) return <div className="max-w-[90rem] mx-auto px-4 py-6"><Spinner text="Loading student puzzle report…" /></div>;

  return (
    <div className="max-w-[90rem] mx-auto px-4 py-6">
      <div className="mb-5">
        <h1 className="font-display text-3xl font-bold text-ivory-100">Puzzle Solving Report</h1>
        <p className="text-ivory-500 text-sm mt-1">
          Student-wise puzzle performance — what each student was assigned and how they did.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mb-5">
        <Stat label="Students" value={filtered.length} icon="♟" />
        <Stat label="Puzzles assigned" value={totals.assigned} icon="♞" />
        <Stat label="Puzzles solved" value={totals.solved} icon="✓" />
        <Stat label="Accuracy" value={`${totals.accuracy}%`} icon="◎" />
        <Stat label="Points earned" value={totals.points} icon="★" />
        <Stat label="Completed" value={filtered.filter((s) => s.finish_status === 'completed').length} icon="✓" />
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          placeholder="Search by student, email or batch…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="chess-input w-72 !text-xs"
        />
        <select
          value={setFilter}
          onChange={(e) => setSetFilter(e.target.value)}
          className="chess-input !text-xs !py-1.5 w-auto max-w-[16rem]"
        >
          <option value="all">All sets</option>
          {sets.map((s) => (
            <option key={s.set_code} value={s.set_code}>
              {s.folder_name ? `${s.folder_name} / ` : ''}{s.set_name}
            </option>
          ))}
        </select>
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value)}
          className="chess-input !text-xs !py-1.5 w-auto"
        >
          {SORT_OPTIONS.map((o) => <option key={o.key} value={o.key}>Sort: {o.label}</option>)}
        </select>
        <label className="flex items-center gap-2 text-xs text-ivory-500">
          <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} className="accent-[#93c5fd]" />
          Only students with activity
        </label>
        <span className="text-xs text-ivory-500 ml-auto">
          {filtered.length} student{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="chess-card text-center py-14">
          <span className="block text-5xl mb-3 piece-glyph-spin text-gold-500/40">♜</span>
          <p className="chess-empty">No students match this filter.</p>
        </div>
      ) : (
        <div className="chess-table-wrap">
          <table className="chess-table">
            <thead>
              <tr>
                <th>Student</th>
                <th>Batch</th>
                <th className="text-right">Assigned</th>
                <th className="text-right">Solved</th>
                <th>Finish status</th>
                <th className="text-right">Attempted</th>
                <th className="text-right">Accuracy</th>
                <th className="text-right">Points</th>
                <th>Last active</th>
                <th className="text-right">Puzzles</th>
                <th className="text-right">Report</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s, i) => {
                const isOpen = expanded === s.student_id;
                const puzzles = s.puzzles || [];
                return (
                  <StudentRows
                    key={s.student_id}
                    s={s} i={i} puzzles={puzzles}
                    accuracy={pct(s.correct, s.attempts)}
                    isOpen={isOpen}
                    onToggle={() => setExpanded(isOpen ? null : s.student_id)}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}



function StudentRows({ s, i, accuracy, puzzles, isOpen, onToggle }) {
  return (
    <>
      <tr style={{ animation: `fade-up .45s ${Math.min(i * 0.05, 0.5)}s both` }}>
        <td>
          <button onClick={onToggle} className="flex items-center gap-2.5 hover:text-gold-400 transition-colors text-left">
            <span className="grid place-items-center w-8 h-8 rounded-full bg-[var(--ink-900)] ring-1 ring-white/10 text-xs font-bold text-gold-400 shrink-0">
              {(s.name || '?').trim().charAt(0).toUpperCase()}
            </span>
            <span className="flex flex-col">
              <span className="font-medium text-ivory-300">{s.name}</span>
              <span className="text-xs text-ivory-500 font-normal">{s.email}</span>
            </span>
            {s.active === false && <Chip>Inactive</Chip>}
          </button>
        </td>
        <td className="text-ivory-500">{s.group_name || '—'}</td>
        <td className="text-right text-ivory-300">{s.assigned_count || 0}</td>
        <td className="text-right">
          <span className="text-green-600 font-medium">{s.puzzles_solved || 0}</span>
          {(s.puzzles_pending || 0) > 0 && (
            <span className="text-xs text-ivory-500"> · {s.puzzles_pending} pending</span>
          )}
        </td>
        <td>
          <div className="flex flex-col gap-1 min-w-[7.5rem]">
            <Chip tone={FINISH_META[s.finish_status]?.tone || ''}>
              {FINISH_META[s.finish_status]?.label || 'Not started'}
            </Chip>
            <span className="w-20"><Bar pct={s.finish_pct || 0} /></span>
            <span className="text-[0.6rem] text-ivory-500">{s.finish_pct || 0}% finished</span>
          </div>
        </td>
        <td className="text-right text-ivory-300">{s.puzzles_attempted || 0}</td>
        <td className="text-right">
          <div className="flex items-center justify-end gap-2">
            <span className="text-ivory-300 w-9">{accuracy}%</span>
            <span className="w-16 hidden sm:block"><Bar pct={accuracy} /></span>
          </div>
        </td>
        <td className="text-right text-gold-400">{s.points || 0}</td>
        <td className="text-ivory-500">{fmtDate(s.last_attempt_at)}</td>
        <td className="text-right">
          <div className="flex justify-end gap-2">
            <Button onClick={onToggle} variant="secondary" size="sm" className="!px-3 !py-1 text-xs whitespace-nowrap">
              {isOpen ? 'Hide' : `${puzzles.length} puzzle${puzzles.length !== 1 ? 's' : ''}`}
            </Button>
            <Button
              href={`/students/${s.student_id}/report`}
              variant="primary" size="sm" className="!px-3 !py-1 text-xs whitespace-nowrap"
              title="Open the full student report"
            >
              Report
            </Button>
          </div>
        </td>
      </tr>
      {isOpen && (
        <tr>
          <td colSpan={11} className="!p-0">
            <div className="px-4 py-4" style={{ animation: 'board-pop .25s both' }}>
              {/* Set / folder rollup */}
              {(s.set_progress || []).length > 0 && (
                <div className="mb-4">
                  <p className="text-[0.65rem] uppercase tracking-wider text-gold-400 font-semibold mb-2">
                    Set &amp; folder progress
                  </p>
                  <div className="rounded-xl overflow-x-auto" style={{ border: '1px solid var(--surface-border)' }}>
                    <table className="chess-table">
                      <thead>
                        <tr>
                          <th>Folder</th>
                          <th>Set</th>
                          <th className="text-right">Assigned</th>
                          <th className="text-right">Solved</th>
                          <th className="text-right">Pending</th>
                          <th>Finish</th>
                          <th className="text-right">Accuracy</th>
                          <th className="text-right">Points</th>
                        </tr>
                      </thead>
                      <tbody>
                        {s.set_progress.map((sp) => (
                          <tr key={sp.set_code}>
                            <td className="text-ivory-500">{sp.folder_name ? `📁 ${sp.folder_name}` : '—'}</td>
                            <td className="text-ivory-300">{sp.set_name}</td>
                            <td className="text-right text-ivory-300">{sp.assigned}</td>
                            <td className="text-right text-green-600">{sp.solved}</td>
                            <td className="text-right text-ivory-500">{sp.pending}</td>
                            <td>
                              <div className="flex items-center gap-2">
                                <span className="w-20"><Bar pct={sp.pct} /></span>
                                <span className="text-xs text-ivory-500 w-9">{sp.pct}%</span>
                              </div>
                            </td>
                            <td className="text-right text-ivory-500">{sp.accuracy}%</td>
                            <td className="text-right text-gold-400">{sp.points}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <p className="text-[0.65rem] uppercase tracking-wider text-gold-400 font-semibold mb-2">
                Puzzles for {s.name}
              </p>
              {puzzles.length === 0 ? (
                <p className="text-sm text-ivory-500">No puzzles assigned or attempted yet.</p>
              ) : (
                <div className="rounded-xl overflow-x-auto" style={{ border: '1px solid var(--surface-border)' }}>
                  <table className="chess-table">
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Theme</th>
                        <th>Difficulty</th>
                        <th>Set / Folder</th>
                        <th>Source</th>
                        <th>Status</th>
                        <th className="text-right">Correct / Attempts</th>
                        <th className="text-right">Points</th>
                        <th>Last attempt</th>
                        <th className="text-right">Report</th>
                      </tr>
                    </thead>
                    <tbody>
                      {puzzles.map((p) => <PuzzleRow key={p.puzzle_id} p={p} studentId={s.student_id} />)}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="text-[0.65rem] text-ivory-500 mt-3">
                {s.attempts || 0} total attempt{(s.attempts || 0) !== 1 ? 's' : ''} · {s.correct || 0} correct ·{' '}
                {s.incorrect || 0} wrong · avg {fmtTime(s.avg_time)} per attempt
              </p>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
