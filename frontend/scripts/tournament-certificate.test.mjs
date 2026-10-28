/* ──────────────────────────────────────────────────────────────────────────
 * The tournament "Certificate of Achievement".
 *
 * What is protected:
 *
 * 1. The wording. The description is one sentence with three bold facts, and
 *    the grammars around it are easy to break silently — "6.5 point", "1
 *    rounds", "2th place". The runs are asserted as exact strings.
 * 2. The artwork contract. The stage is a fixed 1999x1414 with transform scale;
 *    if someone makes it fluid, or bakes the text into an image, preview and
 *    export stop matching.
 * 3. Export parity. The PNG must be rasterised from the on-screen node and the
 *    PDF must be the same PNG on A4 landscape.
 * 4. Issuance. Completing a tournament creates row(s) — top three, with
 *    participation opt-in — and the old dark certificate is no longer reachable.
 *
 * Run: node --test scripts/tournament-certificate.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildTournamentDescription,
  buildTournamentMessage,
  displayName,
  formatPoints,
  formatTournamentDate,
  ordinal,
  plainSegments,
  pointsWord,
  roundsWord,
  TCERT_H,
  TCERT_W,
  tournamentCertificateData,
} from '../src/utils/tournamentCertificate.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const readBackend = (p) => readFileSync(new URL(`../../backend/${p}`, import.meta.url), 'utf8');

const ART = read('src/components/certificate/TournamentCertificate.jsx');
const MODAL = read('src/components/certificate/TournamentCertificateModal.jsx');
const BATCH = read('src/components/certificate/TournamentCertificateBatchModal.jsx');
const CSS = read('src/components/certificate/tournamentCertificate.css');
const EXPORT = read('src/utils/certificateExport.js');

/* ── canvas ──────────────────────────────────────────────────────────────── */

test('the stage is A4 landscape at 150 DPI', () => {
  assert.equal(TCERT_W, 1999);
  assert.equal(TCERT_H, 1414);
  /* 1999:1414 is within 0.05% of 297:210, which is why the PNG fills the page. */
  assert.ok(Math.abs(TCERT_W / TCERT_H - 297 / 210) < 0.001);
});

test('the artwork is a fixed stage shrunk by transform, never a fluid layout', () => {
  assert.match(ART, /style=\{\{ width: TCERT_W, height: TCERT_H, transform: `scale\(\$\{scale\}\)` \}\}/,
    'the certificate must be a fixed 1999x1414 stage with a transform scale');
  assert.ok(!/width:\s*['"](100%|auto|fit-content)/.test(CSS),
    'the stage must not be given a fluid width in CSS');
});

/* ── grammar ─────────────────────────────────────────────────────────────── */

test('ordinals are correct through the teens and around them', () => {
  const cases = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th', 11: '11th', 12: '12th', 13: '13th', 21: '21st', 22: '22nd', 23: '23rd' };
  for (const [n, want] of Object.entries(cases)) {
    assert.equal(ordinal(Number(n)), want, `${n} should be ${want}`);
  }
});

test('points print without a trailing .0, and keep one decimal when earned', () => {
  assert.equal(formatPoints(7), '7');
  assert.equal(formatPoints(7.0), '7');
  assert.equal(formatPoints('7.0'), '7');
  assert.equal(formatPoints(6.5), '6.5');
  assert.equal(formatPoints('6.5'), '6.5');
});

test('the noun agrees with a single point or round', () => {
  assert.equal(pointsWord(1), 'point');
  assert.equal(pointsWord(0.5), 'points');
  assert.equal(pointsWord(6.5), 'points');
  assert.equal(roundsWord(1), 'round');
  assert.equal(roundsWord(7), 'rounds');
});

/* ── the description sentence ────────────────────────────────────────────── */

test('the description reads exactly as specified for 2nd / 6.5 / 7', () => {
  const d = buildTournamentDescription({ position: 2, points: 6.5, rounds: 7, tournamentName: 'Winter Open' });
  assert.equal(plainSegments(d.line1),
    'For outstanding play and securing 2nd place in the Winter Open tournament,');
  assert.equal(plainSegments(d.line2),
    'scoring 6.5 points in 7 rounds, organized by Mate Zone Chess Academy.');
});

test('the three facts are the only bold runs', () => {
  const d = buildTournamentDescription({ position: 1, points: 7, rounds: 7, tournamentName: 'Blitz Cup' });
  const bold = [...d.line1, ...d.line2].filter((r) => r.bold).map((r) => r.text);
  assert.deepEqual(bold, ['1st place', '7 points', '7 rounds']);
});

test('one point and one round stay singular', () => {
  const d = buildTournamentDescription({ position: 3, points: 1, rounds: 1, tournamentName: 'Nursery Cup' });
  assert.equal(plainSegments(d.line2),
    'scoring 1 point in 1 round, organized by Mate Zone Chess Academy.');
});

test('a whole number never prints as 7.0', () => {
  const d = buildTournamentDescription({ position: 1, points: 7.0, rounds: 9, tournamentName: 'Summer Swiss' });
  assert.match(plainSegments(d.line2), /^scoring 7 points in 9 rounds,/);
});

test('a participant certificate drops the placing and keeps the event', () => {
  const d = buildTournamentDescription({ position: null, points: 4, rounds: 7, tournamentName: 'Spring Open' });
  assert.equal(plainSegments(d.line1),
    'For outstanding play and participation in the Spring Open tournament,');
  assert.equal(plainSegments(d.line2),
    'scoring 4 points in 7 rounds, organized by Mate Zone Chess Academy.');
});

test('a legacy row with no points or rounds falls back instead of printing holes', () => {
  const d = buildTournamentDescription({ position: 2, tournamentName: 'Old Cup' });
  assert.equal(plainSegments(d.line2), 'organized by Mate Zone Chess Academy.');
});

/* ── input normalisation ─────────────────────────────────────────────────── */

test('an older "5.5 / 7" score is recovered as points and rounds', () => {
  const d = tournamentCertificateData({ playerName: 'Ravi', tournamentName: 'Cup', position: 2, score: '5.5 / 7' });
  assert.equal(d.points, 5.5);
  assert.equal(d.rounds, 7);
});

test('an arena certificate counts the games actually played', () => {
  /* The tournament page builds this object; arenas have no configured rounds. */
  const detail = read('src/pages/TournamentDetail.jsx');
  assert.match(detail, /tournament\.format === 'arena'[\s\S]{0,80}gamesPlayed\(standing\)/,
    'arena rounds must come from games played, not tournament.rounds');
  const d = tournamentCertificateData({ playerName: 'Asha', tournamentName: 'Arena', position: 1, points: 9, rounds: 11 });
  assert.equal(d.rounds, 11);
});

test('a stored all-lowercase name is repaired; a real spelling is left alone', () => {
  assert.equal(displayName('nagavel krishnamoorthi'), 'Nagavel Krishnamoorthi');
  assert.equal(displayName('McDonald'), 'McDonald');
  assert.equal(displayName('van der Berg'), 'van der Berg');
  assert.equal(displayName('  Ravi   Kumar '), 'Ravi Kumar');
});

test('the date prints as 24 October 2026', () => {
  assert.equal(formatTournamentDate('2026-10-24T10:00:00.000Z'), '24 October 2026');
  assert.equal(formatTournamentDate('not a date'), '');
});

/* ── WhatsApp greeting ───────────────────────────────────────────────────── */

test('the greeting names the place, the tournament and the academy', () => {
  assert.equal(
    buildTournamentMessage({ studentName: 'Ravi', position: 2, tournamentName: 'Winter Open' }),
    'Congratulations Ravi! 🎉 You secured 2nd place in Winter Open at Mate Zone Chess Academy. Your certificate is attached.',
  );
  assert.equal(
    buildTournamentMessage({ studentName: 'Ravi', position: null, tournamentName: 'Winter Open' }),
    'Congratulations Ravi! 🎉 You took part in Winter Open at Mate Zone Chess Academy. Your certificate is attached.',
  );
});

/* ── no score boxes, and nothing baked into a bitmap ─────────────────────── */

test('the certificate has no Rounds / Points / Position boxes', () => {
  for (const word of ['Rounds', 'Points', 'Position']) {
    assert.doesNotMatch(ART, new RegExp(`>\\s*${word}\\s*<`),
      `the ${word} box must be gone: the score belongs in the sentence`);
    assert.doesNotMatch(CSS, new RegExp(`\\.tcert-${word.toLowerCase()}`),
      `leftover ${word} box styles`);
  }
});

test('the name shrinks to a 60% floor and never wraps', () => {
  assert.match(ART, /const NAME_BASE = 168/);
  assert.match(ART, /NAME_BASE \* 0\.6/);
  assert.match(ART, /scrollWidth > NAME_MAX_W/);
  const nameRule = CSS.match(/\.tcert-name\s*\{[^}]*\}/)?.[0] || '';
  assert.match(nameRule, /white-space:\s*nowrap/, 'the name must never wrap off its line');
});

/* ── export: preview equals the file ─────────────────────────────────────── */

test('the PNG is rasterised from the on-screen node at 2x', () => {
  assert.match(EXPORT, /import\('html-to-image'\)/, 'html-to-image must be loaded on demand');
  assert.match(EXPORT, /toPng\(node/);
  assert.match(EXPORT, /pixelRatio: 2/);
  assert.match(EXPORT, /width: TCERT_W/);
  assert.match(EXPORT, /transform: 'none'/, 'the fit-to-modal scale must be neutralised for the capture');
});

test('the PDF is the same PNG on an A4 landscape page', () => {
  assert.match(EXPORT, /import\('jspdf'\)/, 'jsPDF must be loaded on demand');
  assert.match(EXPORT, /orientation: 'landscape'/);
  assert.match(EXPORT, /format: 'a4'/);
  assert.match(EXPORT, /addImage\(dataUrl, 'PNG', 0, 0, 297, 210/);
});

test('fonts are awaited before the first glyph is rasterised', () => {
  assert.match(EXPORT, /document\.fonts\.ready/);
  assert.match(MODAL, /renderCertificatePng\(stageRef\.current\)/);
  assert.match(BATCH, /renderCertificatePng\(stageRef\.current\)/);
});

/* ── send flow ───────────────────────────────────────────────────────────── */

test('WhatsApp saves the image first, then marks the certificate sent', () => {
  const pngAt = MODAL.indexOf('renderCertificatePng');
  const saveAt = MODAL.indexOf('downloadDataUrl(dataUrl');
  const markAt = MODAL.indexOf('markSent(certificate.id)');
  assert.ok(pngAt > 0 && saveAt > pngAt, 'the image must be saved before WhatsApp opens');
  assert.ok(markAt > saveAt, 'sent is recorded only after the file and the chat');
  assert.match(MODAL, /buildWhatsAppUrl\(phone, message\)/);
});

test('an unusable phone number disables sending and says why', () => {
  assert.match(MODAL, /const phoneValid = Boolean\(phone\) && !phoneError/);
  assert.match(MODAL, /disabled=\{!phoneValid \|\| Boolean\(busy\)\}/);
  assert.match(MODAL, /\{!readOnly && !phoneValid && <p className="tcm-note">\{phoneError\}<\/p>\}/);
});

test('the student portal can view and download but never send', () => {
  const page = read('src/pages/MyCertificates.jsx');
  assert.match(page, /TournamentCertificateModal/);
  assert.match(page, /readOnly/);
});

/* ── surfaces ────────────────────────────────────────────────────────────── */

test('the admin certificates page shows a live thumbnail and the three actions', () => {
  const page = read('src/pages/StudentCertificates.jsx');
  assert.match(page, /<TournamentCertificate data=\{tournamentCertificateData\(c\)\} scale=\{0\.14\}/);
  for (const action of ['png', 'pdf', 'send']) {
    assert.match(page, new RegExp(`action: '${action}'`), `the card is missing its ${action} action`);
  }
  assert.match(page, /Download PNG/);
  assert.match(page, /Download PDF/);
  assert.match(page, />\s*Preview\s*</, 'the card needs its own Preview action');
});

test('the tournament page no longer renders the old dark certificate', () => {
  const page = read('src/pages/TournamentDetail.jsx');
  assert.match(page, /TournamentCertificateModal/);
  assert.match(page, /TournamentCertificateBatchModal/);
  assert.ok(!page.includes("components/CertificateModal'"),
    'the legacy modal is gone; every surface shows the white/blue design');
});

/* ── backend issuance ────────────────────────────────────────────────────── */

test('the certificates table stores points and rounds separately', () => {
  const sql = readBackend('migrations/add_certificates.sql');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS points NUMERIC/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS rounds INTEGER/);
  assert.match(sql, /participation_certificates BOOLEAN NOT NULL DEFAULT FALSE/);
});

test('completing a tournament issues the top three, participation only when enabled', () => {
  const svc = readBackend('src/services/certificateService.js');
  assert.match(svc, /const position = s\.rank <= 3 \? s\.rank : null/);
  assert.match(svc, /if \(position === null && !settings\.participation_certificates\)/);
  assert.match(svc, /const points = Math\.round\(\(Number\(s\.score\) \|\| 0\) \* 10\) \/ 10/);
  assert.match(svc, /const rounds = t\.format === 'arena'/);
});

test('the endpoints the UI calls exist', () => {
  const routes = readBackend('src/routes/certificateRoutes.js');
  assert.match(routes, /router\.get\('\/', ctrl\.list\)/);
  assert.match(routes, /router\.get\('\/:id', ctrl\.getOne\)/);
  assert.match(routes, /router\.post\('\/:id\/mark-sent', ctrl\.markSent\)/);
  /* ':id' must come last or it would swallow '/me', '/students' and '/template'. */
  const gate = routes.indexOf("roleMiddleware('superadmin')");
  assert.ok(routes.indexOf("router.get('/:id'") > gate, 'single-certificate reads are admin-only');
});

test('a tournament certificate is not blocked for lacking a server PDF', () => {
  const svc = readBackend('src/services/certificateService.js');
  assert.match(svc, /if \(cert\.type !== 'tournament' && !cert\.file_url\)/,
    'tournament certificates are rendered in the browser, so delivery must not require a stored PDF');
});
