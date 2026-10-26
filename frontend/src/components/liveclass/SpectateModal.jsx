import { useCallback, useEffect, useRef, useState } from 'react';
import Button from '../../components/Button';
import { listLiveSessions } from '../../utils/online';
import { useLiveClass } from '../../context/LiveClassContext';
import SpectatorBoard from '../SpectatorBoard';
import { on } from '../../services/socket';

const sessionKey = (s) => `${s.type}-${s.gameId || s.key}`;

/**
 * "Spectate students" button for the classroom header (instructor only).
 * Same `live-chip` look as the neighbouring header buttons, with a small
 * badge carrying the live-games count. Opens SpectateModal below.
 */
export function SpectateButton({ onClick }) {
  const { classMeta, isInstructor } = useLiveClass();
  const classId = classMeta?.id;
  const [count, setCount] = useState(0);

  const refreshCount = useCallback(async () => {
    if (!classId) return;
    try {
      const rows = await listLiveSessions();
      setCount((rows || []).filter((s) => s.status === 'active').length);
    } catch {
      /* transient — keep last count */
    }
  }, [classId]);

  useEffect(() => {
    if (!isInstructor) return undefined;
    refreshCount();
    const t = setInterval(refreshCount, 15000);
    return () => clearInterval(t);
  }, [isInstructor, refreshCount]);

  if (!isInstructor) return null;
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={onClick}
      title="Watch live student games"
    >
      👁 Spectate students
      <span className="spec-open-count" title={`${count} live game${count === 1 ? '' : 's'}`}>{count}</span>
    </Button>
  );
}

/**
 * Big spectate card (modal) for the live classroom.
 *
 * Overview: every live game as a compact board in ONE single row — player
 * names + clocks only, no move lists. Tapping a board opens that ONE game as
 * a big read-only spectate view (black + clock on top, board in the middle,
 * white + clock at the bottom, moves beside/below, Back to the row).
 * Boards update live; spectators can never move pieces.
 *
 * Real-time: subscribes to `pvp-pairing` (new games) and `pvp-finished`
 * (results) so the grid updates instantly without polling. A slow poll is
 * kept only as a safety net for events that were missed.
 */
export default function SpectateModal({ onClose }) {
  const { classMeta, isInstructor, participants } = useLiveClass();
  const classId = classMeta?.id;
  const [sessions, setSessions] = useState([]);
  const [selectedKey, setSelectedKey] = useState(null);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);
  const viewRef = useRef(null);
  const [viewW, setViewW] = useState(0);

  const memberIds = participants
    .filter((p) => p.status !== 'left' && p.roleInClass === 'student')
    .map((p) => p.userId);

  const apply = useCallback((rows) => {
    const live = (rows || []).filter((s) => s.status === 'active');
    const haveMembers = memberIds.length > 0;
    setSessions(
      haveMembers
        ? live.filter((s) => memberIds.includes(s.whiteId) || memberIds.includes(s.blackId))
        : live
    );
    setLoading(false);
  }, [memberIds]);

  const refresh = useCallback(async () => {
    try {
      const rows = await listLiveSessions();
      apply(rows);
    } catch {
      /* transient — last list stays */
    }
  }, [apply]);

  useEffect(() => {
    if (!classId || !isInstructor || !mountedRef.current) return;
    refresh();
    const t = setInterval(refresh, 10000);
    return () => {
      mountedRef.current = false;
      clearInterval(t);
    };
  }, [refresh]);

  /* Real-time: new games appear instantly when the instructor pairs students. */
  useEffect(() => {
    if (!classId || !isInstructor) return undefined;
    const offPairing = on('pvp-pairing', (payload) => {
      if (Number(payload?.classId) !== Number(classId)) return;
      const games = payload?.games || [];
      if (!games.length) return;
      setSessions((prev) => {
        const existing = new Set(prev.map(sessionKey));
        const fresh = games.filter((g) => !existing.has(sessionKey(g)));
        if (!fresh.length) return prev;
        const merged = [...prev, ...fresh];
        const ids = new Set(memberIds);
        return merged.filter((s) => ids.has(s.whiteId) || ids.has(s.blackId));
      });
    });
    /* Real-time: game results update instantly without waiting for the poll. */
    const offFinished = on('pvp-finished', (payload) => {
      if (Number(payload?.classId) !== Number(classId)) return;
      const gameId = Number(payload?.gameId);
      setSessions((prev) =>
        prev.map((s) =>
          Number(s.gameId) === gameId
            ? { ...s, status: 'finished', result: payload.result || s.result, resultReason: payload.reason || s.resultReason }
            : s
        )
      );
    });
    return () => {
      offPairing();
      offFinished();
    };
  }, [classId, isInstructor, memberIds]);

  /* Escape closes the card. */
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && onClose) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /* A selected game that ends/disappears drops back to the row. */
  const selected = sessions.find((s) => sessionKey(s) === selectedKey) || null;
  useEffect(() => {
    if (selectedKey && !selected) setSelectedKey(null);
  }, [selectedKey, selected]);

  /* Measure the detail viewer for a big-but-square board (re-runs on open). */
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

  if (!isInstructor) return null;
  /* Read-only view earns the space: use the measured pane width instead of
     the old 420px-capped ~70% thumbnail. Moves wrap below when needed. */
  const boardW = viewW > 0
    ? Math.max(220, Math.round(Math.min(720, viewW - 24)))
    : 420;

  return (
    <div className="spec-overlay spec-browse-overlay" onClick={onClose}>
      <div
        className="spec-card spec-browse-card"
        role="dialog"
        aria-modal="true"
        aria-label="Spectate students"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="spec-head">
          <span className="spec-title">👁 Spectate students</span>
          <span className="spec-chip">{selected ? 'LIVE' : `${sessions.length} live`}</span>
          <button type="button" className="spec-close" onClick={onClose} aria-label="Close spectate" title="Close">✕</button>
        </div>

        {!selected ? (
          <>
            <div className="spec-browse-bar">
              <span className="spec-browse-sub">
                {loading ? 'Loading…' : `${sessions.length} live game${sessions.length === 1 ? '' : 's'}`}
              </span>
              <Button type="button" variant="secondary" size="sm" onClick={refresh} title="Refresh">↻ Refresh</Button>
            </div>
            {sessions.length === 0 && !loading ? (
              <p className="spec-area-empty spec-browse-empty">No live games right now</p>
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
              <Button type="button" variant="secondary" size="sm" onClick={() => setSelectedKey(null)} aria-label="Back to live games" title="Back to live games">← Back</Button>
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
