import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { Page, Card, Chip, Spinner } from '../components/ui';
import { useToast } from '../components/Toast';
import { useAuth } from '../context/AuthContext';
import StudentAvatar from '../components/StudentAvatar';
import AvatarBuilder from '../components/AvatarBuilder';
import { coachListFrom } from '../utils/coachNames';
import Button from '../components/Button';
import PhoneInput from '../components/PhoneInput';
import { formatPhoneDisplay, splitPhone, toE164 } from '../utils/phone';

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function toDateInput(d) {
  if (!d) return '';
  return String(d).slice(0, 10);
}

function computeAge(birthdate) {
  if (!birthdate) return null;
  const b = new Date(birthdate);
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  return age >= 0 ? age : null;
}

function initials(name) {
  return (name || '?').trim().charAt(0).toUpperCase();
}

function Avatar({ user, className = '' }) {
  if (user?.avatar_config) {
    return <StudentAvatar config={user.avatar_config} seed={`user_${user.id || ''}`} size={112} className={className.replace(/ rounded-full$/i, '')} />;
  }
  if (user?.profile_image) {
    return <img src={user.profile_image} alt="" className={`${className} object-cover`} />;
  }
  return (
    <span
      className={`${className} grid place-items-center rounded-full bg-[var(--ink-900)] ring-2 ring-gold-500/40 text-2xl font-bold text-gold-400`}
    >
      {initials(user?.name)}
    </span>
  );
}

function DetailRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 border-b border-ivory-700/40 last:border-0">
      <span className="text-sm text-ivory-500">{label}</span>
      {/* A div, not a span: some rows render a list of values (e.g. several coaches). */}
      <div className="text-sm font-medium text-ivory-300 text-right">{value || '—'}</div>
    </div>
  );
}

const GENDERS = ['Male', 'Female', 'Non-binary', 'Prefer not to say'];
const LANGUAGES = ['English', 'Hindi', 'Tamil', 'Telugu', 'Kannada', 'Malayalam', 'Marathi', 'Bengali', 'Gujarati', 'Other'];

export default function Profile() {
  const { user: authUser, refreshUser, logout } = useAuth();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [profile, setProfile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [savingAvatar, setSavingAvatar] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(null);
  const fileRef = useRef(null);

  const load = () => {
    api.get('/auth/me', { cache: false })
      .then((res) => setProfile(res.data.user))
      .catch(() => setProfile(authUser));
  };

  useEffect(load, [authUser]);
  useEffect(() => {
    if (profile) {
      const phone = splitPhone(profile.phone, profile.country_code);
      setForm((f) => f || {
        name: profile.name || '',
        countryCode: phone.countryCode,
        phoneNumber: phone.phoneNumber,
        nickname: profile.nickname || '',
        birthdate: toDateInput(profile.birthdate),
        parentName: profile.parent_name || '',
        gender: profile.gender || '',
        preferredLanguage: profile.preferred_language || '',
      });
    }
  }, [profile]);

  const onPick = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      showToast('Photo must be under 5MB.', { tone: 'error', title: 'Photo upload' });
      return;
    }
    const body = new FormData();
    body.append('photo', file);
    setUploading(true);
    api.post('/auth/me/photo', body)
      .then((res) => {
        setProfile((p) => ({ ...p, profile_image: res.data.profile_image }));
        refreshUser();
        showToast('Profile photo updated.', { tone: 'success', title: 'Photo' });
      })
      .catch((err) => {
        showToast(err.response?.data?.message || 'Upload failed.', { tone: 'error', title: 'Photo upload' });
      })
      .finally(() => setUploading(false));
  };

  const saveAvatar = async (config) => {
    setSavingAvatar(true);
    try {
      await api.patch('/students/me/avatar', { avatar_config: config });
      setProfile((p) => ({ ...p, avatar_config: config }));
      await refreshUser();
      setAvatarOpen(false);
      showToast('Avatar saved — you look great! 🎉', { tone: 'success', title: 'Avatar' });
    } catch (err) {
      showToast(err.response?.data?.message || 'Could not save avatar.', { tone: 'error', title: 'Avatar' });
    } finally {
      setSavingAvatar(false);
    }
  };

  const removePhoto = async () => {
    if (!window.confirm('Remove your profile photo?')) return;
    try {
      await api.delete('/auth/me/photo');
      setProfile((p) => ({ ...p, profile_image: null }));
      refreshUser();
      showToast('Profile photo removed.', { tone: 'success', title: 'Photo' });
    } catch (err) {
      showToast(err.response?.data?.message || 'Could not remove photo.', { tone: 'error', title: 'Photo' });
    }
  };

  const resetAvatar = async () => {
    if (!window.confirm('Remove your custom avatar? You’ll fall back to the default design — if you have an uploaded photo it will show here.')) return;
    try {
      await api.delete('/students/me/avatar');
      setProfile((p) => ({ ...p, avatar_config: null }));
      await refreshUser();
      showToast('Avatar removed — back to the default.', { tone: 'success', title: 'Avatar' });
    } catch (err) {
      showToast(err.response?.data?.message || 'Could not remove avatar.', { tone: 'error', title: 'Avatar' });
    }
  };

  const saveDetails = async (e) => {
    e.preventDefault();
    setSaving(true);
    const phone = toE164(form.countryCode, form.phoneNumber);
    try {
      await api.patch('/students/me', { ...form, phone });
      setEditing(false);
      load();
      refreshUser();
      showToast(phone ? `Profile details updated — phone ${formatPhoneDisplay(phone)}.` : 'Profile details updated.', { tone: 'success', title: 'Profile' });
    } catch (err) {
      showToast(err.response?.data?.message || 'Could not save details.', { tone: 'error', title: 'Profile' });
    } finally {
      setSaving(false);
    }
  };

  if (!profile || !form) return <Page title="My Profile" piece="♙"><Spinner text="Loading your profile…" /></Page>;

  const user = profile;
  const age = computeAge(user.birthdate);

  /* A student can be handled by several coaches at once. `coach_names` arrives as
   * [{ id, name }] while `coach_name` is a plain string, so the shape translation
   * lives in a util that is unit-tested against the real payload. */
  const coaches = coachListFrom(user);
  const coachList = coaches.length > 1
    ? (
      <ul className="flex flex-col items-end gap-0.5">
        {coaches.map((c) => (
          /* Coaches can share a display name, so prefer the id for identity. */
          <li key={c.id ?? c.name}>{c.name}</li>
        ))}
      </ul>
    )
    : (coaches[0]?.name || '—');

  return (
    <Page title="My Profile" piece="♙" sub="Your account details — keep your info up to date.">
      {/* ── Photo card ── */}
      <Card title="Profile photo" piece="♟" className="mb-6">
        <div className="flex flex-col sm:flex-row items-center gap-6">
          <div className="relative">
            <Avatar user={user} className="w-28 h-28 rounded-full" />
            {uploading && (
              <span className="absolute inset-0 grid place-items-center rounded-full bg-black/50 text-sm text-ivory-300">
                …Uploading
              </span>
            )}
          </div>
          <div className="flex flex-col items-center sm:items-start gap-3">
            <p className="text-sm text-ivory-500 text-center sm:text-left">
              Add a photo so your coach can recognise you at a glance. JPG, PNG, GIF or WebP, up to 5MB.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button
                variant="primary" size="md" className="!px-4 !py-2 text-sm"
                onClick={() => setAvatarOpen(true)}
              >
                😊 Edit Avatar
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                className="hidden"
                onChange={onPick}
              />
              <Button
                variant="secondary" size="md" className="!px-4 !py-2 text-sm"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? 'Uploading…' : '📷 Upload photo'}
              </Button>
              {user.profile_image && (
                <Button
                  variant="danger" size="md" className="!px-4 !py-2 text-sm"
                  onClick={removePhoto}
                >
                  🗑 Remove photo
                </Button>
              )}
              {user.avatar_config && (
                <Button
                  variant="danger" size="md" className="!px-4 !py-2 text-sm"
                  onClick={resetAvatar}
                >
                  🗑 Remove avatar
                </Button>
              )}
            </div>
          </div>
        </div>
      </Card>

      {avatarOpen && (
        <AvatarBuilder
          config={user.avatar_config}
          onSave={(config) => saveAvatar(config)}
          onClose={() => setAvatarOpen(false)}
        />
      )}

      {/* ── Basic + personal details ── */}
      <Card
        title="Basic details"
        piece="♛"
        className="mb-6"
        actions={(
          <Button variant="secondary" size="sm" className="!px-3 !py-1.5 !text-xs" onClick={() => setEditing((v) => !v)}>
            {editing ? 'Cancel' : '✎ Edit details'}
          </Button>
        )}
      >
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <Chip tone={user.active === false ? '' : 'green'}>
            {user.active === false ? 'Inactive' : 'Active'}
          </Chip>
          {user.group_name && <Chip>Batch · {user.group_name}</Chip>}
          {user.role === 'student' && <Chip>Student</Chip>}
        </div>

        {editing ? (
          <form onSubmit={saveDetails} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs text-ivory-500 mb-1 block">Full name</label>
                <input className="chess-input" value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <PhoneInput
                label="Phone number"
                countryCode={form.countryCode}
                phoneNumber={form.phoneNumber}
                onChange={({ countryCode, phoneNumber }) => setForm({ ...form, countryCode, phoneNumber })}
                autoComplete="tel"
              />
              <div>
                <label className="text-xs text-ivory-500 mb-1 block">First name / nickname</label>
                <input className="chess-input" value={form.nickname}
                  onChange={(e) => setForm({ ...form, nickname: e.target.value })} placeholder="e.g. Rakesh, 'Rak'" />
              </div>
              <div>
                <label className="text-xs text-ivory-500 mb-1 block">Date of birth</label>
                <input type="date" className="chess-input" value={form.birthdate}
                  onChange={(e) => setForm({ ...form, birthdate: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-ivory-500 mb-1 block">Parent / guardian name</label>
                <input className="chess-input" value={form.parentName}
                  onChange={(e) => setForm({ ...form, parentName: e.target.value })} placeholder="Parent or guardian's name" />
              </div>
              <div>
                <label className="text-xs text-ivory-500 mb-1 block">Gender</label>
                <select className="chess-input" value={form.gender}
                  onChange={(e) => setForm({ ...form, gender: e.target.value })}>
                  <option value="">Select gender…</option>
                  {GENDERS.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs text-ivory-500 mb-1 block">Preferred language</label>
                <select className="chess-input" value={form.preferredLanguage}
                  onChange={(e) => setForm({ ...form, preferredLanguage: e.target.value })}>
                  <option value="">Select language…</option>
                  {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" size="md" className="!px-4 !py-2 text-sm" onClick={() => { setEditing(false); load(); }}>
                Cancel
              </Button>
              <Button variant="primary" size="md" className="!px-4 !py-2 text-sm" disabled={saving}>
                {saving ? 'Saving…' : 'Save details'}
              </Button>
            </div>
          </form>
        ) : (
          <div>
            <DetailRow label="Name" value={user.name} />
            <DetailRow label="Email" value={user.email} />
            <DetailRow label="Phone" value={formatPhoneDisplay(user.phone, user.country_code)} />
            <DetailRow label="First name / nickname" value={user.nickname} />
            <DetailRow label="Date of birth" value={user.birthdate ? fmtDate(user.birthdate) : '—'} />
            <DetailRow label="Age" value={age != null ? `${age} years` : '—'} />
            <DetailRow label="Gender" value={user.gender} />
            <DetailRow label="Preferred language" value={user.preferred_language} />
            <DetailRow label="Batch / Group" value={user.group_name || '—'} />
            <DetailRow label={coaches.length > 1 ? 'Coaches' : 'Coach'} value={coachList} />
            <DetailRow label="Member since" value={fmtDate(user.created_at)} />
          </div>
        )}
      </Card>

      <Card title="Account" piece="🔐">
        <p className="text-sm text-ivory-500">
          Sign out of this device when you're done.
        </p>
        <Button
          variant="danger" size="md" className="mt-3 !px-4 !py-2 text-sm"
          onClick={() => {
            logout();
            navigate('/');
          }}
        >
          ⇥ Logout
        </Button>
      </Card>
    </Page>
  );
}