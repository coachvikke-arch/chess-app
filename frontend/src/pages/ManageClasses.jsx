import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useUrlView } from '../hooks/useUrlView';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { PageHeader, Chip } from '../components/ui';
import ClassDetailModal from '../components/ClassDetailModal';
import Pagination, { PAGE_SIZE } from '../components/Pagination';
import { useAuth } from '../context/AuthContext';
import { startClass, endClass, cancelClass, normalizeMeetingUrl } from '../services/liveClassApi';
import { AttendancePanel } from './Attendance';
import { formatTime12 } from '../utils/time';
import Button from '../components/Button';

const TYPE_LIVE = 'integrated';   // Integrated Live Classroom (LiveKit + shared board)
const TYPE_EXTERNAL = 'external'; // Zoom / Google Meet link

export function ClassesPanel({ onGoToAttendance }) {
  const { user } = useAuth();
  const isSuper = user?.role === 'superadmin';
  const [classes, setClasses] = useState([]);
  const [students, setStudents] = useState([]);
  const [studentSearch, setStudentSearch] = useState('');
  const [selectedStudents, setSelectedStudents] = useState(() => new Set());
  const [studentsLoading, setStudentsLoading] = useState(false);
  const [studentsError, setStudentsError] = useState('');
  const [form, setForm] = useState({
    title: '',
    description: '',
    topic: '',
    classDate: '',
    startTime: '',
    endTime: '',
    meetingUrl: '',
    isOnline: true,
    classType: TYPE_EXTERNAL,
    status: 'scheduled',
    thumbnail: '',
    studentInteractionEnabled: false,
    classroomEnabled: true,
  });
  const [busyId, setBusyId] = useState(null);
  const [detailClassId, setDetailClassId] = useUrlView('class');
  const [groups, setGroups] = useState([]);
  const [selectedGroup, setSelectedGroup] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const [classesTotal, setClassesTotal] = useState(0);
  const [classesTotalPages, setClassesTotalPages] = useState(1);
  const [classesLoading, setClassesLoading] = useState(true);
  const [classesError, setClassesError] = useState('');
  const listTopRef = useRef(null);

  /* The page lives in the URL (?page=2), so a refresh, Back or a shared link
     lands on the same slice of the list. Page 1 is left implicit. */
  const pageFromUrl = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);

  function goToPage(next) {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (next <= 1) params.delete('page');
      else params.set('page', String(next));
      return params;
    });
    listTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* Normalises both response shapes: the paged object and the legacy bare
     array (returned when a caller omits page/limit). */
  function load(targetPage = pageFromUrl) {
    setClassesLoading(true);
    setClassesError('');
    api
      .get('/classes', { params: { page: targetPage, limit: PAGE_SIZE } })
      .then((res) => {
        const data = res.data;
        if (Array.isArray(data)) {
          const start = (targetPage - 1) * PAGE_SIZE;
          setClasses(data.slice(start, start + PAGE_SIZE));
          setClassesTotal(data.length);
          setClassesTotalPages(Math.max(1, Math.ceil(data.length / PAGE_SIZE)));
          return;
        }
        setClasses(data.classes || []);
        setClassesTotal(data.total || 0);
        setClassesTotalPages(data.totalPages || 1);
        /* The server clamps a stale page (e.g. after deleting the last class
           on the last page) — mirror that back into the URL so refresh/Back
           stay on the page the user is actually looking at. */
        const applied = data.page || 1;
        if (applied !== targetPage) {
          setSearchParams((prev) => {
            const params = new URLSearchParams(prev);
            if (applied <= 1) params.delete('page');
            else params.set('page', String(applied));
            return params;
          }, { replace: true });
        }
      })
      .catch((e) => setClassesError(e.response?.data?.message || 'Failed to load classes'))
      .finally(() => setClassesLoading(false));
  }

  function loadStudents() {
    setStudentsLoading(true);
    setStudentsError('');
    api
      .get('/students')
      .then((res) => setStudents(res.data || []))
      .catch((e) => setStudentsError(e.response?.data?.message || e.message || 'Failed to load students'))
      .finally(() => setStudentsLoading(false));
  }

  useEffect(() => {
    loadStudents();
    api.get('/groups').then((res) => setGroups(res.data || [])).catch(() => { });
  }, []);

  useEffect(() => {
    load(pageFromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageFromUrl]);

  const filteredStudents = useMemo(() => {
    const q = studentSearch.trim().toLowerCase();
    if (!q) return students;
    return students.filter(
      (s) =>
        (s.name || '').toLowerCase().includes(q) ||
        (s.group_name || '').toLowerCase().includes(q) ||
        (s.email || '').toLowerCase().includes(q)
    );
  }, [students, studentSearch]);

  const allFilteredChecked =
    filteredStudents.length > 0 && filteredStudents.every((s) => selectedStudents.has(s.id));

  function toggleStudent(id) {
    setSelectedStudents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllFiltered() {
    setSelectedStudents((prev) => {
      const next = new Set(prev);
      if (allFilteredChecked) filteredStudents.forEach((s) => next.delete(s.id));
      else filteredStudents.forEach((s) => next.add(s.id));
      return next;
    });
  }

  function resetForm() {
    setForm({
      title: '',
      description: '',
      topic: '',
      classDate: '',
      startTime: '',
      endTime: '',
      meetingUrl: '',
      isOnline: true,
      classType: TYPE_EXTERNAL,
      status: 'scheduled',
      thumbnail: '',
      studentInteractionEnabled: false,
      classroomEnabled: true,
    });
    setSelectedStudents(new Set());
  }

  async function createClass(e) {
    e.preventDefault();
    if (form.classType === TYPE_EXTERNAL && form.isOnline && !form.meetingUrl.trim()) {
      alert('Enter a meeting URL for an external online class.');
      return;
    }
    try {
      await api.post('/classes', {
        ...form,
        meetingUrl: normalizeMeetingUrl(form.meetingUrl),
        isOnline: form.isOnline,
        studentIds: [...selectedStudents],
        groupId: selectedGroup || null,
        classType: form.classType,
        status: form.status,
        thumbnail: form.thumbnail || null,
        studentInteractionEnabled: form.studentInteractionEnabled,
        classroomEnabled: form.classroomEnabled,
      });
      resetForm();
      setShowCreateForm(false);
      /* Newest first: a class created now belongs on page 1. Stepping the URL
         there reloads it through the normal fetch. */
      if (pageFromUrl !== 1) goToPage(1);
      else load(1);
    } catch (err) {
      alert(err.response?.data?.error || err.response?.data?.message || 'Failed to create class');
    }
  }

  async function remove(id) {
    if (!confirm('Delete this class?')) return;
    try {
      await api.delete(`/classes/${id}`);
      /* The existing page is reloaded rather than guessed at: if that delete
         emptied the last page the server clamps to the previous one and load
         mirrors it back into the URL. */
      load(pageFromUrl);
    } catch (err) {
      alert(err.response?.data?.message || err.response?.data?.error || 'Failed to delete class');
    }
  }

  async function runLifecycle(action, id) {
    setBusyId(id);
    try {
      if (action === 'start') await startClass(id);
      else if (action === 'end') await endClass(id);
      else if (action === 'cancel') await cancelClass(id);
      load(pageFromUrl);
    } catch (err) {
      alert(err.response?.data?.message || 'Action failed');
    } finally {
      setBusyId(null);
    }
  }

  const isIntegrated = form.classType === TYPE_LIVE;

  return (
    <>
      {!showCreateForm ? (
        <div className="chess-card mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="chess-card-title">
              <span className="chess-card-piece">♞</span>
              Ready to schedule a class?
            </h2>
            <p className="text-sm text-ivory-500 mt-1">
              Create a new live or external class and assign it to students or a batch.
            </p>
          </div>
          <Button
            type="button"
            onClick={() => setShowCreateForm(true)}
            variant="primary" size="md" className="shrink-0 justify-self-start"
          >
            ＋ Create Classroom
          </Button>
        </div>
      ) : (
        <>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-bold text-ivory-100">Create Classroom</h2>
              <p className="text-xs text-ivory-500 mt-0.5">Add the class details, schedule and student assignments.</p>
            </div>
            <Button
              type="button"
              onClick={() => {
                resetForm();
                setShowCreateForm(false);
              }}
              variant="secondary" size="md" className="shrink-0"
            >
              ← Cancel
            </Button>
          </div>
          <form onSubmit={createClass} className="chess-card mb-8 grid md:grid-cols-3 gap-3">
            {/* Class type */}
            <label className="text-sm text-ivory-300 flex flex-col gap-1">
              <span className="text-gold-400">Class type</span>
              <select
                value={form.classType}
                onChange={(e) => setForm({ ...form, classType: e.target.value })}
                className="chess-input"
              >
                <option value={TYPE_EXTERNAL}>🔗 External (Zoom / Meet)</option>
              </select>
            </label>

            {/* Status */}
            <label className="text-sm text-ivory-300 flex flex-col gap-1">
              <span className="text-gold-400">Status</span>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                className="chess-input"
              >
                <option value="scheduled">Scheduled</option>
                <option value="live">Live</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </label>

            <input required placeholder="Class title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="chess-input" />
            <input placeholder="Topic (e.g. Advanced Tactics)" value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} className="chess-input" />
            <textarea
              placeholder="Description (optional)"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="chess-input md:col-span-2 min-h-[3.5rem] resize-y"
            />
            <input type="date" required value={form.classDate} onChange={(e) => setForm({ ...form, classDate: e.target.value })} className="chess-input" />
            <input type="time" required value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} className="chess-input" />
            <input type="time" placeholder="End time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} className="chess-input" />

            {isIntegrated ? (
              <input
                placeholder="Optional thumbnail URL (topic image)"
                value={form.thumbnail}
                onChange={(e) => setForm({ ...form, thumbnail: e.target.value })}
                className="chess-input md:col-span-2"
              />
            ) : (
              <input
                required={form.isOnline}
                placeholder="Zoom / Google Meet link (https://…)"
                value={form.meetingUrl}
                onChange={(e) => setForm({ ...form, meetingUrl: e.target.value })}
                className="chess-input md:col-span-2 border-gold-500/40"
              />
            )}

            {!isIntegrated && (
              <label className="flex items-center gap-2 text-sm text-ivory-300 md:col-span-3">
                <input
                  type="checkbox"
                  checked={form.classroomEnabled}
                  onChange={(e) => setForm({ ...form, classroomEnabled: e.target.checked })}
                  className="accent-[#93c5fd] w-4 h-4"
                />
                <span className="text-gold-400">🎨</span> Integrated classroom (shared board + chat)
                <span className="text-ivory-500 text-xs">— students join in the app to share the board and chat</span>
              </label>
            )}

            <label className="flex items-center gap-2 text-sm text-ivory-300">
              <input
                type="checkbox"
                checked={form.isOnline}
                onChange={(e) => setForm({ ...form, isOnline: e.target.checked })}
                className="accent-[#93c5fd] w-4 h-4"
              />
              <span className="text-gold-400">📹</span> Online class
            </label>

            {isIntegrated && (
              <label className="flex items-center gap-2 text-sm text-ivory-300">
                <input
                  type="checkbox"
                  checked={form.studentInteractionEnabled}
                  onChange={(e) => setForm({ ...form, studentInteractionEnabled: e.target.checked })}
                  className="accent-[#93c5fd] w-4 h-4"
                />
                <span className="text-gold-400">♞</span> Allow students to make moves
              </label>
            )}

            {/* Assign to batch or to individual students */}
            <div className="md:col-span-3 rounded-xl border border-ivory-700/50 bg-black/[0.03] p-3">
              <div className="grid sm:grid-cols-2 gap-3 mb-2">
                <label className="block">
                  <span className="text-[0.7rem] uppercase tracking-wider text-ivory-500">Assign by batch (optional)</span>
                  <select
                    className="chess-input !py-1.5"
                    value={selectedGroup}
                    onChange={(e) => setSelectedGroup(e.target.value)}
                  >
                    <option value="">No batch — students only</option>
                    {groups.map((g) => (
                      <option key={g.id} value={String(g.id)}>
                        {g.name}{g.student_count ? ` (${g.student_count} students)` : ''}
                      </option>
                    ))}
                  </select>
                  {selectedGroup && (
                    <span className="text-[0.7rem] text-gold-400">
                      Class will appear for every student in this batch on their report &amp; dashboard.
                    </span>
                  )}
                </label>
                <div className="flex items-end justify-between gap-2">
                  <span className="text-sm font-medium text-ivory-300 mb-1 pb-1.5">
                    Assign to students{' '}
                    <span className="text-ivory-500 text-xs">
                      ({selectedStudents.size} selected {isIntegrated ? '· everyone else is excluded' : ''})
                    </span>
                  </span>
                  <Button
                    type="button"
                    onClick={toggleAllFiltered}
                    disabled={filteredStudents.length === 0}
                    variant="secondary" size="sm" className="!px-2.5 !py-1 text-xs whitespace-nowrap disabled:opacity-40 mb-1.5"
                  >
                    {allFilteredChecked ? 'Clear' : 'Select all'}
                  </Button>
                </div>
              </div>
              <input
                placeholder="Search students…"
                value={studentSearch}
                onChange={(e) => setStudentSearch(e.target.value)}
                className="chess-input !text-xs w-full mb-2"
              />
              {studentsLoading ? (
                <p className="text-xs text-ivory-500 py-2">Loading students…</p>
              ) : studentsError ? (
                <p className="text-xs text-red-600 py-2">{studentsError}</p>
              ) : (
                <ul className="grid sm:grid-cols-2 gap-1.5 max-h-44 overflow-y-auto pr-1">
                  {filteredStudents.map((s) => (
                    <li key={s.id}>
                      <label
                        className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg border transition cursor-pointer ${selectedStudents.has(s.id)
                            ? 'border-gold-500/50 bg-gold-700/15'
                            : 'border-ivory-700/50 bg-black/[0.03] hover:border-ivory-700/60'
                          }`}
                      >
                        <input
                          type="checkbox"
                          checked={selectedStudents.has(s.id)}
                          onChange={() => toggleStudent(s.id)}
                          className="accent-[#93c5fd] w-3.5 h-3.5"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-ivory-300 truncate">{s.name}</p>
                          <p className="text-[0.65rem] text-ivory-500 truncate">
                            {s.group_name ? s.group_name : '—'}
                          </p>
                        </div>
                      </label>
                    </li>
                  ))}
                  {filteredStudents.length === 0 && (
                    <li className="text-xs text-ivory-500 col-span-full py-2">
                      {students.length === 0 ? 'No students found. Register a student first.' : 'No students match your search.'}
                    </li>
                  )}
                </ul>
              )}
            </div>

            <Button variant="primary" size="md" className="md:col-span-3 md:w-48 justify-self-start">
              Schedule Class ♞
            </Button>
          </form>
        </>
      )}

      <div ref={listTopRef} className={`space-y-3 transition-opacity ${classesLoading ? 'opacity-60' : ''}`} aria-busy={classesLoading || undefined}>
        {classesError ? (
          <div className="chess-card">
            <p className="chess-empty text-red-600">{classesError}</p>
            <Button variant="secondary" size="sm" className="mt-2" onClick={() => load(pageFromUrl)}>
              Retry
            </Button>
          </div>
        ) : (
          <>
            {classesLoading && classes.length === 0 && (
              <div className="chess-card"><p className="chess-empty">Loading classes…</p></div>
            )}
            {classes.map((c) => (
          <div
            key={c.id}
            className="chess-card chess-card-hover flex flex-col items-stretch gap-4 lg:flex-row lg:justify-between lg:items-center cursor-pointer"
            onClick={() => setDetailClassId(c.id)}
          >
            <div className="min-w-0">
              <p className="font-medium text-ivory-100 flex items-center gap-2 flex-wrap">
                <span className="text-gold-400">♘</span>{c.title} — {c.topic}
                {c.class_type === 'integrated' && (
                  <span className="text-[0.6rem] px-2 py-0.5 rounded-full border border-gold-400/40 bg-gold-700/15 text-gold-500">
                    🎥 Live Classroom
                  </span>
                )}
                {c.is_online && (
                  <span className="text-[0.6rem] px-2 py-0.5 rounded-full border border-emerald-400/40 bg-emerald-500/10 text-emerald-700">
                    📹 Online
                  </span>
                )}
                {c.status === 'live' && (
                  <span className="live-badge live-badge-live">● LIVE</span>
                )}
                {c.status === 'completed' && (
                  <span className="live-badge live-badge-done">✓ Completed</span>
                )}
                {c.status === 'cancelled' && (
                  <span className="live-badge live-badge-cancel">✕ Cancelled</span>
                )}
                {c.status === 'scheduled' && (
                  <span className="live-badge live-badge-upcoming">⏱ Scheduled</span>
                )}
              </p>
              <p className="text-sm text-ivory-500 mt-1 flex items-center gap-1.5 flex-wrap">
                <span className="text-gold-400">⚑</span>{c.class_date} at {formatTime12(c.start_time, c.start_time)}
                {c.end_time && <span className="text-ivory-500">→ {formatTime12(c.end_time, c.end_time)}</span>}
                {c.description && <span className="text-ivory-500">· {c.description}</span>}
                {c.student_names
                  ? <Chip title={c.student_names}>· {Number(c.student_count) || 0} student{Number(c.student_count) !== 1 ? 's' : ''}</Chip>
                  : c.group_name && <Chip>· {c.group_name}</Chip>}
              </p>
              {c.class_type !== 'integrated' && c.meeting_url && (
                <p className="text-xs text-gold-500/80 mt-1 truncate max-w-md">
                  🔗 {c.meeting_url}
                </p>
              )}
            </div>
            <div className="grid w-full grid-cols-2 items-stretch gap-2 sm:flex sm:w-auto sm:flex-wrap sm:justify-end lg:shrink-0" onClick={(e) => e.stopPropagation()}>
              {c.status === 'scheduled' && (c.class_type === 'integrated' || (c.is_online && c.meeting_url)) && (
                <Button onClick={() => runLifecycle('start', c.id)} disabled={busyId === c.id}
                  variant="primary" size="sm" className="!py-1.5 !px-3 !text-xs">
                  {busyId === c.id ? 'Starting…' : '▶ Start Class'}
                </Button>
              )}
              {c.status === 'live' && (
                <>
                  {/* <Link>, not <a href>: an anchor to an in-app route does a full page load, so it
                  threw away the admin's session state and remounted the whole app bundle.
                  Same tab, like every other section. The external meeting link below
                  still opens in a new tab - that one leaves the app. */}
                  {c.class_type === 'integrated' || c.classroom_enabled !== false ? (
                    <Button to={`/live-class/${c.id}`} variant="primary" size="sm" className="!py-1.5 !px-3 !text-xs">
                      🎥 Open Classroom
                    </Button>
                  ) : (
                    <Button href={c.meeting_url} target="_blank" rel="noopener noreferrer" variant="primary" size="sm" className="!py-1.5 !px-3 !text-xs">
                      🔗 Open Meeting
                    </Button>
                  )}
                  <Button onClick={() => runLifecycle('end', c.id)} disabled={busyId === c.id}
                    variant="danger" size="sm" className="!py-1.5 !px-3 !text-xs">
                    {busyId === c.id ? 'Ending…' : '■ End Class'}
                  </Button>
                </>
              )}
              {(c.status === 'scheduled' || c.status === 'upcoming') && (
                <Button onClick={() => runLifecycle('cancel', c.id)} disabled={busyId === c.id}
                  variant="danger" size="sm" className="!py-1.5 !px-3 !text-xs">
                  Cancel
                </Button>
              )}
              <Button
                onClick={() => onGoToAttendance?.(c.id)}
                variant="primary" size="sm" className="!py-1.5 !px-3 !text-xs"
              >
                📋 Attendance
              </Button>
              {/* Only the class creator or the super admin may delete a class */}
              {(isSuper || c.coach_id === user?.id) && (
                <Button onClick={() => remove(c.id)}
                  variant="danger" size="sm" className="!py-1.5 !px-3 !text-xs">
                  Delete
                </Button>
              )}
            </div>
          </div>
        ))}
        {!classesLoading && classes.length === 0 && (
          <div className="chess-card">
            <p className="chess-empty">
              {classesTotal > 0 ? 'No classes on this page.' : 'No classes scheduled yet.'}
            </p>
          </div>
        )}
          </>
        )}
      </div>

      {!classesLoading && !classesError && (
        <Pagination
          currentPage={pageFromUrl}
          totalPages={classesTotalPages}
          totalItems={classesTotal}
          onPageChange={goToPage}
          itemLabel="classes"
        />
      )}

      {detailClassId && (
        <ClassDetailModal
          classId={detailClassId}
          /* The id is the class' own row id. The URL carries it as a STRING, so
             the lookup compares as strings - otherwise a reload or a deep link
             (?class=484) would not find the row it names. */
          initial={classes.find((c) => String(c.id) === String(detailClassId))}
          /* The ?class= entry IS this modal's history entry: the modal must not
             push a second one, or Back would step over the class list. */
          manageHistory={false}
          /* Closing REPLACES the entry, so Back returns to the class list
             instead of re-opening the class that was just closed. */
          onClose={() => setDetailClassId(null, { replace: true })}
        />
      )}
    </>
  );
}

/* Merged "Classes & Attendance" page — classes on one tab, the attendance
   register on the other. Clicking "Attendance" on a class jumps straight to
   that class in the register. */
export default function ManageClasses() {
  const [tab, setTab] = useState('classes');
  const [attendClassId, setAttendClassId] = useState(null);
  const [, setSearchParams] = useSearchParams();

  /* Switching tabs resets the class list to page 1, as requested. The page
     parameter belongs to the Classes tab, so it is dropped rather than left
     behind for the Attendance tab to inherit. */
  function selectTab(next) {
    if (next === tab) return;
    setTab(next);
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.delete('page');
      return params;
    }, { replace: true });
  }

  return (
    <PageHeader title="Classes & Attendance" icon="♘" subtitle="Schedule live classes and mark attendance from one place.">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div className="inline-flex rounded-lg overflow-hidden border border-ivory-700/50 bg-black/[0.03] p-0.5 text-sm font-semibold">
          <button
            onClick={() => selectTab('classes')}
            className={`px-4 py-1.5 rounded-md transition ${tab === 'classes' ? 'bg-gold-500 text-ink-950' : 'text-ivory-500 hover:text-gold-400'}`}
          >
            ♘ Classes
          </button>
          <button
            onClick={() => selectTab('attendance')}
            className={`px-4 py-1.5 rounded-md transition ${tab === 'attendance' ? 'bg-gold-500 text-ink-950' : 'text-ivory-500 hover:text-gold-400'}`}
          >
            📋 Attendance
          </button>
        </div>
      </div>

      {/* Both panels stay mounted so their state survives tab switches. */}
      <div className={tab === 'classes' ? '' : 'hidden'}>
        <ClassesPanel
          onGoToAttendance={(id) => {
            setAttendClassId(id);
            setTab('attendance');
          }}
        />
      </div>
      <div className={tab === 'attendance' ? '' : 'hidden'}>
        <AttendancePanel filterClassId={attendClassId} />
      </div>
    </PageHeader>
  );
}