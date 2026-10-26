import { Navigate } from 'react-router-dom';
import { usePermissions } from '../context/PermissionContext';
import { useAuth } from '../context/AuthContext';
import { homeForRole } from '../utils/roles';

/**
 * Hides a section completely when the feature is not enabled.
 *
 * Renders `null` — the element is genuinely absent from the DOM, not hidden
 * with CSS, so it cannot be revealed by styling or inspection. This is a
 * convenience layer only; requireFeature() on the server is the real gate.
 */
export function FeatureGate({ feature, children, fallback = null }) {
  const { can, loading } = usePermissions();

  /* An item with no `feature` key is not gated at all — it must render for
     everyone. Without this, every ungated nav entry (Dashboard, Profile, …)
     would be hidden, because can(undefined) is false. */
  if (!feature) return children;

  /* While permissions are unresolved, render nothing rather than guessing —
     this avoids a flash of content the user is not allowed to see. */
  if (loading) return null;
  return can(feature) ? children : fallback;
}

/**
 * Route guard: a signed-in user who navigates straight to a URL for a disabled
 * feature is redirected to their own panel rather than shown a blocked page.
 *
 * Super Admin passes automatically (ungated). Signed-out visitors are sent to
 * /login by ProtectedRoute before this ever runs.
 */
export function FeatureRoute({ feature, children }) {
  const { can, loading } = usePermissions();
  const { user } = useAuth();

  /* Not a gated route — render it. */
  if (!feature) return children;
  if (loading) return null;
  if (can(feature)) return children;

  const home = homeForRole(user?.role);
  /* Guard against a redirect loop: if the user's own home route is the one that
     is gated, navigating there would bounce forever. Show an empty state. */
  if (typeof window !== 'undefined' && window.location.pathname === home) {
    return <NoFeaturesEnabled />;
  }
  return <Navigate to={home} replace />;
}

/** A role with every feature switched off: say so plainly instead of
 *  rendering a broken shell with an empty sidebar. Exported so the app shells
 *  can show it when a user has no features left at all. */
export function NoFeaturesEnabled() {
  return (
    <div className="chess-card text-center py-16 px-6">
      <p className="text-4xl mb-3">♟</p>
      <h2 className="font-display font-bold text-ivory-100 text-lg">No features enabled yet</h2>
      <p className="text-sm text-ivory-500 mt-2 max-w-sm mx-auto">
        A Super Admin has switched off every section for your account. Ask them to switch
        on what you need — nothing is broken on your side.
      </p>
    </div>
  );
}

export default FeatureGate;
