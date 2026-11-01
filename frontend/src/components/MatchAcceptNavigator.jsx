import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { onNotification } from '../services/socket';

/* Open the board the moment a match is ACCEPTED — from anywhere in the app.
 *
 * Accepting used to leave you where you were. Accepting from the notification
 * panel landed on the dashboard with a toast; the OTHER player, whose accept
 * arrived only as a socket push, saw nothing at all and had to find the game by
 * hand. A game that is live and unopened looks, from the outside, like the
 * request did nothing.
 *
 * Mounted once in the app shell, so it covers every route: dashboard, puzzles,
 * profile, classroom. Both sides are driven by the same signal, because the
 * backend writes an `accepted` notification row for the acceptor AND for the
 * sender when a challenge is accepted.
 *
 * Guards:
 *   once per game     — the accept is announced over several channels (the
 *                       socket push and the 30 s feed sync), and a duplicate
 *                       navigate would re-key the route and flash the page.
 *   not already there — if this IS the board for that game, do nothing; the page
 *                       is already showing it and re-navigating would reset it.
 *   only accepted     — a `declined` row for the same game must not open a board.
 *
 * Overlays: the portal shells already close the mobile drawer on any path change
 * (AppShell's location effect), so navigating is itself the dismissal. The
 * notification panel is the one thing that outlives a route change because it is
 * mounted in the shell, not the page, so a `chess-close-panels` event is
 * broadcast to close it.
 */
export default function MatchAcceptNavigator() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const handledRef = useRef(new Set());

  /* The listener is attached once and must survive navigations, so it cannot
     close over `location` — that value would be the path from whenever the
     effect last ran. Read it through a ref that every render keeps current. */
  const locationRef = useRef(location);
  locationRef.current = location;

  useEffect(() => {
    if (!user) return undefined;

    const boardBase = user.role === 'admin' || user.role === 'superadmin' ? '/admin' : '/student';

    return onNotification((n) => {
      if (n?.type !== 'match_request') return;
      if (n.request_status !== 'accepted') return;
      const gameId = n.related_id;
      if (!gameId) return;

      if (handledRef.current.has(String(gameId))) return;
      handledRef.current.add(String(gameId));

      const here = locationRef.current;
      const target = `${boardBase}/analysis`;
      const params = new URLSearchParams(here.search);
      const alreadyOnThisBoard =
        here.pathname === target && String(params.get('game') || '') === String(gameId);
      if (alreadyOnThisBoard) return;

      window.dispatchEvent(new CustomEvent('chess-close-panels'));
      navigate(`${target}?game=${encodeURIComponent(gameId)}`);
    });
    // location is read through the ref above; re-subscribing on every path
    // change would tear the listener down and back up on each navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.role, navigate]);

  return null;
}
