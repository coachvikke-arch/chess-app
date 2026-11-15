import happy from "./img/bot-happy.png";
import sad from "./img/bot-sad.png";
import alert from "./img/bot-alert.png";
import neutral from "./img/bot-neutral.png";

// Routes where the bot is hidden. A route is hidden if its path contains any of these strings.
// Change these to match your real route paths.
export const HIDDEN_ROUTES = ["live-class", "classroom", "drill"];

// How long a bubble stays on screen, in milliseconds.
export const BUBBLE_MS = 5000;

// One image per mood. calm uses the smiling face. Swap any file in bot/img to change a face.
export const moodImages = { calm: happy, happy, sad, alert, neutral };
