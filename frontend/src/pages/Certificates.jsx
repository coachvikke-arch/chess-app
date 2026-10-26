import { PageHeader, Card, Chip, Spinner } from '../components/ui';
import StudentAvatar from '../components/StudentAvatar';
import { listStudents } from '../services/certificatesApi';
import { useToast } from '../components/Toast';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Button from '../components/Button';
import { formatPhoneDisplay } from '../utils/phone';

/*
 * Certificates — Super Admin landing screen.
 *
 * A student list rather than a certificate list, because the unit of work is
 * "this student's certificates": the question an admin actually has is "who is
 * still missing one?", not "what was issued this month?".
 *
 * Each row surfaces the two states that need action:
 *   needsGeneration — the certificate row exists but its PDF failed
 *   pending         — generated but never opened in WhatsApp
 * and the phone rule, because a certificate that cannot be sent is a certificate
 * that is not really delivered.
 */
export default function Certificates() {
  const { showToast } = useToast();
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  async function load(term) {
    setLoading(true);
    try {
      setStudents(await listStudents(term));
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  /* Debounced so typing does not fire a request per keystroke. The api layer
     also caches GETs, but that cache is keyed on the URL and a changing search
     term is a changing URL. */
  useEffect(() => {
    const handle = setTimeout(() => load(search.trim()), search ? 300 : 0);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const totals = useMemo(() => ({
    students: students.length,
    pending: students.reduce((n, s) => n + s.pending, 0),
    needsGeneration: students.reduce((n, s) => n + s.needsGeneration, 0),
    uncontactable: students.filter((s) => s.total > 0 && !s.phoneValid).length,
  }), [students]);

  return (
    <PageHeader
      title="Certificates"
      icon="♕"
      subtitle="Level completions and tournament achievements. Certificates are issued automatically as students earn them."
      wide
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Stat label="Students" value={totals.students} icon="♙" />
        <Stat label="Awaiting send" value={totals.pending} icon="✈" />
        <Stat label="PDF failed" value={totals.needsGeneration} icon="⚠" tone="red" />
        <Stat label="No usable phone" value={totals.uncontactable} icon="☎" tone="amber" />
      </div>

      <div className="mb-4">
        <input
          className="chess-input w-full sm:w-80"
          placeholder="Search students…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search students"
        />
      </div>

      {loading && <Spinner text="Loading students…" />}
      {error && !loading && (
        <Card>
          <p className="text-sm text-red-400">{error}</p>
          <Button type="button" variant="primary" size="md" className="mt-3" onClick={() => load(search.trim())}>
            Try again
          </Button>
        </Card>
      )}

      {!loading && !error && students.length === 0 && (
        <Card>
          <p className="chess-empty">No students found.</p>
        </Card>
      )}

      {!loading && !error && students.length > 0 && (
        <Card>
          <div className="chess-table-wrap">
            <table className="chess-table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Phone</th>
                  <th className="text-right">Certificates</th>
                  <th className="text-right">Awaiting send</th>
                  <th className="text-right">PDF failed</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {students.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <div className="flex items-center gap-3">
                        <Avatar student={s} />
                        <span className="font-semibold text-ivory-300">{s.name}</span>
                      </div>
                    </td>
                    <td>
                      {s.phone ? (
                        <>
                          <span className="text-ivory-500">{formatPhoneDisplay(s.phone, s.country_code) || s.phone}</span>
                          {!s.phoneValid && (
                            <span className="block text-[0.7rem] text-amber-400 mt-0.5">
                              {s.phoneError}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-ivory-700">—</span>
                      )}
                    </td>
                    <td className="text-right">{s.total}</td>
                    <td className="text-right">
                      {s.pending > 0 ? <Chip tone="amber">{s.pending}</Chip> : <span className="text-ivory-700">0</span>}
                    </td>
                    <td className="text-right">
                      {s.needsGeneration > 0
                        ? <Chip tone="red">{s.needsGeneration}</Chip>
                        : <span className="text-ivory-700">0</span>}
                    </td>
                    <td className="text-right">
                      <Button variant="secondary" size="sm" className="!px-3 !py-1 text-xs" to={`/super/certificates/${s.id}`}>
                        Open
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </PageHeader>
  );
}

/* Same resolution order as Students.jsx: the generated chess avatar, then an
   uploaded photo, then a letter. Showing a bare letter while the rest of the app
   shows faces is what made this column look broken. */
function Avatar({ student }) {
  if (student.avatarConfig) {
    return (
      <StudentAvatar
        config={student.avatarConfig}
        seed={`user_${student.userId || ''}`}
        size={32}
        className="ring-1 ring-white/15 shrink-0"
      />
    );
  }
  if (student.profileImage) {
    return (
      <img
        src={student.profileImage}
        alt=""
        className="w-8 h-8 rounded-full object-cover ring-1 ring-white/15 shrink-0"
      />
    );
  }
  return (
    <span className="cert-avatar" aria-hidden="true">{student.initial}</span>
  );
}

/* Small local stat tile. The shared <Stat> has no tone, and these numbers are
   warnings as much as counts, so the tone matters here. */
function Stat({ label, value, icon, tone }) {
  const toneClass = tone === 'red'
    ? 'text-red-400'
    : tone === 'amber'
      ? 'text-amber-400'
      : 'text-gold-400';
  return (
    <div className="chess-stat">
      <span className="chess-stat-icon">{icon}</span>
      <p className="chess-stat-label">{label}</p>
      <p className={`chess-stat-value ${toneClass}`}>{value}</p>
    </div>
  );
}