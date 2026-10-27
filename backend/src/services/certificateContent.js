const { LEVELS, BADGE_ICONS } = require('./ratingService');
const { APP_NAME } = require('../config/brand');

/**
 * Resolves a certificate row into the exact strings drawn on the artwork.
 *
 * This is the single source of truth for certificate CONTENT. The PDF renderer
 * draws these values, and the API hands the same object to the Super Admin
 * preview — so the on-screen preview and the generated file cannot drift apart.
 * The browser never recomputes any of it.
 *
 * Every element that shows the level is derived here, from one `level` value, so
 * the ribbon, the medallion, the description and the information row can never
 * disagree, and each is drawn exactly once (there is no "update the old text"
 * step, because there is no old text).
 */

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** The academy's fixed identity. Printed into the artwork, so not editable. */
const ACADEMY = {
  name: APP_NAME,
  founder: 'Nagavel Krishnamoorthi',
  role: 'Founder & Head Coach',
};

/** Deterministic date text — no locale drift between server and browser. */
function formatIssuedDate(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function ordinal(n) {
  const num = Number(n);
  if (!Number.isInteger(num) || num < 1) return '';
  const suffix =
    num % 100 >= 11 && num % 100 <= 13 ? 'th'
      : num % 10 === 1 ? 'st'
        : num % 10 === 2 ? 'nd'
          : num % 10 === 3 ? 'rd'
            : 'th';
  return `${num}${suffix}`;
}

/** The level band a `level_no` refers to. */
function levelBand(levelNo) {
  const n = Number(levelNo);
  if (!Number.isInteger(n) || n < 1 || n > LEVELS.length) return null;
  return LEVELS[n - 1];
}

/**
 * Certificate title for a completed level.
 *
 * "Level N completed", with no extra wording: the artwork already says
 * "CERTIFICATE / OF LEVEL COMPLETION" and "LEVEL N", so any more text here would
 * only be repeating the design.
 */
function levelTitle(levelNo) {
  const band = levelBand(levelNo);
  return band ? `Level ${band.level} completed` : `Level ${levelNo} completed`;
}

/** Certificate title for a finished tournament. */
function tournamentTitle({ tournamentName, rank }) {
  const place = ordinal(rank);
  const name = tournamentName || 'Tournament';
  return place ? `${name} - ${place} Place` : `${name} - Participant`;
}

/** "LEVEL 5" — the exact string on the ribbon and inside the medallion. */
function levelBanner(levelNo) {
  return `LEVEL ${levelNo}`;
}

/** "1ST PLACE" / "PARTICIPANT" — the tournament ribbon and medallion text. */
function tournamentBanner(rank) {
  const place = ordinal(rank);
  return place ? `${place.toUpperCase()} PLACE` : 'PARTICIPANT';
}

/**
 * Build the print-ready field values for a certificate.
 *
 * Tournament certificates reuse the same artwork. Their title is carried on the
 * ribbon in place of the level, and the description names the event, so a
 * tournament achievement is visually consistent with a level one rather than a
 * different design.
 *
 * @param {object}  args
 * @param {object}  args.certificate  the certificates row (plus tournament_name when joined)
 * @param {object}  args.student      { name }
 */
function buildCertificateContent({ certificate, student, settings }) {
  const cert = certificate || {};
  const isTournament = cert.type === 'tournament';
  const band = isTournament ? null : levelBand(cert.level_no);
  const level = isTournament ? '' : cert.level_no;
  const issued = formatIssuedDate(cert.issued_at);

  /* One value, used by the ribbon, the medallion, the description and the
     information row. */
  const banner = isTournament
    ? tournamentBanner(cert.rank)
    : levelBanner(level);

  const description1 = isTournament
    ? (cert.score
      ? `This certificate recognizes the achievement of ${cert.score} in a finalised tournament`
      : 'This certificate recognizes the achievement in a finalised tournament')
    : 'This certificate recognizes the successful completion of the required training,';

  /* The emphasised tail of line 2 is carried as weighted segments so the
     renderer can set it in bold while keeping the whole line optically centred.
     Built by slicing off a known suffix rather than by regex-stripping the middle,
     so the space before the emphasised words is never swallowed. */
  const description2Tail = isTournament
    ? `${cert.tournament_name || 'the tournament'} at ${ACADEMY.name}.`
    : `Level ${level} at ${ACADEMY.name}.`;
  const description2Head = isTournament
    ? 'practice, and assessment in '
    : 'practice, and assessment for ';
  const description2 = description2Head + description2Tail;

  return {
    /* ── the dynamic layer, matching certificateLayout.json field keys ── */
    name: (student && student.name) || '',

    ribbon_level: banner,
    badge_level: banner,

    description_line1: description1,
    description_line2: description2,
    description_line2_segments: [
      { text: description2Head, bold: false },
      { text: description2Tail, bold: true },
    ],

    info_level: isTournament
      ? `Result : ${ordinal(cert.rank) ? `${ordinal(cert.rank)} Place` : 'Participant'}`
      : `Level : Level ${level}`,
    info_date: `Date : ${issued}`,

    /* ── not printed: kept for the UI, the WhatsApp message and the log ── */
    institute: (settings && settings.institute_name) || ACADEMY.name,
    coach: (settings && settings.coach_name) || ACADEMY.founder,
    logo: '',
    title: cert.title || '',
    certificate_no: cert.certificate_no || '',
    meta: [issued ? `Issued ${issued}` : '', cert.certificate_no || ''].filter(Boolean).join('   ·   '),
    _academy: ACADEMY,
    _issued: issued,
    _score: isTournament ? (cert.score || '') : '',
    _position: isTournament ? (cert.rank ?? null) : null,
    _badge: band ? `${BADGE_ICONS[band.level] || '♙'} ${band.badge}` : null,
    _tier: band ? `${band.name} · tier ${band.level}` : null,
  };
}

module.exports = {
  ACADEMY,
  MONTHS,
  formatIssuedDate,
  ordinal,
  levelBand,
  levelTitle,
  levelBanner,
  tournamentTitle,
  buildCertificateContent,
};