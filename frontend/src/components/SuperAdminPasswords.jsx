import { useEffect, useState } from 'react';
import api from '../services/api';
import { Chip } from './ui';
import { useToast } from './Toast';
import Button from './Button';
// Password help panel: list accounts, reset password or issue code.
export default function SuperAdminPasswords() {
  const { showToast } = useToast();
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [selected, setSelected] = useState(null);
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [resetting, setResetting] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [issuedCode, setIssuedCode] = useState(null);
  async function load() {
    setLoading(true); setError('');
    try {
      const res = await api.get('/admins/accounts', { cache: false });
      setAccounts(Array.isArray(res.data) ? res.data : []);
    } catch (err) { setError(err.response?.data?.message || 'Failed to load accounts'); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);
  const filtered = accounts.filter((a) => {
    if (roleFilter !== 'all' && a.role !== roleFilter) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [a.name, a.username, a.email, a.phone].some((v) => String(v || '').toLowerCase().includes(q));
  });
  function open(a) { setSelected(a); setPw1(''); setPw2(''); setIssuedCode(null); }
  function close() { setSelected(null); setPw1(''); setPw2(''); setIssuedCode(null); }
  async function issueCode() {
    if (!selected) return;
    setIssuing(true);
    try {
      const res = await api.post('/admins/' + selected.id + '/recovery-code');
      setIssuedCode(res.data?.recoveryCode || null);
      load();
      showToast('Code issued - pass it on now, shown only once.', { tone: 'success', title: 'Recovery code issued' });
    } catch (err) { showToast(err.response?.data?.message || 'Failed to issue code', { tone: 'error' }); }
    finally { setIssuing(false); }
  }
  async function directReset(e) {
    if (e) e.preventDefault();
    if (!selected) return;
    if (!pw1 || pw1.length < 8) { showToast('Min 8 characters.', { tone: 'error' }); return; }
    if (pw1 !== pw2) { showToast('Passwords do not match.', { tone: 'error' }); return; }
    setResetting(true);
    try {
      await api.post('/admins/' + selected.id + '/reset-password', { newPassword: pw1 });
      showToast('Password reset. Tell them the new password.', { tone: 'success', title: 'Password reset' });
      setPw1(''); setPw2(''); load();
    } catch (err) { showToast(err.response?.data?.message || 'Failed to reset', { tone: 'error' }); }
    finally { setResetting(false); }
  }
  return (
    <div className="space-y-4">
      <div className="chess-card">
        <h2 className="chess-card-title">
          <span className="chess-card-piece">♟</span>
          <span className="flex-1">All passwords</span>
          <Button type="button" onClick={load} variant="secondary" size="sm" className="!px-3 !py-1 text-xs">{loading ? 'Loading…' : 'Refresh'}</Button>
        </h2>
        <p className="text-xs text-ivory-500 leading-relaxed">Super admin only. Passwords are bcrypt hashes so they can never be displayed. Set a new password or issue a one-time code, then pass it to the member.</p>
        <div className="flex flex-wrap gap-2 mt-3">
          <input className="chess-input flex-1 min-w-[200px]" placeholder="Search name, username, email…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select className="chess-input w-auto" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
            <option value="all">All roles</option>
            <option value="student">Students</option>
            <option value="admin">Coaches</option>
            <option value="superadmin">Super admins</option>
          </select>
        </div>
        {error && <div className="chess-error mt-3">{error}</div>}
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] uppercase tracking-wider text-ivory-500">
              <th className="py-2 pr-3">Name</th><th className="py-2 pr-3">Username</th><th className="py-2 pr-3">Email</th><th className="py-2 pr-3">Role</th><th className="py-2 text-right">Action</th>
            </tr></thead>
            <tbody>
              {loading && accounts.length === 0 ? (<tr><td colSpan={5} className="py-6 text-center text-ivory-500 text-sm">Loading…</td></tr>)
                : filtered.length === 0 ? (<tr><td colSpan={5} className="py-6 text-center text-ivory-500 text-sm">No accounts found.</td></tr>)
                  : filtered.map((a) => (
                    <tr key={a.id} className="border-t border-ivory-700/40">
                      <td className="py-2 pr-3 font-medium text-ivory-100">{a.name}</td>
                      <td className="py-2 pr-3 text-ivory-400 font-mono text-xs">@{a.username || '-'}</td>
                      <td className="py-2 pr-3 text-ivory-400 text-xs truncate max-w-[180px]">{a.email}</td>
                      <td className="py-2 pr-3"><Chip tone={a.role === 'admin' ? 'green' : ''}>{a.role === 'admin' ? 'Coach' : a.role === 'superadmin' ? 'Owner' : 'Student'}</Chip></td>
                      <td className="py-2 text-right"><Button type="button" onClick={() => open(a)} variant="secondary" size="sm" className="!px-3 !py-1 text-xs">Reset / Code</Button></td>
                    </tr>))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-ivory-500 mt-2">{filtered.length} of {accounts.length} accounts</p>
      </div>
      {selected && (
        <div className="fixed inset-0 z-[var(--z-modal-backdrop)] grid place-items-center bg-black/60 p-4" onClick={close} role="dialog" aria-modal="true">
          <div className="chess-card max-w-md w-full p-6 max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0"><h3 className="font-display text-lg font-bold text-ivory-100 truncate">{selected.name}</h3>
                <p className="text-xs text-ivory-500">@{selected.username || '-'} · {selected.email}</p></div>
              <button type="button" onClick={close} className="text-ivory-500 text-lg">✕</button>
            </div>
            <p className="text-[11px] text-ivory-500 mt-2">Current password cannot be shown (bcrypt is one-way). Set a new one and tell it to the member.</p>
            <form onSubmit={directReset} className="mt-4 space-y-3">
              <div><label className="text-xs text-ivory-500">New password (min 8)</label>
                <input type="password" className="chess-input mt-1" value={pw1} onChange={(e) => setPw1(e.target.value)} placeholder="••••••••" autoComplete="new-password" /></div>
              <div><label className="text-xs text-ivory-500">Confirm password</label>
                <input type="password" className="chess-input mt-1" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="••••••••" autoComplete="new-password" /></div>
              <Button disabled={resetting} variant="primary" size="md" fullWidth>{resetting ? 'Resetting…' : 'Set new password'}</Button>
            </form>
            <div className="mt-4 pt-4 border-t border-ivory-700/40">
              <p className="text-[11px] uppercase tracking-wider text-ivory-500 font-semibold">One-time recovery code</p>
              {issuedCode ? (<div className="mt-1 px-3 py-2 rounded-lg border border-amber-400/40 bg-amber-400/10 font-mono text-lg tracking-[0.3em] text-amber-300 text-center select-all cursor-pointer" onClick={() => { try { navigator.clipboard.writeText(issuedCode); showToast('Copied.', { tone: 'success' }); } catch { } }}>{issuedCode}</div>)
                : (<Button disabled={issuing} type="button" onClick={issueCode} variant="secondary" size="md" fullWidth className="mt-2 !py-2 text-sm">{issuing ? 'Issuing…' : 'Issue recovery code'}</Button>)}
            </div>
          </div>
        </div>)}
    </div>
  );
}