/* ── module-scoped game-review runner ────────────────────────────────────────
   The heavy Stockfish review work lives at MODULE scope so it keeps running
   even while the Game Review component is unmounted (navigating to another
   section). Components attach/detach as listeners and always receive the
   freshest snapshot when they rejoin. Only one review runs at a time — kicking
   off a new game cancels whatever was grinding before it finished.
   A page refresh wipes this module (and its engine state), so localStorage is
   still used to remember the GAME itself and re-review it on remount. */
import { analyzeCanonical, getCanonicalAnalysis } from './canonicalAnalysis.js';

let active = null;            // { id, aborted, progress, result, error, done }
const listeners = new Set();  // { getId, cb }

function snapshot() {
  if (!active) return { id: null, running: false, done: false, progress: 0, result: null, error: '', errorDetail: '' };
  return {
    id: active.id,
    running: !active.done && !active.aborted,
    done: active.done,
    progress: active.progress,
    result: active.result,
    error: active.error,
    errorDetail: active.errorDetail || '',
  };
}

function emit() {
  const snap = snapshot();
  listeners.forEach((l) => {
    if (l.getId() === snap.id) l.cb(snap);
  });
}

/* Start (or re-attach to) a review identified by `id`. Returns the session id
 * the caller should listen to, or null when the input was empty.
 *
 * `gameRef` is the game's canonical identity ({ gameSource, gameId }). When it
 * is present the run goes through getCanonicalAnalysis, which reuses a valid
 * stored analysis instead of grinding the engine again, and which dedupes
 * concurrent requests for the same game. A pasted PGN or a hand-played board
 * has no identity and is analysed directly — canonical, just not cached.
 *
 * `analysisStore` ({ loadAnalysis, saveAnalysis }) is the caller's persistence;
 * omitting it means the analysis is still reused for the life of this module. */
export function startReview(id, fen, moves, { gameRef = null, analysisStore = null, engineOverrides } = {}) {
  if (id == null) return null;
  // same game already grinding in the background — just re-attach
  if (active && active.id === id && !active.aborted && !active.done) return active.id;
  // anything else previously running is superseded
  if (active) active.aborted = true;
  active = { id, aborted: false, progress: 0, result: null, error: '', done: false };
  const me = active;
  (async () => {
    try {
      const onProgress = (done, total) => {
        if (me.aborted) return;
        me.progress = Math.round((done / total) * 100);
        emit();
      };
      const isCancelled = () => me.aborted;
      let res;
      if (gameRef) {
        res = await getCanonicalAnalysis(
          { ...gameRef, initialFen: fen, moves },
          {
            ...(analysisStore || {}),
            onProgress,
            isCancelled,
            /* engineOverrides are NOT forwarded: the canonical layer owns the
               engine configuration, which is the whole point of the facade. */
          },
        );
      } else {
        res = await analyzeCanonical(fen, moves, { engineOverrides, onProgress, isCancelled });
      }
      if (me.aborted) return;
      if (res) { me.result = res; me.progress = 100; }
      else {
        /* reviewGame resolves null ONLY on cancellation — but a stray null
           from a future refactor must not masquerade as a finished review. */
        me.error = 'Review produced no result — hit Re-analyze to retry.';
        me.errorDetail = 'empty-result';
      }
      me.done = true;
    } catch (err) {
      if (me.aborted) return;
      /* eslint-disable no-console */
      console.error('[review] failed:', err);
      /* eslint-enable no-console */
      const detail = err && err.message ? String(err.message).slice(0, 220) : '';
      me.error = detail
        ? `Review failed — ${detail} Hit Re-analyze to retry.`
        : 'Review failed — the engine hit a problem. Hit Re-analyze to retry.';
      me.errorDetail = detail;
      me.done = true;
    }
    emit();
  })();
  return me.id;
}

/* Explicitly stop the background review (✕ Vanish / starting fresh). */
export function cancelReview() {
  if (active) active.aborted = true;
  active = null;
  emit();
}

/* id of the review still in flight, if any */
export function activeReviewId() {
  return active && !active.done && !active.aborted ? active.id : null;
}

/* true while ANY review is still grinding (used to keep the engine pool alive
   across section switches) */
export function hasActiveReview() {
  return activeReviewId() !== null;
}

/* Completed result for `id` if it is STILL the active session (finished while
   the caller was away, before a new session replaced it). */
export function finishedReview(id) {
  return active && active.id === id && active.done && active.result ? active.result : null;
}

/* Subscribe a listener. getId() is called on every emit so the component can
   point at whichever session is currently relevant. Returns an unsubscribe
   fn. The callback fires immediately with the snapshot when getId() already
   matches the active session. */
export function attachReview(getId, cb) {
  const l = { getId, cb };
  listeners.add(l);
  const id = getId();
  if (id && active && active.id === id) cb(snapshot());
  return () => { listeners.delete(l); };
}