/**
 * AI Coach Training Academy — curriculum shape and level metadata.
 *
 * A coach-training curriculum, NOT a student one. Every topic is written from
 * the trainer's side of the board: the coach has to understand the concept,
 * recognise it, demonstrate it, and then be able to TEACH it. That is why a
 * topic carries a `coachMethod` and a `teachBack` brief alongside its chess
 * content — those are what the 16-step training flow reads.
 *
 * Pure data + pure helpers. No React, no storage, no side effects, so this file
 * is importable from tests and from the progress engine without a DOM.
 */

/** Mastery ladder. Progress is earned, never granted. */
export const MASTERY_STATES = Object.freeze([
  'not-started',
  'learning',
  'practicing',
  'tested',
  'mastered',
  'needs-revision',
]);

/**
 * The 16-step training flow that EVERY topic follows (spec section 4).
 * `key` is the step id, `title` is what the UI shows. Steps marked
 * `interactive: true` collect input rather than only displaying text.
 */
export const TRAINING_STEPS = Object.freeze([
  { key: 'concept', n: 1, title: 'Concept', interactive: false },
  { key: 'deep', n: 2, title: 'Deep Explanation', interactive: false },
  { key: 'board', n: 3, title: 'Board Demonstration', interactive: true },
  { key: 'why', n: 4, title: 'Why?', interactive: false },
  { key: 'when', n: 5, title: 'When?', interactive: false },
  { key: 'whenNot', n: 6, title: 'When NOT?', interactive: false },
  { key: 'mistakes', n: 7, title: 'Common Mistakes', interactive: false },
  { key:coachMethodKey(), title: 'Coaching Method', n: 8, interactive: false },
  { key: 'coachingExample', n: 9, title: 'Coaching Example', interactive: false },
  { key: 'teachBack', n: 10, title: 'Teach-Back', interactive: true },
  { key: 'aiFeedback', n: 11, title: 'AI Feedback', interactive: true },
  { key: 'practice', n: 12, title: 'Practice', interactive: true },
  { key: 'puzzleCreation', n: 13, title: 'Puzzle Creation', interactive: true },
  { key: 'realGame', n: 14, title: 'Real Game Application', interactive: false },
  { key: 'coachTest', n: 15, title: 'Coach Test', interactive: true },
  { key: 'mastery', n: 16, title: 'Mastery', interactive: false },
]);

/* Named so the shape above stays greppable and cannot silently drift. */
function coachMethodKey() {
  return 'coachMethod';
}

/**
 * Short flow, piloted on a single level before it is rolled out.
 *
 * The 16-step flow above stays the default for every level that is not listed
 * in `SHORT_FLOW_LEVELS`. This trims the flow to the one thing a learner
 * actually wants from a topic: what the idea is, a proper explanation of it,
 * and a position to try it on.
 *
 * Nothing is deleted. The other 13 steps are still authored on every topic and
 * still render for any level not in the pilot list, so reverting is a one-line
 * change (empty the list below).
 */
export const TRAINING_STEPS_SHORT = Object.freeze([
  { key: 'concept', n: 1, title: 'Concept', interactive: false },
  { key: 'deep', n: 2, title: 'Deep Explanation', interactive: false },
  { key: 'practice', n: 3, title: 'Practice', interactive: true },
]);

/* Levels running the short flow. Level 2 only, as a pilot. */
export const SHORT_FLOW_LEVELS = Object.freeze([2]);

/**
 * Which step set a topic follows, chosen by the level that owns the topic.
 *
 * `level` is the numeric level carried on each topic (`topic.level`), not the
 * level id string. An unknown/absent level falls back to the full 16 steps,
 * which is the safe direction: a level added later gets the full flow rather
 * than silently landing on the trimmed one.
 */
export function trainingStepsFor(level) {
  const n = Number(level);
  return Number.isFinite(n) && SHORT_FLOW_LEVELS.includes(n)
    ? TRAINING_STEPS_SHORT
    : TRAINING_STEPS;
}

/** Assessment sections, per spec section 11. */
export const ASSESSMENT_SECTIONS = Object.freeze([
  { key: 'theory', label: 'Theory Questions', hint: 'Conceptual knowledge.' },
  { key: 'tactical', label: 'Tactical Positions', hint: 'Calculation.' },
  { key: 'strategic', label: 'Strategic Positions', hint: 'Planning.' },
  { key: 'teaching', label: 'Teaching Questions', hint: 'Coaching ability.' },
  { key: 'simulation', label: 'Student Simulation', hint: 'Correction ability.' },
  { key: 'board', label: 'Practical Board Test', hint: 'Actual chess understanding.' },
]);

/** The seven AI Coach training modes (spec section 6). */
export const TRAINING_MODES = Object.freeze([
  { key: 'learn', label: 'Learn Mode', hint: 'AI Coach explains the topic.' },
  { key: 'practice', label: 'Practice Mode', hint: 'Coach solves positions.' },
  { key: 'teach', label: 'Teach Mode', hint: 'Coach teaches the AI Coach as a student.' },
  { key: 'simulate', label: 'Student Simulation', hint: 'AI plays a student and makes real mistakes.' },
  { key: 'analysis', label: 'Game Analysis Mode', hint: 'Coach analyses a game with AI help.' },
  { key: 'exam', label: 'Exam Mode', hint: 'Structured assessment.' },
  { key: 'revision', label: 'Revision Mode', hint: 'AI revisits weak topics automatically.' },
]);

/** Student personas the AI Coach can role-play (spec section 7). */
export const STUDENT_PERSONAS = Object.freeze([
  { key: 'beginner', label: 'Beginner Student', blurb: 'Sees only one square ahead. Misses hangs and forks.' },
  { key: 'intermediate', label: 'Intermediate Student', blurb: 'Finds tactics but cannot explain why.' },
  { key: 'advanced', label: 'Advanced Student', blurb: 'Calculates well, resists hints, needs substance not slogans.' },
]);

/**
 * The 10 levels (spec section 3).
 *
 * `unlock` is the rule that gates the NEXT level: a level only unlocks once the
 * previous level's final exam is passed at or above `passMark`. There is no
 * path that sets a higher level to mastered without that exam, which is what
 * keeps the ladder honest.
 */
export const LEVELS = Object.freeze([
  {
    n: 1,
    id: 'level-1',
    title: 'Chess Coach Foundation',
    tagline: 'Rules you can state without hesitating.',
    description: 'The absolute foundation. A coach cannot teach what they cannot state fluently, so this level is about precise language and demonstration before any theory.',
    finalTask: 'Explain chess fundamentals as if teaching a complete beginner.',
    finalExam: { title: 'Level 1 Final Exam', passMark: 80, sections: ['theory', 'teaching', 'board'] },
    competency: ['Chess Knowledge', 'Teaching Clarity'],
  },
  {
    n: 2,
    id: 'level-2',
    title: 'Basic Tactics Coaching',
    tagline: 'Name the pattern, then explain it.',
    description: 'Every everyday tactical motif, taught to the level of "definition, recognition, why, defence, common mistake" so the coach can diagnose a student mistake by name.',
    finalTask: 'Study a tactical position and explain the solution exactly as a coach would explain it to a student.',
    finalExam: { title: 'Level 2 Final Exam', passMark: 80, sections: ['theory', 'tactical', 'teaching'] },
    competency: ['Tactical Skill', 'Teaching Clarity'],
  },
  {
    n: 3,
    id: 'level-3',
    title: 'Advanced Tactics',
    tagline: 'Combinations, decoys and mating nets.',
    description: 'The motifs that need two ideas at once, plus a working catalogue of fork patterns and mating patterns the coach can recognise instantly.',
    finalTask: 'Create and teach a 10-minute tactical lesson.',
    finalExam: { title: 'Level 3 Final Exam', passMark: 80, sections: ['theory', 'tactical', 'teaching'] },
    competency: ['Tactical Skill', 'Calculation'],
  },
  {
    n:4,
    id: 'level-4',
    title: 'Opening Coaching',
    tagline: 'Teach a plan, not a move list.',
    description: 'Opening principles, structures, plans and the classic families, each explained three times over: to a beginner, to an intermediate, and to an advanced student.',
    finalTask: 'Create a complete opening lesson suitable for students.',
    finalExam: { title: 'Level 4 Final Exam', passMark: 80, sections: ['theory', 'strategic', 'teaching'] },
    competency: ['Chess Knowledge', 'Teaching Quality'],
  },
  {
    n: 5,
    id: 'level-5',
    title: 'Positional Coaching',
    tagline: 'Explain why a good move is good.',
    description: 'Structural thinking: activity, space, weak squares and pawn structures, and the discipline of finding the worst piece and a pawn break.',
    finalTask: 'Analyze an unfamiliar position without relying only on engine moves and explain the strategic plan.',
    finalExam: { title: 'Level 5 Final Exam', passMark: 80, sections: ['theory', 'strategic', 'teaching'] },
    competency: ['Strategic Skill', 'Chess Knowledge'],
  },
  {
    n: 6,
    id: 'level-6',
    title: 'Calculation & Advanced Tactics',
    tagline: 'Be able to show your working.',
    description: 'Deep calculation as a teachable process: candidates, forcing moves, opponent resources, verification, and the sacrifices that justify giving up material.',
    finalTask: 'Analyze a complex position and verbally explain the complete calculation process.',
    finalExam: { title: 'Level 6 Final Exam', passMark: 80, sections: ['tactical', 'strategic', 'teaching'] },
    competency: ['Calculation', 'Tactical Skill'],
  },
  {
    n: 7,
    id: 'level-7',
    title: 'Strategy & Game Planning',
    tagline: 'A plan is a sequence, not a slogan.',
    description: 'Planning as a discipline: find the problem, read the opponent, pick the break, decide the timing, and know which exchange to cash in.',
    finalTask: 'Create a complete strategic plan for complex middlegame positions.',
    finalExam: { title: 'Level 7 Final Exam', passMark: 80, sections: ['strategic', 'theory', 'teaching'] },
    competency: ['Strategic Skill', 'Calculation'],
  },
  {
    n: 8,
    id: 'level-8',
    title: 'Endgame Coaching',
    tagline: 'Technique, not intuition.',
    description: 'Pawn, rook, minor-piece and queen endgames organised as setup to test, so the coach can walk a student from concept to won/drawn position step by step.',
    finalTask: 'Teach an endgame from: Position Setup → Concept → Technique → Demonstration → Practice → Test.',
    finalExam: { title: 'Level 8 Final Exam', passMark: 80, sections: ['theory', 'tactical', 'teaching'] },
    competency: ['Endgame Skill', 'Teaching Quality'],
  },
  {
    n: 9,
    id: 'level-9',
    title: 'Advanced Coaching & Game Analysis',
    tagline: 'Turn a game into a training plan.',
    description: 'The full analysis workflow from complete game to personalised recommendation, plus the vocabulary of blunders, mistakes and turning points.',
    finalTask: 'Take a real student game and generate a complete professional coaching report.',
    finalExam: { title: 'Level 9 Final Exam', passMark: 80, sections: ['theory', 'tactical', 'strategic', 'teaching'] },
    competency: ['Strategic Skill', 'Teaching Quality'],
  },
  {
    n: 10,
    id: 'level-10',
    title: 'Master Chess Coach',
    tagline: 'Build the coach, not just the player.',
    description: 'Advanced chess plus the craft of coaching: repertoire construction, weakness identification, lesson planning, puzzle authoring and coaching psychology.',
    finalTask: 'Analyse a real student game, identify every weakness class, build a personalised training plan, create lessons and puzzles, teach, test and produce a final report.',
    finalExam: { title: 'Level 10 Master Coach Exam', passMark: 85, sections: ['theory', 'tactical', 'strategic', 'teaching', 'simulation', 'board'] },
    competency: ['Chess Knowledge', 'Tactical Skill', 'Strategic Skill', 'Endgame Skill', 'Calculation', 'Teaching Skill'],
  },
]);

export const LEVEL_COUNT = LEVELS.length;

/* ── helpers ───────────────────────────────────────────────────────────── */

/** Levels in ladder order. */
export function allLevels() {
  return LEVELS;
}

export function getLevel(levelOrId) {
  if (levelOrId == null) return null;
  const n = typeof levelOrId === 'number' ? levelOrId : Number(String(levelOrId).replace(/^level-/, ''));
  return LEVELS.find((l) => l.n === n) || null;
}

/** The level that must be passed before `n` opens up. Level 1 is always open. */
export function prerequisiteFor(n) {
  return n <= 1 ? null : getLevel(n - 1);
}

/** Mastery needs every one of these steps demonstrated (spec section 16). */
export const MASTERY_CRITERIA = Object.freeze([
  'understanding',
  'recognition',
  'analysis',
  'explanation',
  'demonstration',
  'teaching ability',
]);

/** Percentage weight per criterion, so mastery is earned, not declared. */
export const MASTERY_WEIGHTS = Object.freeze({
  understanding: 20,
  recognition: 20,
  analysis: 20,
  explanation: 15,
  demonstration: 10,
  'teaching ability': 15,
});

/** A topic is mastered at or above this percentage of weighted criteria. */
export const MASTERY_THRESHOLD = 85;

/** Level is considered complete at this fraction of its topics mastered. */
export const LEVEL_MASTERY_THRESHOLD = 80;