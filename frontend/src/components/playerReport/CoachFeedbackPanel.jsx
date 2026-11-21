import React, { useEffect, useState } from 'react';
import { Card } from '../ui';
import { SkeletonRegion, SkeletonText } from '../skeleton';
import { getPlayerGameFeedback } from '../../services/playerReport';
import './playerReport.css';

/* New panel only. The existing Game Review page and GameViewerCard are not
 * changed: this panel calls our new backend endpoint and renders its own UI. */
export default function CoachFeedbackPanel({ game, studentId, onClose, onJumpToMove }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!game?.id) return undefined;
    let alive = true;
    setLoading(true);
    setError('');
    getPlayerGameFeedback(game.id, {
      studentId,
      source: game.platform || 'chesscom',
    })
      .then((res) => { if (alive) setData(res); })
      .catch((e) => { if (alive) setError(e?.response?.data?.message || 'Could not load coach feedback.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [game?.id, game?.platform, studentId]);

  if (!game) return null;

  const phase = data?.phaseAccuracy || {};
  const moments = Array.isArray(data?.criticalMoments) ? data.criticalMoments : [];

  return (
    <Card
      title={`Coach feedback · ${game.white_name || '?'} vs ${game.black_name || '?'}`}
      piece="💡"
      actions={<button type="button" className="pr-icon-btn" onClick={onClose} aria-label="Close coach feedback">✕</button>}
      className="pr-feedback-card"
    >
      {loading && (
        <SkeletonRegion label="Loading coach feedback" className="pr-skeleton-stack">
          <SkeletonText lines={2} />
          <SkeletonText lines={4} />
        </SkeletonRegion>
      )}
      {!loading && error && <p className="pr-inline-error">{error}</p>}
      {!loading && data && (
        <div className="pr-feedback-body">
          <p className="pr-feedback-summary">{data.coachSummary || 'No summary is available for this game yet.'}</p>
          <div className="pr-feedback-phases">
            {[['opening', 'Opening'], ['middlegame', 'Middlegame'], ['endgame', 'Endgame']].map(([key, label]) => (
              <span key={key} className="pr-feedback-phase">{label}: <strong>{phase[key] ?? '—'}%</strong></span>
            ))}
          </div>
          <h3 className="pr-subhead">Critical moments</h3>
          {moments.length === 0 ? (
            <p className="pr-muted">No critical moments were detected in this game.</p>
          ) : (
            <ul className="pr-moment-list">
              {moments.map((m, i) => (
                <li key={`${m.moveNumber}-${i}`} className="pr-moment">
                  <div className="pr-moment-top">
                    <span className="pr-moment-move">Move {m.moveNumber}{m.move ? ` · ${m.move}` : ''}</span>
                    <span className="pr-moment-type">{m.type || 'critical'}</span>
                  </div>
                  <div className="pr-moment-meta">
                    {m.evalSwing != null && <span>Eval swing {m.evalSwing}</span>}
                    {m.theme && <span>{m.theme}</span>}
                    {typeof onJumpToMove === 'function' && (
                      <button type="button" className="pr-link-btn" onClick={() => onJumpToMove(m.ply ?? m.moveNumber)}>
                        View move →
                      </button>
                    )}
                  </div>
                  <p className="pr-moment-text">{m.coachText}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}
