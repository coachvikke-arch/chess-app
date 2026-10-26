/* useGameTimer — an opponent-side game clock.
 *
 * Built on a wall-clock deadline rather than a tick counter, because a bot game
 * has two independent things that must not lose time:
 *   - the ENGINE thinking delay (which may be seconds and is not the player's
 *     doing), and
 *   - the human actually looking at the board.
 *
 * A `setInterval` that decrements a counter drifts badly under a blocked main
 * thread — and the main thread here is shared with a WASM engine booting, a
 * board animating and a result modal. So the timer stores the deadline for the
 * side to move and recomputes from `Date.now()` every frame. A tab that was
 * backgrounded for 40 seconds comes back and reports the correct remaining time
 * instead of silently gifting the player a minute.
 *
 * `seconds === 0` means no clock (Unlimited) and the whole hook goes inert.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/** ms -> "M:SS" or "H:MM:SS" */
export function formatClock(ms, { forceHours = false } = {}) {
  if (ms == null) return '--:--';
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  if (h > 0 || forceHours) return `${h}:${pad(m)}:${pad(s)}`;
  return `${m}:${pad(s)}`;
}

/**
 * @param {object} opts
 * @param {number} opts.seconds        initial time per side (0 = unlimited)
 * @param {'w'|'b'} opts.turn          side to move
 * @param {boolean} opts.running       false pauses the clock entirely
 * @param {boolean} opts.pauseWhileThinking  hold the side-to-move clock while
 *                                          the engine computes (default: off,
 *                                          matching normal online rules)
 * @param {()=>'w'|'b'} opts.thinkingSide  which side the engine is moving, used
 *                                          with `pauseWhileThinking`
 */
export function useGameTimer({
  seconds = 0,
  turn = 'w',
  running = true,
  pauseWhileThinking = false,
  thinkingSide = null,
  onFlag = null,
} = {}) {
  const unlimited = !seconds || seconds <= 0;

  /* Remaining time per side, in ms. Mutated in place each frame and mirrored
   * into React state at a low frequency so we re-render ~4x a second, not 60. */
  const msRef = useRef({ w: seconds * 1000, b: seconds * 1000 });
  const deadlineRef = useRef(null);
  const [display, setDisplay] = useState(() => ({
    w: seconds * 1000,
    b: seconds * 1000,
  }));

  const turnRef = useRef(turn);
  const runningRef = useRef(running);
  const pauseRef = useRef(pauseWhileThinking);
  const thinkingRef = useRef(thinkingSide);
  const flaggedRef = useRef(null);
  const onFlagRef = useRef(onFlag);

  turnRef.current = turn;
  runningRef.current = running;
  pauseRef.current = pauseWhileThinking;
  thinkingRef.current = thinkingSide;
  onFlagRef.current = onFlag;

  /* Seed / reseed (new game, rematch, changed time control). */
  useEffect(() => {
    msRef.current = { w: seconds * 1000, b: seconds * 1000 };
    deadlineRef.current = null;
    flaggedRef.current = null;
    setDisplay({ w: seconds * 1000, b: seconds * 1000 });
  }, [seconds]);

  const paused = useMemo(() => {
    if (!running || unlimited) return true;
    return Boolean(pauseWhileThinking && thinkingSide && thinkingSide === turn);
  }, [running, unlimited, pauseWhileThinking, thinkingSide, turn]);

  /* One interval for the whole hook. It re-arms the deadline whenever the side
   * to move changes, and never lets the countdown drift because every read is
   * against `Date.now()`. */
  useEffect(() => {
    if (unlimited) return undefined;

    const tick = () => {
      const now = Date.now();
      const cur = turnRef.current;

      /* Pause the active side (e.g. while the engine thinks). */
      if (paused) {
        deadlineRef.current = null;
        return;
      }

      /* Arm the deadline on the first frame of this turn. */
      if (deadlineRef.current == null) {
        deadlineRef.current = now + msRef.current[cur];
      }

      const remaining = Math.max(0, deadlineRef.current - now);
      msRef.current[cur] = remaining;

      if (remaining <= 0 && flaggedRef.current !== cur) {
        flaggedRef.current = cur;
        deadlineRef.current = null;
        setDisplay({ ...msRef.current });
        if (onFlagRef.current) onFlagRef.current(cur);
        return;
      }

      setDisplay((prev) =>
        prev.w === msRef.current.w && prev.b === msRef.current.b
          ? prev
          : { w: msRef.current.w, b: msRef.current.b },
      );
    };

    /* 250ms is smooth enough for a chess clock and costs 4 renders a second. */
    const id = setInterval(tick, 250);
    tick();
    return () => clearInterval(id);
  }, [unlimited, paused]);

  /* Turn changed → the previous deadline was for the wrong side. */
  useEffect(() => {
    deadlineRef.current = null;
  }, [turn]);

  const reset = useCallback(
    (newSeconds = seconds) => {
      msRef.current = { w: newSeconds * 1000, b: newSeconds * 1000 };
      deadlineRef.current = null;
      flaggedRef.current = null;
      setDisplay({ w: newSeconds * 1000, b: newSeconds * 1000 });
    },
    [seconds],
  );

  return {
    unlimited,
    paused,
    white: display.w,
    black: display.b,
    format: formatClock,
    reset,
    raw: msRef,
  };
}

export default useGameTimer;