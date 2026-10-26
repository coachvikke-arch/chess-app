import { useEffect } from 'react';
import { onMatchDeclined } from '../services/socket';
import { useToast } from './Toast';

/*
 * Global, always-mounted listener for the targeted "match-declined" socket event.
 *
 * The backend emits this event ONLY to the ORIGINAL SENDER's user room
 * (never broadcast, never the decliner), so it is safe to react globally: the
 * only client that ever receives it is the right one.
 *
 * On fire it:
 *   1. Shows "[Opponent] declined your match request" as an error toast.
 *   2. Re-broadcasts a DOM `match-declined` custom event (with the payload as
 *      `detail`) so whichever page is open — e.g. the Play Arena — can close the
 *      pending game, dismiss the invite bar, and refresh its list in real time.
 *
 * The socket listener unsubscribes automatically when this component unmounts.
 */
export default function MatchDeclineListener() {
  const { showToast } = useToast();

  useEffect(() => {
    const unsub = onMatchDeclined((payload) => {
      if (!payload) return;
      showToast(payload.message || 'Your match request was declined.', {
        tone: 'error',
        title: '✕ Match declined',
        duration: 6000,
      });
      window.dispatchEvent(new CustomEvent('match-declined', { detail: payload }));
    });
    return unsub;
  }, [showToast]);

  return null;
}