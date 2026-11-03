import { useEffect, useRef } from 'react';

/**
 * Re-run `onChanged` when this device changes its own profile photo or avatar.
 *
 * Panels that paint avatars from their own server snapshots — leaderboard, chat
 * People list, ratings, the champions podium, student dashboards and reports —
 * need this. A profile write cannot invalidate the GETs they cached, and they do
 * not remount just because the picture changed, so without it the new image only
 * appears on the next navigation.
 *
 * The callback is held in a ref, so callers can pass a fresh inline function
 * without re-subscribing the listener on every render.
 */
export function useProfileChanged(onChanged) {
  const handler = useRef(onChanged);
  handler.current = onChanged;
  useEffect(() => {
    const run = () => handler.current();
    window.addEventListener('profile:changed', run);
    return () => window.removeEventListener('profile:changed', run);
  }, []);
}

export default useProfileChanged;
