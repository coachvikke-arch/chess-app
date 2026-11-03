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
import { getBoardTheme } from '../config/boardThemes';

const AuthContext = createContext(null);
const PREF_KEY = 'knightpath-board-pref-set';
const BOARD_COLOR_CACHE_KEY = 'mz-board';
const DEFAULT_BOARD_COLORS = { light: '#EEEED2', dark: '#769656' };

const validBoardColor = (value) => typeof value === 'string' && /^#[0-9A-Fa-f]{6}$/.test(value);
const normalizedBoardColors = (light, dark) => (
  validBoardColor(light) && validBoardColor(dark) && light.toUpperCase() !== dark.toUpperCase()
    ? { light: light.toUpperCase(), dark: dark.toUpperCase() }
    : null
);

function readCachedBoardColor(userId) {
  try {
    const value = JSON.parse(localStorage.getItem(BOARD_COLOR_CACHE_KEY) || 'null');
    if (!value || String(value.userId) !== String(userId)) return null;
    const colors = normalizedBoardColors(value.light, value.dark);
    return colors ? { ...colors, userId, localOnly: value.localOnly === true } : null;
  } catch { return null; }
}

function writeCachedBoardColor(value) {
  try {
    if (!value) localStorage.removeItem(BOARD_COLOR_CACHE_KEY);
    else localStorage.setItem(BOARD_COLOR_CACHE_KEY, JSON.stringify(value));
  } catch { /* device storage is optional */ }
}

function applyRootBoardColors(colors, custom = false) {
  if (typeof document === 'undefined') return;
  document.documentElement.style.setProperty('--board-light', colors?.light || DEFAULT_BOARD_COLORS.light);
  document.documentElement.style.setProperty('--board-dark', colors?.dark || DEFAULT_BOARD_COLORS.dark);
  document.documentElement.dataset.boardColorCustom = custom ? 'true' : 'false';
}

/* Paint the cached palette before React mounts, so the first board frame cannot
   flash the browser's default square colors. */
try {
  const cachedUser = JSON.parse(localStorage.getItem('user') || 'null');
  const custom = normalizedBoardColors(cachedUser?.board_light_color, cachedUser?.board_dark_color);
  const device = readCachedBoardColor(cachedUser?.id);
  const theme = getBoardTheme(cachedUser?.board_theme || cachedUser?.recommended_board_theme);
  applyRootBoardColors(custom || device || { light: theme.lightSq, dark: theme.darkSq }, Boolean(custom || device));
} catch { applyRootBoardColors(DEFAULT_BOARD_COLORS); }

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
  const [deviceBoardColors, setDeviceBoardColors] = useState(() => readCachedBoardColor(readStoredUser()?.id));
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
      .then((res) => {
        const saved = res.data.user;
        const deviceColors = readCachedBoardColor(saved.id);
        if (!normalizedBoardColors(saved.board_light_color, saved.board_dark_color) && deviceColors && !deviceColors.localOnly) {
          writeCachedBoardColor(null);
          setDeviceBoardColors(null);
        }
        setUser(saved);
      })
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
    const loginColors = readCachedBoardColor(res.data.user.id);
    if (!normalizedBoardColors(res.data.user.board_light_color, res.data.user.board_dark_color) && loginColors && !loginColors.localOnly) {
      writeCachedBoardColor(null);
      setDeviceBoardColors(null);
    } else {
      setDeviceBoardColors(loginColors);
    }
    const loginCustomColors = normalizedBoardColors(res.data.user.board_light_color, res.data.user.board_dark_color);
    const loginTheme = getBoardTheme(res.data.user.board_theme || res.data.user.recommended_board_theme);
    applyRootBoardColors(loginCustomColors || loginColors || { light: loginTheme.lightSq, dark: loginTheme.darkSq }, Boolean(loginCustomColors || loginColors));
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

  /* Publish a profile mutation — photo upload/removal, avatar save/removal —
     into the app. Every endpoint touched by those returns the whole user row, so
     this is called with the server's own answer, never a locally patched copy.
     Without it the new picture only appears after a reload or a re-login,
     because nothing else ever writes the cached user. */
  const applyUser = useCallback((nextUser) => {
    if (!nextUser || nextUser.id === undefined) return;
    try { localStorage.setItem('user', JSON.stringify(nextUser)); } catch { /* ignore */ }
    /* Leaderboard, chat, the People list and the student lists paint avatars from
       the server's own snapshots, cached per URL by services/api. A write to
       /auth or /students/me cannot invalidate those, so drop the whole GET cache
       and let every mounted panel refetch — that is what makes the new image show
       up in them without navigating away. */
    clearHttpCache();
    setUser(nextUser);
    window.dispatchEvent(new CustomEvent('profile:changed', { detail: nextUser }));
  }, []);

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

  const updatePrefs = async ({ boardTheme, pieceSet, boardFrame, boardLightColor, boardDarkColor } = {}) => {
    const payload = {
      ...(boardTheme !== undefined ? { boardTheme } : {}),
      ...(pieceSet !== undefined ? { pieceSet } : {}),
      /* Only send a real boolean. `user.board_frame` is undefined for a user
         object cached in localStorage before this column existed, and sending
         that through would be rejected by the API — so an untouched toggle
         simply omits the key and the server keeps the stored value. */
      ...(typeof boardFrame === 'boolean' ? { boardFrame } : {}),
      ...(boardLightColor !== undefined && boardDarkColor !== undefined
        ? { boardLightColor, boardDarkColor }
        : boardTheme !== undefined ? { boardLightColor: null, boardDarkColor: null } : {}),
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
      ...(boardLightColor !== undefined && boardDarkColor !== undefined
        ? { board_light_color: boardLightColor, board_dark_color: boardDarkColor }
        : boardTheme !== undefined ? { board_light_color: null, board_dark_color: null } : {}),
    };
    const previousDeviceColors = deviceBoardColors;
    let nextDeviceColors = deviceBoardColors;
    if (boardTheme !== undefined && boardLightColor === undefined) {
      nextDeviceColors = null;
      writeCachedBoardColor(null);
    } else if (boardLightColor !== undefined && boardDarkColor !== undefined && boardLightColor !== null) {
      nextDeviceColors = { userId: user?.id, light: boardLightColor.toUpperCase(), dark: boardDarkColor.toUpperCase(), localOnly: true };
      writeCachedBoardColor(nextDeviceColors);
    } else if (boardLightColor === null && boardDarkColor === null) {
      nextDeviceColors = null;
      writeCachedBoardColor(null);
    }
    setDeviceBoardColors(nextDeviceColors);
    const localColors = normalizedBoardColors(optimistic.board_light_color, optimistic.board_dark_color) || nextDeviceColors;
    const localTheme = getBoardTheme(boardTheme || optimistic.board_theme || optimistic.recommended_board_theme);
    applyRootBoardColors(localColors || { light: localTheme.lightSq, dark: localTheme.darkSq }, Boolean(localColors));
    try { localStorage.setItem(PREF_KEY, '1'); } catch { /* ignore */ }
    try { localStorage.setItem('user', JSON.stringify(optimistic)); } catch { /* ignore */ }
    setUser(optimistic);
    try {
      const res = await api.patch('/auth/me', payload);
      localStorage.setItem('user', JSON.stringify(res.data.user));
      setUser(res.data.user);
      if (boardLightColor !== undefined) {
        if (boardLightColor === null) {
          writeCachedBoardColor(null);
          setDeviceBoardColors(null);
        } else {
          const savedColors = { userId: user?.id, light: boardLightColor.toUpperCase(), dark: boardDarkColor.toUpperCase(), localOnly: false };
          writeCachedBoardColor(savedColors);
          setDeviceBoardColors(savedColors);
        }
      }
      const savedColors = normalizedBoardColors(res.data.user.board_light_color, res.data.user.board_dark_color);
      const savedTheme = getBoardTheme(res.data.user.board_theme || res.data.user.recommended_board_theme);
      applyRootBoardColors(savedColors || (boardLightColor !== undefined && boardLightColor !== null ? nextDeviceColors : null) || { light: savedTheme.lightSq, dark: savedTheme.darkSq }, Boolean(savedColors || (boardLightColor !== undefined && boardLightColor !== null)));
      return res.data.user;
    } catch (err) {
      if (boardLightColor !== undefined && boardLightColor !== null) {
        const localOnlyColors = { userId: user?.id, light: boardLightColor.toUpperCase(), dark: boardDarkColor.toUpperCase(), localOnly: true };
        writeCachedBoardColor(localOnlyColors);
        setDeviceBoardColors(localOnlyColors);
        applyRootBoardColors(localOnlyColors, true);
        throw err;
      }
      try {
        if (prevPref === null) localStorage.removeItem(PREF_KEY);
        else localStorage.setItem(PREF_KEY, prevPref);
        if (prevUser) localStorage.setItem('user', JSON.stringify(prevUser));
        else localStorage.removeItem('user');
      } catch { /* ignore */ }
      setDeviceBoardColors(previousDeviceColors);
      setUser(prevUser);
      const previousTheme = getBoardTheme(prevUser?.board_theme || prevUser?.recommended_board_theme);
      const previousCustom = normalizedBoardColors(prevUser?.board_light_color, prevUser?.board_dark_color) || previousDeviceColors;
      applyRootBoardColors(previousCustom || { light: previousTheme.lightSq, dark: previousTheme.darkSq }, Boolean(previousCustom));
      throw err;
    }
  };

  const boardTheme = hasCustomized
    ? (explicitBoard || 'classic-green')
    : (recommendedBoard || explicitBoard || 'classic-green');
  const userBoardColors = normalizedBoardColors(user?.board_light_color, user?.board_dark_color);
  const cachedBoardColors = deviceBoardColors && String(deviceBoardColors.userId) === String(user?.id) ? deviceBoardColors : null;
  const boardColors = userBoardColors || cachedBoardColors || (() => {
    const theme = getBoardTheme(boardTheme);
    return { light: theme.lightSq, dark: theme.darkSq };
  })();
  const hasCustomBoardColors = Boolean(userBoardColors || cachedBoardColors);
  useEffect(() => applyRootBoardColors(boardColors, hasCustomBoardColors), [boardColors.light, boardColors.dark, hasCustomBoardColors]);
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
        boardColors,
        hasCustomBoardColors,
        mustChangePassword,
        changeMyPassword,
        login,
        resetPassword,
        logout,
        logoutAll,
        refreshUser,
        applyUser,
        updatePrefs,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
