/**
 * Pairing rules for a chess score sheet.
 *
 * Kept in its own plain-JS module (not inside a .jsx file) so the numbering can
 * be unit-tested directly - a score sheet that mis-numbers its moves is worse
 * than no score sheet, because it looks authoritative.
 */

/**
 * Pair a flat SAN history into professional score-sheet rows.
 *
 * A score sheet is a fixed three-column table: number | White | Black. The
 * pairing depends on who opened the game. From the initial position that is
 * White, so move k occupies plies 2k-2 and 2k-1. But a game set up from a FEN
 * with Black to move opens with `1...` sitting in the BLACK column, and White's
 * first move is only the SECOND move of the game.
 *
 * The naive `i * 2` loop that this replaced gets that game wrong twice over: it
 * prints the black move in the White column, then numbers every subsequent row
 * one too low. The numbers below run 1, 2, 2, 3, 3, 4 ... because ply 0 is
 * Black's lone first move, after which the normal white-first rhythm resumes.
 *
 * Rows carry `label` rather than a number because the opening row of a
 * black-first game is "1...", not "1.".
 *
 * Each cell also carries its zero-based `ply` - its index in the original SAN
 * array. Consumers that annotate moves (a game review pairs SAN with an
 * engine verdict per ply, and makes each cell a button that jumps to it) must
 * key off the real ply, not off "row index * 2 + column", which is exactly the
 * expression that breaks on a black-opening game.
 *
 * A `null` in a cell means "nothing to show" - an odd-length game, or the empty
 * White cell of a black-opening row - and must render as a spacer that
 * preserves the row height, not as a gap.
 *
 * @param {string[]} history Flat SAN moves in play order.
 * @param {boolean} startsBlack Whether the game began with Black to move.
 * @returns {{label: string, white: string|null, black: string|null,
 *            whitePly: number|null, blackPly: number|null}[]}
 */
export function buildScoreRows(history, startsBlack) {
  const rows = [];
  if (!history || history.length === 0) return rows;
  if (startsBlack) {
    rows.push({ label: '1...', white: null, black: history[0], whitePly: null, blackPly: 0 });
    for (let i = 1; i < history.length; i += 2) {
      rows.push({
        label: `${Math.floor((i + 1) / 2) + 1}.`,
        white: history[i] ?? null,
        black: history[i + 1] ?? null,
        whitePly: i,
        blackPly: i + 1 < history.length ? i + 1 : null,
      });
    }
  } else {
    for (let i = 0; i < history.length; i += 2) {
      rows.push({
        label: `${Math.floor(i / 2) + 1}.`,
        white: history[i] ?? null,
        black: history[i + 1] ?? null,
        whitePly: i,
        blackPly: i + 1 < history.length ? i + 1 : null,
      });
    }
  }
  return rows;
}

/**
 * Does this FEN have Black to move?
 *
 * Reads the side-to-move field (the 2nd of 6 whitespace-separated fields) rather
 * than replaying anything. `'start'`, the sentinel this codebase uses for the
 * initial position, is white-first and returns false.
 *
 * @param {string} fen A FEN string, or the `'start'` sentinel.
 * @returns {boolean}
 */
export function fenStartsBlack(fen) {
  if (typeof fen !== 'string') return false;
  const trimmed = fen.trim();
  if (!trimmed || trimmed === 'start') return false;
  return trimmed.split(/\s+/)[1] === 'b';
}

/**
 * Did the game behind a chess.js instance open with Black to move?
 *
 * Reads the PGN `FEN` tag, which records the position the game STARTED from.
 * That matters: chess.js's `header()` returns only the tags that were actually
 * set, so it never reports the current position, and this answer cannot flip
 * part-way through a game.
 *
 * @param {{header?: () => object}} game A chess.js instance.
 * @returns {boolean}
 */
export function gameStartsBlack(game) {
  return fenStartsBlack(game?.header?.()?.FEN);
}

/**
 * Read one player's name out of a PGN's own header tags.
 *
 * A PGN's [White]/[Black] tags are the most trustworthy name available, because
 * they are what the exporting site recorded. A game pasted from Chess.com or
 * Lichess carries them; a game this app played and stored does NOT - chess.js
 * writes the movetext only - which is why callers must be able to fall back to
 * names they already know from the database.
 *
 * Exporters write "?" for a player they could not identify. That is not a name,
 * and printing it above a column is worse than admitting we do not know, so it
 * is reported as absent.
 *
 * @param {string} text Raw PGN text.
 * @param {'White'|'Black'} tagName
 * @returns {string} The name, or '' when absent/unknown.
 */
export function pgnPlayerName(text, tagName) {
  const m = String(text || '').match(new RegExp(`\\[${tagName}\\s+"([^"]*)"`));
  const v = m ? m[1].trim() : '';
  return !v || v === '?' || v === '--' ? '' : v;
}