/* Bot difficulty configuration (12 rating-based levels).
   Central, easily recalibrated config — tweak any field to tune a level's
   strength without touching UI/UX. Kept fully separate from the student
   rating system: playing the computer never changes a student's real rating.

   Field meanings:
     ratingMin / ratingMax   approximate Elo band this level plays like
     label                  short friendly name
     difficulty             one-word difficulty feel for the UI
     skillLevel             Stockfish "Skill Level" option (0-20, weaker = lower)
     maxDepth               how many plies the engine searches
     timeMs                 engine think-time budget in ms
     blunderPct             0-1 chance the bot plays a sub-optimal LEGAL move
                            instead of its best move (simulates human errors)
*/
export const BOT_LEVELS = [
  { level: 1,  ratingMin: 300,  ratingMax: 400,  label: 'Absolute Beginner', difficulty: 'Very Easy',  skillLevel: 1,  maxDepth: 1, timeMs: 150, blunderPct: 0.40 },
  { level: 2,  ratingMin: 400,  ratingMax: 500,  label: 'Beginner',          difficulty: 'Very Easy',  skillLevel: 2,  maxDepth: 2, timeMs: 180, blunderPct: 0.36 },
  { level: 3,  ratingMin: 500,  ratingMax: 650,  label: 'Novice',            difficulty: 'Easy',       skillLevel: 3,  maxDepth: 2, timeMs: 200, blunderPct: 0.32 },
  { level: 4,  ratingMin: 650,  ratingMax: 800,  label: 'Improver',          difficulty: 'Easy-Medium', skillLevel: 5,  maxDepth: 3, timeMs: 250, blunderPct: 0.26 },
  { level: 5,  ratingMin: 800,  ratingMax: 950,  label: 'Casual',            difficulty: 'Medium',     skillLevel: 7,  maxDepth: 4, timeMs: 300, blunderPct: 0.18 },
  { level: 6,  ratingMin: 950,  ratingMax: 1100, label: 'Club Player',       difficulty: 'Medium',     skillLevel: 9,  maxDepth: 5, timeMs: 350, blunderPct: 0.14 },
  { level: 7,  ratingMin: 1100, ratingMax: 1300, label: 'Amateur',           difficulty: 'Medium-Hard',skillLevel: 12, maxDepth: 6, timeMs: 450, blunderPct: 0.10 },
  { level: 8,  ratingMin: 1300, ratingMax: 1500, label: 'Strong Amateur',    difficulty: 'Hard',       skillLevel: 15, maxDepth: 8, timeMs: 550, blunderPct: 0.07 },
  { level: 9,  ratingMin: 1500, ratingMax: 1700, label: 'Expert',            difficulty: 'Hard',       skillLevel: 17, maxDepth: 10,timeMs: 700, blunderPct: 0.04 },
  { level: 10, ratingMin: 1700, ratingMax: 1900, label: 'Candidate Master',  difficulty: 'Very Hard',  skillLevel: 19, maxDepth: 12,timeMs: 850, blunderPct: 0.02 },
  { level: 11, ratingMin: 1900, ratingMax: 2100, label: 'Master',            difficulty: 'Expert',     skillLevel: 20, maxDepth: 14,timeMs: 1000,blunderPct: 0 },
  { level: 12, ratingMin: 2100, ratingMax: 9999, label: 'Grandmaster',       difficulty: 'Master',     skillLevel: 20, maxDepth: 16,timeMs: 1200,blunderPct: 0 },
];

const MAX_LEVEL = BOT_LEVELS.length;

/* Clamp/coerce an arbitrary number to a valid 1-12 bot level. */
export function clampLevel(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return 1;
  return Math.max(1, Math.min(MAX_LEVEL, Math.round(num)));
}

/* Read the config for a given level (safe default = level 1). */
export function botLevelConfig(n) {
  const level = clampLevel(n);
  return BOT_LEVELS[level - 1];
}

/* Pick the single "best guess" fair level for a student Elo rating.
   Aim for a slightly-challenging-but-beatable opponent: the highest bot
   level whose rating floor is at or below the student rating, defaulting
   to a mid level (6) when the rating is unknown. */
export function suggestedLevelForRating(rating) {
  const r = Number(rating);
  if (!Number.isFinite(r) || r <= 0) return 6;
  let best = 1;
  for (const lvl of BOT_LEVELS) {
    if (lvl.ratingMin <= r) best = lvl.level;
  }
  return best;
}