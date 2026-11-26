/* One upload adapter for every file the academy accepts.
 *
 * Production (Render has an ephemeral disk) stores files in Cloudinary and puts
 * the returned secure URL in the database. Local development without Cloudinary
 * credentials keeps the old disk behaviour in backend/uploads/, so nothing in
 * the app has to be rewritten or lose a feature.
 *
 * Env:
 *   CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET
 *   or CLOUDINARY_URL=cloudinary://<key>:<secret>@<cloud>
 *   CLOUDINARY_FOLDER (optional prefix, default "mate-zone")
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

let configured = null;

function sdk() {
  if (!configured) {
    configured = require('cloudinary').v2;
    const cloudName = String(process.env.CLOUDINARY_CLOUD_NAME || '').trim();
    const apiKey = String(process.env.CLOUDINARY_API_KEY || '').trim();
    const apiSecret = String(process.env.CLOUDINARY_API_SECRET || '').trim();

    /* The SDK reads CLOUDINARY_URL itself when present. With the three explicit
       variables we configure it here instead; secure:true always uses https. */
    if (cloudName && apiKey && apiSecret) {
      configured.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true });
    } else if (process.env.CLOUDINARY_URL) {
      configured.config({ secure: true });
    }
  }
  return configured;
}

function isCloudinaryConfigured() {
  const c = sdk().config();
  return Boolean(c.cloud_name && c.api_key && c.api_secret);
}

function checkUploadSetup() {
  if (isCloudinaryConfigured()) {
    console.log(`[upload] Cloudinary ready (cloud ${sdk().config().cloud_name}, folder ${folderName()})`);
  } else {
    console.warn('[upload] Cloudinary is not configured - files are written to local disk (Render disk is temporary).');
  }
  return isCloudinaryConfigured() ? 'cloudinary' : 'disk';
}

function folderName() {
  return String(process.env.CLOUDINARY_FOLDER || 'mate-zone').trim().replace(/^\/+|\/+$/g, '') || 'mate-zone';
}

function uniqueName(prefix = 'file') {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

function resourceTypeFor(mimetype) {
  return String(mimetype || '').startsWith('image/') ? 'image' : 'raw';
}

function publicIdFor(file, folder, prefix) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  const base = `${folder}/${uniqueName(prefix)}`;
  return ext ? `${base}${ext}` : base;
}

/** Upload a buffer without blocking the event loop with a base64 data URI. */
function uploadBuffer(buffer, options = {}) {
  return new Promise((resolve, reject) => {
    const stream = sdk().uploader.upload_stream(options, (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
    stream.on('error', reject);
    stream.end(buffer);
  });
}

async function uploadFile(file, { folder, prefix = 'file', resourceType = null, options = {}, buffer = file.buffer } = {}) {
  /* Multer's memory storage puts the bytes on the `info` object, not on `file`.
     Callers from makeStorage pass that buffer explicitly; direct callers can
     still rely on file.buffer. */
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('No file bytes received for upload');
  }
  const publicId = publicIdFor(file, folder, prefix);
  const type = resourceType || resourceTypeFor(file.mimetype);
  const result = await uploadBuffer(buffer, {
    public_id: publicId,
    resource_type: type,
    overwrite: true,
    invalidate: true,
    ...options,
  });
  return {
    url: result.secure_url,
    publicId: result.public_id || publicId,
    resourceType: result.resource_type || type,
    bytes: result.bytes || file.size || buffer.length,
  };
}

function isCloudinaryUrl(value) {
  return /^https:\/\/res\.cloudinary\.com\//i.test(String(value || ''));
}

function candidatesFromUrl(url) {
  const clean = String(url || '').split('?')[0];
  const match = clean.match(/\/upload\/(?:v\d+\/)?(.+)$/);
  if (!match) return [];
  const withExt = match[1];
  const withoutExt = withExt.replace(/\.[^./]+$/, '');
  return [...new Set([withExt, withoutExt].filter(Boolean))];
}

function resourceTypeFromUrl(url) {
  const match = String(url || '').match(/\/(image|raw|video)\/upload\//);
  return match ? match[1] : 'image';
}

/**
 * Best-effort delete. Returns true when at least one Cloudinary candidate was
 * deleted or a local file was removed. Never throws: cleanup must not turn a
 * successful upload, message delete or certificate generation into an error.
 */
async function deleteStoredFile(stored, { publicId = null, resourceType = null, localDir = null } = {}) {
  if (!stored && !publicId) return false;

  if (isCloudinaryConfigured() && (publicId || isCloudinaryUrl(stored))) {
    const type = resourceType || (isCloudinaryUrl(stored) ? resourceTypeFromUrl(stored) : 'image');
    const ids = publicId ? [publicId] : candidatesFromUrl(stored);
    for (const id of ids) {
      try {
        const result = await sdk().uploader.destroy(id, { resource_type: type, invalidate: true });
        if (result && result.result === 'deleted') return true;
      } catch (err) {
        console.warn(`[upload] Cloudinary delete failed for ${id}:`, err && err.message);
      }
    }
    return false;
  }

  if (localDir && !/^https?:\/\//i.test(String(stored))) {
    const name = path.basename(String(stored).split('?')[0]);
    if (!name) return false;
    const target = path.join(localDir, name);
    try {
      if (fs.existsSync(target)) { fs.unlinkSync(target); return true; }
    } catch (err) {
      console.warn('[upload] local delete failed:', err && err.message);
    }
  }
  return false;
}

/**
 * Multer storage that uploads to Cloudinary when configured, otherwise writes
 * to the same local folder as before. `file.filename` is ALWAYS the value the
 * rest of the app should store in PostgreSQL: a secure URL on Cloudinary, a
 * plain filename on disk. `file.path` is kept compatible too.
 */
function makeStorage({ destination, folder, prefix = 'file', resourceType = null, options = {} }) {
  const disk = multer.diskStorage({
    destination,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || '') || '.bin';
      cb(null, `${uniqueName(prefix)}${ext}`);
    },
  });
  const memory = multer.memoryStorage();

  return {
    _handleFile(req, file, cb) {
      if (!isCloudinaryConfigured()) return disk._handleFile(req, file, cb);
      memory._handleFile(req, file, async (err, info) => {
        if (err) return cb(err);
        try {
          const uploaded = await uploadFile(file, { folder, prefix, resourceType, options, buffer: info.buffer });
          cb(null, {
            ...info,
            filename: uploaded.url,
            path: uploaded.url,
            cloudinaryPublicId: uploaded.publicId,
            cloudinaryResourceType: uploaded.resourceType,
            cloudinarySecureUrl: uploaded.url,
          });
        } catch (uploadErr) {
          cb(uploadErr);
        }
      });
    },
    _removeFile(req, file, cb) {
      deleteStoredFile(file.cloudinarySecureUrl || file.filename, {
        publicId: file.cloudinaryPublicId,
        resourceType: file.cloudinaryResourceType,
        localDir: destination,
      }).then(() => cb()).catch((err) => cb(err));
    },
  };
}

/** Fetch a small remote image (a Cloudinary logo, for example) for PDF embedding. */
async function fetchImageBuffer(url, { maxBytes = 5 * 1024 * 1024, timeoutMs = 10000 } = {}) {
  if (!/^https?:\/\//i.test(String(url || ''))) return null;
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) return null;
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared && declared > maxBytes) return null;
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > maxBytes) return null;
  const isPng = buffer[0] === 0x89 && buffer[1] === 0x50;
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8;
  return isPng || isJpeg ? buffer : null;
}

module.exports = {
  isCloudinaryConfigured,
  checkUploadSetup,
  uploadBuffer,
  uploadFile,
  deleteStoredFile,
  isCloudinaryUrl,
  makeStorage,
  fetchImageBuffer,
  folderName,
};
