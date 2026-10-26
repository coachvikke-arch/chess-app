import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { PageHeader, Chip } from '../components/ui';
import { useToast } from '../components/Toast';
import Button from '../components/Button';
import PhoneInput from '../components/PhoneInput';
import { formatPhoneDisplay, splitPhone, toE164 } from '../utils/phone';

export function AdminsPanel() {
  const [admins, setAdmins] = useState([]);
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState(null);
  const [detailData, setDetailData] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [editOn, setEditOn] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [savingDetail, setSavingDetail] = useState(false);
  // Student-assignment management
  const [adminStudents, setAdminStudents] = useState([]);
  const [studentsLoading, setStudentsLoading] = useState(false);
  const [allStudents, setAllStudents] = useState([]);
  const [assignId, setAssignId] = useState('');
  const [busyStudent, setBusyStudent] = useState(null);
  const { showToast } = useToast();

  function load() {
    api.get(`/students/coaches${search ? `?search=${search}` : ''}`).then((res) => setAdmins(res.data)).catch(() => {});
  }

  useEffect(load, [search]);

  async function openDetail(a) {
    setDetail(a);
    setDetailData(null);
    setDetailLoading(true);
    setEditOn(false);
    setEditForm(null);
    setAdminStudents([]);
    setAssignId('');
    try {
      const [dRes, sRes, allRes] = await Promise.all([
        api.get(`/admins/${a.id}`),
        api.get(`/admins/${a.id}/students`),
        api.get('/students'),
      ]);
      setDetailData(dRes.data);
      setAdminStudents(sRes.data || []);
      setAllStudents(allRes.data || []);
    } catch {
      setDetailData(null);
    } finally {
      setDetailLoading(false);
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
      await api.put(`/admins/${detail.id}`, {
        name: editForm.name,
        email: editForm.email,
        countryCode: editForm.countryCode,
        phoneNumber: editForm.phoneNumber,
        phone: toE164(editForm.countryCode, editForm.phoneNumber),
      });
      cancelEdit();
      await openDetail({ id: detail.id });
      load();
      showToast('Admin details updated — changes are live.', {
        tone: 'success',
        title: 'Admin updated',
      });
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to update admin', {
        tone: 'error',
        title: 'Update failed',
      });
    } finally {
      setSavingDetail(false);
    }
  }

  async function remove(id) {
    if (!confirm('Delete this admin?')) return;
    await api.delete(`/admins/${id}`);
    load();
  }

  const assignedIds = new Set(adminStudents.map((s) => s.id));
  const unassigned = allStudents.filter((s) => !assignedIds.has(s.id));

  async function assignStudent() {
    if (!assignId || !detail) return;
    setBusyStudent(assignId);
    try {
      await api.put(`/students/${assignId}`, { coachId: detail.id });
      const sRes = await api.get(`/admins/${detail.id}/students`);
      setAdminStudents(sRes.data || []);
      setAssignId('');
      showToast('Student assigned to this admin.', { tone: 'success', title: 'Assigned' });
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to assign student', { tone: 'error', title: 'Assign failed' });
    } finally {
      setBusyStudent(null);
    }
  }

  async function unassignStudent(id) {
    if (!detail) return;
    setBusyStudent(id);
    try {
      await api.put(`/students/${id}`, { removeCoachId: detail.id });
      const sRes = await api.get(`/admins/${detail.id}/students`);
      setAdminStudents(sRes.data || []);
      showToast('Student removed from this admin.', { tone: 'success', title: 'Unassigned' });
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to unassign student', { tone: 'error', title: 'Remove failed' });
    } finally {
      setBusyStudent(null);
    }
  }

  return (
    <>
      <div className="flex justify-end mb-4">
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <input placeholder="Search admins…" value={search} onChange={(e) => setSearch(e.target.value)}
            className="chess-input !w-full sm:!w-64" />
        </div>
      </div>

      <div className="chess-table-wrap">
        <table className="chess-table">
          <thead>
            <tr>
              <th>Admin</th>
              <th>Email</th>
              <th>Phone</th>
              <th className="text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {admins.map((a, i) => (
              <tr key={a.id} style={{ animation: `fade-up .45s ${Math.min(i * 0.05, 0.5)}s both` }}>
                <td className="font-medium text-ivory-300">
                  <button
                    onClick={() => openDetail(a)}
                    className="flex items-center gap-2.5 hover:text-gold-400 transition-colors text-left"
                    title="View admin details"
                  >
                    <span className="grid place-items-center w-8 h-8 rounded-full bg-[var(--ink-900)] ring-1 ring-white/10 text-xs font-bold text-gold-400">
                      {(a.name || '?').trim().charAt(0).toUpperCase()}
                    </span>
                    <span className="flex flex-col">
                      <span>{a.name}</span>
                      <span className="text-xs text-ivory-500 font-normal">Details</span>
                    </span>
                  </button>
                </td>
                <td className="text-ivory-500">{a.email}</td>
                <td className="text-ivory-500">{formatPhoneDisplay(a.phone, a.country_code) || '—'}</td>
                <td className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button
                      to={`/admin/admins/${a.id}/performance`}
                      variant="secondary" size="sm" className="!py-1.5 !px-3 !text-xs"
                      title="Period-filtered coach performance report"
                    >
                      Performance
                    </Button>
                    <Button
                      to={`/admin/admins/${a.id}/report`}
                      variant="primary" size="sm" className="!py-1.5 !px-3 !text-xs"
                    >
                      Report
                    </Button>
                    <Button onClick={() => remove(a.id)} variant="danger" size="sm" className="!py-1.5 !px-3 !text-xs">
                      Delete
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {admins.length === 0 && (
              <tr>
                <td colSpan={4}><p className="chess-empty">No admins found.</p></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {detail && (
        <div className="fixed inset-0 z-[var(--z-modal-backdrop)] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={() => setDetail(null)}>
          <div className="chess-card w-full max-w-lg max-h-[85vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()} style={{ animation: 'board-pop .3s both' }}>
            <div className="flex items-start justify-between gap-3 mb-3">
              <h3 className="text-base font-bold text-ivory-300">Admin details</h3>
              <button onClick={() => setDetail(null)} className="text-ivory-500 hover:text-ivory-300 text-xl leading-none" title="Close">✕</button>
            </div>

            {editOn && editForm ? (
              <EditDetailsForm form={editForm} setForm={setEditForm} onSave={saveEdit} onCancel={cancelEdit} saving={savingDetail} />
            ) : detailLoading ? (
              <p className="text-sm text-ivory-500 py-8 text-center animate-pulse">Loading details…</p>
            ) : (
              <>
                <DetailContent d={detailData || detail} />
                <AssignedStudents
                  students={adminStudents}
                  unassigned={unassigned}
                  assignId={assignId}
                  onAssignId={setAssignId}
                  onAssign={assignStudent}
                  onUnassign={unassignStudent}
                  busy={busyStudent}
                  loading={studentsLoading}
                />
              </>
            )}

            <div className="flex justify-end gap-2 pt-3 mt-3 border-t border-ivory-700/50">
              <Button
                onClick={editOn ? cancelEdit : startEdit}
                variant="primary" size="md" className="!py-2 !px-4 text-sm"
              >
                {editOn ? '✕ Cancel edit' : '✎ Edit details'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function Admins() {
  return (
    <PageHeader title="Admins" icon="♖" subtitle="Manage coaching staff accounts.">
      <AdminsPanel />
    </PageHeader>
  );
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

function EditDetailsForm({ form, setForm, onSave, onCancel, saving }) {
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
    ['Email', d?.email],
    ['Phone', formatPhoneDisplay(d?.phone, d?.country_code)],
    ['Member since', d?.created_at ? new Date(d.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'],
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

/* Super-admin controls: assign / unassign students to this admin/coach. */
function AssignedStudents({ students, unassigned, assignId, onAssignId, onAssign, onUnassign, busy }) {
  return (
    <div className="w-full mt-5 pt-4 border-t border-ivory-700/50">
      <h4 className="text-sm font-bold text-ivory-300 mb-3">Assigned students ({students.length})</h4>

      {students.length === 0 ? (
        <p className="text-sm text-ivory-500 py-3">No students assigned yet — this admin currently sees no students.</p>
      ) : (
        <ul className="space-y-2 max-h-56 overflow-y-auto pr-1">
          {students.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 rounded-lg bg-[var(--ink-900)] ring-1 ring-white/10 px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ivory-300 truncate">{s.name}</p>
                <p className="text-xs text-ivory-500 truncate">{s.email}{s.group_name ? ` · ${s.group_name}` : ''}</p>
              </div>
              <Button
                onClick={() => onUnassign(s.id)}
                disabled={busy === s.id}
                variant="secondary" size="sm" className="!py-1 !px-2.5 !text-xs shrink-0"
              >
                {busy === s.id ? '…' : 'Remove'}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {unassigned.length > 0 && (
        <div className="flex items-center gap-2 mt-3">
          <select
            className="chess-input !py-2 text-sm min-w-0 flex-1"
            value={assignId}
            disabled={busy != null}
            onChange={(e) => onAssignId(e.target.value)}
          >
            <option value="">Assign a student…</option>
            {unassigned.map((s) => (
              <option key={s.id} value={String(s.id)}>{s.name} · {s.email}</option>
            ))}
          </select>
          <Button
            onClick={onAssign}
            disabled={!assignId || busy != null}
            variant="primary" size="md" className="!py-2 !px-3 text-sm shrink-0"
          >
            {busy === assignId ? '…' : 'Assign'}
          </Button>
        </div>
      )}
      {unassigned.length === 0 && students.length > 0 && (
        <p className="text-xs text-ivory-500 mt-3">Every student is already assigned to a coach.</p>
      )}
    </div>
  );
}