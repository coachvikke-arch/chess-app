/* Resolve stored upload values into browser-loadable URLs.
 *
 * New uploads are Cloudinary secure URLs and are already absolute. Older rows
 * (and a local dev backend) can still hold `/uploads/...` or a bare filename.
 * VITE_UPLOAD_BASE_URL is the backend origin used for those legacy values; it
 * is NOT a Cloudinary URL.
 */
const RAW_BASE = String(import.meta.env?.VITE_UPLOAD_BASE_URL || '').trim().replace(/\/+$/, '');
export const UPLOAD_BASE_URL = RAW_BASE;

const UPLOAD_FIELDS = new Set([
  'profile_image', 'profileImage', 'sender_image', 'admin_profile_image',
  'student_profile_image', 'opponent_profile_image', 'creator_image', 'avatar',
  'attachment', 'lastAttachment', 'image_url', 'fileUrl', 'fileUrlAbsolute',
  'file_name', 'file_url', 'logo',
]);

function resolveOne(value, key) {
  if (typeof value !== 'string' || !value) return value;
  if (/^(https?:|data:|blob:)/i.test(value)) return value;

  /* Documents stored only the generated filename; profile/chat/certificate
     rows stored the full /uploads/... path. */
  if (key === 'file_name') {
    return UPLOAD_BASE_URL ? `${UPLOAD_BASE_URL}/uploads/${value}` : value;
  }
  if (value.startsWith('/uploads/')) {
    return UPLOAD_BASE_URL ? `${UPLOAD_BASE_URL}${value}` : value;
  }
  return value;
}

/**
 * Rewrite known upload fields in an API response in place. Keeping this in one
 * place means the many avatar/attachment components do not each need to know
 * where an image came from.
 */
export function normalizeUploadUrls(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return value;
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((item) => normalizeUploadUrls(item, seen));
    return value;
  }

  for (const [key, current] of Object.entries(value)) {
    if (UPLOAD_FIELDS.has(key)) {
      value[key] = resolveOne(current, key);
    } else if (current && typeof current === 'object') {
      normalizeUploadUrls(current, seen);
    }
  }
  return value;
}

export default resolveOne;
