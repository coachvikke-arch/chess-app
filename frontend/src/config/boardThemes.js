// ─────────────────────────────────────────────────────────────────────────────
// Board themes config — single source of truth for chessboard square colors.
// Each board across the app (practice, puzzles, analysis, review, tournaments,
// admin previews) reads the active theme id from the user's preferences and
// resolves its square colors here.
//
// Shape:
//   id          — persisted value stored on users.board_theme
//   name        — human-readable label for the Settings picker
//   lightSq     — background color of light squares
//   darkSq      — background color of dark squares
//   highlight   — accent color used for selected / last-move / legal-move dots
//   accessibility — marks high-contrast, colour-blind / low-vision friendly themes
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_BOARD_THEME = 'classic-green';

export const BOARD_THEMES = [
  {
    id: 'classic-green',
    name: 'Classic Green',
    lightSq: '#eef0d4',
    darkSq: '#7a9855',
    highlight: '#7dd3fc',
    accessibility: false,
  },
  {
    id: 'classic-brown',
    name: 'Classic Brown',
    lightSq: '#f0d9b5',
    darkSq: '#b58863',
    highlight: '#7dd3fc',
    accessibility: false,
  },
  {
    id: 'blue-ocean',
    name: 'Blue Ocean',
    lightSq: '#dee3e6',
    darkSq: '#607d8b',
    highlight: '#38bdf8',
    accessibility: false,
  },
  {
    id: 'tournament-wood',
    name: 'Tournament Wood',
    lightSq: '#eedfd0',
    darkSq: '#a56b3a',
    highlight: '#7dd3fc',
    accessibility: false,
  },
  /* ── Light palettes ────────────────────────────────────────────────────────
     The "Dark Mode" board was removed: it was the only theme whose LIGHT
     square was darker than mid-grey, so it fought the app's light blue-gray
     surface and read as a hole in the page. Everything below keeps lightSq
     genuinely light and only varies the hue of the dark squares.

     `getBoardTheme` already falls back to DEFAULT_BOARD_THEME for an unknown
     id, so anyone who had already saved "dark-mode" simply lands on Classic
     Green — no broken board, no crash. */
  {
    id: 'slate',
    name: 'Slate',
    lightSq: '#e8ecf0',
    darkSq: '#5b6b7a',
    highlight: '#38bdf8',
    accessibility: false,
  },
  {
    id: 'sky',
    name: 'Sky',
    lightSq: '#e7f1fb',
    darkSq: '#4a86b8',
    highlight: '#38bdf8',
    accessibility: false,
  },
  {
    id: 'mint',
    name: 'Mint',
    lightSq: '#e6f4ee',
    darkSq: '#3f8f77',
    highlight: '#34d399',
    accessibility: false,
  },
  {
    id: 'rose',
    name: 'Rose',
    lightSq: '#fbeaec',
    darkSq: '#b06075',
    highlight: '#fb7185',
    accessibility: false,
  },
  {
    id: 'lavender',
    name: 'Lavender',
    lightSq: '#efeaf7',
    darkSq: '#6f5fa3',
    highlight: '#a78bfa',
    accessibility: false,
  },
  {
    id: 'peach',
    name: 'Peach',
    lightSq: '#fdeee4',
    darkSq: '#c57a52',
    highlight: '#fdba74',
    accessibility: false,
  },
  {
    id: 'sand',
    name: 'Sand',
    lightSq: '#f7efe1',
    darkSq: '#a3804b',
    highlight: '#fbbf24',
    accessibility: false,
  },
  {
    id: 'linen',
    name: 'Linen',
    lightSq: '#f4f1ea',
    darkSq: '#8a8272',
    highlight: '#7dd3fc',
    accessibility: false,
  },
  {
    id: 'coral',
    name: 'Coral',
    lightSq: '#ffe9dc',
    darkSq: '#e08a7f',
    highlight: '#ff8a80',
    accessibility: false,
  },
  {
    id: 'marble',
    name: 'Marble',
    lightSq: '#f4f4f2',
    darkSq: '#9b9b93',
    highlight: '#7dd3fc',
    accessibility: false,
  },
  {
    id: 'ice',
    name: 'Ice',
    lightSq: '#f1f5f9',
    darkSq: '#8fc7e0',
    highlight: '#38bdf8',
    accessibility: false,
  },
  // ── Light "Atelier" collection ────────────────────────────────────────────
  // Ten pale boards. Every one keeps a genuinely light lightSq so the pieces
  // stay readable, and each is paired with a matching frame, gold trim and
  // highlight that the board derives automatically. The ornate ones carry a
  // soft marble vein layer (veinLight/veinDark) so the squares read as stone
  // rather than flat paint, without darkening the board.
  {
    id: 'cloud-silk',
    name: 'Cloud Silk',
    lightSq: '#f8fafc',
    darkSq: '#b3c2d6',
    highlight: '#7c9fd4',
    accessibility: false,
  },
  {
    id: 'pearl-lagoon',
    name: 'Pearl Lagoon',
    lightSq: '#eef7f8',
    darkSq: '#7fbec6',
    highlight: '#3fb8c4',
    accessibility: false,
  },
  {
    id: 'alabaster-rose',
    name: 'Alabaster Rose',
    lightSq: '#fdf5f6',
    darkSq: '#dba7b4',
    highlight: '#e78aa6',
    accessibility: false,
  },
  {
    id: 'sea-mist',
    name: 'Sea Mist',
    lightSq: '#f2f8fc',
    darkSq: '#9dc3d6',
    highlight: '#5aa9c7',
    accessibility: false,
  },
  {
    id: 'lilac-haze',
    name: 'Lilac Haze',
    lightSq: '#f7f5fd',
    darkSq: '#b9aede',
    highlight: '#9d8ad4',
    accessibility: false,
  },
  {
    id: 'sage-garden',
    name: 'Sage Garden',
    lightSq: '#f4f8f1',
    darkSq: '#a9c4a2',
    highlight: '#7ba86f',
    ornate: true,
    veinLight: '#d3e2cd',
    veinDark: '#e4f0e1',
    accessibility: false,
  },
  {
    id: 'honey-cream',
    name: 'Honey Cream',
    lightSq: '#fdf8ec',
    darkSq: '#dcc189',
    highlight: '#d9a441',
    ornate: true,
    veinLight: '#f0e3c4',
    veinDark: '#fbf1da',
    accessibility: false,
  },
  {
    id: 'porcelain',
    name: 'Porcelain',
    lightSq: '#f6fbfa',
    darkSq: '#88c4b8',
    highlight: '#3fae9c',
    ornate: true,
    veinLight: '#d0e8e3',
    veinDark: '#ddf2ee',
    accessibility: false,
  },
  {
    id: 'ash-orchid',
    name: 'Ash Orchid',
    lightSq: '#f6f4f9',
    darkSq: '#a89ab8',
    highlight: '#8a76a8',
    accessibility: false,
  },
  {
    id: 'copper-mist',
    name: 'Copper Mist',
    lightSq: '#fdf4f0',
    darkSq: '#d9a48c',
    highlight: '#c97a4e',
    ornate: true,
    veinLight: '#f2d9cb',
    veinDark: '#fbeade',
    accessibility: false,
  },
  {
    id: 'jade-ornate',
    name: 'Royal Jade · Ornate',
    lightSq: '#f2ead6',
    darkSq: '#2e7a58',
    highlight: '#7dd3fc',
    ornate: true,
    veinLight: '#c9bd99',
    veinDark: '#dff0e4',
    accessibility: false,
  },
  {
    id: 'royal-jade',
    name: 'Royal Jade · Premium',
    lightSq: '#f1e8d2',
    darkSq: '#176a4a',
    highlight: '#38bdf8',
    ornate: true,
    variant: 'royal',
    accessibility: false,
  },
  {
    id: 'royal-emerald',
    name: 'Royal Emerald · Imperial',
    lightSq: '#e9eed8',
    darkSq: '#1e5f45',
    highlight: '#e7c76f',
    ornate: true,
    variant: 'royal-emerald',
    veinLight: '#cdd8bf',
    veinDark: '#e6f2e7',
    accessibility: false,
  },
  {
    id: 'faded-board',
    name: 'Faded Board',
    lightSq: '#f2ead6',
    darkSq: '#2e7a58',
    highlight: '#7dd3fc',
    boardImage: '/boards/faded30.svg',
    accessibility: false,
  },
  // High-contrast accessibility options (still distinct, non-colour-reliant)
  {
    id: 'hc-black-white',
    name: 'Hi-Contrast Black & White',
    lightSq: '#ffffff',
    darkSq: '#1a1a1a',
    highlight: '#ffd200',
    accessibility: true,
  },
  {
    id: 'hc-blue-yellow',
    name: 'Hi-Contrast Blue & Yellow',
    lightSq: '#fff3b0',
    darkSq: '#12319d',
    highlight: '#ff7a00',
    accessibility: true,
  },
];

/**
 * Board themes hidden from the Settings → Board Theme picker ONLY. They stay
 * fully functional (getBoardTheme still resolves them, so a user who already
 * picked one keeps seeing it) — they are just no longer offered as new choices.
 * The plain, recognisable boards remain selectable: Classic Green/Brown, Blue
 * Ocean, Tournament Wood, the light palette family (Slate, Sky, Mint, Rose,
 * Lavender, Peach, Sand, Linen), the two high-contrast accessibility ones, and
 * the Royal/Jade family.
 */
export const BOARD_THEMES_HIDDEN_IN_SETTINGS = new Set([
  'coral', 'marble', 'ice', 'faded-board',
]);

export function getBoardTheme(id) {
  if (!id) return BOARD_THEMES.find((t) => t.id === DEFAULT_BOARD_THEME);
  return BOARD_THEMES.find((t) => t.id === id) || BOARD_THEMES.find((t) => t.id === DEFAULT_BOARD_THEME);
}

/**
 * Returns the react-chessboard style props for a board theme — handles both
 * solid-colour themes and full-image (SVG) boards.
 */
export function getBoardThemeStyles(theme) {
  if (!theme) return {};
  if (theme.boardImage) {
    return {
      darkSquareStyle: { backgroundColor: 'transparent' },
      lightSquareStyle: { backgroundColor: 'transparent' },
      boardStyle: {
        backgroundImage: `url(${theme.boardImage})`,
        backgroundSize: '100% 100%',
        borderRadius: '14px',
        overflow: 'hidden',
      },
    };
  }
  return {
    darkSquareStyle: { backgroundColor: theme.darkSq },
    lightSquareStyle: { backgroundColor: theme.lightSq },
    boardStyle: null,
  };
}