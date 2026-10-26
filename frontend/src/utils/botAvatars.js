/* Bot avatar resolution.
 *
 * ASSET NOTE: `src/assets/bots/*.webp` are wired up with Vite (`new URL(...)`
 * in data/bots.ts) so they are hashed, optimised and lazily fetched. The files
 * currently in the repo are 0-byte placeholders, which decode as broken images.
 * Rather than ship invisible portraits, `BotAvatar` swaps in an ORIGINAL
 * generated SVG on the image's error event — initials on a per-bot hue, with a
 * chess motif. That keeps the feature fully functional today and makes
 * replacement a pure file drop: put a real `nova.webp` next to the others and
 * the very next render uses it, because the `<img>` is always tried first and
 * the fallback only appears when decoding fails.
 *
 * Nothing here reaches the network. There is deliberately NO DiceBear or other
 * remote avatar URL: bot games must keep working offline (§25), and the
 * generated art is original to this project.
 */

/** Deterministic hue so a bot always looks the same everywhere. */
export function hueFor(bot) {
  const h = Number(bot?.hue);
  if (Number.isFinite(h)) return ((h % 360) + 360) % 360;
  const id = String(bot?.id || 'bot');
  let sum = 0;
  for (let i = 0; i < id.length; i++) sum = (sum * 31 + id.charCodeAt(i)) % 360;
  return sum;
}

/* REMOVED: initialsFor() — the two-letter monogram.
 *
 * It produced the letter avatars ("PI" for Pip) and was ambiguous by
 * construction: `mia` and `milo` both render "MI". Every bot now has a real
 * portrait in public/assets/bots/, so there is no letter to derive. The
 * `initials` field on ChessBot is left in place so existing data and tests are
 * untouched; only the code that turned it into artwork is gone. */

/** The bundled portrait URL, or null when the bot has none. */
export function getBotAvatar(bot) {
  const src = bot?.avatar;
  if (typeof src === 'string' && src.length > 0) return src;
  return null;
}

/** Flat colour ramp derived from the bot's hue — used by CSS + the fallback. */
export function avatarColors(hue) {
  return {
    bg: `hsl(${hue} 42% 26%)`,
    bgDeep: `hsl(${(hue + 18) % 360} 46% 17%)`,
    ink: `hsl(${hue} 88% 82%)`,
    ring: `hsl(${hue} 70% 58%)`,
  };
}

export const botAvatars = {
  getBotAvatar,
  hueFor,
  avatarColors,
};

export default botAvatars;