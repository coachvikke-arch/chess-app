const fs = require('fs');
const path = require('path');
const layout = require('../data/certificateLayout.json');

/**
 * Certificate asset + font resolution.
 *
 * The academy has exactly ONE certificate design: the MATE ZONE CHESS ACADEMY
 * template in `frontend/src/assets/certificate-template.png` (1490x1055, A4
 * landscape). It is the supplied artwork with the sample name erased — see
 * frontend/scripts/prepare-certificate-template.mjs.
 *
 * All of the design — branding, headings, border, corner geometry, ribbon,
 * medallion, king, founder block — lives in that image. This module only has to
 * supply the artwork to draw on top of, plus the faces used for the dynamic
 * layer. Nothing here re-implements any part of the design.
 *
 * The artwork lives in the frontend bundle but the PDF is produced on the server,
 * so the backend reads it straight off disk rather than duplicating the binary.
 * CERTIFICATE_TEMPLATE_PATH overrides the location for deployments that keep
 * assets outside the repo (a mounted volume, a CDN-synced folder, ...).
 */

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const DEFAULT_TEMPLATE_PATH = path.join(REPO_ROOT, 'frontend', 'src', 'assets', layout.template.asset);

function resolveTemplatePath() {
  return process.env.CERTIFICATE_TEMPLATE_PATH
    ? path.resolve(process.env.CERTIFICATE_TEMPLATE_PATH)
    : DEFAULT_TEMPLATE_PATH;
}

/** Absolute path to the certificate artwork, or throws with an actionable message. */
function templatePath() {
  const file = resolveTemplatePath();
  if (!fs.existsSync(file)) {
    throw new Error(
      `Certificate template not found at ${file}. ` +
        `Set CERTIFICATE_TEMPLATE_PATH to the ${layout.template.asset} artwork.`
    );
  }
  return file;
}

/*
 * Per-face line ascent, for baseline compensation.
 *
 * pdfkit places a baseline one FONT ascent below the top of the text line box, so
 * the same `y` produces a different visible position in a face with a taller
 * ascent. The student's name sits between two fixed elements — the presentation
 * line above and the ornamented underline below — so a fallback face must not push
 * its baseline down into the underline. Registering each face's real ascent lets
 * the renderer correct for exactly that.
 */
const REFERENCE_ASCENT_EM = 0.834;
let faceAscentEm = {};

/** Line ascent, in em, of a registered certificate face. */
function ascentEmFor(fontName) {
  if (faceAscentEm[fontName] != null) return faceAscentEm[fontName];
  /* The base-14 faces: Times and Helvetica both ascend 0.718 em in pdfkit. */
  if (/^(Times|Helvetica|Courier)/.test(String(fontName))) return 0.718;
  return REFERENCE_ASCENT_EM;
}

/* ── Fonts ────────────────────────────────────────────────────────────────
   Three jobs, three very different requirements:

   1. SCRIPT — the student's name is the focal point and must look hand-written.
      There is no base-14 script face, so a real font file is required.
   2. UNICODE — pdfkit's built-in Times/Helvetica are WinAnsi-only, so a Tamil or
      other non-Latin student name would print as blank boxes. Each field checks
      its own text and switches face only where the base-14 fonts cannot cope, so
      a Latin certificate still gets its classic serif look.
   3. SANS — the description and information row, set in Helvetica.

   Why Latha and not Nirmala for the Unicode job: Nirmala ships as a TrueType
   *Collection* (.ttc), a multi-font container pdfkit cannot subset — registering
   it throws "this.font.createSubset is not a function" and takes the whole
   certificate down. Latha is a plain .ttf with full Tamil and Latin coverage.
   Candidates are probed before use, so an unusable font is skipped rather than
   being fatal.
*/

/* The template sets the student's name in a formal calligraphic script. French
   Script MT is the closest face shipped with Windows; the rest are fallbacks in
   decreasing order of formality. */
const SCRIPT_FONT_CANDIDATES = [
  'C:\\Windows\\Fonts\\FRSCRIPT.TTF',  // French Script MT
  '/usr/share/fonts/truetype/msttcorefonts/French_Script_MT.ttf',
  'C:\\Windows\\Fonts\\VIVALDII.TTF',  // Vivaldi
  'C:\\Windows\\Fonts\\SCRIPTBL.TTF',  // Script MT Bold
  'C:\\Windows\\Fonts\\PRISTINA.TTF',  // Pristina
];

const UNICODE_FONT_CANDIDATES = {
  regular: [
    'C:\\Windows\\Fonts\\latha.ttf',
    '/usr/share/fonts/truetype/tlwg/Latha.ttf',
    'C:\\Windows\\Fonts\\Nirmala.ttf',
    '/usr/share/fonts/truetype/nirmala/Nirmala.ttf',
  ],
  bold: [
    'C:\\Windows\\Fonts\\lathab.ttf',
    '/usr/share/fonts/truetype/tlwg/Latha-Bold.ttf',
    'C:\\Windows\\Fonts\\Nirmalab.ttf',
    '/usr/share/fonts/truetype/nirmala/NirmalaB.ttf',
  ],
};

/** Optional override for the body/sans face. */
const SANS_FONT_CANDIDATES = [
  'C:\\Windows\\Fonts\\segoeui.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
];

/**
 * Optional body face, applied only when CERTIFICATE_FONT_SANS names a real font.
 *
 * Off by default: the certificate body is set in Helvetica, which matches the
 * rest of the artwork. Set the variable when a deployment wants a different
 * body face; an unusable path is ignored rather than fatal.
 */
function resolveSansFont() {
  const override = process.env.CERTIFICATE_FONT_SANS;
  if (override && canEmbed(override)) return override;
  return null;
}

/**
 * True when pdfkit can actually embed this file.
 *
 * fontkit opens a .ttc into a TrueTypeCollection, which has no createSubset —
 * exactly the method pdfkit needs. Probing here turns a hard crash deep inside
 * PDF generation into a quiet fallback to the built-in faces.
 */
const subsetCache = new Map();
function canEmbed(file) {
  if (!file || !fs.existsSync(file)) return false;
  if (subsetCache.has(file)) return subsetCache.get(file);
  let ok = false;
  try {
    /* eslint-disable-next-line global-require */
    const fontkit = require('fontkit');
    const font = fontkit.openSync(file);
    ok = typeof font.createSubset === 'function';
  } catch (err) {
    ok = false;
  }
  subsetCache.set(file, ok);
  return ok;
}

function firstUsable(candidates, envVar) {
  const override = process.env[envVar];
  if (override && canEmbed(override)) return override;
  return candidates.find((f) => canEmbed(f)) || null;
}

/**
 * A font's line ascent in em — where pdfkit places the baseline relative to the
 * top of a text line box. Read from the font itself, so it stays correct whichever
 * candidate loads.
 */
function ascentEm(file) {
  try {
    /* eslint-disable-next-line global-require */
    const fontkit = require('fontkit');
    const font = fontkit.openSync(file);
    return font.ascent / font.unitsPerEm;
  } catch (err) {
    return 0.8;
  }
}

/**
 * Whether a Unicode face is available for non-Latin certificate text.
 * The renderer calls this to decide if it needs to switch fonts per field.
 */
function unicodeFontAvailable() {
  return Boolean(
    process.env.CERTIFICATE_FONT_REGULAR
    || UNICODE_FONT_CANDIDATES.regular.some((f) => canEmbed(f))
  );
}

/**
 * True when a script face is available for the student's name.
 *
 * When none is installed the renderer falls back to a serif face rather than
 * rendering nothing — a certificate with a plainly-set name is far better than
 * one with a blank focal point.
 */
function scriptFontAvailable() {
  return Boolean(firstUsable(SCRIPT_FONT_CANDIDATES, 'CERTIFICATE_FONT_SCRIPT'));
}

/**
 * Characters outside Latin-1 / Latin Extended-A, general punctuation and
 * currency. Latin-1 is what pdfkit's built-in Times and Helvetica can encode, so
 * anything matching this genuinely needs the Unicode face.
 */
const NEEDS_UNICODE_FONT = /[^\u0000-\u00FF\u0100-\u017F\u2000-\u206F\u20A0-\u20BF]/;

/** True when a value contains glyphs the built-in serif faces cannot render. */
function requiresUnicodeFont(value) {
  return NEEDS_UNICODE_FONT.test(String(value == null ? '' : value));
}

/**
 * Register the certificate faces on a pdfkit document.
 *
 * @returns {{ fonts: Record<string,string>, unicodeFont: string|null }}
 *   `fonts` maps the layout's font keys (displayRegular, bodyBold, ...) to real
 *   pdfkit font names, already resolved to the Unicode face where one loaded.
 *   `unicodeFont` is the name to switch to for non-Latin text, or null.
 */
function registerFonts(doc) {
  const names = {
    /* The script key starts on a serif fallback on purpose: if no script font is
       installed, a serif name still reads as a name, where a missing one would
       leave a blank. */
    script: 'Times-Italic',
    displayBold: 'Times-Bold',
    bodyRegular: 'Helvetica',
    bodyBold: 'Helvetica-Bold',
  };

  /* 1. The script face for the student's name — the focal point of the design. */
  const scriptFile = firstUsable(SCRIPT_FONT_CANDIDATES, 'CERTIFICATE_FONT_SCRIPT');
  if (scriptFile) {
    try {
      doc.registerFont('cert-script', scriptFile);
      names.script = 'cert-script';
      faceAscentEm['cert-script'] = ascentEm(scriptFile);
    } catch (err) {
      console.warn('[certificates] script font rejected, falling back to serif:', err.message);
    }
  } else {
    console.warn(
      '[certificates] no script font found — the student name will be set in serif. '
      + `Install one of: ${SCRIPT_FONT_CANDIDATES.join(', ')}`
    );
  }

  /* 2. A Unicode face, for names the base-14 fonts cannot encode. */
  const regular = firstUsable(UNICODE_FONT_CANDIDATES.regular, 'CERTIFICATE_FONT_REGULAR');
  const bold = firstUsable(UNICODE_FONT_CANDIDATES.bold, 'CERTIFICATE_FONT_BOLD');

  let unicodeFont = null;
  if (regular) {
    try {
      doc.registerFont('cert-unicode', regular);
      unicodeFont = 'cert-unicode';
      faceAscentEm['cert-unicode'] = ascentEm(regular);
      faceAscentEm['cert-unicode-bold'] = ascentEm(bold || regular);
      /* The bold companion is optional: without it the same face is reused,
         which is far better than losing the Unicode coverage entirely. */
      try {
        doc.registerFont('cert-unicode-bold', bold || regular);
      } catch (err) {
        doc.registerFont('cert-unicode-bold', regular);
      }
    } catch (err) {
      console.warn('[certificates] Unicode font rejected, using built-in faces:', err.message);
    }
  }

  /* The serif/sans defaults are deliberately left as the base-14 faces: the
     renderer applies `unicodeFont` per field only where the text genuinely needs
     it, so a Latin certificate keeps its classic look. */
  const sans = resolveSansFont();
  if (sans) {
    try {
      doc.registerFont('cert-sans', sans);
      doc.registerFont('cert-sans-bold', sans);
      names.bodyRegular = 'cert-sans';
      names.bodyBold = 'cert-sans-bold';
    } catch (err) {
      console.warn('[certificates] sans font rejected, using built-in:', err.message);
    }
  }

  return { fonts: names, unicodeFont };
}

/**
 * The certificate artwork as a data: URL.
 *
 * The Super Admin preview modal renders the SAME background image the PDF is
 * built from, so what an admin approves on screen is what the student receives.
 * A data URL (rather than a bundled asset path) because Vite fingerprints
 * src/assets imports and the hashed filename is not knowable from the server.
 */
function templateDataUrl() {
  const file = templatePath();
  const ext = path.extname(file).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
  return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
}

/** Public URL the browser can load the artwork from, for the preview <img>. */
function templateUrl() {
  return process.env.CERTIFICATE_TEMPLATE_URL || `/${layout.template.asset}`;
}

module.exports = {
  layout,
  templatePath,
  templateDataUrl,
  templateUrl,
  registerFonts,
  unicodeFontAvailable,
  scriptFontAvailable,
  ascentEmFor,
  REFERENCE_ASCENT_EM,
  canEmbed,
  requiresUnicodeFont,
};