/* Pure maths helpers for the Player Report. No DB, no app state. */

function clamp(value, min = 0, max = 100) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function round(value, digits = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function mean(values) {
  const nums = (values || []).map(Number).filter(Number.isFinite);
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/* Population standard deviation; 0 when there is nothing to compare. */
function stdDev(values) {
  const nums = (values || []).map(Number).filter(Number.isFinite);
  if (nums.length < 2) return 0;
  const m = mean(nums);
  const variance = nums.reduce((sum, n) => sum + (n - m) ** 2, 0) / nums.length;
  return Math.sqrt(variance);
}

function eloExpected(playerRating, opponentRating) {
  return 1 / (1 + 10 ** ((Number(opponentRating) - Number(playerRating)) / 400));
}

/* Box–Muller, with a guard against log(0). */
function normalSample(avg, spread) {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return avg + z * spread;
}

/**
 * Monte-Carlo tournament chances. All results are percentages.
 * This is an estimate, not a guarantee, and is labelled as such in the UI.
 */
function simulateTournaments({
  rating = 1400,
  fieldRating = 1400,
  tournamentCount = 5000,
  rounds = 9,
  fieldSize = 20,
  topTenPlaces = 10,
} = {}) {
  const count = Math.max(1, Number(tournamentCount) || 5000);
  const totalRounds = Math.max(1, Number(rounds) || 9);
  const players = Math.max(2, Number(fieldSize) || 20);
  const topLimit = Math.min(players, Math.max(1, Number(topTenPlaces) || 10));
  let positive = 0;
  let topTen = 0;
  let win = 0;
  let gain = 0;
  let scoreSum = 0;

  const fieldSpread = 180;

  for (let t = 0; t < count; t += 1) {
    const field = Array.from({ length: players - 1 }, () => normalSample(fieldRating, fieldSpread));
    const opponents = [];
    for (let r = 0; r < totalRounds; r += 1) {
      opponents.push(field[r % field.length]);
    }

    let myScore = 0;
    for (const opponent of opponents) {
      if (Math.random() < eloExpected(rating, opponent)) myScore += 1;
      else myScore += 0.5;
    }
    scoreSum += myScore;

    let place = 1;
    for (const otherRating of field) {
      let otherScore = 0;
      for (const opponent of opponents) {
        if (Math.random() < eloExpected(otherRating, opponent)) otherScore += 1;
        else otherScore += 0.5;
      }
      if (otherScore > myScore + 1e-9) place += 1;
      else if (Math.abs(otherScore - myScore) < 1e-9 && Math.random() < 0.5) place += 1;
    }

    const expectedScore = totalRounds * eloExpected(rating, fieldRating);
    if (myScore > totalRounds / 2) positive += 1;
    if (place <= topLimit) topTen += 1;
    if (place === 1) win += 1;
    if (myScore > expectedScore) gain += 1;
  }

  return {
    positiveScore: round((positive / count) * 100, 1),
    topTen: round((topTen / count) * 100, 1),
    winTournament: round((win / count) * 100, 1),
    ratingGain: round((gain / count) * 100, 1),
    averageScore: round(scoreSum / count, 2),
  };
}

module.exports = {
  clamp,
  round,
  mean,
  stdDev,
  eloExpected,
  normalSample,
  simulateTournaments,
};
