// Single-flight delayed transition for moving between puzzles.
//
// After a validated correct solve the next puzzle should load exactly
// `delayMs` later. The guard makes three guarantees:
//   - a duplicate solve event (React StrictMode, a solver that reports twice)
//     can never schedule two transitions — the same puzzle key returns false;
//   - scheduling a new puzzle cancels any pending transition for the old one;
//   - cancel() is the single choke point for "leave the screen / close the
//     puzzle" cleanup.
//
// Timers are injectable so tests can drive the delay without real waiting.
export function createTransitionGuard(delayMs, { setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let timer = null;
  let pendingKey = null;

  function cancel() {
    if (timer != null) clearTimer(timer);
    timer = null;
    pendingKey = null;
  }

  function schedule(key, cb) {
    if (pendingKey === key) return false; // already queued for this puzzle
    cancel();
    pendingKey = key;
    timer = setTimer(() => {
      timer = null;
      pendingKey = null;
      cb();
    }, delayMs);
    return true;
  }

  return { schedule, cancel };
}