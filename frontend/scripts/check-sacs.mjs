import { reviewGame } from '../src/utils/gameReview.js';
import { createReviewEnginePool } from './nodeEngine.mjs';

const pgn = `1. b3 c6 2. Bb2 d5 3. h3 Bf5 4. Nf3 e6 5. e3 Nf6 6. d4 Bd6 7. c4 O-O 8. c5 Bc7 9. Bd3 Be4 10. Nc3 b6 11. b4 bxc5 12. bxc5 Nbd7 13. O-O e5 14. Nxe4 dxe4 15. dxe5 exf3 16. exf6 Nxf6 17. g3 Qd7 18. Bxf6 gxf6 19. Be4 Qxh3 20. Qxf3 Be5 21. Rad1 Kh8 22. Qg2 Qe6 23. Bxc6 Rg8 24. f4 Bc7 25. Rde1 Rxg3 26. Qxg3 Rg8 27. Qxg8+ Kxg8 28. Bb7 Qg4+ 29. Kf2 Qf5 30. c6 Kf8 31. Rc1 Bb6 32. Ke1 Bc7 33. Rc4 Qb1+ 34. Kf2 Qxa2+ 35. Kg1 Qxc4 36. Rd1 Qe2 37. Rd7 Qxe3+ 38. Kf1 Qxf4+ 39. Ke2 Qe4+ 40. Kd1 Qf3+ 41. Kc2 Qf5+ 42. Kb3 Qb1+ 43. Kc4 Qc2+ 44. Kd5 Qd3+ 45. Kc5 Bb6+ 46. Kb4 Qe4+ 47. Kb3 Qb1+ 48. Kc4 Qc2+ 49. Kb4 Bc5+ 50. Kb5 a6+ 51. Bxa6 Ke8 52. Rd5 Be7 53. Rd7 Qb3+ 54. Ka5 Qb4#`;

const pool = await createReviewEnginePool();
const sans = pgn.split(/\s+/).filter(s => !s.match(/^[\[\d.]/) && s !== '-' && s !== '');

const res = await reviewGame('start', sans, { engine: pool });

if (!res) { console.log('reviewGame returned null'); process.exit(1); }

const targets = ['Bxf6', 'Bxc6', 'Qxg8+', 'Bxa6'];
for (const m of res.moves) {
  const flag = targets.includes(m.san) ? ' <<<' : '';
  console.log(`${String(Math.floor(m.ply / 2) + 1).padStart(2)}.${m.ply % 2 === 0 ? ' ' : '…'} ${m.san.padEnd(6)} ${m.verdict.padEnd(12)} cpl=${String(m.cpl).padStart(4)} best=${m.best} played=${m.played} wpd=${m.wpd?.toFixed?.(1) ?? 'null'}${flag}`);
}

pool.destroy?.();
process.exit(0);
