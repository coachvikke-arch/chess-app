// ─────────────────────────────────────────────────────────────────────────────
// Configurable chess piece themes — single source of truth used by EVERY board
// (analysis, puzzles, review, settings previews). Users pick one in Settings.
//
// Theme types:
//   svg      → react-chessboard built-in Cburnett images (the app default)
//   unicode  → styled unicode glyphs (self-contained, no image assets needed)
//
// Per-set styling: white/black colours, glows/shadow, glyph scale plus the
// optional theme-level stroke (outline), fontFamily, fontWeight, letterSpacing.
// ─────────────────────────────────────────────────────────────────────────────

import { FacedPiece } from '../components/FacedPiece';
import { RoyalPiece } from '../components/RoyalPieces';

export const GLYPHS = {
  wK: '♔', wQ: '♕', wR: '♖', wB: '♗', wN: '♘', wP: '♙',
  bK: '♚', bQ: '♛', bR: '♜', bB: '♝', bN: '♞', bP: '♟',
};

// Alternative glyph sets for visually distinct piece themes
export const GLYPHS_OUTLINE = {
  wK: '♔', wQ: '♕', wR: '♖', wB: '♗', wN: '♘', wP: '♙',
  bK: '🖡', bQ: '🖡', bR: '🖢', bB: '🖣', bN: '🖤', bP: '🖥',
};

export const GLYPHS_EMOJI = {
  wK: '🤴', wQ: '👸', wR: '🏰', wB: '🧙', wN: '🐎', wP: '🗿',
  bK: '👑', bQ: '💂', bR: '🏯', bB: '🧟', bN: '🦄', bP: '🧱',
};

export const GLYPHS_FAIRY = {
  wK: '🦁', wQ: '🦚', wR: '🏰', wB: '🦉', wN: '🦄', wP: '🐣',
  bK: '🐺', bQ: '🕷', bR: '🏯', bB: '🦇', bN: '🐎', bP: '🪨',
};

export const GLYPHS_MEDIEVAL = {
  wK: '🤴', wQ: '👸', wR: '🏰', wB: '⛪', wN: '🏇', wP: '⚔️',
  bK: '👑', bQ: '🛡️', bR: '🏯', bB: '🕍', bN: '🐎', bP: '🗡️',
};

export const GLYPHS_CIRCLE = {
  wK: '⒦', wQ: '⒬', wR: '⒭', wB: '⒝', wN: '⒩', wP: '⒫',
  bK: 'Ⓚ', bQ: 'Ⓠ', bR: 'Ⓡ', bB: '⒝', bN: 'Ⓝ', bP: 'Ⓟ',
};

export const GLYPHS_SQUARE = {
  wK: '🟦', wQ: '🟦', wR: '🟦', wB: '🟦', wN: '🟦', wP: '🟦',
  bK: '🟫', bQ: '🟫', bR: '🟫', bB: '🟫', bN: '🟫', bP: '🟫',
};

export const GLYPHS_MINIMAL = {
  wK: 'K', wQ: 'Q', wR: 'R', wB: 'B', wN: 'N', wP: 'P',
  bK: 'k', bQ: 'q', bR: 'r', bB: 'b', bN: 'n', bP: 'p',
};

export const GLYPHS_RETRO = {
  wK: '🂡', wQ: '🂠', wR: '🂡', wB: '🂡', wN: '🂡', wP: '🂡',
  bK: '🂱', bQ: '🂲', bR: '🂳', bB: '🂴', bN: '🂵', bP: '🂶',
};

export const GLYPHS_GEOMETRIC = {
  wK: '▲', wQ: '◆', wR: '■', wB: '●', wN: '★', wP: '△',
  bK: '▼', bQ: '◇', bR: '□', bB: '○', bN: '☆', bP: '▽',
};

const DEF = {
  white: { color: '#f0f9ff', shadow: '0 0 3px #2b2418, 0 2px 4px rgba(0,0,0,0.55)', scale: 0.72 },
  black: { color: '#221b12', shadow: '0 0 2px rgba(255,248,225,0.45), 0 2px 4px rgba(0,0,0,0.4)', scale: 0.72 },
};

/** Compact builder for a unicode-styled theme entry. */
function glyphTheme(id, name, overrides = {}) {
  return {
    id,
    name,
    type: 'unicode',
    glyphs: GLYPHS,
    white: { ...DEF.white, ...(overrides.white || {}) },
    black: { ...DEF.black, ...(overrides.black || {}) },
    stroke: overrides.stroke,
    fontFamily: overrides.fontFamily,
    fontWeight: overrides.fontWeight,
    letterSpacing: overrides.letterSpacing,
  };
}

export const PIECE_THEMES = {
  /* ── chess.com-style collection (order = Settings picker order) ── */
  neo: glyphTheme('neo', 'Neo', {
    white: { color: '#f1f5f9', shadow: '0 0 6px #38bdf8, 0 2px 5px rgba(0,0,0,0.5)', scale: 0.74 },
    black: { color: '#0a2140', shadow: '0 0 5px #7dd3fc, 0 2px 4px rgba(0,0,0,0.45)', scale: 0.74 },
    stroke: '0.5px #bfe9ff',
  }),
  classic: glyphTheme('classic', 'Classic'),
  wood: glyphTheme('wood', 'Wood', {
    white: { color: '#f6e7c8', shadow: '0 1px 3px rgba(90,55,20,0.55), 0 2px 5px rgba(0,0,0,0.4)' },
    black: { color: '#3b2413', shadow: '0 0 2px rgba(246,231,200,0.4), 0 2px 4px rgba(0,0,0,0.45)', scale: 0.74 },
  }),
  neo_wood: glyphTheme('neo_wood', 'Neo Wood', {
    white: { color: '#fbeecd', shadow: '0 1px 3px rgba(120,70,20,0.5), 0 2px 5px rgba(0,0,0,0.4)', scale: 0.76 },
    black: { color: '#4a2c16', shadow: '0 0 2px rgba(251,238,205,0.45), 0 2px 4px rgba(0,0,0,0.5)', scale: 0.76 },
  }),
  glass: glyphTheme('glass', 'Glass', {
    white: { color: '#f0f9ff', shadow: '0 0 4px #e0f2fe, 0 0 8px rgba(0,0,0,0.25)', scale: 0.68 },
    black: { color: '#16344a', shadow: '0 0 4px #38bdf8, 0 2px 5px rgba(0,0,0,0.45)', scale: 0.7 },
    stroke: '0.75px #bfe9ff',
  }),
  metal: glyphTheme('metal', 'Metal', {
    white: { color: '#e7eaef', shadow: '0 0 4px #aebccb, 0 1px 3px rgba(0,0,0,0.6)', scale: 0.7 },
    black: { color: '#23262b', shadow: '0 0 3px #b7c2cf, 0 2px 5px rgba(0,0,0,0.5)', scale: 0.7 },
    stroke: '0.5px #cfd7de',
  }),
  bases: glyphTheme('bases', 'Bases', {
    white: { color: '#f4f4f2', shadow: '0 1px 3px rgba(30,30,34,0.55)', scale: 0.7 },
    black: { color: '#191c21', shadow: '0 0 2px rgba(244,244,242,0.45), 0 2px 4px rgba(0,0,0,0.5)', scale: 0.7 },
    fontWeight: 700,
  }),
  alpha: glyphTheme('alpha', 'Alpha', {
    white: { color: '#f8f5ec', shadow: '0 1px 2px rgba(40,35,25,0.5)', scale: 0.78 },
    black: { color: '#17151a', shadow: '0 0 2px rgba(248,245,236,0.5), 0 2px 3px rgba(0,0,0,0.4)', scale: 0.78 },
    fontFamily: 'Georgia, "Times New Roman", serif',
  }),
  book: glyphTheme('book', 'Book', {
    white: { color: '#fbf1dd', shadow: '0 1px 3px rgba(120,90,40,0.5)', scale: 0.74 },
    black: { color: '#233a5e', shadow: '0 0 2px rgba(251,241,221,0.5), 0 2px 4px rgba(0,0,0,0.45)', scale: 0.74 },
  }),
  bubblegum: glyphTheme('bubblegum', 'Bubblegum', {
    white: { color: '#ffd9ec', shadow: '0 0 3px #ff9ecf, 0 1px 3px rgba(0,0,0,0.35)', scale: 0.76 },
    black: { color: '#5a2b6e', shadow: '0 0 4px #e87fd0, 0 2px 4px rgba(0,0,0,0.4)', scale: 0.76 },
  }),
  cases: glyphTheme('cases', 'Cases', {
    white: { color: '#f3e0b8', shadow: '0 0 3px #d8b26a, 0 1px 3px rgba(0,0,0,0.5)' },
    black: { color: '#232830', shadow: '0 0 3px #8a93a0, 0 2px 5px rgba(0,0,0,0.5)' },
    stroke: '0.5px #f2cf7d',
  }),
  club: glyphTheme('club', 'Club', {
    white: { color: '#f8e9d0', shadow: '0 1px 3px rgba(70,45,15,0.55)', scale: 0.76 },
    black: { color: '#2a1c10', shadow: '0 0 2px rgba(248,233,208,0.42), 0 2px 4px rgba(0,0,0,0.45)', scale: 0.76 },
  }),
  condal: glyphTheme('condal', 'Condal', {
    white: { color: '#eef2e6', shadow: '0 1px 3px rgba(30,45,40,0.5)', scale: 0.74 },
    black: { color: '#24344d', shadow: '0 0 3px #9fc2e8, 0 2px 4px rgba(0,0,0,0.45)', scale: 0.74 },
  }),
  dash: glyphTheme('dash', 'Dash', {
    white: { color: '#f0f9ff', shadow: '0 0 3px #cfe0ff, 0 1px 3px rgba(0,0,0,0.5)', scale: 0.77 },
    black: { color: '#131f33', shadow: '0 2px 5px rgba(0,0,0,0.55)', scale: 0.77 },
  }),
  game_room: glyphTheme('game_room', 'Game Room', {
    white: { color: '#f5e9c4', shadow: '0 0 5px #ffd166, 0 2px 5px rgba(0,0,0,0.5)', scale: 0.74 },
    black: { color: '#2a1440', shadow: '0 0 5px #c26bff, 0 2px 4px rgba(0,0,0,0.5)', scale: 0.74 },
    stroke: '0.5px #e69dff',
  }),
  gothic: glyphTheme('gothic', 'Gothic', {
    white: { color: '#f0f9ff', shadow: '0 1px 3px rgba(90,60,10,0.55)' },
    black: { color: '#3d0f1e', shadow: '0 0 3px #ffd9e8, 0 2px 4px rgba(0,0,0,0.45)', scale: 0.74 },
    stroke: '0.4px #e8c96a',
  }),
  graffiti: glyphTheme('graffiti', 'Graffiti', {
    white: { color: '#eafff0', shadow: '0 0 3px #38bdf8, 0 2px 4px rgba(0,0,0,0.4)', scale: 0.78 },
    black: { color: '#2a1745', shadow: '0 0 4px #ff3ef0, 0 2px 4px rgba(0,0,0,0.45)', scale: 0.78 },
    stroke: '0.75px #ff74f7',
  }),
  icy_sea: glyphTheme('icy_sea', 'Icy Sea', {
    white: { color: '#f0f9ff', shadow: '0 0 4px #7fd6ff, 0 2px 4px rgba(0,0,0,0.4)', scale: 0.74 },
    black: { color: '#0e3a5c', shadow: '0 0 5px #57c1ff, 0 2px 4px rgba(0,0,0,0.5)', scale: 0.76 },
  }),
  maya: glyphTheme('maya', 'Maya', {
    white: { color: '#e4f2df', shadow: '0 0 3px #9ed7a8, 0 1px 3px rgba(0,0,0,0.4)', scale: 0.76 },
    black: { color: '#14503f', shadow: '0 0 4px #8fe0c0, 0 2px 4px rgba(0,0,0,0.5)', scale: 0.76 },
  }),
  modern: glyphTheme('modern', 'Modern', {
    white: { color: '#fafafa', shadow: '0 1px 2px rgba(0,0,0,0.35)', scale: 0.8 },
    black: { color: '#0b0d0f', shadow: '0 0 1px rgba(255,255,255,0.3)', scale: 0.8 },
    fontWeight: 500,
  }),
  nature: glyphTheme('nature', 'Nature', {
    white: { color: '#f0e8d5', shadow: '0 1px 3px rgba(70,90,30,0.5)', scale: 0.74 },
    black: { color: '#274a2a', shadow: '0 0 3px #7fbf74, 0 2px 4px rgba(0,0,0,0.45)', scale: 0.76 },
  }),
  newspaper: glyphTheme('newspaper', 'Newspaper', {
    white: { color: '#f9f5e6', shadow: '0 1px 2px rgba(40,40,45,0.5)', scale: 0.76 },
    black: { color: '#10140f', shadow: '0 0 2px rgba(249,245,230,0.5), 0 2px 3px rgba(0,0,0,0.4)', scale: 0.76 },
    fontFamily: 'Georgia, serif',
  }),
  ocean: glyphTheme('ocean', 'Ocean', {
    white: { color: '#f2e8cf', shadow: '0 1px 3px rgba(110,90,40,0.5)', scale: 0.76 },
    black: { color: '#0a2f47', shadow: '0 0 5px #4fd0ff, 0 2px 4px rgba(0,0,0,0.5)', scale: 0.76 },
  }),
  sky: glyphTheme('sky', 'Sky', {
    white: { color: '#ffffff', shadow: '0 0 3px #bae6fd, 0 1px 3px rgba(0,0,0,0.35)', scale: 0.74 },
    black: { color: '#1d4ea1', shadow: '0 0 5px #7fb5ff, 0 2px 4px rgba(0,0,0,0.45)', scale: 0.76 },
  }),
  space: glyphTheme('space', 'Space', {
    white: { color: '#f7f3ff', shadow: '0 0 5px #d9ccff, 0 1px 3px rgba(0,0,0,0.4)', scale: 0.72 },
    black: { color: '#150b2b', shadow: '0 0 6px #a78bfa, 0 2px 4px rgba(0,0,0,0.55)', scale: 0.72 },
    stroke: '0.5px #c9bcff',
  }),
  tigers: glyphTheme('tigers', 'Tigers', {
    white: { color: '#ffc874', shadow: '0 0 4px #ff9e3d, 0 1px 3px rgba(0,0,0,0.4)', scale: 0.72 },
    black: { color: '#1c1108', shadow: '0 0 3px rgba(255,200,116,0.5), 0 2px 4px rgba(0,0,0,0.5)', scale: 0.74 },
  }),
  tournament: glyphTheme('tournament', 'Tournament', {
    white: { color: '#f2e8d4', shadow: '0 1px 3px rgba(40,60,30,0.5)', scale: 0.75 },
    black: { color: '#14301f', shadow: '0 0 3px #7fc98a, 0 2px 4px rgba(0,0,0,0.5)', scale: 0.75 },
  }),
  vintage: glyphTheme('vintage', 'Vintage', {
    white: { color: '#f7e7c4', shadow: '0 1px 3px rgba(80,50,15,0.55)', scale: 0.74 },
    black: { color: '#4a2a10', shadow: '0 0 2px rgba(247,231,196,0.45), 0 2px 4px rgba(0,0,0,0.5)', scale: 0.74 },
  }),
  '3d_chesskid': glyphTheme('3d_chesskid', '3D Chesskid', {
    white: { color: '#ffe27a', shadow: '0 0 4px #ffcf4d, 0 2px 5px rgba(0,0,0,0.5)', scale: 0.76 },
    black: { color: '#2f5fd8', shadow: '0 0 5px #7da7ff, 0 2px 5px rgba(0,0,0,0.5)', scale: 0.76 },
  }),
  '3d_plastic': glyphTheme('3d_plastic', '3D Plastic', {
    white: { color: '#f8f8f8', shadow: '0 1px 3px rgba(50,50,55,0.5), 0 0 2px rgba(255,255,255,0.7)', scale: 0.74 },
    black: { color: '#303236', shadow: '0 0 4px rgba(255,255,255,0.5), 0 2px 5px rgba(0,0,0,0.55)', scale: 0.74 },
  }),
  '3d_staunton': glyphTheme('3d_staunton', '3D Staunton', {
    white: { color: '#f6f2e8', shadow: '0 1px 3px rgba(60,55,40,0.5), 0 0 2px rgba(255,255,255,0.5)', scale: 0.76 },
    black: { color: '#223c20', shadow: '0 0 3px rgba(255,255,255,0.35), 0 2px 5px rgba(0,0,0,0.5)', scale: 0.78 },
  }),
  '3d_wood': glyphTheme('3d_wood', '3D Wood', {
    white: { color: '#f2d9a8', shadow: '0 1px 3px rgba(80,50,15,0.5)', scale: 0.76 },
    black: { color: '#3d2412', shadow: '0 0 3px rgba(242,217,168,0.45), 0 2px 5px rgba(0,0,0,0.5)', scale: 0.78 },
  }),
  '8bit': glyphTheme('8bit', '8 Bit', {
    white: { color: '#f1f5f9', shadow: '0 2px 0 #3fc0ff, 0 3px 5px rgba(0,0,0,0.5)', scale: 0.6 },
    black: { color: '#2b0b3f', shadow: '0 2px 0 #ff3fd0, 0 3px 5px rgba(0,0,0,0.5)', scale: 0.62 },
    stroke: '0.5px #4fd0ff',
    fontFamily: '"Courier New", monospace',
    fontWeight: 900,
  }),

  /* ── visually distinct piece sets (different glyphs) ── */

  emoji: {
    id: 'emoji',
    name: 'Emoji',
    type: 'unicode',
    glyphs: GLYPHS_EMOJI,
    white: { color: '#fef3c7', shadow: '0 0 6px #fcd34d, 0 2px 8px rgba(0,0,0,0.4)', scale: 0.85 },
    black: { color: '#7c2d12', shadow: '0 0 5px #ea580c, 0 2px 6px rgba(0,0,0,0.5)', scale: 0.85 },
  },
  fairy: {
    id: 'fairy',
    name: 'Fairy Tale',
    type: 'unicode',
    glyphs: GLYPHS_FAIRY,
    white: { color: '#fdf4ff', shadow: '0 0 8px #f0abfc, 0 2px 6px rgba(0,0,0,0.3)', scale: 0.85 },
    black: { color: '#4c1d95', shadow: '0 0 6px #a855f7, 0 2px 5px rgba(0,0,0,0.4)', scale: 0.85 },
  },
  medieval: {
    id: 'medieval',
    name: 'Medieval',
    type: 'unicode',
    glyphs: GLYPHS_MEDIEVAL,
    white: { color: '#fef9c3', shadow: '0 0 5px #fde047, 0 2px 6px rgba(0,0,0,0.4)', scale: 0.85 },
    black: { color: '#78350f', shadow: '0 0 4px #f97316, 0 2px 5px rgba(0,0,0,0.5)', scale: 0.85 },
  },
  minimal: {
    id: 'minimal',
    name: 'Minimal Text',
    type: 'unicode',
    glyphs: GLYPHS_MINIMAL,
    white: { color: '#ffffff', shadow: '0 1px 2px rgba(0,0,0,0.4)', scale: 0.9 },
    black: { color: '#000000', shadow: '0 1px 2px rgba(0,0,0,0.3)', scale: 0.9 },
    fontWeight: 700,
    fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
  },
  geometric: {
    id: 'geometric',
    name: 'Geometric',
    type: 'unicode',
    glyphs: GLYPHS_GEOMETRIC,
    white: { color: '#ffffff', shadow: '0 0 4px #60a5fa, 0 1px 3px rgba(0,0,0,0.4)', scale: 0.85 },
    black: { color: '#111111', shadow: '0 0 4px #f87171, 0 2px 4px rgba(0,0,0,0.5)', scale: 0.85 },
  },
  circle: {
    id: 'circle',
    name: 'Circled',
    type: 'unicode',
    glyphs: GLYPHS_CIRCLE,
    white: { color: '#f0fdf4', shadow: '0 0 4px #4ade80, 0 1px 3px rgba(0,0,0,0.3)', scale: 0.75 },
    black: { color: '#052e16', shadow: '0 0 3px #22c55e, 0 1px 2px rgba(0,0,0,0.4)', scale: 0.75 },
  },
  square: {
    id: 'square',
    name: 'Squares',
    type: 'unicode',
    glyphs: GLYPHS_SQUARE,
    white: { color: '#dbeafe', shadow: '0 1px 2px rgba(0,0,0,0.3)', scale: 0.7 },
    black: { color: '#1e1e1e', shadow: '0 1px 2px rgba(0,0,0,0.3)', scale: 0.7 },
  },
  retro: {
    id: 'retro',
    name: 'Retro Cards',
    type: 'unicode',
    glyphs: GLYPHS_RETRO,
    white: { color: '#fffbeb', shadow: '0 0 5px #fbbf24, 0 1px 3px rgba(0,0,0,0.3)', scale: 0.75 },
    black: { color: '#78350f', shadow: '0 0 4px #f59e0b, 0 1px 2px rgba(0,0,0,0.4)', scale: 0.75 },
  },

  /* ── built-in / legacy sets ── */
  cburnett: { id: 'cburnett', name: 'Cburnett', type: 'svg' },

  /* ── premium Staunton set (code-drawn SVG, matched to Royal Jade boards) ── */
  royal: {
    id: 'royal',
    name: 'Royal',
    type: 'royal',
  },

  /* ── original expressive character set (code-drawn glossy figurines) ── */
  character: {
    id: 'character',
    name: 'Characters',
    type: 'faced',
  },
  unicode: {
    id: 'unicode',
    name: 'Unicode',
    type: 'unicode',
    glyphs: GLYPHS,
    white: { color: '#f0f9ff', shadow: '0 0 3px #2b2418, 0 2px 4px rgba(0,0,0,0.55)', scale: 0.72 },
    black: { color: '#221b12', shadow: '0 0 2px rgba(255,248,225,0.45), 0 2px 4px rgba(0,0,0,0.4)', scale: 0.72 },
  },
  merida: {
    id: 'merida',
    name: 'Merida',
    type: 'unicode',
    glyphs: GLYPHS,
    white: { color: '#f9efd4', shadow: '0 0 5px rgba(58,44,22,0.9), 0 2px 6px rgba(0,0,0,0.75)', scale: 0.78 },
    black: { color: '#31240f', shadow: '0 0 4px rgba(249,239,212,0.75), 0 2px 5px rgba(0,0,0,0.55)', scale: 0.78 },
  },

};

export const CURRENT_PIECE_THEME = 'cburnett';

/**
 * Piece sets hidden from the Settings → Piece Set picker ONLY. They stay fully
 * functional everywhere else (AnalysisBoard quick-picker, boards still render
 * them for users who already chose them) — they are just not offered as new
 * selections in Settings.
 */
export const PIECE_THEMES_HIDDEN_IN_SETTINGS = new Set([
  /* Settings offers a deliberately small, classic set: classic, wood, glass,
     metal, unicode, merida and cburnett. Everything else is
     hidden here rather than deleted, so a user who already picked one keeps
     rendering it everywhere (getPieceTheme still resolves it) — it just is no
     longer offered as a new choice. */
  'neo', 'neo_wood', 'dash', 'club', 'condal', 'tigers', 'vintage',
  '3d_chesskid', '3d_plastic', '3d_staunton', '3d_wood', '8bit', 'character',
  'bases', 'alpha', 'book', 'bubblegum', 'cases', 'game_room', 'gothic',
  'graffiti', 'icy_sea', 'maya', 'modern', 'nature', 'newspaper', 'ocean',
  'sky', 'space', 'tournament', 'emoji', 'fairy', 'medieval', 'minimal',
  'geometric', 'circle', 'square', 'retro', 'royal',
]);

export function getPieceTheme(id = CURRENT_PIECE_THEME) {
  return PIECE_THEMES[id] || PIECE_THEMES.cburnett;
}

/**
 * Inline style for one piece glyph in a theme — the single source of truth for
 * how a theme's pieces look, shared by the react-chessboard custom-piece
 * renderers AND the piece-only swatches in the Settings picker.
 * `sizePx` is the rendered glyph height; the theme's scale is applied on top.
 */
export function pieceGlyphStyle(theme, key, sizePx) {
  const isWhite = key.startsWith('w');
  const style = theme && theme.type === 'unicode'
    ? (isWhite ? theme.white : theme.black)
    : (isWhite ? DEF.white : DEF.black);
  if (theme && (theme.type === 'faced' || theme.type === 'royal')) {
    return { lineHeight: 1 };
  }
  return {
    fontSize: sizePx * style.scale,
    lineHeight: 1,
    color: style.color,
    textShadow: style.shadow,
    fontFamily: theme && theme.fontFamily,
    fontWeight: theme && theme.fontWeight,
    letterSpacing: theme && theme.letterSpacing,
    WebkitTextStroke: theme && theme.stroke,
  };
}

/**
 * Builds the react-chessboard `customPieces` object for a unicode theme, or
 * returns undefined for SVG themes (letting react-chessboard render its built-in
 * Cburnett images). Colours, glows, outlines and fonts come from the theme.
 */
export function buildCustomPieces(theme) {
  if (!theme) return undefined;
  if (theme.type === 'royal') {
    const pieces = {};
    for (const key of Object.keys(GLYPHS)) {
      const type = key[1].toLowerCase();
      const side = key[0];
      pieces[key] = ({ squareWidth }) => (
        <RoyalPiece type={type} side={side} size={squareWidth} />
      );
    }
    return pieces;
  }
  if (theme.type === 'faced') {
    const pieces = {};
    for (const key of Object.keys(GLYPHS)) {
      const type = key[1].toLowerCase();
      const side = key[0];
      pieces[key] = ({ squareWidth }) => (
        <FacedPiece type={type} side={side} size={squareWidth} />
      );
    }
    return pieces;
  }
  if (theme.type === 'png' || theme.type === 'img') {
    const pieces = {};
    const scale = theme.scale || 0.74;
    for (const [key, src] of Object.entries(theme.images)) {
      pieces[key] = ({ squareWidth }) => (
        <div
          style={{
            width: squareWidth,
            height: squareWidth,
            display: 'grid',
            placeItems: 'center',
            pointerEvents: 'none',
          }}
        >
          <img
            src={src}
            alt=""
            draggable={false}
            onDragStart={(e) => e.preventDefault()}
            style={{
              width: squareWidth * scale,
              height: squareWidth * scale,
              objectFit: 'contain',
              ...(key.startsWith('b') && theme.blackFilter ? { filter: theme.blackFilter } : {}),
            }}
          />
        </div>
      );
    }
    return pieces;
  }
  if (theme.type !== 'unicode') return undefined;
  const pieces = {};
  for (const [key, glyph] of Object.entries(theme.glyphs)) {
    pieces[key] = ({ squareWidth }) => (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'grid',
          placeItems: 'center',
          ...pieceGlyphStyle(theme, key, squareWidth),
        }}
      >
        {glyph}
      </div>
    );
  }
  return pieces;
}