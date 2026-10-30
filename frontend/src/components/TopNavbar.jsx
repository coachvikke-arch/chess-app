import { memo } from 'react';
import { Link } from 'react-router-dom';
import NotificationBell from './NotificationBell';
import ProfileMenu from './ProfileMenu';
import { APP_NAME, APP_NAME_SHORT } from '../config/brand';
import Logo from './Logo';

/* The browser tab keeps the academy name on every route. Page headings are
   rendered inside the app (TopNavbar shows only the brand), so the tab must
   not be renamed per page. */
export default memo(function TopNavbar({
  isSuper,
  basePath,
  roleLabel,
  onMobileMenuOpen,
}) {
  const homePath = isSuper ? '/super' : (basePath || '/admin') + '/dashboard';

  return (
    <header className="admin-top-navbar nav-glass sticky top-0">
      <div className="max-w-full mx-auto flex items-center justify-between gap-4 px-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          {/* Mobile hamburger. Sized in px, not rem: the app scales
             `html { font-size }` down to 14px on a phone, so a `w-11` box
             measures 38px there and misses the 44px minimum touch target. */}
          <button
            className="lg:hidden shrink-0 w-[44px] h-[44px] grid place-items-center rounded-lg text-[26px] leading-none text-slate-200 hover:text-white hover:bg-white/10 transition"
            onClick={onMobileMenuOpen}
            aria-label="Open menu"
          >
            ☰
          </button>
          {/* Academy name - always visible */}
          <Link
              to={homePath}
              replace
              aria-label={APP_NAME}
              className="flex items-center gap-1.5 shrink-0"
            >
              <span className="text-blue-300" aria-hidden="true">♛</span>
              <Logo
                alt="Mate Zone Chess Academy"
                height={36}
                className="shrink-0"
              />
          </Link>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <NotificationBell />
          <ProfileMenu basePath={basePath} roleLabel={roleLabel} />
        </div>
      </div>
    </header>
  );
});
