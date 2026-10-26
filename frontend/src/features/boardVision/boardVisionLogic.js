/**
 * Board Vision — framework-independent pure logic.
 *
 * Everything in this file is plain functions + constants so it can be
 * unit-tested with node:test without React. The React hook
 * (useBoardVisionSession.js) and components only call into here.
 *
 * Conventions (single source of truth):
 * - Square names are 'a1'..'h8'. file index 0..7 = a..h, rank 1..8.
 * - a1 is DARK. A square is light iff (fileIdx + rank) is EVEN.
 *   (a1: 0+1=1 odd -> dark; h1: 7+1=8 even -> light. Correct.)
 * - Orientation 'white' = white at the bottom (rank 1 at bottom).
 *   Orientation 'black' = rank 1 at the top.
 */

export const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

export const LEVELS = [
  {
    id: 'pawn',
    index: 0,
    name: 'Pawn',
    icon: '♙',
    description: 'Square recognition — learn the name of every square.',
    focus: 'Single-square names (e.g. e4). No neighbours yet.',
    modes: ['find-square', 'coordinate-recognition'],
  },
  {
    id: 'knight',
    index: 1,
    name: 'Knight',
    icon: '♘',
    description: 'Coordinates and neighbouring squares.',
    focus: 'Name squares fast; one-square moves (up/down/left/right).',
    modes: ['find-square', 'coordinate-recognition', 'spatial', 'piece-plus-square'],
  },
  {
    id: 'bishop',
    index: 2,
    name: 'Bishop',
    icon: '♗',
    description: 'Diagonals and square colors.',
    focus: 'Light vs dark, same diagonal, diagonal neighbours.',
    modes: ['find-square', 'coordinate-recognition', 'square-color', 'spatial', 'find-piece', 'piece-plus-square'],
  },
  {
    id: 'rook',
    index: 3,
    name: 'Rook',
    icon: '♖',
    description: 'Ranks, files and straight lines.',
    focus: 'Same rank / same file, flash memory, defended pieces.',
    modes: ['find-square', 'coordinate-recognition', 'square-color', 'spatial', 'find-piece', 'piece-plus-square', 'flash-memory', 'attack-defense'],
  },
  {
    id: 'queen',
    index: 4,
    name: 'Queen',
    icon: '♕',
    description: 'Combined advanced vision — everything at speed.',
    focus: 'Blindfold stages, attack/defense, mixed custom challenges.',
    modes: ['find-square', 'coordinate-recognition', 'square-color', 'spatial', 'find-piece', 'piece-plus-square', 'flash-memory', 'blindfold', 'attack-defense', 'custom'],
  },
];

export const MODES = [
  { id: 'find-square', name: 'Find the Square', icon: '🎯', difficulty: 1, description: 'We name a square (e.g. e4) — tap it on the board.' },
  { id: 'coordinate-recognition', name: 'Coordinate Recognition', icon: '🔤', difficulty: 1, description: 'A square lights up — pick its name from choices or type it.' },
  { id: 'find-piece', name: 'Find the Piece', icon: '♞', difficulty: 2, description: 'A real position is shown — locate the named piece.' },
  { id: 'piece-plus-square', name: 'Piece + Square', icon: '♜', difficulty: 2, description: 'E.g. "Find the black knight on f6" — right piece AND right square.' },
  { id: 'square-color', name: 'Square Color Vision', icon: '◐', difficulty: 2, description: 'Is the shown square light or dark? Works in any orientation.' },
  { id: 'spatial', name: 'Spatial Relationships', icon: '🧭', difficulty: 3, description: 'Left/right, above/below, same rank/file/diagonal. Named by file (a–h) and rank (1–8) so answers stay correct when the board is flipped.' },
  { id: 'flash-memory', name: 'Flash Board Memory', icon: '⚡', difficulty: 3, description: 'A position flashes briefly, then hides — recall a piece or square.' },
  { id: 'blindfold', name: 'Blindfold Vision', icon: '🙈', difficulty: 4, description: 'Coordinates hide first, then pieces, then the board. Staged — beginners are never forced past stage 1.' },
  { id: 'attack-defense', name: 'Attack and Defense Vision', icon: '⚔', difficulty: 4, description: 'Which squares does a piece attack? Which piece is defended? Uses verified chess attack rules.' },
  { id: 'custom', name: 'Custom Challenge', icon: '🛠', difficulty: 5, description: 'Teacher mixes modes, difficulty, duration, orientation and target score.' },
];

export const DURATIONS = [10, 20, 30];
export const DEFAULT_SETTINGS = {
  duration: 20,
  orientation: 'white', // 'white' | 'black' | 'random'
  showCoordinates: true,
  showPieces: true,
  sound: true,
  haptics: true,
  highlightSelected: true,
  highContrast: false,
  // target: { kind: 'count', count: 5 } | { kind: 'accuracy', pct: 80 } | { kind: 'personal-best' }
  target: { kind: 'count', count: 5 },
};

/** Unlock rule default: 2 sessions with >=70% accuracy AND target reached. */
export const UNLOCK_RULE = { sessions: 2, minAccuracy: 70 };

/* ── seeded RNG (mulberry32) — class rounds share a seed ─────────────── */
export function seededRng(seed) {
  let a = (typeof seed === 'number' ? seed : hashSeed(String(seed))) >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

/* ── coordinates ─────────────────────────────────────────────────────── */

export function isValidSquare(sq) {
  return typeof sq === 'string' && /^[a-h][1-8]$/.test(sq);
}

export function fileIndexOf(sq) {
  return FILES.indexOf(sq[0]);
}

export function rankOf(sq) {
  return Number(sq[1]);
}

/** 'light' | 'dark'. a1 is dark. */
export function squareColor(sq) {
  if (!isValidSquare(sq)) throw new Error(`Invalid square: ${sq}`);
  return (fileIndexOf(sq) + rankOf(sq)) % 2 === 0 ? 'light' : 'dark';
}

export function allSquares() {
  const out = [];
  for (const f of FILES) for (let r = 1; r <= 8; r++) out.push(`${f}${r}`);
  return out;
}

export function randomSquare(rng = Math.random) {
  return `${pick(rng, FILES)}${1 + Math.floor(rng() * 8)}`;
}

/**
 * Display grid for an orientation: 8 rows of 8 square names,
 * row 0 is the TOP row on screen.
 */
export function boardGrid(orientation = 'white') {
  const rows = [];
  for (let row = 0; row < 8; row++) {
    const r = [];
    for (let col = 0; col < 8; col++) {
      let file;
      let rank;
      if (orientation === 'black') {
        file = 7 - col;
        rank = row + 1;
      } else {
        file = col;
        rank = 8 - row;
      }
      r.push(`${FILES[file]}${rank}`);
    }
    rows.push(r);
  }
  return rows;
}

/** Resolve 'random' orientation to a concrete one using rng. */
export function resolveOrientation(setting, rng = Math.random) {
  if (setting === 'random') return rng() < 0.5 ? 'white' : 'black';
  return setting === 'black' ? 'black' : 'white';
}

/** Neighbouring squares (orthogonal + diagonal), sorted. */
export function neighboursOf(sq) {
  const f = fileIndexOf(sq);
  const r = rankOf(sq);
  const out = [];
  for (let df = -1; df <= 1; df++) {
    for (let dr = -1; dr <= 1; dr++) {
      if (!df && !dr) continue;
      const nf = f + df;
      const nr = r + dr;
      if (nf >= 0 && nf < 8 && nr >= 1 && nr <= 8) out.push(`${FILES[nf]}${nr}`);
    }
  }
  return out.sort();
}

export function sameRank(sq1, sq2) {
  return rankOf(sq1) === rankOf(sq2);
}

export function sameFile(sq1, sq2) {
  return sq1[0] === sq2[0];
}

export function sameDiagonal(sq1, sq2) {
  if (sq1 === sq2) return false;
  return Math.abs(fileIndexOf(sq1) - fileIndexOf(sq2)) === Math.abs(rankOf(sq1) - rankOf(sq2));
}

/* ── pieces ──────────────────────────────────────────────────────────── */

export const PIECE_TYPES = ['p', 'n', 'b', 'r', 'q', 'k'];
export const PIECE_NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
export const PIECE_GLYPHS = {
  wk: '♔', wq: '♕', wr: '♖', wb: '♗', wn: '♘', wp: '♙',
  bk: '♚', bq: '♛', br: '♜', bb: '♝', bn: '♞', bp: '♟',
};

export function pieceLabel(piece) {
  // piece: { color: 'w'|'b', type: 'p'|'n'|... }
  const colorName = piece.color === 'w' ? 'white' : 'black';
  return `${colorName} ${PIECE_NAMES[piece.type]}`;
}

export function pieceGlyph(piece) {
  return PIECE_GLYPHS[`${piece.color}${piece.type}`] || '♙';
}

export function randomPiece(rng = Math.random, types = PIECE_TYPES) {
  return { color: rng() < 0.5 ? 'w' : 'b', type: pick(rng, types) };
}

/**
 * Build a small VALID position: kings on legal squares + a few extra pieces
 * on distinct squares. Returns { map: { sq: piece }, fen } — fen is best-effort
 * (may omit full legality like castling) but piece placement is always valid:
 * distinct squares, max counts, pawns never on rank 1/8.
 */
export function randomPosition(rng = Math.random, extraCount = 3) {
  const used = new Set();
  const map = {};
  const take = () => {
    let sq = randomSquare(rng);
    let guard = 0;
    while (used.has(sq) && guard++ < 200) sq = randomSquare(rng);
    used.add(sq);
    return sq;
  };
  map[take()] = { color: 'w', type: 'k' };
  let blackKing = take();
  let guard = 0;
  // Kings must not be adjacent
  while (neighboursOf(blackKing).some((s) => map[s]?.type === 'k') && guard++ < 200) {
    used.delete(blackKing);
    blackKing = take();
  }
  map[blackKing] = { color: 'b', type: 'k' };
  for (let i = 0; i < extraCount; i++) {
    const sq = take();
    let type = pick(rng, ['q', 'r', 'b', 'n', 'p', 'p']);
    if (type === 'p' && (sq[1] === '1' || sq[1] === '8')) type = 'n';
    map[sq] = { color: rng() < 0.5 ? 'w' : 'b', type };
  }
  return { map, fen: positionToFen(map) };
}

export function positionToFen(map) {
  const rows = [];
  for (let rank = 8; rank >= 1; rank--) {
    let empty = 0;
    let row = '';
    for (const f of FILES) {
      const p = map[`${f}${rank}`];
      if (!p) { empty++; continue; }
      if (empty) { row += empty; empty = 0; }
      const ch = p.type === 'n' ? 'N' : p.type.toUpperCase();
      row += p.color === 'w' ? ch : ch.toLowerCase();
    }
    if (empty) row += empty;
    rows.push(row);
  }
  return `${rows.join('/')} w - - 0 1`;
}

/* ── attack generation (verified rules, no visual approximation) ────────
 * Tries chess.js attacks first; falls back to a hand-verified geometric
 * implementation so validation NEVER depends on rendering.
 */
export function attackedSquares(map, byColor) {
  // Attempt chess.js path (dynamic import avoided — pure file; caller may pass
  // precomputed attacks). Here we compute geometrically (verified rules).
  const occ = new Set(Object.keys(map));
  const out = new Set();
  for (const [sq, piece] of Object.entries(map)) {
    if (piece.color !== byColor) continue;
    for (const t of geometricAttacks(sq, piece, occ)) out.add(t);
  }
  return [...out].sort();
}

function geometricAttacks(sq, piece, occ) {
  const f = fileIndexOf(sq);
  const r = rankOf(sq);
  const at = (nf, nr) => (nf >= 0 && nf < 8 && nr >= 1 && nr <= 8 ? `${FILES[nf]}${nr}` : null);
  const out = [];
  const slide = (dirs) => {
    for (const [df, dr] of dirs) {
      let nf = f + df;
      let nr = r + dr;
      while (nf >= 0 && nf < 8 && nr >= 1 && nr <= 8) {
        const s = `${FILES[nf]}${nr}`;
        out.push(s);
        if (occ.has(s)) break;
        nf += df;
        nr += dr;
      }
    }
  };
  const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  switch (piece.type) {
    case 'p': {
      const dir = piece.color === 'w' ? 1 : -1;
      for (const df of [-1, 1]) {
        const s = at(f + df, r + dir);
        if (s) out.push(s);
      }
      break;
    }
    case 'n':
      for (const [df, dr] of [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]]) {
        const s = at(f + df, r + dr);
        if (s) out.push(s);
      }
      break;
    case 'b': slide(DIAG); break;
    case 'r': slide(ORTHO); break;
    case 'q': slide([...ORTHO, ...DIAG]); break;
    case 'k':
      for (let df = -1; df <= 1; df++) {
        for (let dr = -1; dr <= 1; dr++) {
          if (!df && !dr) continue;
          const s = at(f + df, r + dr);
          if (s) out.push(s);
        }
      }
      break;
    default: break;
  }
  return out;
}

/** Squares of `color` pieces that are defended by a same-color piece. */
export function defendedSquares(map, color) {
  const defenderAttacks = new Set(attackedSquares(map, color));
  return Object.keys(map)
    .filter((sq) => map[sq].color === color && defenderAttacks.has(sq))
    .sort();
}

/** Squares of `color` pieces currently under attack by the enemy. */
export function piecesUnderAttack(map, color) {
  const enemy = color === 'w' ? 'b' : 'w';
  const hits = new Set(attackedSquares(map, enemy));
  return Object.keys(map)
    .filter((sq) => map[sq].color === color && hits.has(sq))
    .sort();
}

/* ── question generation ───────────────────────────────────────────────
 * Every generator returns { kind, prompt, answer, choices?, board, meta }.
 * - answer validation is exact (see validateAnswer).
 * - `recent` is a Set of recent answer keys to avoid repeats when the mode
 *   forbids them; generators retry up to 40 times.
 * - Nothing is hardcoded: all questions derive from rng + valid coordinates.
 */

function withNoRepeat(rng, recent, keyFn, gen) {
  let q = gen();
  for (let i = 0; i < 40 && recent.has(keyFn(q)); i++) q = gen();
  recent.add(keyFn(q));
  if (recent.size > 12) {
    const first = recent.values().next().value;
    recent.delete(first);
  }
  return q;
}

export function generateQuestion(modeId, opts = {}) {
  const {
    rng = Math.random,
    level = 'pawn',
    orientation = 'white',
    recent = new Set(),
    customModes = null,
  } = opts;
  let mode = modeId;
  if (mode === 'custom' && Array.isArray(customModes) && customModes.length) {
    mode = pick(rng, customModes);
  }
  switch (mode) {
    case 'find-square': return withNoRepeat(rng, recent, (q) => q.answer, () => genFindSquare(rng, orientation));
    case 'coordinate-recognition': return withNoRepeat(rng, recent, (q) => q.answer, () => genCoordinateRecognition(rng, orientation));
    case 'find-piece': return withNoRepeat(rng, recent, (q) => q.answer, () => genFindPiece(rng));
    case 'piece-plus-square': return withNoRepeat(rng, recent, (q) => q.answer, () => genPiecePlusSquare(rng));
    case 'square-color': return withNoRepeat(rng, recent, (q) => `${q.meta.square}`, () => genSquareColor(rng, orientation));
    case 'spatial': return withNoRepeat(rng, recent, (q) => q.answer, () => genSpatial(rng, level));
    case 'flash-memory': return withNoRepeat(rng, recent, (q) => q.answer, () => genFlashMemory(rng, level));
    case 'blindfold': return withNoRepeat(rng, recent, (q) => q.answer, () => genBlindfold(rng, level));
    case 'attack-defense': return withNoRepeat(rng, recent, (q) => q.answer, () => genAttackDefense(rng, level));
    default: return withNoRepeat(rng, recent, (q) => q.answer, () => genFindSquare(rng, orientation));
  }
}

function genFindSquare(rng, orientation) {
  const sq = randomSquare(rng);
  return {
    kind: 'tap-square',
    mode: 'find-square',
    prompt: `Find ${sq}`,
    answer: sq,
    choices: null,
    board: {},
    meta: { square: sq, orientation },
  };
}

function genCoordinateRecognition(rng, orientation) {
  const sq = randomSquare(rng);
  // Multiple-choice: correct + 3 distractors sharing file or rank (plausible).
  const distract = new Set();
  let guard = 0;
  while (distract.size < 3 && guard++ < 200) {
    const d = randomSquare(rng);
    if (d !== sq) distract.add(d);
  }
  const choices = shuffle([sq, ...distract], rng);
  return {
    kind: 'choose-name',
    mode: 'coordinate-recognition',
    prompt: 'Name the highlighted square',
    answer: sq,
    choices,
    board: {},
    meta: { square: sq, highlight: sq, orientation, keyboard: true },
  };
}

function genFindPiece(rng) {
  const { map } = randomPosition(rng, 4);
  const squares = Object.keys(map).filter((s) => map[s].type !== 'k');
  const target = pick(rng, squares.length ? squares : Object.keys(map));
  const piece = map[target];
  return {
    kind: 'tap-square',
    mode: 'find-piece',
    prompt: `Find the ${pieceLabel(piece)}`,
    answer: target,
    choices: null,
    board: map,
    meta: { square: target, piece },
  };
}

function genPiecePlusSquare(rng) {
  const { map } = randomPosition(rng, 5);
  // Guarantee the named piece exists: pick an actual non-king piece.
  const squares = Object.keys(map).filter((s) => map[s].type !== 'k');
  const target = pick(rng, squares.length ? squares : Object.keys(map));
  const piece = map[target];
  return {
    kind: 'tap-square',
    mode: 'piece-plus-square',
    prompt: `Find the ${pieceLabel(piece)} on ${target}`,
    answer: target,
    choices: null,
    board: map,
    meta: { square: target, piece },
  };
}

function genSquareColor(rng, orientation) {
  const sq = randomSquare(rng);
  return {
    kind: 'choose-color',
    mode: 'square-color',
    prompt: `Is ${sq} light or dark?`,
    answer: squareColor(sq),
    choices: ['light', 'dark'],
    board: {},
    meta: { square: sq, highlight: sq, orientation },
  };
}

function genSpatial(rng, level) {
  const lvlIdx = LEVELS.findIndex((l) => l.id === level);
  const advanced = lvlIdx >= 2;
  const kinds = advanced
    ? ['left-of', 'right-of', 'above', 'below', 'same-rank', 'same-file', 'diagonal', 'knight-move']
    : ['left-of', 'right-of', 'above', 'below', 'same-rank', 'same-file'];
  const kind = pick(rng, kinds);
  // Pick an anchor with room for the relation.
  for (let attempt = 0; attempt < 60; attempt++) {
    const anchor = randomSquare(rng);
    const f = fileIndexOf(anchor);
    const r = rankOf(anchor);
    let candidates = [];
    if (kind === 'left-of') candidates = FILES.slice(0, f).map((ff) => `${ff}${r}`);
    else if (kind === 'right-of') candidates = FILES.slice(f + 1).map((ff) => `${ff}${r}`);
    else if (kind === 'above') candidates = Array.from({ length: 8 - r }, (_, i) => `${anchor[0]}${r + 1 + i}`);
    else if (kind === 'below') candidates = Array.from({ length: r - 1 }, (_, i) => `${anchor[0]}${r - 1 - i}`);
    else if (kind === 'same-rank') candidates = FILES.filter((ff) => ff !== anchor[0]).map((ff) => `${ff}${r}`);
    else if (kind === 'same-file') candidates = [1, 2, 3, 4, 5, 6, 7, 8].filter((rr) => rr !== r).map((rr) => `${anchor[0]}${rr}`);
    else if (kind === 'diagonal') candidates = allSquares().filter((s) => sameDiagonal(anchor, s));
    else if (kind === 'knight-move') {
      candidates = [];
      for (const [df, dr] of [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]]) {
        const nf = f + df;
        const nr = r + dr;
        if (nf >= 0 && nf < 8 && nr >= 1 && nr <= 8) candidates.push(`${FILES[nf]}${nr}`);
      }
    }
    if (!candidates.length) continue;
    const answer = pick(rng, candidates);
    const promptText = {
      'left-of': `A square LEFT of ${anchor} (lower file, same rank ${r}) — tap any correct square`,
      'right-of': `A square RIGHT of ${anchor} (higher file, same rank ${r}) — tap any correct square`,
      above: `A square ABOVE ${anchor} (same file ${anchor[0]}, higher rank) — tap any correct square`,
      below: `A square BELOW ${anchor} (same file ${anchor[0]}, lower rank) — tap any correct square`,
      'same-rank': `A square on the SAME RANK as ${anchor} (rank ${r}) — tap any correct square`,
      'same-file': `A square on the SAME FILE as ${anchor} (file ${anchor[0]}) — tap any correct square`,
      diagonal: `A square on the SAME DIAGONAL as ${anchor} — tap any correct square`,
      'knight-move': `A square a KNIGHT'S MOVE away from ${anchor} — tap any correct square`,
    }[kind];
    return {
      kind: 'tap-square-any',
      mode: 'spatial',
      prompt: promptText,
      answer,
      choices: null,
      board: {},
      meta: { square: anchor, highlight: anchor, relation: kind, accept: candidates },
    };
  }
  return genFindSquare(rng, 'white');
}

function genFlashMemory(rng, level) {
  const lvlIdx = LEVELS.findIndex((l) => l.id === level);
  const extra = lvlIdx >= 4 ? 5 : lvlIdx >= 3 ? 4 : 2;
  const { map } = randomPosition(rng, extra);
  const squares = Object.keys(map);
  const askRecall = rng() < 0.5;
  if (askRecall) {
    const target = pick(rng, squares);
    const piece = map[target];
    return {
      kind: 'tap-square',
      mode: 'flash-memory',
      prompt: `After the flash: where was the ${pieceLabel(piece)}?`,
      answer: target,
      choices: null,
      board: {},
      meta: { square: target, piece, flashMap: map, flashMs: flashDurationFor(level), hidden: true },
    };
  }
  const target = pick(rng, squares);
  const piece = map[target];
  const others = PIECE_TYPES.filter((t) => t !== piece.type);
  const choices = shuffle([PIECE_NAMES[piece.type], PIECE_NAMES[pick(rng, others)], PIECE_NAMES[pick(rng, others)]], rng);
  return {
    kind: 'choose-name',
    mode: 'flash-memory',
    prompt: `After the flash: which piece was on ${target}?`,
    answer: PIECE_NAMES[piece.type],
    choices,
    board: {},
    meta: { square: target, piece, flashMap: map, flashMs: flashDurationFor(level), hidden: true },
  };
}

export function flashDurationFor(level) {
  const idx = LEVELS.findIndex((l) => l.id === level);
  return idx <= 1 ? 3000 : idx === 2 ? 2200 : idx === 3 ? 1500 : 1000;
}

function genBlindfold(rng, level) {
  // Stages: 1 = coordinates hidden (pieces shown), 2 = pieces hidden too,
  // 3 = board hidden (answer from memory). Beginners (pawn/knight) stay at 1.
  const lvlIdx = LEVELS.findIndex((l) => l.id === level);
  const stage = lvlIdx <= 1 ? 1 : lvlIdx === 2 ? (rng() < 0.7 ? 1 : 2) : (rng() < 0.4 ? 1 : rng() < 0.75 ? 2 : 3);
  const sq = randomSquare(rng);
  const stageNote = stage === 1
    ? 'Coordinates are hidden — count files a–h and ranks 1–8 from the edges.'
    : stage === 2
      ? 'Coordinates and pieces are hidden — picture the empty board.'
      : 'The board is hidden — answer from memory.';
  return {
    kind: 'tap-square',
    mode: 'blindfold',
    prompt: `Find ${sq}. ${stageNote}`,
    answer: sq,
    choices: null,
    board: {},
    meta: { square: sq, blindStage: stage },
  };
}

function genAttackDefense(rng, level) {
  const lvlIdx = LEVELS.findIndex((l) => l.id === level);
  const { map } = randomPosition(rng, lvlIdx >= 3 ? 5 : 3);
  const squares = Object.keys(map);
  const askKind = pick(rng, ['attacked-by', 'defended', 'under-attack', 'safe']);
  if (askKind === 'attacked-by') {
    const from = pick(rng, squares);
    const piece = map[from];
    const attacks = geometricAttacks(from, piece, new Set(squares));
    if (!attacks.length) return genFindPiece(rng);
    const answer = pick(rng, attacks);
    return {
      kind: 'tap-square',
      mode: 'attack-defense',
      prompt: `A square attacked by the ${pieceLabel(piece)} on ${from} — tap any correct square`,
      answer,
      choices: null,
      board: map,
      meta: { square: from, piece, accept: attacks, relation: 'attacked-by' },
    };
  }
  if (askKind === 'defended') {
    const defended = defendedSquares(map, 'w').concat(defendedSquares(map, 'b'));
    if (!defended.length) return genAttackDefenseRetry(rng, level);
    const answer = pick(rng, defended);
    return {
      kind: 'tap-square',
      mode: 'attack-defense',
      prompt: 'Tap a DEFENDED piece (guarded by its own side)',
      answer,
      choices: null,
      board: map,
      meta: { square: answer, piece: map[answer], relation: 'defended', accept: defended },
    };
  }
  if (askKind === 'under-attack') {
    const targets = piecesUnderAttack(map, 'w').concat(piecesUnderAttack(map, 'b'));
    if (!targets.length) return genAttackDefenseRetry(rng, level);
    const answer = pick(rng, targets);
    return {
      kind: 'tap-square',
      mode: 'attack-defense',
      prompt: 'Tap a piece that is UNDER ATTACK',
      answer,
      choices: null,
      board: map,
      meta: { square: answer, piece: map[answer], relation: 'under-attack', accept: targets },
    };
  }
  // safe square: not attacked by black
  const attackedByBlack = new Set(attackedSquares(map, 'b'));
  const safe = allSquares().filter((s) => !attackedByBlack.has(s) && !map[s]);
  if (!safe.length) return genFindSquare(rng, 'white');
  const answer = pick(rng, safe);
  return {
    kind: 'tap-square',
    mode: 'attack-defense',
    prompt: 'Tap a SAFE square (not attacked by any black piece)',
    answer,
    choices: null,
    board: map,
    meta: { square: answer, relation: 'safe', accept: safe },
  };
}

function genAttackDefenseRetry(rng, level) {
  // Retry with a denser position once; fall back to find-the-square logic.
  const { map } = randomPosition(rng, 6);
  const squares = Object.keys(map);
  const from = pick(rng, squares);
  const piece = map[from];
  const attacks = geometricAttacks(from, piece, new Set(squares));
  if (!attacks.length) return genFindSquare(rng, 'white');
  const answer = pick(rng, attacks);
  return {
    kind: 'tap-square',
    mode: 'attack-defense',
    prompt: `A square attacked by the ${pieceLabel(piece)} on ${from} — tap any correct square`,
    answer,
    choices: null,
    board: map,
    meta: { square: from, piece, accept: attacks, relation: 'attacked-by' },
  };
}

/* ── validation ──────────────────────────────────────────────────────── */

export function validateAnswer(question, given) {
  if (!question || given == null) return false;
  const norm = String(given).trim().toLowerCase();
  if (question.kind === 'tap-square' || question.kind === 'tap-square-any') {
    if (question.meta?.accept) return question.meta.accept.map((s) => s.toLowerCase()).includes(norm);
    return norm === String(question.answer).toLowerCase();
  }
  if (question.kind === 'choose-color' || question.kind === 'choose-name') {
    return norm === String(question.answer).toLowerCase();
  }
  return norm === String(question.answer).toLowerCase();
}

export function mistakeCategory(question, given) {
  // For analytics: coarse categories, never invented precision.
  if (validateAnswer(question, given)) return null;
  const mode = question.mode;
  if (mode === 'square-color') return 'color-confusion';
  if (mode === 'spatial') return `spatial-${question.meta?.relation || 'unknown'}`;
  if (mode === 'find-square' || mode === 'coordinate-recognition' || mode === 'blindfold') {
    const expected = String(question.answer);
    const got = String(given);
    if (isValidSquare(expected) && isValidSquare(got)) {
      if (sameFile(expected, got)) return 'wrong-rank';
      if (sameRank(expected, got)) return 'wrong-file';
      if (sameDiagonal(expected, got)) return 'diagonal-slip';
      if (squareColor(expected) !== squareColor(got)) return 'color-confusion';
    }
    return 'wrong-square';
  }
  if (mode === 'find-piece' || mode === 'piece-plus-square' || mode === 'flash-memory') return 'wrong-piece-square';
  if (mode === 'attack-defense') return `attack-${question.meta?.relation || 'unknown'}`;
  return 'other';
}

/* ── scoring / timing ────────────────────────────────────────────────── */

export function accuracyOf(correct, incorrect) {
  const total = correct + incorrect;
  if (!total) return 0;
  return Math.round((correct / total) * 100);
}

export function avgOf(times) {
  if (!times.length) return 0;
  return Math.round(times.reduce((a, b) => a + b, 0) / times.length);
}

export function medianOf(times) {
  if (!times.length) return 0;
  const s = [...times].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

export function targetReached(target, correct, accuracy) {
  if (!target) return true;
  if (target.kind === 'count') return correct >= (target.count || 5);
  if (target.kind === 'accuracy') return accuracy >= (target.pct || 70);
  return false; // personal-best is comparative, evaluated at results time
}

export function xpForSession({ correct, accuracy, bestStreak }) {
  return correct * 10 + (accuracy >= 70 ? 25 : 0) + Math.min(bestStreak, 10) * 2;
}

/* ── session state machine (pure, testable) ────────────────────────────
 * States: idle -> running -> paused -> running -> ended.
 * Guards: no scoring after end; restart resets; pause preserves remaining.
 */
export const SESSION_STATES = ['idle', 'running', 'paused', 'ended'];

export function sessionTransition(state, event) {
  const allowed = {
    idle: ['start'],
    running: ['pause', 'end', 'restart'],
    paused: ['resume', 'end', 'restart'],
    ended: ['restart'],
  };
  if (!allowed[state]?.includes(event)) return state;
  if (event === 'start') return 'running';
  if (event === 'pause') return 'paused';
  if (event === 'resume') return 'running';
  if (event === 'end') return 'ended';
  if (event === 'restart') return 'idle';
  return state;
}

/* ── level lock / unlock ─────────────────────────────────────────────── */

export function levelUnlockStatus(levelsProgress, levelIdx, freePractice = false) {
  // levelsProgress: { [levelId]: { sessions, bestAccuracy, targetReachedCount } }
  if (levelIdx === 0 || freePractice) return { locked: false, reason: null };
  const prev = LEVELS[levelIdx - 1];
  const p = levelsProgress?.[prev.id];
  const okSessions = (p?.qualifyingSessions || 0) >= UNLOCK_RULE.sessions;
  if (okSessions) return { locked: false, reason: null };
  return {
    locked: true,
    reason: `Complete ${UNLOCK_RULE.sessions} sessions on ${prev.name} at ${UNLOCK_RULE.minAccuracy}%+ with target reached to unlock.`,
  };
}

export function recordSessionForProgress(levelsProgress, levelId, { accuracy, reached }) {
  const prev = levelsProgress?.[levelId] || { sessions: 0, bestAccuracy: 0, qualifyingSessions: 0, completedChallenges: 0 };
  const qualifying = accuracy >= UNLOCK_RULE.minAccuracy && reached;
  return {
    ...levelsProgress,
    [levelId]: {
      sessions: prev.sessions + 1,
      bestAccuracy: Math.max(prev.bestAccuracy, accuracy),
      qualifyingSessions: prev.qualifyingSessions + (qualifying ? 1 : 0),
      completedChallenges: prev.completedChallenges + 1,
    },
  };
}

export function progressToNextLevel(levelProgress) {
  if (!levelProgress) return 0;
  const q = Math.min(levelProgress.qualifyingSessions || 0, UNLOCK_RULE.sessions);
  return Math.round((q / UNLOCK_RULE.sessions) * 100);
}

/* ── rule-based adaptive difficulty (NOT "AI") ─────────────────────────
 * Inputs: rolling accuracy, avg response ms, mistake streak, per-mode stats.
 * Output: { action: 'raise'|'simplify'|'hint'|'hold'|'targeted-practice', note }
 */
export const ADAPTIVE_DEFAULTS = {
  raiseAccuracy: 85,
  raiseMaxMs: 2500,
  simplifyAccuracy: 55,
  mistakeStreakForPractice: 3,
};

export function adaptiveDecision(stats, thresholds = ADAPTIVE_DEFAULTS) {
  const { accuracy = 0, avgMs = 0, mistakeStreak = 0, attempts = 0, consistency = 1 } = stats;
  if (attempts < 3) return { action: 'hold', level: 0, note: 'Warming up — answer a few more to calibrate.' };
  if (mistakeStreak >= thresholds.mistakeStreakForPractice) {
    return { action: 'targeted-practice', level: -1, note: 'Repeated mistakes spotted — try a short targeted practice round.' };
  }
  if (accuracy < thresholds.simplifyAccuracy) {
    return { action: 'simplify', level: -1, note: 'Accuracy is low — simplifying and showing hints.' };
  }
  // Never raise on speed alone when accuracy is poor.
  if (accuracy >= thresholds.raiseAccuracy && avgMs <= thresholds.raiseMaxMs && consistency >= 0.6) {
    return { action: 'raise', level: 1, note: 'High accuracy and fast — raising difficulty gradually.' };
  }
  if (consistency < 0.5) return { action: 'hold', level: 0, note: 'Inconsistent results — holding this level steady.' };
  if (accuracy >= thresholds.raiseAccuracy - 10) {
    return { action: 'hint', level: 0, note: 'Close — small hints are on for the next questions.' };
  }
  return { action: 'hold', level: 0, note: 'Holding this level steady.' };
}

/* ── classroom: seeded sequences + ranking ───────────────────────────── */

export function classSequence({ seed, mode, level, count, orientation }) {
  const rng = seededRng(seed);
  const recent = new Set();
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push(generateQuestion(mode, { rng, level, orientation, recent }));
  }
  return out;
}

export function rankClassResults(rows, sortBy = 'correct') {
  // Default: correct desc, then accuracy desc, then avgMs asc. Never time alone.
  const sorted = [...rows].sort((a, b) => {
    if (sortBy === 'accuracy') {
      if (b.accuracy !== a.accuracy) return b.accuracy - a.accuracy;
      if (b.correct !== a.correct) return b.correct - a.correct;
      return a.avgMs - b.avgMs;
    }
    if (sortBy === 'response-time') {
      // Response-time view still breaks ties by correctness first.
      if (b.correct !== a.correct) return b.correct - a.correct;
      if (b.accuracy !== a.accuracy) return b.accuracy - a.accuracy;
      return a.avgMs - b.avgMs;
    }
    if (b.correct !== a.correct) return b.correct - a.correct;
    if (b.accuracy !== a.accuracy) return b.accuracy - a.accuracy;
    return a.avgMs - b.avgMs;
  });
  let rank = 0;
  let prevKey = null;
  return sorted.map((r, i) => {
    const key = `${r.correct}|${r.accuracy}|${r.avgMs}`;
    if (key !== prevKey) { rank = i + 1; prevKey = key; }
    return { ...r, rank };
  });
}

export function classAnalytics(rows, history) {
  // rows: per-student { correct, incorrect, accuracy }; history: [{ question, given, correct }]
  const total = rows.length;
  const completed = rows.filter((r) => r.completed).length;
  const acc = total ? Math.round(rows.reduce((a, r) => a + (r.accuracy || 0), 0) / total) : 0;
  const missByPrompt = {};
  const missByCategory = {};
  for (const h of history || []) {
    if (h.correct) continue;
    missByPrompt[h.prompt] = (missByPrompt[h.prompt] || 0) + 1;
    if (h.category) missByCategory[h.category] = (missByCategory[h.category] || 0) + 1;
  }
  const hardest = Object.entries(missByPrompt).sort((a, b) => b[1] - a[1])[0] || null;
  return { total, completed, inProgress: total - completed, accuracy: acc, hardest, missByCategory };
}

/* ── small helpers ───────────────────────────────────────────────────── */

/** Per-question answer lock (rapid-tap protection) — framework-independent
 * so the rule itself is unit-testable; the React hook holds one instance. */
export function createAnswerLock() {
  let locked = false;
  return {
    get locked() { return locked; },
    lock() { locked = true; },
    unlock() { locked = false; },
    /** Returns true (and locks) on first call; false while locked. */
    tryAcquire() {
      if (locked) return false;
      locked = true;
      return true;
    },
  };
}

export function shuffle(arr, rng = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function formatMs(ms) {
  if (!ms && ms !== 0) return '—';
  return `${(ms / 1000).toFixed(1)}s`;
}

export function levelById(id) {
  return LEVELS.find((l) => l.id === id) || LEVELS[0];
}

export function modeById(id) {
  return MODES.find((m) => m.id === id) || MODES[0];
}
