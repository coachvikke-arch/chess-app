const db = require('../config/database');
const { Chess } = require('chess.js');
const AdmZip = require('adm-zip');
const { parseHeaders } = require('../services/pgnUtils');
const PGNMENTOR_PLAYERS = require('../data/pgnmentorPlayers');

const DEFAULT_ANNOTATION_COUNT = 5;

/* ── small helpers ────────────────────────────────────────────────────────── */

function displayName(raw) {
  const name = String(raw || '').trim().replace(/\.$/g, '').replace(/\s+/g, ' ');
  if (!name) return 'Unknown';
  const parts = name.split(',').map((part) => part.trim());
  if (parts.length > 1 && parts[0] && parts[1]) {
    return `${parts.slice(1).join(' ')} ${parts[0]}`.replace(/\s+/g, ' ').trim();
  }
  return name;
}

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function extractYear(pgnText) {
  const match = String(pgnText || '').match(/^\s*\[Date\s+"([^"]+)"/m);
  if (!match) return 0;
  const year = parseInt(match[1].slice(0, 4), 10);
  return Number.isFinite(year) && year > 1800 && year < 2100 ? year : 0;
}

function normalizeResult(result) {
  const value = String(result || '').trim();
  if (value === '1-0' || value === '0-1') return value;
  if (/1\/2|½|draw/i.test(value)) return '1/2-1/2';
  return '*';
}

function titleFor(gameText, headers) {
  const white = headers.white || '?';
  const black = headers.black || '?';
  const year = extractYear(gameText);
  return `${white} vs ${black}${year ? ` (${year})` : ''}`;
}

/* Build a plain move list like the seeded games: "1.e4 d6 2.d4 Nf6 ..." so the
   frontend parsePgnReplay() (chess.js loadPgn) accepts it unchanged. */
function buildPlainPgn(history) {
  return history.map((move, index) => (index % 2 === 0 ? `${Math.floor(index / 2) + 1}.${move.san}` : move.san)).join(' ');
}

/* Pick up to `count` evenly spaced "decision" moves for study annotations. */
function generateAnnotations(history, count = DEFAULT_ANNOTATION_COUNT) {
  if (!history.length) return [];
  const total = history.length;
  const picks = [];
  for (let i = 0; i < count; i += 1) {
    const frac = (i + 1) / (count + 1);
    const index = Math.min(Math.max(Math.round(total * frac) - 1, 0), total - 1);
    const move = history[index];
    picks.push({
      moveNumber: Math.floor(index / 2) + 1,
      comment: `Study this decision: ${move.color === 'w' ? 'White plays' : 'Black plays'} ${move.san}. Pause and compare piece activity, king safety, and available plans before continuing.`,
    });
  }
  const seen = new Set();
  return picks.filter((pick) => {
    if (seen.has(pick.moveNumber)) return false;
    seen.add(pick.moveNumber);
    return true;
  });
}

/** Split a bulk PGN blob into individual games on the [Event header boundary. */
function splitGames(buffer) {
  const text = String(buffer || '');
  const chunks = text.split(/\n(?=\[Event )/).map((item) => item.trim()).filter(Boolean);
  if (chunks.length === 0 && text.trim()) {
    return [text.trim()];
  }
  return chunks;
}

/* ── public list (any authenticated user, so student replay works too) ────── */

exports.listImported = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, white, black, event, year, result, source, player, created_at
       FROM gm_games ORDER BY player NULLS LAST, year DESC, white`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Failed to list GM games', error: err.message });
  }
};

exports.getOne = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, white, black, event, year, result, pgn, annotations, source
       FROM gm_games WHERE id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: 'GM game not found' });
    const row = result.rows[0];
    res.json({
      id: row.id,
      white: row.white,
      black: row.black,
      event: row.event,
      year: row.year,
      result: row.result,
      pgn: row.pgn,
      annotations: row.annotations || [],
      source: row.source,
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch GM game', error: err.message });
  }
};

/* ── bulk import (admin + superadmin) ─────────────────────────────────────── */

/** Shared engine: parse a PGN blob, persist valid games, return a tally.
 *  `exec` is anything exposing `.query(text, params)` so callers can run the
 *  whole batch inside a transaction (pg Pool or a single checked-out client).
 *  `meta` may carry { player, source } to tag games from a pgnmentor pack. */
async function persistGames(pgnText, autoAnnotate = true, meta = {}, exec = db) {
  const imported = [];
  const skipped = [];
  const noMoves = [];
  const failed = [];
  const sources = splitGames(pgnText);

  for (const gameText of sources) {
    const headers = parseHeaders(gameText);
    const title = titleFor(gameText, headers);

    /* Movetext runs after the last closing tag line; requires a real move-list
       token like "1.e4" — headers such as [Date "1886.??.??"] must not count. */
    const lastTag = gameText.lastIndexOf(']');
    const movetext = lastTag >= 0 ? gameText.slice(lastTag + 1) : gameText;
    const hasMoveList = /(^|\s)\d+\s*\.\s*[a-zA-Z]/.test(movetext);

    if (!hasMoveList) {
      const resultTag = normalizeResult(headers.result);
      noMoves.push({
        title,
        white: displayName(headers.white),
        black: displayName(headers.black),
        event: headers.event || 'Imported game',
        year: extractYear(gameText),
        result: resultTag,
        reason: 'No move list in this PGN — header-only entry, not playable.',
      });
      continue;
    }

    let chess;
    try {
      chess = new Chess();
      chess.loadPgn(gameText);
    } catch (err) {
      failed.push({ title, reason: `Invalid PGN: ${err.message}` });
      continue;
    }

    const history = chess.history({ verbose: true });
    if (history.length === 0) {
      failed.push({ title, reason: 'Game contains no moves.' });
      continue;
    }

    const white = displayName(headers.white);
    const black = displayName(headers.black);
    const year = extractYear(gameText);
    const result = normalizeResult(headers.result);
    const plainPgn = buildPlainPgn(history);
    /* A game that starts from a setup must keep its origin: the frontend
       replays AND analyses from the PGN's [FEN] tag, so dropping it here
       would silently analyse the wrong position. Only a loadable FEN is
       kept — anything else falls back to the plain move list. */
    let storedPgn = plainPgn;
    const tagFen = String(headers.fen || '').trim();
    if (tagFen && tagFen !== 'start') {
      try {
        new Chess(tagFen);
        storedPgn = `[SetUp "1"]\n[FEN "${tagFen}"]\n\n${plainPgn}`;
      } catch { /* keep the plain move list */ }
    }
    const annotations = autoAnnotate ? generateAnnotations(history) : [];
    const source = meta.source || String(headers.site || '').trim() || 'pgnmentor';
    const player = meta.player || null;

    const baseId = `${slugify(white)}-${slugify(black)}-${year || 'undated'}`;
    let id = baseId;
    let matchedExisting = false;
    for (let attempts = 0; attempts < 50; attempts += 1) {
      const dup = await exec.query('SELECT pgn FROM gm_games WHERE id = $1', [id]);
      if (dup.rows.length === 0) break;
      if (dup.rows[0].pgn === storedPgn) {
        matchedExisting = true;
        break;
      }
      id = `${baseId}-${attempts + 2}`;
    }

    if (matchedExisting) {
      skipped.push({ id, title, reason: 'Duplicate — this exact game is already imported.' });
      continue;
    }

    await exec.query(
      `INSERT INTO gm_games (id, white, black, event, year, result, pgn, annotations, source, player)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id) DO UPDATE SET
         white = EXCLUDED.white, black = EXCLUDED.black, event = EXCLUDED.event,
         year = EXCLUDED.year, result = EXCLUDED.result, pgn = EXCLUDED.pgn,
         annotations = EXCLUDED.annotations, source = EXCLUDED.source, player = EXCLUDED.player`,
      [id, white, black, headers.event || 'Imported game', year, result, storedPgn, JSON.stringify(annotations), source, player]
    );

    imported.push({ id, white, black, event: headers.event || 'Imported game', year, result });
  }

  return {
    total: sources.length,
    imported,
    skipped,
    noMoves,
    failed,
    message: `${imported.length} imported, ${skipped.length} duplicates skipped, ${noMoves.length} had no moves, ${failed.length} failed.`,
  };
}

exports.importBulk = async (req, res) => {
  const { pgn, autoAnnotate = true } = req.body || {};
  if (!pgn || !String(pgn).trim()) {
    return res.status(400).json({ message: 'Paste at least one PGN game.' });
  }

  try {
    const result = await persistGames(pgn, autoAnnotate);
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: 'GM game import failed', error: err.message });
  }
};

/** Import from one or more uploaded .pgn / .txt files. */
exports.importBulkFiles = async (req, res) => {
  const files = req.files || [];
  const autoAnnotate = req.body?.autoAnnotate !== 'false';

  if (files.length === 0) {
    return res.status(400).json({ message: 'Choose at least one .pgn file.' });
  }

  const bad = files.filter((file) => !/\.(pgn|txt)$/i.test(file.originalname || ''));
  if (bad.length > 0) {
    return res.status(400).json({
      message: `Unsupported file type: ${bad.map((file) => file.originalname).join(', ')}. Only .pgn / .txt files are accepted.`,
    });
  }

  const combined = files
    .map((file) => String(file.buffer || ''))
    .filter(Boolean)
    .join('\n\n');

  if (!combined.trim()) {
    return res.status(400).json({ message: 'Uploaded files were empty.' });
  }

  try {
    const result = await persistGames(combined, autoAnnotate);
    res.json({ ...result, files: files.map((file) => file.originalname) });
  } catch (err) {
    res.status(500).json({ message: 'GM game file import failed', error: err.message });
  }
};

/* ── pgnmentor player packs (admin + superadmin) ─────────────────────────── */

exports.getPlayers = async (req, res) => {
  try {
    const countsQuery = await db.query(
      'SELECT player, COUNT(*)::int AS count FROM gm_games WHERE player IS NOT NULL GROUP BY player'
    );
    const counts = {};
    countsQuery.rows.forEach((row) => { counts[row.player] = row.count; });
    res.json({
      players: PGNMENTOR_PLAYERS.map(({ name, url }) => ({ name, url, count: counts[name] || 0 })),
      totals: PGNMENTOR_PLAYERS.reduce((sum, p) => sum + (counts[p.name] || 0), 0),
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to list GM players', error: err.message });
  }
};

/** Download a pgnmentor player pack, unzip, parse and store every game. */
exports.importPlayerGames = async (req, res) => {
  const playerName = String(req.body?.player || '').trim();
  const autoAnnotate = req.body?.autoAnnotate !== false;

  if (!playerName) {
    return res.status(400).json({ message: 'Choose a player to import.' });
  }

  const player = PGNMENTOR_PLAYERS.find(
    (entry) => entry.name.toLowerCase() === playerName.toLowerCase()
  );
  if (!player) {
    return res.status(400).json({
      message: `Unknown player "${playerName}". Available: ${PGNMENTOR_PLAYERS.map((p) => p.name).join(', ')}`,
    });
  }

  let response;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90 * 1000);
    response = await fetch(player.url, { signal: controller.signal });
    clearTimeout(timer);
  } catch (err) {
    return res.status(502).json({
      message: `Could not download ${player.name}'s pack from pgnmentor. ${err.name === 'AbortError' ? 'Request timed out.' : 'Check your internet connection.'}`,
    });
  }

  if (!response.ok) {
    return res.status(502).json({ message: `pgnmentor returned HTTP ${response.status} for ${playerName}.` });
  }

  let archive;
  try {
    archive = new AdmZip(Buffer.from(await response.arrayBuffer()));
  } catch (err) {
    return res.status(502).json({ message: `Failed to read ${playerName}.zip — not a valid archive.` });
  }

  const pgnEntries = archive.getEntries().filter(
    (entry) => !/\/__MACOSX\//.test(entry.entryName) && /\.pgn$/i.test(entry.entryName)
  );

  if (pgnEntries.length === 0) {
    return res.status(502).json({ message: `No .pgn files found inside ${playerName}.zip.` });
  }

  const combined = pgnEntries
    .map((entry) => archive.readAsText(entry))
    .filter(Boolean)
    .join('\n\n');

  if (!combined.trim()) {
    return res.status(502).json({ message: `${playerName}.zip contained no readable PGN text.` });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const result = await persistGames(combined, autoAnnotate, { player: player.name }, client);
    await client.query('COMMIT');
    res.json({
      ...result,
      player: player.name,
      files: pgnEntries.map((entry) => entry.entryName),
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ message: `Failed to store ${playerName}'s games.`, error: err.message });
  } finally {
    client.release();
  }
};

/** Undo a player pack import: delete every imported game for that player.
 *
 *  Only rows whose `player` column matches are touched. The seeded classics
 *  (frontend/src/games/*.json) never reach the DB, and a hand-pasted import
 *  carries no `player`, so this cannot delete anything that was not part of
 *  this player's pgnmentor pack. The name is validated against the known
 *  player list so the route can never be turned into an arbitrary
 *  "DELETE ... WHERE player = <anything>" primitive. */
exports.removePlayerGames = async (req, res) => {
  const playerName = String(req.body?.player || req.query?.player || '').trim();

  if (!playerName) {
    return res.status(400).json({ message: 'Choose a player to remove.' });
  }

  const player = PGNMENTOR_PLAYERS.find(
    (entry) => entry.name.toLowerCase() === playerName.toLowerCase()
  );
  if (!player) {
    return res.status(400).json({ message: `Unknown player "${playerName}".` });
  }

  try {
    const result = await db.query(
      'DELETE FROM gm_games WHERE player = $1 RETURNING id',
      [player.name]
    );
    res.json({
      player: player.name,
      deleted: result.rows.length,
      ids: result.rows.map((row) => row.id),
    });
  } catch (err) {
    res.status(500).json({ message: `Failed to remove ${player.name}'s games.`, error: err.message });
  }
};

exports.removeOne = async (req, res) => {
  try {
    const result = await db.query('DELETE FROM gm_games WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ message: 'GM game not found' });
    res.json({ id: result.rows[0].id, deleted: true });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete GM game', error: err.message });
  }
};