import { useCallback, useEffect, useRef, useState } from 'react';
import Button from '../../components/Button';
import { useLiveClass } from '../../context/LiveClassContext';
import { getWatchableGames } from '../../services/liveClassApi';
import SpectatorBoard from '../SpectatorBoard';
import { on } from '../../services/socket';

const sessionKey = (s) => `${s.type}-${s.gameId || s.key}`;

/**
 * "Watch classmates" button for the classroom header (students only).
 *
 * Deliberately separate from the instructor's SpectateButton: this is shown
 * ONLY once the student's own game in the class has finished, and the count is
 * read from the class-scoped endpoint, which refuses while they are still
 * playing. Opening it reveals WatchClassmatesModal, which mirrors the
 * instructor's browse card.
 */
export function WatchClassmatesButton({ onClick }) {
  const { classMeta } = useLiveClass();
  const classId = classMeta?.id;
  const [count, setCount] = useState(0);

  const refreshCount = useCallback(async () => {
    if (!classId) return;
    try {
      const data = await getWatchableGames(classId);
      setCount((data?.sessions || []).filter((s) => s.status === 'active').length);
    } catch {
      /* transient / gated — keep the last count */
    }
  }, [classId]);

  useEffect(() => {
    refreshCount();
    const t = setInterval(refreshCount, 15000);
    return () => clearInterval(t);
  }, [refreshCount]);

  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={onClick}
      title="Watch your classmates' games"
    >
      👀 Watch classmates
      <span className="spec-open-count" title={`${count} live game${count === 1 ? '' : 's'}`}>{count}</span>
    </Button>
  );
}

/**
 * Student "watch classmates" card.
 *
 * Overview: the other students' boards in this class as compact thumbnails
 * (names + clocks). Tapping one opens a big read-only board (Back to the list).
 * Real-time: new pairings appear via `pvp-pairing`, results via `pvp-finished`,
 * and the view closes itself the instant the STUDENT IS PAIRED INTO A NEW GAME
 * (`pvp-started` / `spectate_closed`) — the anti-cheat rule is "watch only while
 * your own board is done". A slow poll is kept as a safety net.
 */
export default function WatchClassmatesModal({ onClose }) {
  const { classMeta, spectateEnabled, selfGameStatus } = useLiveClass();
  const classId = classMeta?.id;
  const [sessions, setSessions] = useState([]);
  const [selectedKey, setSelectedKey] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const viewRef = useRef(null);
  const [viewW, setViewW] = useState(0);

  const refresh = useCallback(async () => {
    if (!classId) return;
    try {
      const data = await getWatchableGames(classId);
      setSessions(data?.sessions || []);
      setError('');
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not load classmates');
    } finally {
      setLoading(false);
    }
  }, [classId]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 10000);
    return () => clearInterval(t);
  }, [refresh]);

  /* New pairings appear instantly; finished boards flip to their result. */
  useEffect(() => {
    if (!classId) return undefined;
    const offPairing = on('pvp-pairing', (payload) => {
      if (Number(payload?.classId) !== Number(classId)) return;
      const games = payload?.games || [];
      if (!games.length) return;
      setSessions((prev) => {
        const existing = new Set(prev.map(sessionKey));
        const fresh = games.filter((g) => !existing.has(sessionKey(g)));
        if (!fresh.length) return prev;
        return [...prev, ...fresh];
      });
    });
    const offFinished = on('pvp-finished', (payload) => {
      if (Number(payload?.classId) !== Number(classId)) return;
      setSessions((prev) => prev.map((s) => (
        sessionKey(s) === `online-${payload?.gameId}`
          ? { ...s, status: 'finished', result: payload?.result ?? s.result }
          : s
      )));
    });
    return () => {
      offPairing();
      offFinished();
    };
  }, [classId]);

  /* Close the moment we are no longer allowed to watch. */
  useEffect(() => {
    if (!classId) return undefined;
    const offs = [
      on('pvp-started', (payload) => {
        if (Number(payload?.classId) === Number(classId) && onClose) onClose();
      }),
      on('spectate_closed', (payload) => {
        if (Number(payload?.classId) === Number(classId) && onClose) onClose();
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [classId, onClose]);

  /* A selected game that disappears drops back to the row. */
  const selected = sessions.find((s) => sessionKey(s) === selectedKey) || null;
  useEffect(() => {
    if (selectedKey && !selected) setSelectedKey(null);
  }, [selectedKey, selected]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && onClose) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /* Measure the detail viewer for a big-but-square board. */
  useEffect(() => {
    if (!selected) return undefined;
    const el = viewRef.current;
    if (!el) return undefined;
    const measure = () => setViewW(el.clientWidth);
    measure();
    let ro;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(measure);
      ro.observe(el);
    }
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [selectedKey, selected]);

  const boardW = viewW > 0
    ? Math.max(220, Math.round(Math.min(720, viewW - 24)))
    : 420;

  return (
    <div className="spec-overlay spec-browse-overlay" onClick={onClose}>
      <div
        className="spec-card spec-browse-card"
        role="dialog"
        aria-modal="true"
        aria-label="Watch classmates"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="spec-head">
          <span className="spec-title">👀 Watch classmates</span>
          <span className="spec-chip">{selected ? 'LIVE' : `${sessions.length} live`}</span>
          <button type="button" className="spec-close" onClick={onClose} aria-label="Close" title="Close">✕</button>
        </div>

        {!selected ? (
          <>
            <div className="spec-browse-bar">
              <span className="spec-browse-sub">
                {loading ? 'Loading…' : `${sessions.length} game${sessions.length === 1 ? '' : 's'} to watch`}
              </span>
              <Button type="button" variant="secondary" size="sm" onClick={refresh} title="Refresh">↻ Refresh</Button>
            </div>
            {!spectateEnabled || selfGameStatus === 'playing' ? (
              <p className="spec-area-empty spec-browse-empty">
                {selfGameStatus === 'playing'
                  ? 'You are back on a board — finish your game to watch classmates again.'
                  : 'Watching classmates is turned off for this class.'}
              </p>
            ) : error ? (
              <p className="spec-area-empty spec-browse-empty">{error}</p>
            ) : sessions.length === 0 && !loading ? (
              <p className="spec-area-empty spec-browse-empty">No classmates are playing right now</p>
            ) : (
              <div className="spec-browse-row">
                {sessions.map((s) => (
                  <div
                    key={sessionKey(s)}
                    className="spec-browse-cell"
                    role="button"
                    tabIndex={0}
                    title={`Watch ${s.whiteName} vs ${s.blackName}`}
                    aria-label={`Watch ${s.whiteName} versus ${s.blackName}`}
                    onClick={() => setSelectedKey(sessionKey(s))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') setSelectedKey(sessionKey(s));
                    }}
                  >
                    <SpectatorBoard session={s} embedded compact lockBlackTop />
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="spec-browse-view" ref={viewRef}>
            <div className="spec-browse-gamebar">
              <Button type="button" variant="secondary" size="sm" onClick={() => setSelectedKey(null)} aria-label="Back to classmates" title="Back to classmates">← Back</Button>
              <span className="spec-browse-gamename">⚪ {selected.whiteName} vs ⚫ {selected.blackName}</span>
              <span className="live-session-live">LIVE</span>
            </div>
            <SpectatorBoard
              session={selected}
              boardWidth={viewW > 0 ? boardW : 294}
              bare
              lockBlackTop
              onClose={onClose}
            />
          </div>
        )}
      </div>
    </div>
  );
}
