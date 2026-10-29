import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../services/api';
import Button from '../components/Button';
import Pagination, { PAGE_SIZE } from '../components/Pagination';
import PlayerAvatar from '../components/PlayerAvatar';
import { useAuth } from '../context/AuthContext';
import { formatTime12 } from '../utils/time';
import { classDurationLabel } from '../utils/classTiming';

/* Finished classes, as cards. Everything on a card comes from the class row:
   the date and clock from class_date/start_time, the coach from coach_id, the
   roster from the class_students/batch scope, and the duration from the real
   started_at → ended_at pair (the scheduled window is only the fallback). */

/* The letter shown inside an avatar circle when the student has no picture
   (or its file no longer loads): the first letter of the name. */
function firstLetterOf(name) {
  const text = String(name || '').trim();
  return text ? text[0].toUpperCase() : '?';
}

/* A DATE column comes back as local midnight (serialised as the previous
   evening's UTC instant), so a full datetime is read through Date to keep the
   day the coach scheduled. A bare YYYY-MM-DD is built from parts for the same
   reason. */
function dateOf(value) {
  if (value == null || value === '') return null;
  const text = String(value).trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00`) : new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

/* Shared with the scheduled-classes list so both read one duration the same
   way. Exported from here rather than utils/ because these two lists are its
   only callers. */
export function minutesLabel(mins) {
  if (mins == null) return null;
  const total = Math.round(Number(mins));
  if (!Number.isFinite(total)) return null;
  if (total <= 0) return 'Less than a minute';
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  const hourText = hours ? `${hours} hour${hours === 1 ? '' : 's'}` : '';
  const minuteText = minutes ? `${minutes} min${minutes === 1 ? '' : 's'}` : '';
  return [hourText, minuteText].filter(Boolean).join(' ');
}

/* @param {Map} [props.pictures]  name → roster row, built from the same
   /students fields (profile_image, avatar_config) the leaderboard reads. The
   class payload names the roster but carries no pictures, so the stack gets
   them from here; a missing entry just means the circle keeps its letter. */
function CompletedClassCard({ row, menuOpen, onToggleMenu, onViewReport, onGoToAttendance, onDelete, canDelete, pictures }) {
  const date = dateOf(row.class_date);
  const weekday = date ? date.toLocaleDateString(undefined, { weekday: 'short' }) : '';
  const dateText = date
    ? date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
    : 'Date not recorded';
  const start = formatTime12(row.start_time, '');
  const duration = minutesLabel(row.duration_minutes) || classDurationLabel(row.start_time, row.end_time);
  const students = Array.isArray(row.student_list) ? row.student_list.filter(Boolean) : [];
  const shownStudents = students.slice(0, 4);
  const extraStudents = students.length - shownStudents.length;
  const playerOf = (name) => pictures?.get(String(name || '').toLowerCase());
  /* Every coach who is not the signed-in admin keeps the 🧑‍🏫 icon: the class
     payload carries no coach image field. */
  const coachPicture = playerOf(row.coach_name);

  return (
    <article className="xc-card">
      <div className="xc-body">
        <div className="xc-toprow">
          <p className="xc-date">
            {date ? (
              <>
                <span className="xc-day">{weekday && `${weekday}, `}{dateText}</span>
                {start && <span className="xc-time">· {start}</span>}
              </>
            ) : (
              <span className="xc-day">{dateText}</span>
            )}
          </p>
          <span className="xc-badge">✓ Completed</span>
        </div>

        <h3 className="xc-title">{row.title}</h3>

        <div className="xc-meta">
          <span className="xc-meta-item">
            {coachPicture ? (
              <span className="xc-avatar xc-avatar--single" title={row.coach_name}>
                <span className="xc-avatar-letter">{firstLetterOf(row.coach_name)}</span>
                <PlayerAvatar player={coachPicture} size={24} />
              </span>
            ) : (
              <span aria-hidden="true">🧑‍🏫</span>
            )}
            <span className="xc-meta-label">Coach</span>
            <strong>{row.coach_name || '—'}</strong>
          </span>
          {duration && (
            <span className="xc-meta-item">
              <span aria-hidden="true">⏱</span>
              <strong>{duration}</strong>
            </span>
          )}
          {row.topic && (
            <span className="xc-meta-item xc-meta-item--topic">
              <span aria-hidden="true">♟</span>
              <span className="xc-meta-label">{row.topic}</span>
            </span>
          )}
        </div>

        {students.length > 0 && (
          <div className="xc-students">
            <div className="xc-avatars" aria-hidden="true">
              {shownStudents.map((name) => (
                <span key={name} className="xc-avatar" title={name}>
                  <span className="xc-avatar-letter">{firstLetterOf(name)}</span>
                  {playerOf(name) && <PlayerAvatar player={playerOf(name)} size={24} />}
                </span>
              ))}
              {extraStudents > 0 && (
                <span className="xc-avatar xc-avatar--more" title={students.slice(4).join(', ')}>+{extraStudents}</span>
              )}
            </div>
            <p className="xc-student-names" title={students.join(', ')}>{students.join(', ')}</p>
          </div>
        )}
      </div>

      <div className="xc-actions">
        <Button variant="primary" size="sm" onClick={() => onViewReport(row.id)}>
          View Report
        </Button>
        <div className="xc-menu">
          <button
            type="button"
            className={`xc-menu-btn${menuOpen ? ' is-open' : ''}`}
            aria-label={`More actions for ${row.title}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={onToggleMenu}
          >
            ⋯
          </button>
          {menuOpen && (
            <div className="xc-menu-list" role="menu">
              <button type="button" role="menuitem" className="xc-menu-item" onClick={() => { onToggleMenu(); onViewReport(row.id); }}>
                📄 View report
              </button>
              <button type="button" role="menuitem" className="xc-menu-item" onClick={() => { onToggleMenu(); onGoToAttendance?.(row.id); }}>
                📋 Mark attendance
              </button>
              {row.class_type !== 'integrated' && row.meeting_url && (
                <a
                  role="menuitem"
                  className="xc-menu-item"
                  href={row.meeting_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={onToggleMenu}
                >
                  🔗 Open meeting link
                </a>
              )}
              {canDelete && (
                <button type="button" role="menuitem" className="xc-menu-item xc-menu-item--danger" onClick={() => { onToggleMenu(); onDelete(row); }}>
                  🗑 Delete class
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

export function CompletedClassesPanel({ onViewReport, onGoToAttendance, refreshKey = 0, active = true }) {
  const { user } = useAuth();
  const isSuper = user?.role === 'superadmin';
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openMenu, setOpenMenu] = useState(null);
  const listTopRef = useRef(null);
  const ticketRef = useRef(0);

  /* Student pictures. A class row only carries roster names, so the avatars
     read the same profile_image / avatar_config fields the leaderboard reads,
     from the /students roster this page already fetches — api.js shares an
     identical in-flight or cached GET, so this normally resolves from that
     response rather than the network. */
  const [roster, setRoster] = useState([]);
  useEffect(() => {
    let on = true;
    api.get('/students')
      .then((res) => { if (on) setRoster(Array.isArray(res.data) ? res.data : []); })
      .catch(() => { /* no pictures simply means the letters stay */ });
    return () => { on = false; };
  }, []);

  const pictures = useMemo(() => {
    const map = new Map();
    for (const s of roster) {
      const key = String(s.name || '').trim().toLowerCase();
      if (key && !map.has(key)) map.set(key, s);
    }
    /* The class payload has no coach image field, so a coach row can only show
       a picture when it is the signed-in admin's own class. */
    const mine = String(user?.name || '').trim().toLowerCase();
    if (mine && user?.profile_image && !map.has(mine)) map.set(mine, user);
    return map;
  }, [roster, user]);

  /* Typing narrows the server-side list after a short pause, so a long roster
     does not refetch on every keystroke. */
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 350);
    return () => clearTimeout(timer);
  }, [query]);

  const load = useCallback(async () => {
    const ticket = ++ticketRef.current;
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/classes', {
        params: { page, limit: PAGE_SIZE, status: 'completed', ...(search ? { q: search } : {}) },
        cache: false,
      });
      if (ticket !== ticketRef.current) return;
      const data = res.data || {};
      const list = Array.isArray(data) ? data : data.classes || [];
      setRows(list);
      setTotal(Array.isArray(data) ? list.length : data.total || 0);
      setTotalPages(Array.isArray(data) ? Math.max(1, Math.ceil(list.length / PAGE_SIZE)) : data.totalPages || 1);
      /* A search that empties the last page, or a stale deep link, is clamped
         by the server — follow it so the pager and the rows agree. */
      if (!Array.isArray(data) && data.page && data.page !== page) setPage(data.page);
    } catch (e) {
      if (ticket === ticketRef.current) {
        setError(e.response?.data?.message || e.response?.data?.error || 'Failed to load completed classes');
      }
    } finally {
      if (ticket === ticketRef.current) setLoading(false);
    }
  }, [page, search]);

  /* The panel stays mounted beside the other tabs, so it only loads once it
     has actually been shown — opening Classes & Attendance costs no request
     for a section the admin has not looked at. */
  useEffect(() => {
    if (!active) return;
    load();
  }, [load, refreshKey, active]);

  /* A class can be ended from the live room on another tab, so the list also
     refreshes itself while it is visible (and the moment the admin comes
     back). No full-page reload is needed to see it. */
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => { if (!document.hidden) load(); }, 20000);
    const onVisible = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [load, active]);

  useEffect(() => {
    if (openMenu == null) return undefined;
    const onDown = (event) => {
      if (!event.target.closest('.xc-menu')) setOpenMenu(null);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') setOpenMenu(null);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [openMenu]);

  function goToPage(next) {
    setPage(next);
    listTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function remove(row) {
    if (!window.confirm(`Delete "${row.title}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/classes/${row.id}`);
      load();
    } catch (e) {
      alert(e.response?.data?.message || e.response?.data?.error || 'Failed to delete class');
    }
  }

  return (
    <div className="xc-panel">
      <div className="xc-toolbar">
        <label className="xc-search">
          <span aria-hidden="true">🔍</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by class title, coach or student…"
            aria-label="Search completed classes"
          />
        </label>
        {!loading && !error && (
          <span className="xc-count">{total} completed {total === 1 ? 'class' : 'classes'}</span>
        )}
      </div>

      <div
        ref={listTopRef}
        className={`xc-list${loading && rows.length > 0 ? ' is-refreshing' : ''}`}
        aria-busy={loading || undefined}
      >
        {error ? (
          <div className="xc-state xc-state--error">
            <p>{error}</p>
            <Button variant="secondary" size="sm" onClick={load}>Retry</Button>
          </div>
        ) : loading && rows.length === 0 ? (
          <div className="xc-state"><p>Loading completed classes…</p></div>
        ) : rows.length === 0 ? (
          <div className="xc-state">
            <span className="xc-state-icon" aria-hidden="true">✓</span>
            <p>{search ? 'No completed classes match your search.' : 'No classes have been completed yet.'}</p>
          </div>
        ) : (
          rows.map((row) => (
            <CompletedClassCard
              key={row.id}
              row={row}
              menuOpen={openMenu === row.id}
              onToggleMenu={() => setOpenMenu((current) => (current === row.id ? null : row.id))}
              onViewReport={onViewReport}
              onGoToAttendance={onGoToAttendance}
              onDelete={remove}
              canDelete={isSuper || Number(row.coach_id) === Number(user?.id)}
              pictures={pictures}
            />
          ))
        )}
      </div>

      <Pagination
        currentPage={page}
        totalPages={totalPages}
        totalItems={total}
        pageSize={PAGE_SIZE}
        itemLabel="completed classes"
        onPageChange={goToPage}
      />
    </div>
  );
}

export default CompletedClassesPanel;
