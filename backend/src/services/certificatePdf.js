const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { spawnSync } = require('child_process');

const {
  layout, templatePath, templateImagePath, registerFonts, requiresUnicodeFont, ascentEmFor, REFERENCE_ASCENT_EM,
} = require('../config/certificateAssets');
const { isCertificateNo } = require('./certificateNumber');
const { APP_NAME } = require('../config/brand');

/**
 * Certificate PDF renderer.
 *
 * The certificate is the supplied MATE ZONE CHESS ACADEMY artwork
 * (frontend/src/assets/certificate-template.png, 1490x1055, A4 landscape) with
 * only the dynamic layer drawn on top: the student's name, the level on the
 * ribbon, the level inside the medallion, the description, and the Level/Date
 * information row.
 *
 * The artwork is embedded whole as the page background, so every border,
 * flourish, ornament, the glass king, the medallion and the ribbon survive
 * untouched. Nothing in this module re-implements any part of the design — it is a
 * placement engine for the values that change.
 *
 * pdfkit draws text directly and has no markup interpretation, so a student name
 * containing `<script>` or `{{ }}` renders as those literal characters and
 * cannot break out of the page.
 *
 * The frontend preview renders the same artwork against the same layout JSON, so
 * what the Super Admin approves on screen is what the file contains.
 */

/* A4 landscape, in PostScript points. */
const PAGE = { width: 841.89, height: 595.28 };

/**
 * One template pixel → points, for TEXT placement.
 *
 * Anchored to the page HEIGHT, so the vertical position of every field is exact.
 * The artwork is A4 landscape to within 0.14%, which is why the horizontal is
 * derived from the same scale and the leftover slack is taken as a symmetric
 * margin (TEXT_ORIGIN_X) rather than by stretching the type.
 */
const SCALE = PAGE.height / layout.template.height;

/** Left edge of that uniformly scaled grid, in points. */
const TEXT_ORIGIN_X = (PAGE.width - layout.template.width * SCALE) / 2;

const LINE_HEIGHT = 1.18;
const MIN_FONT_PT = 6;
const MAX_FIT_PASSES = 16;

/**
 * Geometry for covering the page with the artwork.
 *
 * Deliberately a SEPARATE, marginally larger scale from SCALE: the page is
 * filled edge to edge so no white hairline shows at the paper border. Using one
 * single scale for both image and text cannot do both — at A4 proportions one of
 * the two has to give — and full-bleed artwork matters more than a type position
 * that is out by 0.2mm.
 */
function coverGeometry() {
  const imageScale = Math.max(
    PAGE.width / layout.template.width,
    PAGE.height / layout.template.height
  );
  const w = layout.template.width * imageScale;
  const h = layout.template.height * imageScale;
  return { x: (PAGE.width - w) / 2, y: (PAGE.height - h) / 2, w, h };
}

/** Greedy word wrap against real measured glyph widths. */
function wrapLines(doc, text, width) {
  const lines = [];
  for (const paragraph of String(text).split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push('');
      continue;
    }
    let current = words[0];
    for (let i = 1; i < words.length; i += 1) {
      const candidate = `${current} ${words[i]}`;
      if (doc.widthOfString(candidate) <= width) current = candidate;
      else {
        lines.push(current);
        current = words[i];
      }
    }
    lines.push(current);
  }
  return lines;
}

/**
 * Shrink a field's type until it fits its box.
 *
 * Long student names are the realistic failure mode — an academy roster runs to
 * "Venkatesh Subramanian Chandrasekhar Iyer" — and the name must stay centred
 * over the ornamented underline, so it shrinks rather than wrapping onto a second
 * line or running over the border.
 */
function fitText(doc, field, text, width, startPt) {
  const maxLines = field.maxLines || 1;
  /* `minSize` is in TEMPLATE PIXELS like every other layout measurement, but
     sizes here are in points — converting it is essential. Comparing the raw
     pixel value against a point size stops the shrink far too early, which lets
     a long name wrap onto a second line and collide with the artwork. */
  const floorPt = Math.min((field.minSize || MIN_FONT_PT) * SCALE, startPt);
  let size = startPt;
  for (let pass = 0; pass < MAX_FIT_PASSES; pass += 1) {
    doc.fontSize(size);
    const lines = wrapLines(doc, text, width);
    const widest = lines.reduce((m, l) => Math.max(m, doc.widthOfString(l)), 0);
    if (lines.length <= maxLines && widest <= width + 0.5) return { size, lines };
    if (size <= floorPt) return { size, lines };
    if (widest > width + 0.5) {
      /* One long unbreakable token (a URL, a long compound name): scale straight
         to the measured overflow instead of stepping down blindly. */
      size = Math.max(floorPt, size * (width / widest));
    } else {
      size = Math.max(floorPt, size * 0.92);
    }
  }
  return { size, lines: wrapLines(doc, text, width) };
}

/**
 * Choose the face for one field.
 *
 * The layout's font is used normally, so Latin certificates keep the formal
 * Times look. A field whose text contains characters the WinAnsi base-14 faces
 * cannot encode — a Tamil student name, for instance — switches to the Unicode
 * face instead of printing blank boxes.
 */
function fontFor(field, value, fonts, unicodeFont) {
  const base = fonts[field.font] || layout.fonts[field.font] || 'Helvetica';
  if (unicodeFont && requiresUnicodeFont(value)) return unicodeFont;
  return base;
}

/**
 * Where to actually draw a field, given the size it settled on and the face used.
 *
 * pdfkit puts the baseline one FONT ascent below the top of the text line box, so
 * the same `y` lands in a different visible place in a face with a taller ascent.
 * A field marked `compensateAscent` is corrected for that difference, which is what
 * keeps the student's name between the presentation line above and the ornamented
 * underline below when a fallback face (Latha, for a Tamil name) is used.
 *
 * A field marked `anchor: "inkTop"` is positioned by the top of its visible ink
 * instead — available for faces whose ink ascent is known and stable. It is not
 * used by the script name: French Script MT's ink ascent turns out to depend on the
 * string (0.65 em for "HXgxj" but ~0.88 em for "Manivel M", because the capital
 * flourishes rise nearly to the full line ascent), so baseline anchoring is the
 * stable choice there.
 */
function drawY(field, sizePt, fontName) {
  const y = field.y * SCALE;
  if (field.anchor === 'inkTop') {
    const shift = Math.max(0, ascentEmFor(fontName) - field.inkAscent) * sizePt;
    return y - shift;
  }
  if (field.compensateAscent) {
    const shift = (ascentEmFor(fontName) - REFERENCE_ASCENT_EM) * sizePt;
    return y - shift;
  }
  return y;
}

/** Draw one text field from the layout onto the page. */
function drawTextField(doc, field, rawValue, fonts, unicodeFont) {
  const value = field.uppercase ? String(rawValue || '').toUpperCase() : String(rawValue || '');
  if (!value.trim()) return;

  const x = TEXT_ORIGIN_X + field.x * SCALE;
  const width = field.w * SCALE;
  const fontName = fontFor(field, value, fonts, unicodeFont);

  doc.font(fontName);

  /* A rich field is one line made of differently-weighted runs, which has to be
     measured and shrunk as a whole. */
  if (field.rich && Array.isArray(field.segments)) {
    const { size } = fitText(doc, field, value, width, field.size * SCALE);
    drawRichLine(doc, field, field.segments, x, drawY(field, size, fontName), width, size, fonts, unicodeFont);
    return;
  }

  const { size, lines } = fitText(doc, field, value, width, field.size * SCALE);

  doc.fontSize(size);
  doc.fillColor(field.color || '#1A1A1A');

  doc.text(lines.join('\n'), x, drawY(field, size, fontName), {
    width,
    align: field.align || 'left',
    lineGap: size * (LINE_HEIGHT - 1),
    lineBreak: false,
    /* pdfkit takes character spacing as a per-call text option, not a setter. */
    ...(field.letterSpacing ? { characterSpacing: field.letterSpacing * SCALE } : {}),
  });
}

/**
 * Draw a single line built from weighted segments, optically centred as one unit.
 *
 * Used for the certificate description, where the closing phrase ("Level 3 at
 * MATE ZONE CHESS ACADEMY") is emphasised. The segments are measured with their
 * own faces, the total is centred once, and then each run is drawn at its own
 * offset — so the emphasised words sit inline instead of being pushed off-centre
 * by their own width.
 */
function drawRichLine(doc, field, segments, x, y, width, size, fonts, unicodeFont) {
  const weight = (bold) => (fonts[field.font === 'script' ? 'script' : bold ? 'bodyBold' : 'bodyRegular'] || 'Helvetica');

  const runs = segments
    .filter((s) => s && s.text)
    .map((s) => {
      doc.font(weight(s.bold));
      doc.fontSize(size);
      return {
        text: s.text,
        bold: s.bold,
        width: doc.widthOfString(s.text),
      };
    });
  if (!runs.length) return;

  const spacing = (field.letterSpacing || 0) * SCALE;
  const total = runs.reduce((sum, r) => sum + r.width, 0) + spacing * Math.max(0, runs.length - 1);

  /* Left-aligned fields start at the box edge; centred fields are centred on the
     whole composed line, not on each run. */
  let cursor = (field.align === 'center' ? x + (width - total) / 2 : x);
  if (cursor < x) cursor = x;

  doc.fillColor(field.color || '#1A1A1A');
  for (const run of runs) {
    doc.font(weight(run.bold));
    doc.fontSize(size);
    /* lineBreak:false and a fixed x keep each run on this baseline. */
    doc.text(run.text, cursor, y, {
      width: run.width + 2,
      align: 'left',
      lineBreak: false,
      ...(spacing ? { characterSpacing: spacing } : {}),
    });
    cursor += run.width + spacing;
  }
}

/**
 * Resolve a configured logo into bytes pdfkit can embed.
 *
 * Settings store a URL because the browser needs one to show a preview. A stored
 * /uploads/... path is mapped back onto the local uploads directory; absolute
 * paths and data: URLs are also accepted. Only PNG and JPEG are used — pdfkit
 * cannot embed SVG, and silently skipping an unsupported logo is correct: the
 * certificate must still print without one.
 */
function readLogo(logoUrl) {
  if (!logoUrl) return null;

  let buffer = null;
  const value = String(logoUrl);

  if (value.startsWith('data:image/')) {
    const base64 = value.split(',')[1];
    if (!base64) return null;
    buffer = Buffer.from(base64, 'base64');
  } else {
    const uploadsRoot = path.resolve(__dirname, '..', '..', 'uploads');
    const cleanPath = value.split('?')[0].split('#')[0];
    const candidate = cleanPath.startsWith('/uploads/')
      ? path.join(uploadsRoot, cleanPath.slice('/uploads/'.length))
      : path.isAbsolute(cleanPath)
        ? cleanPath
        : null;
    if (!candidate) return null;

    const resolved = path.resolve(candidate);
    /* Never let a configured path escape the uploads directory. */
    if (resolved !== uploadsRoot && !resolved.startsWith(uploadsRoot + path.sep)) return null;
    if (!fs.existsSync(resolved)) return null;
    buffer = fs.readFileSync(resolved);
  }

  if (!buffer || !buffer.length) return null;
  const isPng = buffer[0] === 0x89 && buffer[1] === 0x50;
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8;
  return isPng || isJpeg ? buffer : null;
}

/** Draw the institute logo, preserving aspect ratio inside its box. */
function drawLogoField(doc, field, logoUrl) {
  const buffer = readLogo(logoUrl);
  if (!buffer) return;
  try {
    doc.image(buffer, field.x * SCALE, field.y * SCALE, {
      fit: [field.w * SCALE, field.h * SCALE],
      align: field.align || 'center',
    });
  } catch (err) {
    console.warn('[certificates] logo could not be embedded:', err.message);
  }
}

/**
 * Render through the ReportLab recreation of the artwork.
 *
 * It needs python + reportlab + the subset fonts under `assets/`, which a
 * Node-only host (Railway) does not provide. Any failure returns null so the
 * caller can fall back to the pdfkit artwork renderer instead of failing the
 * request.
 *
 * @returns {Buffer|null}
 */
function renderReportLabPdf({ content }) {
  const scriptPath = path.join(__dirname, 'generate_certificate.py');
  const assetsDir = path.join(__dirname, '..', 'assets');
  const bgPath = path.join(assetsDir, 'cert', 'bg.png');
  const bgAlt = path.join(assetsDir, 'certificate-template.png');
  const bg = fs.existsSync(bgPath) ? bgPath : bgAlt;
  const tmpOut = path.join(assetsDir, `cert_tmp_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`);
  const name = content.name || 'Student';
  let level = '1';
  if (content.info_level) {
    const m = content.info_level.match(/Level\s*(\d+)/i);
    if (m) level = m[1];
  } else if (content.ribbon_level) {
    const m2 = content.ribbon_level.match(/(\d+)/);
    if (m2) level = m2[1];
  }
  const dateStr = content.info_date
    ? content.info_date.replace(/^Date\s*:\s*/i, '')
    : (content._issued || '9 October 2026');

  const py = spawnSync('python', [scriptPath, assetsDir, bg, tmpOut, name, level, dateStr], { encoding: 'utf8' });
  const ok = py.status === 0 && fs.existsSync(tmpOut);
  if (!ok) {
    const detail = String(py.error ? py.error.message : py.stderr || py.stdout || '').trim();
    console.warn('[certificates] ReportLab renderer unavailable:', detail.split('\n').pop() || 'unknown error');
    try { fs.unlinkSync(tmpOut); } catch (e) {}
    return null;
  }
  const buf = fs.readFileSync(tmpOut);
  try { fs.unlinkSync(tmpOut); } catch (e) {}
  return buf;
}

/**
 * Render a certificate to a PDF buffer.
 *
 * @param {object} args
 * @param {object} args.content  output of buildCertificateContent()
 * @returns {Promise<Buffer>}
 */
function renderCertificatePdf({ content }) {
  return new Promise((resolve, reject) => {
    try {
      const tpl = templatePath();
      if (tpl.toLowerCase().endsWith('.pdf')) {
        const buf = renderReportLabPdf({ content });
        if (buf) {
          resolve(buf);
          return;
        }
        console.warn('[certificates] using the pdfkit artwork renderer for this certificate');
      }
      
      let doc;
      try {
        doc = new PDFDocument({
          size: 'A4',
          layout: 'landscape',
          margin: 0,
          info: {
            Title: [content.title, content.name].filter(Boolean).join(' — ') || 'Certificate',
            Author: content.institute || APP_NAME,
            Subject: content.title || 'Certificate',
          },
          compress: true,
        });
      } catch (err) {
        reject(err);
        return;
      }

      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      try {
        const { fonts, unicodeFont } = registerFonts(doc);

        /* 1. the academy's existing artwork, full page */
        const bgGeom = coverGeometry();
        doc.image(templateImagePath(), bgGeom.x, bgGeom.y, { width: bgGeom.w, height: bgGeom.h });

        /* 2. the variable data, in the measured blank zones */
        for (const field of layout.fields) {
          if (field.role === 'image') {
            drawLogoField(doc, field, content.logo);
            continue;
          }
          /* A rich field carries its weighted runs alongside its plain text, under
             the `<key>_segments` name, so the layout file stays a pure description
             of position and the content stays a pure description of wording. */
          const segments = field.rich ? content[`${field.key}_segments`] : null;
          drawTextField(doc, segments ? { ...field, segments } : field, content[field.key], fonts, unicodeFont);
        }

        doc.end();
      } catch (err) {
        reject(err);
      }
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Render a certificate and write it under uploads/certificates.
 *
 * Returns the path RELATIVE to the statically served uploads root
 * ("/uploads/certificates/CERT-2026-0001.pdf") rather than an absolute URL: it
 * survives a change of domain or port, and the controller turns it into an
 * absolute link per request — which is what the WhatsApp message needs.
 *
 * The name is deterministic, so REGENERATING replaces the file in place and any
 * link already sent to a parent keeps working and shows the corrected version.
 */
async function saveCertificatePdf(cert, { content }) {
  const dir = path.join(__dirname, '..', '..', 'uploads', 'certificates');
  await fs.promises.mkdir(dir, { recursive: true });
  const buf = await renderCertificatePdf({ content });

  /* The filename IS the certificate's identity and becomes a public URL, so it is
     validated against the exact issued shape rather than sanitised. Stripping
     disallowed characters instead would quietly turn a malformed number into a
     valid-looking but WRONG filename ('../../escape' -> 'escape.pdf'), and the
     caller would never learn something was wrong. */
  if (!isCertificateNo(cert.certificate_no)) {
    throw new Error(
      `Cannot generate a PDF: certificate_no is missing or malformed (got ${JSON.stringify(cert.certificate_no)})`
    );
  }
  const file = `${cert.certificate_no}.pdf`;

  await fs.promises.writeFile(path.join(dir, file), buf);
  return `/uploads/certificates/${file}`;
}

module.exports = {
  PAGE,
  SCALE,
  LINE_HEIGHT,
  MIN_FONT_PT,
  coverGeometry,
  wrapLines,
  fitText,
  readLogo,
  renderCertificatePdf,
  saveCertificatePdf,
};
