/* Reusable impact shake + haptic for brilliant / promotion / checkmate. */
export const SHAKE_STRENGTH = 1;

export const IMPACT_PRESETS = {
  brilliant: { amplitude: 12, rotation: 2, duration: 600, haptic: [80, 40, 120] },
  promotion: { amplitude: 12, rotation: 2, duration: 600, haptic: [80, 40, 120] },
  checkmate: { amplitude: 22, rotation: 3.5, duration: 900, haptic: [200, 60, 200, 60, 350] },
};

export function triggerImpact(type) {
  const preset = IMPACT_PRESETS[type] || IMPACT_PRESETS.brilliant;
  const amp = preset.amplitude * SHAKE_STRENGTH;
  const rot = preset.rotation * SHAKE_STRENGTH;
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!reduced) navigator.vibrate(preset.haptic.map((n) => Math.round(n * SHAKE_STRENGTH)));
    }
  } catch (_) {}
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const targets = [];
  document.querySelectorAll('.chess-board, .cb-board').forEach((el) => targets.push(el));
  for (const el of targets) {
    if (!el) continue;
    el.style.setProperty('--shake-amp', amp + 'px');
    el.style.setProperty('--shake-rot', rot + 'deg');
    el.style.setProperty('--shake-duration', preset.duration + 'ms');
    el.classList.remove('impact-shake');
    void el.offsetWidth;
    el.classList.add('impact-shake');
    window.setTimeout(() => el.classList.remove('impact-shake'), preset.duration + 50);
  }
}
