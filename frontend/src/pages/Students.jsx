import { useEffect, useState } from 'react';
import api from '../services/api';
import { PageHeader, Chip } from '../components/ui';
import { useToast } from '../components/Toast';
import StudentAvatar from '../components/StudentAvatar';
import { useAuth } from '../context/AuthContext';
import { useUrlView } from '../hooks/useUrlView';
import { BatchesPanel } from './Batches';
import { AdminsPanel } from './Admins';
import Button from '../components/Button';
import PhoneInput from '../components/PhoneInput';
import { formatPhoneDisplay, splitPhone, toE164 } from '../utils/phone';

const GENDERS = ['Male', 'Female', 'Non-binary', 'Prefer not to say'];
const LANGUAGES = ['English', 'Hindi', 'Tamil', 'Telugu', 'Kannada', 'Malayalam', 'Marathi', 'Bengali', 'Gujarati', 'Other'];

function Avatar({ s }) {
  if (s.avatar_config) {
    return <StudentAvatar config={s.avatar_config} seed={`user_${s.user_id || ''}`} size={32} className="ring-1 ring-white/15" />;
  }
  return s.profile_image ? (
    <img src={s.profile_image} alt="" className="w-8 h-8 rounded-full object-cover object-center ring-1 ring-white/15" />
  ) : (
    <span className="grid place-items-center w-8 h-8 rounded-full bg-[var(--ink-900)] ring-1 ring-white/10 text-xs font-bold text-gold-400">
      {(s.name || '?').trim().charAt(0).toUpperCase()}
    </span>
  );
}

export default function Students() {
  const { user } = useAuth();
  const isSuper = user?.role === 'superadmin';
  const [students, setStudents] = useState([]);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState('students');
  const [busyId, setBusyId] = useState(null);
  const [detailUrlId, setDetailUrlId] = useUrlView('student');
  const [detail, setDetail] = useState(null); // student row being viewed
  const [detailData, setDetailData] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [editOn, setEditOn] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [savingDetail, setSavingDetail] = useState(false);
  const [resending, setResending] = useState(false);
  const [groups, setGroups] = useState([]);
  const [coaches, setCoaches] = useState([]);
  const { showToast } = useToast();

  function load() {
    api.get(`/students${search ? `?search=${search}` : ''}`).then((res) => setStudents(res.data)).catch(() => {});
  }

  useEffect(load, [search]);

  useEffect(() => {
    if (!detailUrlId) { setDetail(null); setDetailData(null); setDetailLoading(false); return; }
    const s = students.find((x) => String(x.id) === String(detailUrlId));
    if (s) setDetail(s);
    setDetailLoading(true);
    setDetailData(null);
    api.get(`/students/${detailUrlId}`).then((res) => setDetailData(res.data)).catch(() => setDetailData(null)).finally(() => setDetailLoading(false));
  }, [detailUrlId, students]);

  useEffect(() => {
    api.get('/groups').then((res) => setGroups(res.data || [])).catch(() => {});
    api.get('/students/coaches').then((res) => setCoaches(res.data || [])).catch(() => {});
  }, []);

  async function openDetail(s) {
    setDetailUrlId(s.id);
  }

  /* Send the welcome mail again - with the login details in it.
     The old password cannot be sent (only its hash is stored), so a resend
     ISSUES A NEW TEMPORARY PASSWORD and the student is asked to change it at
     their next sign-in. The admin is warned before that happens. */
  async function resendEmail() {
    const d = detailData || detail;
    if (!d?.id) return;
    const ok = window.confirm(
      'Resending will reset the student\'s password.\n\n'
      + 'A new temporary password will be generated and emailed to them, and they '
      + 'will be asked to change it at their next sign-in.\n\n'
      + 'Send the mail now?',
    );
    if (!ok) return;
    setResending(true);
    try {
      const res = await api.post(`/students/${d.id}/resend-registration-email`);
      const mode = res.data?.mode;
      if (mode === 'dummy') {
        showToast('The mail was only printed to the server log (dummy transport) — nothing was sent.', {
          tone: 'warning',
          title: 'Email not sent',
        });
      } else {
        showToast(`Welcome mail sent to ${d.email || 'the student'} with a new temporary password.`, {
          tone: 'success',
          title: 'Email sent',
        });
      }
      return res;
    } catch (err) {
      const msg = err.response?.data?.message || 'The confirmation email could not be sent';
      showToast(msg, { tone: 'error', title: 'Email not sent' });
    } finally {
      setResending(false);
    }
  }

  function startEdit() {
    const d = detailData || detail;
    const phone = splitPhone(d?.phone, d?.country_code);
    setEditForm({
      name: d?.name || '',
      email: d?.email || '',
      countryCode: phone.countryCode,
      phoneNumber: phone.phoneNumber,
      nickname: d?.nickname || '',
      birthdate: d?.birthdate ? String(d.birthdate).slice(0, 10) : '',
      parentName: d?.parent_name || '',
      gender: d?.gender || '',
      preferredLanguage: d?.preferred_language || '',
      groupId: d?.group_id ? String(d.group_id) : '',
      coachIds: (d?.coaches || []).map((c) => String(c.id)),
      active: d?.active !== false,
    });
    setEditOn(true);
  }

  function cancelEdit() {
    setEditOn(false);
    setEditForm(null);
  }

  async function saveEdit(e) {
    e.preventDefault();
    if (!detail) return;
    setSavingDetail(true);
    try {
      const payload = {
        name: editForm.name,
        email: editForm.email,
        countryCode: editForm.countryCode,
        phoneNumber: editForm.phoneNumber,
        phone: toE164(editForm.countryCode, editForm.phoneNumber),
        active: editForm.active,
        nickname: editForm.nickname || undefined,
        birthdate: editForm.birthdate || undefined,
        parentName: editForm.parentName || undefined,
        gender: editForm.gender || undefined,
        preferredLanguage: editForm.preferredLanguage || undefined,
        groupId: editForm.groupId || null,
      };
      if (isSuper) payload.coachIds = editForm.coachIds || [];
      await api.put(`/students/${detail.id}`, payload);
      cancelEdit();
      await openDetail({ id: detail.id });
      load();
      showToast('Student details updated — changes are live.', {
        tone: 'success',
        title: 'Student updated',
      });
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to update student', {
        tone: 'error',
        title: 'Update failed',
      });
    } finally {
      setSavingDetail(false);
    }
  }

  async function toggleStatus(s) {
    setBusyId(s.id);
    try {
      await api.put(`/students/${s.id}`, { active: !s.active });
      setStudents((prev) => prev.map((x) => (x.id === s.id ? { ...x, active: !s.active } : x)));
    } catch (err) {
      alert(err.response?.data?.message || err.message || 'Failed to update status');
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id) {
    if (!confirm('Delete this student?')) return;
    await api.delete(`/students/${id}`);
    load();
  }

  return (
    <PageHeader title={isSuper ? 'Students & Admins' : 'Students & Batches'} icon="♙" subtitle={isSuper ? 'Manage students, their batches and coaching staff accounts in one place.' : 'Manage your student roster, batches and batch assignments in one place.'}> 
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div className="inline-flex rounded-lg overflow-hidden border border-ivory-700/50 bg-black/[0.03] p-0.5 text-sm font-semibold">
          <button
            onClick={() => setTab('students')}
            className={`px-4 py-1.5 rounded-md transition ${tab === 'students' ? 'bg-gold-500 text-ink-950' : 'text-ivory-500 hover:text-gold-400'}`}
          >
            ♟ Students
          </button>
          <button
            onClick={() => setTab('batches')}
            className={`px-4 py-1.5 rounded-md transition ${tab === 'batches' ? 'bg-gold-500 text-ink-950' : 'text-ivory-500 hover:text-gold-400'}`}
          >
            ♘ Batches
          </button>
          {isSuper && (
            <button
              onClick={() => setTab('admins')}
              className={`px-4 py-1.5 rounded-md transition ${tab === 'admins' ? 'bg-gold-500 text-ink-950' : 'text-ivory-500 hover:text-gold-400'}`}
            >
              ♖ Admins
            </button>
          )}
        </div>
        {tab === 'students' && (
          <input placeholder="Search students…" value={search} onChange={(e) => setSearch(e.target.value)}
            className="chess-input !w-full sm:!w-64" />
        )}
      </div>

      {tab === 'admins' && isSuper && <AdminsPanel />}

      {tab === 'batches' && <BatchesPanel />}

      {tab === 'students' && (
        <>
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
            {students.map((s, i) => (
              <tr key={s.id} style={{ animation: `fade-up .45s ${Math.min(i * 0.05, 0.5)}s both` }}>
                <td className="font-medium text-ivory-300">
                  <button
                    onClick={() => openDetail(s)}
                    className="flex items-center gap-2.5 hover:text-gold-400 transition-colors text-left"
                    title="View student details"
                  >
                    <Avatar s={s} />
                    <span className="flex flex-col">
                      <span>{s.name}</span>
                      <span className="text-xs text-ivory-500 font-normal">Details</span>
                    </span>
                  </button>
                </td>
                <td className="text-ivory-500">{s.email}</td>
                <td className="text-ivory-500">{s.group_name || '—'}</td>
                <td className="text-ivory-500">{(s.coaches && s.coaches.length) ? s.coaches.map((c) => c.name).join(', ') : (s.coach_name || '—')}</td>
                <td className="text-ivory-500">
                  <div className="flex items-center gap-2">
                    <Chip tone={s.active === false ? '' : 'green'}>{s.active === false ? 'Inactive' : 'Active'}</Chip>
                    {s.active === false && (
                      <Button
                        onClick={() => toggleStatus(s)}
                        disabled={busyId === s.id}
                        variant="primary" size="sm" className="!py-1 !px-2.5 !text-xs"
                      >
                        {busyId === s.id ? '…' : 'Set active'}
                      </Button>
                    )}
                  </div>
                </td>
                <td className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button
                      href={`/students/${s.id}/report`}
                      target="_blank"
                      rel="noopener noreferrer"
                      variant="primary" size="sm" className="!py-1.5 !px-3 !text-xs"
                    >
                      Report
                    </Button>
                    {isSuper && (
                      <Button onClick={() => remove(s.id)} variant="danger" size="sm" className="!py-1.5 !px-3 !text-xs">
                        Delete
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {students.length === 0 && (
              <tr>
                <td colSpan={6}><p className="chess-empty">No students found.</p></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {detail && (
        <div className="fixed inset-0 z-[var(--z-modal-backdrop)] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={() => window.history.back()}>
          <div className="chess-card w-full max-w-lg max-h-[85vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()} style={{ animation: 'board-pop .3s both' }}>
            <div className="flex items-start justify-between gap-3 mb-3">
              <h3 className="text-base font-bold text-ivory-300">Student details</h3>
              <button onClick={() => setDetail(null)} className="text-ivory-500 hover:text-ivory-300 text-xl leading-none" title="Close">✕</button>
            </div>

            {editOn && editForm ? (
              <EditDetailsForm form={editForm} setForm={setEditForm} onSave={saveEdit} onCancel={cancelEdit} saving={savingDetail} groups={groups} coaches={coaches} superAdmin={isSuper} />
            ) : detailLoading ? (
              <p className="text-sm text-ivory-500 py-8 text-center animate-pulse">Loading details…</p>
            ) : (
              <DetailContent d={detailData || detail} />
            )}

            <div className="flex justify-end gap-2 pt-3 mt-3 border-t border-ivory-700/50">
              <Button
                onClick={editOn ? cancelEdit : startEdit}
                variant="primary" size="md" className="!py-2 !px-4 text-sm"
              >
                {editOn ? '✕ Cancel edit' : '✎ Edit details'}
              </Button>
              {/* Send the registration confirmation again — for the student who
                  never got it, or whose address changed. Hidden while editing
                  (the address is being changed there) and when there is no
                  address to send to. */}
              {!editOn && (detailData || detail)?.email && (
                <Button
                  onClick={resendEmail}
                  disabled={resending}
                  variant="secondary" size="md" className="!py-2 !px-4 text-sm"
                  title="Send the registration confirmation email again"
                >
                  {resending ? 'Sending…' : '✉ Resend confirmation email'}
                </Button>
              )}
              <Button
                href={`/students/${(detailData || detail)?.id}/report`}
                target="_blank"
                rel="noopener noreferrer"
                variant="primary" size="md" className="!py-2 !px-4 text-sm"
              >
                Full report ↗
              </Button>
            </div>
          </div>
        </div>
      )}
        </>
      )}
    </PageHeader>
  );
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtAge(d) {
  if (!d) return '—';
  const b = new Date(d);
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  return age >= 0 ? `${age} years` : '—';
}

const EDIT_STYLE = { width: '100%' };

function LabeledField({ label, children }) {
  return (
    <label className="block">
      <span className="text-xs text-ivory-500">{label}</span>
      {children}
    </label>
  );
}

function EditDetailsForm({ form, setForm, onSave, onCancel, saving, groups, coaches, superAdmin }) {
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  return (
    <form onSubmit={onSave} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <LabeledField label="Full name *">
          <input required className="chess-input" value={form.name} onChange={set('name')} />
        </LabeledField>
        <LabeledField label="Email *">
          <input required type="email" className="chess-input" value={form.email} onChange={set('email')} />
        </LabeledField>
        <PhoneInput
          label="Phone"
          countryCode={form.countryCode}
          phoneNumber={form.phoneNumber}
          onChange={({ countryCode, phoneNumber }) => setForm({ ...form, countryCode, phoneNumber })}
          autoComplete="tel"
        />
        <LabeledField label="First name / nickname">
          <input className="chess-input" value={form.nickname} onChange={set('nickname')} />
        </LabeledField>
        <LabeledField label="Date of birth">
          <input type="date" className="chess-input" value={form.birthdate} onChange={set('birthdate')} />
        </LabeledField>
        <LabeledField label="Parent / guardian">
          <input className="chess-input" value={form.parentName} onChange={set('parentName')} />
        </LabeledField>
        <LabeledField label="Gender">
          <select className="chess-input" value={form.gender} onChange={set('gender')}>
            <option value="">Prefer not to say</option>
            {GENDERS.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </LabeledField>
        <LabeledField label="Preferred language">
          <select className="chess-input" value={form.preferredLanguage} onChange={set('preferredLanguage')}>
            <option value="">None set</option>
            {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </LabeledField>
        <LabeledField label="Status">
          <select className="chess-input" style={EDIT_STYLE} value={form.active ? 'true' : 'false'}
            onChange={(e) => setForm({ ...form, active: e.target.value === 'true' })}>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
        </LabeledField>
        <LabeledField label="Batch / Group">
          <select className="chess-input" style={EDIT_STYLE} value={form.groupId}
            onChange={(e) => setForm({ ...form, groupId: e.target.value })}>
            <option value="">No batch assigned</option>
            {groups.map((g) => <option key={g.id} value={String(g.id)}>{g.name}</option>)}
          </select>
        </LabeledField>
        {superAdmin && (
          <div className="sm:col-span-2">
            <span className="text-xs text-ivory-500 block">Assigned coaches (pick several)</span>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 pt-1.5">
              {coaches.map((c) => {
                const arr = form.coachIds || [];
                const on = arr.includes(String(c.id));
                return (
                  <label key={c.id} className="flex items-center gap-1.5 text-sm text-ivory-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          coachIds: e.target.checked ? [...arr, String(c.id)] : arr.filter((x) => x !== String(c.id)),
                        })
                      }
                      className="accent-gold-500"
                    />
                    {c.name}
                  </label>
                );
              })}
              {coaches.length === 0 && <span className="text-xs text-ivory-500">No coaches registered yet.</span>}
            </div>
          </div>
        )}
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" onClick={onCancel} variant="secondary" size="md" className="!py-2 !px-4 text-sm">Cancel</Button>
        <Button disabled={saving} variant="primary" size="md" className="!py-2 !px-4 text-sm">
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </form>
  );
}

function DetailContent({ d }) {
  const img = d?.profile_image;
  const name = d?.name || '—';
  const info = [
    ['Name', d?.name],
    ['First name / nickname', d?.nickname],
    ['Email', d?.email],
    ['Phone', formatPhoneDisplay(d?.phone, d?.country_code)],
    ['Parent / guardian', d?.parent_name],
    ['Date of birth', fmtDate(d?.birthdate)],
    ['Age', fmtAge(d?.birthdate)],
    ['Gender', d?.gender],
    ['Preferred language', d?.preferred_language],
    ['Batch / Group', d?.group_name],
    ['Status', d?.active === false ? 'Inactive' : 'Active'],
    ['Coach', (d?.coaches && d.coaches.length) ? d.coaches.map((c) => c.name).join(', ') : d?.coach_name],
    ['Member since', d?.joined_at ? fmtDate(d.joined_at) : '—'],
  ].filter(([, v]) => v != null && v !== '');

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex items-center gap-4 w-full">
        {img ? (
          <img src={img} alt="" className="w-20 h-20 rounded-2xl object-cover ring-2 ring-gold-500/40 shrink-0" />
        ) : (
          <span className="grid place-items-center w-20 h-20 rounded-2xl bg-[var(--ink-900)] ring-2 ring-gold-500/40 text-2xl font-bold text-gold-400 shrink-0">
            {(name || '?').trim().charAt(0).toUpperCase()}
          </span>
        )}
        <div className="min-w-0">
          <p className="font-display text-lg font-bold text-ivory-100 truncate">{name}</p>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {d?.group_name && <Chip>Batch · {d.group_name}</Chip>}
            <Chip tone={d?.active === false ? '' : 'green'}>{d?.active === false ? 'Inactive' : 'Active'}</Chip>
          </div>
        </div>
      </div>
      <div className="w-full">
        {info.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-4 py-2 border-b border-ivory-700/40 last:border-0">
            <span className="text-sm text-ivory-500">{label}</span>
            <span className="text-sm font-medium text-ivory-300 text-right">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}