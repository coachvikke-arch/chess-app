/* Pure helpers for the live-classroom "X joined" toasts.
 *
 * Kept free of React and of the DOM so the stacking/grouping and the
 * perspective wording can be unit-tested directly (see
 * scripts/join-toast.test.mjs) instead of only through the rendered UI.
 */

/** At most this many join cards are shown at once; a burst collapses. */
export const MAX_VISIBLE_JOIN_TOASTS = 3;

/** How long a join card stays up before it auto-dismisses (ms). */
export const JOIN_TOAST_MS = 4000;

/**
 * Append one join toast to the visible stack.
 *
 * Up to `max` arrivals stack individually. Once the stack is full the next
 * arrival merges everything into a single "N students joined" card so a rush of
 * students cannot bury the board under a long column of names.
 *
 * @param {Array} list    current visible toasts (each has id/bornAt/kind/count)
 * @param {object} entry  { id, name, initial, message, title, mine, bornAt }
 * @returns {Array} the next list (never mutates the input)
 */
export function appendJoinToast(list, entry, { max = MAX_VISIBLE_JOIN_TOASTS, now = Date.now() } = {}) {
  const next = Array.isArray(list) ? list.slice() : [];
  /* Once the stack has collapsed into a group, every further arrival feeds that
     same card rather than spawning fresh singles around it - otherwise the
     count would reset and the room would fill with cards again. */
  const group = next.find((t) => t.kind === 'group');
  if (group) {
    const count = group.count + 1;
    return next.map((t) => (
      t.id === group.id
        ? { ...t, count, message: `${count} students joined`, title: 'Students joined', bornAt: now }
        : t
    ));
  }
  if (next.length >= max) {
    const count = next.length + 1;
    return [{
      ...entry,
      kind: 'group',
      count,
      title: 'Students joined',
      message: `${count} students joined`,
      bornAt: now,
    }];
  }
  return [...next, { ...entry, kind: 'single', count: 1, bornAt: entry.bornAt ?? now }];
}

/**
 * Drop join cards whose lifetime has elapsed. Cards the pointer is holding
 * (`isHeld`) are kept regardless of age, which is what makes hover pause work.
 */
export function pruneJoinToasts(list, { now = Date.now(), lifetime = JOIN_TOAST_MS, isHeld = () => false } = {}) {
  return (Array.isArray(list) ? list : [])
    .filter((t) => isHeld(t.id) || now - t.bornAt < lifetime);
}

/**
 * Wording for a join event, from the viewer's point of view.
 *
 * @param {object} p
 * @param {string} p.name       joiner's display name
 * @param {string} p.role       roleInClass: 'host' | 'student' | ...
 * @param {string} p.className  the class title
 * @param {boolean} p.isMe      true when the viewer IS the joiner
 * @returns {{ title: string, message: string }}
 */
export function describeJoin({ name, role, className, isMe } = {}) {
  const who = String(name || '').trim() || 'Someone';
  if (isMe) {
    return { title: 'Welcome', message: `You joined ${className || 'the class'}` };
  }
  const host = role === 'host' || role === 'instructor' || role === 'teacher';
  return {
    title: host ? 'Coach joined' : 'Student joined',
    message: `${who} joined the class`,
  };
}
