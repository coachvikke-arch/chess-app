import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Page, Card, Spinner, ConfirmDialog } from '../components/ui';
import { useToast } from '../components/Toast';
import StudentAvatar from '../components/StudentAvatar';
import Button from '../components/Button';
import { formatDate } from '../utils/pgnTools';
import { formatTime12 } from '../utils/time';
import {
  listAccountsForStudent, listStudentProfiles, syncStudentProfile,
  connectStudentAccount, updateStudentAccount, removeStudentAccount,
} from '../services/adminChessProfiles';
import {
  OverviewTab, GamesTab, StatsTab, OpeningsTab, InsightsTab,
} from './ChessProfile';

/* ============================================================ helpers */

const PAGE_SIZE = 10;
const PLATFORM_LABEL = { 'chess.com': 'Chess.com', lichess: 'Lichess' };
const PLATFORM_ICON = { 'chess.com': '♔', lichess: '♛' };
/* Order shown in the connect panel and the empty state. */
const LINK_PLATFORMS = [
  ['chess.com', 'Chess.com', '♔'],
  ['lichess', 'Lichess', '♛'],
];

const STATUS_META = {
  both: 'Both connected',
  'chess.com': 'Chess.com only',
  lichess: 'Lichess only',
  none: 'Not connected',
};

/* The badge is derived from the accounts the server returned, never guessed. */
function statusOf(student) {
  const hasChess = (student.accounts || []).some((a) => a.platform === 'chess.com');
  const hasLichess = (student.accounts || []).some((a) => a.platform === 'lichess');
  if (hasChess && hasLichess) return 'both';
  if (hasChess) return 'chess.com';
  if (hasLichess) return 'lichess';
  return 'none';
}

/* A dot is not a legal class-name character, so the badge class uses dashes
   while the value keeps the platform's real name. */
function statusClass(status) {
  return status === 'chess.com' ? 'chess-com' : status;
}

function accountOf(student, platform) {
  return (student.accounts || []).find((a) => a.platform === platform) || null;
}

function ratingOf(student, platform, category) {
  const acct = accountOf(student, platform);
  const row = (acct?.ratings || []).find((r) => r.category === category);
  return row?.rating ?? null;
}

function formatSynced(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${formatDate(iso.slice(0, 10))} ${formatTime12(d)}`;
}

/* Two shapes reach this helper: the list rows are built by the service
   (camelCase) while the detail view reads the raw account rows (snake_case). */
function lastSyncedOf(student) {
  const stamps = (student.accounts || [])
    .map((a) => a.lastSyncedAt || a.last_synced_at)
    .filter(Boolean)
    .sort();
  return stamps.length ? stamps[stamps.length - 1] : null;
}

const SUMMARY_COLUMNS = [
  { key: 'name', label: 'Student', align: 'left' },
  { key: 'chess.rapid', label: '♔ Rapid' },
  { key: 'chess.blitz', label: '♔ Blitz' },
  { key: 'chess.bullet', label: '♔ Bullet' },
  { key: 'lichess.rapid', label: '♛ Rapid' },
  { key: 'lichess.blitz', label: '♛ Blitz' },
  { key: 'lichess.bullet', label: '♛ Bullet' },
  { key: 'totalGames', label: 'Games' },
  { key: 'lastSyncedAt', label: 'Last synced' },
];

function summaryValue(student, key) {
  if (key === 'name') return student.name || '';
  if (key === 'totalGames') return Number(student.totalGames) || 0;
  if (key === 'lastSyncedAt') return lastSyncedOf(student) || '';
  const [platform, category] = key.split('.');
  return ratingOf(student, platform === 'chess' ? 'chess.com' : 'lichess', category);
}

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

/* ============================================================ page */

export default function StudentChessProfiles() {
  const { showToast } = useToast();
  const [students, setStudents] = useState(null); // null = loading
  const [mode, setMode] = useState('student'); // 'student' | 'all'
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);

  /* The open student lives in the URL, like every other detail view in the app:
     Back closes the profile, and a reload reopens the same one.
     The READ must be reactive: `useUrlView` only re-reads the URL on popstate,
     so a pushState from a row click left its own state null - the URL changed
     while the page still believed nothing was selected, and the detail panel
     stayed on the "Select a student" prompt. */
  const [searchParams, setSearchParams] = useSearchParams();
  const studentParam = searchParams.get('student');
  const selectedId = studentParam && /^\d+$/.test(String(studentParam)) ? Number(studentParam) : null;

  /* One navigation per selection. `?game=` is dropped with it: a game belongs
     to the student it was opened from, and carrying it over would try to open
     that game under a different student. */
  const setStudentParam = (next) => {
    const sp = new URLSearchParams(window.location.search);
    sp.delete('game');
    if (next == null) sp.delete('student');
    else sp.set('student', String(next));
    setSearchParams(sp);
  };

  const loadStudents = async ({ quiet = false } = {}) => {
    try {
      const d = await listStudentProfiles();
      setStudents(d.students || []);
    } catch (err) {
      if (!quiet) {
        showToast(err.response?.data?.message || 'Could not load students.', { tone: 'error', title: 'Student chess profiles' });
      }
      /* A failed refresh keeps whatever is already on screen; only a cold load
         shows the empty list. */
      setStudents((prev) => (prev == null ? [] : prev));
    }
  };

  useEffect(() => { loadStudents({ quiet: true }); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (students || []).filter((s) => {
      if (status !== 'all' && statusOf(s) !== status) return false;
      if (!needle) return true;
      const haystack = [s.name, ...(s.accounts || []).map((a) => a.username)]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [students, search, status]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  useEffect(() => { setPage(1); }, [search, status]);

  const selected = filtered.find((s) => s.userId === selectedId)
    || (students || []).find((s) => s.userId === selectedId)
    || null;

  /* Switching students is ONE navigation that drops ?game= (see above) and
     resets nothing else on the page. */
  const selectStudent = (userId) => setStudentParam(userId);

  return (
    <div className="scp-ink">
      <Page
        title="Student Chess Profiles"
        piece="♛"
        sub="Chess.com and Lichess profiles for the students assigned to you — ratings, games, statistics, openings and insights, view-only."
        wide
      >
        <div className="scp-switch">
          <button className={`scp-switch-btn${mode === 'student' ? ' active' : ''}`} onClick={() => setMode('student')}>
            ♟ By student
          </button>
          <button className={`scp-switch-btn${mode === 'all' ? ' active' : ''}`} onClick={() => setMode('all')}>
            📊 All students
          </button>
        </div>

        {students === null ? (
          <Spinner text="Loading the students assigned to you…" />
        ) : students.length === 0 ? (
          <Card title="No students yet" piece="♟" className="mt-4">
            <p className="text-black text-sm">
              No students are assigned to you yet. A student appears here once an academy admin allocates them to your account.
            </p>
          </Card>
        ) : mode === 'all' ? (
          <AllStudentsSummary students={filtered} onOpen={(id) => { setMode('student'); selectStudent(id); }} />
        ) : (
          <>
            {/* Filters apply to both the desktop list and the mobile dropdown,
                so the two never disagree about who is reachable. */}
            <div className="scp-filters">
              <input
                className="chess-input scp-search"
                placeholder="Search by name or username…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <select className="chess-input" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="all">All connection states</option>
                <option value="both">Both connected</option>
                <option value="chess.com">Chess.com only</option>
                <option value="lichess">Lichess only</option>
                <option value="none">Not connected</option>
              </select>
            </div>

            <div className="scp-split">
              <aside className="scp-list">
                {filtered.length === 0 ? (
                  <p className="text-black/60 text-sm py-6 text-center">No students match that search or filter.</p>
                ) : (
                  pageRows.map((s) => (
                    <StudentRow
                      key={s.userId}
                      student={s}
                      active={s.userId === selectedId}
                      onSelect={() => selectStudent(s.userId)}
                    />
                  ))
                )}
                {filtered.length > PAGE_SIZE && (
                  <div className="scp-pager">
                    <Button variant="secondary" size="sm" className="!px-3 !py-1.5 !text-xs" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>← Prev</Button>
                    <span className="text-black/70 text-xs">Page {safePage} of {pageCount}</span>
                    <Button variant="secondary" size="sm" className="!px-3 !py-1.5 !text-xs" disabled={safePage >= pageCount} onClick={() => setPage(safePage + 1)}>Next →</Button>
                  </div>
                )}
              </aside>

              {/* Mobile: the list collapses into a single picker. */}
              <select
                className="chess-input scp-mobile-picker"
                value={selectedId == null ? '' : String(selectedId)}
                onChange={(e) => (e.target.value ? selectStudent(Number(e.target.value)) : setStudentParam(null))}
              >
                <option value="">Select a student…</option>
                {filtered.map((s) => (
                  <option key={s.userId} value={String(s.userId)}>
                    {s.name} — {STATUS_META[statusOf(s)]}
                  </option>
                ))}
              </select>

              <section className="scp-detail">
                {!selected ? (
                  <Card title="Select a student" piece="♟" className="scp-prompt">
                    <p className="text-black text-sm">
                      Choose a student from the list to see their full Chess.com and Lichess profile.
                    </p>
                  </Card>
                ) : (
                  <StudentProfileView
                    key={selected.userId}
                    student={selected}
                    onSynced={() => loadStudents({ quiet: true })}
                    onBack={() => setStudentParam(null)}
                  />
                )}
              </section>
            </div>
          </>
        )}
      </Page>
    </div>
  );
}

/* ============================================================ list row */

function StudentRow({ student, active, onSelect }) {
  const status = statusOf(student);
  const chess = accountOf(student, 'chess.com');
  const lichess = accountOf(student, 'lichess');
  return (
    <button className={`scp-student${active ? ' active' : ''}`} onClick={onSelect}>
      <StudentAvatar
        config={student.avatarConfig}
        seed={`user_${student.userId}`}
        size={38}
        className="scp-student-avatar"
      />
      <span className="scp-student-main">
        <span className="scp-student-name">{student.name || 'Unnamed student'}</span>
        <span className="scp-student-users">
          <span className={chess ? '' : 'muted'}>♔ {chess?.username || 'not linked'}</span>
          <span className={lichess ? '' : 'muted'}>♛ {lichess?.username || 'not linked'}</span>
        </span>
      </span>
      <span className={`scp-badge scp-badge-${statusClass(status)}`}>{STATUS_META[status]}</span>
    </button>
  );
}

/* ============================================================ profile */

const PROFILE_TABS = [
  ['overview', '♛ Overview'],
  ['games', '♟ Games'],
  ['stats', '📊 Statistics'],
  ['openings', '♘ Openings'],
  ['insights', '💡 Insights'],
];

/* What the profile cards show for a student who has never had a Mate Zone
   report read for them. The cards already treat this as "no app column". */
const NO_APP_REPORT = { rating: null, games: null, loading: false, error: '' };

function StudentProfileView({ student, onSynced, onBack }) {
  const { showToast } = useToast();
  const [accounts, setAccounts] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [tab, setTab] = useState('overview');
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState('');
  const [ratingsVersion, setRatingsVersion] = useState(0);
  const [gamesVersion, setGamesVersion] = useState(0);
  /* null, or the one coach panel open: the header's connect form, or an Edit
     form for a specific platform card. */
  const [panel, setPanel] = useState(null);
  const [platformChoice, setPlatformChoice] = useState('chess.com');
  const [removing, setRemoving] = useState(null);
  const [notice, setNotice] = useState('');

  const studentId = student.userId;

  const load = async ({ quiet = false } = {}) => {
    /* Retry returns to the spinner while the request is in flight. */
    if (accounts == null) setLoadError('');
    try {
      const d = await listAccountsForStudent(studentId);
      setAccounts(d.accounts || []);
      setLoadError('');
    } catch (err) {
      const message = err.response?.data?.message || 'Could not load this student’s profiles.';
      /* A cold failure is an error card with Retry; a failed refresh keeps the
         profile that is already on screen and reports itself as a toast. */
      if (accounts == null) setLoadError(message);
      else if (!quiet) showToast(message, { tone: 'error', title: 'Student chess profile' });
    }
  };

  useEffect(() => { load({ quiet: true }); }, [studentId]); // eslint-disable-line react-hooks/exhaustive-deps

  const sync = async () => {
    setSyncing(true);
    setSyncNote('');
    try {
      const r = await syncStudentProfile(studentId);
      /* The response already carries the refreshed accounts — cached ones
         included — so a rate-limited platform still leaves a full page. */
      setAccounts(r.accounts || []);
      setLoadError('');
      setRatingsVersion((v) => v + 1);
      setGamesVersion((v) => v + 1);
      if (r.note) setSyncNote(r.note);
      const newGames = Number(r.newGames) || 0;
      showToast(
        r.failures?.length
          ? r.note
          : newGames > 0
            ? `${newGames} new game${newGames === 1 ? '' : 's'} imported.`
            : 'Already up to date.',
        { tone: r.failures?.length ? 'warning' : 'success', title: 'Sync complete' },
      );
      onSynced?.();
    } catch (err) {
      showToast(err.response?.data?.message || 'Sync failed — showing the last cached data.', { tone: 'error', title: 'Sync failed' });
    } finally {
      setSyncing(false);
    }
  };

  const list = accounts || [];
  const hasChess = list.some((a) => a.platform === 'chess.com');
  const hasLichess = list.some((a) => a.platform === 'lichess');
  const bothLinked = hasChess && hasLichess;
  const lastSyncedAt = lastSyncedOf({ accounts: list });
  const callbacks = { all: () => load(), sync: () => { }, remove: () => { } };

  /* `readOnly` still means "the shared student components offer no connect,
     sync or disconnect controls here"; `manage` is what gives THIS page the
     coach's own Edit and Remove actions, wired to the admin endpoints. */
  const scope = {
    studentId,
    readOnly: true,
    manage: {
      onEdit: (acct) => { setNotice(''); setPanel({ mode: 'edit', account: acct }); },
      onRemove: (acct) => setRemoving(acct),
    },
  };

  /* Every coach write answers with the refreshed account list, so the new card,
     its ratings and its games appear without a reload — and `onSynced` refreshes
     the roster badge in the list beside it at the same time. */
  const applyAccounts = (r) => {
    if (r?.accounts) setAccounts(r.accounts);
    setRatingsVersion((v) => v + 1);
    setGamesVersion((v) => v + 1);
    setNotice(r?.message || '');
    setSyncNote(r?.syncError || '');
    setPanel(null);
    onSynced?.();
  };

  const openConnect = () => {
    /* Start on the platform that is not linked yet; if both are, the panel
       explains that Edit is the way to change a username. */
    setPlatformChoice(hasChess && !hasLichess ? 'lichess' : 'chess.com');
    setNotice('');
    setPanel({ mode: 'connect' });
  };

  const confirmRemove = async () => {
    const acct = removing;
    setRemoving(null);
    if (!acct) return;
    try {
      const r = await removeStudentAccount(studentId, acct.id);
      setAccounts(r.accounts || []);
      setRatingsVersion((v) => v + 1);
      setGamesVersion((v) => v + 1);
      setNotice(r.message || 'Profile unlinked.');
      setSyncNote('');
      showToast(`${PLATFORM_LABEL[acct.platform] || acct.platform} profile unlinked.`, {
        tone: 'success', title: 'Profile removed',
      });
      onSynced?.();
    } catch (err) {
      showToast(err.response?.data?.message || 'Could not unlink that profile.', {
        tone: 'error', title: 'Remove failed',
      });
    }
  };

  return (
    <div>
      <button className="scp-back" onClick={onBack}>← Back to students</button>
      <Card className="scp-head">
        <div className="scp-head-row">
          <StudentAvatar
            config={student.avatarConfig}
            seed={`user_${student.userId}`}
            size={52}
            className="scp-head-avatar"
          />
          <div className="scp-head-main">
            <p className="scp-head-name">{student.name || 'Unnamed student'}</p>
            <p className="scp-head-meta">
              {list.length === 0 && accounts != null ? (
                <span>No Chess.com or Lichess account connected.</span>
              ) : (
                list.map((a) => (
                  <span key={a.id}>
                    {PLATFORM_ICON[a.platform]} {PLATFORM_ICON[a.platform] ? PLATFORM_LABEL[a.platform] : a.platform} · {a.username}
                  </span>
                ))
              )}
              <span>Last synced {accounts == null ? '…' : formatSynced(lastSyncedAt)}</span>
            </p>
            {syncNote && <p className="scp-head-note">⚠ {syncNote}</p>}
            {notice && <p className="scp-head-ok">✓ {notice}</p>}
          </div>
          <div className="scp-head-actions">
            <Button variant="secondary" size="sm" className="!px-4 !py-2 !text-sm" onClick={openConnect}>
              ＋ Connect profile
            </Button>
            <Button variant="primary" size="sm" className="!px-4 !py-2 !text-sm" onClick={sync} loading={syncing}>
              {syncing ? 'Syncing…' : '↺ Sync now'}
            </Button>
          </div>
        </div>
      </Card>

      {panel && (
        <Card
          title={panel.mode === 'edit'
            ? `Edit ${PLATFORM_LABEL[panel.account.platform] || panel.account.platform} username`
            : 'Connect a profile'}
          piece={panel.mode === 'edit' ? (PLATFORM_ICON[panel.account.platform] || '♟') : '🔗'}
          className="mt-4"
          actions={(
            <Button variant="secondary" size="sm" className="!px-3 !py-1.5 !text-xs" onClick={() => setPanel(null)}>
              Close
            </Button>
          )}
        >
          {panel.mode === 'edit' ? (
            <AccountForm
              platform={panel.account.platform}
              studentId={studentId}
              account={panel.account}
              onDone={applyAccounts}
              onCancel={() => setPanel(null)}
            />
          ) : (
            <div>
              <div className="cp-connect-platforms">
                {LINK_PLATFORMS.map(([key, label, icon]) => {
                  const linked = list.some((a) => a.platform === key);
                  return (
                    <button
                      key={key}
                      type="button"
                      className={`cp-connect-btn${platformChoice === key && !linked ? ' active' : ''}`}
                      disabled={linked}
                      title={linked
                        ? `${label} is already linked — use Edit in that card`
                        : `${label} public API — no password needed`}
                      onClick={() => { setPlatformChoice(key); setNotice(''); }}
                    >
                      <span className="cp-connect-icon">{icon}</span>
                      {label}{linked ? ' · linked' : ''}
                    </button>
                  );
                })}
              </div>
              {bothLinked ? (
                <p className="text-black text-sm mt-3">
                  Both platforms are already linked. Use <strong>Edit</strong> in a platform card below to change a username.
                </p>
              ) : (
                <AccountForm
                  key={platformChoice}
                  platform={platformChoice}
                  studentId={studentId}
                  onDone={applyAccounts}
                />
              )}
            </div>
          )}
        </Card>
      )}

      {/* Three states, never a blank panel: loading, a real error with Retry,
          then the profile itself (whose Overview tab owns the "not connected"
          message for a student with zero accounts). */}
      {accounts == null ? (
        loadError ? (
          <Card title="Could not load this student" piece="⚠" className="mt-4">
            <p className="text-black text-sm">{loadError}</p>
            <div className="mt-3">
              <Button variant="primary" size="sm" className="!px-4 !py-2 !text-sm" onClick={() => load()}>Retry</Button>
            </div>
          </Card>
        ) : (
          <Spinner text="Loading the student's chess profiles…" />
        )
      ) : (
        /* The shared Chess Profile tabs were written for the page's dark-ink
           wrapper. On this white admin surface their component colours are
           light-on-white, so the same ink treatment is applied here — the
           header card stays outside it, keeping the blue action button's own
           white label. */
        <div className="cp-ink-all scp-profile-ink">
          <div className="cp-tabs scp-tabs">
            {PROFILE_TABS.map(([key, label]) => (
              <button
                key={key}
                className={`cp-tab${tab === key ? ' active' : ''}`}
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === 'overview' && (
            <>
              <OverviewTab
                accounts={accounts}
                callbacks={callbacks}
                appReport={NO_APP_REPORT}
                user={null}
                checking={syncing}
                lastSyncedAt={lastSyncedAt}
                lastError={syncNote}
                ratingsVersion={ratingsVersion}
                scope={scope}
                /* With zero accounts, both connect forms sit inside the empty
                   state itself; once one platform is linked, the remaining
                   missing-platform card carries its own form below. */
                emptyExtra={(
                  <div className="scp-empty-connect">
                    {LINK_PLATFORMS.map(([key, label]) => (
                      <div key={key} className="scp-empty-platform">
                        <p className="text-black text-sm">Student has not connected {label} yet.</p>
                        <AccountForm platform={key} studentId={studentId} onDone={applyAccounts} />
                      </div>
                    ))}
                  </div>
                )}
              />
              {list.length > 0 && !hasChess && (
                <Card title="Chess.com" piece="♔" className="mt-4">
                  <p className="text-black text-sm">Student has not connected Chess.com yet.</p>
                  <AccountForm platform="chess.com" studentId={studentId} onDone={applyAccounts} />
                </Card>
              )}
              {list.length > 0 && !hasLichess && (
                <Card title="Lichess" piece="♛" className="mt-4">
                  <p className="text-black text-sm">Student has not connected Lichess yet.</p>
                  <AccountForm platform="lichess" studentId={studentId} onDone={applyAccounts} />
                </Card>
              )}
            </>
          )}
          {tab === 'games' && <GamesTab gamesVersion={gamesVersion} scope={scope} />}
          {tab === 'stats' && <StatsTab scope={scope} />}
          {tab === 'openings' && <OpeningsTab scope={scope} />}
          {tab === 'insights' && <InsightsTab scope={scope} />}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(removing)}
        title="Remove linked profile"
        message={removing
          ? `Unlink the ${PLATFORM_LABEL[removing.platform] || removing.platform} account "${removing.username}" from ${student.name || 'this student'}? Its imported games and ratings will be deleted. The student can connect it again later.`
          : ''}
        confirmText="Remove"
        onCancel={() => setRemoving(null)}
        onConfirm={confirmRemove}
      />
    </div>
  );
}

/* One username form, used in three places: inside a missing-platform card, in
   the header's Connect profile panel, and as the Edit form for an existing
   account. The server owns validation and duplicate rules, so the form just
   renders the message it gets back. */
function AccountForm({ platform, studentId, account = null, onDone, onCancel }) {
  const { showToast } = useToast();
  const editing = Boolean(account);
  const label = PLATFORM_LABEL[platform] || platform;
  const [username, setUsername] = useState(account?.username || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    const value = username.trim();
    if (!value) { setError('Enter a username or profile URL.'); return; }
    if (editing && value.toLowerCase() === String(account.username).toLowerCase()) {
      setError('That is already the linked username.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const r = editing
        ? await updateStudentAccount(studentId, account.id, value)
        : await connectStudentAccount(studentId, platform, value);
      if (r.syncError) {
        showToast(r.syncError, { tone: 'warning', title: 'Linked — import needs a retry' });
      } else {
        showToast(r.message || `${label} profile linked.`, {
          tone: 'success',
          title: editing ? 'Username updated' : 'Profile connected',
        });
      }
      if (!editing) setUsername('');
      onDone?.(r);
    } catch (err) {
      const message = err.response?.data?.message
        || `Could not ${editing ? 'update' : 'connect'} that ${label} profile.`;
      setError(message);
      showToast(message, { tone: 'error', title: editing ? 'Update failed' : 'Connect failed' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="scp-connect-form">
      <div className="scp-connect-row">
        <input
          className="chess-input scp-connect-input"
          placeholder={`${label} username or profile URL`}
          value={username}
          onChange={(e) => { setUsername(e.target.value); setError(''); }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !busy) submit(); }}
          disabled={busy}
          autoComplete="off"
          spellCheck={false}
        />
        <Button
          variant="primary"
          size="sm"
          className="!px-4 !py-2 !text-sm"
          onClick={submit}
          disabled={busy || !username.trim()}
          loading={busy}
        >
          {editing ? 'Save changes' : 'Connect'}
        </Button>
        {editing && (
          <Button variant="secondary" size="sm" className="!px-4 !py-2 !text-sm" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        )}
      </div>
      {busy && (
        <p className="scp-form-hint">
          {editing
            ? 'Re-verifying the username and re-importing the data…'
            : `Verifying on ${label} and importing ratings, games and statistics…`}
        </p>
      )}
      {error && <p className="scp-form-error" role="alert">{error}</p>}
    </div>
  );
}

/* ============================================================ summary */

function AllStudentsSummary({ students, onOpen }) {
  const [sortKey, setSortKey] = useState('name');
  const [sortDir, setSortDir] = useState('asc');

  const rows = useMemo(() => {
    const withValue = students.map((s) => ({ student: s, value: summaryValue(s, sortKey) }));
    withValue.sort((a, b) => {
      const av = a.value;
      const bv = b.value;
      /* Missing ratings sink to the bottom in both directions: "no rating" is
         not a low rating, and it must not win an ascending sort. */
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = typeof av === 'string' || typeof bv === 'string'
        ? String(av).localeCompare(String(bv))
        : Number(av) - Number(bv);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return withValue.map((r) => r.student);
  }, [students, sortKey, sortDir]);

  const toggleSort = (key) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'name' ? 'asc' : 'desc');
    }
  };

  const exportCsv = () => {
    const header = ['Student', 'Chess.com username', 'Chess.com rapid', 'Chess.com blitz', 'Chess.com bullet',
      'Lichess username', 'Lichess rapid', 'Lichess blitz', 'Lichess bullet', 'Total games', 'Last synced'];
    const lines = [header.map(csvCell).join(',')];
    for (const s of rows) {
      const chess = accountOf(s, 'chess.com');
      const lichess = accountOf(s, 'lichess');
      lines.push([
        s.name || '',
        chess?.username || '',
        ratingOf(s, 'chess.com', 'rapid'),
        ratingOf(s, 'chess.com', 'blitz'),
        ratingOf(s, 'chess.com', 'bullet'),
        lichess?.username || '',
        ratingOf(s, 'lichess', 'rapid'),
        ratingOf(s, 'lichess', 'blitz'),
        ratingOf(s, 'lichess', 'bullet'),
        Number(s.totalGames) || 0,
        lastSyncedOf(s) || '',
      ].map(csvCell).join(','));
    }
    const blob = new Blob([`\ufeff${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `student-chess-profiles-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (students.length === 0) {
    return (
      <Card title="No students match" piece="♟" className="mt-4">
        <p className="text-black text-sm">No students match that search or filter.</p>
      </Card>
    );
  }

  return (
    <Card
      title="All students"
      piece="📊"
      className="mt-4"
      actions={<Button variant="secondary" size="sm" className="!px-3 !py-1.5 !text-xs" onClick={exportCsv}>⬇ Export CSV</Button>}
    >
      <p className="text-black/60 text-xs mb-3">
        {students.length} student{students.length === 1 ? '' : 's'} · click a column to sort · missing ratings sort last
      </p>
      <div className="scp-table-wrap">
        <table className="scp-table">
          <thead>
            <tr>
              {SUMMARY_COLUMNS.map((col) => (
                <th key={col.key} className={col.align === 'left' ? 'scp-th-left' : ''}>
                  <button className="scp-sort" onClick={() => toggleSort(col.key)}>
                    {col.label}
                    {sortKey === col.key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.userId}>
                <td className="scp-td-student">
                  <button className="scp-link" onClick={() => onOpen(s.userId)}>{s.name || 'Unnamed student'}</button>
                </td>
                {SUMMARY_COLUMNS.slice(1).map((col) => {
                  const v = summaryValue(s, col.key);
                  if (col.key === 'lastSyncedAt') {
                    return <td key={col.key} className="scp-td-muted">{formatSynced(v)}</td>;
                  }
                  return <td key={col.key}>{v == null || v === '' ? '—' : v}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
