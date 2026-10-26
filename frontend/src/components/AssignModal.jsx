import { useEffect, useMemo, useState } from 'react';
import { useOverlayHistory } from '../hooks/useOverlayHistory';
import api from '../services/api';
import { Spinner } from './ui';
import Button from './Button';

const NUM_RE = /^\d+$/;

function numOk(v, { min, allowEmpty }) {
  const s = String(v).trim();
  if (s === '') return allowEmpty;
  if (!NUM_RE.test(s)) return false;
  const n = parseInt(s, 10);
  return Number.isInteger(n) && n >= min;
}

/**
 * Bulk "Assign to Students" modal for the puzzle library.
 * Creates records in `student_puzzle_assignments` (due date + notes + per-puzzle
 * config: time limit, points, max attempts, negative points) via
 * POST /api/puzzles/assign-to-students. Works across selected puzzles from
 * multiple sets at once.
 *
 * Each selected puzzle gets its own config row. "Apply same settings to all
 * puzzles" is a convenience toggle that mirrors one shared set of values onto
 * every puzzle. Turning it back off pre-fills each puzzle with the last shared
 * values so nothing is lost.
 */
export default function AssignModal({ puzzleIds, applyToAll: applyToAllProp, onApplyToAllChange, onClose, onAssigned }) {
  const [students, setStudents] = useState([]);
  const [titles, setTitles] = useState([]);
  const [titleMap, setTitleMap] = useState(() => new Map());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  // applyToAll is controlled from the puzzle library toolbar (next to "Selected: X/100").
  const [applyToAll, setApplyToAllLocal] = useState(applyToAllProp ?? true);
  const applyToAllControlled = typeof applyToAllProp === 'boolean';
  const effectiveApplyToAll = applyToAllControlled ? applyToAllProp : applyToAll;
  function setApplyToAll(v) {
    if (applyToAllControlled) onApplyToAllChange(v);
    setApplyToAllLocal(v);
  }
  const [globalSettings, setGlobalSettings] = useState({ time: '', points: '10', attempts: '3', negativePoints: '0' });
  const [perPuzzle, setPerPuzzle] = useState(() => new Map());
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    Promise.all([
      api.get('/students'),
      puzzleIds.length ? api.get(`/puzzles/titles?ids=${puzzleIds.join(',')}`) : Promise.resolve({ data: { puzzles: [] } }),
    ])
      .then(([sRes, tRes]) => {
        if (!alive) return;
        setStudents(sRes.data || []);
        const list = tRes.data?.puzzles || [];
        setTitles(list);
        setTitleMap(new Map(list.map((p) => [p.id, p.title])));
      })
      .catch((e) => {
        if (!alive) return;
        setLoadError(e.response?.data?.message || e.message || 'Failed to load students');
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [puzzleIds]);

  /* Close on Escape */
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !working) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [working, onClose]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return students;
    return students.filter(
      (s) =>
        (s.name || '').toLowerCase().includes(q) ||
        (s.group_name || '').toLowerCase().includes(q) ||
        (s.email || '').toLowerCase().includes(q)
    );
  }, [students, search]);

  const allFilteredChecked = filtered.length > 0 && filtered.every((s) => selected.has(s.id));

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllFiltered() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredChecked) filtered.forEach((s) => next.delete(s.id));
      else filtered.forEach((s) => next.add(s.id));
      return next;
    });
  }

  /* Validation rules: time/points/negative >= 0 (empty time allowed), attempts >= 1. */
  const globalValid = useMemo(
    () =>
      numOk(globalSettings.time, { min: 0, allowEmpty: true }) &&
      numOk(globalSettings.points, { min: 0, allowEmpty: false }) &&
      numOk(globalSettings.attempts, { min: 1, allowEmpty: false }) &&
      numOk(globalSettings.negativePoints, { min: 0, allowEmpty: false }),
    [globalSettings]
  );

  const DEFAULT_CONFIG = { time: '', points: '10', attempts: '3', negativePoints: '0' };

  /* A puzzle's resolved config: global if applyToAll, otherwise its own row. */
  function cfgFor(id) {
    if (effectiveApplyToAll) return globalSettings;
    return perPuzzle.get(id) || { ...DEFAULT_CONFIG };
  }

  const perPuzzleValid = useMemo(() => {
    if (effectiveApplyToAll) return true;
    return puzzleIds.every((id) => {
      const c = cfgFor(id);
      return (
        numOk(c.time, { min: 0, allowEmpty: true }) &&
        numOk(c.points, { min: 0, allowEmpty: false }) &&
        numOk(c.attempts, { min: 1, allowEmpty: false }) &&
        numOk(c.negativePoints, { min: 0, allowEmpty: false })
      );
    });
  }, [effectiveApplyToAll, perPuzzle, puzzleIds]); // eslint-disable-line react-hooks/exhaustive-deps

  function setPerPuzzleField(id, field, value) {
    setPerPuzzle((prev) => {
      const next = new Map(prev);
      const existing = next.get(id) || { ...DEFAULT_CONFIG };
      next.set(id, { ...existing, [field]: value });
      return next;
    });
  }

  function setGlobalField(field, value) {
    setGlobalSettings((prev) => ({ ...prev, [field]: value }));
  }

  /* Turning the bulk toggle back OFF seeds each puzzle with the last shared values. */
  function toggleApplyToAll() {
    if (effectiveApplyToAll) {
      setPerPuzzle((prev) => {
        const next = new Map(prev);
        puzzleIds.forEach((id) => {
          if (!next.has(id)) next.set(id, { ...globalSettings });
        });
        return next;
      });
    }
    setApplyToAll(!effectiveApplyToAll);
  }

  const allValid = globalValid && perPuzzleValid;

  async function submit() {
    if (selected.size === 0) {
      setError('Select at least one student.');
      return;
    }
    if (!allValid) {
      setError('Fix the highlighted settings before assigning.');
      return;
    }
    setWorking(true);
    setError('');
    try {
      const records = [];
      for (const sid of [...selected]) {
        for (const pid of puzzleIds) {
          const c = cfgFor(pid);
          records.push({
            studentId: sid,
            puzzleId: pid,
            dueDate: dueDate || null,
            notes: notes.trim() || null,
            time: c.time === '' || c.time == null ? '' : parseInt(c.time, 10),
            points: parseInt(c.points, 10) || 10,
            attempts: parseInt(c.attempts, 10) || 1,
            negativePoints: parseInt(c.negativePoints, 10) || 0,
          });
        }
      }
      const res = await api.post('/puzzles/assign-to-students', { records });
      onAssigned(res.data);
    } catch (e) {
      setError(e.response?.data?.message || e.message || 'Assignment failed. Please try again.');
      setWorking(false);
    }
  }

  const globalField = (field) => ({
    value: globalSettings[field],
    onChange: (e) => setGlobalField(field, e.target.value),
  });

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={() => !working && onClose()}
    >
      <div
        className="chess-card max-w-2xl w-full flex flex-col max-h-[94vh] overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
        style={{ animation: 'board-pop .3s both' }}
      >
        <h3 className="font-display text-xl font-bold text-ivory-100 mb-1">
          Assign to Students
        </h3>
        <p className="text-sm text-ivory-500 mb-4">
          {puzzleIds.length} puzzle{puzzleIds.length !== 1 ? 's' : ''} → each selected student gets a personal assignment record.
        </p>

        {/* Student picker */}
        <div className="flex items-center gap-2 mb-3">
          <input
            autoFocus
            placeholder="Search students…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="chess-input !text-xs flex-1"
          />
          <Button
            type="button"
            onClick={toggleAllFiltered}
            disabled={filtered.length === 0}
            variant="secondary" size="sm" className="!px-3 !py-1.5 text-xs whitespace-nowrap disabled:opacity-40"
          >
            {allFilteredChecked ? 'Clear' : 'Select all'}
          </Button>
        </div>

        {loading ? (
          <Spinner text="Loading students…" />
        ) : loadError ? (
          <p className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-600">{loadError}</p>
        ) : filtered.length === 0 ? (
          <p className="text-center text-ivory-500 text-sm py-8">
            {students.length === 0 ? 'No students found. Register a student first.' : 'No students match your search.'}
          </p>
        ) : (
          <ul className="space-y-2 max-h-44 overflow-y-auto pr-1 mb-4">
            {filtered.map((s) => (
              <li key={s.id}>
                <label
                  className={`flex items-center gap-3 px-3 py-2 rounded-xl border transition cursor-pointer ${
                    selected.has(s.id)
                      ? 'border-gold-500/50 bg-gold-700/15'
                      : 'border-ivory-700/50 bg-black/[0.03] hover:border-ivory-700/60'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(s.id)}
                    onChange={() => toggle(s.id)}
                    className="accent-[#93c5fd] w-4 h-4"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ivory-300 truncate">{s.name}</p>
                    <p className="text-xs text-ivory-500">
                      {s.group_name ? s.group_name : ''}
                    </p>
                  </div>
                </label>
              </li>
            ))}
          </ul>
        )}

        {/* Due date + notes */}
        <div className="grid sm:grid-cols-2 gap-3 mb-4">
          <label className="block">
            <span className="block text-xs text-ivory-500 mb-1">Due date (optional)</span>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="chess-input !text-xs w-full"
            />
          </label>
          <label className="block">
            <span className="block text-xs text-ivory-500 mb-1">Notes (optional)</span>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. finish by Monday"
              className="chess-input !text-xs w-full"
            />
          </label>
        </div>

        {/* Per-puzzle settings */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-ivory-500">Puzzle settings</span>
            <label className="flex items-center gap-2 text-xs text-ivory-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={effectiveApplyToAll}
                onChange={toggleApplyToAll}
                className="accent-[#93c5fd] w-4 h-4"
              />
              Apply same settings to all puzzles
            </label>
          </div>

          {effectiveApplyToAll ? (
            <div className="rounded-xl border border-ivory-700/50 bg-black/[0.03] p-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Field label="Time limit (sec)" hint="blank = none" {...globalField('time')} invalid={!numOk(globalSettings.time, { min: 0, allowEmpty: true })} />
                <Field label="Points" hint="on solve" {...globalField('points')} invalid={!numOk(globalSettings.points, { min: 0, allowEmpty: false })} />
                <Field label="Max attempts" hint="≥ 1" {...globalField('attempts')} invalid={!numOk(globalSettings.attempts, { min: 1, allowEmpty: false })} />
                <Field label="Negative pts" hint="per wrong" {...globalField('negativePoints')} invalid={!numOk(globalSettings.negativePoints, { min: 0, allowEmpty: false })} />
              </div>
            </div>
          ) : (
            <ul className="space-y-2 max-h-40 overflow-y-auto pr-1">
              {puzzleIds.map((id) => {
                const c = cfgFor(id);
                const title = titleMap.get(id) || `Puzzle #${id}`;
                return (
                  <li key={id} className="rounded-xl border border-ivory-700/50 bg-black/[0.03] p-3">
                    <p className="text-xs font-medium text-ivory-300 truncate mb-2">{title}</p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <Field label="Time limit (sec)" hint="blank = none" value={c.time} onChange={(e) => setPerPuzzleField(id, 'time', e.target.value)} invalid={!numOk(c.time, { min: 0, allowEmpty: true })} />
                      <Field label="Points" hint="on solve" value={c.points} onChange={(e) => setPerPuzzleField(id, 'points', e.target.value)} invalid={!numOk(c.points, { min: 0, allowEmpty: false })} />
                      <Field label="Max attempts" hint="≥ 1" value={c.attempts} onChange={(e) => setPerPuzzleField(id, 'attempts', e.target.value)} invalid={!numOk(c.attempts, { min: 1, allowEmpty: false })} />
                      <Field label="Negative pts" hint="per wrong" value={c.negativePoints} onChange={(e) => setPerPuzzleField(id, 'negativePoints', e.target.value)} invalid={!numOk(c.negativePoints, { min: 0, allowEmpty: false })} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {error && (
          <p className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-2 text-sm text-red-600 mb-4">{error}</p>
        )}

        <div className="flex gap-3 mt-auto pt-2">
          <Button disabled={working} type="button" onClick={onClose} variant="secondary" size="md" className="flex-1">
            Cancel
          </Button>
          <Button
            disabled={working || selected.size === 0 || (!!error && !allValid)}
            type="button"
            onClick={submit}
            variant="primary" size="md" className="flex-1"
          >
            {working ? 'Assigning…' : `Assign to ${selected.size}`}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, value, onChange, invalid }) {
  return (
    <label className="block min-w-0">
      <span className="block text-[11px] text-ivory-500 mb-0.5">
        {label}
        {hint ? <em className="not-italic text-ivory-500/70"> ({hint})</em> : null}
      </span>
      <input
        inputMode="numeric"
        value={value}
        onChange={onChange}
        className={`chess-input !text-xs w-full ${invalid ? '!border-red-500/60' : ''}`}
      />
    </label>
  );
}