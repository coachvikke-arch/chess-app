import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import useSharedNavHeight from '../hooks/useNavHeight';
import { useSmartBack } from '../hooks/useSmartBack';

/**
 * Global, history-aware Back control.
 *
 * How it works:
 *  - App.jsx records every SPA navigation in utils/internalHistory. That stack
 *    is what tells this control whether the previous entry is really in-app.
 *  - When pressed with in-app depth, it goes navigate(-1) — returning to the
 *    previous screen INCLUDING the previous search-param state.
 *  - At the “bottom” elsewhere, it falls back per-route: /admin/* →
 *    /admin/dashboard, /student/* → /student/dashboard, anything else → /.
 *  - Hidden on /, /login, the role dashboards, the bot pages (which have
 *    their own back control in their header), and the live classroom.
 *
 * PLACEMENT
 *   It is a ROW of its own, directly under the top bar and above the content,
 *   aligned with the left edge of the column beside it (the sidebar in the
 *   app shells). The row is `sticky`, not `fixed`: it stays under the top bar
 *   while the page scrolls, and — because it is in the flow — it PUSHES the
 *   content below it down instead of overlapping it. The top offset is the
 *   measured height of the top bar, so it works for every surface (the app
 *   shells and the public pages have differently sized bars).
 */
const HIDDEN_PATHS = new Set(['/', '/login', '/student/dashboard', '/admin/dashboard']);

/* The bot pages ship their own back control inside their header — `← Back` on
   the catalogue and `← Bots` on a match — so the row is a duplicate
   that overlaps it. Matched as prefixes because the match route is parameterised
   (`/play/bot/pip`), which a plain exact-match set cannot express.
   The live classroom is hidden for the same reason: the room is full-screen
   chrome with its own leave controls, and the row sits over the board. */
const HIDDEN_PREFIXES = ['/play/bots', '/play/bot/', '/live-class/'];

/* Used until the real bar has been measured (one frame). */
const FALLBACK_NAV_HEIGHT = 68;

function hiddenFor(pathname) {
  return (
    HIDDEN_PATHS.has(pathname) ||
    HIDDEN_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  );
}

/**
 * The height of the top bar, measured from the DOM (hooks/useNavHeight.js).
 *
 * The bar is `sticky top-0`, so the row underneath it has to stick at exactly
 * that height — a hard-coded number would be wrong on the app shells and on the
 * public pages (different padding, different content). A surface with NO top bar
 * (the standalone student report) reports 0, and the row then sticks to the
 * top of the viewport instead of leaving a gap.
 */
const useNavHeight = useSharedNavHeight;

export default function BackButton({ className = '', inShell = false }) {
  const location = useLocation();
  const [visible, setVisible] = useState(() => !hiddenFor(location.pathname));
  const [menuOpen, setMenuOpen] = useState(false);
  const navHeight = useNavHeight();

  useEffect(() => {
    setVisible(!hiddenFor(location.pathname));
  }, [location.pathname]);

  /* Only the notification panel and modals can still overlap the row now
     that it lives under the top bar instead of floating over the page — the
     phone menu (which used to dispatch `chess-mobile-menu`) lives below `md`,
     where this row is still shown, so it keeps its own hiding rules. */
  useEffect(() => {
    const onPanel = (e) => setMenuOpen(!!e.detail?.open);
    window.addEventListener('chess-notif-panel', onPanel);
    window.addEventListener('chess-modal-panel', onPanel);
    return () => {
      window.removeEventListener('chess-notif-panel', onPanel);
      window.removeEventListener('chess-modal-panel', onPanel);
    };
  }, []);

  const smartBack = useSmartBack();
  const goBack = () => { smartBack(); };

  /* On phones the Leaderboard card owns the screen without a Back row above
     it; tablet and desktop keep the row. */
  const hideOnPhone = /(^|\/)leaderboard\/?$/.test(location.pathname);

  if (!visible || menuOpen) return null;

  /* In the shells this row lives INSIDE .admin-content, which already starts
     below the top bar and to the right of the sidebar. Its sticky offset must
     therefore be 0, otherwise it parks a navbar-height below the bar while
     scrolling. Public pages have no shell/content column, so there it still
     has to clear the sticky bar. */
  return (
    <div
      className={`chess-back-row ${hideOnPhone ? 'chess-back-row--phone-hidden' : ''} ${className}`}
      style={{ top: inShell ? 0 : navHeight == null ? FALLBACK_NAV_HEIGHT : navHeight }}
    >
      <button
        type="button"
        onClick={goBack}
        title="Back"
        aria-label="Go back"
        className="chess-back-btn"
      >
        <span aria-hidden="true">←</span>
        <span>Back</span>
      </button>
    </div>
  );
}
