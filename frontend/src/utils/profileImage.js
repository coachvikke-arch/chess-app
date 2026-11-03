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
 * A relative `/uploads/...` is deliberately left relative: in production it
 * resolves against the Vercel domain, which rewrites it to the API host, and in
 * dev the Vite proxy sends it to the local backend. Prefixing an absolute origin
 * here is what would pin the app to localhost.
 */
export function profileImageSrc(url, version) {
  if (!url) return url;
  const stamp = typeof version === 'number' ? version : Date.parse(version ?? '');
  if (!Number.isFinite(stamp) || stamp <= 0) return url;
  return `${url}${url.includes('?') ? '&' : '?'}v=${stamp}`;
}

/** Same URL from the user/row object, using its own `updated_at` as the version. */
export function profileImageFromUser(user) {
  return profileImageSrc(user?.profile_image, user?.updated_at);
}
