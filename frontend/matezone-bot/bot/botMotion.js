import { MOOD_MS } from "./botConfig";

/* ─── motion vocabulary ────────────────────────────────────────────────────
   Custom curves only. Rises ease out, falls ease in, settles overshoot. */

const EASE = {
  spring: "cubic-bezier(.3,.9,.4,1.15)",
  out: "cubic-bezier(.22,1,.36,1)",
  in: "cubic-bezier(.55,0,.85,.4)",
  soft: "cubic-bezier(.37,0,.63,1)",
  glide: "cubic-bezier(.45,.05,.25,1)",
};

/* Animations of the running performance, so a new mood or an unmount can
   cancel them and hand every wrapper back to its CSS rest pose. */
let active = null;

/* An effect-level easing warps the whole keyframe timeline, so a spring there
   rushes every hold in a sequence. Long sequences keep their offsets exact
   and carry the curve segment by segment instead. */
const segments = (frames, easing) =>
  frames.length > 2
    ? frames.map((f, i) => (i === frames.length - 1 || f.easing ? f : { ...f, easing }))
    : frames;

function play(el, frames, opts = {}) {
  if (!el || typeof el.animate !== "function") return null;
  const { easing = EASE.spring, ...timing } = opts;
  const long = frames.length > 2;
  try {
    const anim = el.animate(segments(frames, easing), {
      duration: 600,
      fill: "both",
      easing: long ? "linear" : easing,
      ...timing,
    });
    if (active) active.push(anim);
    return anim;
  } catch {
    return null;
  }
}

/* One-shot effects (landing) that no mood owns. */
function once(el, frames, opts = {}) {
  if (!el || typeof el.animate !== "function") return;
  const { easing = EASE.spring, ...timing } = opts;
  const long = frames.length > 2;
  try {
    el.animate(segments(frames, easing), {
      duration: 600,
      easing: long ? "linear" : easing,
      ...timing,
    });
  } catch {
    /* older engines simply skip the flourish */
  }
}

const stops = (values, easing = EASE.spring) =>
  values.map((v, i) => ({
    transform: `rotate(${v}deg)`,
    offset: i / (values.length - 1),
    easing: i < values.length - 1 ? easing : undefined,
  }));

/* ─── faces ─────────────────────────────────────────────────────────────── */

const FACES = {
  idle: { eyes: "open", mouth: "smile", brows: "rest" },
  wave: { eyes: "open", mouth: "smile", brows: "rest" },
  happy: { eyes: "happy", mouth: "happy", brows: "up" },
  jump: { eyes: "open", mouth: "o", brows: "up" },
  sad: { eyes: "calm", mouth: "frown", brows: "sad" },
  cry: { eyes: "calm", mouth: "frown", brows: "sad", tears: true },
  fly: { eyes: "open", mouth: "o", brows: "up" },
  blessing: { eyes: "calm", mouth: "calm", brows: "rest" },
  alert: { eyes: "open", mouth: "o", brows: "up" },
  neutral: { eyes: "open", mouth: "flat", brows: "one" },
};

export const faceFor = (mood) => FACES[mood] || FACES.idle;

/* ─── effect shapes ───────────────────────────────────────────────────────
   The FX layer ships every shape hidden. The engine only animates opacity and
   transform on the shape itself, never on its positioning wrapper. */

function fxShapes(stage, id, on = true) {
  const layer = stage?.fx?.querySelector(`#${id}`);
  if (!layer) return [];
  layer.style.opacity = on ? "1" : "0";
  return Array.from(layer.querySelectorAll("g > *"));
}

function sparkles(stage, { delay = 0, count = 6, dur = 900 } = {}) {
  fxShapes(stage, "fx-sparkles").slice(0, count).forEach((el, i) => {
    play(el, [
      { opacity: 0, transform: "scale(.2) rotate(0deg)", offset: 0 },
      { opacity: 1, transform: "scale(1.1) rotate(70deg)", offset: 0.4 },
      { opacity: 0, transform: "scale(.3) rotate(150deg)", offset: 1 },
    ], { duration: dur, delay: delay + i * 120, iterations: 2, easing: EASE.out });
  });
}

function risingSparkles(stage, { delay = 0, count = 8, dur = 1400 } = {}) {
  fxShapes(stage, "fx-sparkles").slice(0, count).forEach((el, i) => {
    play(el, [
      { opacity: 0, transform: "translateY(14px) scale(.35)", offset: 0 },
      { opacity: 1, transform: "translateY(0px) scale(1.05)", offset: 0.35 },
      { opacity: 0, transform: "translateY(-54px) scale(.45)", offset: 1 },
    ], { duration: dur, delay: delay + i * 150, iterations: 2, easing: EASE.out });
  });
}

function confetti(stage, delay = 0) {
  fxShapes(stage, "fx-confetti").forEach((el, i) => {
    const dx = (i % 7) * 26 - 78;
    const dy = 180 + (i % 5) * 24;
    play(el, [
      { opacity: 0, transform: "translate(0, 0) rotate(0deg)", offset: 0 },
      { opacity: 1, transform: "translate(0, 24px) rotate(60deg)", offset: 0.08 },
      { opacity: 0, transform: `translate(${dx}px, ${dy}px) rotate(${220 + i * 24}deg)`, offset: 1 },
    ], { duration: 1250, delay: delay + i * 55, easing: EASE.out });
  });
}

function dustBurst(stage, delay = 0) {
  fxShapes(stage, "fx-dust").forEach((el, i) => {
    play(el, [
      { opacity: 0, transform: "scale(.3)", offset: 0 },
      { opacity: 0.55, transform: "scale(1)", offset: 0.25 },
      { opacity: 0, transform: `scale(${1.8 + (i % 2) * 0.6}) translateY(-6px)`, offset: 1 },
    ], { duration: 620, delay: delay + i * 60, easing: EASE.out });
  });
}

/* ─── parts ───────────────────────────────────────────────────────────────
   Pairs follow the artwork table: [sleeve, wrist]. The wrist value bends the
   hand past the sleeve it hangs inside. The wrist trails the sleeve by 100ms
   and the head trails by 50ms, which gives the follow-through of a real limb
   instead of rigid sticks. */

const arm = (stage, side, sleeve, sleeveDur, wrist, wristDur = sleeveDur) => {
  play(stage[`arm${side}`], stops(sleeve), { duration: sleeveDur });
  play(stage[`wrist${side}`], stops(wrist), { duration: wristDur, delay: 100 });
};

const headNod = (amount = -4, lift = -2) => [
  { transform: "translateY(0px) rotate(0deg)", offset: 0 },
  { transform: `translateY(${lift}px) rotate(${amount}deg)`, offset: 0.22 },
  { transform: `translateY(0px) rotate(${-amount / 2}deg)`, offset: 0.6 },
  { transform: "translateY(0px) rotate(0deg)", offset: 1 },
];

const headSad = () => [
  { transform: "translateY(0px) rotate(0deg)", offset: 0 },
  { transform: "translateY(9px) rotate(5deg)", offset: 0.35 },
  { transform: "translateY(8px) rotate(4deg)", offset: 0.78 },
  { transform: "translateY(0px) rotate(0deg)", offset: 1 },
];

/* ─── emotions ────────────────────────────────────────────────────────────
   Every performance returns to the rest pose at its last frame, so the switch
   back to the idle loops is a freeze, not a snap. Durations come from MOOD_MS
   so the queue and the motion always agree. */

const MOOD_ANIMS = {
  idle() {},

  wave(stage) {
    const d = MOOD_MS.wave;
    arm(stage, "L", [0, 16, 11, 16, 11, 16, 11, 16, 0], d,
      [0, 34, -30, 34, -30, 34, -30, 34, 0], d);
    play(stage.head, [
      { transform: "rotate(0deg)", offset: 0 },
      { transform: "rotate(-6deg)", offset: 0.24 },
      { transform: "rotate(-2deg)", offset: 0.55 },
      { transform: "rotate(-4deg)", offset: 0.8 },
      { transform: "rotate(0deg)", offset: 1 },
    ], { duration: d, easing: EASE.glide, delay: 50 });
  },

  happy(stage) {
    const d = MOOD_MS.happy;
    /* The left sleeve stops short of the visor so the raised hand frames the
       face instead of covering an eye. */
    arm(stage, "L", [0, 30, 26, 30, 26, 30, 26, 0], d, [0, 2, 0, 2, 0, 2, 0], d);
    arm(stage, "R", [0, -112, -106, -110, -106, -110, -106, 0], d, [0, -18, -14, -18, -14, -18, 0], d);
    play(stage.head, headNod(-4, -2), { duration: d, delay: 50 });
    play(stage.pose, [
      { transform: "translateY(0px) scale(1,1)", offset: 0 },
      { transform: "translateY(-3px) scale(1.01,.99)", offset: 0.3 },
      { transform: "translateY(0px) scale(1,1)", offset: 0.62 },
      { transform: "translateY(-2px) scale(1.005,.995)", offset: 0.8 },
      { transform: "translateY(0px) scale(1,1)", offset: 1 },
    ], { duration: d, easing: EASE.spring });
    sparkles(stage, { count: 6, delay: 250, dur: 850 });
  },

  jump(stage) {
    const d = MOOD_MS.jump;
    play(stage.pose, [
      { transform: "translateY(0px) scale(1,1)", offset: 0, easing: EASE.in },
      { transform: "translateY(2px) scale(1.1,.9)", offset: 0.06, easing: EASE.out },
      { transform: "translateY(0px) scale(.95,1.05)", offset: 0.1, easing: EASE.out },
      { transform: "translateY(-54px) scale(.98,1.03)", offset: 0.22, easing: EASE.in },
      { transform: "translateY(0px) scale(1.1,.9)", offset: 0.3, easing: EASE.out },
      { transform: "translateY(0px) scale(.95,1.05)", offset: 0.36, easing: EASE.out },
      { transform: "translateY(-46px) scale(.98,1.03)", offset: 0.47, easing: EASE.in },
      { transform: "translateY(0px) scale(1.09,.91)", offset: 0.55, easing: EASE.out },
      { transform: "translateY(0px) scale(.95,1.05)", offset: 0.61, easing: EASE.out },
      { transform: "translateY(-38px) scale(.99,1.02)", offset: 0.72, easing: EASE.in },
      { transform: "translateY(0px) scale(1.08,.92)", offset: 0.81, easing: EASE.spring },
      { transform: "translateY(0px) scale(1,1)", offset: 1 },
    ], { duration: d });
    arm(stage, "L", [0, 30, 26, 30, 26, 30, 26, 0], d, [0, 6, 2, 6, 2, 6, 0], d);
    arm(stage, "R", [0, -118, -110, -118, -110, -118, -110, 0], d, [0, -22, -16, -22, -16, -22, 0], d);
    play(stage.head, [
      { transform: "translateY(0px) rotate(0deg)", offset: 0 },
      { transform: "translateY(4px) rotate(0deg)", offset: 0.06 },
      { transform: "translateY(-4px) rotate(-2deg)", offset: 0.2 },
      { transform: "translateY(2px) rotate(1deg)", offset: 0.3 },
      { transform: "translateY(-3px) rotate(2deg)", offset: 0.47 },
      { transform: "translateY(2px) rotate(-1deg)", offset: 0.55 },
      { transform: "translateY(-2px) rotate(-2deg)", offset: 0.72 },
      { transform: "translateY(0px) rotate(0deg)", offset: 0.86 },
    ], { duration: d, delay: 50 });
    dustBurst(stage, d * 0.3);
    dustBurst(stage, d * 0.55);
    dustBurst(stage, d * 0.81);
    confetti(stage, d * 0.42);
  },

  sad(stage) {
    const d = MOOD_MS.sad;
    play(stage.pose, [
      { transform: "translateY(0px) scale(1,1)", offset: 0, easing: EASE.soft },
      { transform: "translateY(6px) scale(1,.985)", offset: 0.4 },
      { transform: "translateY(6px) scale(1,.98)", offset: 0.75 },
      { transform: "translateY(0px) scale(1,1)", offset: 1 },
    ], { duration: d });
    arm(stage, "L", [0, -74, -72, -74, -72, 0], d, [0, 12, 10, 12, 10, 0], d);
    arm(stage, "R", [0, 14, 12, 14, 12, 0], d, [0, -4, -2, -4, -2, 0], d);
    play(stage.head, headSad(), { duration: d, delay: 50, easing: EASE.soft });
  },

  cry(stage) {
    const d = MOOD_MS.cry;
    play(stage.pose, [
      { transform: "translate(0px, 0px) scale(1,1)", offset: 0, easing: EASE.soft },
      { transform: "translate(0px, 8px) scale(1,.982)", offset: 0.18 },
      { transform: "translate(-1.5px, 8px) scale(1,.98)", offset: 0.32 },
      { transform: "translate(1.5px, 8px) scale(1,.98)", offset: 0.4 },
      { transform: "translate(-1.5px, 8px) scale(1,.98)", offset: 0.48 },
      { transform: "translate(1.5px, 8px) scale(1,.98)", offset: 0.56 },
      { transform: "translate(-1.2px, 8px) scale(1,.98)", offset: 0.64 },
      { transform: "translate(0px, 8px) scale(1,.98)", offset: 0.74 },
      { transform: "translate(0px, 0px) scale(1,1)", offset: 1 },
    ], { duration: d });
    /* The left sleeve comes up once to wipe the eyes, then drops back to the
       sad pose. */
    arm(stage, "L", [0, -70, 70, 70, -72, -72, 0], d, [0, 12, -20, -20, 12, 12, 0], d);
    arm(stage, "R", [0, 14, 12, 14, 12, 0], d, [0, -4, -2, -4, -2, 0], d);
    play(stage.head, headSad(), { duration: d, delay: 50, easing: EASE.soft });
    play(stage.puddle, [
      { opacity: 0, transform: "translateX(-50%) scale(.4,.3)", offset: 0 },
      { opacity: 0.85, transform: "translateX(-50%) scale(1,1)", offset: 0.55 },
      { opacity: 0.95, transform: "translateX(-50%) scale(1.05,1.15)", offset: 1 },
    ], { duration: d, easing: EASE.soft });
  },

  /* Flight is held by CSS while data-mood="fly" so it survives a long drag;
     the engine leaves the wrappers to it. */
  fly() {},

  blessing(stage) {
    const d = MOOD_MS.blessing;
    arm(stage, "L", [0, 36, 34, 36, 32, 0], d, [0, 14, 12, 14, 12, 0], d);
    arm(stage, "R", [0, -108, -104, -108, -104, 0], d, [0, -14, -12, -14, -12, 0], d);
    play(stage.head, [
      { transform: "translateY(0px) rotate(0deg)", offset: 0 },
      { transform: "translateY(3px) rotate(-1.5deg)", offset: 0.3 },
      { transform: "translateY(2px) rotate(-1deg)", offset: 0.72 },
      { transform: "translateY(0px) rotate(0deg)", offset: 1 },
    ], { duration: d, easing: EASE.soft, delay: 50 });
    play(stage.glow, [
      { opacity: 0, transform: "translate(-50%,-50%) scale(.82)", offset: 0 },
      { opacity: 0.9, transform: "translate(-50%,-50%) scale(1)", offset: 0.3 },
      { opacity: 0.7, transform: "translate(-50%,-50%) scale(1.05)", offset: 0.72 },
      { opacity: 0, transform: "translate(-50%,-50%) scale(1.12)", offset: 1 },
    ], { duration: d, easing: EASE.soft });
    risingSparkles(stage, { count: 8, dur: 1300 });
  },

  alert(stage) {
    const d = MOOD_MS.alert;
    play(stage.pose, [
      { transform: "translateY(0px) scale(1,1)", offset: 0, easing: EASE.out },
      { transform: "translateY(-14px) scale(.98,1.04)", offset: 0.2, easing: EASE.in },
      { transform: "translateY(0px) scale(1.05,.95)", offset: 0.42, easing: EASE.spring },
      { transform: "translateY(0px) scale(1,1)", offset: 0.68 },
    ], { duration: d });
    arm(stage, "L", [0, 18, 8, 18, 0], d, [0, 8, 4, 8, 0], d);
    arm(stage, "R", [0, -24, -8, -24, 0], d, [0, -8, -4, -8, 0], d);
    play(stage.head, [
      { transform: "translateY(0px) rotate(0deg)", offset: 0 },
      { transform: "translateY(-2px) rotate(-4deg)", offset: 0.2 },
      { transform: "translateY(0px) rotate(2deg)", offset: 0.5 },
      { transform: "translateY(0px) rotate(0deg)", offset: 0.8 },
    ], { duration: d, easing: EASE.spring, delay: 50 });
  },

  neutral(stage) {
    const d = MOOD_MS.neutral;
    arm(stage, "L", [0, 30, 28, 30, 28, 0], d, [0, 20, 18, 20, 18, 0], d);
    play(stage.head, [
      { transform: "translateY(0px) rotate(0deg)", offset: 0 },
      { transform: "translateY(2px) rotate(6deg)", offset: 0.28 },
      { transform: "translateY(2px) rotate(5deg)", offset: 0.72 },
      { transform: "translateY(0px) rotate(0deg)", offset: 1 },
    ], { duration: d, easing: EASE.glide, delay: 50 });
  },
};

export function runMood(stage, mood) {
  active = [];
  (MOOD_ANIMS[mood] || MOOD_ANIMS.idle)(stage);
  const performed = active;
  active = null;
  return () => {
    performed.forEach((anim) => {
      try {
        anim.cancel();
      } catch {
        /* already gone */
      }
    });
    ["fx-sparkles", "fx-confetti", "fx-dust"].forEach((id) => {
      const layer = stage?.fx?.querySelector(`#${id}`);
      if (layer) layer.style.opacity = "0";
    });
  };
}

/* Touchdown after a drag or a fly-to-edge: one soft squash and a puff of dust.
   It is not owned by a mood, so it is not registered for mood cleanup. */
export function playLanding(stage) {
  if (!stage) return;
  once(stage.pose, [
    { transform: "translateY(0px) scale(1,1)", offset: 0, easing: EASE.out },
    { transform: "translateY(4px) scale(1.06,.94)", offset: 0.35, easing: EASE.spring },
    { transform: "translateY(0px) scale(.99,1.01)", offset: 0.75 },
    { transform: "translateY(0px) scale(1,1)", offset: 1 },
  ], { duration: 420, easing: EASE.soft });
  const dust = fxShapes(stage, "fx-dust");
  dust.forEach((el, i) => {
    once(el, [
      { opacity: 0, transform: "scale(.3)", offset: 0 },
      { opacity: 0.5, transform: "scale(1)", offset: 0.3 },
      { opacity: 0, transform: `scale(${1.6 + (i % 2) * 0.4}) translateY(-5px)`, offset: 1 },
    ], { duration: 520, delay: i * 55, easing: EASE.out });
  });
  window.setTimeout(() => {
    const layer = stage?.fx?.querySelector("#fx-dust");
    if (layer) layer.style.opacity = "0";
  }, 900);
}

/* ─── face life ─────────────────────────────────────────────────────────── */

export function blink(face) {
  if (!face || typeof face.querySelectorAll !== "function") return;
  face.querySelectorAll(".mzf-eye-open").forEach((eye) => {
    if (typeof eye.animate !== "function") return;
    try {
      eye.animate([
        { transform: "scaleY(1)", offset: 0 },
        { transform: "scaleY(.08)", offset: 0.45 },
        { transform: "scaleY(1)", offset: 1 },
      ], { duration: 220, easing: EASE.soft });
    } catch {
      /* no WAAPI, no blink */
    }
  });
}

export function dartEyes(face, x, y) {
  if (!face || typeof face.querySelectorAll !== "function") return;
  face.querySelectorAll(".mzf-dart").forEach((iris) => {
    if (typeof iris.animate !== "function") return;
    try {
      iris.animate([
        { transform: "translate(0px, 0px)", offset: 0 },
        { transform: `translate(${x}px, ${y}px)`, offset: 0.4 },
        { transform: `translate(${x}px, ${y}px)`, offset: 0.72 },
        { transform: "translate(0px, 0px)", offset: 1 },
      ], { duration: 620, easing: EASE.glide });
    } catch {
      /* no WAAPI, no dart */
    }
  });
}
