/* Bot catalogue — the single source of truth for "Play vs Bots".
 *
 * WHY A .ts FILE: this used to be `bots.js`, which contained `export type` /
 * `export interface`. esbuild parses every import through Vite as plain JS, so
 * that was a hard `Unexpected "type"` parse error the moment anything imported
 * it — the whole roster was unreachable dead code. Renaming to `.ts` keeps the
 * types the model needs and makes the module actually loadable. There is no
 * tsconfig in this project (Vite transpiles TS with esbuild, no typecheck step),
 * so `.ts` is purely additive and matches the existing `src/lib/*.ts` files.
 *
 * ORIGINAL CHARACTERS ONLY. Every bot here is fictional. Names, personalities,
 * dialogue and artwork are original to this project; nothing is derived from
 * Chess.com, Lichess or any real player, and no proprietary assets are used.
 *
 * `rating` IS A PRODUCT DIFFICULTY LABEL, NOT A MEASURED ELO. It exists so a
 * player has something stable and comparable to aim at. It is deliberately NOT
 * presented as a scientifically exact Stockfish Elo equivalent — see
 * `DIFFICULTY_RANKS` below, which is the honest description of what the engine
 * is actually configured to do at that band.
 */

/* ── Types ──────────────────────────────────────────────────────────────── */

export type BotDifficulty =
  | 'Beginner'
  | 'Casual'
  | 'Intermediate'
  | 'Advanced'
  | 'Expert'
  | 'Master';

export type BotPersonality =
  | 'aggressive'
  | 'defensive'
  | 'gambit'
  | 'trader'
  | 'attacker'
  | 'positional'
  | 'balanced'
  | 'endgame'
  | 'random';

/** How a bot treats its MultiPV candidate list when it picks a move. */
export interface BotThinkingTime {
  min: number;
  max: number;
}

export interface BotEngineSettings {
  /** Stockfish `Skill Level`, 0-20. */
  skillLevel: number;
  /** Search depth ceiling for the bot's own move. */
  depth?: number;
  /** Search time budget in ms. */
  moveTime?: number;
  /** How many candidate moves to ask the engine for (1-5). */
  multiPv?: number;
  /** Probability of picking a clearly inferior (but legal) candidate. */
  mistakeProb?: number;
  /** Probability of picking a blunder (but legal) candidate. */
  blunderProb?: number;
  /** Extra flattening applied to the candidate weights. */
  variance?: number;
  /** Multiplier applied to search budget once the game is a low-material endgame. */
  endgameBoost?: number;
}

export interface ChessBot {
  id: string;
  name: string;
  rating: number;
  difficulty: BotDifficulty;
  /** Alias of `difficulty` kept for the grouping/sorting code. */
  group: BotDifficulty;
  /** Vite-resolved URL of the illustrated portrait. */
  avatar: string;
  /** Original two-letter monogram drawn on the generated fallback avatar. */
  initials: string;
  /** Fictional region. Deliberately NOT a real country/flag. */
  region: string;
  /** Original character archetype (scholar, witch, corsair, …). */
  archetype: string;
  /** Accent hue (0-360) driving the generated avatar + card highlight. */
  hue: number;
  description: string;
  greeting: string;
  winMessage: string;
  loseMessage: string;
  drawMessage: string;
  thinkingTime: BotThinkingTime;
  engineSettings: BotEngineSettings;
  personality: BotPersonality;
}

/* ── Difficulty bands ───────────────────────────────────────────────────── */

export interface DifficultyBand {
  id: BotDifficulty;
  label: string;
  /** Section heading emoji on the selection page. */
  icon: string;
  blurb: string;
  /** Bots in this tier. */
  order: number;
  /**
   * The tier whose defeats would open this one. Always null — the unlock ladder
   * was removed, so no tier gates another.
   */
  unlocksFrom: BotDifficulty | null;
  /**
   * Defeats in `unlocksFrom` required to unlock this tier. Always 0, for the
   * same reason as above.
   */
  requiresDefeats: number;
  /** Bot Coins awarded for a win in this tier. */
  winCoins: number;
}

/**
 * Tier order, and what a win in each tier is worth in Bot Coins.
 *
 * These no longer gate one another. Intermediate used to need 3 Beginner
 * defeats, Advanced 5 Intermediate, then 5 and 5 again; that ladder was removed
 * so the whole roster is playable from the first visit. `unlocksFrom` is null
 * and `requiresDefeats` 0 for every tier, deliberately left in place rather than
 * deleted: BotProgressService reads them to decide "is this playable", and the
 * progression tests on both sides of the wire assert against them, so an
 * all-zero ladder keeps one implementation instead of two.
 */
export const DIFFICULTY_BANDS: DifficultyBand[] = [
  {
    id: 'Beginner',
    label: 'Beginner',
    icon: '♟',
    order: 0,
    blurb: 'Learning the moves',
    unlocksFrom: null,
    requiresDefeats: 0,
    winCoins: 5,
  },
  {
    id: 'Casual',
    label: 'Casual',
    icon: '⚡',
    order: 1,
    blurb: 'Warm-up opposition',
    unlocksFrom: null,
    requiresDefeats: 0,
    winCoins: 8,
  },
  {
    id: 'Intermediate',
    label: 'Intermediate',
    icon: '🔥',
    order: 2,
    blurb: 'Sharper opposition',
    unlocksFrom: null,
    requiresDefeats: 0,
    winCoins: 12,
  },
  {
    id: 'Advanced',
    label: 'Advanced',
    icon: '⚔',
    order: 3,
    blurb: 'Strong opposition',
    unlocksFrom: null,
    requiresDefeats: 0,
    winCoins: 20,
  },
  {
    id: 'Expert',
    label: 'Expert',
    icon: '👑',
    order: 4,
    blurb: 'Very strong opposition',
    unlocksFrom: null,
    requiresDefeats: 0,
    winCoins: 30,
  },
  {
    id: 'Master',
    label: 'Master',
    icon: '💎',
    order: 5,
    blurb: 'The toughest bots',
    unlocksFrom: null,
    requiresDefeats: 0,
    winCoins: 50,
  },
];

export const BOT_GROUPS: BotDifficulty[] = DIFFICULTY_BANDS.map((b) => b.id);

/** Top-of-page "New to Chess" shelf: the easiest few unplayed bots. */
export const NEWCOMER_BOT_IDS: string[] = ['pip', 'mia', 'leo', 'nova', 'toby'];

/* ── Engine tuning ladder ───────────────────────────────────────────────── */

/**
 * Honest description of the difficulty curve.
 *
 * These are the numbers the engine layer ACTUALLY uses (skill level, move time,
 * depth, candidate width). They are derived from the product labels in the
 * original brief, rounded into a single reusable table so the bot page, the
 * bot roster and the match screen can never disagree about what a given rating
 * band means.
 *
 * `candidates` drives the MultiPV width used for personality-weighted choice.
 * `variance` > 0 flattens that choice so weaker bots miss things on purpose.
 */
export interface DifficultyRank {
  rating: number;
  skillLevel: number;
  moveTime: number;
  depth: number;
  candidates: number;
  /** 0 = always the top move, 1 = essentially uniform over the candidate list. */
  variance: number;
}

export const DIFFICULTY_RANKS: DifficultyRank[] = [
  { rating: 150,  skillLevel: 0,  moveTime: 100,  depth: 4,  candidates: 4, variance: 0.62 },
  { rating: 400,  skillLevel: 1,  moveTime: 150,  depth: 5,  candidates: 4, variance: 0.55 },
  { rating: 700,  skillLevel: 3,  moveTime: 250,  depth: 7,  candidates: 4, variance: 0.40 },
  { rating: 1000, skillLevel: 5,  moveTime: 350,  depth: 9,  candidates: 3, variance: 0.26 },
  { rating: 1300, skillLevel: 7,  moveTime: 500,  depth: 11, candidates: 3, variance: 0.15 },
  { rating: 1600, skillLevel: 10, moveTime: 650,  depth: 12, candidates: 2, variance: 0.08 },
  { rating: 1900, skillLevel: 13, moveTime: 800,  depth: 14, candidates: 2, variance: 0.04 },
  { rating: 2200, skillLevel: 16, moveTime: 1000, depth: 15, candidates: 1, variance: 0.02 },
  { rating: 2500, skillLevel: 18, moveTime: 1200, depth: 16, candidates: 1, variance: 0.01 },
  { rating: 2800, skillLevel: 20, moveTime: 1500, depth: 18, candidates: 1, variance: 0 },
];

/**
 * The engine profile for a bot, interpolated from its nearest ladder anchor.
 * The roster's per-bot `engineSettings` is the authority (each bot was hand
 * tuned); this is only the fallback for an unknown/custom bot object.
 */
export function rankForRating(rating: number): DifficultyRank {
  const r = Number(rating);
  if (!Number.isFinite(r)) return DIFFICULTY_RANKS[0];
  let best = DIFFICULTY_RANKS[0];
  let bestDist = Infinity;
  for (const row of DIFFICULTY_RANKS) {
    const d = Math.abs(row.rating - r);
    if (d < bestDist) {
      bestDist = d;
      best = row;
    }
  }
  return best;
}

/* ── Bot roster ─────────────────────────────────────────────────────────── */

/* Avatar lookup.
 *
 * Bot portraits are real PNGs in `public/assets/bots/`, addressed with a plain
 * absolute path. That is deliberate and replaces an earlier approach:
 *
 *  - `new URL('../assets/bots/' + id + '.webp', import.meta.url)` cannot work,
 *    because a template literal is not statically analysable, so Vite ships a
 *    runtime-relative URL that 404s;
 *  - `import.meta.glob` worked, but forced a build-time glob over a directory of
 *    0-byte placeholders and made the tests stub `import.meta.glob` at build
 *    time just to keep it from throwing.
 *
 * With the artwork in `public/` the path is static, needs no transform, needs no
 * test stubbing, and works offline. Every bot id maps to a file by the same rule
 * (`<id>.png`), so adding a portrait is a file drop with no code change.
 *
 * The `public/` directory also means these are NOT fingerprinted, which is fine
 * for art that ships with the app and is cached by filename.
 */
const AVATAR_BASE = '/assets/bots';
const AVATAR_DEFAULT = `${AVATAR_BASE}/default.png`;

function avatar(id: string): string {
  return `${AVATAR_BASE}/${id}.png`;
}

type BotSeed = Omit<ChessBot, 'avatar'>;

function make(seed: BotSeed): ChessBot {
  return { ...seed, avatar: avatar(seed.id) };
}

/** Fallback portrait, used when a bot's own image fails to load. */
export const DEFAULT_BOT_AVATAR = AVATAR_DEFAULT;

/* The roster, ordered by ascending rating so a linear scan yields the
 * difficulty curve. Grouping is carried by each bot's `difficulty` field —
 * read it with `getBotsByDifficulty()`, never by counting array offsets.
 *
 * Five bots per tier, which is what makes the defeat ladder satisfiable:
 * Intermediate requires 3 Beginner defeats, and Advanced/Expert/Master each
 * require 5 in the tier below. */
export const BOTS: ChessBot[] = [
  make({
    id: 'pip', name: 'Pip', rating: 150, difficulty: 'Beginner', group: 'Beginner',
    initials: 'PI', region: 'Lowmoor', archetype: 'Curious student', hue: 205,
    description: 'Barely knows the rules and thinks every pawn is a person.',
    greeting: "Hi! I'm Pip. Want to play a game?",
    winMessage: 'Good game! You found the holes in my ideas.',
    loseMessage: 'Great game! You got me.',
    drawMessage: 'That was close!',
    thinkingTime: { min: 300, max: 800 },
    engineSettings: { skillLevel: 0, depth: 4, moveTime: 100, multiPv: 4, mistakeProb: 0.40, blunderProb: 0.16, variance: 0.62, endgameBoost: 1 },
    personality: 'random',
  }),
  make({
    id: 'mia', name: 'Mia', rating: 250, difficulty: 'Beginner', group: 'Beginner',
    initials: 'MI', region: 'Riverkeep', archetype: 'Patient student', hue: 330,
    description: 'Learns fast and asks about every move afterwards.',
    greeting: "Hi! I'm Mia. Ready when you are!",
    winMessage: 'You played that really well.',
    loseMessage: 'Good game. Want a rematch?',
    drawMessage: 'Dead level. Nice!',
    thinkingTime: { min: 300, max: 850 },
    engineSettings: { skillLevel: 0, depth: 4, moveTime: 110, multiPv: 4, mistakeProb: 0.37, blunderProb: 0.14, variance: 0.58, endgameBoost: 1 },
    personality: 'balanced',
  }),
  make({
    id: 'leo', name: 'Leo', rating: 350, difficulty: 'Beginner', group: 'Beginner',
    initials: 'LE', region: 'Highfell', archetype: 'Eager scout', hue: 28,
    description: 'Throws himself at the centre and hopes for the best.',
    greeting: "I'm Leo. Ready when you are!",
    winMessage: 'You kept me honest the whole way.',
    loseMessage: 'Great game! You got me.',
    drawMessage: 'Evenly matched!',
    thinkingTime: { min: 350, max: 900 },
    engineSettings: { skillLevel: 1, depth: 5, moveTime: 140, multiPv: 4, mistakeProb: 0.34, blunderProb: 0.12, variance: 0.54, endgameBoost: 1 },
    personality: 'attacker',
  }),
  make({
    id: 'nova', name: 'Nova', rating: 450, difficulty: 'Beginner', group: 'Beginner',
    initials: 'NO', region: 'Starling Reach', archetype: 'Bright explorer', hue: 268,
    description: 'Loves a surprise opening and cannot resist a pawn sacrifice.',
    greeting: "Hi! I'm Nova. Want to play a game?",
    winMessage: 'You saw through my tricks this time.',
    loseMessage: 'Good game. Want a rematch?',
    drawMessage: 'That was close!',
    thinkingTime: { min: 400, max: 900 },
    engineSettings: { skillLevel: 1, depth: 5, moveTime: 150, multiPv: 4, mistakeProb: 0.30, blunderProb: 0.10, variance: 0.50, endgameBoost: 1 },
    personality: 'gambit',
  }),
  make({
    id: 'toby', name: 'Toby', rating: 550, difficulty: 'Beginner', group: 'Beginner',
    initials: 'TO', region: 'Anvilbrook', archetype: 'Steady club novice', hue: 152,
    description: 'Quiet, careful, and very hard to rattle.',
    greeting: 'Alright. Let us play.',
    winMessage: 'You were patient. That won it.',
    loseMessage: 'Good game. Want a rematch?',
    drawMessage: 'A proper grind. Draw it is.',
    thinkingTime: { min: 400, max: 950 },
    engineSettings: { skillLevel: 2, depth: 6, moveTime: 180, multiPv: 4, mistakeProb: 0.27, blunderProb: 0.09, variance: 0.46, endgameBoost: 1 },
    personality: 'defensive',
  }),

  make({
    id: 'aria', name: 'Aria', rating: 650, difficulty: 'Casual', group: 'Casual',
    initials: 'AR', region: 'Sable Quay', archetype: 'Calm tactician', hue: 292,
    description: 'Plays simple, tidy moves and rarely gives anything away.',
    greeting: "Let's see what you've got!",
    winMessage: 'Tidy game. You found the one move I missed.',
    loseMessage: 'Good game. Want a rematch?',
    drawMessage: 'That was close!',
    thinkingTime: { min: 450, max: 1000 },
    engineSettings: { skillLevel: 3, depth: 7, moveTime: 250, multiPv: 4, mistakeProb: 0.22, blunderProb: 0.06, variance: 0.40, endgameBoost: 1.1 },
    personality: 'positional',
  }),
  make({
    id: 'finn', name: 'Finn', rating: 750, difficulty: 'Casual', group: 'Casual',
    initials: 'FI', region: 'Greywake', archetype: 'Restless attacker', hue: 8,
    description: 'Always looking for the move that wins a piece outright.',
    greeting: "Ready for a game?",
    winMessage: 'You dodged everything I threw.',
    loseMessage: 'Good game. Want a rematch?',
    drawMessage: 'You held me off.',
    thinkingTime: { min: 450, max: 1050 },
    engineSettings: { skillLevel: 3, depth: 7, moveTime: 250, multiPv: 4, mistakeProb: 0.21, blunderProb: 0.06, variance: 0.38, endgameBoost: 1.1 },
    personality: 'aggressive',
  }),
  make({
    id: 'luna', name: 'Luna', rating: 850, difficulty: 'Casual', group: 'Casual',
    initials: 'LU', region: 'Silverpine', archetype: 'Long-horizon planner', hue: 196,
    description: 'Plays for the endgame while you are still moving pawns.',
    greeting: "Take your time. I'll be waiting.",
    winMessage: 'The plan ran out before my pieces did.',
    loseMessage: 'Good game. Want a rematch?',
    drawMessage: 'We both ran out of ideas.',
    thinkingTime: { min: 500, max: 1100 },
    engineSettings: { skillLevel: 4, depth: 8, moveTime: 280, multiPv: 4, mistakeProb: 0.18, blunderProb: 0.05, variance: 0.34, endgameBoost: 1.2 },
    personality: 'positional',
  }),
  make({
    id: 'kai', name: 'Kai', rating: 950, difficulty: 'Casual', group: 'Casual',
    initials: 'KA', region: 'Emberfen', archetype: 'Creative gambler', hue: 44,
    description: 'Plays the position nobody has ever seen before.',
    greeting: "Let's mix it up!",
    winMessage: 'You improvised better than I did.',
    loseMessage: 'Good game. Want a rematch?',
    drawMessage: 'Wild, and level.',
    thinkingTime: { min: 500, max: 1150 },
    engineSettings: { skillLevel: 4, depth: 9, moveTime: 320, multiPv: 4, mistakeProb: 0.16, blunderProb: 0.04, variance: 0.32, endgameBoost: 1.2 },
    personality: 'gambit',
  }),
  make({
    id: 'milo', name: 'Milo', rating: 1050, difficulty: 'Casual', group: 'Casual',
    initials: 'MI', region: 'Thornfield', archetype: 'Improving regular', hue: 128,
    description: 'Methodical and a little hard to rattle.',
    greeting: 'Time for a challenge!',
    winMessage: 'You out-prepared me today.',
    loseMessage: 'Good game. Want a rematch?',
    drawMessage: 'Honours even.',
    thinkingTime: { min: 550, max: 1200 },
    engineSettings: { skillLevel: 5, depth: 9, moveTime: 350, multiPv: 3, mistakeProb: 0.14, blunderProb: 0.03, variance: 0.28, endgameBoost: 1.2 },
    personality: 'balanced',
  }),

  make({
    id: 'zara', name: 'Zara', rating: 1150, difficulty: 'Intermediate', group: 'Intermediate',
    initials: 'ZA', region: 'Solmarch', archetype: 'Sharp middlegame tactician', hue: 320,
    description: 'Spots the fork three moves before you do.',
    greeting: "I'll try to keep up!",
    winMessage: 'You slipped past my net.',
    loseMessage: 'Good game. Want a rematch?',
    drawMessage: 'That was close!',
    thinkingTime: { min: 600, max: 1200 },
    engineSettings: { skillLevel: 6, depth: 10, moveTime: 400, multiPv: 3, mistakeProb: 0.12, blunderProb: 0.025, variance: 0.24, endgameBoost: 1.25 },
    personality: 'attacker',
  }),
  make({
    id: 'orion', name: 'Orion', rating: 1250, difficulty: 'Intermediate', group: 'Intermediate',
    initials: 'OR', region: 'Highmarch', archetype: 'Patient schemer', hue: 224,
    description: 'Builds slowly, then plays the move that ends the game.',
    greeting: "Let's see what you've got!",
    winMessage: 'My position fell apart.',
    loseMessage: 'Good game. Want a rematch?',
    drawMessage: 'Level.',
    thinkingTime: { min: 650, max: 1250 },
    engineSettings: { skillLevel: 7, depth: 11, moveTime: 480, multiPv: 3, mistakeProb: 0.10, blunderProb: 0.02, variance: 0.20, endgameBoost: 1.25 },
    personality: 'positional',
  }),
  make({
    id: 'theo', name: 'Theo', rating: 1350, difficulty: 'Intermediate', group: 'Intermediate',
    initials: 'TH', region: 'Ashford', archetype: 'Flexible all-rounder', hue: 88,
    description: 'Has an answer for everything and never says so.',
    greeting: 'Good luck!',
    winMessage: 'You found the better idea.',
    loseMessage: 'Good game. Want a rematch?',
    drawMessage: 'Square fight.',
    thinkingTime: { min: 700, max: 1300 },
    engineSettings: { skillLevel: 7, depth: 11, moveTime: 500, multiPv: 3, mistakeProb: 0.09, blunderProb: 0.018, variance: 0.18, endgameBoost: 1.3 },
    personality: 'balanced',
  }),
  make({
    id: 'maya', name: 'Maya', rating: 1450, difficulty: 'Intermediate', group: 'Intermediate',
    initials: 'MY', region: 'Copperwash', archetype: 'Exchange trader', hue: 20,
    description: 'Happy to trade anything, as long as she is up material afterwards.',
    greeting: 'Ready for a game?',
    winMessage: 'You traded at the right moment.',
    loseMessage: 'Good game. Want a rematch?',
    drawMessage: 'Even exchange, even result.',
    thinkingTime: { min: 750, max: 1400 },
    engineSettings: { skillLevel: 8, depth: 12, moveTime: 550, multiPv: 3, mistakeProb: 0.08, blunderProb: 0.015, variance: 0.16, endgameBoost: 1.3 },
    personality: 'trader',
  }),

  make({
    id: 'atlas', name: 'Atlas', rating: 1550, difficulty: 'Intermediate', group: 'Intermediate',
    initials: 'AT', region: 'Stonewake', archetype: 'Unshakable defender', hue: 172,
    description: 'Squeezes positions until there is nothing left to squeeze.',
    greeting: "Let's get started!",
    winMessage: 'There was no air left to breathe.',
    loseMessage: 'Good game. Want a rematch?',
    drawMessage: 'Held to a draw.',
    thinkingTime: { min: 800, max: 1500 },
    engineSettings: { skillLevel: 9, depth: 12, moveTime: 600, multiPv: 3, mistakeProb: 0.07, blunderProb: 0.012, variance: 0.14, endgameBoost: 1.3 },
    personality: 'defensive',
  }),
  make({
    id: 'raven', name: 'Raven', rating: 1650, difficulty: 'Advanced', group: 'Advanced',
    initials: 'RA', region: 'Nightmoor', archetype: 'Devouring attacker', hue: 264,
    description: 'Trade into the position where the black king has nowhere to go.',
    greeting: 'Watch out for tactics!',
    winMessage: 'The kingside caught up with me.',
    loseMessage: 'Good game. Want a rematch?',
    drawMessage: 'You covered everything.',
    thinkingTime: { min: 850, max: 1550 },
    engineSettings: { skillLevel: 10, depth: 13, moveTime: 650, multiPv: 2, mistakeProb: 0.06, blunderProb: 0.010, variance: 0.12, endgameBoost: 1.35 },
    personality: 'aggressive',
  }),
  make({
    id: 'viktor', name: 'Viktor', rating: 1750, difficulty: 'Advanced', group: 'Advanced',
    initials: 'VI', region: 'Ironhollow', archetype: 'Disciplined strategist', hue: 210,
    description: 'Every move has a reason, and the reason is usually good.',
    greeting: 'Let us see what you have.',
    winMessage: 'The structure decided it.',
    loseMessage: 'Good game. Want a rematch?',
    drawMessage: 'A well-built draw.',
    thinkingTime: { min: 900, max: 1650 },
    engineSettings: { skillLevel: 11, depth: 13, moveTime: 700, multiPv: 2, mistakeProb: 0.05, blunderProb: 0.008, variance: 0.10, endgameBoost: 1.35 },
    personality: 'positional',
  }),
  make({
    id: 'iris', name: 'Iris', rating: 1850, difficulty: 'Advanced', group: 'Advanced',
    initials: 'IR', region: 'Glasslight', archetype: 'Fluent improviser', hue: 186,
    description: 'Plaws the board like a chord change, and rarely misses.',
    greeting: "Let's see a good game!",
    winMessage: 'You found the one variation I had not seen.',
    loseMessage: 'Good game. Want a rematch?',
    drawMessage: 'Drawn with the best play.',
    thinkingTime: { min: 950, max: 1750 },
    engineSettings: { skillLevel: 12, depth: 14, moveTime: 750, multiPv: 2, mistakeProb: 0.04, blunderProb: 0.007, variance: 0.08, endgameBoost: 1.4 },
    personality: 'positional',
  }),
  make({
    id: 'magnuson', name: 'Magnuson', rating: 1950, difficulty: 'Advanced', group: 'Advanced',
    initials: 'MA', region: 'Thunderspire', archetype: 'Fearless fighter', hue: 36,
    description: 'Wins ugly. Does not care. Counts it every time.',
    greeting: 'Time to fight!',
    winMessage: 'You refused to let me fight.',
    loseMessage: 'Good game. Want a rematch?',
    drawMessage: 'A war of attrition.',
    thinkingTime: { min: 1000, max: 1850 },
    engineSettings: { skillLevel: 13, depth: 14, moveTime: 800, multiPv: 2, mistakeProb: 0.035, blunderProb: 0.005, variance: 0.06, endgameBoost: 1.4 },
    personality: 'aggressive',
  }),

  make({
    id: 'serena', name: 'Serena', rating: 2050, difficulty: 'Advanced', group: 'Advanced',
    initials: 'SE', region: 'Vale Hollow', archetype: 'Unrelenting grinder', hue: 340,
    description: 'Never lets the game become easy. Not once.',
    greeting: 'This will be tough!',
    winMessage: 'You outlasted me.',
    loseMessage: 'Good game. Want a rematch?',
    drawMessage: 'Nail-biter.',
    thinkingTime: { min: 1050, max: 1950 },
    engineSettings: { skillLevel: 14, depth: 15, moveTime: 900, multiPv: 2, mistakeProb: 0.03, blunderProb: 0.004, variance: 0.05, endgameBoost: 1.45 },
    personality: 'balanced',
  }),
  make({
    id: 'cipher', name: 'Cipher', rating: 2150, difficulty: 'Expert', group: 'Expert',
    initials: 'CI', region: 'Null Vault', archetype: 'Cryptic tactician', hue: 276,
    description: 'Explains nothing, concedes nothing.',
    greeting: 'Decode the position. Or try.',
    winMessage: 'You solved it.',
    loseMessage: 'Good game. Want a rematch?',
    drawMessage: 'Sealed.',
    thinkingTime: { min: 1100, max: 2050 },
    engineSettings: { skillLevel: 15, depth: 15, moveTime: 950, multiPv: 1, mistakeProb: 0.025, blunderProb: 0.003, variance: 0.03, endgameBoost: 1.45 },
    personality: 'positional',
  }),
  make({
    id: 'phoenix', name: 'Phoenix', rating: 2250, difficulty: 'Expert', group: 'Expert',
    initials: 'PH', region: 'Emberfall', archetype: 'Rising under pressure', hue: 14,
    description: 'The worse the position looks, the better she plays.',
    greeting: 'Never count me out!',
    winMessage: 'I lost the fire, not the game.',
    loseMessage: 'Good game. Want a rematch?',
    drawMessage: 'Burned down to a draw.',
    thinkingTime: { min: 1150, max: 2150 },
    engineSettings: { skillLevel: 16, depth: 16, moveTime: 1000, multiPv: 1, mistakeProb: 0.022, blunderProb: 0.003, variance: 0.025, endgameBoost: 1.5 },
    personality: 'attacker',
  }),
  make({
    id: 'titan', name: 'Titan', rating: 2350, difficulty: 'Expert', group: 'Expert',
    initials: 'TI', region: 'Stonevault', archetype: 'Immovable fortress', hue: 202,
    description: 'Defends until there is nothing left to defend, then wins.',
    greeting: 'Brace yourself.',
    winMessage: 'The wall finally came down.',
    loseMessage: 'Good game. Want a rematch?',
    drawMessage: 'Immovable.',
    thinkingTime: { min: 1200, max: 2250 },
    engineSettings: { skillLevel: 16, depth: 16, moveTime: 1100, multiPv: 1, mistakeProb: 0.02, blunderProb: 0.002, variance: 0.02, endgameBoost: 1.5 },
    personality: 'defensive',
  }),
  make({
    id: 'akira', name: 'Akira', rating: 2450, difficulty: 'Expert', group: 'Expert',
    initials: 'AK', region: 'Kitsune Isle', archetype: 'Endgame specialist', hue: 356,
    description: 'Happy to hand you the middlegame. Take the ending.',
    greeting: 'Begin.',
    winMessage: 'The ending was mine.',
    loseMessage: 'Good game. Want a rematch?',
    drawMessage: 'Exact balance to the end.',
    thinkingTime: { min: 1250, max: 2350 },
    engineSettings: { skillLevel: 17, depth: 17, moveTime: 1150, multiPv: 1, mistakeProb: 0.018, blunderProb: 0.002, variance: 0.015, endgameBoost: 1.7 },
    personality: 'endgame',
  }),

  make({
    id: 'draco', name: 'Draco', rating: 2550, difficulty: 'Expert', group: 'Expert',
    initials: 'DR', region: 'Cinder Reach', archetype: 'Ruthless tactician', hue: 4,
    description: 'No mercy, no second chances, no long games.',
    greeting: 'No mercy.',
    winMessage: 'You lasted longer than most.',
    loseMessage: 'Good game. Want a rematch?',
    drawMessage: 'Dragons draw.',
    thinkingTime: { min: 1300, max: 2400 },
    engineSettings: { skillLevel: 18, depth: 17, moveTime: 1200, multiPv: 1, mistakeProb: 0.015, blunderProb: 0.001, variance: 0.012, endgameBoost: 1.55 },
    personality: 'aggressive',
  }),
  make({
    id: 'shadow', name: 'Shadow', rating: 2650, difficulty: 'Master', group: 'Master',
    initials: 'SH', region: 'Greyveil', archetype: 'Elusive deep player', hue: 250,
    description: 'The move you did not see coming was the plan from move four.',
    greeting: "You won't see me coming.",
    winMessage: 'From the shadows.',
    loseMessage: 'Good game. Want a rematch?',
    drawMessage: 'A veiled draw.',
    thinkingTime: { min: 1350, max: 2500 },
    engineSettings: { skillLevel: 18, depth: 18, moveTime: 1300, multiPv: 1, mistakeProb: 0.013, blunderProb: 0.001, variance: 0.010, endgameBoost: 1.55 },
    personality: 'positional',
  }),
  make({
    id: 'aurora', name: 'Aurora', rating: 2750, difficulty: 'Master', group: 'Master',
    initials: 'AU', region: 'Polar Light', archetype: 'Radiant precision', hue: 178,
    description: 'Plays with perfect clarity and expects the same from you.',
    greeting: 'Let brilliance guide us.',
    winMessage: 'The light went out.',
    loseMessage: 'Good game. Want a rematch?',
    drawMessage: 'Perfect balance.',
    thinkingTime: { min: 1400, max: 2600 },
    engineSettings: { skillLevel: 19, depth: 18, moveTime: 1400, multiPv: 1, mistakeProb: 0.011, blunderProb: 0.001, variance: 0.008, endgameBoost: 1.6 },
    personality: 'positional',
  }),
  make({
    id: 'nexus', name: 'Nexus', rating: 2850, difficulty: 'Master', group: 'Master',
    initials: 'NE', region: 'Convergence', archetype: 'Connecting converter', hue: 292,
    description: 'Every file, every rank, every piece — all pointing one way.',
    greeting: 'Converging lines ahead.',
    winMessage: 'It all came together. For you.',
    loseMessage: 'Good game. Want a rematch?',
    drawMessage: 'Tied at the nexus.',
    thinkingTime: { min: 1450, max: 2700 },
    engineSettings: { skillLevel: 19, depth: 18, moveTime: 1450, multiPv: 1, mistakeProb: 0.010, blunderProb: 0.001, variance: 0.006, endgameBoost: 1.8 },
    personality: 'endgame',
  }),
  make({
    id: 'zenith', name: 'Zenith', rating: 2950, difficulty: 'Master', group: 'Master',
    initials: 'ZE', region: 'Summit Vault', archetype: 'Peak performer', hue: 48,
    description: 'The highest peak in the academy. Nothing is left unused.',
    greeting: 'Reaching the peak.',
    winMessage: 'You reached the summit.',
    loseMessage: 'Good game. Want a rematch?',
    drawMessage: 'Level at the top.',
    thinkingTime: { min: 1500, max: 2800 },
    engineSettings: { skillLevel: 20, depth: 19, moveTime: 1500, multiPv: 1, mistakeProb: 0.008, blunderProb: 0.0008, variance: 0.004, endgameBoost: 1.7 },
    personality: 'balanced',
  }),
  make({
    id: 'omega', name: 'Omega', rating: 3100, difficulty: 'Master', group: 'Master',
    initials: 'OM', region: 'The Last Vault', archetype: 'Final boss', hue: 6,
    description: 'The end of the ladder. The hardest opponent in the academy.',
    greeting: 'The endgame begins now.',
    winMessage: 'The end. Finally.',
    loseMessage: 'Good game. Want a rematch?',
    drawMessage: 'Absolute. Nothing more to prove.',
    thinkingTime: { min: 1600, max: 2500 },
    engineSettings: { skillLevel: 20, depth: 20, moveTime: 1600, multiPv: 1, mistakeProb: 0.007, blunderProb: 0.0006, variance: 0.003, endgameBoost: 1.8 },
    personality: 'endgame',
  }),
];

/* ── Lookups ────────────────────────────────────────────────────────────── */

const BY_ID = new Map<string, ChessBot>(BOTS.map((b) => [b.id, b]));

export function getBotById(id: string | null | undefined): ChessBot | null {
  if (!id) return null;
  return BY_ID.get(String(id)) ?? null;
}

export function getBotsByGroup(group: BotDifficulty): ChessBot[] {
  return BOTS.filter((b) => b.group === group);
}

export function getBotsByDifficulty(difficulty: BotDifficulty): ChessBot[] {
  return BOTS.filter((b) => b.difficulty === difficulty);
}

export function getBand(id: BotDifficulty): DifficultyBand {
  return (
    DIFFICULTY_BANDS.find((b) => b.id === id) ?? DIFFICULTY_BANDS[0]
  );
}

/** The tier that gates `difficulty`, or null when it is free from the start. */
export function getUnlockSource(difficulty: BotDifficulty): BotDifficulty | null {
  const band = getBand(difficulty);
  return band?.unlocksFrom ?? null;
}

/** "Next Challenge" target after beating `bot`: the next bot up in rating order. */
export function getNextBot(botId: string): ChessBot | null {
  const bot = getBotById(botId);
  if (!bot) return null;
  const beaten = new Set(BOTS.filter((b) => b.rating <= bot.rating).map((b) => b.id));
  return (
    BOTS.find((b) => !beaten.has(b.id) && b.rating > bot.rating) ?? null
  );
}

export const BOT_CATALOG_VERSION = 1;
