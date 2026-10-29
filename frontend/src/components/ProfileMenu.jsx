import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import StudentAvatar from './StudentAvatar';
import { FeatureGate } from './FeatureGate';

/**
 * The account menu in the top bar — Profile · Settings · Logout.
 *
 * WHY THIS IS A SHARED COMPONENT
 * The menu used to exist only in `StudentAppShell`. The admin shell's top-right
 * corner was two bare `<Link to="/admin/profile">` elements — an avatar and a
 * name that each navigated straight to the profile page. So a coach or a Super
 * Admin who clicked their own name had no menu at all: no Settings, and no way
 * to sign out without first loading the profile page and scrolling to the
 * bottom of it. The options were identical for every role and only the prefix
 * differed (`/student/…` vs `/admin/…`), so they now live in one place and
 * both shells render the same menu.
 *
 * `basePath` is the only role-specific input. `/admin/*` routes accept BOTH
 * admin and superadmin (see ProtectedRoute), so a Super Admin gets exactly the
 * same menu as a coach and the links resolve normally.
 *
 * `roleLabel` is only the small caption under the name — "Student", "Coach" or
 * "Super Admin" — which each shell already computed for its own heading.
 */
export default function ProfileMenu({ basePath, roleLabel }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);

  /* The menu is rendered in a PORTAL on <body>, positioned under the trigger.
     WHY: the top bar is a sticky stacking context (`z-index: 30`), so anything
     it renders — including this menu — can never paint above page content that
     also sits at z-index 30. On pages with the sticky back row (Tournaments,
     dashboard, …) that row covered the top two menu items, so clicking
     "Profile" or "Settings" hit the back row instead. A portal escapes the
     header's stacking context, and a fixed position keeps the menu anchored to
     the trigger while the page scrolls. */
  useLayoutEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const btn = buttonRef.current;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      const width = 208; // w-52
      /* Right-align with the trigger, but never let the menu run off-screen. */
      const right = Math.min(
        Math.max(8, window.innerWidth - r.right),
        Math.max(8, window.innerWidth - width - 8),
      );
      setPos({
        top: Math.max(8, r.bottom + 8),
        right,
        maxHeight: Math.max(120, window.innerHeight - r.bottom - 16),
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  /* Close on an outside click or Escape. The trigger and the portalled menu are
     both treated as "inside", otherwise mousedown on the trigger would close
     and the following click would immediately reopen it. */
  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => {
      if (menuRef.current?.contains(e.target)) return;
      if (buttonRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const initial = ((user?.name || 'P')[0] || 'P').toUpperCase();

  const itemClass =
    'flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-gold-500/10 hover:text-gold-700 transition';

  const menu = open && pos ? createPortal(
    <div
      ref={menuRef}
      role="menu"
      style={{
        position: 'fixed',
        top: `${pos.top}px`,
        right: `${pos.right}px`,
        maxHeight: `${pos.maxHeight}px`,
      }}
      className="w-52 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg py-1 z-[var(--z-dropdown)]"
    >
      <Link
        to={`${basePath}/profile`}
        role="menuitem"
        onClick={() => setOpen(false)}
        className={itemClass}
      >
        <span aria-hidden="true">👤</span> Profile
      </Link>
      {/* Settings stays behind the same `profile_settings` feature gate the
          student menu used, so a role whose board/piece preferences are
          switched off is not sent to a page the API would refuse. */}
      <FeatureGate feature="profile_settings">
        <Link
          to={`${basePath}/settings`}
          role="menuitem"
          onClick={() => setOpen(false)}
          className={itemClass}
        >
          <span aria-hidden="true">⚙️</span> Settings
        </Link>
      </FeatureGate>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          setOpen(false);
          logout();
          navigate('/');
        }}
        className={`${itemClass} w-full text-left border-t border-slate-100 mt-1 pt-2`}
      >
        <span aria-hidden="true">🚪</span> Logout
      </button>
    </div>,
    document.body,
  ) : null;

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 sm:gap-2.5 rounded-full pl-1 pr-2 sm:pl-1 sm:pr-3 py-0.5 hover:bg-white/10 transition"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Account menu"
      >
        <span className="shrink-0">
          {user?.avatar_config ? (
            <StudentAvatar config={user.avatar_config} seed={`user_${user.id || ''}`} size={36} className="ring-2 ring-gold-500/50" />
          ) : user?.profile_image ? (
            <img
              src={user.profile_image}
              alt=""
              className="w-9 h-9 rounded-full object-cover object-center ring-2 ring-gold-500/50"
            />
          ) : (
            <span className="w-9 h-9 rounded-full bg-gradient-to-br from-gold-500 to-gold-700 text-white flex items-center justify-center font-bold text-sm">
              {initial}
            </span>
          )}
        </span>
        <div className="hidden sm:block leading-tight text-left">
          <p className="text-sm font-semibold text-white">{user?.name}</p>
          <p className="text-[0.65rem] uppercase tracking-wider text-slate-300">{roleLabel}</p>
        </div>
        <span className="hidden sm:inline text-slate-300 ml-0.5">▾</span>
      </button>

      {menu}
    </div>
  );
}