import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useChat } from '../context/ChatContext';
import { useSidebarOrder } from '../context/SidebarOrderContext';
import { FeatureGate } from './FeatureGate';
import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import { preloadRoute } from '../utils/lazyPages';

/**
 * Reusable sidebar component — shared by Super Admin, Admin/Coach and Student portals.
 *
 * Props:
 *   links        - menu config array (icon, label, path, feature, superOnly, superHidden, etc.)
 *   headerIcon   - sidebar header icon (e.g. '♛', '♔')
 *   headerTitle  - sidebar header title (e.g. 'Coach Suite', 'Student Hub')
 *   headerSubtitle - sidebar header subtitle (e.g. 'Command Center', 'Learning Center')
 *   footerIcon   - sidebar footer icon (e.g. '♔')
 *   footerText   - sidebar footer text (e.g. 'Every master was once a beginner.')
 *   portal       - 'admin' | 'student' | 'superadmin' (controls role-based visibility)
 *   isMobile     - whether mobile drawer mode is active
 *   onClose      - callback when mobile drawer should close
 *
 * Role-based visibility:
 *   - 'superadmin': sees everything except superHidden items
 *   - 'admin': sees everything except superOnly items
 *   - 'student': sees everything except superOnly items (no super admin console)
 *
 * Keeps its own scroll position across route changes.
 * Memoized: with the persistent shell, sidebar re-renders should be limited to
 * real data changes (unread counts, route), not every page render. Hovering or
 * focusing a menu item warms that section's lazy chunk so the click is instant.
 */
function Sidebar({
  links,
  headerIcon,
  headerTitle,
  headerSubtitle,
  footerIcon,
  footerText,
  portal = 'admin',
  isMobile = false,
  onClose,
}) {
  const { user } = useAuth();
  const { unreadTotal, pendingRequests } = useChat();
  const location = useLocation();
  const { orderFor } = useSidebarOrder();
  const isSuper = user?.role === 'superadmin';

  /* The saved order decides the render sequence. */
  const orderedLinks = useMemo(() => orderFor(portal, links), [orderFor, portal, links]);

  /* Role-based visibility filter. */
  const visibleLinks = useMemo(() => orderedLinks.filter((l) => {
    if (isSuper) return !l.superHidden;
    if (portal === 'student') return !l.superOnly;
    return !l.superOnly;
  }), [orderedLinks, isSuper, portal]);

  const navRef = useRef(null);
  const savedScrollTop = useRef(0);

  /* A route change updates the active highlight without moving the menu. */
  useLayoutEffect(() => {
    const menu = navRef.current?.querySelector('.admin-sidebar-menu');
    if (menu) menu.scrollTop = savedScrollTop.current;
  }, [location.pathname]);

  const handleNavigation = () => {
    const menu = navRef.current?.querySelector('.admin-sidebar-menu');
    if (menu) savedScrollTop.current = menu.scrollTop;
    onClose?.();
  };

  const rememberMenuScroll = (event) => {
    savedScrollTop.current = event.currentTarget.scrollTop;
  };

  const sidebarWidth = isMobile ? '280px' : '240px';

  return (
    <aside
      ref={navRef}
      id="admin-sidebar"
      className="admin-sidebar"
      style={{ width: sidebarWidth }}
      role="navigation"
      aria-label={`${headerTitle} navigation`}
      aria-hidden={isMobile ? 'false' : undefined}
    >
      <div className="admin-sidebar-inner flex flex-col h-full">
        {/* Menu (scrollable) */}
        <nav onScroll={rememberMenuScroll} className="admin-sidebar-menu flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 py-4" role="menu">
          {visibleLinks.map((l) => (
            <FeatureGate key={l.to} feature={l.feature}>
              <NavLink
                key={l.to}
                to={l.to}
                replace={l.to === '/admin/dashboard' || l.to === '/student/dashboard' || l.to === '/super'}
                onClick={handleNavigation}
                onMouseEnter={() => preloadRoute(l.to)}
                onFocus={() => preloadRoute(l.to)}
                className={({ isActive }) =>
                  `group relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 ${isActive
                    ? 'bg-blue-50 text-blue-700 font-bold'
                    : 'text-slate-600 hover:text-blue-700 hover:bg-blue-50'
                  }`
                }
                role="menuitem"
                aria-current={location.pathname === l.to ? 'page' : undefined}
              >
                {({ isActive }) => (
                  <>
                    <span
                      className={`text-lg transition-transform duration-200 ${isActive ? 'text-blue-600' : 'group-hover:scale-125 group-hover:-translate-y-0.5 group-hover:text-blue-600'
                        }`}
                    >
                      {l.icon}
                    </span>
                    {l.superLabel && isSuper ? l.superLabel : l.label}
                    {l.badge && unreadTotal > 0 && (
                      <span className="ml-auto shrink-0 min-w-[18px] h-[18px] px-1 grid place-items-center rounded-full bg-red-600 text-white text-[10px] font-bold">
                        {unreadTotal > 99 ? '99+' : unreadTotal}
                      </span>
                    )}
                    {l.requestBadge && pendingRequests > 0 && (
                      <span className="ml-auto shrink-0 min-w-[18px] h-[18px] px-1 grid place-items-center rounded-full bg-red-600 text-white text-[10px] font-bold">
                        {pendingRequests > 99 ? '99+' : pendingRequests}
                      </span>
                    )}
                    {isActive && (
                      <span className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-[3px] rounded-full bg-blue-600" />
                    )}
                  </>
                )}
              </NavLink>
            </FeatureGate>
          ))}
        </nav>

        {/* Footer (pinned) */}
        <div className="admin-sidebar-footer shrink-0 px-3 py-4 border-t border-slate-200">
          <div className="rounded-xl border border-blue-100 bg-blue-50/60 text-center">
            <span className="text-2xl inline-block py-2">{footerIcon}</span>
            <p className="text-[0.7rem] text-slate-600 pb-2 leading-snug">
              {footerText}
            </p>
          </div>
        </div>
      </div>
    </aside>
  );
}

export default memo(Sidebar);
