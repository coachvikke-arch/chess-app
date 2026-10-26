import { useEffect } from 'react';
import { setVisibleEffectHost } from '../effects/moveEffect/visibleHost.js';

/**
 * Declare this board as the one move effects must play on.
 *
 * A surface with ONE board calls it with that board's host id, so every effect
 * it triggers lands on the board the user is looking at — not on whichever board
 * was touched last. A surface with TWO boards (the Play Arena's page board and
 * its full-screen Play Mode board) passes the one that is on top; the previous
 * target is restored when it changes or the surface unmounts.
 *
 * @param {string|null} hostId  the host id of the board on top
 */
export default function useVisibleEffectHost(hostId) {
  useEffect(() => {
    if (!hostId) return undefined;
    return setVisibleEffectHost(hostId);
  }, [hostId]);
}
