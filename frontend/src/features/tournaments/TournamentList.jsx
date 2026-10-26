import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listTournaments } from '../../services/tournamentsApi';
import { FORMAT_META, STATUS_META, fmtDateTime, timeControlLabel } from './tournamentUtils';
import TournamentFormModal from './TournamentFormModal';
import Pagination, { PAGE_SIZE } from '../../components/Pagination';
import { usePagination } from '../../hooks/usePagination';
import './tournaments.css';
import Button from '../../components/Button';
import usePageTitle from '../../hooks/usePageTitle';

const FILTERS = [['all', 'All'], ['active', 'Live'], ['upcoming', 'Upcoming'], ['completed', 'Finished']];

/* Shared by the coach page (admin = true) and the student page. */
export default function TournamentList({ admin }) {
  usePageTitle(admin ? 'Manage Tournaments' : 'Tournaments');
  const navigate = useNavigate();
  const base = admin ? '/admin' : '/student';
  const [items, setItems] = useState(null);
  const [filter, setFilter] = useState('all');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const listTopRef = useRef(null);

  const load = useCallback(() => {
    listTournaments().then((t) => { setItems(t); setError(''); }).catch(() => setError('Could not load tournaments.'));
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);

  const shown = (items || []).filter((t) => {
    if (filter === 'all') return true;
    if (filter === 'active') return t.status === 'active' || t.status === 'paused';
    if (filter === 'completed') return t.status === 'completed' || t.status === 'cancelled';
    return t.status === t.status && t.status === filter;
  });

  /* Each tab is a separate list: switching tabs starts at page 1. */
  const pager = usePagination(shown, PAGE_SIZE, {
    resetKeys: [filter],
    scrollRef: listTopRef,
  });

  return (
    <div className="tn-root">
      <div className="tn-head">
        <div>
          <div className="tn-title"><span className="tn-glyph">♛</span>Tournaments</div>
          <div className="tn-sub">{admin ? 'Run Swiss, Arena and Knockout events for your students.' : 'Join an event, get paired, and play it out live.'}</div>
        </div>
        <div className="tn-actions">
          {admin && <Button variant="primary" size="md" onClick={() => setCreating(true)}>+ New tournament</Button>}
        </div>
      </div>

      <div className="tn-tabs">
        {FILTERS.map(([k, label]) => (
          <button key={k} className={`tn-tab ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>{label}</button>
        ))}
      </div>

      {creating && (
        <TournamentFormModal
          inline
          onClose={() => setCreating(false)}
          onSaved={(t) => { setCreating(false); navigate(`${base}/tournaments/${t.id}`); }}
        />
      )}

      {error && <div className="tn-error">{error}</div>}
      {items === null && !error && <div className="tn-empty"><span className="big">♞</span>Loading tournaments…</div>}
      {items && shown.length === 0 && (
        <div className="tn-empty"><span className="big">🏆</span>
          {filter === 'all' ? (admin ? 'No tournaments yet - create the first one.' : 'No tournaments yet. Check back soon!') : 'Nothing here right now.'}
        </div>
      )}

      <div ref={listTopRef} className="tn-grid">
        {pager.currentItems.map((t) => {
          const fm = FORMAT_META[t.format] || FORMAT_META.swiss;
          const st = STATUS_META[t.status] || STATUS_META.upcoming;
          return (
            <button key={t.id} className="tn-card" onClick={() => navigate(`${base}/tournaments/${t.id}`)}>
              <div className="tn-card-top">
                <h3>{fm.icon} {t.name}</h3>
                <span className={`tn-chip ${st.tone}`}>{st.label}</span>
              </div>
              <div className="tn-meta">
                <span className="tn-chip blue">{fm.label}</span>
                <span className="tn-chip">{timeControlLabel(t)}</span>
                <span className="tn-chip">{t.playerCount}{t.maxPlayers ? `/${t.maxPlayers}` : ''} players</span>
                {t.format === 'swiss' && t.rounds ? <span className="tn-chip">{t.rounds} rounds</span> : null}
                {t.format === 'arena' && t.durationMinutes ? <span className="tn-chip">{t.durationMinutes} min</span> : null}
                {!admin && t.myStatus === 'active' && <span className="tn-chip live">You're in</span>}
              </div>
              <div className="tn-foot">
                <span>{t.status === 'completed' && t.winnerName ? `🏆 ${t.winnerName}` : t.startTime ? fmtDateTime(t.startTime) : 'No start time'}</span>
                <span>{t.status === 'active' && t.format !== 'arena' ? `Round ${t.currentRound}/${t.rounds || '?'}` : ''}</span>
              </div>
            </button>
          );
        })}
      </div>

      <Pagination
        currentPage={pager.currentPage}
        totalPages={pager.totalPages}
        totalItems={pager.totalItems}
        onPageChange={pager.setPage}
        itemLabel="tournaments"
      />
    </div>
  );
}
