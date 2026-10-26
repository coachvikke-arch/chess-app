/* PGN helpers for the unified profile game viewer (chess.js-based). */

import { Chess } from 'chess.js';

/**
 * Parse a PGN string into a game the ChessBoard/analysis pipeline can use.
 * Returns { initFen, moves, white, black, result } with sensible fallbacks.
 */
/* A FEN is a board line of eight slash-separated ranks followed by the side to
   move and up to four more fields. A PGN carries tag pairs or move-numbered
   movetext. These two shapes are what the Position panel tells apart. */
const FEN_RE = /^([rnbqkpRNBQKP1-8]+\/){7}[rnbqkpRNBQKP1-8]+(\s+[^\s]+){1,5}$/;
const PGN_TAG_RE = /^\s*\[[A-Za-z][A-Za-z0-9_]*\s+"/m;

/**
 * Best guess at what a pasted string is: 'fen', 'pgn', or '' when empty.
 * Tag pairs and move numbers are unambiguous PGN; a board line is a FEN. A
 * bare FEN missing trailing fields still counts as 'fen' so the loader can
 * report the exact problem instead of calling it a PGN.
 */
export function detectNotation(text) {
  const raw = String(text || '').replace(/\r\n?/g, '\n').trim();
  if (!raw) return '';
  if (PGN_TAG_RE.test(raw)) return 'pgn';
  if (/(^|\s)\d+\.(\s|$)/.test(raw)) return 'pgn';
  if (FEN_RE.test(raw)) return 'fen';
  if (raw.includes('/')) return 'fen';
  return 'pgn';
}

/**
 * A PGN file can hold several games. Each begins at an `[Event` tag pair; text
 * with no Event tag (or a bare movetext line) is treated as a single game.
 */
export function splitPgnGames(text) {
  const raw = String(text || '').replace(/\r\n?/g, '\n').trim();
  if (!raw) return [];
  const parts = raw
    .split(/\n(?=\s*\[Event\s+")/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : [raw];
}

/** Human label for one game of a multi-game PGN picker. */
export function pgnGameLabel(game, index) {
  const { white, black, result } = parsePgn(game);
  const names = [white, black].filter(Boolean).join(' vs ');
  if (!names) return `Game ${index + 1}`;
  return result ? `${names} · ${result}` : names;
}

/**
 * Parse a single FEN, returning { fen, moves } on success or null when chess.js
 * rejects it. The round-tripped FEN is returned so the caller sends exactly what
 * the engine canonicalised.
 */
export function tryLoadFen(fen) {
  try {
    const g = new Chess();
    g.load(String(fen || '').trim());
    return { fen: g.fen(), moves: [] };
  } catch {
    return null;
  }
}

/**
 * Parse a single PGN (headers, comments, variations, NAGs and a [SetUp]/[FEN]
 * start all handled by chess.js), returning the loaded position or null when the
 * text is not a readable game. Multi-game text must be split first.
 */
export function tryLoadPgn(pgn) {
  const g = new Chess();
  try {
    if (typeof g.loadPgn === 'function') g.loadPgn(String(pgn || ''), { strict: false });
    else if (typeof g.load_pgn === 'function') g.load_pgn(String(pgn || ''));
    else return null;
  } catch {
    return null;
  }
  return { fen: g.fen(), moves: g.history().slice(), pgn: g.pgn() };
}

export function parsePgn(pgn) {
  const raw = String(pgn || '');
  const headers = {};
  const headerRe = /\[([A-Za-z0-9]+)\s+"((?:\\.|[^"])*)"\]/g;
  let m;
  while ((m = headerRe.exec(raw)) !== null) headers[m[1]] = m[2];

  let initFen = 'start';
  if (headers.FEN && headers.FEN !== 'start') initFen = headers.FEN;

  const g = new Chess(initFen === 'start' ? undefined : initFen);
  const moves = [];
  try {
    g.loadPgn(raw, { strict: false });
    moves.push(...g.history().filter(Boolean));
  } catch {
    const body = raw.replace(/\[[^\]]+\]\s*/g, '').trim();
    if (body) {
      const g2 = new Chess(initFen === 'start' ? undefined : initFen);
      for (const tok of body.split(/\s+/)) {
        if (/^\d+\./.test(tok)) continue;
        const clean = tok.replace(/[?!]+$/g, '');
        if (!clean || /^[0-1/2-]+$/.test(clean)) continue;
        try { g2.move(clean); moves.push(clean); } catch { /* stop at first bad token */ break; }
      }
    }
  }

  return {
    initFen,
    moves,
    white: headers.White || '',
    black: headers.Black || '',
    result: headers.Result || '',
    site: headers.Site || '',
    event: headers.Event || '',
    eco: headers.ECO || '',
    opening: headers.Opening || '',
  };
}

const CATEGORY_GLYPH = { bullet: '⚡', blitz: '⚑', rapid: '☕', classical: '♛', chess960: '♞', correspondence: '✉', other: '♟' };

export function timeClassGlyph(cls) {
  return CATEGORY_GLYPH[cls] || CATEGORY_GLYPH.other;
}

export function resultMeta(result, myColor) {
  if (result === 'draw') return { text: '½–½', tone: 'draw', color: '#a3a3a3' };
  const won = result === myColor;
  return won
    ? { text: '1–0', tone: 'win', color: '#93c5fd' }
    : { text: '0–1', tone: 'loss', color: '#ff7b7b' };
}

export function formatDate(iso) {
  if (!iso) return '—';
  const d = iso instanceof Date ? iso : new Date(String(iso).slice(0, 10) + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}