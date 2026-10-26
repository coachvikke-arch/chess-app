import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Spinner } from './ui';
import { isAdminRole, homeForRole } from '../utils/roles';
import AccessDenied from '../pages/AccessDenied';

export default function ProtectedRoute({ children, role }) {
  const { user, loading, mustChangePassword } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  /* The account still uses the password the academy issued. Nothing else may
     happen until the student has set their own - so every protected route
     sends them to the change-password screen first (which is the one route
     that is allowed while the flag is set). */
  if (mustChangePassword && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace state={{ from: location }} />;
  }
  if (role) {
    /* 'admin' routes are reachable by admins AND super admins; 'superadmin'
       routes are super-admin only. */
    const allowed = role === 'admin' ? isAdminRole(user.role) : user.role === role;
    if (!allowed) {
      /* Wrong role — show the Access Denied page inline, keeping the URL the
         user tried to reach. Do not redirect, to avoid loops and preserve the
         attempted URL for display. */
      return <AccessDenied />;
    }
  }
  return children;
}