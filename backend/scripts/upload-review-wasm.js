/* Upload the full Stockfish network to Cloudinary as a raw asset.
 *
 *   cd backend
 *   npm ci
 *   npm run upload:review-wasm
 *
 * It reads CLOUDINARY_* from backend/.env (the same values you give Render),
 * uploads in chunks so the ~99 MB file is safe, and prints the secure URL to
 * paste into Cloudflare's VITE_REVIEW_WASM_URL build variable.
 *
 * If the file is missing, run `cd frontend && npm ci` first: the WASM comes from
 * the pinned npm package and is never committed to this repository.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { v2: cloudinary } = require('cloudinary');

const FILE = path.resolve(
  __dirname,
  '..',
  '..',
  'frontend',
  'node_modules',
  'stockfish',
  'bin',
  'stockfish-19-single.wasm',
);

const cloudName = String(process.env.CLOUDINARY_CLOUD_NAME || '').trim();
const apiKey = String(process.env.CLOUDINARY_API_KEY || '').trim();
const apiSecret = String(process.env.CLOUDINARY_API_SECRET || '').trim();

if (!cloudName || !apiKey || !apiSecret) {
  console.error('CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET must be set in backend/.env.');
  process.exit(1);
}
if (!fs.existsSync(FILE)) {
  console.error(`Missing ${FILE}\nRun: cd frontend && npm ci`);
  process.exit(1);
}

cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true });

const folder = String(process.env.CLOUDINARY_FOLDER || 'mate-zone').trim().replace(/^\/+|\/+$/g, '') || 'mate-zone';

cloudinary.uploader.upload_large(
  FILE,
  {
    resource_type: 'raw',
    public_id: `${folder}/engines/stockfish-19-single.wasm`,
    /* Some free Cloudinary environments cap each raw chunk at 10 MiB; 5 MiB
       is the documented minimum and works everywhere. */
    chunk_size: 5 * 1024 * 1024,
    overwrite: true,
    invalidate: true,
  },
  (err, result) => {
    if (err) {
      console.error('Upload failed:', err.message || err);
      process.exit(1);
    }
    console.log('\nUpload successful.');
    console.log(`bytes: ${result.bytes}`);
    console.log(`secure_url: ${result.secure_url}`);
    console.log('\nPaste the secure_url into Cloudflare Pages → Environment variables → VITE_REVIEW_WASM_URL, then rebuild.');
  },
);
