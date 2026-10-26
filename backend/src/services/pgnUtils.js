/*
 * PGN parsing + normalization helpers shared by the Chess.com / Lichess
 * importers. Both platforms hand us PGN text, so we read metadata from the
 * PGN itself (uniform) and fall back to the raw API payload where needed.
 */

/* ── tag-pair extraction ─────────────────────────────────────────────────── */

function parseHeaders(pgn = '') {
  const headers = {};
  const re = /\[\s*(\w+)\s+"((?:[^"\\]|\\.)*)"\s*\]/g;
  let m;
  while ((m = re.exec(pgn))) headers[m[1].toLowerCase()] = m[2].replace(/\\(.)/g, '$1');
  return headers;
}

/* ── movetext splitting ──────────────────────────────────────────────────── */

function splitPgn(pgn = '') {
  const text = String(pgn);
  // First occurrence of the move-text start (move number, result tag or a
  // variation marker). NOTE: we deliberately use `match` + `indexOf` rather
  // than String.prototype.search — `search` is a very-recent language addition
  // and crashes on older Node runtimes.
  const found = text.match(/\s*1\.|\s*1-0|\s*0-1|\s*1\/2-1\/2|½|\*+/);
  const headerEnd = found ? text.indexOf(found[0]) : -1;
  if (headerEnd < 0) return { meta: '', body: text };
  const firstNewline = text.indexOf('\n');
  const head = firstNewline >= 0 && firstNewline < headerEnd ? text.slice(0, headerEnd) : '';
  return { meta: head, body: text.slice(headerEnd) };
}

/** Strip comments/variations/move-numbers/results → plain SAN move list. */
function movesFromPgn(pgn = '') {
  const { body } = splitPgn(pgn);
  let text = body
    .replace(/\{[^}]*\}/g, ' ')            // nag/comment braces
    .replace(/\([^)]*\)/g, ' ')            // variations (no nesting in pgn bodies we parse)
    .replace(/\n/g, ' ')
    .replace(/\d+\.(\.\.)?\s*/g, ' ')
    .replace(/\b(1-0|0-1|1\/2-1\/2|[½¾]|draw|game)\b/g, ' ')
    .replace(/[?!]+/g, ' ');
  return text.split(/\s+/).filter(Boolean);
}

/* ── result handling ─────────────────────────────────────────────────────── */

function resultToKey(result = '') {
  const r = String(result).trim();
  if (r === '1-0') return 'white';
  if (r === '0-1') return 'black';
  if (/1\/2|½/.test(r)) return 'draw';
  return null;
}

/* ── opening name resolution ──────────────────────────────────────────────── */

const ECO_NAMES = require('../data/ecoNames');

/**
 * Resolve the best opening display name we can get:
 *   1. an explicit name already carrying meaning (strip "?"-style decorations),
 *   2. a name embedded in a chess.com /openings/<slug> URL,
 *   3. the canonical name for a real ECO code,
 *   4. '' (caller falls back to "(Unknown)").
 */
function resolveOpeningName(input = '', eco = '') {
  let name = String(input || '').trim().replace(/\s*\?+\s*/g, ' ').trim();

  if (!name && /^https?:\/\/(?:www\.)?chess\.com\/openings\//i.test(eco)) {
    const slug = eco.replace(/^https?:\/\/(?:www\.)?chess\.com\/openings\//i, '').split(/[?#]/)[0] || '';
    name = slug
      .slice(0, slug.lastIndexOf('-'))
      .split('-')
      .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
      .join(' ')
      .replace(/(\d+)\.$/, '$1')
      .trim();
    // chess.com slugs like "Italian-Game-Two-Knights-..." → "Italian Game"
  }

  if (!name && /^[A-E]\d{2}$/.test(eco || '')) {
    name = ECO_NAMES[eco] || '';
  }

  return name;
}

/* ── game normalization ───────────────────────────────────────────────────── */

/** Build a normalized game object from PGN text + platform payload extras. */
function normalizeGame({ platform, pgn, extra = {} }) {
  const headers = parseHeaders(pgn);
  const whiteName = headers.white || extra.whiteName || '';
  const blackName = headers.black || extra.blackName || '';
  const result = resultToKey(headers.result) || extra.result || 'draw';
  const moves = movesFromPgn(pgn);
  return {
    platform,
    pgn,
    whiteName,
    blackName,
    whiteRating: toInt(headers.whiteelo ?? extra.whiteRating),
    blackRating: toInt(headers.blackelo ?? extra.blackRating),
    result,
    timeControl: headers.timecontrol || extra.timeControl || '',
    timeClass: normalizeTimeClass(extra.timeClass || headers.event_type || ''),
    opening: normalizeGameOpening({ headers, extra }),
    eco: cleanEco(headers.eco || extra.eco || ''),
    gameUrl: headers.site || extra.gameUrl || '',
    gameEvent: headers.event || extra.gameEvent || '',
    movesCount: Number.isFinite(headers.movenumber) ? headers.movenumber : moves.length,
    endTimeMs: extra.endTimeMs || null,
    isRated: extra.isRated != null ? extra.isRated : /rated/i.test(headers.termination || '') || false,
  };
}

function normalizeGameOpening({ headers, extra }) {
  const headerName = headers.opening || '';
  const headerEco = cleanEco(headers.eco || '');
  const payloadName = extra.opening || '';
  const payloadEco = extra.eco || '';
  return resolveOpeningName(headerName || payloadName, headerEco || payloadEco);
}

function cleanEco(value = '') {
  const v = String(value).trim();
  if (/^[A-E]\d{2}$/.test(v)) return v;
  return '';
}

function normalizeTimeClass(value = '') {
  const v = String(value).toLowerCase();
  if (!v) return '';
  if (/(ultrabullet|bullet)/.test(v)) return 'bullet';
  if (v.includes('blitz')) return 'blitz';
  if (/(rapid)/.test(v)) return 'rapid';
  if (/(classical|classic)/.test(v)) return 'classical';
  if (/(correspondence|daily)/.test(v)) return 'correspondence';
  return v.slice(0, 30);
}

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

module.exports = {
  parseHeaders,
  splitPgn,
  movesFromPgn,
  resultToKey,
  normalizeGame,
  normalizeTimeClass,
  resolveOpeningName,
};