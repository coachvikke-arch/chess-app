/* Live-classroom board highlights (right-click square fills).
 *
 * A single square is tinted edge-to-edge (no circle, no ring) with a
 * semi-transparent colour so the piece standing on it stays visible — the tint
 * is layered OVER the square's own light/dark base colour (see
 * highlightSquareStyle), so a highlighted light square still reads lighter than
 * a highlighted dark square. A flat fill covered the base and made the two
 * indistinguishable, erasing the board's checker pattern.
 *
 * The palette is one object so the colours can be tuned in one place. They are
 * deliberately distinct from the board's pale-blue last-move highlight, its
 * selected-square tint and the green legal-move dots.
 *
 * Pure and dependency-free so the colour mapping and the toggle can be tested
 * without a browser.
 */

export const HIGHLIGHT_COLORS = {
  red: 'rgba(235, 64, 52, 0.55)',
  green: 'rgba(34, 167, 94, 0.55)',
  blue: 'rgba(52, 120, 235, 0.55)',
  yellow: 'rgba(240, 190, 30, 0.6)',
};

/* No modifier (and any legacy event that omits a colour) → red. */
export const DEFAULT_HIGHLIGHT_COLOR = HIGHLIGHT_COLORS.red;

/**
 * Pick a highlight colour from the modifier keys held during the right-click:
 *   none → red, Shift → green, Ctrl/Cmd → blue, Alt → yellow.
 */
export function highlightColorForModifiers(modifiers = {}) {
  const { shiftKey, ctrlKey, metaKey, altKey } = modifiers || {};
  if (shiftKey) return HIGHLIGHT_COLORS.green;
  if (ctrlKey || metaKey) return HIGHLIGHT_COLORS.blue;
  if (altKey) return HIGHLIGHT_COLORS.yellow;
  return HIGHLIGHT_COLORS.red;
}

/**
 * The square style for a highlight.
 *
 * The colour is applied as a translucent GRADIENT LAYER (`background-image`)
 * instead of a flat `backgroundColor`, so the square's own light/dark base
 * colour is kept and shows through the tint. A flat fill replaced the base
 * entirely, which made every highlighted square look the same shade and wiped
 * out the checkerboard. Still no radius, ring or shadow — the piece on top
 * stays fully legible.
 */
export function highlightSquareStyle(color) {
  const c = color || DEFAULT_HIGHLIGHT_COLOR;
  return {
    backgroundImage: `linear-gradient(${c}, ${c})`,
    borderRadius: 0,
    boxShadow: 'none',
  };
}

/** Turn the stored highlights into react-chessboard's customSquareStyles map. */
export function highlightsToSquareStyles(highlights) {
  const styles = {};
  if (!Array.isArray(highlights)) return styles;
  for (const h of highlights) {
    if (!h || !h.square) continue;
    styles[h.square] = highlightSquareStyle(h.color);
  }
  return styles;
}

/**
 * Right-click toggle for a square:
 *   - no highlight        → add the colour
 *   - same colour         → remove (toggle off)
 *   - a different colour  → recolour that square
 * Returns the next highlights array plus the action to broadcast.
 */
export function toggleHighlight(highlights, square, color) {
  const list = Array.isArray(highlights) ? highlights : [];
  const nextColor = color || DEFAULT_HIGHLIGHT_COLOR;
  const existing = list.find((h) => h && h.square === square);

  if (existing && (existing.color || DEFAULT_HIGHLIGHT_COLOR) === nextColor) {
    return { highlights: list.filter((h) => h.square !== square), action: 'remove' };
  }
  if (existing) {
    return {
      highlights: list.map((h) => (h.square === square ? { square, color: nextColor } : h)),
      action: 'add',
    };
  }
  return { highlights: [...list, { square, color: nextColor }], action: 'add' };
}
