import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { Page, Chip, Spinner } from '../components/ui';
import { useToast } from '../components/Toast';
import StudentAvatar from '../components/StudentAvatar';
import { useAuth } from '../context/AuthContext';
import Button from '../components/Button';

function Avatar({ s, size = 32 }) {
  if (s.avatar_config) {
    return <StudentAvatar config={s.avatar_config} seed={`user_${s.user_id || ''}`} size={size} className="ring-1 ring-white/15" />;
  }
  return s.profile_image ? (
    <img src={s.profile_image} alt="" style={{ width: size, height: size }} className="rounded-full object-cover ring-1 ring-white/15" />
  ) : (
    <span
      style={{ width: size, height: size }}
      className="grid place-items-center rounded-full bg-[var(--ink-900)] ring-1 ring-white/10 text-xs font-bold text-gold-400"
    >
      {(s.name || '?').trim().charAt(0).toUpperCase()}
    </span>
  );
}

/**
 * Admin Reports — the assigned-students report table.
 *
 * The roster comes from `GET /api/students/assigned`, which the backend scopes:
 * a plain `admin` only ever receives the students assigned to them (primary
 * coach OR a `student_coaches` row), while a `superadmin` gets the whole
 * academy. So this page needs no client-side filtering to stay correct —
 * and deliberately does not try to re-filter, which would only risk hiding
 * rows the server already decided are permitted.
 */
export default function AdminReports() {
  const { user } = useAuth();
  const isSuper = user?.role === 'superadmin';
  const { showToast } = useToast();

  const [students, setStudents] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [busyId, setBusyId] = useState(null);
  const [confirmId, setConfirmId] = useState(null);

  function load() {
    api
      .get('/students/assigned')
      .then((res) => setStudents(Array.isArray(res.data) ? res.data : []))
      .catch((e) => {
        setStudents([]);
        showToast(e.response?.data?.message || 'Could not load the assigned students', { tone: 'error' });
      });
  }

  useEffect(load, []);

  const visible = useMemo(() => {
    if (!students) return [];
    const q = search.trim().toLowerCase();
    return students.filter((s) => {
      if (statusFilter === 'active' && s.active === false) return false;
      if (statusFilter === 'inactive' && s.active !== false) return false;
      if (!q) return true;
      return (
        (s.name || '').toLowerCase().includes(q) ||
        (s.email || '').toLowerCase().includes(q) ||
        (s.group_name || '').toLowerCase().includes(q)
      );
    });
  }, [students, search, statusFilter]);

  const counts = useMemo(() => {
    const all = students || [];
    return {
      total: all.length,
      active: all.filter((s) => s.active !== false).length,
      inactive: all.filter((s) => s.active === false).length,
    };
  }, [students]);

  async function setActive(s, next) {
    setBusyId(s.id);
    try {
      await api.put(`/students/${s.id}`, { active: next });
      setStudents((prev) => prev.map((x) => (x.id === s.id ? { ...x, active: next } : x)));
      showToast(`${s.name} is now ${next ? 'active' : 'inactive'}.`, { tone: 'success' });
    } catch (e) {
      showToast(e.response?.data?.message || 'Failed to update status', { tone: 'error' });
    } finally {
      setBusyId(null);
    }
  }

  async function remove(s) {
    setBusyId(s.id);
    try {
      await api.delete(`/students/${s.id}`);
      setStudents((prev) => prev.filter((x) => x.id !== s.id));
      showToast(`${s.name} was deleted.`, { tone: 'success' });
      setConfirmId(null);
    } catch (e) {
      showToast(e.response?.data?.message || 'Failed to delete student', { tone: 'error' });
    } finally {
      setBusyId(null);
    }
  }

  if (students === null) return <Page title="Admin Reports" piece="♞"><Spinner text="Loading assigned students…" /></Page>;

  return (
    <Page
      title="Admin Reports"
      piece="♞"
      sub={
        isSuper
          ? 'Every student in the academy — open a full report or manage the account.'
          : 'Students assigned to you — open a full report or manage the account.'
      }
    >
      {/* Toolbar */}
      <div className="chess-card mb-5">
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, email or batch…"
            className="chess-input !py-2 flex-1 min-w-[220px]"
          />
          <div className="flex items-center gap-1.5">
            {[
              ['all', `All (${counts.total})`],
              ['active', `Active (${counts.active})`],
              ['inactive', `Inactive (${counts.inactive})`],
            ].map(([key, label]) => (
              <button
                key={key}
                onClick={() => setStatusFilter(key)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${
                  statusFilter === key
                    ? 'bg-gold-500 text-ink-950'
                    : 'text-ivory-500 hover:text-gold-400'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="chess-table-wrap">
        <table className="chess-table">
          <thead>
            <tr>
              <th>Player</th>
              <th>Email</th>
              <th>Batch / Level</th>
              <th>Coach</th>
              <th>Status</th>
              <th className="text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((s, i) => (
              <tr key={s.id} style={{ animation: `fade-up .45s ${Math.min(i * 0.05, 0.5)}s both` }}>
                <td className="font-medium text-ivory-300">
                  <div className="flex items-center gap-2.5">
                    <Avatar s={s} />
                    <Link
                      to={`/students/${s.id}/report`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex flex-col hover:text-gold-400 transition-colors"
                      title="View student details"
                    >
                      <span>{s.name}</span>
                      <span className="text-xs text-ivory-500 font-normal">Details</span>
                    </Link>
                  </div>
                </td>
                <td className="text-ivory-500">{s.email}</td>
                <td className="text-ivory-500">{s.group_name || '—'}</td>
                <td className="text-ivory-500">
                  {(s.coaches && s.coaches.length)
                    ? s.coaches.map((c) => c.name).join(', ')
                    : (s.coach_name || '—')}
                </td>
                <td className="text-ivory-500">
                  <div className="flex items-center gap-2">
                    <Chip tone={s.active === false ? '' : 'green'}>{s.active === false ? 'Inactive' : 'Active'}</Chip>
                    {s.active === false && (
                      <Button
                        onClick={() => setActive(s, true)}
                        disabled={busyId === s.id}
                        variant="primary" size="sm" className="!py-1 !px-2.5 !text-xs"
                      >
                        {busyId === s.id ? '…' : 'Set active'}
                      </Button>
                    )}
                  </div>
                </td>
                <td className="text-right">
                  {confirmId === s.id ? (
                    /* Inline confirmation — a bare window.confirm() gave no way
                       to say WHICH student was about to be permanently removed. */
                    <div className="flex justify-end items-center gap-2">
                      <span className="text-xs text-ivory-400">Delete {s.name}?</span>
                      <Button
                        onClick={() => remove(s)}
                        disabled={busyId === s.id}
                        variant="danger" size="sm" className="!py-1.5 !px-3 !text-xs"
                      >
                        {busyId === s.id ? '…' : 'Yes, delete'}
                      </Button>
                      <Button
                        onClick={() => setConfirmId(null)}
                        disabled={busyId === s.id}
                        variant="primary" size="sm" className="!py-1.5 !px-3 !text-xs"
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <div className="flex justify-end gap-2">
                      <Button
                        href={`/students/${s.id}/report`}
                        target="_blank"
                        rel="noopener noreferrer"
                        variant="primary" size="sm" className="!py-1.5 !px-3 !text-xs"
                      >
                        Report
                      </Button>
                      <Button
                        onClick={() => setConfirmId(s.id)}
                        disabled={busyId === s.id}
                        variant="danger" size="sm" className="!py-1.5 !px-3 !text-xs"
                      >
                        Delete
                      </Button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={6}>
                  <p className="chess-empty">
                    {students.length === 0
                      ? 'No students assigned to you yet.'
                      : 'No students match your search.'}
                  </p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Page>
  );
}
