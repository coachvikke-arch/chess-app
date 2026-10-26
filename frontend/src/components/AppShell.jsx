import { useEffect, useState, useCallback, Suspense } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useChat } from '../context/ChatContext';
import { usePermissions } from '../context/PermissionContext';
import { useSidebarOrder } from '../context/SidebarOrderContext';
import { FeatureGate, NoFeaturesEnabled } from './FeatureGate';
import TopNavbar from './TopNavbar';
import Sidebar from './Sidebar';
import BackButton from './BackButton';
import { RouteFallback } from './ui';
import useNavHeight from '../hooks/useNavHeight';
import { useFullHeight } from '../context/FullHeightContext';
import { HeaderProvider } from '../context/HeaderContext';
import { getPortalConfig } from '../config/sidebarConfigs';

/**
 * Shared AppShell — used by ALL portals (Super Admin, Admin/Coach, Student).
 *
 * Props:
 *   portal   - 'admin' | 'student' | 'superadmin' (decides sidebar config)
 *   children - page content
 *
 * Layout:
 *   - Full-width top navbar (shows brand + page heading on desktop)
 *   - Sidebar below the navbar (left), menu + footer only
 *   - Scrollable main content area (overflow-y: auto)
 *   - Browser window never scrolls (100dvh shell with overflow hidden)
 *   - Mobile: off-canvas drawer with hamburger toggle + overlay
 *
 * PERSISTENCE: this shell is a layout route (see AdminShellOutlet /
 * StudentShellOutlet in App.jsx). It mounts ONCE per portal and stays mounted
 * across navigations — only `children` (the page from <Outlet/>) changes.
 * Lazy page chunks suspend INSIDE the content area (nearer Suspense boundary),
 * so a chunk load never unmounts the shell.
 *
 * The shell renders its own Back row inside the content area so it lines up
 * with the sidebar's left edge.
 */
export default function AppShell({ portal = 'admin', children }) {
  const { user } = useAuth();
  const { features, ungated, loading: permLoading } = usePermissions();
  const noFeatures = !permLoading && !ungated && features.length === 0;
  const { unreadTotal, pendingRequests } = useChat();
  const [mobileOpen, setMobileOpen] = useState(false);
  const isSuper = user?.role === 'superadmin';
  const roleLabel = isSuper ? 'Super Admin' : portal === 'student' ? 'Student' : 'Coach';
  const basePath = portal === 'student' ? '/student' : '/admin';
  const location = useLocation();

  const { orderFor } = useSidebarOrder();

  /* Stable identity so the memoized Sidebar is not woken by shell re-renders. */
  const closeMobile = useCallback(() => setMobileOpen(false), []);

  /* Measure the top bar height for the sidebar's fixed positioning. */
  useNavHeight();

  /* Full height mode for pages like Play Arena, Game Review, Live Classroom. */
  const { isFullHeight } = useFullHeight();

  /* Close the mobile drawer on Escape. */
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') setMobileOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  /* Close mobile drawer on resize up to desktop. */
  useEffect(() => {
    const onResize = () => { if (window.innerWidth >= 1024) setMobileOpen(false); };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  /* Lock body scroll when mobile drawer is open. */
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [mobileOpen]);

  /* Announce mobile menu state for BackButton. */
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('chess-mobile-menu', { detail: { open: mobileOpen } }));
  }, [mobileOpen]);

  const { links, headerIcon, headerTitle, headerSubtitle, footerIcon, footerText } =
    getPortalConfig(portal);

  return (
    <HeaderProvider>
      <div className="admin-shell">
        {/* Full-width top navbar */}
        <TopNavbar
          isSuper={isSuper}
          basePath={basePath}
          roleLabel={roleLabel}
          headerIcon={headerIcon}
          headerTitle={headerTitle}
          headerSubtitle={headerSubtitle}
          onMobileMenuOpen={() => setMobileOpen(true)}
        />

        {/* Mobile overlay */}
        {mobileOpen && (
          <div
            className="admin-mobile-overlay"
            onClick={closeMobile}
            aria-hidden="true"
          />
        )}

        {/* Row: sidebar (left) + main content (right) */}
        <div className="admin-body">
          {/* Sidebar — menu items only */}
          <Sidebar
            links={links}
            footerIcon={footerIcon}
            footerText={footerText}
            portal={portal}
            isMobile={mobileOpen}
            onClose={closeMobile}
          />

          <main className="admin-main" role="main">
            {/* Scrollable content area */}
            <div className={`admin-content ${isFullHeight ? 'admin-content-full' : ''}`}>
              {!isFullHeight && <BackButton className="px-4" inShell />}
              {/* Keyed by pathname: ONLY this inner block remounts per route
                  (the page itself), never the shell. The 150ms fade is applied
                  here — content-area only, so there is no hard white frame
                  and no whole-screen animation. */}
              <div key={location.pathname} className={isFullHeight ? 'h-full' : 'py-6 px-4 sm:px-6 lg:px-8'}>
                <div className="admin-route-fade">
                  <Suspense fallback={<RouteFallback />}>
                    {noFeatures ? <NoFeaturesEnabled /> : children}
                  </Suspense>
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>
    </HeaderProvider>
  );
}