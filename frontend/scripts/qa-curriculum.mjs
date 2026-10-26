import { Chess } from 'chess.js';
import { normaliseLevel, validateLevel, looksLikeFen } from '../src/features/coachAcademy/data/topicSchema.js';

const levels = [];
for (let n = 1; n <= 10; n += 1) {
  const mod = await import(`../src/features/coachAcademy/data/curriculum/level${n}.js`);
  levels.push(normaliseLevel(mod.default));
}

let totalTopics = 0;
let totalFens = 0;
let totalModes = new Set();

for (const lv of levels) {
  const problems = validateLevel(lv);
  const fens = [];
  for (const mod of lv.modules) {
    for (const topic of mod.topics) {
      const content = topic.content || {};
      if (content.board && content.board.fen) fens.push([topic.id, content.board.fen]);
      for (const p of topic.practice || []) if (p.fen) fens.push([topic.id, p.fen]);
      for (const m of topic.modes || []) totalModes.add(m);
    }
  }
  totalTopics += lv.modules.reduce((a, m) => a + m.topics.length, 0);
  totalFens += fens.length;

  const illegal = [];
  for (const [id, fen] of fens) {
    if (!looksLikeFen(fen)) {
      illegal.push(`${id} MALFORMED ${fen}`);
      continue;
    }
    try {
      const c = new Chess(fen);
      const inCheck = c.inCheck();
      const kingCount = c
        .board()
        .flat()
        .filter((p) => p && p.type === 'k').length;
      if (kingCount !== 2) illegal.push(`${id} KINGCOUNT ${fen}`);
      void inCheck;
    } catch (e) {
      illegal.push(`${id} ILLEGAL ${fen} :: ${String(e.message).slice(0, 70)}`);
    }
  }

  console.log(
    `L${lv.n} "${lv.title}" topics=${lv.modules.reduce((a, m) => a + m.topics.length, 0)} schema=${problems.length} fens=${fens.length} illegal=${illegal.length}`,
  );
  problems.forEach((p) => console.log('   schema:', p));
  illegal.forEach((x) => console.log('   fen:', x));
}

console.log('---');
console.log('levels', levels.length, 'topics', totalTopics, 'fens', totalFens, 'modes', [...totalModes].sort().join(','));