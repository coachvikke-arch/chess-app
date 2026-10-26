import { useMemo, useState } from 'react';
import { manualPairing, errorMessage } from '../../services/tournamentsApi';
import Button from '../../components/Button';

/* Coach-only: pair two free, eligible players by hand (or give a bye). The server
   re-validates everything (eligibility, rematches, round rules). */
export default function ManualPairingPanel({ tournament, players, rounds, onDone, onError }) {
  const [white, setWhite] = useState('');
  const [black, setBlack] = useState('');
  const [busy, setBusy] = useState(false);

  const free = useMemo(() => {
    const busyIds = new Set();
    rounds.forEach((r) => r.pairings.forEach((p) => {
      if (!p.result) { if (p.white) busyIds.add(p.white.id); if (p.black) busyIds.add(p.black.id); }
    }));
    return players.filter((p) => p.status === 'active' && !busyIds.has(p.id));
  }, [players, rounds]);

  async function go(withBye) {
    setBusy(true);
    try {
      onDone(await manualPairing(tournament.id, Number(white), withBye ? null : Number(black)));
      setWhite(''); setBlack('');
    } catch (e) { onError(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <div className="tn-panel" style={{ marginBottom: 14 }}>
      <h3>Manual pairing</h3>
      <div className="tn-row">
        <div className="tn-field"><label>White</label>
          <select className="tn-select" value={white} onChange={(e) => setWhite(e.target.value)}>
            <option value="">Choose player…</option>
            {free.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.rating})</option>)}
          </select></div>
        <div className="tn-field"><label>Black</label>
          <select className="tn-select" value={black} onChange={(e) => setBlack(e.target.value)}>
            <option value="">Choose player…</option>
            {free.filter((p) => String(p.id) !== white).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.rating})</option>)}
          </select></div>
      </div>
      <div className="tn-actions">
        <Button variant="primary" size="md" disabled={busy || !white || !black} onClick={() => go(false)}>Pair these players</Button>
        {tournament.format !== 'arena' && <Button variant="secondary" size="md" disabled={busy || !white} onClick={() => go(true)}>Give White a bye</Button>}
      </div>
      {free.length === 0 && <div className="tn-sub" style={{ marginTop: 8 }}>No free players right now - everyone has an unfinished board.</div>}
    </div>
  );
}
