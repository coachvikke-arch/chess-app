import { useOverlayHistory } from '../hooks/useOverlayHistory';
import { useEffect, useState } from 'react';
import api from '../services/api';
import { formatTime12 } from '../utils/time';
import PlayerAvatar from './PlayerAvatar';
import Button from './Button';

/* Flat blue/white only: status and attendance read as light-blue, outlined or
   muted pills — no greens, ambers or roses. */
const STATUS_BADGE = {
  scheduled: 'cdm-badge cdm-badge-plain',
  upcoming: 'cdm-badge cdm-badge-plain',
  live: 'cdm-badge cdm-badge-accent',
  completed: 'cdm-badge cdm-badge-accent',
  cancelled: 'cdm-badge cdm-badge-muted',
};
const STATUS_LABEL = { scheduled: 'Scheduled', live: '● LIVE', completed: '✓ Completed', cancelled: '✕ Cancelled' };

const ATTENDANCE_BADGE = {
  present: 'cdm-mark cdm-mark-present',
  late: 'cdm-mark cdm-mark-late',
  absent: 'cdm-mark cdm-mark-absent',
};

/* A DATE column reaches the client as local midnight serialised in UTC
   (e.g. "…T18:30:00.000Z" for IST), so slicing the string would print the
   previous day. Full timestamps are read through Date as well. */
function fmtDate(value) {
  if (!value) return '—';
  const text = String(value).trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00`) : new Date(text);
  if (Number.isNaN(date.getTime())) return text.slice(0, 10);
  return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
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
    <div className="cdm-overlay" onClick={onClose}>
      <div className="cdm-sheet" onClick={(e) => e.stopPropagation()}>
        {/* One header row: title and date/time on the left, status and close on
            the right. */}
        <header className="cdm-head">
          <div className="cdm-head-main">
            <h3 className="cdm-title">
              <span className="cdm-knight" aria-hidden="true">♘</span>
              <span className="cdm-title-text">{initial?.title || data?.title}</span>
            </h3>
            {data && (
              <p className="cdm-dateline">
                <span>{fmtDate(data.class_date)}</span>
                <span>·</span>
                <span>
                  {data.end_time
                    ? `${fmtTime(data.start_time)} → ${fmtTime(data.end_time)}`
                    : fmtTime(data.start_time)}
                </span>
              </p>
            )}
          </div>
          <div className="cdm-head-side">
            {data && (
              <span className={STATUS_BADGE[data.status] || 'cdm-badge cdm-badge-plain'}>
                {STATUS_LABEL[data.status] || data.status}
              </span>
            )}
            {/* A drawn cross, not the ✕ character, so it always renders and
                cannot be mistaken for the Absent mark. */}
            <Button
              onClick={onClose}
              variant="secondary"
              size="sm"
              className="cdm-close"
              title="Close"
              aria-label="Close"
              icon={<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">
                <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
              </svg>}
            />
          </div>
        </header>

        {loading && (
          <div className="cdm-loading">
            <span className="cdm-loading-mark" aria-hidden="true">♞</span>
            <p>Loading class details…</p>
          </div>
        )}
        {error && (
          <div className="cdm-error">{error}</div>
        )}

        {data && !loading && !error && (
          <div className="cdm-body">
            {/* auto-fit, not a fixed column count, so a long duration label or a
                narrow sheet wraps the cards onto a second row instead of
                letting them collide */}
            <div className="cdm-stats">
              {(actualDur != null || scheduledDur != null) && (
                <Stat
                  label={durationSuffix ? `Duration (${durationSuffix})` : 'Duration'}
                  value={fmtDuration(shownDur) || '—'}
                  sub={
                    data.started_at && data.ended_at
                      ? `Started ${fmtDate(data.started_at)} ${fmtTime(data.started_at)} · Ended ${fmtTime(data.ended_at)}`
                      : null
                  }
                />
              )}
              <Stat label="Students" value={data.students.length} />
              <Stat label="Present" value={showAttendance ? data.attendance.present : '—'} accent={showAttendance} />
              <Stat label="Late" value={showAttendance ? data.attendance.late : '—'} accent={showAttendance} />
              <Stat label="Absent" value={showAttendance ? data.attendance.absent : '—'} accent={showAttendance} />
            </div>

            <div className="cdm-meta">
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
              {data.group_name && <MetaTag icon="👥" label="Batch" value={data.group_name} />}
              {data.topic && <MetaTag icon="♟" label="Topic" value={data.topic} />}
            </div>

            {data.description && (
              <p className="cdm-note">
                <span className="cdm-note-label">📝 Description: </span>
                {data.description}
              </p>
            )}
            {data.meeting_url && (
              <a href={data.meeting_url} target="_blank" rel="noopener noreferrer" className="cdm-link">
                🔗 {data.meeting_url}
              </a>
            )}

            {/* The roster as one bordered card of single-line rows. */}
            <div className="cdm-roster">
              <div className="cdm-roster-head">
                <p className="cdm-roster-title">
                  👥 Allocated Students
                  <span className="cdm-roster-count"> ({data.students.length})</span>
                </p>
                {showAttendance && (
                  <div className="cdm-marks">
                    <span className="cdm-mark cdm-mark-present">✓ Present {data.attendance.present}</span>
                    <span className="cdm-mark cdm-mark-late">⏳ Late {data.attendance.late}</span>
                    <span className="cdm-mark cdm-mark-absent">✕ Absent {data.attendance.absent}</span>
                  </div>
                )}
              </div>
              {data.students.length === 0 ? (
                <p className="cdm-empty">No students allocated to this class yet.</p>
              ) : (
                <ul className="cdm-rows">
                  {data.students.map((s) => (
                    <li key={s.student_id} className="cdm-row">
                      <span className="cdm-row-avatar" title={s.name}>
                        <span className="cdm-row-letter">
                          {String(s.name || '').trim().charAt(0).toUpperCase() || '?'}
                        </span>
                        <PlayerAvatar player={s} seed={`student_${s.student_id || ''}`} size={24} />
                      </span>
                      <span className="cdm-row-who">
                        <span className="cdm-row-name">{s.name}</span>
                        <span className="cdm-row-sub">
                          {s.email}
                          {s.group_name ? ` · ${s.group_name}` : ''}
                        </span>
                      </span>
                      {showAttendance ? (
                        <span className={ATTENDANCE_BADGE[s.attendance] || ATTENDANCE_BADGE.absent}>
                          {s.attendance}
                        </span>
                      ) : (
                        <span className="cdm-mark cdm-mark-muted">—</span>
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

function Stat({ label, value, sub, accent }) {
  return (
    <div className={`cdm-stat${accent ? ' is-accent' : ''}`}>
      <p className="cdm-stat-label">{label}</p>
      <p className="cdm-stat-value">{value}</p>
      {sub && <p className="cdm-stat-sub">{sub}</p>}
    </div>
  );
}

function MetaTag({ icon, label, value, sub }) {
  return (
    <div className="cdm-fact">
      <p className="cdm-fact-label">{icon} {label}</p>
      <p className="cdm-fact-value">{value || '—'}</p>
      {sub && <p className="cdm-fact-sub">{sub}</p>}
    </div>
  );
}
