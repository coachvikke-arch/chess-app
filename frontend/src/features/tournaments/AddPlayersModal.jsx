import { useEffect, useState } from 'react';
import { StudentPicker } from './TournamentFormModal';
import { getStudentPool, addPlayers, errorMessage } from '../../services/tournamentsApi';
import Button from '../../components/Button';

export default function AddPlayersModal({ tournamentId, existingIds, onClose, onAdded }) {
  const [students, setStudents] = useState([]);
  const [picked, setPicked] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { getStudentPool().then(setStudents).catch(() => setErr('Could not load students')); }, []);
  async function go() {
    if (!picked.length) return;
    setBusy(true); setErr('');
    try { onAdded(await addPlayers(tournamentId, picked)); } catch (ex) { setErr(errorMessage(ex)); } finally { setBusy(false); }
  }
  const n = picked.length;
  return (
    <div className="tn-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="tn-modal tn-modal-flex" style={{ width: 'min(600px,100%)' }}>
        <div className="tn-modal-head">
          <h2>Add players</h2>
          <p className="tn-modal-sub">Search your students and tick everyone who should join this tournament.</p>
        </div>
        <div className="tn-modal-body">
          <StudentPicker students={students} selected={picked} onChange={setPicked} excludeIds={existingIds} />
          {err && <div className="tn-error">{err}</div>}
        </div>
        <div className="tn-modal-foot">
          <span className="tn-selected-count">{n} selected</span>
          <div className="tn-actions">
            <Button type="button" variant="secondary" size="md" onClick={onClose}>Cancel</Button>
            <Button type="button" variant="primary" size="md" disabled={busy || !n} onClick={go}>
              {busy ? 'Adding…' : n ? `Add ${n} player${n === 1 ? '' : 's'}` : 'Add players'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
