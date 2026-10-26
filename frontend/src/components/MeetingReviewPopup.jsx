import { useEffect, useRef, useState } from 'react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { formatTime12 } from '../utils/time';
import Button from './Button';

/**
 * Meeting review popup — a right-hand slide-in card shown to a student right
 * after login when there's an online meeting available now or starting soon.
 *
 * Fetches the student's online classes and surfaces any that are `started`
 * (join now) or `starting-soon` (within 30 min). Shown once per login session;
 * auto-dismisses after a short delay or on manual close.
 */
export default function MeetingReviewPopup() {
  const { user } = useAuth();
  const isStudent = user?.role === 'student';
  const [meetings, setMeetings] = useState([]);
  const [open, setOpen] = useState(false);
  const firedFor = useRef(null);

  useEffect(() => {
    if (!isStudent) {
      setOpen(false);
      return;
    }
    // Only fire once per login session (keyed by user id + a session marker).
    const sessionKey = `meetreview-fired-${user.id}`;
    const already = sessionStorage.getItem(sessionKey);
    if (already && already === '1') return;
    let cancelled = false;

    api
      .get('/classes/online', { cache: false })
      .then((res) => {
        if (cancelled) return;
        const list = Array.isArray(res.data) ? res.data : [];
        const available = list.filter(
          (m) => m && m.meeting_url && (m.live_status === 'started' || m.live_status === 'starting-soon')
        );
        if (available.length === 0) return;
        if (firedFor.current && firedFor.current === user.id) return;
        firedFor.current = user.id;
        sessionStorage.setItem(sessionKey, '1');
        setMeetings(available.slice(0, 6));
        setOpen(true);
      })
      .catch(() => { });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStudent]);

  // Auto-dismiss after 14s once open.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => setOpen(false), 14000);
    return () => clearTimeout(t);
  }, [open]);

  if (!isStudent || !open || meetings.length === 0) return null;

  return (
    <div className="meetreview-wrap" role="dialog" aria-label="Available live meetings">
      <div className="meetreview-head">
        <span className="meetreview-title">
          <span className="text-gold-400">📹</span> Live now / starting soon
        </span>
        <button
          type="button"
          className="meetreview-close"
          onClick={() => setOpen(false)}
          title="Dismiss"
        >
          ✕
        </button>
      </div>
      <div className="meetreview-list">
        {meetings.map((m) => (
          <div key={m.id} className="meetreview-item">
            <div className="meetreview-item-main">
              <p className="meetreview-name">{m.title}</p>
              <p className="meetreview-meta">
                {m.live_status === 'started' ? '● In progress' : '● Starting soon'}
                {m.start_time ? ` · ${formatTime12(m.start_time, m.start_time)}` : ''}
              </p>
              {m.topic && <p className="meetreview-topic">{m.topic}</p>}
            </div>
            {/* Same tab, like every other section. onClick is required, not decoration: this
                popup is mounted globally in App, OUTSIDE the routed tree, so it
                survives navigation and would still be floating over the classroom
                the student just opened. */}
            {m.classroom_enabled !== false ? (
              <Button to={`/live-class/${m.id}`} onClick={() => setOpen(false)} variant="primary" size="sm">
                Join class
              </Button>
            ) : (
              <Button
                href={m.meeting_url}
                target="_blank"
                rel="noopener noreferrer"
                variant="primary"
                size="sm"
              >
                Join meeting
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
