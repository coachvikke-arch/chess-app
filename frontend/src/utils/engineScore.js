/* Canonical engine score boundary. `evaluation` is authoritative; `score` is
 * an explicitly comparable, bounded compatibility value, never raw mate cp.
 * UCI mate distance is in moves (not plies). Mate zero means already mated. */
export const MATE_COMPARABLE = 10000;
const LEGACY_MATE = 100000;
const LEGACY_WINDOW = 10000;
const MATE_LOSS_CAP = 1000;

export function normalizeScore(input) {
  if (input == null) return null;
  if (typeof input === 'object') {
    if (input.evaluation) return normalizeScore(input.evaluation);
    if (input.type === 'mate') {
      return { type: 'mate', value: input.value, winner: input.winner ?? (input.value > 0 ? 1 : -1) };
    }
    if (input.type === 'cp') return { type: 'cp', value: input.value };
    if (input.mate != null) return normalizeScore({ type: 'mate', value: input.mate, winner: input.winner });
    return normalizeScore(input.score);
  }
  if (!Number.isFinite(input)) return null;
  // Legacy persisted results/test adapters are decoded HERE, never by consumers.
  if (Math.abs(input) >= LEGACY_MATE - LEGACY_WINDOW) {
    return { type: 'mate', value: Math.sign(input) * (LEGACY_MATE - Math.abs(input)), winner: Math.sign(input) };
  }
  return { type: 'cp', value: input };
}

export function comparableScore(input) {
  const score = normalizeScore(input);
  if (!score) return null;
  return score.type === 'mate' ? score.winner * MATE_COMPARABLE : score.value;
}

export function scoreFields(input) {
  const evaluation = normalizeScore(input);
  return { evaluation, score: comparableScore(evaluation), mate: evaluation?.type === 'mate' ? evaluation.value : null };
}

export function perspectiveScore(input, sign) {
  const score = normalizeScore(input);
  if (!score) return null;
  return score.type === 'mate'
    ? { ...score, value: sign * score.value, winner: sign * score.winner }
    : { ...score, value: sign * score.value };
}

export function centipawnLoss(best, played) {
  const a = normalizeScore(best);
  const b = normalizeScore(played);
  if (!a || !b) return null;
  if (a.type === 'cp' && b.type === 'cp') return Math.round(Math.max(0, a.value - b.value));
  // Same forced outcome — but a LONGER mate is still a loss: the mate distance
  // degraded (mate-in-1 → mate-in-N). Higher `value` is the worse score for a
  // fixed winner (distance grows for a win, shrinks toward zero for a loss), so
  // the degradation is played − best, capped like every other mate loss. An
  // identical distance still reads 0.
  if (a.type === 'mate' && b.type === 'mate' && a.winner === b.winner) {
    return Math.round(Math.min(MATE_LOSS_CAP, Math.max(0, b.value - a.value)));
  }
  const bounded = (s) => s.type === 'mate' ? s.winner * MATE_LOSS_CAP
    : Math.max(-MATE_LOSS_CAP, Math.min(MATE_LOSS_CAP, s.value));
  const loss = Math.max(0, bounded(a) - bounded(b));
  const missedMate = a.type === 'mate' && a.winner > 0 && b.type !== 'mate';
  const allowedMate = b.type === 'mate' && b.winner < 0 && a.type !== 'mate';
  return Math.round(Math.min(MATE_LOSS_CAP, Math.max(loss, missedMate || allowedMate ? 150 : 0)));
}
