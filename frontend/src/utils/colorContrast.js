/* Coordinate labels sit on the square itself, so their ink has to follow that
   square's real fill: the saved theme's pair, the user's custom pair written to
   --board-light/--board-dark, or a per-square colour an ornate theme paints.
   A fixed white label disappears on a pale square, and a fixed dark label
   disappears on a dark one, so the ink is picked here from the fill's WCAG
   luminance instead of from a light/dark class. */

/* The two ink values the boards draw coordinates with. */
export const COORD_DARK_INK = '#111827';
export const COORD_LIGHT_INK = '#ffffff';

const DARK_INK_RGB = { r: 0x11, g: 0x18, b: 0x27 };

/* Hex or rgb()/rgba() only — the values the board styles actually carry. A
   translucent fill (a highlight tint, a marble board's transparent cells) is
   treated as unknown: the caller's base-square ink is the honest fallback. */
function parseOpaqueColor(value) {
  if (typeof value !== 'string') return null;
  const token = value.trim().toLowerCase();
  if (!token || token === 'transparent' || token === 'none') return null;

  if (token[0] === '#') {
    const hex = token.slice(1);
    const digits = hex.length === 3 || hex.length === 4
      ? hex.split('').map((c) => parseInt(c + c, 16))
      : hex.length === 6 || hex.length === 8
        ? hex.match(/../g).map((c) => parseInt(c, 16))
        : null;
    if (!digits || digits.some(Number.isNaN)) return null;
    if (digits.length === 4 && digits[3] < 255) return null;
    return { r: digits[0], g: digits[1], b: digits[2] };
  }

  const match = token.match(/^rgba?\(([^)]+)\)$/);
  if (!match) return null;
  const parts = match[1].replace(/\//g, ' ').split(/[\s,]+/).filter(Boolean).map(Number);
  if (parts.length < 3 || parts.slice(0, 3).some((n) => !Number.isFinite(n))) return null;
  const alpha = parts.length > 3 ? parts[3] : 1;
  if (alpha < 0.999) return null;
  return { r: parts[0], g: parts[1], b: parts[2] };
}

const channelLuminance = (channel) => {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

const relativeLuminance = ({ r, g, b }) => (
  0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b)
);

const contrastRatio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/* Whichever of the app's two inks reads better on `fill`. Returns null when the
   fill cannot be resolved (a var() token, a translucent tint, a board image), so
   callers keep the ink they already derived from the board palette. */
export function contrastInk(fill) {
  const rgb = parseOpaqueColor(fill);
  if (!rgb) return null;
  const fillLum = relativeLuminance(rgb);
  const onDark = contrastRatio(fillLum, relativeLuminance(DARK_INK_RGB));
  const onLight = contrastRatio(fillLum, 1);
  return onDark >= onLight ? COORD_DARK_INK : COORD_LIGHT_INK;
}
