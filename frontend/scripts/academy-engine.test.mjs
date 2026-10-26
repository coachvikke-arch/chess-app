/**
 * AI Coach Training Academy — engine and store behaviour.
 *
 * Two properties matter more than anything else here:
 *
 *  1. DETERMINISM. The engine grades a coach's work. If the same teach-back
 *     scored differently on a retry, no score in the product would mean
 *     anything and no mastery could be earned honestly.
 *
 *  2. FAIL-CLOSED MASTERY. A level must not open without its final exam passed.
 *     These tests pin that, because it is the one rule the whole ladder rests on
 *     and there is deliberately no other path to it.
 *
 * Run with: npm run test:academy-engine
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./esm-extension-hook.mjs', import.meta.url);

const AICoach = (await import('../src/features/coachAcademy/services/aiCoach.js')).default;
const store = await import('../src/features/coachAcademy/services/academyStore.js');
const { MASTERY_THRESHOLD } = await import('../src/features/coachAcademy/data/levels.js');

const getTopic = store.getTopic;
const getLevelRecord = store.getLevelRecord;
const PIN = getTopic('l2-pin');

/* ── determinism ───────────────────────────────────────────────────────── */

test('the same question always produces the same answer', () => {
  const probes = ['explain', 'how do I teach it', 'mistakes', 'board', 'hint', 'misconception', 'test'];
  for (const probe of probes) {
    const a = AICoach.respond(probe, { topic: PIN, topics: store.ALL_TOPICS });
    const b = AICoach.respond(probe, { topic: PIN, topics: store.ALL_TOPICS });
    assert.equal(a.text, b.text, `non-deterministic answer for "${probe}"`);
  }
});

test('the same teach-back always scores the same', () => {
  const good =
    'A pin happens when a piece cannot legally move because moving exposes its own king. It exists because the defender must answer the attack, so the attacker wins material or time. For example a knight pinned on the e-file cannot be developed. A student wrongly believes a pin always wins material, but often it only wins time.';
  const scores = Array.from({ length: 3 }, () => AICoach.evaluateTeachBack(good, PIN).percent);
  assert.equal(new Set(scores).size, 1, `teach-back grading varied: ${scores.join(', ')}`);
});

test('pick is stable for a given seed and varies across seeds', () => {
  const list = ['a', 'b', 'c', 'd', 'e'];
  assert.equal(AICoach.pick(list, 'seed1', 'x'), AICoach.pick(list, 'seed1', 'x'));
  const many = new Set(Array.from({ length: 40 }, (_, i) => AICoach.pick(list, `seed${i}`, 'x')));
  assert.ok(many.size > 1, 'pick never varied across seeds — it is not actually seeded');
});

/* ── teach-back grading ────────────────────────────────────────────────── */

test('an empty or very short teach-back scores low', () => {
  assert.ok(AICoach.evaluateTeachBack('', PIN).percent < 30);
  assert.ok(AICoach.evaluateTeachBack('It is a pin.', PIN).percent < 30);
});

test('a substantive teach-back scores meaningfully higher than a bare one', () => {
  const bare = AICoach.evaluateTeachBack('It is a pin.', PIN).percent;
  const good = AICoach.evaluateTeachBack(
    'A pin happens when a piece cannot legally move because moving exposes its own king to the enemy. It exists because the defender must answer the attack, so the attacker wins material or at least time. For example, a knight pinned on the e-file against a rook cannot be developed to c3. A student wrongly believes a pin always wins material, but very often it only wins time, which is why you check what happens if the defender does not take.',
    PIN,
  ).percent;
  assert.ok(good > bare + 30, `expected a real gap, got bare=${bare} good=${good}`);
});

test('grading never returns NaN or a non-finite score', () => {
  /* This was a real bug: the novelty helper read `.length` on a Set and every
     teach-back score came back NaN, which rendered as a blank result. */
  const inputs = ['', '   ', 'pin', 'a'.repeat(500), '!@#$%', PIN.teachBack.brief];
  for (const input of inputs) {
    const r = AICoach.evaluateTeachBack(input, PIN);
    assert.ok(Number.isFinite(r.percent), `NaN percent for ${JSON.stringify(input.slice(0, 20))}`);
    for (const [k, v] of Object.entries(r.scores)) {
      assert.ok(Number.isFinite(v), `NaN score.${k} for ${JSON.stringify(input.slice(0, 20))}`);
      assert.ok(v >= 0 && v <= 100, `score.${k} out of range: ${v}`);
    }
  }
});

/* ── intent routing ────────────────────────────────────────────────────── */

test('intent routing sends board questions to the board, not the example script', () => {
  /* "show me on the board" used to match the looser "show me" example pattern. */
  assert.equal(AICoach.classifyIntent('show me on the board'), 'board');
  assert.equal(AICoach.classifyIntent('what does this position show'), 'board');
});

test('intent routing covers each branch', () => {
  const cases = {
    'how do you teach this': 'method',
    'teach back brief': 'teachback',
    'what mistakes do students make': 'mistake',
    'common errors': 'mistake',
    'misconception': 'misconception',
    'give me a hint': 'hint',
    'test me on this': 'assessment',
  };
  for (const [text, expected] of Object.entries(cases)) {
    assert.equal(AICoach.classifyIntent(text), expected, `"${text}"`);
  }
});

/* ── search ────────────────────────────────────────────────────────────── */

test('search finds topics by name and reports a confidence', () => {
  const hits = AICoach.searchTopics('back rank mate', store.ALL_TOPICS, 5);
  assert.ok(hits.length > 0, 'no search hits');
  assert.ok(hits[0].topic.name.toLowerCase().includes('back rank'), `unexpected top hit: ${hits[0].topic.name}`);
  assert.ok(hits[0].confidence > 0);
});

test('search handles an empty curriculum and an empty query without throwing', () => {
  assert.deepEqual(AICoach.searchTopics('anything', [], 5), []);
  assert.deepEqual(AICoach.searchTopics('', store.ALL_TOPICS, 5), []);
  assert.deepEqual(AICoach.searchTopics(null, store.ALL_TOPICS, 5), []);
});

/* ── student simulation ────────────────────────────────────────────────── */

test('the student escalates and eventually reveals the misconception', () => {
  for (const persona of ['beginner', 'intermediate', 'advanced']) {
    const lines = Array.from({ length: 8 }, (_, i) => AICoach.studentReply(PIN, { persona, progress: i, seed: 's' }));
    assert.ok(
      lines.some((l) => l.kind === 'reveals-misconception'),
      `${persona} never revealed the misconception`,
    );
    /* A reveal must carry the topic's own misconception text. */
    const reveal = lines.find((l) => l.kind === 'reveals-misconception');
    assert.equal(reveal.misconception, PIN.misconception);
  }
});

test('an advanced student resists before revealing, a beginner deflects', () => {
  const advanced = AICoach.studentReply(PIN, { persona: 'advanced', progress: 1, seed: 's' });
  assert.equal(advanced.kind, 'resists');
  const beginner = AICoach.studentReply(PIN, { persona: 'beginner', progress: 0, seed: 's' });
  assert.equal(beginner.kind, 'deflect');
});

/* ── exams ─────────────────────────────────────────────────────────────── */

test('a level exam is built from that level\'s own topics and sections', () => {
  for (const n of [1, 3, 6, 10]) {
    const level = getLevelRecord(n);
    const exam = AICoach.buildFinalExam(level, level.topics);
    assert.equal(exam.level, n);
    assert.equal(exam.passMark, level.finalExam.passMark);
    assert.ok(exam.items.length > 0, `L${n} exam is empty`);
    for (const section of level.finalExam.sections) {
      assert.ok(
        exam.items.some((i) => i.section === section),
        `L${n} exam omits declared section ${section}`,
      );
    }
  }
});

test('perfect answers score 100 and empty answers score 0', () => {
  for (const n of [1, 6, 10]) {
    const level = getLevelRecord(n);
    const exam = AICoach.buildFinalExam(level, level.topics);
    const perfect = {};
    for (const item of exam.items) {
      perfect[item.id] = item.kind === 'question' ? item.answer : item.solution;
    }
    assert.equal(AICoach.gradeExam(exam, perfect).overall, 100, `L${n} perfect answers`);
    assert.equal(AICoach.gradeExam(exam, {}).overall, 0, `L${n} empty answers`);
  }
});

test('an empty position answer is graded 0 and never passes', () => {
  const level = getLevelRecord(6);
  const exam = AICoach.buildFinalExam(level, level.topics);
  const positionItem = exam.items.find((i) => i.kind === 'position');
  const graded = AICoach.gradePositionAnswer(positionItem, '');
  assert.equal(graded.percent, 0);
});

test('exam grading reports a per-section breakdown', () => {
  const level = getLevelRecord(1);
  const exam = AICoach.buildFinalExam(level, level.topics);
  const result = AICoach.gradeExam(exam, {});
  assert.ok(result.sections.length > 0);
  for (const s of result.sections) {
    assert.ok(Number.isFinite(s.percent));
  }
  assert.equal(result.passed, false);
});

/* ── store: mastery is earned ──────────────────────────────────────────── */

/* An in-memory localStorage so the store can be exercised without a browser. */
function withStorage(fn) {
  const previous = globalThis.localStorage;
  const map = new Map();
  globalThis.localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
  try {
    return fn();
  } finally {
    globalThis.localStorage = previous;
  }
}

test('level 1 is open but level 2 is locked on a fresh account', () => {
  withStorage(() => {
    const coach = { id: 'coach-a', name: 'Coach A' };
    const state = store.loadState(coach);
    assert.equal(store.isUnlocked(1, state), true);
    assert.equal(store.isUnlocked(2, state), false);
    assert.ok(store.lockReason(2, state), 'a locked level must explain itself');
  });
});

test('a failing final exam does NOT unlock the next level', () => {
  withStorage(() => {
    const coach = { id: 'coach-b', name: 'Coach B' };
    const level = getLevelRecord(1);
    const below = level.finalExam.passMark - 10;
    const out = store.recordAssessment(coach, 1, { score: below });
    assert.equal(out.passed, false, 'a failing score must not pass');
    assert.equal(store.isUnlocked(2, out.state), false, 'a failing exam must not unlock Level 2');
  });
});

test('a passing final exam unlocks the next level', () => {
  withStorage(() => {
    const coach = { id: 'coach-c', name: 'Coach C' };
    const level = getLevelRecord(1);
    const out = store.recordAssessment(coach, 1, { score: level.finalExam.passMark });
    assert.equal(out.passed, true);
    assert.equal(store.isUnlocked(2, out.state), true);
  });
});

test('a later failing attempt never revokes an earned pass', () => {
  withStorage(() => {
    const coach = { id: 'coach-d', name: 'Coach D' };
    const level = getLevelRecord(1);
    store.recordAssessment(coach, 1, { score: level.finalExam.passMark });
    const again = store.recordAssessment(coach, 1, { score: 10 });
    assert.equal(again.passed, true, 'a pass was revoked by a later failure');
    assert.equal(again.state.assessments['1'].best, level.finalExam.passMark);
    assert.equal(again.state.assessments['1'].attempts, 2);
  });
});

test('a topic starts at 0% mastery and only reading it does not change that', () => {
  withStorage(() => {
    const coach = { id: 'coach-e', name: 'Coach E' };
    const fresh = store.loadState(coach);
    assert.equal(store.masteryPercent(store.topicRecord(fresh, 'l2-pin').scores), 0);
    assert.equal(store.levelProgress(1, fresh).percent, 0);
    assert.equal(store.overallProgress(fresh), 0);
  });
});

test('recording criteria raises mastery, and the best score per criterion wins', () => {
  withStorage(() => {
    const coach = { id: 'coach-f', name: 'Coach F' };
    store.recordCriterion(coach, 'l2-pin', 'explanation', 90);
    const high = store.recordCriterion(coach, 'l2-pin', 'explanation', 40);
    assert.equal(high.record.scores.explanation, 90, 'a weak retry overwrote a good score');

    /* Enough criteria above the threshold must actually master the topic. */
    for (const c of ['understanding', 'recognition', 'analysis', 'demonstration', 'teaching ability']) {
      store.recordCriterion(coach, 'l2-pin', c, 95);
    }
    const done = store.loadState(coach);
    const percent = store.masteryPercent(store.topicRecord(done, 'l2-pin').scores);
    assert.ok(percent >= MASTERY_THRESHOLD, `expected mastery, got ${percent}`);
  });
});

test('progress is scoped per coach', () => {
  withStorage(() => {
    const a = { id: 'coach-x', name: 'X' };
    const b = { id: 'coach-y', name: 'Y' };
    store.recordCriterion(a, 'l2-pin', 'explanation', 95);
    assert.ok(store.masteryPercent(store.topicRecord(store.loadState(a), 'l2-pin').scores) > 0);
    assert.equal(store.masteryPercent(store.topicRecord(store.loadState(b), 'l2-pin').scores), 0, 'coaches shared progress');
  });
});

test('storage failure degrades to in-memory instead of throwing', () => {
  const previous = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('quota exceeded');
    },
    removeItem: () => {
      throw new Error('blocked');
    },
  };
  try {
    const coach = { id: 'coach-g', name: 'G' };
    const state = store.loadState(coach);
    assert.ok(state, 'loadState threw on a hostile storage');
    const out = store.recordCriterion(coach, 'l2-pin', 'explanation', 90);
    assert.ok(out.record, 'recordCriterion threw on a hostile storage');
  } finally {
    globalThis.localStorage = previous;
  }
});

test('corrupt stored JSON falls back to a clean state rather than crashing', () => {
  withStorage(() => {
    globalThis.localStorage.setItem('coachAcademy.v1.coach-h', '{not json');
    const state = store.loadState({ id: 'coach-h' });
    assert.equal(state.topics && typeof state.topics, 'object');
    assert.equal(store.overallProgress(state), 0);
  });
});

test('the revision queue returns weak topics worst-first and skips mastered ones', () => {
  withStorage(() => {
    const coach = { id: 'coach-i', name: 'I' };
    store.recordCriterion(coach, 'l2-pin', 'explanation', 20);
    store.recordCriterion(coach, 'l2-fork', 'explanation', 60);
    const state = store.loadState(coach);
    const q = store.revisionQueue(state, 10);
    assert.ok(q.length >= 2);
    assert.equal(q[0].topicId, 'l2-pin', 'weakest topic should be first');
    for (const t of q) assert.ok(t.percent < MASTERY_THRESHOLD, 'a mastered topic leaked into the queue');
  });
});

test('certification requires the final level exam to be passed', () => {
  withStorage(() => {
    const coach = { id: 'coach-j', name: 'J' };
    let state = store.loadState(coach);
    assert.equal(store.isCertified(state), false);
    /* Passing levels 1..9 is not enough. */
    for (let n = 1; n <= 9; n += 1) {
      state = store.recordAssessment(coach, n, { score: 100 }).state;
    }
    assert.equal(store.isCertified(state), false, 'certified without the Level 10 exam');
    state = store.recordAssessment(coach, 10, { score: 85 }).state;
    assert.equal(store.isCertified(state), true, 'Level 10 passed but not certified');
  });
});

/* ── chat transcripts ──────────────────────────────────────────────────── */

test('chat messages persist per topic and can be cleared', () => {
  withStorage(() => {
    const coach = { id: 'coach-k', name: 'K' };
    store.appendChat(coach, 'l2-pin', { role: 'user', text: 'hello' });
    store.appendChat(coach, 'l2-pin', { role: 'coach', text: 'hi' });
    assert.equal(store.getChat(coach, 'l2-pin').length, 2);
    assert.equal(store.getChat(coach, 'l2-fork').length, 0, 'chat leaked between topics');
    store.clearChat(coach, 'l2-pin');
    assert.equal(store.getChat(coach, 'l2-pin').length, 0);
  });
});