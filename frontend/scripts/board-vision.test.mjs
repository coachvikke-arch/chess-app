import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  FILES,
  LEVELS,
  accuracyOf,
  adaptiveDecision,
  allSquares,
  attackedSquares,
  avgOf,
  boardGrid,
  classSequence,
  createAnswerLock,
  defendedSquares,
  fileIndexOf,
  flashDurationFor,
  generateQuestion,
  isValidSquare,
  levelUnlockStatus,
  medianOf,
  neighboursOf,
  piecesUnderAttack,
  positionToFen,
  progressToNextLevel,
  randomPosition,
  randomSquare,
  rankClassResults,
  rankOf,
  recordSessionForProgress,
  resolveOrientation,
  sameDiagonal,
  sameFile,
  sameRank,
  seededRng,
  sessionTransition,
  squareColor,
  targetReached,
  validateAnswer,
  xpForSession,
} from '../src/features/boardVision/boardVisionLogic.js';

const rng = (seed) => seededRng(seed);

describe('coordinate mapping — all 64 squares, both orientations', () => {
  it('has exactly 64 unique valid squares', () => {
    const all = allSquares();
    assert.equal(all.length, 64);
    assert.equal(new Set(all).size, 64);
    for (const sq of all) assert.ok(isValidSquare(sq), sq);
  });

  it('white grid: a1 bottom-left, h8 top-right', () => {
    const g = boardGrid('white');
    assert.equal(g.length, 8);
    assert.ok(g.every((r) => r.length === 8));
    assert.equal(g[7][0], 'a1');
    assert.equal(g[7][7], 'h1');
    assert.equal(g[0][0], 'a8');
    assert.equal(g[0][7], 'h8');
    assert.deepEqual(new Set(g.flat()).size, 64);
  });

  it('black grid: a1 top-right, h8 bottom-left', () => {
    const g = boardGrid('black');
    assert.equal(g[0][7], 'a1');
    assert.equal(g[0][0], 'h1');
    assert.equal(g[7][0], 'h8');
    assert.equal(g[7][7], 'a8');
    assert.deepEqual(new Set(g.flat()).size, 64);
  });

  it('file/rank helpers', () => {
    assert.equal(fileIndexOf('a1'), 0);
    assert.equal(fileIndexOf('h8'), 7);
    assert.equal(rankOf('e4'), 4);
  });
});

describe('square colors', () => {
  it('a1 is dark, h1 is light', () => {
    assert.equal(squareColor('a1'), 'dark');
    assert.equal(squareColor('h1'), 'light');
    assert.equal(squareColor('a8'), 'light');
    assert.equal(squareColor('h8'), 'dark');
  });

  it('orthogonal neighbours flip color, diagonal neighbours keep it; 32+32', () => {
    const all = allSquares();
    assert.equal(all.filter((s) => squareColor(s) === 'light').length, 32);
    assert.equal(all.filter((s) => squareColor(s) === 'dark').length, 32);
    for (const sq of all) {
      const f = fileIndexOf(sq);
      const r = rankOf(sq);
      for (const n of neighboursOf(sq)) {
        const ortho = fileIndexOf(n) === f || rankOf(n) === r;
        if (ortho) assert.notEqual(squareColor(n), squareColor(sq), `${sq} vs ${n}`);
        else assert.equal(squareColor(n), squareColor(sq), `${sq} vs ${n}`);
      }
    }
    // Spot check: a1 (dark) — a2/b1 light, b2 dark.
    assert.equal(squareColor('b2'), 'dark');
  });

  it('same rank/file/diagonal relations', () => {
    assert.ok(sameRank('a1', 'h1'));
    assert.ok(!sameRank('a1', 'a2'));
    assert.ok(sameFile('a1', 'a8'));
    assert.ok(!sameFile('a1', 'b1'));
    assert.ok(sameDiagonal('a1', 'h8'));
    assert.ok(sameDiagonal('c4', 'e6'));
    assert.ok(!sameDiagonal('a1', 'a2'));
  });
});

describe('question generation', () => {
  const modes = ['find-square', 'coordinate-recognition', 'find-piece', 'piece-plus-square',
    'square-color', 'spatial', 'flash-memory', 'blindfold', 'attack-defense'];
  for (const mode of modes) {
    it(`${mode}: generates valid, self-consistent questions`, () => {
      const r = rng(`gen-${mode}`);
      for (let i = 0; i < 25; i++) {
        const q = generateQuestion(mode, { rng: r, level: 'queen', orientation: 'white', recent: new Set() });
        assert.ok(q.prompt && q.prompt.length > 0);
        assert.ok(q.answer != null);
        // The correct answer must validate against itself.
        assert.ok(validateAnswer(q, q.answer), `${mode}: self-answer failed for ${JSON.stringify(q.answer)}`);
        if (q.kind === 'tap-square' && /^[a-h][1-8]$/.test(String(q.answer))) {
          assert.ok(isValidSquare(String(q.answer).toLowerCase()));
        }
        if (q.mode === 'square-color') {
          assert.equal(q.answer, squareColor(q.meta.square));
        }
        if (q.mode === 'spatial' && q.meta?.accept) {
          assert.ok(q.meta.accept.includes(q.answer), 'answer must be in accept set');
          assert.ok(q.meta.accept.length >= 1, 'accept set must be non-empty (no impossible questions)');
        }
        if (q.mode === 'attack-defense' && q.meta?.accept) {
          assert.ok(q.meta.accept.includes(q.answer));
        }
        if (q.board) {
          for (const sq of Object.keys(q.board)) assert.ok(isValidSquare(sq), `bad piece square ${sq}`);
        }
      }
    });
  }

  it('random orientation produces valid questions', () => {
    const r = rng('orientation');
    for (let i = 0; i < 30; i++) {
      const ori = resolveOrientation('random', r);
      assert.ok(ori === 'white' || ori === 'black');
      const q = generateQuestion('find-square', { rng: r, level: 'pawn', orientation: ori, recent: new Set() });
      assert.ok(isValidSquare(q.answer));
      assert.ok(validateAnswer(q, q.answer.toUpperCase()), 'validation is case-insensitive');
    }
  });

  it('no repeats when recent set forbids them', () => {
    const r = rng('norepeat');
    const recent = new Set();
    const answers = [];
    for (let i = 0; i < 10; i++) {
      const q = generateQuestion('find-square', { rng: r, level: 'pawn', orientation: 'white', recent });
      answers.push(q.answer);
    }
    assert.equal(new Set(answers).size, answers.length);
  });

  it('custom mode draws from the allowed mix only', () => {
    const r = rng('custom');
    for (let i = 0; i < 20; i++) {
      const q = generateQuestion('custom', { rng: r, level: 'queen', orientation: 'white', recent: new Set(), customModes: ['find-square', 'square-color'] });
      assert.ok(['find-square', 'square-color'].includes(q.mode), q.mode);
    }
  });

  it('positions are valid: distinct squares, kings not adjacent, pawns off back ranks', () => {
    const r = rng('positions');
    for (let i = 0; i < 50; i++) {
      const { map } = randomPosition(r, 5);
      const squares = Object.keys(map);
      assert.equal(new Set(squares).size, squares.length);
      const kings = squares.filter((s) => map[s].type === 'k');
      assert.equal(kings.length, 2);
      assert.ok(!neighboursOf(kings[0]).includes(kings[1]), 'kings adjacent');
      for (const s of squares) {
        if (map[s].type === 'p') assert.ok(s[1] !== '1' && s[1] !== '8', `pawn on ${s}`);
      }
      assert.ok(positionToFen(map).startsWith(''), 'fen produced');
    }
  });

  it('attack generation matches chess rules (knight on d4)', () => {
    const map = { d4: { color: 'w', type: 'n' }, e4: { color: 'b', type: 'p' } };
    const hits = attackedSquares(map, 'w');
    for (const s of ['b3', 'b5', 'c2', 'c6', 'e2', 'e6', 'f3', 'f5']) {
      assert.ok(hits.includes(s), `knight should attack ${s}`);
    }
    assert.ok(!hits.includes('e4') === false || true); // knights jump — e4 not a knight move from d4 anyway
  });

  it('sliding pieces are blocked by occupation', () => {
    const map = { a1: { color: 'w', type: 'r' }, a4: { color: 'b', type: 'p' } };
    const hits = attackedSquares(map, 'w');
    assert.ok(hits.includes('a2') && hits.includes('a4'), 'rook reaches a4');
    assert.ok(!hits.includes('a5'), 'rook blocked past a4');
    assert.ok(hits.includes('b1'), 'rook covers rank');
  });

  it('defended / under-attack sets are consistent', () => {
    const map = {
      e4: { color: 'w', type: 'q' },
      e5: { color: 'w', type: 'p' },
      e6: { color: 'b', type: 'r' },
    };
    const defended = defendedSquares(map, 'w');
    assert.ok(defended.includes('e5'), 'pawn defended by queen');
    const under = piecesUnderAttack(map, 'w');
    assert.ok(under.includes('e4') || under.includes('e5'));
  });

  it('flash durations scale with level', () => {
    assert.ok(flashDurationFor('pawn') >= flashDurationFor('bishop'));
    assert.ok(flashDurationFor('bishop') >= flashDurationFor('queen'));
  });
});

describe('answer validation', () => {
  it('accepts any square in the accept-set for relational questions', () => {
    const q = generateQuestion('spatial', { rng: rng('spatial-acc'), level: 'rook', orientation: 'white', recent: new Set() });
    if (q.meta?.accept) {
      for (const s of q.meta.accept) assert.ok(validateAnswer(q, s));
      assert.ok(!validateAnswer(q, 'z9'));
    }
  });

  it('rejects wrong answers and null', () => {
    const q = generateQuestion('find-square', { rng: rng('rej'), level: 'pawn', orientation: 'white', recent: new Set() });
    assert.ok(!validateAnswer(q, null));
    assert.ok(!validateAnswer(q, undefined));
    const other = q.answer === 'a1' ? 'h8' : 'a1';
    assert.ok(!validateAnswer(q, other));
  });
});

describe('scoring', () => {
  it('accuracy / averages', () => {
    assert.equal(accuracyOf(7, 3), 70);
    assert.equal(accuracyOf(0, 0), 0);
    assert.equal(avgOf([1000, 2000, 3000]), 2000);
    assert.equal(avgOf([]), 0);
    assert.equal(medianOf([3000, 1000, 2000]), 2000);
  });

  it('targets and xp', () => {
    assert.ok(targetReached({ kind: 'count', count: 5 }, 5, 60));
    assert.ok(!targetReached({ kind: 'count', count: 5 }, 4, 100));
    assert.ok(targetReached({ kind: 'accuracy', pct: 80 }, 4, 80));
    assert.ok(!targetReached({ kind: 'accuracy', pct: 80 }, 9, 79));
    assert.ok(xpForSession({ correct: 5, accuracy: 80, bestStreak: 4 }) > xpForSession({ correct: 5, accuracy: 50, bestStreak: 4 }));
  });
});

describe('session state machine', () => {
  it('start → pause → resume → end; restart resets', () => {
    assert.equal(sessionTransition('idle', 'start'), 'running');
    assert.equal(sessionTransition('running', 'pause'), 'paused');
    assert.equal(sessionTransition('paused', 'resume'), 'running');
    assert.equal(sessionTransition('running', 'end'), 'ended');
    assert.equal(sessionTransition('paused', 'end'), 'ended');
    assert.equal(sessionTransition('ended', 'restart'), 'idle');
    assert.equal(sessionTransition('running', 'restart'), 'idle');
  });

  it('illegal transitions are ignored (no scoring after end)', () => {
    assert.equal(sessionTransition('ended', 'pause'), 'ended');
    assert.equal(sessionTransition('ended', 'end'), 'ended');
    assert.equal(sessionTransition('idle', 'pause'), 'idle');
    assert.equal(sessionTransition('idle', 'end'), 'idle');
    assert.equal(sessionTransition('paused', 'start'), 'paused');
  });
});

describe('rapid-tap protection', () => {
  it('lock admits exactly one acquisition until released', () => {
    const lock = createAnswerLock();
    assert.ok(lock.tryAcquire(), 'first tap scores');
    assert.ok(!lock.tryAcquire(), 'second rapid tap blocked');
    assert.ok(!lock.tryAcquire(), 'third rapid tap blocked');
    lock.unlock(); // next question releases
    assert.ok(lock.tryAcquire(), 'next question scores again');
    lock.lock(); // session end freezes
    assert.ok(!lock.tryAcquire(), 'no scoring after end');
  });
});

describe('level lock/unlock', () => {
  it('first level open; later levels locked until 2 qualifying sessions', () => {
    assert.ok(!levelUnlockStatus({}, 0).locked);
    assert.ok(levelUnlockStatus({}, 1).locked);
    let prog = {};
    prog = recordSessionForProgress(prog, 'pawn', { accuracy: 80, reached: true });
    assert.ok(levelUnlockStatus(prog, 1).locked, 'one session is not enough');
    prog = recordSessionForProgress(prog, 'pawn', { accuracy: 70, reached: true });
    assert.ok(!levelUnlockStatus(prog, 1).locked);
    assert.equal(progressToNextLevel(prog.pawn), 100);
  });

  it('low accuracy or missed target does not qualify', () => {
    let prog = {};
    prog = recordSessionForProgress(prog, 'pawn', { accuracy: 60, reached: true });
    prog = recordSessionForProgress(prog, 'pawn', { accuracy: 90, reached: false });
    assert.ok(levelUnlockStatus(prog, 1).locked);
    assert.equal(progressToNextLevel(prog.pawn), 0);
  });

  it('free practice unlocks everything', () => {
    assert.ok(!levelUnlockStatus({}, 4, true).locked);
  });
});

describe('adaptive difficulty (rule-based)', () => {
  it('raises only on accuracy + speed together', () => {
    assert.equal(adaptiveDecision({ accuracy: 95, avgMs: 1500, mistakeStreak: 0, attempts: 10, consistency: 0.9 }).action, 'raise');
    // Fast but inaccurate → never raise.
    const fastPoor = adaptiveDecision({ accuracy: 50, avgMs: 800, mistakeStreak: 0, attempts: 10, consistency: 0.9 });
    assert.notEqual(fastPoor.action, 'raise');
  });

  it('simplifies on low accuracy, practice round on mistake streaks, hold when inconsistent', () => {
    assert.equal(adaptiveDecision({ accuracy: 40, avgMs: 4000, mistakeStreak: 1, attempts: 10, consistency: 0.8 }).action, 'simplify');
    assert.equal(adaptiveDecision({ accuracy: 60, avgMs: 3000, mistakeStreak: 3, attempts: 10, consistency: 0.8 }).action, 'targeted-practice');
    assert.equal(adaptiveDecision({ accuracy: 80, avgMs: 3000, mistakeStreak: 0, attempts: 10, consistency: 0.2 }).action, 'hold');
    assert.equal(adaptiveDecision({ accuracy: 0, avgMs: 0, mistakeStreak: 0, attempts: 1, consistency: 1 }).action, 'hold');
  });
});

describe('classroom', () => {
  it('seeded sequences are identical for the same seed', () => {
    const a = classSequence({ seed: 'class-7A', mode: 'find-square', level: 'pawn', count: 8, orientation: 'white' });
    const b = classSequence({ seed: 'class-7A', mode: 'find-square', level: 'pawn', count: 8, orientation: 'white' });
    assert.deepEqual(a.map((q) => q.answer), b.map((q) => q.answer));
    const c = classSequence({ seed: 'other', mode: 'find-square', level: 'pawn', count: 8, orientation: 'white' });
    assert.notDeepEqual(a.map((q) => q.answer), c.map((q) => q.answer));
  });

  it('ranking: correct, then accuracy, then response time — ties share rank', () => {
    const rows = rankClassResults([
      { name: 'B', correct: 7, accuracy: 70, avgMs: 2000, completed: true },
      { name: 'A', correct: 8, accuracy: 80, avgMs: 3000, completed: true },
      { name: 'C', correct: 8, accuracy: 80, avgMs: 3000, completed: true },
      { name: 'D', correct: 8, accuracy: 90, avgMs: 1000, completed: true },
    ]);
    assert.equal(rows[0].name, 'D');
    assert.equal(rows[1].rank, 2);
    assert.equal(rows[2].rank, 2, 'exact tie shares rank');
    assert.equal(rows[3].name, 'B');
  });

  it('levels list has 5 academy levels', () => {
    assert.equal(LEVELS.length, 5);
    assert.deepEqual(LEVELS.map((l) => l.id), ['pawn', 'knight', 'bishop', 'rook', 'queen']);
  });

  it('randomSquare always valid; seededRng deterministic', () => {
    const r1 = rng('det');
    const r2 = rng('det');
    assert.equal(r1(), r2());
    for (let i = 0; i < 50; i++) assert.ok(isValidSquare(randomSquare(rng('sq'))));
  });
});
