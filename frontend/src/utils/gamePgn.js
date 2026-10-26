import { Chess } from 'chess.js';
import { APP_NAME } from '../config/brand';

/* Build a portable PGN for one Game History row.
 *
 * The stored `pgn` column holds SAN movetext (what chess.js `game.pgn()`
 * writes), so it is replayed into a fresh Chess instance to normalise the
 * move text and to lay our own header block over it. Headers are written by
 * hand rather than through chess.js so the tag order matches the spec the
 * caller asked for — chess.js would otherwise drop `Termination` after the
 * supplemental tags.
 *
 * Result is always stated from the VIEWER's point of view (the row is theirs):
 *   Win as White → 1-0 · Win as Black → 0-1 · Draw → 1/2-1/2 · abandoned → *.
 */

const SITE_NAME = APP_NAME;

/* Escape a PGN tag value: backslash and double quote are the only characters
   the spec requires to be escaped inside a tag pair. */
function tag(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/* `YYYY.MM.DD` from the game's timestamp, per the PGN Date tag. A `YYYY-MM-DD`
   string is read literally so a UTC-midnight date cannot slide to the previous
   day in a timezone behind UTC. */
function pgnDate(value) {
  const literal = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (literal) return `${literal[1]}.${literal[2]}.${literal[3]}`;
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return '????.??.??';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}.${m}.${day}`;
}

/* Who sat White and who sat Black. The row already carries absolute side
   names for online games; computer games name the engine "Computer" (the
   stored `whiteName`/`blackName` use "Computer LvN", which we deliberately
   do not copy here). Falls back to the viewer's own name when the row only
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
  switch (g.resultReason) {
    case 'checkmate': return 'Checkmate';
    case 'resignation': return 'Resignation';
    case 'agreement':
    case 'stalemate':
    case 'repetition':
    case 'fifty-move':
    case 'insufficient': return 'Draw agreed';
    case 'timeout': return 'Abandoned';
    default: break;
  }
  const label = g.resultLabel || '';
  if (label === 'Abandoned' || label === 'Aborted') return 'Abandoned';
  if (label.startsWith('Draw')) return 'Draw agreed';
  return 'Normal';
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

/* Result TOKEN from a stored result value. The platform importers store
   absolute sides ('white'/'black') or 'draw'; anything else (null, '', an
   adjourned game) exports as '*' rather than a guess. */
function resultTokenFromStored(stored) {
  if (stored === 'white') return '1-0';
  if (stored === 'black') return '0-1';
  if (stored === 'draw') return '1/2-1/2';
  return '*';
}

/* Build a portable PGN from a game's own record: the normalised game object
   (profile field names — `white_name`, `white_rating`, `game_url`, `eco`, …),
   its SAN `moves`, and the `initialFen` it starts from ('start' for the
   standard position). This is the export the game viewer copies, so it must
   survive a re-import: full tag pairs, the ECO/Opening tags, and — for a game
   that did not start from the standard position — the [SetUp]/[FEN] header the
   move list needs to be legal when pasted into Chess.com / Lichess / ChessBase.
   The movetext is replayed (not echoed) so every move is re-validated. */
export function buildGamePgn({ game, moves = [], initialFen = 'start' } = {}) {
  if (!game) return '';
  const startFen = initialFen && initialFen !== 'start' ? initialFen : null;
  const chess = startFen ? new Chess(startFen) : new Chess();
  for (const san of moves || []) {
    try { chess.move(san); } catch { break; }
  }
  const result = resultTokenFromStored(game.result);
  chess.setHeader('Result', result);

  /* `maxWidth: 0` keeps the movetext on one line; chess.js may also echo the
     [SetUp]/[FEN] headers it inferred, so any header line is stripped and the
     block is rewritten below in the tag order we want. */
  const movetext = chess
    .pgn({ maxWidth: 0 })
    .split('\n')
    .filter((line) => !line.trim().startsWith('['))
    .join('\n')
    .trim();

  const lines = [
    `[Event "${tag(game.event || (game.platform ? `${game.platform} game` : 'Casual Game'))}"]`,
    `[Site "${tag(game.game_url || '')}"]`,
    `[Date "${tag(pgnDate(game.game_date || game.date))}"]`,
    '[Round "-"]',
    `[White "${tag(game.white_name || 'White')}"]`,
    `[Black "${tag(game.black_name || 'Black')}"]`,
    `[Result "${tag(result)}"]`,
  ];
  if (game.white_rating) lines.push(`[WhiteElo "${tag(game.white_rating)}"]`);
  if (game.black_rating) lines.push(`[BlackElo "${tag(game.black_rating)}"]`);
  if (game.eco) lines.push(`[ECO "${tag(game.eco)}"]`);
  if (game.opening) lines.push(`[Opening "${tag(game.opening)}"]`);
  if (startFen) {
    lines.push('[SetUp "1"]');
    lines.push(`[FEN "${tag(startFen)}"]`);
  }

  const header = lines.join('\n');
  const body = movetext || result;
  return `${header}\n\n${body}`;
}

/* Legacy: full PGN (headers + SAN movetext + result) for one Game History ROW,
   whose fields are viewer-relative camelCase (`myColor`, `opponentName`,
   `whiteName`, `resultLabel`, `pgn`). `userName` is the viewer's name, used
   when the row only names the opponent. */
export function buildRowPgn(g, userName) {
  if (!g) return '';
  const { white, black } = gamePlayerNames(g, userName);
  const result = gameResult(g);

  const chess = new Chess();
  if (hasPgnMoves(g)) {
    try {
      chess.loadPgn(g.pgn.trim());
    } catch {
      /* Unparseable move text — fall back to a headers-only PGN rather than
         throwing at the call site. */
    }
  }
  chess.setHeader('Result', result);

  /* `maxWidth: 0` keeps the movetext on one line; the header block is stripped
     out and rewritten below in the tag order we want. */
  const movetext = chess
    .pgn({ maxWidth: 0 })
    .split('\n')
    .filter((line) => !line.trim().startsWith('['))
    .join('\n')
    .trim();

  const lines = [
    `[Event "${tag(g.type === 'computer' ? 'Vs Computer' : 'Casual Game')}"]`,
    `[Site "${tag(SITE_NAME)}"]`,
    `[Date "${tag(pgnDate(g.date))}"]`,
    '[Round "-"]',
    `[White "${tag(white)}"]`,
    `[Black "${tag(black)}"]`,
    `[Result "${tag(result)}"]`,
    `[Termination "${tag(gameTermination(g))}"]`,
  ];
  if (g.whiteElo) lines.push(`[WhiteElo "${tag(g.whiteElo)}"]`);
  if (g.blackElo) lines.push(`[BlackElo "${tag(g.blackElo)}"]`);

  const header = lines.join('\n');
  const body = movetext || result;
  return `${header}\n\n${body}`;
}

/* White_vs_Black_YYYY-MM-DD.pgn for the optional download. */
export function pgnFilename(g, userName) {
  const { white, black } = gamePlayerNames(g, userName);
  const date = pgnDate(g.date).replace(/\./g, '-');
  const safe = (s) => String(s).replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '') || 'Player';
  return `${safe(white)}_vs_${safe(black)}_${date}.pgn`;
}
