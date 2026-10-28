/*
 * Tournament certificate content rules.
 *
 * The artwork is fixed; everything that varies between two certificates is
 * produced here — the name, the date and the two description lines. Keeping it
 * in one module means the preview, the PNG and the PDF all read the same
 * strings, so a certificate can never be exported with wording the admin never
 * saw.
 *
 * The wording is deliberately NOT built from a template string on the server:
 * the description is a sentence with three bold facts in it, and the browser
 * needs those facts as runs so it can set them in bold while keeping the line
 * centred.
 */

/** A4 landscape at 150 DPI — the export canvas. */
export const TCERT_W = 1999;
export const TCERT_H = 1414;

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** 1 → '1st', 2 → '2nd', 11 → '11th'. */
export function ordinal(n) {
  const num = Number(n);
  if (!Number.isInteger(num) || num < 1) return '';
  const mod100 = num % 100;
  const suffix = mod100 >= 11 && mod100 <= 13
    ? 'th'
    : num % 10 === 1
      ? 'st'
      : num % 10 === 2
        ? 'nd'
        : num % 10 === 3
          ? 'rd'
          : 'th';
  return `${num}${suffix}`;
}

/** '7' and 7.0 print as '7'; 6.5 stays '6.5'. */
export function formatPoints(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return Number.isInteger(n) ? String(n) : String(n);
}

export function pointsWord(value) {
  return Number(value) === 1 ? 'point' : 'points';
}

export function roundsWord(value) {
  return Number(value) === 1 ? 'round' : 'rounds';
}

/** '24 October 2026' — the same text on screen and in the export. */
export function formatTournamentDate(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * Keep the casing the academy typed, but repair an all-lowercase name.
 *
 * A name entered as "nagavel k" is a data-entry slip, not a style choice; a
 * certificate should not print it that way. A name with ANY capital letter is
 * left exactly as stored, because "McDonald" and "van der Berg" are correct
 * spellings that a blind title-case would destroy.
 */
export function displayName(raw) {
  const name = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!name) return '';
  if (name !== name.toLowerCase()) return name;
  return name.replace(/(^|[\s'’-])(\p{L})/gu, (_, lead, letter) => lead + letter.toUpperCase());
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Flatten weighted runs into the plain string (used for tests and aria). */
export function plainSegments(segments) {
  return (segments || []).map((s) => s.text).join('');
}

/**
 * The two description lines.
 *
 * Built as weighted runs rather than one string with markers, because the bold
 * facts have to be drawn in a different face without pushing the line off
 * centre. The split mirrors the reference certificate: the placing and event on
 * line one, the score and the academy on line two.
 */
export function buildTournamentDescription({ position, points, rounds, tournamentName }) {
  const event = String(tournamentName ?? '').trim() || 'the tournament';
  const place = ordinal(position);
  const pts = formatPoints(points);
  const rnds = rounds === null || rounds === undefined || rounds === '' ? '' : String(Math.trunc(Number(rounds)));

  const line1 = place
    ? [
      { text: 'For outstanding play and securing ', bold: false },
      { text: `${place} place`, bold: true },
      { text: ` in the ${event} tournament,`, bold: false },
    ]
    : [
      { text: 'For outstanding play and participation in the ', bold: false },
      { text: `${event} tournament,`, bold: true },
    ];

  /* A legacy row issued before points/rounds were stored has neither, so it
     falls back to the short form instead of printing "scoring  points in
      rounds". */
  if (!pts && !rnds) {
    return {
      line1,
      line2: [{ text: 'organized by Mate Zone Chess Academy.', bold: false }],
    };
  }

  const line2 = [{ text: 'scoring ', bold: false }];
  if (pts) line2.push({ text: `${pts} ${pointsWord(pts)}`, bold: true });
  if (pts && rnds) line2.push({ text: ' in ', bold: false });
  if (rnds) line2.push({ text: `${rnds} ${roundsWord(rnds)}`, bold: true });
  line2.push({ text: ', organized by Mate Zone Chess Academy.', bold: false });

  return { line1, line2 };
}

/**
 * Normalise anything the API hands over into the props the artwork needs.
 *
 * Tolerant of the older rows: they carry `score: '5.5 / 7'` rather than the two
 * separate values, and those are recovered so an already-issued certificate
 * still reads correctly instead of losing its score.
 */
export function tournamentCertificateData(raw = {}) {
  const position = toNumber(raw.position ?? raw.rank);
  let points = toNumber(raw.points);
  let rounds = toNumber(raw.rounds);

  if ((points === null || rounds === null) && typeof raw.score === 'string') {
    const m = raw.score.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+)/);
    if (m) {
      if (points === null) points = Number(m[1]);
      if (rounds === null) rounds = Number(m[2]);
    } else if (points === null && raw.score.trim() !== '') {
      const single = Number(raw.score);
      if (Number.isFinite(single)) points = single;
    }
  }

  return {
    studentName: displayName(raw.studentName || raw.student_name || raw.playerName),
    tournamentName: String(raw.tournamentName || raw.tournament_name || '').trim(),
    position,
    points,
    rounds,
    dateText: formatTournamentDate(raw.date || raw.issuedAt || raw.issued_at),
    coachName: raw.coachName || 'Nagavel Krishnamoorthi',
    coachTitle: raw.coachTitle || 'Founder & Head Coach',
  };
}

/** The greeting that travels with the exported image. */
export function buildTournamentMessage({ studentName, position, tournamentName }) {
  const name = String(studentName ?? '').trim() || 'there';
  const event = String(tournamentName ?? '').trim() || 'the tournament';
  const place = ordinal(position);
  if (place) {
    return `Congratulations ${name}! 🎉 You secured ${place} place in ${event} at Mate Zone Chess Academy. Your certificate is attached.`;
  }
  return `Congratulations ${name}! 🎉 You took part in ${event} at Mate Zone Chess Academy. Your certificate is attached.`;
}
