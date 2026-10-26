/* ──────────────────────────────────────────────────────────────────────────
 * A student's own Certificates section.
 *
 * Two things are being protected here.
 *
 * 1. Reachability: the section exists in the student sidebar, the route is
 *    registered for role="student", and the page reads /certificates/me.
 * 2. Exposure: /me must be mounted BEFORE the superadmin gate in
 *    certificateRoutes.js, and must resolve the student from req.user.id — not
 *    from an id in the URL. If either slips, the section either 403s for every
 *    real student or lets one student read another's certificates.
 *
 * The "Show in page" requirement is checked on both surfaces: the student page
 * and the admin per-student page, since both render the same inline component.
 *
 * Run: node --test scripts/certificates-self-service.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const SHELL = read('src/components/StudentAppShell.jsx');
const APP = read('src/App.jsx');
const API = read('src/services/certificatesApi.js');
const PAGE = read('src/pages/MyCertificates.jsx');
const INLINE = read('src/components/CertificateInline.jsx');
const ADMIN = read('src/pages/StudentCertificates.jsx');
const ROUTES = readFileSync(
  new URL('../../backend/src/routes/certificateRoutes.js', import.meta.url), 'utf8',
);
const CONTROLLER = readFileSync(
  new URL('../../backend/src/controllers/certificateController.js', import.meta.url), 'utf8',
);

/* ── the section is reachable ────────────────────────────────────────────── */

test('the student sidebar has a Certificates link', () => {
  assert.match(SHELL, /to: '\/student\/certificates'[^}]*label: 'Certificates'/,
    'the student menu lost its Certificates entry');
});

test('the /student/certificates route is registered for students', () => {
  assert.match(
    APP,
    /path="\/student\/certificates"[^\n]*ProtectedRoute role="student"[^\n]*MyCertificates/,
    'the route must be student-only and render MyCertificates',
  );
  assert.match(APP, /import MyCertificates from '\.\/pages\/MyCertificates'/);
});

test('the page reads the self-service endpoint, not an admin one', () => {
  assert.match(API, /export async function listMyCertificates\(\)/,
    'listMyCertificates must take no id: the session decides whose records these are');
  assert.match(API, /api\.get\('\/certificates\/me'\)/);
  assert.match(PAGE, /listMyCertificates/);
  assert.ok(!PAGE.includes('listStudentCertificates'),
    'the student page must not call the per-student admin endpoint');
});

/* ── the backend exposes /me without opening the admin routes ────────────── */

test('/me and /template are mounted before the superadmin gate', () => {
  const gate = ROUTES.indexOf("roleMiddleware('superadmin')");
  assert.ok(gate > 0, 'the superadmin gate is missing');
  assert.ok(ROUTES.indexOf("router.get('/me'") > 0, '/me route is missing');
  assert.ok(ROUTES.indexOf("router.get('/me'") < gate,
    '/me must be declared before router.use(roleMiddleware()) or students get a 403');
  assert.ok(ROUTES.indexOf("router.get('/template'") < gate,
    '/template must be reachable by the student preview');
});

test('admin routes stay behind the gate', () => {
  const gate = ROUTES.indexOf("roleMiddleware('superadmin')");
  for (const path of ["'/students'", "'/students/:studentId'", "'/issue'", "'/settings'"]) {
    const at = ROUTES.indexOf(`router.get(${path}`);
    const atPost = ROUTES.indexOf(`router.post(${path}`);
    const atPut = ROUTES.indexOf(`router.put(${path}`);
    const hit = [at, atPost, atPut].find((i) => i >= 0);
    assert.ok(hit > gate, `${path} must stay behind the superadmin gate`);
  }
});

test('/me resolves the student from the session, never from the URL', () => {
  const start = CONTROLLER.indexOf('exports.listMine');
  assert.ok(start > 0, 'listMine is missing');
  /* Slice only this handler: the rest of the controller legitimately reads
     req.params.id for the admin routes. */
  const next = CONTROLLER.indexOf('\nexports.', start + 1);
  const body = CONTROLLER.slice(start, next > 0 ? next : undefined);
  assert.match(body, /req\.user\.id/, 'listMine must scope by the signed-in user');
  assert.match(body, /FROM students WHERE user_id = \$1/);
  assert.doesNotMatch(body, /req\.params/, 'listMine must not accept an id from the request');
});

/* ── preview, download and "Show in page" ────────────────────────────────── */

test('the inline view renders the same preview as the modal and offers the PDF', () => {
  assert.match(INLINE, /getTemplate/);
  assert.match(INLINE, /CertificatePreview/);
  assert.match(INLINE, /Open PDF/);
  assert.match(INLINE, /Download/);
});

test('both pages have a Show in page toggle', () => {
  for (const [name, src] of [['student', PAGE], ['admin', ADMIN]]) {
    assert.match(src, /Show in page/, `${name} page has no Show in page control`);
    assert.match(src, /CertificateInline/, `${name} page does not render the inline certificate`);
    assert.match(src, /inlineId/, `${name} page does not track which certificate is open`);
  }
});

test('the student page offers only Download and Show in page', () => {
  assert.match(PAGE, /<a[^>]*download>/, 'the student page must still download the PDF');
  assert.ok(PAGE.includes('Show in page'), 'the student page lost its Show in page control');
  for (const removed of ['Preview', 'Open PDF', 'Send on WhatsApp']) {
    assert.doesNotMatch(PAGE, new RegExp(`>\\s*${removed}\\s*<`),
      `"${removed}" must not be offered in the student portal`);
  }
  assert.ok(!PAGE.includes('CertificatePreviewModal'),
    'the preview modal must not be imported by the student page');
  assert.match(PAGE, /showOpenPdf=\{false\}/,
    'the inline view must not expose Open PDF on the student page');
});
