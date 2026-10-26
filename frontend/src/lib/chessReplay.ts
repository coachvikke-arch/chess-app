import { Chess } from 'chess.js';

export type GmGame = {
  id: string;
  white: string;
  black: string;
  event: string;
  year: number;
  result: string;
  pgn: string;
  annotations: GameAnnotation[];
  source: string;
};

export type ReplayMove = {
  ply: number;
  moveNumber: number;
  color: 'w' | 'b';
  san: string;
  from: string;
  to: string;
  fen: string;
  lastMove: [string, string] | null;
};

export type GameAnnotation = { moveNumber: number; comment: string };

/* Replays a game's SAN moves from `startFen` ('start' = standard position).
 * The FEN must be the game's REAL origin (resolveInitialFen): replaying a
 * setup game from the standard position silently produces wrong positions. */
export function parsePgnReplay(pgn: string, startFen: string = 'start'): ReplayMove[] {
  const source = new Chess();
  source.loadPgn(pgn);
  const history = source.history({ verbose: true });
  const replay = new Chess(startFen === 'start' ? undefined : startFen);
  return history.map((move, index) => {
    const played = replay.move(move.san);
    if (!played) throw new Error(`Unable to replay SAN move: ${move.san}`);
    return {
      ply: index + 1,
      moveNumber: Math.floor(index / 2) + 1,
      color: played.color,
      san: played.san,
      from: played.from,
      to: played.to,
      fen: replay.fen(),
      lastMove: [played.from, played.to] as [string, string],
    };
  });
}

export function getReplayStartFen() {
  return new Chess().fen();
}

export function annotationForPly(annotation: GameAnnotation | undefined, ply: number) {
  if (!annotation) return null;
  const firstPly = (annotation.moveNumber - 1) * 2 + 1;
  return ply === firstPly || ply === firstPly + 1 ? annotation : null;
}

/** True when the side to move in `fen` is checkmated, i.e. the game ended here.
 *
 *  The engine cannot answer this itself: a finished position has no legal
 *  moves, so `searchTopMoves` returns [] and the mating move arrives with no
 *  score at all. The rules can, which is why the replay checks the FEN rather
 *  than relying on the engine for the one position the engine cannot search. */
export function isCheckmatePosition(fen: string): boolean {
  try {
    return new Chess(fen).isCheckmate();
  } catch {
    return false;
  }
}

export type GameEnd = {
  /** "1-0" | "0-1" | "1/2-1/2" | "*" - the PGN result token, normalised. */
  result: string;
  /** Who won, as a score-sheet headline. "White" | "Black" | "Draw" | "Unknown". */
  winner: 'White' | 'Black' | 'Draw' | 'Unknown';
  /** Why it ended, e.g. "by checkmate". "" when the PGN does not say. */
  reason: string;
  /** One line for the header: "White won by checkmate". */
  headline: string;
  /** How the reason was established, for the tooltip. */
  confidence: 'rules' | 'pgn' | 'result-only';
};

/** Reads a `[Tag "Value"]` header out of a raw PGN. Case-insensitive on the
 *  tag name; the value may carry surrounding quotes. */
function pgnTag(pgn: string, tag: string): string {
  const m = pgn.match(new RegExp(`\\[\\s*${tag}\\s*"([^"]*)"\\s*\\]`, 'i'));
  return m ? m[1].trim() : '';
}

/** Halfmove clock = the 5th FEN field. 100 plies (50 moves each) is the
 *  fifty-move rule. chess.js 1.4 exposes no direct predicate for this, so it is
 *  read straight off the FEN rather than guessed. */
function halfmoveClock(fen: string): number {
  const parts = fen.split(' ');
  const n = Number(parts[4]);
  return Number.isFinite(n) ? n : 0;
}

/**
 * How a provider's `Termination` tag should read in a sentence.
 *
 * These tags are not reasons, they are whole clauses, and pasting one straight
 * into a headline produces nonsense. Real examples:
 *   "m0nk3ym4t3 won - game abandoned"  -> "abandonment"
 *   "Time forfeit"                     -> "a time forfeit"
 *   "Rules infraction"                 -> "a rules infraction"
 *   "50 move rule"                     -> "the fifty-move rule"
 *   "Normal"                           -> "" (no information at all)
 *
 * A player name in front of the dash says nothing the result token does not
 * already say, and repeating it reads as a stutter: "Black won by m0nk3ym4t3
 * won - game abandoned". So the "<player> won - " clause is dropped.
 *
 * Returns "" for "normal" and for anything empty, meaning "the PGN does not say".
 * An unrecognised value is returned lowercased and de-punctuated rather than
 * discarded, so a genuine reason is never lost just because it is unfamiliar.
 */
const TERMINATION_PHRASES: Record<string, string> = {
  abandoned: 'abandonment',
  'game abandoned': 'abandonment',
  'time forfeit': 'a time forfeit',
  timeout: 'a time forfeit',
  'rules infraction': 'a rules infraction',
  cheating: 'cheating',
  'time win': 'on time',
  'on time': 'on time',
  resignation: 'resignation',
  resigned: 'resignation',
  checkmate: 'checkmate',
  stalemate: 'stalemate',
  'insufficient material': 'insufficient material',
  '50 move rule': 'the fifty-move rule',
  'fifty move rule': 'the fifty-move rule',
  'threefold repetition': 'threefold repetition',
  'draw by agreement': 'agreement',
  agreement: 'agreement',
};

function normaliseTermination(term: string): string {
  const stripped = (term || '')
    .trim()
    /* Drop a leading "<player> won ..." clause. Chess.com uses BOTH shapes:
         "m0nk3ym4t3 won - game abandoned"   (dashed)
         "andresmanquepierda won by resignation"  (by-phrase)
       and the reason is what follows either way. The separator is REQUIRED
       except at end-of-string, because making it optional would make the verb
       match the "forfeit" in "Time forfeit" and delete the whole reason -
       turning a real reason into no reason at all. */
    .replace(/^.*?\b(?:won|lost|drawn)\s*(?:\s*-\s*|\s+by\s+|$)/i, '')
    .replace(/\.$/, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  if (!stripped || stripped === 'normal') return '';
  return TERMINATION_PHRASES[stripped] || stripped;
}

/**
 * How the game ended, as a score sheet would state it.
 *
 * The PGN `Result` token says WHO won but never WHY ("1-0" covers checkmate,
 * resignation, time forfeit and everything else). Chess.com's own `Termination`
 * tag is no better - it is "Normal" for an ordinary win and carries no tactical
 * detail.
 *
 * So the reason is derived from the RULES of the final position first, which is
 * authoritative and needs no metadata:
 *   - mate / stalemate / insufficient material are single FEN checks
 *   - threefold repetition needs the whole game, so the moves are replayed
 *   - the fifty-move rule comes from the halfmove clock
 * Anything still unexplained falls back to the provider's `Termination` tag and
 * then to the result alone, and `confidence` records which of those happened so
 * the UI never overstates what it knows.
 *
 * `moves` may be either the replay list (`ReplayMove[]`, from
 * `parsePgnReplay`) or a bare array of SAN strings (from `pgnTools.parsePgn`),
 * because two different viewers parse PGNs independently and both need this.
 * Only `.san` is read, so the final FEN is re-derived here by replaying rather
 * than trusted from the caller.
 *
 * `startFen` matters for games that do not begin from the standard position:
 * replaying those from the wrong origin either throws or, worse, silently
 * produces a legal-but-meaningless game whose final position would then be
 * reported as the real ending.
 */
export function describeGameEnd(
  result: string | undefined,
  pgn: string,
  moves: Array<ReplayMove | string>,
  startFen?: string | null,
): GameEnd {
  const raw = (result || '').trim();
  const norm = raw === '1-0' || raw === '0-1' || raw === '1/2-1/2' ? raw : '*';
  const winner: GameEnd['winner'] =
    norm === '1-0' ? 'White' : norm === '0-1' ? 'Black' : norm === '1/2-1/2' ? 'Draw' : 'Unknown';

  const fallback = (reason: string, confidence: GameEnd['confidence']): GameEnd => ({
    result: norm,
    winner,
    reason,
    headline: winner === 'Unknown'
      ? `Result ${norm}`
      : winner === 'Draw'
        ? `Draw${reason ? ` ${reason}` : ''}`
        : `${winner} won${reason ? ` ${reason}` : ''}`,
    confidence,
  });

  const sans = (moves || [])
    .map((m) => (typeof m === 'string' ? m : m?.san))
    .filter((s): s is string => typeof s === 'string' && s.length > 0);

  /* Replay once and reuse the position for every rules-based check. */
  let end: Chess | null = null;
  if (sans.length) {
    try {
      const origin = startFen && startFen !== 'start' ? startFen : undefined;
      const played = new Chess(origin);
      let complete = true;
      for (const san of sans) {
        if (!played.move(san)) { complete = false; break; }
      }
      /* Only assert a rules-based reason from a game that replayed IN FULL. A
         partial replay lands on some mid-game position, and calling that "the
         final position" would state a confident, wrong ending. */
      if (complete) end = played;
    } catch {
      end = null;
    }
  }

  if (end) {
    /* 1. The rules of the final position. Authoritative when they apply. */
    if (end.isCheckmate()) {
      /* The side to move in a mate has been mated, so the OTHER side won. */
      const mated = end.turn() === 'w' ? 'White' : 'Black';
      const won = mated === 'White' ? 'Black' : 'White';
      return {
        result: norm,
        winner: won as GameEnd['winner'],
        reason: 'by checkmate',
        headline: `${won} won by checkmate`,
        confidence: 'rules',
      };
    }
    if (end.isStalemate()) return fallback('by stalemate', 'rules');
    if (end.isInsufficientMaterial()) return fallback('by insufficient material', 'rules');

    /* 2. Threefold repetition - history is right there on the replayed game. */
    if (end.isThreefoldRepetition()) return fallback('by threefold repetition', 'rules');

    /* 3. Fifty-move rule, straight off the clock. */
    if (halfmoveClock(end.fen()) >= 100) return fallback('by the fifty-move rule', 'rules');
  }

  /* No usable position - either there were no moves, or they did not replay.
     That disables only the RULES path; the PGN's own Termination tag is still
     good evidence and is consulted below rather than discarded with the moves. */
  return metadataFallback();

  /** Fall back to the PGN's own metadata, then to the bare result. */
  function metadataFallback(): GameEnd {
    const phrase = normaliseTermination(pgnTag(pgn, 'Termination'));
    if (phrase) return fallback(`by ${phrase}`, 'pgn');
    /* A decisive result with no derivable reason is usually a resignation, but
       that is an inference, not a fact - so no reason is asserted. */
    return fallback('', 'result-only');
  }
}

const PIECE_NAMES: Record<string, string> = {
  K: 'king',
  Q: 'queen',
  R: 'rook',
  B: 'bishop',
  N: 'knight',
  P: 'pawn',
};

type MoveLike = { san: string; color: 'w' | 'b'; moveNumber: number; to: string };

/** A short description of one scored move, with the REASON/plan behind it —
    shown on the replay note card for EVERY ply. `prevFen` is the position the
    move is played from, used to know exactly which piece got captured. */
export function describeMove(move: MoveLike, prevFen: string | null): string {
  const { san, color } = move;
  const side = color === 'w' ? 'White' : 'Black';
  const mate = san.includes('#');
  const check = san.endsWith('+') || mate;
  const clean = san.replace(/[+#]/g, '');

  if (clean === 'O-O') {
    return `${side} castles kingside, tucking the king to safety and linking the rooks. The king leaves the center behind before it can become a target.`;
  }
  if (clean === 'O-O-O') {
    return `${side} castles queenside, sheltering the king and activating the rook toward the center — a single move that improves safety and development at once.`;
  }

  const promotion = clean.match(/=([QRBN])$/)?.[1] ?? null;
  const body = promotion ? clean.replace(/=[QRBN]$/, '') : clean;
  const dest = body.match(/([a-h][1-8])$/)?.[1] ?? '';
  const capture = body.includes('x');
  const piece = (body.match(/^([KQRBN])/)?.[1] ?? 'P') as keyof typeof PIECE_NAMES;
  const pieceName = PIECE_NAMES[piece];

  let capturedType: keyof typeof PIECE_NAMES | null = null;
  if (capture && prevFen && dest) {
    try {
      const square = new Chess(prevFen).get(dest);
      if (square) capturedType = square.type.toUpperCase() as keyof typeof PIECE_NAMES;
    } catch {
      /* a malformed FEN just means we skip the "what was captured" detail */
    }
  }

  let text: string;
  if (piece === 'P') {
    const file = dest ? `${dest[0]}-` : '';
    text = capture
      ? `${side}'s ${file}pawn captures on ${dest}`
      : `${side} advances the ${file}pawn to ${dest}`;
  } else {
    text = capture
      ? `${side}'s ${pieceName} captures on ${dest}`
      : `${side} moves the ${pieceName} to ${dest}`;
  }
  if (promotion) {
    text = `${side} promotes a pawn to a ${PIECE_NAMES[promotion]} on ${dest}`;
  }
  if (mate) {
    return `${text}. Checkmate — the position is decisive and the game ends.`;
  }
  text += '.';

  if (promotion) {
    text += ` Rushing the pawn up the board — if it survives, the new ${PIECE_NAMES[promotion]} takes over the game.`;
  } else if (check) {
    text += ' It checks the opposing king, forcing the opponent to respond immediately.';
  } else if (capture && capturedType) {
    const capturedName = PIECE_NAMES[capturedType];
    if (capturedType === 'Q') text += ` Removing the opponent's queen — the greatest possible material gain.`;
    else if (capturedType === 'K') text += ` Taking the king would end the game, so the position demands an answer.`;
    else if (capturedType === 'R') text += ` Winning a whole rook is a serious swing in the material balance.`;
    else if (capturedType === 'B' || capturedType === 'N') text += ` Gaining a minor piece, a clear advantage worth defending.`;
    else text += ` Gaining a pawn — small, but every scrap of material matters.`;
  } else if (move.moveNumber <= 8) {
    if (piece === 'N') text += ` A developing move: the knight heads toward the center where it controls the most useful squares.`;
    else if (piece === 'B') text += ` A developing move: the bishop takes a long diagonal and helps contest the center.`;
    else if (piece === 'Q') text += ` The queen joins the fight early. Powerful, but it must watch out for cheap harassment from lighter pieces.`;
    else if (piece === 'R') text += ` The rook finds a lane, ready to matter once the files open up.`;
    else if (piece === 'P') text += ` A center-first move: it stakes out space and opens a clear path for the pieces behind it.`;
    else text += ` A developing move that keeps the king's position flexible.`;
  } else {
    if (piece === 'N') text += ` The knight is repositioned — usually toward a better outpost or a future fork.`;
    else if (piece === 'B') text += ` The bishop shifts to a better diagonal; a quiet move that changes which squares are weak.`;
    else if (piece === 'R') text += ` The rook takes control of an important file or rank — often the simplest source of pressure.`;
    else if (piece === 'Q') text += ` The queen joins the attack, hunting for a weakness in the opposing camp.`;
    else if (piece === 'P') text += ` Pushing the pawn gains space and can suddenly leave an opponent's piece short of squares.`;
    else text += ` The king improves its safety and moves toward the action in the endgame.`;
  }
  return text;
}

export function gameTitle(game: { white: string; black: string }) {
  return `${game.white} vs ${game.black}`;
}
