import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../services/api';
import { Page, Spinner } from '../components/ui';
import { useToast } from '../components/Toast';
import Button from '../components/Button';

/* Which categories each role's list shows.
 *
 * The registry groups features onto shelves called General / Coach Tools /
 * Student Tools, but "which shelf is this on" and "which account uses this" are
 * different questions. Showing Coach Tools inside Students access put ten
 * switches in front of a Super Admin that do nothing for a student, and Student
 * Tools then appeared word for word under Coaches access. So each list shows
 * General plus its own shelf, and one selector chooses which role is on screen
 * instead of both lists sitting on the page at once. */
const SHARED_CATEGORIES = ['General'];

/* Features on one shelf that are gated for BOTH roles.
 *
 * GM Games was the first: a coach imports and annotates grandmaster games
 * while a student opens the same games read-only to study, and both
 * navigations gate on `gm_games`. Chess Tactics is the same shape — one
 * learning section with a coach entry and a student entry. Filtering by shelf
 * alone would drop them from the Students list and quietly revoke the
 * student's pages, so they are listed under both roles. */
const BOTH_ROLES = new Set(['gm_games', 'chess_tactics']);

export const ROLES = [
  {
    key: 'student',
    label: 'Student',
    plural: 'Students',
    icon: '♟',
    shelf: 'Student Tools',
    blurb: 'What every Student account can use. A section switched off here disappears from a student\'s navigation entirely, and its API endpoints answer 403.',
  },
  {
    key: 'coach',
    label: 'Coach',
    plural: 'Coaches',
    icon: '♜',
    shelf: 'Coach Tools',
    blurb: 'What every Coach account can use. A section switched off here disappears from a coach\'s navigation entirely, and its API endpoints answer 403.',
  },
];

/** Whether one role's list should offer this feature at all.
 *  Exported so the shelf rule can be tested against real registry rows instead of
 *  being pinned by a source regex. */
export const roleSees = (roleKey, feature) =>
  BOTH_ROLES.has(feature.key) ||
  SHARED_CATEGORIES.includes(feature.category) ||
  ROLES.find((r) => r.key === roleKey)?.shelf === feature.category;

/** The registry column that holds one role's switch. */
const columnFor = (role) => (role === 'student' ? 'student_enabled' : 'coach_enabled');

const TABS = [
  { key: 'roles', label: 'Role Access' },
  { key: 'overrides', label: 'User Overrides' },
];

/** An on/off switch.
 *
 *  Two states only: On or Off. A third "Inherit" state was tried and removed —
 *  it resolved to the same thing as Off anyway (the platform default is Off), so
 *  it was a state that looked meaningful and granted nothing. */
function Toggle({ checked, disabled, onChange, label, hint }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={hint || (checked ? 'On — allowed for this role' : 'Off — blocked for this role')}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`perm-toggle ${checked ? 'perm-toggle--on' : ''}`}
    >
      <span className="perm-toggle__knob" />
      <span className="perm-toggle__text">{checked ? 'On' : 'Off'}</span>
    </button>
  );
}

/** One registry row for ONE role: the feature, then that role's switch.
 *
 *  Extracted from the panel's inline map so the wiring can be render-tested. The
 *  bug it guards against was invisible to every other check: an earlier version
 *  mapped the roles inside this component and shadowed the feature-row variable
 *  with the role variable, so the value was read off the ROLE object and every
 *  row rendered the same state and every save wrote the feature key "student".
 *  `npm run build` stayed green because Vite does not resolve identifiers inside
 *  JSX bodies. */
function FeatureRow({ feature, role, saving, onToggle }) {
  const roleLabel = ROLES.find((r) => r.key === role)?.label ?? role;
  return (
    <div className="perm-row perm-row--single">
      <span className="min-w-0">
        <span className="block font-semibold text-ivory-100">{feature.name}</span>
        <span className="block text-xs text-ivory-500 truncate">{feature.description}</span>
        <code className="text-[0.65rem] text-ivory-500/70">{feature.key}</code>
      </span>
      <Toggle
        /* The API always sends a strict boolean now; === true keeps a legacy
           null from reading as On. */
        checked={feature[columnFor(role)] === true}
        /* Keyed on feature AND role so the same key can never be reused for the
           other role's switch. */
        disabled={Boolean(saving[`${feature.key}:${role}`])}
        label={`${feature.name} for ${roleLabel}`}
        hint={`${roleLabel} access to ${feature.name}`}
        onChange={(next) => onToggle(feature.key, role, next)}
      />
    </div>
  );
}

/** Per-user exceptions. Search a member, then override single features for
 *  them without touching the whole role. */
function OverridesTab() {
  const { showToast } = useToast();
  const [q, setQ] = useState('');
  const [users, setUsers] = useState(null);
  const [selected, setSelected] = useState(null);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);

  /* Debounced search so typing doesn't fire a request per keystroke. */
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setUsers([]); return undefined; }
    const id = setTimeout(async () => {
      try {
        /* GET /permissions/users?q= — students and coaches only. */
        const res = await api.get(`/permissions/users?q=${encodeURIComponent(term)}`, { cache: false });
        setUsers(Array.isArray(res.data) ? res.data : []);
      } catch {
        setUsers([]);
      }
    }, 300);
    return () => clearTimeout(id);
  }, [q]);

  async function open(user) {
    setSelected(user);
    setData(null);
    try {
      const res = await api.get(`/permissions/users/${user.id}`, { cache: false });
      setData(res.data);
    } catch {
      setData(null);
    }
  }

  async function setOverride(featureKey, value) {
    if (!selected) return;
    setBusy(true);
    try {
      await api.put(`/permissions/users/${selected.id}/${featureKey}`, { isEnabled: value });
      const res = await api.get(`/permissions/users/${selected.id}`, { cache: false });
      setData(res.data);
    } catch (err) {
      showToast(err.response?.data?.message || 'Could not save the override', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="chess-card">
        <label className="block">
          <span className="text-xs text-ivory-500">Search a student or coach</span>
          <input
            className="chess-input mt-1"
            placeholder="Type a name or email…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>

        {users?.length > 0 && (
          <ul className="mt-3 space-y-1 max-h-72 overflow-y-auto">
            {users.map((u) => (
              <li key={u.id}>
                <button
                  type="button"
                  onClick={() => open(u)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition flex items-center justify-between gap-2 ${
                    selected?.id === u.id
                      ? 'bg-gold-500/15 text-gold-400'
                      : 'text-ivory-300 hover:bg-white/5'
                  }`}
                >
                  <span className="truncate">
                    {u.name}
                    {u.nickname && <span className="text-ivory-500"> “{u.nickname}”</span>}
                    <span className="text-ivory-500"> · {u.email}</span>
                  </span>
                  <span className="text-xs text-ivory-500 shrink-0">
                    {u.role === 'admin' ? 'Coach' : 'Student'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {users?.length === 0 && q.trim().length >= 2 && (
          <p className="mt-3 text-sm text-ivory-500">
            No matching students or coaches. Search by name or email.
          </p>
        )}
      </div>

      {selected && !data && <div className="chess-card"><Spinner text="Loading their access…" /></div>}

      {selected && data && (
        <section className="chess-card overflow-hidden !p-0">
          <h2 className="perm-cat">
            <span className="chess-card-piece">♟</span>
            {data.user.name}
            <span className="text-ivory-500 font-normal normal-case tracking-normal text-xs ml-1">
              {data.user.role === 'admin' ? 'Coach' : 'Student'} · role defaults
            </span>
          </h2>

          {data.ungated && (
            <p className="px-4 py-3 text-sm text-ivory-400 border-b border-ivory-700/20">
              This account is a Super Admin and is never gated — overrides have no effect.
            </p>
          )}

          <div className="perm-row perm-row--head">
            <span>Feature</span>
            <span className="text-center">Role default</span>
            <span className="text-center">For this user</span>
          </div>

          {data.features.map((f) => (
            <div key={f.key} className="perm-row">
              <span className="min-w-0">
                <span className="block font-semibold text-ivory-100">{f.name}</span>
                <code className="text-[0.65rem] text-ivory-500/70">{f.key}</code>
              </span>
              <span className="flex justify-center">
                <span
                  className={`text-xs font-bold ${f.role_default ? 'text-emerald-400' : 'text-ivory-500'}`}
                >
                  {f.role_default ? 'On' : 'Off'}
                </span>
              </span>
              <span className="flex justify-center items-center gap-2">
                <Toggle
                  checked={f.effective}
                  disabled={busy || data.ungated}
                  label={`${f.name} for ${data.user.name}`}
                  onChange={(next) => setOverride(f.key, next)}
                />
                {f.override_value !== null && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setOverride(f.key, null)}
                    className="text-[0.65rem] text-ivory-500 hover:text-ivory-300 underline underline-offset-2"
                    title="Clear this override and fall back to the role default"
                  >
                    clear
                  </button>
                )}
              </span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

/** The panel itself, with no page chrome — so the Super Admin page can host it
 *  as one of its own sections. See the default export for the standalone route. */
export function FeatureAccessPanel() {
  const { showToast } = useToast();
  const [tab, setTab] = useState('roles');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  /* Which role's list is on screen. Only one at a time - two full lists on one
     page doubled the switches for no benefit and made it easy to change the
     wrong role's access. */
  const [role, setRole] = useState('student');
const [saving, setSaving] = useState({}); // "key:role" -> true while in flight

      /* Monotonic ticket for load(). Every save re-reads the registry, so flipping
         several switches in a row puts several requests in flight at once. Their
         responses can arrive out of order, and the slowest one to land would
         otherwise win - repainting the panel with a snapshot taken before the
         newer writes committed, which is how a switch you had just turned on
         appeared to turn itself back off. Only the newest read may paint. */
      const loadSeq = useRef(0);

      const load = useCallback(async () => {
        const seq = (loadSeq.current += 1);
        try {
      /* Every read here opts out of the 30s GET memo in `api`. This panel's whole
         job is to show the CURRENT switches, and a cached registry would show the
         state from before a change and make a saved toggle look like it did
         nothing. The writes invalidate the cache too, but a mount that lands
         inside the window would otherwise start from a stale snapshot. */
const res = await api.get('/permissions/features', { cache: false });
            /* A newer read has already been issued - this response is stale. */
            if (seq !== loadSeq.current) return;
            setRows(Array.isArray(res.data) ? res.data : []);
            setError('');
          } catch (err) {
            if (seq !== loadSeq.current) return;
            setError(err.response?.data?.message || 'Could not load the feature registry');
          }
  }, []);

  useEffect(() => { load(); }, [load]);

  /* Only the features this role can actually be granted. */
  const roleRows = useMemo(
    () => (rows ?? []).filter((r) => roleSees(role, r)),
    [rows, role],
  );

  const categories = useMemo(
    () => ['all', ...new Set(roleRows.map((r) => r.category))],
    [roleRows],
  );

  /* The category list can hold a value the current role can no longer see after
     switching roles, which would otherwise leave the select showing a filter
     that silently matches nothing. */
  useEffect(() => {
    if (category !== 'all' && !categories.includes(category)) setCategory('all');
  }, [category, categories]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return roleRows.filter((r) => {
      if (category !== 'all' && r.category !== category) return false;
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        r.key.toLowerCase().includes(q) ||
        (r.description || '').toLowerCase().includes(q)
      );
    });
  }, [roleRows, query, category]);

  /** The "N of M on" tally shown on the role selector. */
  const tallyFor = (roleKey) => {
    const seen = (rows ?? []).filter((r) => roleSees(roleKey, r));
    return { on: seen.filter((r) => r[columnFor(roleKey)] === true).length, total: seen.length };
  };

  /** Group the filtered rows by category, preserving the server's ordering. */
  const grouped = useMemo(() => {
    const map = new Map();
    for (const r of visible) {
      if (!map.has(r.category)) map.set(r.category, []);
      map.get(r.category).push(r);
    }
    return [...map.entries()];
  }, [visible]);

  /* `next` is the new boolean for that ONE role. */
  async function toggle(featureKey, role, next) {
    const id = `${featureKey}:${role}`;
    const value = Boolean(next);
    const meta = ROLES.find((r) => r.key === role);
    const feature = (rows ?? []).find((r) => r.key === featureKey);
    setSaving((s) => ({ ...s, [id]: true }));
    /* Optimistic: flip immediately so the row feels instant. */
    setRows((prev) =>
      prev.map((r) =>
        r.key === featureKey
          ? { ...r, [columnFor(role)]: value }
          : r,
      ),
    );
    try {
      await api.patch(`/permissions/features/${featureKey}`, { role, isEnabled: value });
      /* Re-read from the server so what stays on screen is the stored value, not
         just what we assumed. Without this a rejected-but-200 write (or a value
         the server clamped) would leave the panel showing a state that is not
         real - which is what "I clicked it and nothing changed" looked like. */
      await load();
      showToast(
        `${feature?.name || featureKey} is now ${value ? 'ON' : 'OFF'} for ${meta?.plural || role}.`,
        { tone: value ? 'success' : 'info', title: 'Access saved' },
      );
    } catch (err) {
      showToast(err.response?.data?.message || 'Could not save that change', { tone: 'error' });
      await load(); // roll back to the server truth
    } finally {
      setSaving((s) => { const n = { ...s }; delete n[id]; return n; });
    }
  }

  if (error) {
    return (
      <div className="chess-card">
        <p className="text-sm text-ivory-400">
          The feature registry could not be loaded. Has the migration been applied?
        </p>
        <Button type="button" variant="primary" size="md" className="mt-3" onClick={load}>Retry</Button>
      </div>
    );
  }

  if (!rows) {
    return (
      <div className="chess-card">
        <Spinner text="Loading the registry…" />
      </div>
    );
  }

  return (
    <>
      {/* ── tabs ── */}
      <div className="flex flex-wrap gap-2 mb-4">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`perm-tab ${tab === t.key ? 'perm-tab--on' : ''}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'roles' && (
        <div className="space-y-4">
          

          {/* ── per-member access, surfaced on the main tab because it is the
                 other half of "who can use what" and easy to miss otherwise. ── */}
          <button
            type="button"
            onClick={() => setTab('overrides')}
            className="chess-card chess-card-hover w-full text-left flex flex-wrap items-center justify-between gap-3 no-underline"
          >
            <span className="flex items-center gap-3 min-w-0">
              <span className="text-2xl">♟</span>
              <span className="min-w-0">
                <span className="block font-semibold text-ivory-100">
                  Allow a particular student or coach
                </span>
                <span className="block text-xs text-ivory-500">
                  Search for one member and override what they can see, without changing
                  anyone else&apos;s role.
                </span>
              </span>
            </span>
            <span className="chess-chip shrink-0">Pick a member →</span>
          </button>

          {/* ── which role is being edited ──
              One role at a time. Two full lists on one page doubled the
              switches and made it easy to grant access to the wrong role. */}
          <div className="chess-card">
            <div className="perm-roleswitch__label">Edit access for</div>
            <div role="radiogroup" aria-label="Which role's access to edit" className="perm-roleswitch">
              {ROLES.map((r) => {
                const tally = tallyFor(r.key);
                return (
                  <button
                    key={r.key}
                    type="button"
                    role="radio"
                    aria-checked={role === r.key}
                    onClick={() => setRole(r.key)}
                    className={`perm-roleswitch__opt ${role === r.key ? 'perm-roleswitch__opt--on' : ''}`}
                  >
                    <span className="text-lg leading-none" aria-hidden="true">{r.icon}</span>
                    {r.plural}
                    <span className="perm-roleswitch__count">
                      {tally.on} of {tally.total} on
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── search / filter (applies to the selected role) ── */}
          <div className="chess-card flex flex-wrap items-end gap-3">
            <p className="w-full text-xs text-ivory-500">
              Showing {ROLES.find((r) => r.key === role)?.plural.toLowerCase()} only —{' '}
              {ROLES.find((r) => r.key === role)?.shelf} plus shared settings.
            </p>
            <label className="flex-1 min-w-[200px]">
              <span className="text-xs text-ivory-500">Search features</span>
              <input
                className="chess-input mt-1"
                placeholder="Name, key or description…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <label className="min-w-[160px]">
              <span className="text-xs text-ivory-500">Category</span>
              <select
                className="chess-input mt-1"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                {categories.map((c) => (
                  <option key={c} value={c}>{c === 'all' ? 'All categories' : c}</option>
                ))}
              </select>
            </label>
          </div>

          {visible.length === 0 && (
            <div className="chess-card text-center py-10 text-sm text-ivory-500">
              No features match “{query}”.
            </div>
          )}

          {/* ── the selected role's list ──
              One list, under the selector that says whose it is. A switch is
              only ever inside the heading that names the role it changes. */}
          {visible.length > 0 && (
            <section className="chess-card overflow-hidden !p-0">
              <h2 className="perm-cat">
                <span className="chess-card-piece">{ROLES.find((r) => r.key === role)?.icon}</span>
                {ROLES.find((r) => r.key === role)?.plural} access
                <span className="perm-rolehead__count">
                  {tallyFor(role).on} of {tallyFor(role).total} on
                </span>
              </h2>
              <p className="perm-roledesc">{ROLES.find((r) => r.key === role)?.blurb}</p>
              <div className="perm-row perm-row--head perm-row--single">
                <span>Feature</span>
                <span className="text-center">{ROLES.find((r) => r.key === role)?.label}</span>
              </div>
              {grouped.map(([cat, list]) => (
                <div key={cat}>
                  <h3 className="perm-subcat">
                    {cat}
                    <span>({list.length})</span>
                  </h3>
                  {list.map((r) => (
                    <FeatureRow
                      key={r.key}
                      feature={r}
                      role={role}
                      saving={saving}
                      onToggle={toggle}
                    />
                  ))}
                </div>
              ))}
            </section>
          )}
        </div>
      )}

      {tab === 'overrides' && <OverridesTab />}
    </>
  );
}

/** Standalone page route (/super/features) — the same panel with its own title. */
export default function FeatureAccess() {
  return (
    <Page
      title="Feature Access Control"
      piece="♜"
      sub="Decide which sections each role can see and use. Anything switched off is hidden completely — it disappears from navigation and its API endpoints return 403."
    >
      <FeatureAccessPanel />
    </Page>
  );
}

/* Exported for scripts/feature-access-panel.test.mjs, which renders
 * FeatureRow/Toggle directly. Render tests are the only thing that catches a JSX
 * body referencing an identifier that no longer exists — `npm run build` does
 * not resolve identifiers, so dropping a prop leaves the build green while the
 * component throws ReferenceError in the browser. */
export { FeatureRow, Toggle };
