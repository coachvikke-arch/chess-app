import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { AUTH_MESSAGE_KEY } from '../services/api';
import { Piece, Reveal } from '../components/ui';
import PasswordField from '../components/PasswordField';
import AnimatedBoard from '../components/AnimatedBoard';
import { homeForRole } from '../utils/roles';
import Button from '../components/Button';
import usePageTitle from '../hooks/usePageTitle';
import { APP_NAME } from '../config/brand';

export default function Login() {
  usePageTitle('Login');
  const { login, user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [form, setForm] = useState({ identifier: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  /* "Forgot password?" now opens a popup telling the user to contact their
     coach — there is no self-service reset without the one-time recovery
     code, and that code can only be re-issued by a super admin. */
  const [forgotOpen, setForgotOpen] = useState(false);

  /* An already-signed-in visitor must never be shown the login form. The
     `/login` entry stays in browser history after a successful sign-in, so the
     in-app Back button (which does navigate(-1)) lands here with a perfectly
     valid token — and rendering the form there reads exactly like being logged
     out. `replace` so the stale history entry is not left behind to step into
     again. This is what makes "stay signed in until you click Logout" hold no
     matter which entry Back happens to land on. */
  useEffect(() => {
    if (!authLoading && user) navigate(homeForRole(user.role), { replace: true });
  }, [authLoading, user, navigate]);

  /* If we were sent here because our session was revoked (the account signed in
     on another device), the API interceptor stashed the reason in
     sessionStorage — surface it on the form and as a toast, then clear it so a
     normal reload does not repeat it. */
  useEffect(() => {
    let msg = '';
    try { msg = sessionStorage.getItem(AUTH_MESSAGE_KEY) || ''; } catch { /* ignore */ }
    if (!msg) return;
    setError(msg);
    showToast(msg, { tone: 'error', title: 'Signed out' });
    try { sessionStorage.removeItem(AUTH_MESSAGE_KEY); } catch { /* ignore */ }
  }, [showToast]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const user = await login(form.identifier, form.password);
      showToast(
        (user.role === 'superadmin' ? 'Welcome back, academy owner — your board is ready.'
          : user.role === 'admin' ? 'Welcome back, coach — your board is ready.'
            : 'Your classes, puzzles and progress are waiting.'),
        { tone: 'success', title: `Welcome back, ${user.name}! 👋` }
      );
      /* Every role uses the shared helper so the post-login destination can
         never drift from the wrong-role redirect in ProtectedRoute. */
      navigate(homeForRole(user.role));
    } catch (err) {
      const msg = err.response?.data?.message || 'Login failed';
      setError(msg);
      showToast('Please check your username and password and try again.', {
        tone: 'error',
        title: 'Invalid username or password',
      });
    } finally {
      setLoading(false);
    }
  }

  /* Don't flash the form for a split second before the redirect above fires. */
  if (!authLoading && user) return null;

  return (
    <div className="min-h-[calc(100vh-2rem)] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-4xl grid md:grid-cols-2 gap-0 items-stretch">
        {/* Decorative panel */}
        <Reveal className="hidden md:block">
          <div className="h-full rounded-l-3xl border border-ivory-700/50 bg-gradient-to-br from-gold-500/[0.07] via-transparent to-transparent p-8 flex flex-col justify-center overflow-hidden relative bg-ink-800">
            <span className="absolute -top-4 -left-2 text-8xl text-gold-500/15 piece-glyph-spin">♞</span>
            <span className="absolute bottom-2 right-0 text-7xl text-gold-500/12 piece-glyph-spin" style={{ animationDelay: '1s' }}>♜</span>
            <span className="text-6xl piece-glyph-spin text-gold-400">♕</span>
            <h2 className="font-display text-2xl font-bold mt-4 text-ivory-100">
              Welcome back to the <span className="chess-gradient-text">board</span>.
            </h2>
            <p className="text-ivory-300 text-sm mt-3 leading-relaxed">
              Your classes, puzzles and progress are waiting. It's your move, coach.
            </p>
            <div className="mt-8 flex justify-center">
              <AnimatedBoard size={330} fixed />
            </div>
          </div>
        </Reveal>

        {/* Form */}
        <Reveal delay={0.1}>
          <div className="chess-card chess-card-hover rounded-none md:rounded-r-3xl md:rounded-l-none px-8 pb-8 pt-12 h-full">
            <div className="flex flex-col items-center text-center mb-3 mt-10">
              <p className="text-[0.65rem] font-semibold uppercase tracking-[0.22em] text-ivory-500 mb-2">{APP_NAME}</p>
              <span className="inline-block text-4xl text-gold-500 piece-glyph-spin mb-1">♛</span>
              <br />
              <h1 className="font-display text-3xl font-bold text-ivory-100">Login</h1>
              <p className="text-ivory-300 text-sm mt-1">Enter the arena to continue.</p>
              <br />
              <br />
            </div>
            {error && <div className="chess-error">{error}</div>}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-sm font-medium text-ivory-300 block text-left">Username</label>
                <input
                  type="text"
                  required
                  value={form.identifier}
                  onChange={(e) => setForm({ ...form, identifier: e.target.value })}
                  className="chess-input mt-1.5 text-left"
                  placeholder="your username"
                  autoComplete="username"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-ivory-300 block text-left">Password</label>
                <PasswordField
                  required
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  className="chess-input mt-1.5 text-left"
                  placeholder="••••••••"
                  autoComplete="current-password"
                />
              </div>
              <div className="text-right -mt-1">
                <button
                  type="button"
                  onClick={() => setForgotOpen(true)}
                  className="chess-link text-xs"
                >
                  Forgot password?
                </button>
              </div>
              <Button disabled={loading} variant="primary" size="md" fullWidth>
                <Piece p={loading ? '♞' : '♘'} spin={loading} />
                {loading ? 'Opening…' : 'Login'}
              </Button>
            </form>
            <p className="text-sm text-ivory-500 mt-5 text-center">
              Accounts are created by an admin. Sign in with the username and password you were given.
            </p>
            <p className="text-sm text-ivory-500 mt-2 text-center">
              Need an account?{' '}
              <span className="text-ivory-400">Ask your coach to add you.</span>
            </p>
          </div>
        </Reveal>
      </div>
      {/* ── Forgot-password popup: no self-service reset, contact the coach ── */}
      {forgotOpen && (
        <div
          className="fixed inset-0 z-[var(--z-modal-backdrop)] grid place-items-center bg-black/60 p-4"
          onClick={() => setForgotOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Forgot password"
        >
          <div
            className="chess-card max-w-sm w-full p-6 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="inline-block text-4xl text-gold-400 piece-glyph-spin">♜</span>
            <h2 className="font-display text-xl font-bold text-ivory-100 mt-2">
              Forgot your password?
            </h2>
            <p className="text-sm text-ivory-300 mt-2 leading-relaxed">
              Please contact your coach to reset it.
            </p>
            <p className="text-xs text-ivory-500 mt-2 leading-relaxed">
              Your coach will set a new password for you, or give you a
              one-time recovery code. If you already have a recovery code,
              you can still use the reset page.
            </p>
            <div className="flex gap-2 mt-5">
              <Button
                type="button"
                onClick={() => setForgotOpen(false)}
                variant="primary" size="md" fullWidth
              >
                Got it
              </Button>
            </div>
            <button
              type="button"
              onClick={() => { setForgotOpen(false); navigate('/reset-password'); }}
              className="chess-link text-xs mt-3"
            >
              I have a recovery code — reset my password
            </button>
          </div>
        </div>
      )}
    </div>
  );
}