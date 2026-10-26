/* GAME REVIEW engine — bound to the FULL NNUE Stockfish build so review
   verdicts stay on Chess.com-grade NNUE evaluation, while live board analysis
   runs on the separate lite engine (./engine.js). Same API surface as ./engine.js. */

import { createEngine } from './engineCore.js';
import * as nnue from './nnue.js';

export const { searchBest, evaluateGame, searchTopMoves, stopEngineSearch, engineStatus, resetEngine } = createEngine(nnue);

/* Pre-boot the NNUE pool in the background (see ./nnue.js). */
export const warmEngine = () => nnue.warmEngine();
export const reviewEngineStatus = () => nnue.engineStatus();
export const resetReviewEngine = () => nnue.resetPool();