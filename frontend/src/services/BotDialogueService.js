/* Bot dialogue — original lines, chosen from the live game state.
 *
 * Every line in this file is written for this project. Nothing is quoted,
 * translated or adapted from Chess.com or any other product.
 *
 * Two rules keep it from being annoying (the brief calls this out explicitly):
 *
 *   1. COOLDOWN — a line is suppressed unless enough time passed since the last
 *      one, so a bot cannot talk over itself every ply.
 *   2. RELEVANCE ONLY — a line is picked because the event it reacts to just
 *      happened: a capture, a check, a mistake, a lost position. There is no
 *      idle chatter, so a quiet game stays quiet.
 *
 * Lines are ranked by how interesting the event is, so "Check!" beats a generic
 * capture quip when both apply to the same move.
 */

/** Minimum gap between two spoken lines, in ms. */
export const COOLDOWN_MS = 2600;

/* Thresholds for "how much did that move actually give away", in centipawns.
 * 50 is roughly a free piece, so 220+ is a genuine blunder. */
export const INACCURACY_CP = 90;
export const BLUNDER_CP = 220;

const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/** Small original pools, keyed by event. */
const LINES = {
  start: [
    "Let's see what you've got.",
    'Ready when you are.',
    "I'll be watching for mistakes.",
    'Take your time. I will wait.',
  ],
  bot_capture: [
    'Mine now.',
    'That one was undefended.',
    'I am not sorry about that.',
    "I'll keep that piece.",
  ],
  bot_check: [
    'Check!',
    'You have to move the king.',
    'Try to get out of that.',
  ],
  bot_blunder: [
    'Oops. I missed that.',
    'That was not my best.',
    'I looked away for a second.',
  ],
  bot_inaccuracy: ['That was sloppy.', 'I had better.', 'Not my best move.'],
  bot_winning: ['This is going well.', 'I can feel this one.', 'Stay with me.'],
  bot_losing: ['This is getting difficult.', 'Still playing.', 'I need a comeback.'],
  human_capture: ['Ouch.', 'Well played.', 'I felt that one.', 'I will remember that square.'],
  human_check: ['That could be trouble.', 'Nice move.', 'Okay, that is awkward.'],
  human_blunder: ['Nice move.', 'I will use that.', 'Right where I wanted you.', 'Thank you for that.'],
  human_good: ['Good move.', 'That was strong.', 'You are playing well.'],
  win: [],
  loss: [],
  draw: [],
};

/** Pick one at random, avoiding an immediate repeat where possible. */
function pick(pool, lastRef) {
  if (!pool || !pool.length) return null;
  if (pool.length === 1) return pool[0];
  const choices = pool.filter((l) => l !== lastRef.current);
  const chosen = choices[Math.floor(Math.random() * choices.length)] || pool[0];
  lastRef.current = chosen;
  return chosen;
}

function opposite(color) {
  return color === 'w' ? 'b' : 'w';
}

/** Rough material balance from one side's point of view. */
export function evaluateMood(game, color) {
  if (!game || typeof game.board !== 'function') return 'balanced';
  let mine = 0;
  let theirs = 0;
  for (const row of game.board()) {
    for (const sq of row) {
      if (!sq) continue;
      const v = PIECE_VALUE[sq.type] || 0;
      if (sq.color === color) mine += v;
      else theirs += v;
    }
  }
  const diff = mine - theirs;
  if (diff >= 6) return 'winning';
  if (diff <= -4) return 'losing';
  return 'balanced';
}

/**
 * Decide what the bot says after a move.
 *
 * @param {object}   opts
 * @param {object}   opts.bot        the bot record (for personality + result lines)
 * @param {'bot'|'human'} opts.actor who just moved
 * @param {object}   opts.move       verbose chess.js move
 * @param {Chess}    opts.gameAfter  position AFTER the move
 * @param {number}   [opts.lossCp]   centipawns the actor gave away, if known
 * @param {string}   [opts.avoid]    line the caller just spoke, so we can
 *                                    repeat something else
 * @returns {string|null}
 */
export function reactToMove({ bot, actor, move, gameAfter, lossCp = 0, avoid = null }) {
  if (!bot || !actor || !move) return null;

  /* The result modal speaks instead once the game is over. */
  if (gameAfter && typeof gameAfter.isDraw === 'function') {
    if (gameAfter.isCheckmate() || gameAfter.isStalemate() || gameAfter.isDraw()) return null;
  }

  const botIsActor = actor === 'bot';
  const san = String(move.san || '');
  const gaveAway = Number.isFinite(lossCp) ? Number(lossCp) : 0;
  const ref = { current: avoid };

  /* Ranked by interest. Mistake talk wins over capture talk, because reacting
   * to a blunder is more characterful than reacting to any trade. */
  if (gaveAway >= BLUNDER_CP) {
    return pick(botIsActor ? LINES.bot_blunder : LINES.human_blunder, ref);
  }

  const isCheck = san.includes('+') || san.includes('#');
  const isCapture = Boolean(move.captured);

  if (botIsActor) {
    if (gaveAway >= INACCURACY_CP) return pick(LINES.bot_inaccuracy, ref);
    if (isCheck) return pick(LINES.bot_check, ref);
    if (isCapture) return pick(LINES.bot_capture, ref);
  } else {
    if (isCheck) return pick(LINES.human_check, ref);
    if (isCapture) return pick(LINES.human_capture, ref);
  }

  /* Mood commentary: only when the position is decided enough to be worth
   * remarking on. The speaker tracks mood changes so this does not repeat. */
  if (gameAfter) {
    const moverColor = move.color || 'w';
    const mood = evaluateMood(gameAfter, moverColor);
    if (mood === 'winning') {
      return pick(botIsActor ? LINES.bot_winning : LINES.human_good, ref);
    }
    if (mood === 'losing') {
      return pick(botIsActor ? LINES.bot_losing : null, ref);
    }
  }

  return null;
}

/** Line for a lifecycle event: 'start' | 'win' | 'loss' | 'draw'. */
export function lineForEvent(bot, event) {
  if (!bot) return null;
  if (event === 'start') return pick(LINES.start, { current: null });
  if (event === 'win') return bot.winMessage || null;
  if (event === 'loss') return bot.loseMessage || null;
  if (event === 'draw') return bot.drawMessage || 'A fair fight.';
  return null;
}

/**
 * A stateful speaker that applies the cooldown and the no-repeat rule across
 * moves. Create ONE per game — the point is that the bot remembers.
 */
export function createBotSpeaker(bot, { enabled = true, cooldownMs = COOLDOWN_MS, now = () => Date.now() } = {}) {
  let lastAt = -Infinity;
  let lastLine = null;
  let lastMood = 'balanced';

  return {
    get last() {
      return lastLine;
    },

    /** Opening line. Always allowed, even during a cooldown. */
    greet() {
      if (!enabled) return null;
      const line = lineForEvent(bot, 'start');
      if (line) {
        lastAt = now();
        lastLine = line;
      }
      return line;
    },

    /**
     * React to a played move.
     * @returns {string|null} a line, or null when muted / on cooldown.
     */
    react({ actor, move, gameAfter, lossCp = 0 }) {
      if (!enabled || !move) return null;
      const t = now();
      if (t - lastAt < cooldownMs) return null;

      /* Track mood changes even when we stay silent, so the next eligible move
       * comments on the CURRENT mood rather than a stale one. */
      if (gameAfter && move.color) lastMood = evaluateMood(gameAfter, move.color);

      const line = reactToMove({ bot, actor, move, gameAfter, lossCp, avoid: lastLine });
      if (!line) return null;
      lastAt = t;
      lastLine = line;
      return line;
    },

    /** Result line. Exempt from the cooldown — the game is over. */
    finish(result) {
      if (!enabled) return null;
      const line = lineForEvent(bot, result);
      if (line) lastLine = line;
      return line;
    },

    get mood() {
      return lastMood;
    },

    reset() {
      lastAt = -Infinity;
      lastLine = null;
      lastMood = 'balanced';
    },
  };
}

export const BotDialogueService = {
  createBotSpeaker,
  reactToMove,
  lineForEvent,
  evaluateMood,
  COOLDOWN_MS,
  INACCURACY_CP,
  BLUNDER_CP,
};

export default BotDialogueService;