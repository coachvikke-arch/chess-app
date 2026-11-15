import happy from "./img/bot-happy.png";
import sad from "./img/bot-sad.png";
import alert from "./img/bot-alert.png";
import neutral from "./img/bot-neutral.png";
import pngFallback from "../../src/assets/bot/bot-happy.png";

// Routes where the bot is hidden. A route is hidden if its path contains any of these strings.
// Change these to match your real route paths.
export const HIDDEN_ROUTES = ["live-class", "classroom", "drill"];

// How long a bubble stays on screen, in milliseconds.
export const BUBBLE_MS = 5000;

// Every mood the character can play. "calm" is the legacy name for idle and is
// mapped here so older call sites keep working unchanged.
export const MOODS = [
  "idle", "wave", "happy", "jump", "sad", "cry",
  "fly", "blessing", "alert", "neutral",
];

export const normalizeMood = (mood) => (mood === "calm" || !mood ? "idle" : mood);

// How long one emotion performance lasts, in milliseconds. The idle pose is a
// permanent CSS loop and has no entry.
export const MOOD_MS = {
  idle: 0,
  wave: 2200,
  happy: 2200,
  jump: 3000,
  sad: 2800,
  cry: 3400,
  fly: 2600,
  blessing: 3200,
  alert: 1500,
  neutral: 2200,
};

// One image per mood, used only if the animated SVG cannot be parsed.
export const moodImages = {
  idle: happy,
  calm: happy,
  wave: happy,
  happy,
  jump: happy,
  sad,
  cry: sad,
  fly: alert,
  blessing: neutral,
  alert,
  neutral,
};

export const PNG_FALLBACK = pngFallback;
