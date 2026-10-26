/* ── MoveEffect haptics ─────────────────────────────────────────────────────
 *
 * Distinct vibration patterns for each event type, triggered at the start
 * of the corresponding animation.
 *
 * Uses the Vibration API (navigator.vibrate) — works on Android/Chrome.
 * iOS Safari has no Vibration API (silent no-op).
 *
 * The Vibration API replaces a running pattern instead of layering a new one,
 * so each pattern is self-contained. Strength scales the "on" durations
 * because the Vibration API has no amplitude channel.
 *
 * Patterns (adjusted to ≤400ms total duration):
 *   Promotion:    Rising triple buzz — [65, 35, 65, 35, 100]  (on/off/on/off/on)
 *   Brilliant:    Double tap + punch — [45, 30, 45, 30, 180]  (on/off/on/off/on)
 *   Checkmate:    Two heavy hits    — [100, 50, 200]          (on/off/on)
 *
 * Respects the in-app Vibration preference and strength (config/haptics.js).
 * Returns a disposer that clears pending timers and cancels vibration.
 */

import { T, EFFECT_HAPTIC_SCALE } from './config.js';
import { getHapticStrength, getHaptics, hapticStrengthScale } from '../../config/haptics.js';

/* Distinct vibration patterns per event type.
 * Each pattern is an array of [on, off, on, off, ...] in milliseconds.
 * The Web Vibration API interprets this as: vibrate for on1, pause for off1, vibrate for on2, etc.
 * Total duration must be ≤400ms.
 */
const HAPTIC_PATTERNS = {
  promotion: {
    // Rising triple buzz: short → medium → long
    // Timings: [0, 65, 35, 65, 35, 100] → on/off pairs: 65ms on, 35ms off, 65ms on, 35ms off, 100ms on
    // Total: 65+35+65+35+100 = 300ms
    pattern: [65, 35, 65, 35, 100],
    // Delay from animation start (T.landing = 470ms is when piece lands)
    // Promotion morph happens at landing, so trigger at T.landing
    delayMs: T.landing,
  },
  brilliant: {
    // Double tap + punch: two quick taps then a strong sustained hit
    // Timings: [0, 45, 30, 45, 30, 180] → on/off pairs: 45ms on, 30ms off, 45ms on, 30ms off, 180ms on
    // Total: 45+30+45+30+180 = 330ms
    pattern: [45, 30, 45, 30, 180],
    // Brilliant badge appears at T.badgePopMs (250ms after landing = 720ms)
    // But the seal badge pops at T.landing + T.badgePopMs
    delayMs: T.landing + 100, // Slightly after landing when badge appears
  },
  checkmate: {
    // Two heavy hits: first hit, pause, second longer hit
    // Timings: [0, 100, 50, 200] → on/off pairs: 100ms on, 50ms off, 200ms on
    // Total: 100+50+200 = 350ms
    pattern: [100, 50, 200],
    // Checkmate popup appears at CHECKMATE_POPUP_AT_MS (600ms)
    // The king wobble and highlight start at T.landing
    delayMs: T.landing,
  },
};

export function playMoveEffectHaptics({ type = 'brilliant', rate = 1 } = {}) {
  const noop = () => {};
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return noop;
  if (!getHaptics()) return noop;

  const patternConfig = HAPTIC_PATTERNS[type] || HAPTIC_PATTERNS.brilliant;
  const speed = 1 / Math.max(0.05, rate);
  const strength = hapticStrengthScale(getHapticStrength());
  const timers = [];

  /* Apply strength scaling to "on" durations only (odd indices: 0, 2, 4...).
   * The Vibration API has no amplitude control, so strength = longer "on" pulses.
   * Minimum 1ms to ensure the vibration fires. */
  const scaledPattern = patternConfig.pattern.map((ms, index) => {
    const isOn = index % 2 === 0; // even indices are "on" durations
    const scaled = Math.max(1, Math.round(ms * strength * speed * EFFECT_HAPTIC_SCALE));
    return isOn ? scaled : Math.max(0, Math.round(ms * speed)); // off durations scale with speed only
  });

  const delay = patternConfig.delayMs * speed;
  timers.push(setTimeout(() => {
    try { navigator.vibrate(scaledPattern); } catch { /* ignore */ }
  }, delay));

  return () => {
    timers.forEach(clearTimeout);
    try { navigator.vibrate(0); } catch { /* ignore */ }
  };
}