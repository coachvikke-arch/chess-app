/*
 * Stable per-browser-install identity for the "max 2 devices" login cap.
 *
 * The device_id is a UUID generated once and kept in localStorage, so every
 * sign-in from this browser reports the same id and the server can tell one
 * device from another (re-login on the same device must NOT consume a second
 * slot). The device_name/platform are only cosmetic labels shown to the user.
 *
 * All storage access is wrapped: a locked-down/private-mode browser that
 * refuses localStorage must not break sign-in — it just gets an ephemeral id
 * for this page load.
 */

const DEVICE_ID_KEY = 'knightpath-device-id';
const DEVICE_NAME_KEY = 'knightpath-device-name';

function uuid() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch { /* fall through */ }

  // RFC 4122 v4 fallback (older browsers / insecure contexts).
  const bytes = new Uint8Array(16);
  try {
    const c = typeof crypto !== 'undefined' ? crypto : window.crypto;
    c.getRandomValues(bytes);
  } catch {
    for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
  return `${hex[0]}${hex[1]}${hex[2]}${hex[3]}-${hex[4]}${hex[5]}-${hex[6]}${hex[7]}-${hex[8]}${hex[9]}-${hex[10]}${hex[11]}${hex[12]}${hex[13]}${hex[14]}${hex[15]}`;
}

function safeGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function safeSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
}

function detectPlatform() {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  if (/windows/i.test(ua)) return 'windows';
  if (/mac os|macintosh/i.test(ua)) return 'macos';
  if (/linux/i.test(ua)) return 'linux';
  return 'web';
}

function detectDeviceName() {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  const browser =
    /edg\//i.test(ua) ? 'Edge'
      : /opr\//i.test(ua) ? 'Opera'
        : /chrome|crios/i.test(ua) ? 'Chrome'
          : /firefox|fxios/i.test(ua) ? 'Firefox'
            : /safari/i.test(ua) ? 'Safari'
              : 'Browser';
  const os =
    /android/i.test(ua) ? 'Android'
      : /iphone|ipad|ipod/i.test(ua) ? 'iOS'
        : /windows/i.test(ua) ? 'Windows'
          : /mac os|macintosh/i.test(ua) ? 'macOS'
            : /linux/i.test(ua) ? 'Linux'
              : 'Web';
  return `${browser} on ${os}`;
}

/** UUID persisted for this browser; generated on first call. */
export function getDeviceId() {
  let id = safeGet(DEVICE_ID_KEY);
  if (!id) {
    id = uuid();
    safeSet(DEVICE_ID_KEY, id);
  }
  return id;
}

/** Human label for the device, e.g. "Chrome on Windows". */
export function getDeviceName() {
  const cached = safeGet(DEVICE_NAME_KEY);
  if (cached) return cached;
  const name = detectDeviceName();
  safeSet(DEVICE_NAME_KEY, name);
  return name;
}

export function getPlatform() {
  return detectPlatform();
}

/** Convenience bundle for the login request body. */
export function getDeviceInfo() {
  return {
    device_id: getDeviceId(),
    device_name: getDeviceName(),
    platform: getPlatform(),
  };
}
