/* In-app history boundary.
 *
 * Browser history also contains entries from BEFORE the app was opened, so
 * `window.history.length > 1` is not a safe test for "can I go back inside the
 * app" - it makes the Back control walk out to Chrome's previous page.
 *
 * This keeps a small, session-scoped stack of the entries the SPA actually
 * created (path + search). The Back control can then use the stack to decide
 * whether stepping back stays inside the app, and fall back to the role
 * dashboard otherwise.
 *
 * Kept in sessionStorage so a refresh on a deep page still knows how the user
 * arrived, without ever touching entries outside this tab.
 */
const STORAGE_KEY = 'chess:internal-history';
const MAX_ENTRIES = 100;

function read() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

function write(stack) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stack.slice(-MAX_ENTRIES)));
  } catch {
    /* Session storage can be unavailable (private mode); the Back control then
       simply treats the app as having no in-app history and lands on the
       dashboard, which is still safe. */
  }
}

function entryFor(location) {
  return `${location.pathname}${location.search || ''}`;
}

/* The dashboards are the boundary of in-app navigation. Arriving at one resets
   the stack, so Back cannot walk out of it into an earlier page (or into
   Chrome's history). */
const DASHBOARDS = new Set(['/admin/dashboard', '/student/dashboard']);

function isBoundary(entry) {
  return DASHBOARDS.has(entry.split('?')[0]);
}

/**
 * Record one router navigation. `navigationType` is React Router's value
 * ('PUSH' | 'REPLACE' | 'POP'); 'INIT' is passed once when the app mounts.
 */
export function recordNavigation(location, navigationType) {
  const entry = entryFor(location);

  if (isBoundary(entry)) {
    write([entry]);
    return;
  }

  const stack = read();

  if (navigationType === 'INIT') {
    /* A fresh tab starts a boundary at the current page. On a refresh the top
       usually matches already; if it does not (the user opened a different
       in-app URL), reset rather than allowing Back into an unrelated page. */
    if (stack[stack.length - 1] !== entry) write([entry]);
    return;
  }

  if (stack.length === 0) {
    write([entry]);
    return;
  }

  if (navigationType === 'REPLACE') {
    stack[stack.length - 1] = entry;
    write(stack);
    return;
  }

  if (navigationType === 'POP') {
    for (let i = stack.length - 1; i >= 0; i -= 1) {
      if (stack[i] === entry) {
        write(stack.slice(0, i + 1));
        return;
      }
    }
    /* Went to an entry this tab did not create (e.g. a public page opened
       before the shell). Treat it as the new boundary. */
    stack.push(entry);
    write(stack);
    return;
  }

  if (stack[stack.length - 1] !== entry) stack.push(entry);
  write(stack);
}

/** True when the immediately previous entry was created by the app itself. */
export function hasInternalPrevious() {
  return read().length > 1;
}

/** Test/reset hook used when a new session should start at a clean boundary. */
export function resetInternalHistory(location) {
  write([entryFor(location)]);
}
