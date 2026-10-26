/* Compatibility re-export — the catalogue lives in `bots.ts`.
 *
 * HISTORY: this file used to BE the catalogue: a 4-bot stub with a different
 * shape. That was a real bug, because Vite and Rollup both resolve an
 * extensionless `./data/bots` to `.js` before `.ts`, so the stub silently
 * shadowed the real 30-bot `bots.ts` and several tests failed against the wrong
 * roster. The stub's contents were deleted.
 *
 * Why the file is still here: a browser tab that was open across that deletion
 * keeps requesting `/src/data/bots.js`, and an open module graph is not fixed by
 * a reload the user has to remember to do. Re-exporting means that request now
 * resolves instead of 404ing.
 *
 * It re-exports rather than duplicating on purpose — the catalogue exists in
 * exactly one place, so the two entry points cannot drift apart again.
 *
 * The explicit `.ts` specifier is REQUIRED. Writing `./bots` here would resolve
 * back to this file and import itself.
 */
export * from './bots.ts';