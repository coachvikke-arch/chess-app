import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api, {
  clearHttpCache,
  SESSION_REVOKED_MESSAGE,
  AUTH_MESSAGE_KEY,
} from '../services/api';
import { getDeviceInfo } from '../utils/deviceId';
import { on } from '../services/socket';
import { PIECE_THEMES, CURRENT_PIECE_THEME } from '../config/pieceTheme';

const AuthContext = createContext(null);
const PREF_KEY = 'knightpath-board-pref-set';

/** True only for an id the app still ships (guards against stale/dead ids). */
const isPieceSetId = (id) => Boolean(id && PIECE_THEMES[id]?.id === id);

/** The identity cached by the last successful login. */
function readStoredUser() {
  const stored = localStorage.getItem('user');
  if (!stored) return null;
  try {
    const parsed = JSON.parse(stored);
    return parsed && parsed.name !== undefined ? parsed : (parsed?.user ?? null);
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(readStoredUser);
  const [loading, setLoading] = useState(true);
  /* Client-side redirect for forced logouts. AuthProvider renders inside
     BrowserRouter (see main.jsx), so navigate keeps the SPA alive — the old
     window.location.assign('/login') reloaded index.html and re-ran the whole
     app boot, which showed as a white flash on session revocation. */
  const navigate = useNavigate();

  /* Wipe every trace of the current session from this browser. Shared by the
     explicit logout and the forced (revoked) logout. */
  const clearSession = useCallback(() => {
    clearHttpCache();
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('refresh_token');
    try { localStorage.removeItem(PREF_KEY); } catch { /* ignore */ }
    setUser(null);
  }, []);

  /* Forced logout: another device signed in and this session was bumped. Drop
     the session and land on /login carrying the reason for the Login page. */
  const forceLogout = useCallback((message) => {
    clearSession();
    try { sessionStorage.setItem(AUTH_MESSAGE_KEY, message || SESSION_REVOKED_MESSAGE); } catch { /* ignore */ }
    if (window.location.pathname !== '/login') navigate('/login');
  }, [clearSession, navigate]);

  /* Transport-layer signal: the axios interceptor fires this on a 401 with
     code SESSION_REVOKED. It stays router-agnostic; we do the navigation. */
  useEffect(() => {
    const handler = (e) => forceLogout(e?.detail?.message);
    window.addEventListener('auth:session-revoked', handler);
    return () => window.removeEventListener('auth:session-revoked', handler);
  }, [forceLogout]);

  /* Real-time signal (optional): the server pushes `session_revoked` to the
     bumped device's socket room, so it logs out immediately instead of waiting
     for the next API call to 401. */
  useEffect(() => {
    if (!user) return undefined;
    return on('session_revoked', (payload) => forceLogout(payload?.message));
  }, [user, forceLogout]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      /* A cached `user` with no token means the session is gone (token cleared
         by the transport layer, another tab, or manual clearing). Rendering the
         signed-in UI in that state produced an endless stream of 401s, so drop
         the stale identity and let ProtectedRoute send the user to /login. */
      localStorage.removeItem('user');
      setUser(null);
      setLoading(false);
      return;
    }
    api.get('/auth/me')
      .then((res) => setUser(res.data.user))
      .catch((err) => {
        /* Only a 401 means the session is genuinely gone. This call fails for
           far more mundane reasons — the backend restarting, a dropped
           connection, a proxy hiccup, a 500 — and treating those as a logout
           threw a signed-in user back to the login screen while their token
           was still sitting in localStorage. So a non-401 keeps the cached
           identity and the user simply stays signed in. */
        if (err?.response?.status === 401) {
          localStorage.removeItem('token');
          localStorage.removeItem('user');
          clearHttpCache();
          setUser(null);
          return;
        }
        setUser((prev) => prev ?? readStoredUser());
      })
      .finally(() => setLoading(false));
  }, []);

  /* A saved piece set can reference a theme that no longer ships (the removed
     Emerald set was stored as 'green'). Repair it once and persist the default:
     leaving only a render-time fallback would re-check the dead id on every
     load and would still show the stale value in Settings. Local cache is
     written first so the repair survives even when the API call fails. */
  useEffect(() => {
    const stored = user?.piece_set;
    if (!stored || isPieceSetId(stored)) return undefined;
    if (!localStorage.getItem('token')) return undefined;
    const repairedUser = { ...user, piece_set: CURRENT_PIECE_THEME };
    try { localStorage.setItem('user', JSON.stringify(repairedUser)); } catch { /* ignore */ }
    setUser(repairedUser);
    api.patch('/auth/me', { pieceSet: CURRENT_PIECE_THEME }).catch(() => {});
    return undefined;
  }, [user]);

  // identifier = username (or a legacy email — the API accepts both).
  const login = async (identifier, password) => {
    clearHttpCache();
    // Send our stable device id/name so the server can cap concurrent devices
    // at 2 and recognise a re-login from the same device.
    const res = await api.post('/auth/login', {
      username: identifier,
      password,
      ...getDeviceInfo(),
    });
    localStorage.setItem('token', res.data.token);
    localStorage.setItem('user', JSON.stringify(res.data.user));
    if (res.data.refresh_token) localStorage.setItem('refresh_token', res.data.refresh_token);
    try { localStorage.removeItem(PREF_KEY); } catch { /* ignore */ }
    setUser(res.data.user);
    return res.data.user;
  };

  /* No `signup` here any more. Self-registration is closed: the academy is
     invite-only and an admin creates every account from /super (which calls the
     superadmin-gated POST /auth/register). Keeping a client-side signup would
     have posted to an endpoint that no longer exists. */

  const resetPassword = async (username, recoveryCode, newPassword) => {
    const res = await api.post('/auth/reset-password', { username, recoveryCode, newPassword });
    return res.data;
  };

  const logout = () => {
    /* Revoke the server-side session in the background so this device frees its
       slot immediately — but never block the UI on the network round-trip. */
    try { api.post('/auth/logout').catch(() => {}); } catch { /* ignore */ }
    clearSession();
  };

  /* Sign out of every device at once (revokes all sessions server-side). */
  const logoutAll = () => {
    try { api.post('/auth/logout-all').catch(() => {}); } catch { /* ignore */ }
    clearSession();
  };

  const refreshUser = async () => {
    try {
      const res = await api.get('/auth/me', { cache: false });
      localStorage.setItem('user', JSON.stringify(res.data.user));
      setUser(res.data.user);
      return res.data.user;
    } catch {
      return user;
    }
  };

  const selfCustomized = () => {
    try { return localStorage.getItem(PREF_KEY) === '1'; } catch { return true; }
  };

  /* Board theme resolution:
       1. explicit user choice (persisted)        → user.board_theme
       2. no explicit choice & coach recommended  → user.recommended_board_theme
       3. fallback                                → 'classic-green'             */
  const explicitBoard = user?.board_theme || null;
  const recommendedBoard = user?.recommended_board_theme || null;
  const hasCustomized = selfCustomized();

  const updatePrefs = async ({ boardTheme, pieceSet, boardFrame } = {}) => {
    const payload = {
      ...(boardTheme !== undefined ? { boardTheme } : {}),
      ...(pieceSet !== undefined ? { pieceSet } : {}),
      /* Only send a real boolean. `user.board_frame` is undefined for a user
         object cached in localStorage before this column existed, and sending
         that through would be rejected by the API — so an untouched toggle
         simply omits the key and the server keeps the stored value. */
      ...(typeof boardFrame === 'boolean' ? { boardFrame } : {}),
    };
    /* Apply the choice BEFORE the round-trip so every mounted board (and the
       Settings preview) repaints on the same frame as the tap. Waiting for the
       PATCH made the picker feel dead on a slow connection. The server response
       then replaces the optimistic object; a failure rolls both the cache and
       the choice back to exactly what was stored. */
    const prevUser = user;
    let prevPref = null;
    try { prevPref = localStorage.getItem(PREF_KEY); } catch { /* ignore */ }
    const optimistic = {
      ...(user || {}),
      ...(boardTheme !== undefined ? { board_theme: boardTheme } : {}),
      ...(pieceSet !== undefined ? { piece_set: pieceSet } : {}),
      ...(typeof boardFrame === 'boolean' ? { board_frame: boardFrame } : {}),
    };
    try { localStorage.setItem(PREF_KEY, '1'); } catch { /* ignore */ }
    try { localStorage.setItem('user', JSON.stringify(optimistic)); } catch { /* ignore */ }
    setUser(optimistic);
    try {
      const res = await api.patch('/auth/me', payload);
      localStorage.setItem('user', JSON.stringify(res.data.user));
      setUser(res.data.user);
      return res.data.user;
    } catch (err) {
      try {
        if (prevPref === null) localStorage.removeItem(PREF_KEY);
        else localStorage.setItem(PREF_KEY, prevPref);
        if (prevUser) localStorage.setItem('user', JSON.stringify(prevUser));
        else localStorage.removeItem('user');
      } catch { /* ignore */ }
      setUser(prevUser);
      throw err;
    }
  };

  const boardTheme = hasCustomized
    ? (explicitBoard || 'classic-green')
    : (recommendedBoard || explicitBoard || 'classic-green');
  /* Expose only a set that still exists, so the very first render after boot
     already uses Cburnett for a stale 'green' preference (the effect above then
     repairs the stored value). */
  const storedPieceSet = user?.piece_set || null;
  const pieceSet = storedPieceSet && !isPieceSetId(storedPieceSet)
    ? CURRENT_PIECE_THEME
    : storedPieceSet;
  /* Frame visibility is independent of the board theme. Defaults to ON so a user
     object cached before the column existed keeps the frame they always had. */
  const boardFrame = user?.board_frame !== false;

  /* The account still uses the password the ACADEMY issued (it was set by the
     admin, or generated and mailed with the welcome mail). The student is sent
     to a change-password screen before anything else, and the flag is cleared
     the moment they do. */
  const mustChangePassword = Boolean(user?.must_change_password);

  /* Set your own password. The old one stops working at once, because the
     server stores only the new hash. */
  const changeMyPassword = async (newPassword) => {
    const res = await api.patch('/auth/me/password', { newPassword });
    const updated = { ...(user || {}), must_change_password: false };
    try { localStorage.setItem('user', JSON.stringify(updated)); } catch { /* ignore */ }
    setUser(updated);
    return res.data;
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        boardTheme,
        pieceSet,
        boardFrame,
        mustChangePassword,
        changeMyPassword,
        login,
        resetPassword,
        logout,
        logoutAll,
        refreshUser,
        updatePrefs,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
