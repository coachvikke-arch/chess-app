/* Bridges the live classroom and the Bot Arena.
 *
 * A bot game is played on its own page, so when one is finished there is no
 * prop chain that could tell the reporter which class the student was sitting
 * in. The classroom writes its id here while it is open, the bot game reads it
 * when submitting a result, and the classroom clears it on the way out.
 *
 * localStorage rather than a React context because the two pages are never
 * mounted at the same time - a bot game opens in a new tab while the classroom
 * stays open in the first one.
 *
 * Staleness: a closed or crashed tab never runs cleanup, so the value carries
 * a timestamp (`at`) and readers enforce a TTL (5 minutes). Anything missing
 * the timestamp, or older than the TTL, counts as stale and is dropped (and
 * removed). While a classroom is open it re-writes the timestamp on a
 * heartbeat (BOT_CONTEXT_HEARTBEAT_MS), so a live class never looks stale but
 * one tab closing cannot wipe an entry a second tab is still heartbeating -
 * the heartbeat simply re-creates it on its next tick.
 *
 * Safety: this is a *hint*, not authority. The server re-checks membership
 * before attributing anything (see botController.submitResult), so a stale or
 * hand-edited value can cost a leaderboard line and nothing else.
 */

const KEY = 'liveBotGameContext';

/* How long a written entry stays valid without a heartbeat refresh. */
const CONTEXT_TTL_MS = 5 * 60 * 1000;

/* How often an open classroom re-stamps its entry while it is alive. */
export const BOT_CONTEXT_HEARTBEAT_MS = 30 * 1000;

function readRaw() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    /* Private mode / storage disabled: treat as absent, callers fall back to
       arena-only behaviour. */
    return null;
  }
}

function isFresh(parsed) {
  const at = parsed ? Number(parsed.at) : NaN;
  if (!Number.isFinite(at)) return false;
  return Date.now() - at < CONTEXT_TTL_MS;
}

export function setBotGameContext(ctx) {
  try {
    if (!ctx || ctx.classId == null) {
      localStorage.removeItem(KEY);
      return;
    }
    localStorage.setItem(
      KEY,
      JSON.stringify({ classId: ctx.classId, title: ctx.title || '', at: Date.now() })
    );
  } catch {
    /* Private mode / storage disabled: the bot game simply counts for the arena
       only, which is the pre-existing behaviour. */
  }
}

/* Re-stamp the entry's timestamp without changing anything else — but only
 * when the stored entry belongs to the given class (compared as strings, so
 * numeric and string ids agree). A tab heartbeating for class A must never
 * revive class B's entry.
 */
export function touchBotGameContext(classId) {
  try {
    if (classId == null) return;
    const parsed = readRaw();
    if (!parsed || String(parsed.classId) !== String(classId)) return;
    localStorage.setItem(
      KEY,
      JSON.stringify({ classId: parsed.classId, title: parsed.title || '', at: Date.now() })
    );
  } catch {
    /* ignore */
  }
}

export function clearBotGameContext(classId) {
  try {
    /* Scoped clear: only remove the entry when it belongs to this class, so
       one closing tab cannot wipe a hint another tab is still using. With no
       argument the clear is unconditional, as before. */
    if (classId != null) {
      const parsed = readRaw();
      if (parsed && String(parsed.classId) !== String(classId)) return;
    }
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function getBotGameContext() {
  try {
    const parsed = readRaw();
    if (!parsed || parsed.classId == null) return null;
    /* Entries without a timestamp count as stale (they predate the TTL), as
       does anything older than the TTL. Stale reads also remove the key so
       the rot does not accumulate. */
    if (!isFresh(parsed)) {
      try {
        localStorage.removeItem(KEY);
      } catch {
        /* ignore */
      }
      return null;
    }
    const classId = parseInt(parsed.classId, 10);
    if (!Number.isFinite(classId)) return null;
    return { classId, title: parsed.title || '' };
  } catch {
    return null;
  }
}
