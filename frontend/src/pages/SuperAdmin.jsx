import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../services/api';
import { PageHeader, Chip } from '../components/ui';
import { useToast } from '../components/Toast';
import { FeatureAccessPanel } from './FeatureAccess';
import SidebarOrder from './SidebarOrder';
import SuperAdminPasswords from '../components/SuperAdminPasswords';
import Button from '../components/Button';
import PasswordInput from '../components/PasswordInput';
import PhoneInput from '../components/PhoneInput';
import { DEFAULT_DIAL, toE164 } from '../utils/phone';

/* The Super Admin console hosts Feature Access as a section of its own rather
   than as a separate top-level page in the sidebar. Each section is also a
   sidebar row (superOnly entries in adminLinks) deep-linking here with
   ?section=, so the sidebar order decides their sequence out there while this
   array stays the console's own tab order. */
const SECTIONS = [
  { key: 'accounts', label: '♙ Register account' },
  { key: 'passwords', label: '♟ Passwords' },
  { key: 'features', label: '♜ Feature Access' },
  { key: 'sidebar', label: '↕ Sidebar Order' },
];

const GENDERS = ['Male', 'Female', 'Non-binary', 'Prefer not to say'];
const LANGUAGES = ['English', 'Hindi', 'Tamil', 'Telugu', 'Kannada', 'Malayalam', 'Marathi', 'Bengali', 'Gujarati', 'Other'];

const EMPTY_FORM = {
  role: 'student',
  name: '',
  username: '',
  email: '',
  countryCode: DEFAULT_DIAL,
  phoneNumber: '',
  password: '',
  confirmPassword: '',
  nickname: '',
  birthdate: '',
  parentName: '',
  gender: '',
  preferredLanguage: '',
};

function LabeledField({ label, children, hint }) {
  return (
    <label className="block">
      <span className="text-xs text-ivory-500">{label}</span>
      {children}
      {hint && <span className="block text-[0.7rem] text-ivory-500/70 mt-0.5">{hint}</span>}
    </label>
  );
}

/**
 * The console's section switcher.
 *
 * memo'd, at module level, and given only referentially stable props - the
 * static SECTIONS array, a useCallback'd onSelect and the active key. That is
 * the entire reason the switcher does not re-render when a panel it has nothing
 * to do with fetches, sorts or resets itself. `active` is the only prop that
 * changes, and it changes exactly when the highlight should.
 */
const SectionSwitcher = memo(function SectionSwitcher({ sections, active, onSelect, listRef }) {
  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label="Console sections"
      className="flex flex-wrap gap-2 mb-4 md:sticky md:top-4 md:z-10 md:bg-ink-950/80 md:backdrop-blur md:pt-2 md:pb-2"
    >
      {sections.map((s) => (
        <button
          key={s.key}
          type="button"
          role="tab"
          aria-selected={active === s.key}
          onClick={() => onSelect(s.key)}
          className={`perm-tab ${active === s.key ? 'perm-tab--on' : ''}`}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
});

export default function SuperAdmin() {
  const { showToast } = useToast();
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [lastCreated, setLastCreated] = useState(null);
  /* Which console section is open. Read from ?section= so a section is
     linkable (handy for "look at the sidebar order I just changed"), falling
     back to account registration. An unknown value is ignored rather than
     leaving the console on a section that does not exist. */
  const [searchParams] = useSearchParams();
  const requested = searchParams.get('section');
  const [section, setSection] = useState(
    SECTIONS.some((s) => s.key === requested) ? requested : 'accounts',
  );

  /* ── Section switching is a selection, never a reload ────────────────────
   *
   * This page used to render its panels through a four-way ternary:
   *
   *     {section === 'features' ? <FeatureAccessPanel/> : section === 'sidebar'
   *       ? <SidebarOrder/> : ... }
   *
   * Every click therefore DESTROYED the outgoing panel and MOUNTED a new one.
   * Each panel fetches its data on mount, so switching sections re-fetched all
   * of them, and every piece of state they held - SidebarOrder's unsaved draft,
   * its dnd-kit drag session, the passwords form's typed values - was thrown
   * away. Switching back re-mounted and re-fetched from scratch, every time.
   *
   * Now each panel is mounted ONCE, on first visit, and then kept mounted with
   * the HTML `hidden` attribute. `hidden` rather than a conditional because it
   * removes the panel from view without removing it from the DOM: no unmount, no
   * refetch, no state loss. Panels are only added as they are visited, so the
   * console never pays for the two or three a given admin never opens. */
  const [visitedSections, setVisitedSections] = useState(() => new Set([section]));
  useEffect(() => {
    setVisitedSections((prev) => {
      if (prev.has(section)) return prev; // already mounted; identity preserved
      const next = new Set(prev);
      next.add(section);
      return next;
    });
  }, [section]);

  /* Stable, so the memo'd switcher only re-renders for the highlight. */
  const switchSection = useCallback((key) => setSection(key), []);
  const switcherRef = useRef(null);
  const savedSwitcherScroll = useRef(0);
  const selectSection = useCallback((key) => {
    savedSwitcherScroll.current = switcherRef.current?.scrollTop || 0;
    switchSection(key);
  }, [switchSection]);
  useEffect(() => {
    const el = switcherRef.current;
    if (el && savedSwitcherScroll.current) el.scrollTop = savedSwitcherScroll.current;
  }, [section]);


  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  function validate() {
    if (!form.name.trim()) return 'Full name is required';
    const username = form.username.trim();
    if (!username) return 'Username is required — this is how the user signs in';
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
      return 'Username must be 3–20 characters (letters, numbers, underscores only)';
    }
    const email = form.email.trim();
    if (!email) return 'Email is required';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Enter a valid email address';
    if (!form.password) return 'Password is required';
    /* The password is OPTIONAL. Leave it empty and the server generates a
       temporary one, mails it to the student with the login details, and makes
       them change it at their first sign-in. */
    if (form.password) {
      if (form.password.length < 8) return 'Password must be at least 8 characters';
      if (form.confirmPassword !== form.password) return 'Passwords do not match';
    } else if (form.confirmPassword) {
      return 'Type a password, or leave both boxes empty to have one generated';
    }
    if (form.birthdate) {
      const b = new Date(form.birthdate);
      if (Number.isNaN(b.getTime())) return 'Enter a valid date of birth';
    }
    return '';
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    const problem = validate();
    if (problem) {
      setError(problem);
      showToast(problem, { tone: 'error', title: 'Check the form' });
      return;
    }
    setCreating(true);
    try {
      const res = await api.post('/auth/register', {
        name: form.name.trim(),
        ...(form.username.trim() ? { username: form.username.trim() } : {}),
        email: form.email.trim(),
        countryCode: form.countryCode,
        phoneNumber: form.phoneNumber,
        phone: toE164(form.countryCode, form.phoneNumber) || undefined,
        password: form.password,
        confirmPassword: form.confirmPassword,
        role: form.role,
        ...(form.role === 'student' ? {
          nickname: form.nickname?.trim() || undefined,
          birthdate: form.birthdate || undefined,
          parentName: form.parentName?.trim() || undefined,
          gender: form.gender || undefined,
          preferredLanguage: form.preferredLanguage || undefined,
        } : {}),
      });
      setLastCreated({
        name: res.data?.user?.name || form.name.trim(),
        role: form.role,
        email: form.email.trim(),
        username: res.data?.user?.username || form.username.trim(),
        // Shown once, here only — the server keeps just a hash and can never
        // return it again, so this is the admin's only chance to pass it on.
        recoveryCode: res.data?.recoveryCode || null,
        // The same, for a password the SERVER generated (the admin left the
        // password boxes empty). It is the fallback for the case where the mail
        // could not be delivered.
        temporaryPassword: res.data?.temporaryPassword || null,
      });
      setForm(EMPTY_FORM);
      const label = form.role === 'admin' ? 'Coach account' : 'Student account';
      /* The server reports what ACTUALLY happened with the confirmation mail, so
         the toast never claims "sent" for a message that was only printed to
         the log (dummy transport) or could not be sent at all (no SMTP). */
      const emailStatus = res.data?.emailStatus;
      if (form.role === 'student' && emailStatus === 'dummy') {
        showToast(`${label} created — the confirmation email was only printed to the server log (dummy transport).`, {
          tone: 'warning',
          title: 'Registered, email not sent',
        });
      } else if (form.role === 'student' && emailStatus !== 'queued') {
        showToast(`${label} created — but the confirmation email could not be sent.`, {
          tone: 'warning',
          title: 'Registered, email not sent',
        });
      } else {
        showToast(`${label} created — confirmation email sent.`, {
          tone: 'success',
          title: `${label} created`,
        });
      }
    } catch (err) {
      const msg = err.response?.data?.message || 'Failed to create account';
      setError(msg);
      showToast(msg, { tone: 'error', title: 'Could not create account' });
    } finally {
      setCreating(false);
    }
  }

  const isStudent = form.role === 'student';
  const accountLabel = isStudent ? 'Student' : 'Coach (Admin)';

  return (
    <PageHeader title="Super Admin" icon="♛" subtitle="Register students and coaches, and control which sections each role can use.">
      <SectionSwitcher
        sections={SECTIONS}
        active={section}
        onSelect={selectSection}
        listRef={switcherRef}
      />

      {/* Each section is mounted ONCE, on first visit, and then kept mounted with the
          HTML `hidden` attribute. `hidden` rather than a conditional because it
          removes a panel from view WITHOUT removing it from the DOM: no unmount,
          no refetch on mount, and every piece of state the panel holds survives
          switching away and back. `key` is the section key, so each panel keeps
          its own React instance for the life of the page.
          min-h-screen keeps the document tall even under a short panel, so the
          browser never clamps the page scroll when switching. */}
      <div className="min-h-screen">
        {[...visitedSections].map((key) => (
          <div key={key} hidden={key !== section}>
            {key === 'features' ? (
              <FeatureAccessPanel />
            ) : key === 'sidebar' ? (
              <SidebarOrder />
            ) : key === 'passwords' ? (
              <SuperAdminPasswords />
            ) : (
            <div className="grid gap-4 lg:grid-cols-3">
        {/* ── Registration form ── */}
        <div className="lg:col-span-2">
          <form onSubmit={handleSubmit} className="chess-card space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="chess-card-title mb-0">
                <span className="chess-card-piece">♔</span>
                <span className="flex-1">Register account</span>
              </h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, role: 'student' }))}
                  className={`perm-tab ${isStudent ? 'perm-tab--on' : ''}`}
                >
                  ♙ Student
                </button>
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, role: 'admin' }))}
                  className={`perm-tab ${!isStudent ? 'perm-tab--on' : ''}`}
                >
                  ♖ Coach / Admin
                </button>
              </div>
            </div>

            {error && <div className="chess-error">{error}</div>}

            {/* Login credentials — same for students and coaches */}
            <div className="grid gap-3 sm:grid-cols-2">
              <LabeledField label={`${accountLabel} full name *`}>
                <input required className="chess-input" placeholder="e.g. Aarav Sharma" value={form.name} onChange={set('name')} />
              </LabeledField>
              <LabeledField label="Username *" hint="3–20 chars (letters, numbers, _) — the sign-in name">
                <input required className="chess-input" placeholder="e.g. aarav_sharma" value={form.username} onChange={set('username')} autoComplete="off" />
              </LabeledField>
              <LabeledField label="Email *">
                <input required type="email" className="chess-input" placeholder="they@example.com" value={form.email} onChange={set('email')} />
              </LabeledField>
              <PhoneInput
                label="Phone"
                countryCode={form.countryCode}
                phoneNumber={form.phoneNumber}
                onChange={({ countryCode, phoneNumber }) => setForm({ ...form, countryCode, phoneNumber })}
                autoComplete="tel"
              />
              <LabeledField label="Password *" hint="At least 8 characters">
                <PasswordInput required autoComplete="new-password" className="chess-input" value={form.password} onChange={set('password')} />
              </LabeledField>
              <LabeledField label="Confirm password *">
                <PasswordInput required autoComplete="new-password" className="chess-input" value={form.confirmPassword} onChange={set('confirmPassword')} />
              </LabeledField>
            </div>

            {isStudent && (
              <>
                <div className="flex items-center gap-3 pt-1">
                  <span className="text-[0.65rem] uppercase tracking-[0.18em] text-gold-400 font-extrabold">
                    Student details
                  </span>
                  <span className="h-px flex-1 bg-ivory-700/40" />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <LabeledField label="First name / nickname">
                    <input className="chess-input" placeholder="What they like to be called" value={form.nickname} onChange={set('nickname')} />
                  </LabeledField>
                  <LabeledField label="Date of birth">
                    <input type="date" className="chess-input" value={form.birthdate} onChange={set('birthdate')} />
                  </LabeledField>
                  <LabeledField label="Parent / guardian">
                    <input className="chess-input" placeholder="Guardian name (optional)" value={form.parentName} onChange={set('parentName')} />
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
                </div>
              </>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button
                type="button"
                onClick={() => { setForm(EMPTY_FORM); setError(''); }}
                variant="secondary" size="md" className="!py-2 !px-4 text-sm"
              >
                Clear
              </Button>
              <Button disabled={creating} variant="primary" size="md" className="!py-2 !px-5 text-sm">
                {creating ? 'Registering…' : `Register ${accountLabel}`}
              </Button>
            </div>
          </form>
        </div>

        {/* ── Side notes ── */}
        <div className="space-y-4">
          {lastCreated && (
            <div className="chess-card">
              <h2 className="chess-card-title">
                <span className="chess-card-piece">♜</span>
                <span className="flex-1">Just registered</span>
              </h2>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-ivory-100 truncate">{lastCreated.name}</p>
                  <p className="text-xs text-ivory-500 truncate">@{lastCreated.username || '—'}</p>
                  <p className="text-xs text-ivory-500 truncate">{lastCreated.email}</p>
                </div>
                <Chip tone={lastCreated.role === 'admin' ? 'green' : ''}>
                  {lastCreated.role === 'admin' ? 'Coach' : 'Student'}
                </Chip>
              </div>

              {/* The one-time password-recovery code. Self-registration is closed,
                  so the admin is now the only person who can ever see this — pass
                  it to the member, otherwise a forgotten password can only be
                  fixed by an admin. The server stores just a hash, so it cannot
                  be shown again for this account. */}
              {lastCreated.recoveryCode && (
                <div className="mt-3 pt-3 border-t border-ivory-700/40">
                  <p className="text-[11px] uppercase tracking-wider text-ivory-500 font-semibold">
                    Password recovery code
                  </p>
                  <div
                    className="mt-1 px-3 py-2 rounded-lg border border-amber-400/40 bg-amber-400/10 font-mono text-lg tracking-[0.3em] text-amber-300 select-all cursor-pointer"
                    onClick={() => {
                      try {
                        navigator.clipboard.writeText(lastCreated.recoveryCode);
                        showToast('Recovery code copied.', { tone: 'success', title: 'Copied' });
                      } catch { /* clipboard unavailable */ }
                    }}
                    title="Click to copy"
                  >
                    {lastCreated.recoveryCode}
                  </div>
                  <p className="text-[11px] text-ivory-500 mt-1 leading-snug">
                    Shown once. Give it to {lastCreated.name.split(' ')[0]} — it is the only
                    way to reset their password without an admin.
                  </p>
                </div>
              )}

              {/* The temporary password, when the SERVER generated one (the
                  password boxes were left empty). It was mailed to the student
                  as well; this copy is the fallback for the case where the mail
                  did not arrive. Shown once, like the recovery code. */}
              {lastCreated.temporaryPassword && (
                <div className="mt-3 pt-3 border-t border-ivory-700/40">
                  <p className="text-[11px] uppercase tracking-wider text-ivory-500 font-semibold">
                    Temporary password
                  </p>
                  <div
                    className="mt-1 px-3 py-2 rounded-lg border border-amber-400/40 bg-amber-400/10 font-mono text-lg tracking-[0.3em] text-amber-300 select-all cursor-pointer"
                    onClick={() => {
                      try {
                        navigator.clipboard.writeText(lastCreated.temporaryPassword);
                        showToast('Temporary password copied.', { tone: 'success', title: 'Copied' });
                      } catch { /* clipboard unavailable */ }
                    }}
                    title="Click to copy"
                  >
                    {lastCreated.temporaryPassword}
                  </div>
                  <p className="text-[11px] text-ivory-500 mt-1 leading-snug">
                    Shown once. It was emailed to {lastCreated.email} too — the student
                    is asked to change it at their first sign-in.
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="chess-card">
            <h2 className="chess-card-title">
              <span className="chess-card-piece">♘</span>
              <span className="flex-1">How it works</span>
            </h2>
            <ul className="text-sm text-ivory-400 space-y-2 leading-relaxed">
              <li>• Accounts are created here — self-registration is closed, so nobody can sign themselves up.</li>
              <li>• The new user signs in with the username and password you create here.</li>
              <li>• A one-time recovery code is generated for you to pass on — it is the only way they can reset a forgotten password.</li>
              <li>• A student row is created automatically for student accounts.</li>
              <li>• Duplicate emails and usernames are rejected by the server.</li>
              <li>• Profile photos are uploaded by the user later from their Profile page.</li>
            </ul>
          </div>
        </div>
            </div>
            )}
          </div>
        ))}
      </div>
    </PageHeader>
  );
}