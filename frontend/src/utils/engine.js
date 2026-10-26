/* Board ANALYSIS engine — bound to the LITE Stockfish build (separate, small,
   7 MB). Used by live analysis, the engine bar and computer games. Review has
   its own NNUE engine (see ./nnueEngine.js and ./engineConfig.js). */

import { createEngine } from './engineCore.js';
import * as stockfish from './stockfish.js';

export const { searchBest, evaluateGame, searchTopMoves, stopEngineSearch } = createEngine(stockfish);

/* Pre-boot the lite analysis pool in the background (see ./stockfish.js). */
export const warmEngine = () => stockfish.warmEngine();

/* Tear the lite pool down when a screen that owns it unmounts (e.g. Play vs
 * Bots leaving the page), so the 7 MB worker is not left resident for the rest
 * of the session. It re-boots on the next warmEngine(). */
export const terminate = () => stockfish.terminate();