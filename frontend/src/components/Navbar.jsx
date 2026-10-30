import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Piece } from './ui';
import NotificationBell from './NotificationBell';
import { homeForRole, isAdminRole } from '../utils/roles';
import { APP_NAME, APP_NAME_SHORT } from '../config/brand';
import Button from './Button';
import Logo from './Logo';

/* Site links. These are rendered by the landing-page header only (see
   App.jsx `landingNavLinks`); the in-app Navbar deliberately shows no
   section links, so they appear on the homepage and nowhere else.

   Only Contact remains on the landing navbar per requirements. */
export const navLinks = [
  { to: '/contact', label: 'Contact' },
];

export default function Navbar({ hideLinks = false }) {
  const { user } = useAuth();

  const dashLink = homeForRole(user?.role);
  /* The logo is the way home. For a signed-in user "home" is their own
     dashboard — sending them to "/" (the marketing page, whose only calls to
     action are Login) read as being logged out. Signed-out visitors keep the
     public landing page. */
  const logoLink = user ? dashLink : '/';
  const dashLabel = user?.role === 'superadmin' ? 'Super Admin' : isAdminRole(user?.role) ? 'Coach Panel' : 'Dashboard';

  return (
    <header className="nav-glass sticky top-0">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-2 px-3 sm:px-4 py-3">
        <Link to={logoLink} aria-label={APP_NAME} className="flex items-center gap-2 sm:gap-2.5 group min-w-0">
          <Logo
            alt="Mate Zone Chess Academy"
            height={44}
            className="shrink-0"
          />
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