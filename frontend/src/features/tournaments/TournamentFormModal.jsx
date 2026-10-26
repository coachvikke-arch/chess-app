import { useEffect, useMemo, useState } from 'react';
import { FORMAT_META } from './tournamentUtils';
import { getStudentPool, createTournament, updateTournament, errorMessage } from '../../services/tournamentsApi';
import Button from '../../components/Button';

const toLocalInput = (d) => {
  if (!d) return '';
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}T${pad(x.getHours())}:${pad(x.getMinutes())}`;
};

export function StudentPicker({ students, selected, onChange, excludeIds = [] }) {
  const [q, setQ] = useState('');
  const list = useMemo(() => students
    .filter((s) => !excludeIds.includes(s.id))
    .filter((s) => `${s.name} ${s.group_name || ''}`.toLowerCase().includes(q.trim().toLowerCase())), [students, q, excludeIds]);
  const toggle = (id) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const allOn = list.length > 0 && list.every((s) => selected.includes(s.id));
  return (
    <div>
      <div className="tn-pick-search">
        <input className="tn-input" placeholder="Search students or batches…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button type="button" variant="secondary" size="sm" onClick={() => onChange(allOn ? selected.filter((id) => !list.some((s) => s.id === id)) : [...new Set([...selected, ...list.map((s) => s.id)])])}>
          {allOn ? 'Clear shown' : 'Select shown'}
        </Button>
      </div>
      <div className="tn-picker">
        {list.length === 0 && <div className="tn-empty" style={{ padding: 16 }}>No students found.</div>}
        {list.map((s) => {
          const on = selected.includes(s.id);
          return (
            <label className={`tn-pick ${on ? 'selected' : ''}`} key={s.id}>
              <input type="checkbox" checked={on} onChange={() => toggle(s.id)} />
              <span className="tn-pick-name">{s.name}</span>
              {s.group_name && <span className="tn-chip">{s.group_name}</span>}
              <span className="rt">{s.rating ?? '—'}</span>
            </label>
          );
        })}
      </div>
      <div className="tn-pick-foot"><small>{selected.length} selected</small></div>
    </div>
  );
}

const blank = {
  name: '', description: '', format: 'swiss', timeMinutes: 10, incrementSeconds: 0, rounds: '', durationMinutes: 60,
  startTime: '', maxPlayers: '', allowBerserk: true, allowDrawOffers: true, autoAdvance: true, selfRegister: true,
  autoStart: false, noShowSeconds: '', pairingMode: 'auto', transitionSeconds: '',
};

/* Create (no `tournament`) or edit (upcoming only) a tournament. */
export default function TournamentFormModal({ tournament, onClose, onSaved, inline }) {
  const editing = !!tournament;
  const [f, setF] = useState(() => (tournament ? {
    ...blank, ...tournament, startTime: toLocalInput(tournament.startTime),
    rounds: tournament.rounds ?? '', durationMinutes: tournament.durationMinutes ?? 60,
    maxPlayers: tournament.maxPlayers ?? '', noShowSeconds: tournament.noShowSeconds ?? '',
    pairingMode: tournament.pairingMode || 'auto', transitionSeconds: tournament.transitionSeconds ?? '',
  } : blank));
  const [students, setStudents] = useState([]);
  const [picked, setPicked] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => { if (!editing) getStudentPool().then(setStudents).catch(() => {}); }, [editing]);

  async function submit(e) {
    e.preventDefault();
    setErr('');
    if (!f.name.trim()) { setErr('Give the tournament a name.'); return; }
    setBusy(true);
    try {
      const body = {
        name: f.name.trim(), description: f.description, format: f.format,
        timeMinutes: Number(f.timeMinutes), incrementSeconds: Number(f.incrementSeconds || 0),
        rounds: f.format === 'swiss' && f.rounds !== '' ? Number(f.rounds) : null,
        durationMinutes: f.format === 'arena' ? Number(f.durationMinutes) : null,
        startTime: f.startTime ? new Date(f.startTime).toISOString() : null,
        maxPlayers: f.maxPlayers === '' ? null : Number(f.maxPlayers),
        allowBerserk: f.allowBerserk, allowDrawOffers: f.allowDrawOffers, autoAdvance: f.autoAdvance,
        selfRegister: f.selfRegister, autoStart: f.autoStart && !!f.startTime,
        noShowSeconds: f.noShowSeconds === '' ? null : Number(f.noShowSeconds),
        pairingMode: f.format === 'arena' ? 'auto' : f.pairingMode,
        transitionSeconds: f.transitionSeconds === '' ? null : Number(f.transitionSeconds),
      };
      const saved = editing ? await updateTournament(tournament.id, body) : await createTournament({ ...body, invitedStudentIds: picked });
      onSaved(saved);
    } catch (ex) {
      setErr(errorMessage(ex, 'Could not save the tournament'));
    } finally { setBusy(false); }
  }

  const form = (
    <form className={inline ? 'tn-form-inline' : 'tn-modal'} onSubmit={submit}>
      <h2>{editing ? 'Edit tournament' : 'Create tournament'}</h2>

      <div className="tn-formats">
        {Object.entries(FORMAT_META).map(([k, m]) => (
          <button type="button" key={k} className={`tn-format ${f.format === k ? 'on' : ''}`} onClick={() => set('format', k)}>
            <b>{m.icon} {m.label}</b><span>{m.blurb}</span>
          </button>
        ))}
      </div>

      <div className="tn-field"><label>Name</label>
        <input className="tn-input" value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Friday Blitz Cup" maxLength={200} /></div>
      <div className="tn-field"><label>Description (optional)</label>
        <textarea className="tn-textarea" rows={2} value={f.description || ''} onChange={(e) => set('description', e.target.value)} /></div>

      <div className="tn-row">
        <div className="tn-field"><label>Minutes per player</label>
          <input className="tn-input" type="number" min="1" max="180" value={f.timeMinutes} onChange={(e) => set('timeMinutes', e.target.value)} /></div>
        <div className="tn-field"><label>Increment (sec)</label>
          <input className="tn-input" type="number" min="0" max="180" value={f.incrementSeconds} onChange={(e) => set('incrementSeconds', e.target.value)} /></div>
        {f.format === 'swiss' && (
          <div className="tn-field"><label>Rounds</label>
            <input className="tn-input" type="number" min="1" max="30" value={f.rounds} onChange={(e) => set('rounds', e.target.value)} placeholder="auto" />
            <small>Blank = chosen from the player count.</small></div>
        )}
        {f.format === 'arena' && (
          <div className="tn-field"><label>Arena duration (min)</label>
            <input className="tn-input" type="number" min="5" max="720" value={f.durationMinutes} onChange={(e) => set('durationMinutes', e.target.value)} /></div>
        )}
        <div className="tn-field"><label>Max players</label>
          <input className="tn-input" type="number" min="2" max="500" value={f.maxPlayers} onChange={(e) => set('maxPlayers', e.target.value)} placeholder="no limit" /></div>
      </div>

      <div className="tn-row">
        <div className="tn-field"><label>Start time (optional)</label>
          <input className="tn-input" type="datetime-local" value={f.startTime} onChange={(e) => set('startTime', e.target.value)} /></div>
        <div className="tn-field"><label>No-show timer (sec)</label>
          <input className="tn-input" type="number" min="15" max="3600" value={f.noShowSeconds} onChange={(e) => set('noShowSeconds', e.target.value)} placeholder="60" />
          <small>How long a player has to open their board before forfeiting.</small></div>
      </div>

      {f.format !== 'arena' && (
        <div className="tn-row">
          <div className="tn-field"><label>Pairing mode</label>
            <select className="tn-select" value={f.pairingMode} onChange={(e) => set('pairingMode', e.target.value)}>
              <option value="auto">Automatic (server pairs every round)</option>
              <option value="manual">Manual (coach pairs each board)</option>
            </select></div>
          <div className="tn-field"><label>Pause between rounds (sec)</label>
            <input className="tn-input" type="number" min="0" max="600" value={f.transitionSeconds} onChange={(e) => set('transitionSeconds', e.target.value)} placeholder="10" />
            <small>Players see “Waiting for next pairing” during this pause.</small></div>
        </div>
      )}

      <div className="tn-toggles">
        <label className="tn-toggle"><input type="checkbox" checked={f.autoStart} disabled={!f.startTime} onChange={(e) => set('autoStart', e.target.checked)} /><span>Start automatically at the start time</span></label>
        <label className="tn-toggle"><input type="checkbox" checked={f.selfRegister} onChange={(e) => set('selfRegister', e.target.checked)} /><span>Students can join themselves</span></label>
        <label className="tn-toggle"><input type="checkbox" checked={f.allowDrawOffers} onChange={(e) => set('allowDrawOffers', e.target.checked)} /><span>Allow draw offers</span></label>
        {f.format === 'swiss' && <label className="tn-toggle"><input type="checkbox" checked={f.autoAdvance} onChange={(e) => set('autoAdvance', e.target.checked)} /><span>Start the next round automatically</span></label>}
        {f.format === 'arena' && <label className="tn-toggle"><input type="checkbox" checked={f.allowBerserk} onChange={(e) => set('allowBerserk', e.target.checked)} /><span>Allow Berserk (half the time, bonus point for a win)</span></label>}
      </div>

      {!editing && (
        <div className="tn-field"><label>Invite students</label>
          <StudentPicker students={students} selected={picked} onChange={setPicked} /></div>
      )}

      {err && <div className="tn-error">{err}</div>}
      <div className="tn-actions" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
        <Button type="button" variant="secondary" size="md" onClick={onClose}>Cancel</Button>
        <Button variant="primary" size="md" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Create tournament'}</Button>
      </div>
    </form>
  );

  return inline ? form : (
    <div className="tn-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      {form}
    </div>
  );
}
