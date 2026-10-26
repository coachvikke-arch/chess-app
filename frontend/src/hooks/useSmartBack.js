import { useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { homeForRole } from '../utils/roles';
import { closeTopOverlay } from './useOverlayHistory';
import { hasInternalPrevious } from '../utils/internalHistory';

/**
 * Back control that never leaves the app.
 *
 * `window.history.length` counts Chrome's entries from before the app was
 * opened, so using it sent users out to the previous external page. Instead we
 * consult the SPA's own history stack (utils/internalHistory):
 *   - if the previous entry was created inside the app, step back to it;
 *   - otherwise replace the current entry with the role dashboard, so the
 *     Dashboard is the boundary and the URL carries no stale detail params.
 */
export function useSmartBack() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  return useCallback(() => {
    if (closeTopOverlay()) return;
    if (hasInternalPrevious()) {
      navigate(-1);
      return;
    }
    let fallback = '/';
    if (user) {
      fallback = location.pathname.startsWith('/student') ? '/student/dashboard'
        : location.pathname.startsWith('/admin') ? '/admin/dashboard'
        : homeForRole(user.role);
    }
    navigate(fallback, { replace: true });
  }, [navigate, location.pathname, user]);
}
