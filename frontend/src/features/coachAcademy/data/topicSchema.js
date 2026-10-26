/**
 * Topic shape, normaliser and validator.
 *
 * Curriculum is data, so it gets a contract. `normaliseTopic` fills in safe
 * defaults and `validateTopic` reports what is missing — which means a typo in
 * a lesson file surfaces as a clear error instead of an empty step in the UI.
 *
 * A topic looks like:
 *
 *   {
 *     id, level, moduleId, name, summary,
 *     content: { definition, deep, why, when, whenNot, coachMethod,
 *                example: { student, coach }, realGame },
 *     mistakes: [string],
 *     board:   { fen, caption, highlight: [square], arrows: [[from, to]] },
 *     practice:[{ fen, prompt, solution, hint, best }],
 *     teachBack: { brief, required: [concept], lookFor: [string] },
 *     misconception: string,      // what a student would wrongly believe
 *     puzzlePrompt: string,       // the coach must build a puzzle
 *     test: [{ q, options, answer, explain }],
 *   }
 */

const str = (v, fallback = '') => (typeof v === 'string' ? v.trim() : fallback);
const arr = (v) => (Array.isArray(v) ? v.filter((x) => x != null) : []);

/**
 * Cheap structural FEN check — enough to catch a typo in a lesson file without
 * pulling a chess library into a data module.
 *
 * A legal FEN has 6 rank fields, and only these characters may appear:
 * piece letters, digits 1-8, `/`, and the field separators `w`/`b`, `KQkq`,
 * `-` (castling/ep passant), digits and spaces. The `-` is the character a
 * naive `[a-zA-Z0-9/]` check rejects, which is exactly the bug this replaces.
 */
export function looksLikeFen(fen) {
  if (typeof fen !== 'string') return false;
  const trimmed = fen.trim();
  if (!trimmed) return false;
  const fields = trimmed.split(/\s+/);
  if (fields.length < 4 || fields.length > 6) return false;
  if (!/^[wb]$/.test(fields[1])) return false;
  if (!/^(K?Q?k?q?|-)$/.test(fields[2])) return false;
  if (!/^(-|[a-h][1-8])$/.test(fields[3])) return false;

  const placement = fields[0];
  if (placement.split('/').length !== 8) return false;
  return /^[a-zA-Z0-9/]+$/.test(placement);
}

export function normaliseTopic(raw, { level, moduleId } = {}) {
  const content = raw?.content || {};
  const example = content.example || {};

  return {
    id: str(raw?.id) || `${moduleId}-${str(raw?.name).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    level: level ?? raw?.level ?? null,
    moduleId: moduleId ?? raw?.moduleId ?? null,
    name: str(raw?.name, 'Untitled topic'),
    summary: str(raw?.summary),
    content: {
      definition: str(content.definition),
      deep: str(content.deep),
      why: str(content.why),
      when: str(content.when),
      whenNot: str(content.whenNot),
      coachMethod: str(content.coachMethod),
      example: {
        student: str(example.student),
        coach: str(example.coach),
      },
      realGame: str(content.realGame),
    },
    mistakes: arr(raw?.mistakes).map((m) => str(m)).filter(Boolean),
    board: raw?.board
      ? {
          fen: str(raw.board.fen),
          caption: str(raw.board.caption),
          highlight: arr(raw.board.highlight).map((s) => str(s)).filter(Boolean),
          arrows: arr(raw.board.arrows)
            .map((a) => (Array.isArray(a) ? [str(a[0]), str(a[1])] : null))
            .filter((a) => a && a[0] && a[1]),
        }
      : null,
    practice: arr(raw?.practice)
      .map((p, i) => ({
        id: str(p?.id) || `${raw?.id || 'topic'}-p${i + 1}`,
        fen: str(p?.fen),
        prompt: str(p?.prompt),
        solution: str(p?.solution),
        hint: str(p?.hint),
        best: str(p?.best),
      }))
      .filter((p) => p.fen),
    teachBack: {
      brief: str(raw?.teachBack?.brief) || `Teach "${raw?.name ?? 'this topic'}" to a student in your own words.`,
      required: arr(raw?.teachBack?.required).map((x) => str(x)).filter(Boolean),
      lookFor: arr(raw?.teachBack?.lookFor).map((x) => str(x)).filter(Boolean),
    },
    misconception: str(raw?.misconception),
    puzzlePrompt: str(raw?.puzzlePrompt) || `Create a practice puzzle that tests ${raw?.name ?? 'this topic'} for one of your students.`,
    test: arr(raw?.test)
      .map((q, i) => ({
        id: str(q?.id) || `${raw?.id || 'topic'}-q${i + 1}`,
        q: str(q?.q),
        options: arr(q?.options).map((o) => str(o)).filter(Boolean),
        answer: Number(q?.answer),
        explain: str(q?.explain),
      }))
      .filter((q) => q.q && q.options.length >= 2 && Number.isInteger(q.answer)),
  };
}

export function normaliseModule(raw, level) {
  const moduleId = str(raw?.id) || `level-${level}-module`;
  const topics = arr(raw?.topics)
    .map((t) => normaliseTopic(t, { level, moduleId }))
    .filter((t) => t.name);
  return {
    id: moduleId,
    level,
    title: str(raw?.title, 'Module'),
    description: str(raw?.description),
    topics,
  };
}

export function normaliseLevel(raw) {
  const modules = arr(raw?.modules).map((m) => normaliseModule(m, raw?.n));
  return {
    n: raw?.n,
    id: str(raw?.id) || `level-${raw?.n}`,
    title: str(raw?.title, `Level ${raw?.n}`),
    tagline: str(raw?.tagline),
    description: str(raw?.description),
    finalTask: str(raw?.finalTask),
    finalExam: raw?.finalExam || { title: 'Final Exam', passMark: 80, sections: ['theory'] },
    competency: arr(raw?.competency),
    modules,
    topics: modules.flatMap((m) => m.topics),
  };
}

/**
 * Report problems in a normalised level. Returns an array of human-readable
 * strings; empty means clean. Used by tests and by a dev-time console warning.
 */
export function validateLevel(level) {
  const problems = [];
  if (!level || typeof level.n !== 'number') return ['level is missing a numeric `n`'];

  for (const mod of level.modules || []) {
    if (!mod.topics.length) problems.push(`L${level.n} / ${mod.id}: module has no topics`);
    for (const t of mod.topics) {
      const where = `L${level.n} / ${t.id}`;
      if (!t.content.definition) problems.push(`${where}: missing content.definition`);
      if (!t.content.coachMethod) problems.push(`${where}: missing content.coachMethod`);
      if (!t.content.why) problems.push(`${where}: missing content.why`);
      if (!t.content.whenNot) problems.push(`${where}: missing content.whenNot`);
      if (!t.mistakes.length) problems.push(`${where}: needs at least one common mistake`);
      if (!t.misconception) problems.push(`${where}: missing misconception (student simulation needs one)`);
      if (!t.test.length) problems.push(`${where}: needs at least one coach-test question`);
      for (const q of t.test) {
        if (q.answer < 0 || q.answer >= q.options.length) {
          problems.push(`${where}/${q.id}: answer index ${q.answer} is out of range`);
        }
      }
      for (const p of t.practice) {
        if (!p.prompt) problems.push(`${where}/${p.id}: practice item has no prompt`);
      }
      /* A board demo must be a loadable position, or step 3 renders nothing. */
      if (t.board?.fen && !looksLikeFen(t.board.fen)) {
        problems.push(`${where}: board.fen looks malformed`);
      }
    }
  }
  return problems;
}