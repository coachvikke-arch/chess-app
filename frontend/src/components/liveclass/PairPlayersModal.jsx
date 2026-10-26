import { useMemo, useState } from 'react';
import Button from '../Button';
import { createClassroomGames } from '../../utils/online';

/*
 * Instructor-only "Player vs Player" pairing modal (Chess.com classroom style).
 *
 * The instructor picks White/Black students per row, a time control, and
 * starts every pairing in one shot. Each created game notifies its two
 * players (pvp-started) and appears in the spectate list.
 */

const TC_PRESETS = [
  { label: '1+0', type: 'Bullet', baseMinutes: 1, incrementSeconds: 0 },
  { label: '3+2', type: 'Blitz', baseMinutes: 3, incrementSeconds: 2 },
  { label: '5+0', type: 'Blitz', baseMinutes: 5, incrementSeconds: 0 },
  { label: '10+0', type: 'Rapid', baseMinutes: 10, incrementSeconds: 0 },
  { label: '15+10', type: 'Rapid', baseMinutes: 15, incrementSeconds: 10 },
];

const emptyRow = () => ({ whiteId: '', blackId: '' });

export default function PairPlayersModal({ classId, students, onClose, onStarted }) {
  const [rows, setRows] = useState([emptyRow()]);
  const [tcIndex, setTcIndex] = useState(4);
  const [customBase, setCustomBase] = useState('5');
  const [customInc, setCustomInc] = useState('0');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const roster = useMemo(
    () => (students || []).map((p) => ({ id: Number(p.userId ?? p.id), name: p.name || 'Student' })),
    [students]
  );
  const nameOf = (id) => roster.find((r) => r.id === Number(id))?.name || '';

  const tc = tcIndex >= 0
    ? TC_PRESETS[tcIndex]
    : {
        label: `${Math.max(1, Number(customBase) || 5)}+${Math.max(0, Number(customInc) || 0)}`,
        type: 'Custom',
        baseMinutes: Math.max(1, Number(customBase) || 5),
        incrementSeconds: Math.max(0, Number(customInc) || 0),
      };

  const setRow = (i, patch) => {
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    setError('');
  };
  const addRow = () => setRows((prev) => [...prev, emptyRow()]);
  const removeRow = (i) => setRows((prev) => (prev.length > 1 ? prev.filter((_, j) => j !== i) : [emptyRow()]));
  const swapRow = (i) => setRows((prev) => prev.map((r, j) => (j === i ? { whiteId: r.blackId, blackId: r.whiteId } : r)));

  /* Fill empty rows with unpaired students, alternating colours. */
  const autoPair = () => {
    const used = new Set();
    rows.forEach((r) => {
      if (r.whiteId) used.add(Number(r.whiteId));
      if (r.blackId) used.add(Number(r.blackId));
    });
    const free = roster.map((r) => r.id).filter((id) => !used.has(id));
    setRows((prev) => {
      const next = prev.map((r) => ({ ...r }));
      let k = 0;
      for (const r of next) {
        if (!r.whiteId && k < free.length) r.whiteId = String(free[k++]);
        if (!r.blackId && k < free.length) r.blackId = String(free[k++]);
      }
      while (k + 1 < free.length) {
        next.push({ whiteId: String(free[k++]), blackId: String(free[k++]) });
      }
      if (k < free.length) next.push({ whiteId: String(free[k++]), blackId: '' });
      return next.length ? next : [emptyRow()];
    });
    setError('');
  };

  const valid = rows
    .map((r) => ({ whiteId: Number(r.whiteId), blackId: Number(r.blackId) }))
    .filter((r) => Number.isInteger(r.whiteId) && Number.isInteger(r.blackId) && r.whiteId !== r.blackId);

  const start = async () => {
    const seen = new Set();
    for (const r of valid) {
      if (seen.has(r.whiteId) || seen.has(r.blackId)) {
        setError('A student can only be in one pairing.');
        return;
      }
      seen.add(r.whiteId);
      seen.add(r.blackId);
    }
    if (valid.length === 0) {
      setError('Add at least one complete pairing (choose a White and a Black student).');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await createClassroomGames({
        classId,
        timeControl: { baseMinutes: tc.baseMinutes, incrementSeconds: tc.incrementSeconds },
        pairings: valid.map((r) => ({ whiteId: Number(r.whiteId), blackId: Number(r.blackId) })),
      });
      if (onStarted) onStarted(res.games || [], res.timeControl || tc);
      onClose();
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not start the pairings.');
    } finally {
      setBusy(false);
    }
  };

  const canStart = valid.length > 0 && !busy;

  return (
    <div className="live-drill-modal-backdrop" onClick={onClose}>
      <div className="live-drill-modal pvp-modal" onClick={(e) => e.stopPropagation()}>
        <div className="live-drill-modal-head">
          <span className="live-drill-modal-title">⚔ Pair players</span>
          <button type="button" className="live-drill-modal-x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p className="pvp-modal-sub">Pick White and Black for each board, choose a clock, start them all at once.</p>

        {/* 1 · Clock */}
        <div className="pvp-section">
          <span className="pvp-section-title">1 · Clock</span>
          <div className="pvp-tc-grid">
            {TC_PRESETS.map((t, i) => (
              <button
                key={t.label}
                type="button"
                className={`pvp-tc-card${tcIndex === i ? ' pvp-tc-on' : ''}`}
                onClick={() => setTcIndex(i)}
              >
                <span className="pvp-tc-label">{t.label}</span>
                <span className="pvp-tc-type">{t.type}</span>
              </button>
            ))}
          </div>
          <div className="pvp-custom">
            <label className="pvp-custom-field">
              <span>Minutes</span>
              <input
                type="number" min="1" max="120" value={customBase}
                onChange={(e) => { setCustomBase(e.target.value); setTcIndex(-1); }}
              />
            </label>
            <span className="pvp-custom-plus">+</span>
            <label className="pvp-custom-field">
              <span>Increment (sec)</span>
              <input
                type="number" min="0" max="60" value={customInc}
                onChange={(e) => { setCustomInc(e.target.value); setTcIndex(-1); }}
              />
            </label>
          </div>
        </div>

        {/* 2 · Pairings */}
        <div className="pvp-section pvp-section-grow">
          <div className="pvp-pairings-head">
            <span className="pvp-section-title">2 · Pairings</span>
            <Button type="button" variant="secondary" size="sm" onClick={autoPair} title="Fill rows with unpaired students">
              <span className="pvp-shuffle">🔀</span> Auto-pair
            </Button>
          </div>
          <div className="pvp-board-head">
            <span className="pvp-col">White</span>
            <span className="pvp-col" />
            <span className="pvp-col">Black</span>
            <span className="pvp-col" />
          </div>
          <div className="pvp-rows">
            {rows.map((r, i) => (
              <div key={i} className="pvp-row">
                <select value={r.whiteId} onChange={(e) => setRow(i, { whiteId: e.target.value })} aria-label={`Row ${i + 1} White`}>
                  <option value="">White…</option>
                  {roster.map((s) => (
                    <option key={s.id} value={s.id} disabled={Number(r.blackId) === s.id}>{s.name}</option>
                  ))}
                </select>
                <button type="button" className="pvp-swap" onClick={() => swapRow(i)} title="Swap colours">⇄</button>
                <select value={r.blackId} onChange={(e) => setRow(i, { blackId: e.target.value })} aria-label={`Row ${i + 1} Black`}>
                  <option value="">Black…</option>
                  {roster.map((s) => (
                    <option key={s.id} value={s.id} disabled={Number(r.whiteId) === s.id}>{s.name || nameOf(s.id)}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="pvp-del"
                  onClick={() => removeRow(i)}
                  disabled={rows.length <= 1 && !r.whiteId && !r.blackId}
                  title="Remove pairing"
                >✕</button>
              </div>
            ))}
          </div>
          <Button type="button" variant="secondary" size="sm" fullWidth onClick={addRow}>+ Add pairing</Button>
        </div>

        {error && <p className="chess-error">{error}</p>}
        <Button
          type="button"
          variant="primary"
          size="lg"
          fullWidth
          disabled={!canStart}
          onClick={start}
        >
          {busy ? 'Starting…' : canStart ? `Start ${valid.length} pairing${valid.length === 1 ? '' : 's'} · ${tc.label}` : 'Choose White and Black to start'}
        </Button>
      </div>
    </div>
  );
}
