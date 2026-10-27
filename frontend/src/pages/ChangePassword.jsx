import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { Page, Card } from '../components/ui';
import { homeForRole } from '../utils/roles';
import Button from '../components/Button';
import PasswordInput from '../components/PasswordInput';

/**
 * The forced password change.
 *
 * A student registered by the academy signs in with the password the academy
 * issued - the one in their welcome mail. The account is flagged
 * (`must_change_password`), and this screen is where that flag is cleared: the
 * student sets a password of their own and the old one stops working at once.
 *
 * The app sends them here before anything else (see ProtectedRoute), so this
 * page is deliberately plain: no navigation, no side panels, nothing else to
 * click.
 */
export default function ChangePassword() {
  const { user, changeMyPassword } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (password.length < 8) {
      setError('Password must be at least 8 characters long');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setSaving(true);
    try {
      await changeMyPassword(password);
      showToast('Your password has been changed.', { tone: 'success', title: 'Password changed' });
      navigate(homeForRole(user?.role), { replace: true });
    } catch (err) {
      const msg = err?.response?.data?.message || 'Could not change the password';
      setError(msg);
      showToast(msg, { tone: 'error', title: 'Password not changed' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Page title="Set your password" piece="♞" sub="One step before you start: choose a password only you know.">
      <Card className="max-w-md">
        <p className="text-sm text-ivory-600 mb-4">
          Hello {user?.name || 'there'} — you signed in with the password the
          academy gave you. Please set your own password now.
        </p>
        <form onSubmit={submit} className="space-y-3">
          <label className="block">
            <span className="text-xs text-ivory-500">New password</span>
            <PasswordInput
              required
              minLength={8}
              autoComplete="new-password"
              className="chess-input mt-1"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
            />
          </label>
          <label className="block">
            <span className="text-xs text-ivory-500">Confirm new password</span>
            <PasswordInput
              required
              minLength={8}
              autoComplete="new-password"
              className="chess-input mt-1"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Type it again"
            />
          </label>
          {error && <div className="chess-error">{error}</div>}
          <Button type="submit" disabled={saving} variant="primary" size="md" fullWidth className="w-full">
            {saving ? 'Saving…' : 'Save my password'}
          </Button>
        </form>
      </Card>
    </Page>
  );
}
