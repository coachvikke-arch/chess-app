// ─────────────────────────────────────────────────────────────────────────────
// Ornate theme support — marble square textures, coordinate label styling and
// the frame palette (gold trims + plinth) for themed boards. Everything is
// generated in code (SVG data-URIs / inline SVG) so no image assets are needed.
// Each ornate theme can tune its own marble veins via optional
// `veinLight`/`veinDark` fields on the theme config.
// ─────────────────────────────────────────────────────────────────────────────

const VEIN_LIGHT = 52;
const VEIN_DARK = 32;

/* Push a hex colour towards white (positive amt) or black (negative). */
export function shade(hex, amt) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  if (Number.isNaN(n)) return hex;
  const mix = amt >= 0 ? 255 : 0;
  const a = Math.abs(amt);
  const ch = (v) => Math.round(v + (mix - v) * a).toString(16).padStart(2, '0');
  return `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
}

/** Perceived luminance (0..1) of a hex colour — used to guarantee the
    coordinate labels always contrast with the frame band behind them. */
export function lum(hex) {
  const h = (hex || '').replace('#', '');
  if (!h) return 0;
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return 0;
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** Resolve the marble vein stroke colours for an ornate board theme. */
function veinsFor(boardTheme) {
  return {
    light: boardTheme.veinLight || shade(boardTheme.lightSq, -0.2),
    dark: boardTheme.veinDark || shade(boardTheme.darkSq, 0.6),
  };
}

/* Subtle tiled marble background (soft curved veins + faint mottling). */
function marbleTile(base, veinStroke, opacity) {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="90" height="90" viewBox="0 0 90 90">` +
    `<rect width="90" height="90" fill="${base}"/>` +
    `<ellipse cx="62" cy="18" rx="26" ry="16" fill="#ffffff" opacity="${opacity * 0.16}"/>` +
    `<ellipse cx="18" cy="70" rx="22" ry="15" fill="#000000" opacity="${opacity * 0.07}"/>` +
    `<g fill="none" stroke="${veinStroke}" stroke-linecap="round" opacity="${opacity}">` +
    `<path d="M-8 26 C 12 40, 24 8, 50 24 S 78 40, 100 16" stroke-width="1.5"/>` +
    `<path d="M-6 64 C 16 74, 30 50, 52 62 S 78 84, 100 58" stroke-width="1.15"/>` +
    `<path d="M6 -8 C 20 14, 56 2, 66 22 S 84 52, 98 44" stroke-width="0.9"/>` +
    `</g></svg>`;
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
}

/** CSS for one ornate square — the base colour plus its marble vein layer,
    tinted from the active board theme (defaults to the classic jade tone). */
export function marbledSquareStyle(color, isDark, boardTheme) {
  const veins = veinsFor(boardTheme || { lightSq: '#f2ead6', darkSq: '#2e7a58' });
  const stroke = isDark ? veins.dark : veins.light;
  const opacity = isDark ? 0.15 + VEIN_DARK / 100 : 0.16 + VEIN_LIGHT / 100;
  return {
    backgroundColor: color,
    backgroundImage: marbleTile(color, stroke, opacity),
    backgroundSize: 'cover',
    backgroundPosition: 'center',
  };
}

/** Coordinate label style — cream/gold serif, subtle shadow (outside the board). */
export const ORNATE_NOTATION_STYLE = {
  fontFamily: 'Georgia, "Times New Roman", serif',
  fontSize: '11px',
  fontWeight: 600,
  color: '#f8ecd2',
  textShadow: '0 1px 2px rgba(20,20,12,0.85)',
};

/** Coordinate label style for the Premium (royal) board — warm gold serif. */
export const ROYAL_NOTATION_STYLE = {
  fontFamily: 'Georgia, "Times New Roman", serif',
  fontSize: '11px',
  fontWeight: 700,
  color: '#e9c46a',
  textShadow: '0 1px 2px rgba(6,12,9,0.95)',
};

/* ────────────────────────────────────────────────────────────────────────────
   Themed decorative board frame — gold trims and plinth gradient
   driven by the active board theme. All generated in code.
   ──────────────────────────────────────────────────────────────────────────── */

/** Resolve the frame palette for an active board theme:
    - gold     — metallic trim accent (from the theme's highlight colour)
    - label    — coordinate label colour, auto-contrasted against the plinth band
                 so the coordinates are always clearly readable on the frame
    - plinthA/B — inner recessed plinth gradient (from the theme's darkSq) */
export function framePalette(boardTheme) {
  const light = boardTheme?.lightSq || '#f2ead6';
  const dark = boardTheme?.darkSq || '#2e7a58';
  const gold = boardTheme?.highlight || '#7dd3fc';
  const plinthA = shade(dark, -0.44);
  const plinthB = shade(dark, -0.74);
  /* coordinate labels are always kept light and bright so they read clearly
     on the frame; the dark halo shadow maintains contrast on light plinths */
  const label = shade(gold, 0.72);
  return {
    gold,
    label,
    plinthA,
    plinthB,
  };
}

/** Coordinate label style for the Imperial frame panel — champagne-gold serif
    on the emerald marble band. */
export const REM_COORD_STYLE = {
  fontFamily: 'Georgia, "Times New Roman", serif',
  fontSize: '12px',
  fontWeight: 800,
  color: '#7dd3fc',
  textShadow:
    '0 1px 2px rgba(4,12,8,0.9), 0 0 8px rgba(217,169,40,0.35)',
};