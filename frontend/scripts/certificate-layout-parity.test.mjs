import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

/**
 * The certificate layout must be IDENTICAL on both sides of the Vite package
 * boundary.
 *
 * Vite cannot import a JSON file across the backend/frontend package boundary,
 * so the geometry genuinely has to exist twice: once for the PDF renderer
 * (backend/src/data/certificateLayout.json) and once for the on-screen preview
 * (frontend/src/data/certificateLayout.json).
 *
 * Two copies of the coordinates that place text on a certificate will drift the
 * first time somebody nudges a number in one of them — and the symptom is a
 * preview that no longer matches the generated file, which is precisely the thing
 * the preview exists to prevent. So the duplication is asserted here.
 *
 * Fix a mismatch by editing the canonical backend copy, then copying it across:
 *   node scripts/sync-certificate-layout.mjs
 *
 * Run: node --test scripts/certificate-layout-parity.test.mjs
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const frontendLayout = path.join(here, '..', 'src', 'data', 'certificateLayout.json');
const backendLayout = path.join(
  here, '..', '..', 'backend', 'src', 'data', 'certificateLayout.json'
);

const read = (p) => fs.readFileSync(p, 'utf8');
const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');

test('both layout copies exist', () => {
  assert.ok(fs.existsSync(frontendLayout), `missing ${frontendLayout}`);
  assert.ok(fs.existsSync(backendLayout), `missing ${backendLayout}`);
});

test('the two layout files are byte-identical', () => {
  const a = read(frontendLayout);
  const b = read(backendLayout);
  assert.strictEqual(
    sha(a),
    sha(b),
    'certificateLayout.json has drifted between frontend and backend.\n'
    + `  frontend ${sha(a)}\n  backend  ${sha(b)}\n`
    + 'Run: node scripts/sync-certificate-layout.mjs'
  );
});

test('the layout is valid JSON describing the existing artwork', () => {
  const layout = JSON.parse(read(frontendLayout));
  assert.strictEqual(layout.template.asset, 'certificate-template.png');
  assert.strictEqual(layout.template.page, 'A4');
  assert.strictEqual(layout.template.orientation, 'landscape');
  assert.ok(layout.template.width > 0 && layout.template.height > 0);
  assert.ok(Array.isArray(layout.fields) && layout.fields.length > 0);
});

test('the artwork the layout describes is really in the bundle', () => {
  const layout = JSON.parse(read(frontendLayout));
  const asset = path.join(here, '..', 'src', 'assets', layout.template.asset);
  assert.ok(fs.existsSync(asset), `missing artwork ${asset}`);
  assert.ok(
    fs.existsSync(path.join(here, '..', 'src', 'assets', 'certificate-template-source.png')),
    'the template source must be kept so the preparation step is reproducible'
  );
});

test('every field is inside the artwork bounds', () => {
  const { template, fields } = JSON.parse(read(frontendLayout));
  for (const f of fields) {
    assert.ok(f.x >= 0 && f.y >= 0, `${f.key} starts outside the artwork`);
    assert.ok(f.x + f.w <= template.width, `${f.key} overflows horizontally`);
    assert.ok(f.y + (f.h || f.size * 2) <= template.height, `${f.key} overflows vertically`);
  }
});

test('the layout declares exactly the dynamic layer, once each', () => {
  const { fields } = JSON.parse(read(frontendLayout));
  const keys = fields.map((f) => f.key);

  /* Only these seven things change between certificates; everything else is part
     of the artwork. If one is added here it must also resolve in
     buildCertificateContent, and if one is removed the preview and the PDF both
     stop drawing it. */
  assert.deepStrictEqual(keys.sort(), [
    'badge_level',
    'description_line1',
    'description_line2',
    'info_date',
    'info_level',
    'name',
    'ribbon_level',
  ]);
  assert.strictEqual(new Set(keys).size, keys.length, 'duplicate field keys');

  /* The level appears on the ribbon and in the medallion — and must be drawn
     exactly once in each, never twice or ghosted behind the ribbon. */
  assert.strictEqual(keys.filter((k) => k === 'ribbon_level').length, 1);
  assert.strictEqual(keys.filter((k) => k === 'badge_level').length, 1);
});

test('the fields that need special handling are marked for it', () => {
  const byKey = Object.fromEntries(JSON.parse(read(frontendLayout)).fields.map((f) => [f.key, f]));

  /* The name is set in a script face and must not wrap. */
  assert.strictEqual(byKey.name.font, 'script');
  assert.strictEqual(byKey.name.maxLines, 1);
  assert.strictEqual(byKey.name.align, 'center');

  /* Line 2 of the description carries a bolded phrase, so the renderer composes
     weighted runs instead of drawing one string. */
  assert.strictEqual(byKey.description_line2.rich, true);
  assert.strictEqual(byKey.description_line2.align, 'center');

  /* Nothing declares an image field any more: the logo is not on this template. */
  assert.ok(!fieldsHaveImage(JSON.parse(read(frontendLayout)).fields));
});

function fieldsHaveImage(fields) {
  return fields.some((f) => f.role === 'image');
}