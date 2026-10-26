import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { Piece, Reveal } from '../components/ui';
import Button from '../components/Button';
import usePageTitle from '../hooks/usePageTitle';
import { APP_NAME } from '../config/brand';

export default function ResetPassword() {
  usePageTitle('Reset Password');
  const { resetPassword } = useAuth();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [form, setForm] = useState({ username: '', recoveryCode: '', newPassword: '', confirm: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (form.newPassword !== form.confirm) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      await resetPassword(form.username.trim(), form.recoveryCode.trim(), form.newPassword);
      // Always the same generic confirmation (whether or not the details matched).
      setDone(true);
    } catch (err) {
      const msg = err.response?.data?.message || 'Password reset failed';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-[calc(100vh-2rem)] flex items-center justify-center px-4 py-10">
      <Reveal>
        <div className="chess-card chess-card-hover p-8 md:p-10 w-full max-w-xl">
          <div className="flex flex-col items-center text-center mb-6">
            <p className="text-[0.65rem] font-semibold uppercase tracking-[0.22em] text-ivory-500 mb-2">{APP_NAME}</p>
            <span className="inline-block text-4xl text-gold-500 piece-glyph-spin mb-1">♛</span>
            <br />
            <h1 className="font-display text-2xl md:text-3xl font-bold text-ivory-100">Reset your password</h1>
            <p className="text-ivory-500 text-sm mt-1">
              Use the one-time recovery code you saved at signup.
            </p>
          </div>

          {done ? (
            <div className="text-center py-6">
              <span className="text-5xl block mb-3">♝</span>
              <h2 className="font-display text-xl font-bold text-ivory-100">All set</h2>
              <p className="text-sm text-ivory-300 mt-2">
                If the details were correct, your password has been reset. You can now log in
                with your new password.
              </p>
              <p className="text-xs text-ivory-500 mt-2">
                No email exists on this account, so this is the only recovery path. If the code
                is lost, only a coach can help.
              </p>
              <Button onClick={() => navigate('/login')} variant="primary" size="md" fullWidth className="mt-6">
                Back to login
              </Button>
            </div>
          ) : (
            <>
              {error && <div className="chess-error">{error}</div>}
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="text-sm font-medium text-ivory-300 block">Username</label>
                  <input
                    required
                    value={form.username}
                    onChange={(e) => setForm({ ...form, username: e.target.value })}
                    className="chess-input mt-1.5"
                    placeholder="your username"
                    autoComplete="username"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-ivory-300 block">Recovery code</label>
                  <input
                    required
                    maxLength={10}
                    value={form.recoveryCode}
                    onChange={(e) => setForm({ ...form, recoveryCode: e.target.value })}
                    className="chess-input mt-1.5 font-mono tracking-[0.3em] uppercase"
                    placeholder="10-character code"
                    autoComplete="one-time-code"
                  />
                </div>
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-ivory-300 block">New password</label>
                    <input
                      type="password"
                      required
                      minLength={8}
                      value={form.newPassword}
                      onChange={(e) => setForm({ ...form, newPassword: e.target.value })}
                      className="chess-input mt-1.5"
                      placeholder="At least 8 characters"
                      autoComplete="new-password"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-ivory-300 block">Confirm password</label>
                    <input
                      type="password"
                      required
                      minLength={8}
                      value={form.confirm}
                      onChange={(e) => setForm({ ...form, confirm: e.target.value })}
                      className="chess-input mt-1.5"
                      placeholder="••••••••"
                      autoComplete="new-password"
                    />
                  </div>
                </div>
                <Button disabled={loading} variant="primary" size="md" fullWidth>
                  <Piece p={loading ? '♞' : '♘'} spin={loading} />
                  {loading ? 'Resetting…' : 'Reset password'}
                </Button>
              </form>
              <p className="text-xs text-ivory-500 mt-5">
                No email address is collected on this platform, so there is no automated
                recovery if you lose the code. Keep it safe.
              </p>
              <p className="text-sm text-ivory-500 mt-3">
                Remembered it after all?{' '}
                <Link to="/login" className="chess-link">Login</Link>
              </p>
            </>
          )}
        </div>
      </Reveal>
    </div>
  );
}