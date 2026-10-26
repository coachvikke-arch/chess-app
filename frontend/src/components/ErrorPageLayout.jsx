import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { homeForRole } from '../utils/roles';
import usePageTitle from '../hooks/usePageTitle';
import { APP_NAME } from '../config/brand';
import Button from './Button';

export function ErrorPageLayout({
  code,
  title,
  message,
  icon,
  iconAriaLabel,
  accentColor = 'gold',
  showAttemptedUrl = false,
  pageTitle = 'Error',
}) {
  usePageTitle(pageTitle);
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const attemptedUrl = location.pathname + location.search;

  const isLoggedIn = Boolean(user);
  const homeLink = homeForRole(user?.role);
  const homeLabel = isLoggedIn
    ? user?.role === 'superadmin'
      ? 'Super Admin Dashboard'
      : user?.role === 'admin'
      ? 'Coach Panel'
      : 'Student Dashboard'
    : 'Login';

  const handleHomeClick = (e) => {
    e.preventDefault();
    if (isLoggedIn) {
      navigate(homeLink);
    } else {
      navigate('/login');
    }
  };

  const handleBackClick = (e) => {
    e.preventDefault();
    if (window.history.length > 1) {
      window.history.back();
    } else if (isLoggedIn) {
      navigate(homeLink);
    } else {
      navigate('/login');
    }
  };

  const accentStyles = {
    gold: 'text-gold-400',
    amber: 'text-amber-700',
    red: 'text-red-600',
  };

  const AccentColor = accentStyles[accentColor] || accentStyles.gold;

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ animation: 'fade-in 0.6s ease both' }}
    >
      <div className="w-full max-w-xl">
        <div className="chess-card p-8 sm:p-10 text-center relative overflow-hidden">
          <div className="absolute inset-0 opacity-5 pointer-events-none" aria-hidden="true">
            <span className="piece-glyph text-9xl block text-center" style={{ transform: 'rotate(18deg)' }}>
              {accentColor === 'gold' ? '♞' : accentColor === 'amber' ? '♚' : '♜'}
            </span>
          </div>

          <div className="relative z-10">
            <div
              className={`piece-glyph inline-block mb-6 ${AccentColor}`}
              aria-hidden="true"
              style={{ fontSize: 'clamp(6rem, 18vw, 10rem)', lineHeight: 1 }}
              role="img"
              aria-label={iconAriaLabel}
            >
              {icon}
            </div>

            <h1 className="font-bold mb-3 text-2xl sm:text-3xl text-ivory-300">
              {title}
            </h1>

            <p className="text-ivory-500 mb-6 text-base sm:text-lg leading-relaxed max-w-lg mx-auto">
              {message}
            </p>

            {showAttemptedUrl && attemptedUrl !== '/' && (
              <p className="text-ivory-700 text-xs font-mono mb-6 px-3 py-2 bg-ink-900/50 rounded-lg break-all">
                {attemptedUrl}
              </p>
            )}

            <div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
              <Button
                onClick={handleHomeClick}
                variant="primary" size="md" fullWidth className="w-full sm:w-auto"
                type="button"
              >
                {homeLabel}
              </Button>
              <Button
                onClick={handleBackClick}
                variant="secondary" size="md" fullWidth className="w-full sm:w-auto"
                type="button"
              >
                Go Back
              </Button>
            </div>
          </div>
        </div>

        <p className="text-center text-ivory-700 text-sm mt-6">
          {APP_NAME}
        </p>
      </div>
    </div>
  );
}

export default ErrorPageLayout;