import { useOverlayHistory } from '../hooks/useOverlayHistory';
import { useEffect, useState } from 'react';
import api from '../services/api';
import { Spinner } from './ui';
import { formatTime12 } from '../utils/time';
import Button from './Button';

const STATUS_BADGE = {
  scheduled: 'live-badge live-badge-upcoming',
  upcoming: 'live-badge live-badge-upcoming',
  live: 'live-badge live-badge-live',
  completed: 'live-badge live-badge-done',
  cancelled: 'live-badge live-badge-cancel',
};
const STATUS_LABEL = { scheduled: 'Scheduled', live: '● LIVE', completed: '✓ Completed', cancelled: '✕ Cancelled' };

const ATTENDANCE_BADGE = {
  present: 'bg-emerald-500/15 text-emerald-700 border border-emerald-400/40',
  late: 'bg-amber-500/15 text-amber-700 border border-amber-400/40',
  absent: 'bg-rose-500/15 text-rose-700 border border-rose-400/40',
};

function fmtDate(d) {
  if (!d) return '—';
  const s = String(d).slice(0, 10);
  const b = new Date(`${s}T00:00:00`);
  if (Number.isNaN(b.getTime())) return s;
  return b.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtTime(t) {
  if (!t) return '-';
  return formatTime12(t, String(t).slice(0, 5));
}

function fmtDuration(mins) {
  if (mins == null) return null;
  if (mins <= 0) return '< 1 min';
  if (mins >= 60) {
    const h = Math.floor(mins / 60);
    const r = mins % 60;
    return r ? `${h}h ${r}m` : `${h}h`;
  }
  return `${mins} min`;
}

/* @param {boolean} [props.manageHistory]  whether the modal pushes its own
   history entry so the browser Back button closes it. Set to false when the
   OPENING SURFACE already owns the URL (a ?class= parameter): the URL entry
   then IS the history entry, and a second one would make Back step over the
   class list the modal was opened from. */
export default function ClassDetailModal({ classId, initial, onClose, manageHistory = true }) {
  useOverlayHistory('ClassDetailModal', manageHistory, onClose);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let on = true;
    setLoading(true);
    setError('');
    api
      .get(`/classes/${classId}/detail`)
      .then((res) => { if (on) setData(res.data); })
      .catch((e) => { if (on) setError(e.response?.data?.message || e.message || 'Failed to load class details'); })
      .finally(() => { if (on) setLoading(false); });
    return () => { on = false; };
  }, [classId]);

  const showAttendance = data && (data.status === 'completed' || data.status === 'cancelled');
  const actualDur = data?.duration?.actual_minutes;
  const scheduledDur = data?.duration?.scheduled_minutes;
  const shownDur = actualDur != null ? actualDur : scheduledDur;
  const durationSuffix = actualDur != null ? 'actual' : scheduledDur != null ? 'scheduled' : null;

  return (
    <div className="fixed inset-0 z-[var(--z-modal-backdrop)] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className="chess-card w-full max-w-2xl max-h-[90vh] overflow-y-auto !rounded-2xl !shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-start justify-between gap-3 pb-3 border-b border-ivory-700/40">
          <div className="min-w-0">
            <p className="font-display font-bold text-ivory-100 text-xl flex items-center gap-2 flex-wrap">
              <span className="text-gold-400">♘</span>
              <span className="truncate">{initial?.title || data?.title}</span>
              {data && (
                <span className={STATUS_BADGE[data.status] || 'live-badge live-badge-upcoming'}>
                  {STATUS_LABEL[data.status] || data.status}
                </span>
              )}
            </p>
            <p className="text-sm text-ivory-500 mt-1 flex items-center gap-2 flex-wrap">
              {data?.coach_name && <span>Coach: <span className="text-gold-400">{data.coach_name}</span></span>}
              {data?.group_name && <span>· Batch: <span className="text-gold-400">{data.group_name}</span></span>}
              {data?.topic && <span>· {data.topic}</span>}
            </p>
          </div>
          <Button onClick={onClose} variant="secondary" size="md" className="!px-2.5 !py-1 text-sm shrink-0" title="Close">✕</Button>
        </div>

        {loading && <Spinner text="Loading class details…" />}
        {error && (
          <div className="p-6 text-center text-rose-600 font-medium">{error}</div>
        )}

        {data && !loading && !error && (
          <div className="pt-4 space-y-5">
            {/* schedule / meta */}
            <div className="grid sm:grid-cols-2 gap-3">
              <MetaTag icon="📅" label="Date" value={fmtDate(data.class_date)} />
              <MetaTag
                icon="⏰"
                label="Time"
                value={
                  data.end_time
                    ? `${fmtTime(data.start_time)} → ${fmtTime(data.end_time)}`
                    : `${fmtTime(data.start_time)}`
                }
              />
              <MetaTag
                icon={data.is_online ? '📹' : '🚪'}
                label="Type"
                value={[
                  data.class_type === 'integrated' ? 'Live Classroom' : data.is_online ? 'External Online' : 'In-person',
                  data.is_online ? ' · Online' : '',
                ].join('')}
              />
              <MetaTag
                icon="🧑‍🏫"
                label="Created by"
                value={data.coach_name || '—'}
                sub={data.coach_email}
              />
              {(actualDur != null || scheduledDur != null) && (
                <MetaTag
                  icon="🕒"
                  label={showAttendance ? `Duration (${durationSuffix})` : 'Duration'}
                  value={fmtDuration(shownDur)}
                  sub={
                    data.started_at && data.ended_at
                      ? `Started ${fmtDate(data.started_at)} ${fmtTime(data.started_at)} · Ended ${fmtTime(data.ended_at)}`
                      : null
                  }
                />
              )}
            </div>

            {data.description && (
              <p className="text-sm text-ivory-400 leading-relaxed">
                <span className="text-gold-400 font-semibold">📝 Description: </span>
                {data.description}
              </p>
            )}
            {data.meeting_url && (
              <a
                href={data.meeting_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-gold-500 underline truncate block"
              >
                🔗 {data.meeting_url}
              </a>
            )}

            {/* allocated students */}
            <div>
              <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                <p className="font-semibold text-ivory-100">
                  👥 Allocated Students
                  <span className="text-ivory-500 font-normal text-sm"> ({data.students.length})</span>
                </p>
                {showAttendance && (
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 border border-emerald-400/40">
                      ✓ Present {data.attendance.present}
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-700 border border-amber-400/40">
                      ⏳ Late {data.attendance.late}
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-700 border border-rose-400/40">
                      ✕ Absent {data.attendance.absent}
                    </span>
                  </div>
                )}
              </div>
              {data.students.length === 0 ? (
                <p className="text-sm text-ivory-500">No students allocated to this class yet.</p>
              ) : (
                <ul className="divide-y divide-ivory-700/30 border border-ivory-700/40 rounded-xl overflow-hidden bg-black/[0.03] max-h-64 overflow-y-auto">
                  {data.students.map((s) => (
                    <li key={s.student_id} className="flex items-center justify-between gap-3 px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-ivory-200 truncate">{s.name}</p>
                        <p className="text-xs text-ivory-500 truncate">
                          {s.email}
                          {s.group_name ? ` · ${s.group_name}` : ''}
                        </p>
                      </div>
                      {showAttendance ? (
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full capitalize whitespace-nowrap ${
                            ATTENDANCE_BADGE[s.attendance] || ATTENDANCE_BADGE.absent
                          }`}
                        >
                          {s.attendance}
                        </span>
                      ) : (
                        <span className="text-xs text-ivory-500 whitespace-nowrap">—</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MetaTag({ icon, label, value, sub }) {
  return (
    <div className="rounded-xl border border-ivory-700/40 bg-black/[0.03] px-3 py-2.5">
      <p className="text-[0.65rem] uppercase tracking-wider text-ivory-500">{icon} {label}</p>
      <p className="text-sm font-semibold text-ivory-200 mt-0.5">{value || '—'}</p>
      {sub && <p className="text-xs text-gold-500 mt-0.5">{sub}</p>}
    </div>
  );
}