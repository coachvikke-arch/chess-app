import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { joinExternalClass, normalizeMeetingUrl } from '../services/liveClassApi';
import { Card, Spinner } from '../components/ui';
import Pagination, { PAGE_SIZE } from '../components/Pagination';
import { usePagination } from '../hooks/usePagination';
import { formatTime12 } from '../utils/time';
import { classDateParts, classDurationLabel } from '../utils/classTiming';
import Button from '../components/Button';
import usePageTitle from '../hooks/usePageTitle';

/* External Zoom / Meet classes live in their OWN section and never mix with the
   Integrated Live Classroom below, so building on one can't disturb the other. */

async function openExternalMeeting(m) {
  const win = window.open('', '_blank', 'noopener,noreferrer');
  let url = normalizeMeetingUrl(m.meeting_url);
  try {
    const res = await joinExternalClass(m.id);
    if (res?.meetingUrl) url = normalizeMeetingUrl(res.meetingUrl);
  } catch (e) {
    /* offline / attendance failure must not block joining the meeting */
  }
  if (!url) { win?.close(); return; }
  if (win && win.location) {
    win.location.href = url;
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

const statusStyles = {
  'starting-soon': 'border-amber-400/50 bg-amber-500/10 text-amber-600',
  started: 'border-red-400/50 bg-red-500/10 text-red-600',
  live: 'border-red-400/50 bg-red-500/10 text-red-600',
  upcoming: 'border-emerald-400/40 bg-emerald-500/10 text-emerald-600',
  completed: 'border-slate-400/40 bg-slate-500/10 text-slate-300',
  cancelled: 'border-rose-400/40 bg-rose-500/10 text-rose-600',
};
const statusLabel = {
  'starting-soon': '● Starting soon',
  started: '● In progress',
  live: '● LIVE',
  upcoming: 'Upcoming',
  completed: '✓ Completed',
  cancelled: '✕ Cancelled',
};

function SectionHeader({ icon, title, sub, count }) {
  return (
    <div className="mb-4">
      <h2 className="flex items-center gap-2 font-display text-xl font-bold text-ivory-300">
        <span className="text-2xl">{icon}</span> {title}
        <span className="text-xs font-semibold px-2.5 py-1 rounded-full border border-ivory-700/50 bg-black/[0.04] text-ivory-500">
          {count}
        </span>
      </h2>
      {sub && <p className="text-[0.82rem] text-ivory-500 mt-1">{sub}</p>}
    </div>
  );
}

function SectionEmpty({ text }) {
  return (
    <div className="chess-card text-center py-10">
      <span className="block text-4xl mb-2 text-gold-500/40">📅</span>
      <p className="chess-empty">{text}</p>
    </div>
  );
}

/* 12-hour clock without the leading zero: "03:30 PM" → "3:30 PM". */
function clock12(value) {
  return formatTime12(value, '').replace(/^0(?=\d)/, '');
}

/* What kind of room the class used. Shared by the live and completed cards so
   the explanation can never drift between them. */
function MeetingTypeNote({ isIntegrated, isExternal, usesClassroom }) {
  if (isIntegrated) {
    return (
      <p className="text-xs text-gold-500/80 mt-1">
        🖥 Integrated Live Classroom — opens right inside Mate Zone (board, chat and video in-app; no external link).
      </p>
    );
  }
  if (isExternal && usesClassroom) {
    return (
      <p className="text-xs text-gold-500/80 mt-1">
        🎨 External meeting video (Zoom / Meet) — the app board and chat run here; the video opens via the external link.
      </p>
    );
  }
  return (
    <p className="text-xs text-gold-500/80 mt-1">
      🔗 External meeting link (Zoom / Meet) — opens completely outside the app.
    </p>
  );
}

/* A finished class: the date and its weekday lead, then who taught it, when it
   ran and how long that was. Missing or unreadable timestamps simply drop their
   row instead of printing "Invalid Date" or a fake duration. */
function CompletedMeetingCard({ m }) {
  const date = classDateParts(m.class_date);
  const start = clock12(m.start_time);
  const end = clock12(m.end_time);
  const duration = classDurationLabel(m.start_time, m.end_time);
  const isIntegrated = m.class_type === 'integrated';

  return (
    <Card title={m.title} piece="✓">
      <div className="completed-class-date">
        {date ? (
          <>
            <span className="completed-class-date-badge">{date.label}</span>
            <span className="completed-class-weekday">{date.weekday}</span>
          </>
        ) : (
          <span className="completed-class-date-empty">Date not recorded</span>
        )}
      </div>

      <div className="completed-class-meta">
        {m.coach_name && (
          <p className="completed-class-meta-row">
            <span aria-hidden="true">🧑‍🏫</span>
            <span><strong className="text-gold-400">Coach:</strong> {m.coach_name}</span>
          </p>
        )}
        {(start || end) && (
          <p className="completed-class-meta-row">
            <span aria-hidden="true">🕒</span>
            <span>{start || '—'}{end ? ` – ${end}` : ''}</span>
          </p>
        )}
        {duration && (
          <p className="completed-class-meta-row">
            <span aria-hidden="true">⏱</span>
            <span><strong className="text-gold-400">Duration:</strong> {duration}</span>
          </p>
        )}
        {m.topic && (
          <p className="completed-class-meta-row">
            <span aria-hidden="true">♟</span>
            <span><strong className="text-gold-400">Topic:</strong> {m.topic}</span>
          </p>
        )}
      </div>

      {m.description && <p className="text-sm text-ivory-500 mt-2">{m.description}</p>}

      <MeetingTypeNote
        isIntegrated={isIntegrated}
        isExternal={!isIntegrated}
        usesClassroom={isIntegrated || m.classroom_enabled !== false}
      />

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <span className="text-[0.7rem] px-2.5 py-1 rounded-full border border-emerald-400/40 bg-emerald-500/10 text-emerald-600">
          ✓ Completed
        </span>
      </div>
    </Card>
  );
}

function MeetingCard({ m }) {
  const ls = m.live_status;
  const isLive = ls === 'live' || ls === 'started';
  const isIntegrated = m.class_type === 'integrated';
  const usesClassroom = isIntegrated || m.classroom_enabled !== false;
  const isExternal = !isIntegrated;

  if (ls === 'completed') return <CompletedMeetingCard m={m} />;

  return (
    <Card title={m.title} piece={isLive ? '🟢' : isIntegrated ? '🖥' : '🔗'}>
      <p className="text-sm text-ivory-500">
        {m.coach_name && <><span className="text-gold-400">Coach:</span> {m.coach_name}<br /></>}
        {m.topic && <><span className="text-gold-400">Topic:</span> {m.topic}<br /></>}
        {m.description && <><span className="text-ivory-500">{m.description}</span><br /></>}
        <span className="text-gold-400">When:</span> {m.class_date} at {formatTime12(m.start_time, m.start_time)}
        {m.end_time && <span className="text-ivory-500"> → {formatTime12(m.end_time, m.end_time)}</span>}
      </p>
      <MeetingTypeNote isIntegrated={isIntegrated} isExternal={isExternal} usesClassroom={usesClassroom} />
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {/* Same tab, like every other section. The classroom is an in-app route,
            so opening it in a new tab left the student with two copies of the app
            and a stale one they had to remember to close. The external meeting
            link below still opens in a new tab - that one leaves the app. */}
        {isLive && usesClassroom && (
          <Button to={`/live-class/${m.id}`} variant="primary" size="md" className="!px-5">
            {isIntegrated ? '🖥 Open Classroom' : '🎥 Join Classroom'}
          </Button>
        )}
        {isLive && isExternal && !usesClassroom && m.meeting_url && (
          <Button onClick={() => openExternalMeeting(m)} variant="primary" size="md" className="!px-5">
            📹 Join Meeting
          </Button>
        )}
        {!isLive && usesClassroom && ls === 'starting-soon' && (
          <span className="text-sm text-amber-600/80">👉 Join here when the instructor starts the class</span>
        )}
        <span className={`text-[0.7rem] px-2.5 py-1 rounded-full border ${statusStyles[ls] || statusStyles.upcoming}`}>
          {statusLabel[ls] || 'Upcoming'}
        </span>
      </div>
    </Card>
  );
}

export default function LiveMeetings() {
  usePageTitle('Live Meetings');
  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('live'); // 'live' | 'completed'

  useEffect(() => {
    api
      .get('/classes/online', { cache: false })
      .then((res) => setMeetings(Array.isArray(res.data) ? res.data : []))
      .catch((e) => setError(e.response?.data?.message || 'Failed to load live meetings'))
      .finally(() => setLoading(false));
  }, []);

  const inTab = (m) => {
    if (tab === 'completed') {
      return m.live_status === 'completed' || m.live_status === 'cancelled';
    }
    return m.live_status !== 'completed' && m.live_status !== 'cancelled';
  };

  const filtered = useMemo(() => meetings.filter(inTab), [meetings, tab]);
  const external = filtered;
  const listTopRef = useRef(null);

  /* Each tab is its own list, so a tab change starts again at page 1. */
  const pager = usePagination(external, PAGE_SIZE, {
    resetKeys: [tab],
    scrollRef: listTopRef,
  });

  const liveCount = meetings.filter((m) => m.live_status === 'live' || m.live_status === 'started' || (m.class_type === 'integrated' && m.status === 'live')).length;

  if (loading) return <Spinner />;

  return (
    <div className="max-w-5xl mx-auto">
      <header className="flex flex-wrap items-center gap-4 mb-6">
        <span className="text-5xl piece-glyph-spin text-gold-400">📹</span>
        <div>
          <h1 className="font-display text-3xl font-bold">Online Classes</h1>
          <p className="text-ivory-500 mt-1">
            Your scheduled online Zoom / Meet sessions.
          </p>
        </div>
      </header>

      {error && <div className="chess-card mb-4"><p className="chess-error">{error}</p></div>}

      <div className="flex items-center gap-2.5 mb-7 flex-wrap live-meeting-tabs">
        {[
          { id: 'live', label: `● Live${liveCount ? ` (${liveCount})` : ''}` },
          { id: 'completed', label: '✓ Completed' },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`live-tab ${tab === t.id ? 'live-tab-on' : ''}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="chess-card text-center py-14">
          <span className="block text-5xl mb-3 text-gold-500/40">📹</span>
          <p className="chess-empty">
            {tab === 'live' ? 'No live or scheduled classes for you right now.' : 'Nothing in this tab.'}
          </p>
        </div>
      ) : (
        <div className="space-y-10">
          {/* ── Section 1: External Meetings (Zoom / Meet) ── */}
          <section ref={listTopRef} className={external.length === 0 ? 'opacity-70' : undefined}>
            <SectionHeader
              icon="🔗"
              title="External Meetings (Zoom / Meet)"
              sub="These run outside the app — you may still get the shared board and chat inside Mate Zone, with video in the external tool."
              count={external.length}
            />
            {external.length === 0 ? (
              <SectionEmpty text="No external meetings in this tab." />
            ) : (
              <>
                <div className="space-y-4">
                  {pager.currentItems.map((m) => <MeetingCard key={m.id} m={m} />)}
                </div>
                <Pagination
                  currentPage={pager.currentPage}
                  totalPages={pager.totalPages}
                  totalItems={pager.totalItems}
                  onPageChange={pager.setPage}
                  itemLabel="meetings"
                />
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}