import { Chess } from 'chess.js';
import { APP_NAME_SHORT } from '../config/brand.js';

/* Build a portable PGN for any game the app can show.
 *
 * ONE builder — `buildFullPgn` — is used by every Copy PGN button (and by the
 * PGN download/share paths). It always writes the full tag block, a blank line,
 * the movetext and the result, so a copied game keeps its identity when pasted
 * into Lichess, Chess.com or ChessBase.
 *
 * Rules it implements:
 *  - An imported game (Chess.com / Lichess) keeps the headers its PGN already
 *    carries; only missing tags (notably Source and Link) are added.
 *  - A game played in the app is built from its saved data (players, date,
 *    result, time control, tournament name).
 *  - Placeholder values ("?", "????.??.??") count as missing and are replaced,
 *    never exported.
 *  - A tag is skipped when the data truly does not exist; empty values are
 *    never written.
 *  - Values are escaped, and dates are written as YYYY.MM.DD.
 */

const SITE_NAME = APP_NAME_SHORT;

/* Tags written in this order. Imported tags outside this list are appended
   afterwards, so nothing an importer supplied is lost. */
const SPEC_TAGS = [
  'Event', 'Site', 'Date', 'Round', 'White', 'Black', 'Result',
  'WhiteElo', 'BlackElo', 'TimeControl', 'ECO', 'Opening', 'Termination',
  'Source', 'Link',
];

/* Escape a PGN tag value: backslash and double quote are the only characters
   the spec requires to be escaped inside a tag pair. */
function tag(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function unescapeTag(value) {
  return String(value ?? '').replace(/\\(["\\])/g, '$1');
}

/* A missing or placeholder header. `Result "*"` is a real value, so it is not
   treated as empty. */
function isBlank(value) {
  const s = String(value ?? '').trim();
  return !s || s === '?' || s === '????.??.??';
}

/* `YYYY.MM.DD` from a date-ish value. A `YYYY-MM-DD` string is read literally
   so a UTC-midnight date cannot slide to the previous day in a timezone behind
   UTC. A bare year (a historical GM game) becomes `YYYY.??.??`; anything
   unreadable returns '' so the Date tag is skipped rather than invented. */
export function pgnDate(value) {
  if (value == null || value === '') return '';
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? ''
      : `${value.getFullYear()}.${String(value.getMonth() + 1).padStart(2, '0')}.${String(value.getDate()).padStart(2, '0')}`;
  }
  const s = String(value).trim();
  const onlyYear = s.match(/^(\d{4})$/);
  if (onlyYear) return `${onlyYear[1]}.??.??`;
  const literal = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (literal) return `${literal[1]}.${literal[2]}.${literal[3]}`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

/* Normalise any stored/imported result spelling to a PGN result token.
   Importers store 'white'/'black'/'draw'; PGNs use the token itself. Anything
   unrecognised is an unfinished game, '*'. */
function resultToken(value) {
  const r = String(value ?? '').trim().toLowerCase();
  if (r === '1-0' || r === 'white') return '1-0';
  if (r === '0-1' || r === 'black') return '0-1';
  if (r === '1/2-1/2' || r === '½-½' || r === '1/2' || r === '0.5-0.5' || r === 'draw' || r === 'drawn') {
    return '1/2-1/2';
  }
  return '*';
}

const TERMINATION_LABELS = {
  checkmate: 'Checkmate',
  resignation: 'Resignation',
  resign: 'Resignation',
  timeout: 'Timeout',
  time: 'Timeout',
  stalemate: 'Stalemate',
  insufficient_material: 'Insufficient material',
  threefold_repetition: 'Threefold repetition',
  fifty_move: '50-move rule',
  fifty_moves: '50-move rule',
  agreed: 'Agreement',
  agreement: 'Agreement',
  abandoned: 'Abandoned',
  aborted: 'Aborted',
};

/* Stored end reasons ('checkmate', 'timeout') become the readable phrase a
   PGN's Termination tag carries. An unknown value is kept as typed. */
export function terminationLabel(value) {
  const s = String(value ?? '').trim();
  if (!s) return '';
  const key = s.toLowerCase().replace(/[\s-]+/g, '_');
  return TERMINATION_LABELS[key] || s;
}

function platformLabel(value) {
  const s = String(value || '').toLowerCase();
  if (s.includes('chess.com')) return 'Chess.com';
  if (s.includes('lichess')) return 'Lichess';
  return '';
}

const SITE_LABELS = {
  'chess.com': 'Chess.com',
  'lichess.org': 'Lichess',
  'chessgames.com': 'ChessGames.com',
  'pgnmentor.com': 'PGNMentor.com',
  'pgnmentor': 'PGNMentor.com',
  'wikipedia.org': 'Wikipedia',
};

/* Readable name of the site a PGN actually came from: a URL (a game page, a
   pgnmentor pack link) becomes its hostname; a bare site name is kept. Returns
   '' when the game carries no original source at all, so the caller — not this
   helper — decides the app-name fallback. */
export function sourceSiteLabel(value) {
  const s = String(value ?? '').trim();
  if (!s || s === '?' || s === '????.??.??') return '';
  let host = '';
  try {
    host = new URL(s).hostname.toLowerCase().replace(/^www\./, '');
  } catch { /* not a URL — fall through to the plain-text lookup */ }
  if (host) return SITE_LABELS[host] || host;
  return SITE_LABELS[s.toLowerCase()] || s;
}

/* Every `[Tag "value"]` line, in order. */
function parseHeaders(raw) {
  const pairs = [];
  const re = /^\s*\[([A-Za-z][A-Za-z0-9_]*)\s+"((?:\\.|[^"\\])*)"\]\s*$/gm;
  let m;
  while ((m = re.exec(String(raw || ''))) !== null) {
    pairs.push([m[1], unescapeTag(m[2])]);
  }
  return pairs;
}

/* Same header lines stripped out, leaving the movetext. */
function stripHeaders(raw) {
  return String(raw || '')
    .split(/\r?\n/)
    .filter((line) => !/^\s*\[[^\]]+\]\s*$/.test(line))
    .join('\n')
    .trim();
}

/* Replay SAN moves from the game's real start position. chess.js echoes its own
   header block, so any header line is stripped and the movetext kept. */
function movetextFromMoves(moves, initialFen) {
  const start = initialFen && initialFen !== 'start' ? initialFen : null;
  let chess;
  try {
    chess = start ? new Chess(start) : new Chess();
  } catch {
    return '';
  }
  for (const san of moves || []) {
    try { chess.move(san); } catch { break; }
  }
  return chess
    .pgn({ maxWidth: 0 })
    .split('\n')
    .filter((line) => !line.trim().startsWith('['))
    .join('\n')
    .trim();
}

/* Ensure the move text closes with exactly one result token. */
function withResult(body, result) {
  const text = String(body || '').trim();
  const stripped = text.replace(/\s*(?:1-0|0-1|1\/2-1\/2|\*)\s*$/, '').trim();
  return stripped ? `${stripped} ${result}` : result;
}

/**
 * Build a complete PGN: headers, one blank line, move text, result.
 *
 * @param {object} game
 * @param {string} [game.pgn]        original PGN (headers and/or movetext)
 * @param {string[]} [game.moves]    SAN moves; when present they are replayed
 *                                   and become the move text
 * @param {string} [game.initialFen] start position ('start' = standard)
 * @param {string} [game.white] [game.black]
 * @param {string|number} [game.whiteElo] [game.blackElo]
 * @param {string} [game.event] [game.site] [game.round]
 * @param {string|Date} [game.date]
 * @param {string} [game.result]     token or 'white'/'black'/'draw'
 * @param {string} [game.timeControl] [game.eco] [game.opening] [game.termination]
 * @param {string} [game.source]     'Chess.com' | 'Lichess' | 'Mate Zone'
 * @param {string} [game.link]      original game URL
 * @returns {string}
 */
export function buildFullPgn(game = {}) {
  if (!game) return '';
  const raw = String(game.pgn || '');
  const pairs = parseHeaders(raw);
  const lookup = new Map(pairs);
  const moves = Array.isArray(game.moves) ? game.moves.filter(Boolean) : [];

  const link = String(game.link || game.game_url || game.url || lookup.get('Link') || '').trim();
  const result = resultToken(game.result ?? lookup.get('Result'));
  const date = pgnDate(game.date ?? game.game_date ?? lookup.get('Date'));

  /* Source = the platform the game came from. An explicit value wins; otherwise
     derive it from the original URL (Link or Site). */
  let source = sourceSiteLabel(game.source);
  if (!source) source = platformLabel(link) || platformLabel(lookup.get('Site'));

  const provided = {
    Event: game.event ?? game.game_event ?? '',
    Site: game.site ?? '',
    Date: date,
    Round: game.round != null && game.round !== '' ? String(game.round) : '',
    White: game.white ?? game.white_name ?? '',
    Black: game.black ?? game.black_name ?? '',
    Result: result,
    WhiteElo: game.whiteElo ?? game.white_rating ?? '',
    BlackElo: game.blackElo ?? game.black_rating ?? '',
    TimeControl: game.timeControl ?? game.time_control ?? '',
    ECO: game.eco ?? '',
    Opening: game.opening ?? '',
    Termination: terminationLabel(game.termination),
    Source: source,
    Link: link,
  };

  const lines = [];
  const used = new Set();
  for (const name of SPEC_TAGS) {
    let value = provided[name];
    if (isBlank(value)) value = lookup.get(name);
    if (isBlank(value)) {
      if (name === 'Round') value = '-';
      else if (name === 'Result') value = result;
      /* Site: the original Site header wins (looked up above), then the game's
         own URL, and only a game born in this app is titled with its name. */
      else if (name === 'Site') value = link || SITE_NAME;
      else continue;
    }
    if (name === 'Result') value = resultToken(value);
    lines.push(`[${name} "${tag(value)}"]`);
    used.add(name);
  }

  /* Keep every tag the original PGN carried that is not part of the spec
     list (UTCDate, Time, GameId, WhiteTitle…). SetUp/FEN are emitted last. */
  for (const [name, value] of pairs) {
    if (used.has(name) || name === 'SetUp' || name === 'FEN') continue;
    if (isBlank(value)) continue;
    lines.push(`[${name} "${tag(value)}"]`);
    used.add(name);
  }

  const fen = game.initialFen && game.initialFen !== 'start'
    ? game.initialFen
    : (lookup.get('FEN') && lookup.get('FEN') !== 'start' ? lookup.get('FEN') : '');
  if (fen) {
    lines.push('[SetUp "1"]');
    lines.push(`[FEN "${tag(fen)}"]`);
  }

  const body = moves.length
    ? movetextFromMoves(moves, fen || 'start')
    : stripHeaders(raw);
  const movetext = withResult(body, result);

  return lines.length ? `${lines.join('\n')}\n\n${movetext}` : movetext;
}

/* Who sat White and who sat Black. The row already carries absolute side
   names for online games; computer games name the engine "Computer" (the
   stored `whiteName`/`blackName` use "Computer LvN", which we deliberately do
   not copy here). Falls back to the viewer's own name when the row only
   has a relative opponent. */
export function gamePlayerNames(g, userName) {
  const me = userName || 'You';
  if (g.type === 'computer') {
    return g.myColor === 'black'
      ? { white: 'Computer', black: me }
      : { white: me, black: 'Computer' };
  }
  if (g.whiteName && g.blackName) return { white: g.whiteName, black: g.blackName };
  const opp = g.opponentName || 'Opponent';
  return g.myColor === 'black'
    ? { white: opp, black: me }
    : { white: me, black: opp };
}

/* Result clause from the viewer's point of view. */
export function gameResult(g) {
  const label = g.resultLabel || '';
  if (label === 'Abandoned' || label === 'Aborted'
    || g.status === 'abandoned' || g.status === 'aborted'
    || g.result === 'abandoned') return '*';
  if (label.startsWith('Draw') || g.result === 'draw') return '1/2-1/2';
  const won = label.startsWith('Win') || g.mineWon === true;
  const lost = label.startsWith('Loss') || g.mineWon === false;
  const black = g.myColor === 'black';
  if (won) return black ? '0-1' : '1-0';
  if (lost) return black ? '1-0' : '0-1';
  return '*';
}

function gameTermination(g) {
  const reason = terminationLabel(g.resultReason);
  if (reason) return reason;
  const label = g.resultLabel || '';
  if (label === 'Abandoned' || label === 'Aborted') return label;
  if (label.startsWith('Draw')) return 'Draw agreed';
  /* Unknown — skip the tag rather than export an invented "Normal". */
  return '';
}

/* Does this row carry move text we can export? Mirrors the Moves column, which
   prints "—" when neither a PGN nor a move count was saved. */
export function hasPgnMoves(g) {
  return !!(g && g.pgn && g.pgn.trim());
}

/* Does this PGN contain any actual moves? Several stored rows (abandoned or
   aborted games, imports with only headers) hold a complete tag block but no
   movetext. Those must NOT be handed to the review parser — it correctly says
   "no moves to review" — the caller should fall back to the saved final FEN.
   The result is cached per PGN string because history tables ask for every row
   on each render/filter click. */
const moveCache = new Map();
export function pgnHasMoves(source) {
  const pgn = typeof source === 'string' ? source : source?.pgn;
  const raw = String(pgn || '').trim();
  if (!raw) return false;
  if (moveCache.has(raw)) return moveCache.get(raw);
  let has = false;
  try {
    const chess = new Chess();
    chess.loadPgn(raw, { strict: false });
    has = chess.history().length > 0;
  } catch {
    has = false;
  }
  if (moveCache.size > 500) moveCache.clear();
  moveCache.set(raw, has);
  return has;
}

/* Header fields for the classroom's shared board. There is no stored game row
   behind it, so the class IS the event and the instructor is the name the PGN
   can truthfully carry; both classroom copy buttons use this one definition. */
export function classroomPgnMeta(classMeta) {
  return {
    event: classMeta?.title ? `Live Classroom — ${classMeta.title}` : 'Live Classroom',
    date: classMeta?.scheduledDate || '',
    white: classMeta?.instructorName || '',
    black: classMeta?.instructorName ? 'Classroom' : '',
    source: SITE_NAME,
  };
}

/* Build a portable PGN from a normalised game object (profile field names —
   `white_name`, `white_rating`, `game_url`, `eco`, …), its SAN `moves`, and
   the `initialFen` it starts from ('start' for the standard position). This is
   the export the game viewer copies, so it must survive a re-import. */
export function buildGamePgn({ game, moves = [], initialFen = 'start' } = {}) {
  if (!game) return '';
  const link = game.game_url || game.url || '';
  return buildFullPgn({
    pgn: game.pgn,
    moves,
    initialFen,
    white: game.white_name ?? game.white,
    black: game.black_name ?? game.black,
    whiteElo: game.white_rating ?? game.whiteElo,
    blackElo: game.black_rating ?? game.blackElo,
    event: game.game_event || game.event
      || (game.platform ? `${platformLabel(game.platform) || 'Online'} game` : 'Casual Game'),
    date: game.game_date || game.date,
    result: game.result,
    timeControl: game.time_control || game.timeControl,
    eco: game.eco,
    opening: game.opening,
    termination: game.termination || game.result_reason || game.resultReason,
    link,
    /* An imported profile game always has its URL; a stored app game does not.
       The site label names where the PGN actually came from; "Mate Zone" is the
       truthful source only for a game with no original link. */
    source: link ? (platformLabel(game.platform) || sourceSiteLabel(link)) : 'Mate Zone',
  });
}

/* Full PGN for one Game History ROW, whose fields are viewer-relative
   camelCase (`myColor`, `opponentName`, `whiteName`, `resultLabel`, `pgn`).
   `userName` is the viewer's name, used when the row only names the opponent. */
export function buildRowPgn(g, userName) {
  if (!g) return '';
  const { white, black } = gamePlayerNames(g, userName);
  /* Tournament rows carry the viewer's pre-game rating and the opponent's, not
     a white/black pair; the side each one sat is `myColor`. */
  const mine = g.ratingBefore;
  const theirs = g.opponentRating;
  const whiteElo = g.whiteElo ?? (g.myColor === 'white' ? mine : theirs);
  const blackElo = g.blackElo ?? (g.myColor === 'black' ? mine : theirs);
  return buildFullPgn({
    pgn: g.pgn,
    white,
    black,
    whiteElo,
    blackElo,
    event: g.tournamentName
      || (g.type === 'computer' ? 'Vs Computer'
        : g.type === 'online' ? 'Online Game'
          : g.type === 'tournament' ? 'Tournament' : 'Casual Game'),
    round: g.roundNo ?? null,
    date: g.date,
    result: gameResult(g),
    termination: gameTermination(g),
    source: SITE_NAME,
  });
}

/* White_vs_Black_YYYY-MM-DD.pgn for the optional download. */
export function pgnFilename(g, userName) {
  const { white, black } = gamePlayerNames(g, userName);
  const date = (pgnDate(g.date) || 'unknown-date').replace(/\./g, '-');
  const safe = (s) => String(s).replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '') || 'Player';
  return `${safe(white)}_vs_${safe(black)}_${date}.pgn`;
}
