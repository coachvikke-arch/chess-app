/**
 * AI Coach Training Academy — the coach engine.
 *
 * There is no external model here, and that is deliberate. This is a coaching
 * academy: the "AI Coach" is a student being trained, and the useful responses
 * are grounded in the curriculum itself — the topic's own definition, method,
 * mistakes, misconception and teach-back brief. A deterministic engine built on
 * that content is reliable, offline, free, and impossible to hallucinate a fact
 * about the user's own progress.
 *
 * DESIGN RULES
 *
 *  1. GROUNDED. Every answer quotes the topic it came from. Nothing is invented
 *     at runtime; the engine can only re-voice what the curriculum states.
 *
 *  2. DETERMINISTIC. Same input, same output. Grading is reproducible, so a
 *     coach's test score is stable and reviewable. All pseudo-randomness is
 *     seeded from a string hash, never from Math.random().
 *
 *  3. HONEST ABOUT ITSELF. The engine reports `engine: 'local'` on every
 *     response so the UI can say what is actually answering. Swapping in a real
 *     provider means replacing `respond` and nothing else — the seam is
 *     `AI_COACH_PROVIDER`, set on the module export.
 *
 *  4. THE STUDENT MAKES REAL MISTAKES. In simulation mode the student answers
 *     from a pool of *actual* errors drawn from the topic's `mistakes` and
 *     `misconception` lists. A student who never errs teaches the coach
 *     nothing, so the persona deliberately declines to give it all away.
 *
 * No DOM, no React, no storage — testable in plain node.
 */

import { Chess } from 'chess.js';
import { TRAINING_MODES, STUDENT_PERSONAS } from '../data/levels.js';

/* ── seeded pseudo-randomness ───────────────────────────────────────────── */

/** FNV-1a. Stable across runs and platforms, unlike a string hash of chars. */
export function hashString(str) {
  let h = 0x811c9dc5;
  const s = String(str ?? '');
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32 — small, fast, fully deterministic given a seed. */
function rng(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pick one item deterministically from a list. */
export function pick(list, seed, salt = '') {
  const arr = Array.isArray(list) ? list.filter(Boolean) : [];
  if (!arr.length) return null;
  const r = rng(hashString(`${seed}::${salt}`))();
  return arr[Math.floor(r * arr.length) % arr.length];
}

/** Pick `n` distinct items deterministically (or all of them, if fewer exist). */
export function pickMany(list, n, seed, salt = '') {
  const arr = Array.isArray(list) ? list.filter(Boolean) : [];
  if (arr.length <= n) return [...arr];
  const pool = [...arr];
  const out = [];
  for (let i = 0; i < n && pool.length; i += 1) {
    const r = rng(hashString(`${seed}::${salt}::${i}`))();
    out.push(pool.splice(Math.floor(r * pool.length) % pool.length, 1)[0]);
  }
  return out;
}

/* ── text helpers ───────────────────────────────────────────────────────── */

const sentences = (text) =>
  String(text || '')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

/** First 1–2 sentences, which is what a chat reply should be. */
function opening(text, max = 2) {
  return sentences(text).slice(0, max).join(' ');
}

/** Every nth sentence, for "give me more depth" without a full re-dump. */
function laterPart(text, from = 2, max = 2) {
  const rest = sentences(text).slice(from, from + max);
  return rest.join(' ');
}

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const lowerFirst = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

const asList = (items, limit = 4) =>
  (items || [])
    .filter(Boolean)
    .slice(0, limit)
    .map((s) => `- ${s}`)
    .join('\n');

/**
 * Words the coach typed that should route to a specific part of the answer.
 *
 * Order matters and is not alphabetical — it is precedence. `board` is tested
 * before `example` so "show me on the board" asks about the position instead of
 * being swallowed by the looser "show me" example pattern.
 */
const INTENT_PATTERNS = [
  { key: 'board', re: /\b(board|position|diagram|fen|on the squares?|from this position)\b/i },
  { key: 'method', re: /\b(method|how (do|would|to) (you|we|i) (teach|explain)|teaching (method|approach)|approach|procedure|steps?|drill)\b/i },
  { key: 'teachback', re: /\b(teach ?back|brief|what should i cover|checklist)\b/i },
  { key: 'example', re: /\b(example|say it|show me|phrase|word it|script)\b/i },
  { key: 'mistake', re: /\b(mistakes?|errors?|wrong|avoid|trap|common)\b/i },
  { key: 'misconception', re: /\b(misconception|think wrongly|believe|confus)\b/i },
  { key: 'assessment', re: /\b(test|exam|assess|grade|mark|score|question)\b/i },
  { key: 'hint', re: /\b(hint|help|stuck|nudge|clue)\b/i },
];

/** Map a free-text message to one of the intents above. */
export function classifyIntent(text) {
  const t = String(text || '');
  for (const p of INTENT_PATTERNS) if (p.re.test(t)) return p.key;
  return 'overview';
}

function stripDiacritics(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/* ── board helpers ──────────────────────────────────────────────────────── */

/** Load a position, returning null rather than throwing on bad data. */
export function loadPosition(fen) {
  try {
    return new Chess(fen);
  } catch {
    return null;
  }
}

/**
 * A genuinely checkable board fact: is the side to move in check, and how many
 * legal moves does it have? Used so board talk is derived from the position,
 * never invented.
 */
export function describePosition(fen) {
  const c = loadPosition(fen);
  if (!c) return null;
  const moves = c.moves({ verbose: true });
  const captures = moves.filter((m) => m.captured);
  return {
    fen: c.fen(),
    turn: c.turn(),
    inCheck: c.inCheck(),
    checkmate: c.isCheckmate(),
    stalemate: c.isStalemate(),
    legalMoves: moves.length,
    captures: captures.length,
    /* A quiet move is not available at all when nothing is hanging — that is the
       concrete version of "count material before you move". */
    quietMoves: moves.length - captures.length,
    checks: moves.filter((m) => m.san.includes('+') || m.san.includes('#')).length,
  };
}

function notationOf(fen, limit = 3) {
  const c = loadPosition(fen);
  if (!c) return [];
  return c
    .moves({ verbose: true })
    .filter((m) => m.captured || m.san.includes('+') || m.san.includes('#'))
    .slice(0, limit)
    .map((m) => m.san);
}

/* ── topic indexing ─────────────────────────────────────────────────────── */

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'for', 'with',
  'is', 'are', 'was', 'were', 'be', 'been', 'it', 'its', 'this', 'that', 'these',
  'those', 'i', 'you', 'me', 'my', 'we', 'us', 'do', 'does', 'did', 'how', 'what',
  'why', 'when', 'which', 'who', 'can', 'could', 'should', 'would', 'will', 'tell',
  'show', 'give', 'about', 'from', 'as', 'at', 'by', 'so', 'if', 'not', 'no',
  'chess', 'topic', 'explain', 'coach', 'student', 'teach',
]);

function tokenize(text) {
  return stripDiacritics(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

function buildIndex(topics) {
  return topics.map((t) => ({
    topic: t,
    tokens: new Set(tokenize(`${t.name} ${t.summary} ${t.content.definition} ${t.content.deep}`)),
  }));
}

/**
 * Index cache. The curriculum is a frozen module-level constant, so this is
 * built once per `topics` array identity rather than on every keystroke.
 */
const INDEX_CACHE = new WeakMap();

function indexFor(topics) {
  if (!Array.isArray(topics) || !topics.length) return [];
  const hit = INDEX_CACHE.get(topics);
  if (hit) return hit;
  const built = buildIndex(topics);
  INDEX_CACHE.set(topics, built);
  return built;
}

/**
 * Rank topics by keyword overlap with the question. Ties break on level so the
 * answer points at the earlier topic, which is where a coach should revise
 * first. Returns the top `limit` matches with a confidence based on overlap.
 */
export function searchTopics(query, topics, limit = 5) {
  const words = tokenize(query);
  const index = indexFor(topics);
  if (!words.length || !index.length) return [];
  const scored = index.map((entry) => {
    let hits = 0;
    for (const w of words) if (entry.tokens.has(w)) hits += 1;
    /* Direct name match is the strongest signal there is. */
    const nameWords = tokenize(entry.topic.name);
    for (const w of words) if (nameWords.includes(w)) hits += 2;
    return { topic: entry.topic, hits };
  });
  const max = Math.max(...scored.map((s) => s.hits), 1);
  return scored
    .filter((s) => s.hits > 0)
    .sort((a, b) => b.hits - a.hits || (a.topic.level ?? 0) - (b.topic.level ?? 0))
    .slice(0, limit)
    .map((s) => ({ topic: s.topic, confidence: Math.round((s.hits / max) * 100) }));
}

/* ── teach-back evaluation ──────────────────────────────────────────────── */

/** Phrases that mean "the coach is quoting the brief", not "the coach knew it". */
const QUOTE_MARKERS = [
  'the brief',
  'teachback',
  'teach-back',
  'look for',
  'as written',
  'the lesson says',
  'the material says',
  'your brief says',
];

const KINDS = ['definition', 'principle', 'example', 'cause', 'sequence'];

/** Question stems used to break a teach-back into its parts. */
const QUESTION_STEMS = [
  'what is it',
  'why does it work',
  'when should you use it',
  'what should the student do',
  'how do you teach it',
];

function noveltyScore(coverage, target) {
  /* `target` is a Set — it has `size`, not `length`. Reading `length` here made
     every teach-back score NaN, which surfaced in the UI as a blank result. */
  const targetWords = target.size;
  const fresh = coverage.filter((w) => !target.has(w)).length;
  const required = Math.max(4, Math.round(targetWords * 0.6));
  return Math.round((Math.min(fresh, required) / required) * 100);
}

function scoreCoverage(transcript, requiredConcepts) {
  const words = tokenize(transcript);
  const present = new Set(words);
  return requiredConcepts.map((concept) => {
    const cTokens = tokenize(concept);
    if (!cTokens.length) return { concept, hit: true, ratio: 100 };
    const hitCount = cTokens.filter((w) => present.has(w)).length;
    const ratio = hitCount / cTokens.length;
    /* A coach legitimately re-phrases a concept, so the bar is deliberately not
       "every keyword present" — 40% of a concept's own vocabulary counts as
       having addressed it, and the partial ratios still feed the score. */
    return { concept, hit: ratio >= 0.4, ratio: Math.round(ratio * 100) };
  });
}

function selfCheckScore(transcript) {
  const hasCounter = /\b(not|never|avoid|wrong|mistake|error|instead|rather than|unless|when not)\b/i.test(transcript);
  const hasExample = /\b(for example|e\.g\.|such as|imagine|suppose|if your student|in this position|for instance)\b/i.test(transcript);
  const hasCause = /\b(because|since|so that|which means|the reason|that is why|therefore)\b/i.test(transcript);
  let points = 40; /* Present at all is the baseline; the rest is earned. */
  if (hasCounter) points += 20;
  if (hasExample) points += 20;
  if (hasCause) points += 20;
  return points;
}

/**
 * Evaluate a teach-back transcript against the topic's own brief.
 *
 * The three parts map directly onto the store's mastery criteria — the required
 * concepts measure explanation, the self-check prompt measures demonstration,
 * and the brief's "lookFor" lines are what a coach should notice. Everything is
 * keyword-grounded in the topic, so the feedback quotes the brief it is using.
 */
export function evaluateTeachBack(transcript, topic) {
  const text = String(transcript || '').trim();
  const required = topic?.teachBack?.required ?? [];
  const coverage = scoreCoverage(text, required);
  const covered = coverage.filter((c) => c.hit);
  const missed = coverage.filter((c) => !c.hit);

  const freshWords = new Set(tokenize(text));
  const requiredSet = new Set(required.flatMap((c) => tokenize(c)));
  const quotePenalty = QUOTE_MARKERS.some((m) => text.toLowerCase().includes(m)) ? 15 : 0;

  /* Three parts, all grounded in the topic:
       - concept coverage  — did the brief's required points get addressed?
       - partial credit     — how close each concept actually came, so a coach
                              who almost hit a point is not scored like one who
                              ignored it
       - novelty            — is this their own wording or the brief's?
     A transcript too short to be a teach-back is scaled down rather than
     allowed to score on two lucky keywords. */
  const coverageRatio = required.length ? covered.length / required.length : 1;
  const partialRatio = coverage.length
    ? coverage.reduce((a, c) => a + c.ratio, 0) / coverage.length / 100
    : 1;
  const lengthFactor = Math.min(1, Math.max(0.35, text.split(/\s+/).filter(Boolean).length / 30));
  const explanation = Math.max(0, Math.min(100, Math.round(
    (coverageRatio * 55 + partialRatio * 25 + noveltyScore([...freshWords], requiredSet) * 0.2 - quotePenalty) * lengthFactor,
  )));

  /* Structure: how many of the question kinds are addressed. */
  const structure = KINDS.filter((k) => {
    if (k === 'definition') return /\b(is|are|means|refers to|consists of|defined as)\b/i.test(text);
    if (k === 'principle') return /\b(because|principle|rule|idea is|the point is|why)\b/i.test(text);
    if (k === 'example') return /\b(for example|e\.g\.|such as|imagine|position|student says)\b/i.test(text);
    if (k === 'cause') return /\b(cause|because|leads to|results in|so that|therefore)\b/i.test(text);
    if (k === 'sequence') return /\b(first|then|after|next|finally|step)\b/i.test(text);
    return false;
  }).length;
  const structureScore = Math.round((structure / KINDS.length) * 100);

  const demonstration = selfCheckScore(text);

  const overall = Math.round(explanation * 0.5 + structureScore * 0.2 + demonstration * 0.3);

  const strengths = [];
  if (covered.length) strengths.push(`Covered ${covered.length} of ${required.length} required points: ${covered.map((c) => c.concept).join('; ')}.`);
  if (demonstration >= 80) strengths.push('You included the self-check — a counter-example, a limit, or a "when not". That is what separates teaching from asserting.');
  if (structureScore >= 60) strengths.push('The explanation moved through definition, reason, example and consequence rather than one long assertion.');

  const improvements = [];
  if (!text) {
    improvements.push('Nothing to assess yet — write or speak the teach-back first, then submit.');
  } else {
    if (missed.length) improvements.push(`Not covered: ${missed.map((c) => c.concept).join('; ')}. Those are the brief\'s own required points.`);
    if (quotePenalty > 0) improvements.push('You quoted the brief\'s wording. That is not teaching — put it in your own words and check whether it survives.');
    if (text.split(/\s+/).filter(Boolean).length < 25) improvements.push('Too short to demonstrate understanding. Aim for at least 25 words — definition, reason, example, and one thing the student gets wrong.');
    if (demonstration < 80) improvements.push('No self-check found. Add the counter-example: what would a student wrongly believe here, and what does that belief cost them?');
  }

  return {
    scores: {
      explanation,
      'teaching ability': demonstration,
      demonstration,
    },
    /* Best-of, because the store records the best demonstration seen. */
    criterion: 'explanation',
    percent: overall,
    strengths: strengths.length ? strengths : ['A first attempt — the score below is a floor, not a ceiling.'],
    improvements,
    questions: QUESTION_STEMS,
    coverage,
  };
}

/* ── student simulation ─────────────────────────────────────────────────── */

const PERSONA_TRAITS = {
  beginner: {
    /* Says the right idea in the wrong words, and needs the question, not the answer. */
    deflection: [
      'Okay but what do I actually look at first?',
      'Is it about the pieces or the squares?',
      'I only saw one thing there. What was I meant to see?',
      'Where exactly? Sorry, I still do not see it.',
    ],
    resists: false,
    revealRate: 60,
    giveUpAfter: 2,
  },
  intermediate: {
    /* Finds the move, cannot justify it — the classic coaching problem. */
    deflection: [
      'I found it, but why is that good?',
      'It just looks better to me. Can you give me the reason?',
      'What would happen if I played something else?',
      'I see the tactic, but I do not know how to say why.',
    ],
    resists: false,
    revealRate: 45,
    giveUpAfter: 3,
  },
  advanced: {
    /* Resists hints, pushes back, and demands substance. */
    deflection: [
      'That is the textbook line. Tell me what is actually wrong with it.',
      'I do not need the position restated. What is the principle behind it?',
      'Everyone says that. Give me the reason it fails.',
      'Fine. But what is the counter-argument to your own advice?',
    ],
    resists: true,
    revealRate: 25,
    giveUpAfter: 4,
  },
};

export function personaTraits(personaKey) {
  return PERSONA_TRAITS[personaKey] || PERSONA_TRAITS.intermediate;
}

/**
 * The student's next line.
 *
 * `progress` is how many times the coach has already nudged. Behaviour is
 * therefore a genuine escalation ladder rather than a random shuffle: the
 * student gets vaguer as hints are ignored, and only reveals the misconception
 * once patience runs out. The misconception is drawn from the topic's own
 * `misconception` field, so the student errs the way this topic's students do.
 */
export function studentReply(topic, { persona = 'intermediate', progress = 0, seed = 'sim' } = {}) {
  const traits = personaTraits(persona);
  const pool = Array.isArray(topic?.mistakes) ? topic.mistakes.filter(Boolean) : [];
  const misconception = topic?.misconception;

  /* Reveal early for a beginner, hold out for an advanced student. */
  const revealAt = traits.giveUpAfter;
  if (pool.length && progress >= revealAt && misconception) {
    return {
      role: 'student',
      text: pick(pool, `${seed}-${progress}`, 'mistake'),
      kind: 'reveals-misconception',
      misconception,
    };
  }

  if (!traits.resists || progress === 0) {
    return { role: 'student', text: pick(traits.deflection, `${seed}-${progress}`, 'deflect'), kind: 'deflect' };
  }

  const lines = [
    'You are avoiding the question. What is the principle?',
    'I asked why, not what. Answer the why.',
    'That is a slogan. Show me the reasoning.',
    'I already knew that. What have I not understood?',
  ];
  return { role: 'student', text: pick(lines, `${seed}-${progress}`, 'resist'), kind: 'resists' };
}

/** The coach's escalating nudge. Same input, same nudge. */
export function coachNudge(topic, { progress = 0, persona = 'intermediate' } = {}) {
  const traits = personaTraits(persona);
  const topicId = topic?.id ?? 'topic';
  if (progress === 0) {
    return `Ask, don't tell. Start with: "${topic?.teachBack?.brief ? `what would you say to a student who asked you to explain ${topic.name}?` : `what do you think ${topic?.name ?? 'this'} is for?`}"`;
  }
  if (progress === 1) {
    return `Narrow it. Ask: "what does it change in the position?" — then stay quiet and let them answer.`;
  }
  if (progress === 2) {
    return `Give a partial hint, still as a question. Reference the idea in "${topic?.name ?? topicId}" without naming the move.`;
  }
  if (progress < traits.giveUpAfter) {
    return `They are resisting. Stop asking and demonstrate once — then immediately ask them to explain it back to you.`;
  }
  return `Time to name the misconception directly. Their error is: ${topic?.misconception || 'believing the idea without a reason'}.`;
}

/* ── coach test scoring ─────────────────────────────────────────────────── */

export function scoreTest(testArray, answers) {
  const list = Array.isArray(testArray) ? testArray : [];
  const correct = list.filter((q) => Number(answers?.[q.id]) === q.answer).length;
  return {
    total: list.length,
    correct,
    percent: list.length ? Math.round((correct / list.length) * 100) : 0,
  };
}

/** Wrong answers, each with the explanation the curriculum already contains. */
export function reviewWrong(testArray, answers) {
  return (Array.isArray(testArray) ? testArray : [])
    .filter((q) => Number(answers?.[q.id]) !== q.answer)
    .map((q) => ({
      q: q.q,
      yourAnswer: q.options[Number(answers?.[q.id])] ?? 'No answer',
      correct: q.options[q.answer],
      explain: q.explain,
    }));
}

/* ── final exam assembly ────────────────────────────────────────────────── */

/**
 * Build a level's final exam from its own topics.
 *
 * Section weights are equal by default, but the level's declared sections win
 * where they disagree — Level 1 is mostly teaching, Level 6 is mostly tactics,
 * and the exam should look like the level rather than a generic paper.
 */
export function buildFinalExam(level, topics) {
  const sections = level?.finalExam?.sections ?? ['theory', 'teaching'];
  const per = topics.length || 1;
  /* Minimum one question per section, then share the rest by topic count. */
  const base = Math.max(1, Math.floor(per / Math.max(1, sections.length * 2)));

  const items = [];
  for (const topic of topics) {
    for (const section of sections) {
      const n = Math.max(1, base);
      const source = section === 'tactical' || section === 'board'
        ? topic.practice
        : topic.test;
      if (!source?.length) continue;
      for (let i = 0; i < Math.min(n, source.length); i += 1) {
        if (section === 'tactical' || section === 'board') {
          items.push({
            kind: 'position',
            section,
            topicId: topic.id,
            topicName: topic.name,
            level: topic.level,
            id: `${topic.id}-${section}-${i}`,
            fen: source[i].fen,
            prompt: source[i].prompt,
            solution: source[i].solution,
            hint: source[i].hint,
            /* For a position section the coach must type the plan, which is
               graded on keywords rather than on one "right" move. */
            best: source[i].best || source[i].solution,
          });
        } else {
          items.push({
            kind: 'question',
            section,
            topicId: topic.id,
            topicName: topic.name,
            level: topic.level,
            ...source[i],
          });
        }
      }
    }
  }
  return {
    level: level?.n ?? null,
    title: level?.finalExam?.title ?? 'Final Exam',
    passMark: level?.finalExam?.passMark ?? 80,
    sections,
    items,
  };
}

/**
 * Grade a position answer. There is no engine to compare moves against here,
 * so grading is keyword coverage of the curriculum's own solution — honest,
 * deterministic, and it rewards naming the plan rather than guessing a move.
 */
export function gradePositionAnswer(item, answer) {
  const text = String(answer || '').trim();
  if (!text) return { percent: 0, hit: [], missing: tokenize(item.solution || '') };
  const answerTokens = new Set(tokenize(text));
  const solutionTokens = [...new Set(tokenize(item.solution || ''))];
  if (!solutionTokens.length) return { percent: 50, hit: [], missing: [] };
  const hit = solutionTokens.filter((w) => answerTokens.has(w));
  const missing = solutionTokens.filter((w) => !answerTokens.has(w));
  const ratio = hit.length / solutionTokens.length;
  /* A short answer that hits the key words should not be punished for length. */
  const lengthBonus = text.split(/\s+/).length >= 8 ? 1 : 0.85;
  return {
    percent: Math.round(Math.min(100, ratio * 100 * lengthBonus)),
    hit,
    missing,
  };
}

export function gradeExam(exam, answers) {
  const scored = exam.items.map((item) => {
    if (item.kind === 'position') {
      const g = gradePositionAnswer(item, answers[item.id]);
      return { item, percent: g.percent, detail: g };
    }
    const ok = Number(answers[item.id]) === item.answer;
    return { item, percent: ok ? 100 : 0, detail: null };
  });

  const bySection = {};
  for (const { item, percent } of scored) {
    bySection[item.section] = bySection[item.section] || { section: item.section, sum: 0, count: 0 };
    bySection[item.section].sum += percent;
    bySection[item.section].count += 1;
  }
  const sections = Object.entries(bySection).map(([k, v]) => ({
    section: k,
    percent: Math.round(v.sum / v.count),
  }));

  const overall = scored.length
    ? Math.round(scored.reduce((a, s) => a + s.percent, 0) / scored.length)
    : 0;

  return {
    overall,
    passed: overall >= (exam.passMark ?? 80),
    passMark: exam.passMark ?? 80,
    sections,
    scored,
  };
}

/* ── the responder ──────────────────────────────────────────────────────── */

function boardLine(topic) {
  if (!topic?.board?.fen) return null;
  const info = describePosition(topic.board.fen);
  if (!info) return null;
  const facts = [];
  facts.push(`${info.turn === 'w' ? 'White' : 'Black'} to move`);
  if (info.checkmate) facts.push('checkmate');
  else if (info.stalemate) facts.push('stalemate');
  else if (info.inCheck) facts.push('in check');
  facts.push(`${info.legalMoves} legal moves`);
  const forcing = notationOf(topic.board.fen, 2);
  if (forcing.length) facts.push(`forcing options: ${forcing.join(', ')}`);
  return `On the demo position (${topic.board.fen}): ${facts.join(', ')}. ${topic.board.caption}`;
}

function answersFor(intent, topic, allTopics) {
  const c = topic?.content ?? {};
  const name = topic?.name ?? 'this topic';
  const out = [];

  switch (intent) {
    case 'method':
      out.push(`**How to teach ${name}.**\n${c.coachMethod || c.deep}`);
      if (topic.teachBack?.brief) out.push(`Your teach-back brief: ${topic.teachBack.brief}`);
      break;
    case 'example':
      out.push(`**A coaching exchange.**\nStudent: "${c.example?.student || 'I do not see it.'}"\nCoach: "${c.example?.coach || c.coachMethod}"`);
      break;
    case 'mistake':
      out.push(`**Common mistakes in ${name}.**\n${asList(topic.mistakes, 5)}`);
      if (topic.misconception) out.push(`The misconception behind most of them: ${topic.misconception}`);
      break;
    case 'misconception':
      out.push(topic.misconception
        ? `A student who holds this belief will **${lowerFirst(topic.misconception)}**. Correct it by asking what the belief would have to be true for — then showing it is not.`
        : `No misconception recorded for ${name}.`);
      break;
    case 'board': {
      const line = boardLine(topic);
      out.push(line || `${name} has no demo position recorded.`);
      if (topic.practice?.length) {
        const p = topic.practice[0];
        out.push(`Practice position: ${p.prompt}\n${p.solution}`);
      }
      break;
    }
    case 'teachback':
      out.push(`**Teach-back brief for ${name}.**\n${topic.teachBack?.brief || ''}`);
      out.push(`Must cover:\n${asList(topic.teachBack?.required, 5)}`);
      if (topic.teachBack?.lookFor?.length) out.push(`Look for:\n${asList(topic.teachBack.lookFor, 3)}`);
      break;
    case 'assessment':
      out.push(`**Coach test on ${name}.**\n${(topic.test || []).map((q, i) => `${i + 1}. ${q.q}\n   ${q.options.map((o, oi) => `${String.fromCharCode(65 + oi)}) ${o}`).join('  ')}`).join('\n')}`);
      out.push(`Mark it with the curriculum's own explanations, then send it for revision if they miss one.`);
      break;
    case 'hint':
      out.push(pick(topic.practice, topic.id, 'hint')?.hint || `Ask: what changes in the position if you do nothing?`);
      break;
    case 'overview':
    default:
      out.push(`**${name}** — ${topic.summary}`);
      out.push(`${c.definition}`);
      out.push(`Why it matters: ${c.why}`);
      break;
  }

  /* Always offer a way onward. */
  const neighbours = (allTopics || []).filter((t) => t.id !== topic?.id && t.level === topic?.level);
  if (neighbours.length) {
    const next = pick(neighbours, topic?.id, 'neighbour');
    if (next) out.push(`Related in Level ${next.level}: **${next.name}** — ask about that if it is the weaker side of the same idea.`);
  }
  return out.filter(Boolean);
}

/**
 * Produce one reply. `context` supplies the curriculum slice it may draw on, so
 * this function has no hidden dependencies and stays testable.
 */
export function respond(message, context = {}) {
  const { topic = null, topics = [], level = null, mode = 'learn' } = context;
  const intent = classifyIntent(message);
  const text = String(message || '').trim();

  if (!topic && !topics.length) {
    return {
      role: 'coach',
      text: 'No curriculum is loaded, so I cannot ground an answer. Open a topic first.',
      engine: 'local',
      intent,
      groundedIn: [],
    };
  }

  const resolved = topic || searchTopics(text, topics, 1)[0]?.topic || topics[0] || null;
  const parts = answersFor(intent, resolved, topics);

  /* "Go deeper" re-voices the explanation instead of repeating the definition. */
  if (/\b(more|depth|deeper|go on|continue|why though|and\?)\b/i.test(text) && resolved?.content.deep) {
    parts.splice(1, 0, laterPart(resolved.content.deep, 1, 2) || resolved.content.deep);
  }

  return {
    role: 'coach',
    text: parts.filter(Boolean).join('\n\n'),
    engine: 'local',
    intent,
    mode,
    level: resolved?.level ?? level ?? null,
    groundedIn: resolved
      ? [{ id: resolved.id, name: resolved.name, level: resolved.level, section: intent }]
      : [],
    /* An explicit reminder that this is curriculum-grounded, not a model. */
    source: 'curriculum',
  };
}

/* ── game analysis ──────────────────────────────────────────────────────── */

/**
 * Analysis is structural, not engine-derived: material, piece activity, king
 * safety and pawn structure, read straight off the FEN. That is honest for a
 * local engine and matches the curriculum's own vocabulary.
 */
export function analysePosition(fen) {
  const c = loadPosition(fen);
  if (!c) return null;
  const board = c.board();
  const values = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
  const tally = { w: { material: 0, pieces: 0 }, b: { material: 0, pieces: 0 } };

  for (const row of board) {
    for (const piece of row) {
      if (!piece) continue;
      const side = piece.color === 'w' ? 'w' : 'b';
      tally[side].material += values[piece.type] || 0;
      tally[side].pieces += 1;
    }
  }

  const diff = tally.w.material - tally.b.material;
  const info = describePosition(fen);
  return {
    fen: c.fen(),
    material: { white: tally.w.material, black: tally.b.material, diff },
    balance: diff === 0 ? 'equal' : diff > 0 ? `White is up ${diff}` : `Black is up ${Math.abs(diff)}`,
    development: tally,
    inCheck: info?.inCheck ?? false,
    turn: info?.turn,
    legalMoves: info?.legalMoves ?? 0,
    /* Turned into coaching prose by the UI — kept as data here. */
    verdict: diff === 0 ? 'Material level. The decision is positional.' : `${diff > 0 ? 'White' : 'Black'} has the material edge; the coaching question is whether it is the right kind of advantage.`,
  };
}

export const AI_COACH_PROVIDER = 'local';

export const AICoach = {
  respond,
  classifyIntent,
  searchTopics,
  evaluateTeachBack,
  studentReply,
  coachNudge,
  personaTraits,
  scoreTest,
  reviewWrong,
  buildFinalExam,
  gradeExam,
  gradePositionAnswer,
  analysePosition,
  describePosition,
  pick,
  pickMany,
  hashString,
  provider: AI_COACH_PROVIDER,
  modes: TRAINING_MODES,
  personas: STUDENT_PERSONAS,
};

export default AICoach;