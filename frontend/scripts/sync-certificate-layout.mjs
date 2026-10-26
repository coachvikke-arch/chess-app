import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Copy the canonical certificate layout from the backend to the frontend.
 *
 * backend/src/data/certificateLayout.json is canonical; the frontend copy exists
 * only because Vite cannot import across the package boundary. Run this after
 * editing the backend copy, then run the parity test to confirm they match.
 *
 *   node scripts/sync-certificate-layout.mjs
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.join(here, '..', '..', 'backend', 'src', 'data', 'certificateLayout.json');
const target = path.join(here, '..', 'src', 'data', 'certificateLayout.json');

const text = fs.readFileSync(source, 'utf8');

/* Fail loudly rather than copying something the preview cannot render. */
const parsed = JSON.parse(text);
if (!Array.isArray(parsed.fields) || parsed.fields.length === 0) {
  throw new Error(`${source} has no fields — refusing to copy it.`);
}

if (fs.existsSync(target) && fs.readFileSync(target, 'utf8') === text) {
  console.log('Already in sync — nothing to do.');
} else {
  fs.writeFileSync(target, text);
  console.log(`Copied ${path.relative(process.cwd(), source)} -> ${path.relative(process.cwd(), target)}`);
}

console.log('Run: node --test scripts/certificate-layout-parity.test.mjs');