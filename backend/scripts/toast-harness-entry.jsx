/* Harness entry: drives the REAL showToast from Toast.jsx through the exact
 * call sequence one match request produces (arena invite toast, then the
 * bell's match-request popup for the same game, then an unrelated request).
 * Bundled with esbuild (react aliased to the stub) and executed by
 * test-toast-debug-log.cjs.
 */
import { ToastProvider, useToast } from '../../frontend/src/components/Toast.jsx';
import { resetHooks } from './toast-harness-stub-react.cjs';
import { matchRequestKey } from '../../frontend/src/utils/toastDedupe.js';

export function runScenario() {
  resetHooks();
  ToastProvider({ children: null }); // mount: hooks run, context value is set
  const { showToast } = useToast();

  // 1. Receiver sits on the Play Arena: `game-invite` socket event fires.
  const id1 = showToast('Nagavel invited you to a game (5+0).', {
    title: '♟ Online game request',
    duration: 60000,
    dedupeKey: matchRequestKey(1491, 7),
    source: 'AnalysisBoard:game_invite',
  });
  // 2. Same request, same second: bell's `notification` (match_request) popup.
  const id2 = showToast('Nagavel sent you a match request.', {
    title: '♞ Match request',
    tone: 'info',
    duration: 60000,
    dedupeKey: matchRequestKey(1491, 7),
    source: 'NotificationBell:match_request_popup',
  });
  // 3. A different request: must NOT be suppressed.
  const id3 = showToast('Arjun sent you a match request.', {
    title: '♞ Match request',
    tone: 'info',
    duration: 60000,
    dedupeKey: matchRequestKey(1500, 7),
    source: 'NotificationBell:match_request_popup',
  });
  return { id1, id2, id3 };
}
