import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { Page, Card, Chip, Spinner } from '../components/ui';
import { useToast } from '../components/Toast';
import { useAuth } from '../context/AuthContext';
import StudentAvatar from '../components/StudentAvatar';
import AvatarBuilder from '../components/AvatarBuilder';
import ProfilePhotoCropper from '../components/ProfilePhotoCropper';
import Button from '../components/Button';
import PhoneInput from '../components/PhoneInput';
import { formatPhoneDisplay, splitPhone, toE164 } from '../utils/phone';

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function initials(name) {
  return (name || '?').trim().charAt(0).toUpperCase();
}

function Avatar({ user, className = '' }) {
  if (user?.avatar_config) {
    return <StudentAvatar config={user.avatar_config} seed={`user_${user.id || ''}`} size={112} className={className.replace(/ rounded-full$/i, '')} />;
  }
  if (user?.profile_image) {
    /* Square frame + cover/centre: the file is already a square crop, and old
       photos still render centred inside it. */
    return (
      <span className={`profile-photo-frame ${className}`}>
        <img
          src={user.profile_image}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center', display: 'block' }}
        />
      </span>
    );
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
      <span className="text-sm font-medium text-ivory-300 text-right">{value || '—'}</span>
    </div>
  );
}

export default function AdminProfile() {
  const { user: authUser, refreshUser, logout } = useAuth();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [profile, setProfile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [cropSrc, setCropSrc] = useState(null);
  const cropUrlRef = useRef(null);
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
        email: profile.email || '',
        countryCode: phone.countryCode,
        phoneNumber: phone.phoneNumber,
      });
    }
  }, [profile]);

  const closeCropper = () => {
    setCropSrc(null);
    if (cropUrlRef.current) {
      URL.revokeObjectURL(cropUrlRef.current);
      cropUrlRef.current = null;
    }
  };
  useEffect(() => () => {
    if (cropUrlRef.current) URL.revokeObjectURL(cropUrlRef.current);
  }, []);

  const onPick = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      showToast('Photo must be under 5MB.', { tone: 'error', title: 'Photo upload' });
      return;
    }
    closeCropper();
    cropUrlRef.current = URL.createObjectURL(file);
    setCropSrc(cropUrlRef.current);
  };

  /** Upload the square JPEG produced by the crop dialog. */
  const uploadCroppedPhoto = async (blob) => {
    setUploading(true);
    try {
      const body = new FormData();
      body.append('photo', new File([blob], 'profile-photo.jpg', { type: 'image/jpeg' }));
      const res = await api.post('/auth/me/photo', body);
      /* The server clears any custom avatar on upload; mirror that so the
         card and every other avatar in the app flip together. */
      setProfile((p) => ({ ...p, profile_image: res.data.profile_image, avatar_config: null }));
      refreshUser();
      closeCropper();
      showToast('Profile photo updated.', { tone: 'success', title: 'Photo' });
    } catch (err) {
      showToast(err.response?.data?.message || 'Upload failed.', { tone: 'error', title: 'Photo upload' });
    } finally {
      setUploading(false);
    }
  };

  const saveAvatar = async (config) => {
    setSavingAvatar(true);
    try {
      await api.patch('/auth/me/avatar', { avatar_config: config });
      /* Choosing an avatar removes the uploaded photo server-side, so both
         fields change in one step. */
      setProfile((p) => ({ ...p, avatar_config: config, profile_image: null }));
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
      setProfile((p) => ({ ...p, profile_image: null, avatar_config: null }));
      refreshUser();
      showToast('Profile photo removed.', { tone: 'success', title: 'Photo' });
    } catch (err) {
      showToast(err.response?.data?.message || 'Could not remove photo.', { tone: 'error', title: 'Photo' });
    }
  };

  const resetAvatar = async () => {
    if (!window.confirm('Remove your custom avatar? Your profile will show the default placeholder.')) return;
    try {
      await api.delete('/auth/me/avatar');
      setProfile((p) => ({ ...p, avatar_config: null, profile_image: null }));
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
      await api.put(`/admins/${authUser.id}`, {
        name: form.name,
        email: form.email,
        countryCode: form.countryCode,
        phoneNumber: form.phoneNumber,
        phone,
      });
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
  const roleLabel = user.role === 'superadmin' ? 'Super Admin' : 'Coach';

  return (
    <Page title="My Profile" piece="♙" sub="Your coach account — keep your info up to date.">
      {/* ── Photo card ── */}
      <Card title="Profile photo" piece="♟" className="mb-6">
        <div className="flex flex-col sm:flex-row items-center gap-5 sm:gap-6">
          {/* shrink-0: the hint text beside it is long, and a shrinkable wrapper
              gets squeezed narrower than the photo - the photo then overflows the
              wrapper and sits on top of the text. */}
          <div className="relative shrink-0">
            <Avatar user={user} className="w-28 h-28 rounded-full" />
            {uploading && (
              <span className="absolute inset-0 grid place-items-center rounded-full bg-black/50 text-sm text-ivory-300">
                …Uploading
              </span>
            )}
          </div>
          <div className="flex flex-col items-center sm:items-start gap-3 min-w-0">
            <p className="text-sm text-ivory-500 text-center sm:text-left">
              Add a photo or splash a custom avatar so your students can spot you at a glance. You can zoom and centre the photo before saving. A photo and an avatar are one or the other — picking one replaces the other. JPG, PNG, GIF or WebP, up to 5MB.
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

      <ProfilePhotoCropper
        open={!!cropSrc}
        src={cropSrc}
        saving={uploading}
        onCancel={closeCropper}
        onSave={uploadCroppedPhoto}
      />

      {/* ── Basic details ── */}
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
          <Chip tone="green">Active</Chip>
          <Chip>{roleLabel}</Chip>
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
              <div className="sm:col-span-2">
                <label className="text-xs text-ivory-500 mb-1 block">Email address</label>
                <input className="chess-input" type="email" value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })} />
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
            <DetailRow label="Role" value={roleLabel} />
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