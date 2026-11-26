/**
 * The URL for a stored profile photo, versioned so a replaced upload cannot be
 * answered from the browser cache or a CDN edge.
 *
 * `version` is the row's `updated_at` (or any timestamp for it). It is hashed
 * into the query only when the row carries one, because the stamp has to be
 * STABLE across renders — deriving it from the current clock here would refetch
 * the picture on every re-render of every list that shows it. Uploads already
 * get a unique file name (`avatar-<ts>-<rand>`), so this is the belt to that
 * braces: it also covers the edge that cached the URL before the file was
 * replaced or deleted.
 *
 * Cloudinary photos are already absolute URLs. Legacy `/uploads/...` values are
 * resolved with VITE_UPLOAD_BASE_URL (the Render backend origin); without it the
 * relative URL keeps working through the local Vite proxy.
 */
import resolveUploadUrl from './uploadUrl.js';

export function profileImageSrc(url, version) {
  if (!url) return url;
  const resolved = resolveUploadUrl(url, 'profile_image');
  const stamp = typeof version === 'number' ? version : Date.parse(version ?? '');
  if (!Number.isFinite(stamp) || stamp <= 0) return resolved;
  return `${resolved}${String(resolved).includes('?') ? '&' : '?'}v=${stamp}`;
}

/** Same URL from the user/row object, using its own `updated_at` as the version. */
export function profileImageFromUser(user) {
  return profileImageSrc(user?.profile_image, user?.updated_at);
}
