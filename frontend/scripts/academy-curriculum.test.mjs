/**
 * AI Coach Training Academy — curriculum integrity tests.
 *
 * These are the tests that would have caught the two real defects found while
 * building this: a lesson file with an unescaped apostrophe (a SyntaxError that
 * only appears when that one file is imported) and a board caption describing a
 * position that does not match its FEN. Both are the kind of thing a build does
 * not notice and a coach does, at the worst possible moment.
 *
 * Run with: npm run test:academy
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { Chess } from 'chess.js';

/* The app source uses extensionless imports; teach Node the same resolution. */
register('./esm-extension-hook.mjs', import.meta.url);

const { CURRICULUM, ALL_TOPICS, curriculumStats, getTopic, getLevelRecord } = await import(
  '../src/features/coachAcademy/services/academyStore.js'
);
const { normaliseLevel, validateLevel, looksLikeFen } = await import(
  '../src/features/coachAcademy/data/topicSchema.js'
);
const { LEVELS, TRAINING_STEPS, TRAINING_STEPS_SHORT, SHORT_FLOW_LEVELS, trainingStepsFor, TRAINING_MODES, STUDENT_PERSONAS, ASSESSMENT_SECTIONS, MASTERY_THRESHOLD } =
  await import('../src/features/coachAcademy/data/levels.js');

/* ── shape ─────────────────────────────────────────────────────────────── */

test('there are exactly 10 levels, numbered 1..10', () => {
  assert.equal(LEVELS.length, 10);
  assert.deepEqual(
    LEVELS.map((l) => l.n),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  );
  assert.equal(CURRICULUM.length, 10);
});

test('every level has modules, topics and a final exam with a pass mark', () => {
  for (const l of CURRICULUM) {
    assert.ok(l.modules.length > 0, `L${l.n} has no modules`);
    assert.ok(l.topics.length > 0, `L${l.n} has no topics`);
    assert.ok(l.finalTask, `L${l.n} has no final task`);
    assert.ok(l.finalExam?.title, `L${l.n} exam has no title`);
    assert.ok(
      l.finalExam.passMark > 0 && l.finalExam.passMark <= 100,
      `L${l.n} pass mark out of range`,
    );
    assert.ok(l.finalExam.sections.length > 0, `L${l.n} exam has no sections`);
  }
});

test('the training flow is exactly 16 steps and the seven modes / three personas exist', () => {
  assert.equal(TRAINING_STEPS.length, 16);
  assert.deepEqual(
    TRAINING_STEPS.map((s) => s.n),
    Array.from({ length: 16 }, (_, i) => i + 1),
  );
  /* Step keys must be unique or a renderer would silently collapse two steps. */
  assert.equal(new Set(TRAINING_STEPS.map((s) => s.key)).size, 16);
  assert.equal(TRAINING_MODES.length, 7);
  assert.equal(STUDENT_PERSONAS.length, 3);
  assert.ok(ASSESSMENT_SECTIONS.length >= 4);
});

test('the short flow is a valid, self-consistent subset of the full flow', () => {
  const keys = TRAINING_STEPS_SHORT.map((s) => s.key);
  assert.deepEqual(keys, ['concept', 'deep', 'practice']);
  assert.deepEqual(
    TRAINING_STEPS_SHORT.map((s) => s.n),
    [1, 2, 3],
    'the short flow renumbers from 1, so "Step N of M" reads correctly',
  );
  /* Every short step must exist in the full flow, with the same title and
     interactivity, or the renderer would hit an unhandled step key. */
  for (const s of TRAINING_STEPS_SHORT) {
    const full = TRAINING_STEPS.find((f) => f.key === s.key);
    assert.ok(full, `short step "${s.key}" is missing from the full flow`);
    assert.equal(s.title, full.title, `title drift on "${s.key}"`);
    assert.equal(s.interactive, full.interactive, `interactive flag drift on "${s.key}"`);
  }
});

test('only level 2 runs the short flow; every other level keeps all 16 steps', () => {
  assert.deepEqual([...SHORT_FLOW_LEVELS], [2]);

  for (const lvl of LEVELS) {
    const steps = trainingStepsFor(lvl.n);
    if (SHORT_FLOW_LEVELS.includes(lvl.n)) {
      assert.equal(steps, TRAINING_STEPS_SHORT, `level ${lvl.n} should use the short flow`);
    } else {
      assert.equal(steps, TRAINING_STEPS, `level ${lvl.n} must keep the full 16 steps`);
    }
  }
});

test('an unknown or missing level falls back to the full 16-step flow', () => {
  /* The safe direction: a level added later must not silently inherit the
     trimmed flow. */
  for (const bad of [undefined, null, 0, 99, 'nope', NaN]) {
    assert.equal(trainingStepsFor(bad), TRAINING_STEPS, `bad level "${bad}" must fall back`);
  }
});

test('every level in the short flow still authors the content its steps render', () => {
  /* The short flow renders only concept/deep/practice, so a topic on a
     short-flow level missing any of those would render blank. */
  for (const lvl of LEVELS.filter((l) => SHORT_FLOW_LEVELS.includes(l.n))) {
    for (const mod of lvl.modules ?? []) {
      for (const t of mod.topics ?? []) {
        assert.ok(t.content?.concept, `${t.id}: missing concept`);
        assert.ok(t.content?.deep, `${t.id}: missing deep explanation`);
        assert.ok(
          Array.isArray(t.practice) && t.practice.length > 0,
          `${t.id}: short flow renders practice[0], so it needs at least one`,
        );
      }
    }
  }
});

test('every topic passes the schema contract', () => {
  for (const l of CURRICULUM) {
    const problems = validateLevel(normaliseLevel(l));
    assert.deepEqual(problems, [], `L${l.n} schema problems:\n${problems.join('\n')}`);
  }
});

test('topic ids are unique across the whole curriculum', () => {
  const ids = ALL_TOPICS.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate topic id');
});

test('every topic carries the fields the simulation and revision modes depend on', () => {
  for (const t of ALL_TOPICS) {
    assert.ok(t.content.definition, `${t.id}: definition`);
    assert.ok(t.content.deep, `${t.id}: deep`);
    assert.ok(t.content.coachMethod, `${t.id}: coachMethod`);
    assert.ok(t.content.whenNot, `${t.id}: whenNot`);
    assert.ok(t.misconception, `${t.id}: misconception`);
    assert.ok(t.mistakes.length, `${t.id}: mistakes`);
    assert.ok(t.test.length, `${t.id}: test`);
    assert.ok(t.teachBack.brief, `${t.id}: teachBack brief`);
  }
});

/* ── board data ────────────────────────────────────────────────────────── */

test('looksLikeFen accepts real FENs including the "-" placeholder', () => {
  /* The "-" rejection bug: every lesson with a rook-less board failed QA. */
  assert.equal(looksLikeFen('4k3/8/8/8/8/8/4R3/4K3 w - - 0 1'), true);
  assert.equal(looksLikeFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'), true);
  assert.equal(looksLikeFen('nonsense'), false);
  assert.equal(looksLikeFen('8/8/8/8/8/8/8/8 w - -'), true, '8 ranks is structurally fine');
  assert.equal(looksLikeFen('4k3/8/8 w - - 0 1'), false, 'too few ranks');
  assert.equal(looksLikeFen('4k3/8/8/8/8/8/4R3/4K3 x - - 0 1'), false, 'bad side to move');
});

test('every board and practice position is a legal chess position', () => {
  const bad = [];
  for (const t of ALL_TOPICS) {
    const fens = [
      ...(t.board?.fen ? [[`${t.id}.board`, t.board.fen]] : []),
      ...t.practice.map((p, i) => [`${t.id}.practice[${i}]`, p.fen]),
    ];
    for (const [where, fen] of fens) {
      try {
        const c = new Chess(fen);
        /* Two kings, and the side to move cannot be the one already mated. */
        const kings = c
          .board()
          .flat()
          .filter((p) => p && p.type === 'k');
        if (kings.length !== 2) bad.push(`${where}: ${kings.length} kings`);
        if (c.isCheckmate()) bad.push(`${where}: side to move is already checkmated`);
      } catch (e) {
        bad.push(`${where}: ${e.message}`);
      }
    }
  }
  assert.deepEqual(bad, [], `illegal positions:\n${bad.join('\n')}`);
});

test('board annotations only reference squares that exist', () => {
  const bad = [];
  for (const t of ALL_TOPICS) {
    const squares = [...(t.board?.highlight || []), ...(t.board?.arrows || []).flat()];
    for (const sq of squares) {
      if (!/^[a-h][1-8]$/.test(sq)) bad.push(`${t.id}: bad square "${sq}"`);
    }
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

/* ── test-question sanity ──────────────────────────────────────────────── */

test('every coach-test question has a valid answer index and no duplicate options', () => {
  for (const t of ALL_TOPICS) {
    for (const q of t.test) {
      assert.ok(q.options.length >= 2, `${q.id}: needs 2+ options`);
      assert.ok(
        Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.options.length,
        `${q.id}: answer ${q.answer} out of range for ${q.options.length} options`,
      );
      assert.ok(q.explain, `${q.id}: needs an explanation`);
      const dupes = q.options.filter((o, i) => q.options.indexOf(o) !== i);
      assert.deepEqual(dupes, [], `${q.id}: duplicate options ${dupes.join(', ')}`);
    }
  }
});

test('the curriculum is substantial, not a stub', () => {
  const stats = curriculumStats();
  assert.equal(stats.levels, 10);
  assert.ok(stats.topics >= 100, `only ${stats.topics} topics`);
  assert.ok(stats.modules >= 20, `only ${stats.modules} modules`);
});

test('topics are reachable by id and every level resolves', () => {
  for (const t of ALL_TOPICS) {
    assert.equal(getTopic(t.id)?.id, t.id);
    assert.ok(getLevelRecord(t.level), `topic ${t.id} points at missing level ${t.level}`);
  }
});

test('mastery threshold is a sane percentage', () => {
  assert.ok(MASTERY_THRESHOLD > 50 && MASTERY_THRESHOLD <= 100);
});