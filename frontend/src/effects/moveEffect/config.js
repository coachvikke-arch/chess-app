/* ── MoveEffect configuration ───────────────────────────────────────────────
 *
 * Every tunable number for the "sigma move" effect lives here. The component
 * (MoveEffect.jsx), the maths (timeline.js), the audio (sound.js) and the
 * haptics (haptics.js) all read these values, so retiming the effect never
 * means hunting through the renderer.
 *
 * TIME IS IN MILLISECONDS, measured from t = 0 (the moment the board starts
 * dimming). L is the landing moment; every late cue is expressed relative to
 * it, exactly as in the reference prototype.
 */

/* Checkmate feedback popup appears when the effect reaches its badge phase.
 * Kept here (not inline) so it is a single tunable number. */
export const CHECKMATE_POPUP_AT_MS = 600;

export const EFFECT_SHAKE_SCALE = 2;
export const EFFECT_HAPTIC_SCALE = 2;
export const EFFECT_VOLUME_SCALE = 1;

/* ── master timeline ─────────────────────────────────────────────────────── */
export const T = {
  /* 0-50: dim the board. The piece's path squares stay undimmed. */
  dimStart: 0,
  dimEnd: 50,

  /* 30-180: the piece flies from its square to the hover spot (scale 1 → 1.25). */
  flyStart: 30,
  flyEnd: 180,

  /* 180-400: hover, lifted at 1.25x on the dimmed board. */
  hoverEnd: 400,

  /* 400-470: drop onto the target (cubic ease-in), scale 1.25 → 1. */
  dropEnd: 470,

  /* the captured piece vanishes just before the landing. */
  captureGone: 440,

  /* L — landing. Ripple starts, seal badge pops, highlight appears. */
  landing: 470,

  /* seal pop */
  badgePopMs: 250,

  /* 600-850: pill grows right out of the badge. */
  pillGrowStart: 600,
  pillGrowEnd: 850,

  /* 2600-2850: the label fades, then 2850-3050 the pill collapses. */
  labelFadeStart: 2600,
  labelFadeEnd: 2850,
  pillCollapseStart: 2850,
  pillCollapseEnd: 3050,

  /* sacrifice sword badge (brilliant + sacrifice only) */
  swordStart: 3130,
  swordMs: 300,
  swordArrowStart: 3250,
  swordArrowEnd: 3500,

  /* the whole choreography ends here. */
  end: 3600,

  /* How long the finished badge/highlights/checkmate popup may stay on the
     board before EffectController.cleanup() removes them. A move clears them
     earlier; this is the no-move fallback, so no effect colour can outlive
     the move it belongs to. */
  hold: 1000,

  /* Once the ripple front has swept past r = 9 squares the board is fully
     undimmed, so the ghost piece layer (and the hidden real pieces) can be
     released. This is landing + ~1s, before the pill has finished growing. */
  settle: 1470,
};

/* ── ripple (radius measured in squares) ─────────────────────────────────── */
export const RIPPLE = {
  /* r(x) = max * (1 - exp(-k * x)), x in seconds since landing */
  maxSq: 10.5,
  k: 2.6,

  /* the ripple visual fades out between these radii */
  fadeFromSq: 6,
  fadeToSq: 9,

  /* radial gradient band, in squares relative to the front */
  lensStartSq: -0.35,
  lensPeakSq: -0.06,
  lensEndSq: 0.2,
  lensAlpha: 0.55,
  lensEdgeAlpha: 0.22,

  /* how long a square flashes when the front crosses it */
  flashMs: 300,
};

/* ── wobble (piece reacts as the front passes its square) ────────────────── */
export const WOBBLE = {
  deg: 33, // 11 * EFFECT_SHAKE_SCALE (now 2x)
  decay: 7,
  freq: 26,
  scale: 0.16,
  pivot: '50% 85%',
  /* checkmate: the mated king reacts harder */
  kingMultiplier: 1.85,
};

/* ── geometry (all relative to one square = sq) ──────────────────────────── */
export const G = {
  dimColor: 'rgba(10,12,20,0.42)',

  hoverSideSq: 0.95,
  hoverLiftSq: 1.15,
  flyScale: 1.25,

  /* seal badge at the target square's top-right corner */
  badgeSq: 0.52,
  badgeBorderSq: 0.035,

  /* pill */
  pillWidthSq: 1.55,
  pillHeightSq: 0.34,
  pillFontSq: 0.17,
  pillRadiusSq: 0.17,

  /* sacrifice sword badge + arrow */
  swordSq: 0.5,
  swordBorderPx: 2,
  arrowSq: 0.78,
  arrowRotation: -45,
};

/* ── sound (offsets from L unless stated) ────────────────────────────────── */
export const SOUND = {
  /* Authored gains are deliberately lifted for the sigma cue: it is a 3-second
     effect built from a low thud, and a low thud is the first thing a phone
     speaker throws away. The lift was raised from 50% to 100% (the request was
     for louder move effects); the shared master bus (a 1.5x gain into a
     limiter at -1 dB, ratio 20) still sits after it, so the extra gain cannot
     clip. */
  gainScale: 2, // original (volume scaling removed)
  /* L+60: sine sweep 150 → 52 Hz, fast decay, ~240 ms */
  thud: { at: 60, fromHz: 150, toHz: 52, durationMs: 240, gain: 0.5 },
  /* L+140: the swell. Frequencies are relative to the swell start; gains are
     relative to L, exactly as written in the reference spec. */
  swell: {
    at: 140,
    durationMs: 640,
    freqKeys: [[0, 41], [250, 88], [500, 56], [640, 36]],
    gainKeys: [[140, 0], [390, 0.8], [500, 0.5], [580, 0.75], [780, 0]],
    harmonics: [1, 0.4, 0.2],
    gain: 0.34,
  },
};

/* ── haptics (offsets from L) ────────────────────────────────────────────── */
export const HAPTIC = {
  tick: { at: 50, ms: 40 },
  /* Full-strength tick folded into the swell slot at L+380. */
  accent: { at: 380, ms: 40 },
  /* 14 slots of 40 ms; `off` is the remainder of each slot (40 - on). */
  swell: {
    at: 140,
    slotMs: 40,
    onMs: [12, 18, 24, 30, 38, 38, 38, 38, 38, 38, 38, 33, 21, 12],
  },
};

/* ── per-event look ────────────────────────────────────────────────────────
 * accent / accentDeep drive the pill + seal gradient. `rippleOrigin` says
 * which square the ripple expands from. `highlights` are the two squares that
 * stay tinted after the animation. Keep this table small and obvious: a new
 * event type is one more entry plus a badge glyph.
 */
export const MOVE_EFFECTS = {
  brilliant: {
    type: 'brilliant',
    accent: '#2cc3a5',
    accentDeep: '#13806e',
    seal: '#3fb8a3',
    badge: '!!',
    label: 'BRILLIANT',
    rippleOrigin: 'to',
    highlightTo: '#3fb8a3',
    highlightFrom: '#7ddcca',
    /* orange sword badge — only when the move really is a sacrifice */
    sacrificeBadge: true,
    strongKingWobble: false,
    morph: false,
  },
  checkmate: {
    type: 'checkmate',
    accent: '#e5484d',
    accentDeep: '#8f1d22',
    seal: '#e5484d',
    badge: '#',
    label: 'CHECKMATE',
    rippleOrigin: 'king',
    highlightTo: '#e5484d',
    highlightFrom: '#7ddcca',
    sacrificeBadge: false,
    strongKingWobble: true,
    morph: false,
  },
  promotion: {
    type: 'promotion',
    accent: '#2cc3a5',
    accentDeep: '#13806e',
    seal: '#3fb8a3',
    badge: '=Q',
    label: 'PROMOTION',
    rippleOrigin: 'to',
    highlightTo: '#3fb8a3',
    highlightFrom: '#7ddcca',
    sacrificeBadge: false,
    strongKingWobble: false,
    /* pawn swaps to the promoted piece at landing (pop 1.3 → 1) */
    morph: true,
  },
};

/** Resolve an event type to its look, tolerating unknown/legacy verdicts. */
export function effectConfig(type) {
  return MOVE_EFFECTS[type] || MOVE_EFFECTS.brilliant;
}
