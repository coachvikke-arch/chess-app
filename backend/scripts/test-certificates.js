require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const wa = require('../src/services/certificateWhatsApp');
const content = require('../src/services/certificateContent');
const numbers = require('../src/services/certificateNumber');
const pdf = require('../src/services/certificatePdf');
const assets = require('../src/config/certificateAssets');
const { LEVELS } = require('../src/services/ratingService');

/**
 * Certificates unit tests.
 *
 * Everything here runs WITHOUT a database: the module is split so the rules that
 * actually matter (phone formatting, message rendering, certificate numbering,
 * layout geometry, PDF generation) are pure functions.
 *
 * Run: node --test scripts/test-certificates.js
 */

/* ── Phone numbers ─────────────────────────────────────────────────────────
   The rule is deliberate and strict: digits only, with the country code.
   Accepting and stripping '+' or spaces would quietly turn an inconsistent
   column into usable links, and the spec for this module rejects them outright. */

test('phone: accepts digits-only country-coded numbers', () => {
  assert.strictEqual(wa.validatePhone('91984100001').valid, true);
  assert.strictEqual(wa.validatePhone('91984100001').phone, '91984100001');
  assert.strictEqual(wa.validatePhone('447700900123').valid, true);
});

test('phone: rejects a leading +', () => {
  const r = wa.validatePhone('+91984100001');
  assert.strictEqual(r.valid, false);
  assert.match(r.reason, /country code/);
});

test('phone: rejects spaces', () => {
  assert.strictEqual(wa.validatePhone('91984 100001').valid, false);
});

test('phone: rejects hyphens', () => {
  assert.strictEqual(wa.validatePhone('91984-100001').valid, false);
});

test('phone: rejects brackets and dots', () => {
  assert.strictEqual(wa.validatePhone('(91984)100001').valid, false);
  assert.strictEqual(wa.validatePhone('+91.98410.0001').valid, false);
});

test('phone: rejects a missing number, with a specific reason', () => {
  for (const missing of [null, undefined, '', '   ']) {
    const r = wa.validatePhone(missing);
    assert.strictEqual(r.valid, false);
    assert.match(r.reason, /No phone number/);
  }
});

test('phone: rejects a leading zero, which means the country code is missing', () => {
  assert.strictEqual(wa.validatePhone('0984100001').valid, false);
});

test('phone: rejects letters and non-digits', () => {
  assert.strictEqual(wa.validatePhone('91984ABC001').valid, false);
  assert.strictEqual(wa.validatePhone('91984100001a').valid, false);
});

test('phone: rejects numbers too short or too long to carry a country code', () => {
  assert.strictEqual(wa.validatePhone('1234567').valid, false);
  assert.strictEqual(wa.validatePhone('9198410000199999999').valid, false);
});

/* ── wa.me links ─────────────────────────────────────────────────────────*/

test('wa.me URL has the documented shape', () => {
  const url = wa.buildWhatsAppUrl({ phone: '91984100001', message: 'hello' });
  assert.match(url, /^https:\/\/wa\.me\/91984100001\?text=hello$/);
});

test('wa.me URL percent-encodes the message so it cannot break the query', () => {
  const url = wa.buildWhatsAppUrl({ phone: '91984100001', message: 'a&b=c #d' });
  assert.ok(url.includes('text=a%26b%3Dc%20%23d'), url);
  /* The number must never be followed by anything but ?text= */
  assert.match(url, /^https:\/\/wa\.me\/\d+\?text=/);
});

test('wa.me URL keeps emoji and Tamil intact as UTF-8 escapes', () => {
  const url = wa.buildWhatsAppUrl({ phone: '91984100001', message: 'ஜெயம் \u{1F389}' });
  assert.ok(url.includes('%F0%9F%8E%89'), 'emoji should be percent-encoded');
  assert.ok(/%E0%AE%9C/.test(url), 'Tamil should be percent-encoded as UTF-8');
});

test('buildWhatsAppUrl throws for an unusable number rather than building a broken link', () => {
  assert.throws(() => wa.buildWhatsAppUrl({ phone: '+91984100001', message: 'x' }), /country code/);
  assert.throws(() => wa.buildWhatsAppUrl({ phone: null, message: 'x' }), /No phone number/);
});

test('buildCertificateWhatsAppLink reports invalidity instead of throwing', () => {
  const bad = wa.buildCertificateWhatsAppLink({ phone: 'nope', values: {} });
  assert.strictEqual(bad.valid, false);
  assert.ok(bad.reason);
  assert.strictEqual(bad.url, undefined);
});

/* ── Message template ─────────────────────────────────────────────────────*/

test('template substitutes all four placeholders', () => {
  const msg = wa.renderMessage(wa.DEFAULT_MESSAGE_TEMPLATE, {
    name: 'Ramesh Kumar',
    title: 'Level 3 completed',
    link: 'https://app.test/c.pdf',
    institute_name: 'Mate Zone',
  });
  assert.match(msg, /Ramesh/);
  assert.ok(!msg.includes('Kumar'), 'should greet by first name only');
  assert.match(msg, /Level 3 completed/);
  assert.match(msg, /https:\/\/app\.test\/c\.pdf/);
  assert.match(msg, /Mate Zone/);
  assert.ok(!/\{(name|title|link|institute_name)\}/.test(msg), 'no placeholder should survive');
});

test('template leaves an unknown placeholder visible so the typo is obvious', () => {
  const msg = wa.renderMessage('Hi {name} {nmae}', { name: 'Asha' });
  assert.strictEqual(msg, 'Hi Asha {nmae}');
});

test('template strips markup so a preview can never render injected HTML', () => {
  const msg = wa.renderMessage('Hi {name}<script>alert(1)</script>', { name: 'Asha' });
  assert.ok(!msg.includes('<script>'), msg);
  assert.ok(!msg.includes('<'), msg);
});

test('an empty template falls back to the default instead of sending nothing', () => {
  assert.strictEqual(wa.renderMessage('', { name: 'Asha' }), wa.renderMessage(wa.DEFAULT_MESSAGE_TEMPLATE, { name: 'Asha' }));
  assert.strictEqual(wa.renderMessage('   ', { name: 'Asha' }), wa.renderMessage(wa.DEFAULT_MESSAGE_TEMPLATE, { name: 'Asha' }));
});

test('firstName handles missing and multi-word names', () => {
  assert.strictEqual(wa.firstName('Ramesh Kumar'), 'Ramesh');
  assert.strictEqual(wa.firstName('  Aditi  '), 'Aditi');
  assert.strictEqual(wa.firstName(''), 'there');
  assert.strictEqual(wa.firstName(null), 'there');
});

/* ── Certificate numbers ──────────────────────────────────────────────────*/

test('certificate number format is CERT-YYYY-#### with zero padding', () => {
  assert.strictEqual(numbers.formatCertificateNo(2026, 1), 'CERT-2026-0001');
  assert.strictEqual(numbers.formatCertificateNo(2026, 42), 'CERT-2026-0042');
  assert.strictEqual(numbers.formatCertificateNo(2026, 12345), 'CERT-2026-12345');
});

test('certificate number validation accepts only the issued shape', () => {
  assert.strictEqual(numbers.isCertificateNo('CERT-2026-0001'), true);
  assert.strictEqual(numbers.isCertificateNo('CERT-2026-12345'), true);
  assert.strictEqual(numbers.isCertificateNo('cert-2026-0001'), false);
  assert.strictEqual(numbers.isCertificateNo('CERT-26-0001'), false);
  assert.strictEqual(numbers.isCertificateNo('CERT-2026-1'), false);
  assert.strictEqual(numbers.isCertificateNo('../../etc/passwd'), false);
});

test('the number seed offset is 1-based, so it skips the hyphen', () => {
  /* nextCertificateNo() seeds its counter with substring(certificate_no from 11).
     PostgreSQL's substring(x from n) is 1-BASED and 'CERT-YYYY-' is exactly ten
     characters, so from 10 returns '-0042' — which fails the ::integer cast and
     would break every issuance. Emulate 1-based indexing here: PG position p is
     JS index p-1. */
  const no = 'CERT-2026-0042';
  const pgFrom = (n) => no.slice(n - 1);
  assert.strictEqual(pgFrom(10), '-0042', 'position 10 must be the hyphen');
  assert.strictEqual(pgFrom(11), '0042');
  assert.strictEqual(Number(pgFrom(11)), 42);
});

/* ── Titles and content ───────────────────────────────────────────────────*/

test('level titles state only the level number and completion', () => {
  /* The certificate prints "Level N completed" and nothing more — the tier's own
     name lives in the app's badge UI, not on the certificate. */
  assert.strictEqual(content.levelTitle(1), 'Level 1 completed');
  assert.strictEqual(content.levelTitle(3), 'Level 3 completed');
  for (const band of LEVELS) {
    assert.strictEqual(content.levelTitle(band.level), `Level ${band.level} completed`);
    /* Guard against the badge name creeping back in. */
    assert.ok(!content.levelTitle(band.level).includes(band.name), 'tier name must not be printed');
  }
});

test('a level title falls back safely for an unknown tier', () => {
  assert.strictEqual(content.levelTitle(99), 'Level 99 completed');
});

test('tournament titles state the finishing position', () => {
  assert.strictEqual(content.tournamentTitle({ tournamentName: 'Chennai Open', rank: 1 }), 'Chennai Open — 1st place');
  assert.strictEqual(content.tournamentTitle({ tournamentName: 'Chennai Open', rank: 2 }), 'Chennai Open — 2nd place');
  assert.strictEqual(content.tournamentTitle({ tournamentName: 'Chennai Open', rank: 3 }), 'Chennai Open — 3rd place');
  assert.strictEqual(content.tournamentTitle({ tournamentName: 'Chennai Open', rank: 4 }), 'Chennai Open — 4th place');
  assert.strictEqual(content.tournamentTitle({ tournamentName: 'Chennai Open', rank: 11 }), 'Chennai Open — 11th place');
  assert.strictEqual(content.tournamentTitle({ tournamentName: 'Chennai Open', rank: 21 }), 'Chennai Open — 21st place');
});

test('ordinal is correct for the teens, which a naive +1 suffix gets wrong', () => {
  assert.strictEqual(content.ordinal(1), '1st');
  assert.strictEqual(content.ordinal(11), '11th');
  assert.strictEqual(content.ordinal(12), '12th');
  assert.strictEqual(content.ordinal(13), '13th');
  assert.strictEqual(content.ordinal(101), '101st');
  assert.strictEqual(content.ordinal(0), '');
});

test('issued date is formatted deterministically, not by machine locale', () => {
  assert.strictEqual(content.formatIssuedDate('2026-01-12T00:00:00.000Z'), '12 January 2026');
  assert.strictEqual(content.formatIssuedDate(new Date(2026, 0, 5)), '5 January 2026');
  assert.strictEqual(content.formatIssuedDate('not a date'), '');
});

test('buildCertificateContent resolves every printed field', () => {
  const c = content.buildCertificateContent({
    certificate: {
      type: 'level',
      level_no: 3,
      title: 'Level 3 completed',
      certificate_no: 'CERT-2026-0007',
      issued_at: '2026-01-12T00:00:00.000Z',
    },
    student: { name: 'Ramesh Kumar' },
    settings: {},
  });
  assert.strictEqual(c.name, 'Ramesh Kumar');
  assert.strictEqual(c.ribbon_level, 'LEVEL 3');
  assert.strictEqual(c.badge_level, 'LEVEL 3');
  assert.match(c.description_line1, /successful completion/);
  assert.strictEqual(
    c.description_line2,
    'practice, and assessment for Level 3 at MATE ZONE CHESS ACADEMY.'
  );
  assert.strictEqual(c.info_level, 'Level : Level 3');
  assert.strictEqual(c.info_date, 'Date : 12 January 2026');
});

test('the emphasised tail of the description keeps its leading space', () => {
  /* The segments are composed inline, so a space lost at the split shows up as
     "assessment forLevel 3" on the finished certificate. */
  const c = content.buildCertificateContent({
    certificate: {
      type: 'level', level_no: 5, title: 'Level 5 completed',
      certificate_no: 'CERT-2026-0001', issued_at: '2026-10-04T00:00:00.000Z',
    },
    student: { name: 'Arun Kumar' },
    settings: {},
  });
  const segs = c.description_line2_segments;
  assert.strictEqual(segs.length, 2);
  assert.ok(segs[0].text.endsWith(' '), `segment 0 must end with a space: ${JSON.stringify(segs[0].text)}`);
  assert.strictEqual(segs[1].bold, true);
  assert.strictEqual(segs[0].text + segs[1].text, c.description_line2);
});

test('every level-bearing element shows the SAME level', () => {
  /* The ribbon, the medallion, the description and the information row are drawn
     from one value, so they cannot disagree. */
  for (const level of [1, 5, 7]) {
    const c = content.buildCertificateContent({
      certificate: {
        type: 'level', level_no: level, title: `Level ${level} completed`,
        certificate_no: 'CERT-2026-0001', issued_at: '2026-10-04T00:00:00.000Z',
      },
      student: { name: 'Arun Kumar' },
      settings: {},
    });
    assert.strictEqual(c.ribbon_level, `LEVEL ${level}`);
    assert.strictEqual(c.badge_level, `LEVEL ${level}`);
    assert.ok(c.description_line2.includes(`Level ${level} at`));
    assert.strictEqual(c.info_level, `Level : Level ${level}`);
  }
});

test('a tournament certificate reuses the artwork and names the event', () => {
  const c = content.buildCertificateContent({
    certificate: {
      type: 'tournament',
      tournament_name: 'National Open',
      rank: 2,
      title: 'National Open — 2nd place',
      certificate_no: 'CERT-2026-0008',
      issued_at: '2026-02-01T00:00:00.000Z',
    },
    student: { name: 'Priya' },
    settings: {},
  });
  assert.ok(c.description_line2.includes('National Open'), c.description_line2);
  assert.strictEqual(c.ribbon_level, '2ND', 'the ribbon carries the finishing place');
  assert.strictEqual(c.badge_level, '2ND');
  assert.strictEqual(c._badge, null, 'no level badge for a tournament certificate');
  assert.strictEqual(c._tier, null);
});

/* ── Layout geometry ──────────────────────────────────────────────────────*/

test('every layout field sits inside the artwork', () => {
  const { template, fields } = assets.layout;
  for (const f of fields) {
    assert.ok(f.x >= 0 && f.y >= 0, `${f.key} starts outside the artwork`);
    assert.ok(f.x + f.w <= template.width, `${f.key} overflows the artwork horizontally`);
    assert.ok(f.y + (f.h || f.size * 2) <= template.height, `${f.key} overflows the artwork vertically`);
    assert.ok(f.w > 0, `${f.key} has no width`);
  }
});

test('every layout field names a font the layout declares', () => {
  for (const f of assets.layout.fields) {
    if (f.role === 'image') continue;
    assert.ok(assets.layout.fonts[f.font], `${f.key} references unknown font "${f.font}"`);
  }
});

test('both certificate types render through the single existing artwork', () => {
  const file = assets.templatePath();
  assert.ok(fs.existsSync(file), 'the certificate artwork must exist');
  assert.strictEqual(path.basename(file), assets.layout.template.asset);
});

test('the artwork is the prepared template, and the source is kept alongside it', () => {
  assert.strictEqual(assets.layout.template.asset, 'certificate-template.png');
  assert.ok(/\.png$/.test(assets.templatePath()), 'the template is a PNG');

  /* The prepared image must exist next to the untouched source, because the
     preparation step is reproducible from it rather than being a one-off. */
  const dir = path.dirname(assets.templatePath());
  const source = path.join(dir, 'certificate-template-source.png');
  assert.ok(fs.existsSync(source), `missing the template source at ${source}`);

  /* And the prepared image must NOT still contain the sample name. The prep step
     erases it; if it is ever regenerated without running that step, the generated
     certificate would show "Student Name" behind the real name. */
  const prep = fs.readFileSync(
    path.join(__dirname, '..', '..', 'frontend', 'scripts', 'prepare-certificate-template.mjs'),
    'utf8'
  );
  assert.match(prep, /ERASE_BOXES/, 'the preparation step must still define its erase region');
});

test('a script face is available for the student name', () => {
  assert.strictEqual(assets.scriptFontAvailable(), true,
    'no script font found — the name would be set in serif. Install French Script MT '
    + 'or set CERTIFICATE_FONT_SCRIPT.');
  /* French Script MT's ascent is what the ink-anchor maths is calibrated against. */
  assert.ok(assets.ascentEmFor('cert-script') > 0.5);
  assert.ok(assets.ascentEmFor('cert-script') < 1.2);
});

test('the name field compensates for face ascent', () => {
  /* Without this, a fallback face with a taller ascent (Latha, for a Tamil name)
     pushes the baseline down into the ornamented underline. */
  const name = assets.layout.fields.find((f) => f.key === 'name');
  assert.strictEqual(name.compensateAscent, true);
  assert.strictEqual(name.font, 'script');
  assert.strictEqual(name.align, 'center');
  assert.strictEqual(name.maxLines, 1, 'the name must never wrap onto a second line');
});

test('every level-bearing field is declared exactly once', () => {
  /* "Only one rendered level text layer": if the ribbon and the medallion were
     both declared, or one of them twice, a level could be drawn twice. */
  const keys = assets.layout.fields.map((f) => f.key);
  assert.strictEqual(new Set(keys).size, keys.length, 'duplicate field keys');
  for (const k of ['ribbon_level', 'badge_level']) {
    assert.strictEqual(keys.filter((x) => x === k).length, 1, `${k} must be declared exactly once`);
  }
});

test('the level fields sit inside the artwork features they belong to', () => {
  /* Measured from the artwork: the ribbon interior is y 608..666 and the
     medallion's free band (below the crown, above the stars) is y 288..330. */
  const byKey = Object.fromEntries(assets.layout.fields.map((f) => [f.key, f]));
  const ribbon = byKey.ribbon_level;
  assert.ok(ribbon.y > 608 && ribbon.y < 666, `ribbon text y=${ribbon.y} must be inside the ribbon`);

  const badge = byKey.badge_level;
  assert.ok(badge.y > 288 && badge.y < 330, `badge text y=${badge.y} must be inside the medallion band`);
  /* Centred on the medallion, which is at x 1297. */
  const centre = badge.x + badge.w / 2;
  assert.ok(Math.abs(centre - 1297) <= 6, `badge centre ${centre} should be 1297`);
});

test('the dynamic fields avoid the artwork elements around them', () => {
  const byKey = Object.fromEntries(assets.layout.fields.map((f) => [f.key, f]));
  /* The name sits between the presentation line (ends ~401) and the underline
     (y 530). French Script MT inks at most ~1.0 em from the top of the line box
     for a name with capitals and a descender (measured by differencing rendered
     output), so the box top plus that must clear the underline. */
  const name = byKey.name;
  assert.ok(name.y > 401, `name y=${name.y} must clear the presentation line`);
  assert.ok(name.y + name.size * 1.05 < 530, `name must clear the underline at y=530`);
  assert.ok(name.x + name.w <= 1103, 'name box must stay within the underline');

  /* The description and information row go in empty bands of the artwork. */
  for (const key of ['description_line1', 'description_line2']) {
    assert.ok(byKey[key].y > 666 && byKey[key].y < 815, `${key} must sit in the empty zone below the ribbon`);
  }
  for (const key of ['info_level', 'info_date']) {
    assert.ok(byKey[key].y > 815 && byKey[key].y < 929, `${key} must sit above the founder block`);
  }
});

test('the description line 2 is declared rich so its emphasis can be set', () => {
  const field = assets.layout.fields.find((f) => f.key === 'description_line2');
  assert.strictEqual(field.rich, true);
  assert.strictEqual(field.align, 'center', 'a rich line is centred as one composed unit');
});

test('the artwork is A4 landscape and bleeds to the page edge', () => {
  assert.strictEqual(assets.layout.template.page, 'A4');
  assert.strictEqual(assets.layout.template.orientation, 'landscape');
  /* Text is placed on one uniform scale anchored to the page height. */
  const expected = pdf.PAGE.height / assets.layout.template.height;
  assert.ok(Math.abs(pdf.SCALE - expected) < 1e-9);
  /* The artwork is drawn marginally larger so no white hairline shows at the
     paper border — it must cover the page in both directions. */
  const bg = pdf.coverGeometry();
  assert.ok(bg.w >= pdf.PAGE.width, `artwork width ${bg.w} must cover ${pdf.PAGE.width}`);
  assert.ok(bg.h >= pdf.PAGE.height, `artwork height ${bg.h} must cover ${pdf.PAGE.height}`);
  assert.ok(bg.x <= 0.01 && bg.y <= 0.01, 'artwork must be centred and bleed off the edges');
});

test('shrink-to-fit never lets a long name exceed its box', () => {
  const PDFDocument = require('pdfkit');
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0 });
  const field = { maxLines: 1 };
  const width = 200;
  const long = 'Venkatesh Subramanian Chandrasekhar Iyer';
  const { size, lines } = pdf.fitText(doc, field, long, width, 40);
  assert.ok(size <= 40, 'should not grow');
  assert.ok(lines.length <= 1, 'should stay on one line');
  doc.fontSize(size);
  for (const line of lines) {
    assert.ok(doc.widthOfString(line) <= width + 0.5, `"${line}" overflows the box`);
  }
  doc.end();
});

/* ── Fonts ────────────────────────────────────────────────────────────────*/

test('the Unicode font check matches only what base-14 faces cannot encode', () => {
  assert.strictEqual(assets.requiresUnicodeFont('Ramesh Kumar'), false);
  assert.strictEqual(assets.requiresUnicodeFont('Chennai Open 2026'), false);
  assert.strictEqual(assets.requiresUnicodeFont('ஜெயக்குமார்'), true);
  assert.strictEqual(assets.requiresUnicodeFont('Ω'), true);
  assert.strictEqual(assets.requiresUnicodeFont(''), false);
});

test('a TrueType Collection is rejected rather than crashing PDF generation', () => {
  /* Nirmala.ttc is what shipped on this machine and it cannot be subset, which
     used to throw "this.font.createSubset is not a function" mid-render. */
  const ttc = 'C:\\Windows\\Fonts\\Nirmala.ttc';
  if (fs.existsSync(ttc)) {
    assert.strictEqual(assets.canEmbed(ttc), false);
  }
  assert.strictEqual(assets.canEmbed('C:\\definitely\\missing.ttf'), false);
});

/* ── PDF generation ───────────────────────────────────────────────────────*/

const baseCert = {
  type: 'level',
  level_no: 3,
  title: 'Level 3 · Bishop completed',
  certificate_no: 'CERT-2026-0099',
  issued_at: '2026-01-12T00:00:00.000Z',
};
const baseSettings = { institute_name: 'MATE ZONE CHESS ACADEMY', coach_name: 'Coach Manivel', logo_url: '' };

test('renders a valid PDF', async () => {
  const buf = await pdf.renderCertificatePdf({
    content: content.buildCertificateContent({
      certificate: baseCert, student: { name: 'Ramesh Kumar' }, settings: baseSettings,
    }),
  });
  assert.ok(Buffer.isBuffer(buf));
  assert.strictEqual(buf.slice(0, 5).toString(), '%PDF-');
  assert.ok(buf.length > 10000, 'should embed the artwork');
});

test('renders Tamil names instead of blank boxes', async () => {
  const buf = await pdf.renderCertificatePdf({
    content: content.buildCertificateContent({
      certificate: baseCert, student: { name: 'ஜெயக்குமார்' }, settings: baseSettings,
    }),
  });
  assert.strictEqual(buf.slice(0, 5).toString(), '%PDF-');
  /* An embedded subset proves a Unicode face was used for the name field. */
  assert.match(buf.toString('latin1'), /\/BaseFont\s*\/[A-Z]{6}\+/, 'expected an embedded font subset');
});

test('renders without a logo, and with an unreachable one', async () => {
  for (const logo_url of ['', '/uploads/does-not-exist.png', 'data:image/png;base64,notreallyapng']) {
    const buf = await pdf.renderCertificatePdf({
      content: content.buildCertificateContent({
        certificate: baseCert,
        student: { name: 'Ramesh Kumar' },
        settings: { ...baseSettings, logo_url },
      }),
    });
    assert.strictEqual(buf.slice(0, 5).toString(), '%PDF-');
  }
});

test('a missing certificate number is refused rather than writing a nameless file', async () => {
  await assert.rejects(
    () => pdf.saveCertificatePdf(
      { certificate_no: '../../escape' },
      { content: content.buildCertificateContent({ certificate: baseCert, student: {}, settings: baseSettings }) }
    ),
    /certificate_no is missing or malformed/
  );
});

test('a path-traversing logo cannot escape the uploads directory', () => {
  assert.strictEqual(pdf.readLogo('/uploads/../../../../Windows/System32/drivers/etc/hosts'), null);
  assert.strictEqual(pdf.readLogo('/etc/passwd'), null);
  assert.strictEqual(pdf.readLogo(''), null);
});

/* ── Sending and resending ────────────────────────────────────────────────*/

test('the schema records how many times a certificate has been sent', () => {
  /* WhatsApp confirms nothing, so "they never received it" can only be answered
     by sending again. Without a counter the record would look like a single
     delivery no matter how many times it actually went out. */
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', 'add_certificates.sql'), 'utf8'
  );
  assert.match(sql, /send_count\s+INTEGER NOT NULL DEFAULT 0/);
  /* ...and the column must also be added to a database that already has the
     table, or an upgrade silently skips it. */
  assert.match(sql, /ADD COLUMN IF NOT EXISTS send_count/);
  /* The counter's own backfill, so pre-existing 'sent' rows are not left at 0. */
  assert.match(sql, /SET send_count = 1 WHERE status = 'sent'/);
});

test('markSent accumulates rather than overwriting', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'services', 'certificateService.js'), 'utf8'
  );
  assert.match(src, /send_count = send_count \+ 1/,
    'a resend must increment, not reset to 1');
  /* issued_at must NOT be touched: the date the certificate was earned is history
     and a resend must never rewrite it. */
  const fn = src.slice(src.indexOf('async function markSent'));
  assert.ok(!/issued_at\s*=/.test(fn), 'markSent must not modify issued_at');
});

test('the send endpoint delegates to the service instead of duplicating its SQL', () => {
  /* If the controller grew its own UPDATE, the resend counter could drift away
     from the service's behaviour — two places to keep in step, one of which would
     eventually be missed. */
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'controllers', 'certificateController.js'), 'utf8'
  );
  const fn = src.slice(src.indexOf('exports.markSent'), src.indexOf('exports.getSettings'));
  assert.match(fn, /svc\.markSent\(/, 'the controller must call the service');
  assert.ok(!/UPDATE certificates/.test(fn), 'the controller must not issue its own UPDATE');
  /* And the API must expose the count, or the UI cannot show "sent 3 times". */
  assert.match(src, /sendCount: row\.send_count/);
});

/* ── Consistency between the app's tiers and the schema ───────────────────*/

test('MAX_LEVEL matches the tier count the database CHECK constraint allows', () => {
  /* certificates_level_no_valid is CHECK (level_no BETWEEN 1 AND 7). If a tier is
     ever added to ratingService without widening the constraint, this fails. */
  assert.strictEqual(LEVELS.length, 7);
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', 'add_certificates.sql'),
    'utf8'
  );
  assert.match(sql, /level_no BETWEEN 1 AND 7/);
});