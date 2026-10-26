import { Chess } from 'chess.js';

/* Replay a list of SAN moves into a FEN. Returns the start FEN when moves are empty. */
export function movesToFen(moves, startFen) {
  const game = new Chess(startFen || undefined);
  for (const san of moves || []) {
    try {
      game.move(san);
    } catch {
      break;
    }
  }
  return game.fen();
}

/* Parse a raw moves string like "1.e4 e5 2.Nf3 Nc6 1-0" into bare SAN tokens. */
export function parseMovesInput(text) {
  return String(text || '')
    .replace(/1-0|0-1|1\/2-1\/2|\*/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((tok) => tok.replace(/[.…]/g, '').trim())
    .filter((tok) => !/^\d+$/.test(tok));
}

/* Validate + canonicalise a moves list. Throws on illegal moves. Returns SAN strings. */
export function canonicalMoves(moves) {
  const game = new Chess();
  const out = [];
  for (const raw of moves) {
    try {
      const m = game.move(raw);
      if (!m) throw new Error('illegal');
      out.push(m.san);
    } catch {
      throw new Error(`Invalid move '${raw}' — check the notation.`);
    }
  }
  return out;
}

export function timeAgo(iso) {
  if (!iso) return 'recently';
  const delta = Date.now() - new Date(iso).getTime();
  const m = Math.floor(delta / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

/* Stable per-browser session id for polls (kept in localStorage). */
export function getSessionId() {
  let sid = localStorage.getItem('openings_session_id');
  if (!sid) {
    sid = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem('openings_session_id', sid);
  }
  return sid;
}