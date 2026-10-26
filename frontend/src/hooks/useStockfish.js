/* useStockfish — engine lifecycle for bot games.
 *
 * The heavy Stockfish worker is shared app-wide (utils/stockfish.js holds a
 * singleton pool), so this hook does NOT create a worker per game — it manages
 * when that pool is warmed, stopped and torn down:
 *
 *   - Warm on mount, so the first bot move is not preceded by a cold WASM boot.
 *   - `stop()` on game end / rematch, so a search cannot land mid-rematch.
 *   - `terminatePool()` on unmount ONLY when leaving the bot game for good, so
 *     the 7 MB engine is not left running for the rest of the session. The
 *     caller passes `ownsPool` so a page that also uses live analysis (the Play
 *     Arena) does not pull the rug out from under itself.
 *
 * It also surfaces pool health so a failure can be explained to the user
 * ("Stockfish couldn't start") instead of looking like a hung game.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { warmEngine, terminate, stopEngineSearch } from '../utils/engine';

/** WebAssembly is non-negotiable for the Stockfish build. */
function wasmSupported() {
  return typeof WebAssembly === 'object' && typeof WebAssembly.instantiate === 'function';
}

function workerSupported() {
  return typeof Worker === 'function';
}

export function useStockfish({ ownsPool = true, autoWarm = true } = {}) {
  const [state, setState] = useState(() => {
    if (!wasmSupported()) return { state: 'unsupported', readySlots: 0, totalSlots: 1, lastError: '' };
    if (!workerSupported()) return { state: 'unsupported', readySlots: 0, totalSlots: 1, lastError: '' };
    return { state: 'idle', readySlots: 0, totalSlots: 1, lastError: '' };
  });

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const warm = useCallback(async () => {
    if (!wasmSupported() || !workerSupported()) return false;
    setState((s) => ({ ...s, state: 'booting' }));
    try {
      await warmEngine();
      if (mountedRef.current) setState((s) => ({ ...s, state: 'ready', lastError: '' }));
      return true;
    } catch (err) {
      if (mountedRef.current) {
        setState((s) => ({
          ...s,
          state: 'failed',
          lastError: err?.message || 'Stockfish failed to start.',
        }));
      }
      return false;
    }
  }, []);

  /** Cancel any in-flight search. Safe to call repeatedly. */
  const stop = useCallback(() => {
    try {
      stopEngineSearch();
    } catch { /* best-effort */ }
  }, []);

  /**
   * Give the whole pool back. Only called on unmount when this page owns the
   * engine, and only when nothing is searching.
   */
  const shutdown = useCallback(() => {
    try {
      stopEngineSearch();
      terminate();
    } catch { /* best-effort */ }
  }, []);

  useEffect(() => {
    if (!autoWarm) return undefined;
    warm();
    return () => {
      if (ownsPool) shutdown();
    };
    /* Intentionally mount/unmount only: re-warming on every render would fight
     * the pool's own single-boot guard. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** True while the engine cannot serve moves, so the UI can warn up front. */
  const unavailable = state.state === 'unsupported' || state.state === 'failed';

  const message =
    state.state === 'unsupported'
      ? 'This browser cannot run the chess engine (WebAssembly or Web Workers unavailable).'
      : state.state === 'failed'
        ? state.lastError || 'The chess engine could not start.'
        : '';

  return { state: state.state, busy: state.state === 'booting', unavailable, message, warm, stop, shutdown };
}

export default useStockfish;