import { lazy } from 'react';

/**
 * Code-split the heavy routes. Each page becomes its own chunk, loaded on
 * first navigation (or earlier, via preloadRoute on menu hover/focus).
 *
 * The lazy components and the preload map live in ONE module so the dynamic
 * `import()` specifiers are identical — Rollup resolves them to the same
 * chunk, so a hover-preload warms the exact file the click will need.
 */

export const GameReview = lazy(() => import('../pages/GameReview'));
export const AnalysisBoard = lazy(() => import('../pages/AnalysisBoard'));
export const OpeningsLibrary = lazy(() => import('../pages/OpeningsLibrary'));
export const OpeningDetail = lazy(() => import('../pages/OpeningDetail'));
export const OpeningPractice = lazy(() => import('../pages/OpeningPractice'));
export const AdminGmGames = lazy(() => import('../pages/AdminGmGames'));
export const BotsPage = lazy(() => import('../pages/BotsPage'));
export const BotGamePage = lazy(() => import('../pages/BotGamePage'));
export const LiveClassroom = lazy(() => import('../pages/LiveClassroom'));
export const Puzzles = lazy(() => import('../pages/Puzzles'));
export const MessagesPage = lazy(() => import('../pages/MessagesPage'));

/* Path prefix -> chunk loader. Longest match wins (first hit in order, so
   /openings/.../practice is listed before /openings/...). */
const preloaders = [
  [/^\/(admin|student)\/review/, () => import('../pages/GameReview')],
  [/^\/(admin|student)\/analysis/, () => import('../pages/AnalysisBoard')],
  [/^\/openings\/.+\/practice/, () => import('../pages/OpeningPractice')],
  [/^\/openings\/.+/, () => import('../pages/OpeningDetail')],
  [/^\/openings/, () => import('../pages/OpeningsLibrary')],
  [/^\/(admin|student)\/gm-games/, () => import('../pages/AdminGmGames')],
  [/^\/play\/bots/, () => import('../pages/BotsPage')],
  [/^\/play\/bot\//, () => import('../pages/BotGamePage')],
  [/^\/live-class\//, () => import('../pages/LiveClassroom')],
  [/^\/student\/puzzles/, () => import('../pages/Puzzles')],
  [/^\/(admin|student)\/messages/, () => import('../pages/MessagesPage')],
];

/**
 * Warm the chunk for an in-app path. Called from the sidebar on hover/focus so
 * the click feels instant. Failures are swallowed — a preload miss only means
 * the click pays the normal load cost.
 */
export function preloadRoute(pathname) {
  if (!pathname) return;
  for (const [pattern, load] of preloaders) {
    if (pattern.test(pathname)) {
      load().catch(() => {});
      return;
    }
  }
}
