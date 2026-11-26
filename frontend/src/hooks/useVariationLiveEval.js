import { useEffect, useRef, useState } from 'react';
import { searchTopMoves } from '../utils/nnueEngine';
import { LIVE_ANALYSIS_DEPTH, LIVE_ANALYSIS_MULTIPV } from '../utils/reviewConfig';

/* ──────────────────────────────────────────────────────────────────────────
 * Live evaluation for an arbitrary position — the one on screen when the user
 * has stepped OFF the original game onto a variation.
 *
 * It is deliberately separate from the stored review: the eval bar, the best
 * move arrow and any variation badge describe THIS node, while accuracy and
 * the score sheet keep describing the original game only.
 *
 * The search is debounced (a held key must not queue one per press) and stale
 * answers are dropped by a token. It never calls stopEngineSearch(), because
 * that aborts EVERY pool search — including a full review the user is running
 * somewhere else.
 * ────────────────────────────────────────────────────────────────────────── */

const DEBOUNCE_MS = 220;

export default function useVariationLiveEval(fen, {
  enabled = true,
  depth = LIVE_ANALYSIS_DEPTH,
  multiPv = LIVE_ANALYSIS_MULTIPV,
} = {}) {
  const [info, setInfo] = useState(null);
  const tokenRef = useRef(0);

  useEffect(() => {
    if (!enabled || !fen) {
      tokenRef.current += 1;
      setInfo(null);
      return undefined;
    }
    const token = ++tokenRef.current;
    let alive = true;
    const timer = window.setTimeout(() => {
      Promise.resolve(searchTopMoves(fen, { maxDepth: depth, multiPv }))
        .then((top) => {
          if (!alive || token !== tokenRef.current) return;
          const best = Array.isArray(top) && top[0] ? top[0] : null;
          if (!best) { setInfo(null); return; }
          setInfo({
            fen,
            score: best.score ?? 0,
            mate: best.mate ?? null,
            depth: best.depth ?? 0,
            bestUci: best.uci || null,
            lines: top
              .filter((l) => l && l.uci && l.uci.length >= 4)
              .slice(0, multiPv)
              .map((l) => ({
                uci: l.uci,
                from: l.from || l.uci.slice(0, 2),
                to: l.to || l.uci.slice(2, 4),
                score: l.score ?? null,
              })),
          });
        })
        .catch(() => { if (alive && token === tokenRef.current) setInfo(null); });
    }, DEBOUNCE_MS);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [fen, enabled, depth, multiPv]);

  /* `null` until the answer for THIS fen lands, so a caller can never paint the
     previous position's evaluation on a new board. */
  return info && info.fen === fen ? info : null;
}
