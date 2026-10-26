import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Piece } from './ui';
import NotificationBell from './NotificationBell';
import { homeForRole, isAdminRole } from '../utils/roles';
import { APP_NAME, APP_NAME_SHORT } from '../config/brand';
import Button from './Button';

/* Site links. These are rendered by the landing-page header only (see
   App.jsx `landingNavLinks`); the in-app Navbar deliberately shows no
   section links, so they appear on the homepage and nowhere else.

   Openings is intentionally NOT listed here — the landing header promotes only
   the four public entry points. The Openings Library is still reachable inside
   the app from the sidebar (Sidebar.jsx) and student shell
   (StudentAppShell.jsx). */
export const navLinks = [
  { to: '/courses', label: 'Courses' },
  { to: '/about', label: 'About Coach' },
  { to: '/contact', label: 'Contact' },
];

export default function Navbar({ hideLinks = false }) {
  const { user } = useAuth();

  const dashLink = homeForRole(user?.role);
  const dashLabel = user?.role === 'superadmin' ? 'Super Admin' : isAdminRole(user?.role) ? 'Coach Panel' : 'Dashboard';

  return (
    <header className="nav-glass sticky top-0">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-2 px-3 sm:px-4 py-3">
        <Link to="/" aria-label={APP_NAME} className="flex items-center gap-2 sm:gap-2.5 group min-w-0">
          <span className="text-2xl piece-glyph-spin text-blue-300" aria-hidden="true">♞</span>
          <span className="font-bold text-sm sm:text-base md:text-lg font-display text-white truncate">
            <span className="sm:hidden">{APP_NAME_SHORT}</span>
            <span className="hidden sm:inline">{APP_NAME}</span>
          </span>
        </Link>

        {/* No section links here on purpose — the Courses / Openings / About /
            Contact links live in the landing-page header, and a signed-in user
            reaches them from the dashboard or the sidebars. This bar keeps just
            the brand, the notification bell and the account chip. */}

        <div className="flex items-center gap-2 sm:gap-3">
          {user && <NotificationBell />}
          {user ? (
            <>
              <Link
                to={dashLink}
                className="hidden sm:flex items-center gap-2 bg-white border border-slate-300 rounded-full pl-1.5 pr-3.5 py-1 hover:border-gold-500 transition"
                title="Your dashboard"
              >
                <span className="w-7 h-7 rounded-full bg-gradient-to-br from-gold-500 to-gold-700 text-white flex items-center justify-center font-bold text-sm">
                  {(user.name || 'P')[0].toUpperCase()}
                </span>
                <span className="text-sm font-medium text-ivory-300">
                  {(user.name || '').split(' ')[0]}
                </span>
              </Link>
            </>
          ) : (
            <>
              <Link
                to="/login"
                className="hidden sm:inline text-sm text-slate-200 hover:text-white font-medium transition"
              >
                Login
              </Link>
              <Button to="/login" variant="primary" size="md" className="!px-4 !py-2 text-sm">
                <Piece p="♘" spin /> Login
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}