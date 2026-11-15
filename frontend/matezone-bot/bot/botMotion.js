import rawSvg from "../../src/assets/bot/bot-full.svg?raw";
import pivotData from "../../src/assets/bot/pivots.json";
import { MOOD_MS } from "./botConfig";

/* ─── artwork ─────────────────────────────────────────────────────────────
   bot-full.svg is a flat list of <g id="..."> layers. Rebuilding it at runtime
   keeps the ids the file uses, so every part can be animated on its own. The
   head layers are wrapped in <g id="head"> at the same slot in the stack, so
   the head rotates as one piece without changing the drawing. */

const SVG_NS = "http://www.w3.org/2000/svg";

let artworkCache;
export function getArtwork() {
  if (artworkCache !== undefined) return artworkCache;
  try {
    if (typeof DOMParser === "undefined") throw new Error("no DOMParser");
    const doc = new DOMParser().parseFromString(rawSvg, "image/svg+xml");
    const svg = doc.documentElement;
    if (!svg || svg.nodeName.toLowerCase() !== "svg") throw new Error("bad svg");

    const head = doc.createElementNS(SVG_NS, "g");
    head.setAttribute("id", "head");
    const firstHeadPart = svg.querySelector("#head-fin");
    if (!firstHeadPart) throw new Error("missing head parts");
    svg.insertBefore(head, firstHeadPart);
    pivotData.headGroup.forEach((id) => {
      const el = svg.querySelector(`#${id}`);
      if (el) head.appendChild(el);
    });

    svg.removeAttribute("width");
    svg.removeAttribute("height");
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    artworkCache = { ok: true, markup: new XMLSerializer().serializeToString(svg) };
  } catch (error) {
    artworkCache = { ok: false, error };
  }
  return artworkCache;
}

/* Pupils are not in pivots.json (they move as a pair), so they get their own
   centres from bot-full.svg. Everything else must come from the file. */
export const PART_ORIGINS = {
  ...pivotData.pivots,
  "pupil-left": "120px 98px",
  "pupil-right": "206px 98px",
  "act-wrapper": pivotData.pivots["act-wrapper"] || "170px 350px",
};

export const STAGE_ORIGIN = "50% 94.59%"; // 170px 350px of the 340x370 box

/* ─── motion vocabulary ───────────────────────────────────────────────────
   Custom curves only. Nothing here is linear: rises ease out, falls ease in,
   settles overshoot. */

const EASE = {
  glide: "cubic-bezier(.45,.05,.25,1)",
  out: "cubic-bezier(.22,1,.36,1)",
  in: "cubic-bezier(.55,0,.85,.4)",
  spring: "cubic-bezier(.34,1.56,.64,1)",
  soft: "cubic-bezier(.37,0,.63,1)",
};

const q = (svg, id) => (svg ? svg.querySelector(`#${id}`) : null);

let activeRunner = null;

function rawRun(el, frames, opts = {}) {
  if (!el || typeof el.animate !== "function") return null;
  try {
    return el.animate(frames, {
      duration: 600,
      easing: EASE.glide,
      fill: "both",
      composite: "add",
      ...opts,
    });
  } catch {
    return null;
  }
}

function run(el, frames, opts) {
  return (activeRunner || rawRun)(el, frames, opts);
}

/* ─── face ────────────────────────────────────────────────────────────────
   Mouth layers cross-fade with CSS transitions (see bot.css); the lids, pupils
   and brows are plain transforms so they can also be additive with blinks. */

const MOUTHS = ["mouth-smile", "mouth-closed", "mouth-frown", "mouth-o", "mouth-flat"];

const FACES = {
  idle: { mouth: "mouth-smile" },
  wave: { mouth: "mouth-smile" },
  happy: { mouth: "mouth-smile", cheeks: 1.14 },
  jump: { mouth: "mouth-o", brows: -5, cheeks: 1.08 },
  sad: { mouth: "mouth-frown", lids: 0.55, brows: 7, browTilt: 9, eyes: [0, 3], cheeks: 0.45 },
  cry: { mouth: "mouth-frown", lids: 0.5, brows: 8, browTilt: 10, eyes: [0, 3], cheeks: 0.35, tears: 1 },
  fly: { mouth: "mouth-o", brows: -4, cheeks: 1.05 },
  blessing: { mouth: "mouth-closed", lids: 0.88, brows: -2, eyes: [0, 1] },
  alert: { mouth: "mouth-o", brows: -7, eyes: [0, -1] },
  neutral: { mouth: "mouth-flat", browRight: -5, eyes: [5, 0] },
};

const LOOK_SCALE = 3;

export function applyFace(svg, mood, look = 0) {
  if (!svg) return;
  const face = FACES[mood] || FACES.idle;

  MOUTHS.forEach((id) => {
    const el = q(svg, id);
    if (el) el.style.opacity = face.mouth === id ? "1" : "0";
  });

  const lids = face.lids || 0;
  ["lid-left", "lid-right"].forEach((id) => {
    const el = q(svg, id);
    if (el) el.style.opacity = String(lids);
  });

  const tilt = face.browTilt || 0;
  const browL = q(svg, "brow-left");
  const browR = q(svg, "brow-right");
  if (browL) browL.style.transform = `translateY(${face.brows || 0}px) rotate(${-tilt}deg)`;
  if (browR) browR.style.transform = `translateY(${(face.browRight ?? face.brows) || 0}px) rotate(${tilt}deg)`;

  const cheeks = q(svg, "cheeks");
  if (cheeks) {
    cheeks.style.opacity = String(face.cheeks == null ? 1 : Math.min(1, face.cheeks));
    cheeks.style.transform = face.cheeks > 1 ? "scale(1.14)" : "scale(1)";
  }

  ["tear-left", "tear-right"].forEach((id) => {
    const el = q(svg, id);
    if (el) el.style.opacity = face.tears ? "1" : "0";
  });

  const eyes = face.eyes || [0, 0];
  setPupilLook(svg, eyes[0] + look * LOOK_SCALE, eyes[1]);
}

export function setPupilLook(svg, x = 0, y = 0) {
  ["pupil-left", "pupil-right"].forEach((id) => {
    const el = q(svg, id);
    if (el) el.style.transform = x || y ? `translate(${x}px, ${y}px)` : "translate(0px, 0px)";
  });
}

export function blink(svg) {
  ["lid-left", "lid-right"].forEach((id) => {
    run(q(svg, id), [
      { opacity: 0, offset: 0 },
      { opacity: 1, offset: 0.35 },
      { opacity: 1, offset: 0.6 },
      { opacity: 0, offset: 1 },
    ], { duration: 190, easing: EASE.soft, composite: "add" });
  });
}

export function dartEyes(svg, x, y) {
  ["pupil-left", "pupil-right"].forEach((id) => {
    run(q(svg, id), [
      { transform: "translate(0px, 0px)", offset: 0 },
      { transform: `translate(${x}px, ${y}px)`, offset: 0.4 },
      { transform: `translate(${x}px, ${y}px)`, offset: 0.72 },
      { transform: "translate(0px, 0px)", offset: 1 },
    ], { duration: 620, easing: EASE.glide, composite: "add" });
  });
}

/* ─── effect shapes ───────────────────────────────────────────────────────
   The stage ships idle versions of every effect, hidden. The engine only ever
   animates opacity and transform on them. */

function showFx(fx, id, on) {
  const el = q(fx, id);
  if (el) el.style.opacity = on ? "1" : "0";
  return el;
}

function fxList(fx, id) {
  const layer = showFx(fx, id, true);
  if (!layer) return [];
  // Each child is a positioning <g>; animate its shape instead, or the motion
  // would overwrite the placement transform.
  return Array.from(layer.children).map((g) => g.firstElementChild || g);
}

function sparkles(fx, { delay = 0, count = 6, dur = 900, rise = 0 } = {}) {
  fxList(fx, "fx-sparkles").slice(0, count).forEach((el, i) => {
    run(el, [
      { opacity: 0, transform: "scale(.2) rotate(0deg)", offset: 0 },
      { opacity: 1, transform: "scale(1.1) rotate(70deg)", offset: 0.4 },
      { opacity: 0, transform: `scale(.3) rotate(150deg) translateY(${rise}px)`, offset: 1 },
    ], { duration: dur, delay: delay + i * 120, iterations: 2, easing: EASE.out, composite: "replace" });
  });
}

function confetti(fx, delay = 0) {
  fxList(fx, "fx-confetti").forEach((el, i) => {
    const dx = (i % 7) * 26 - 78;
    const dy = 210 + (i % 5) * 26;
    run(el, [
      { opacity: 0, transform: "translate(0, 0) rotate(0deg)", offset: 0 },
      { opacity: 1, transform: "translate(0, 26px) rotate(60deg)", offset: 0.08 },
      { opacity: 0, transform: `translate(${dx}px, ${dy}px) rotate(${220 + i * 24}deg)`, offset: 1 },
    ], { duration: 1250, delay: delay + i * 55, easing: EASE.out, composite: "replace" });
  });
}

function dustBurst(fx, delay = 0) {
  fxList(fx, "fx-dust").forEach((el, i) => {
    run(el, [
      { opacity: 0, transform: "scale(.3)", offset: 0 },
      { opacity: 0.5, transform: "scale(1)", offset: 0.25 },
      { opacity: 0, transform: `scale(${1.8 + (i % 2) * 0.6}) translateY(-6px)`, offset: 1 },
    ], { duration: 620, delay: delay + i * 60, easing: EASE.out, composite: "replace" });
  });
}

function tears(svg, duration) {
  const cycles = 2;
  ["tear-left", "tear-right"].forEach((id, side) => {
    const el = q(svg, id);
    if (!el) return;
    run(el, [
      { opacity: 0, transform: "translate(0px, 0px) scale(.7)", offset: 0 },
      { opacity: 1, transform: "translate(0px, 6px) scale(1)", offset: 0.15 },
      { opacity: 0, transform: `translate(${side ? 8 : -8}px, 62px) scale(.85)`, offset: 1 },
    ], {
      duration: Math.round(duration / cycles),
      iterations: cycles,
      easing: EASE.in,
      composite: "replace",
      fill: "none",
    });
  });
}

/* ─── emotions ────────────────────────────────────────────────────────────
   Each performance ends on its resting transform so returning to idle is a
   freeze, not a snap. Duration comes from MOOD_MS so the queue and the
   animation always agree. */

function poseSad(art, duration) {
  const head = q(art, "head");
  const armL = q(art, "arm-left");
  const armR = q(art, "arm-right");
  run(head, [
    { transform: "translateY(0px) rotate(0deg)", offset: 0 },
    { transform: "translateY(5px) rotate(7deg)", offset: 0.45 },
    { transform: "translateY(4px) rotate(6deg)", offset: 1 },
  ], { duration, easing: EASE.soft });
  run(armL, [
    { transform: "rotate(0deg)", offset: 0 },
    { transform: "rotate(16deg)", offset: 0.5 },
    { transform: "rotate(14deg)", offset: 1 },
  ], { duration, easing: EASE.soft });
  run(armR, [
    { transform: "rotate(0deg)", offset: 0 },
    { transform: "rotate(11deg)", offset: 0.5 },
    { transform: "rotate(10deg)", offset: 1 },
  ], { duration, easing: EASE.soft });
}

const MOOD_ANIMS = {
  idle() {},

  wave(art, fx) {
    const duration = MOOD_MS.wave;
    run(q(art, "arm-left"), [
      { transform: "rotate(0deg)", easing: EASE.in, offset: 0 },
      { transform: "rotate(-64deg)", easing: EASE.out, offset: 0.1 },
      { transform: "rotate(-14deg)", easing: EASE.in, offset: 0.2 },
      { transform: "rotate(-64deg)", easing: EASE.out, offset: 0.3 },
      { transform: "rotate(-14deg)", easing: EASE.in, offset: 0.4 },
      { transform: "rotate(-64deg)", easing: EASE.out, offset: 0.5 },
      { transform: "rotate(-14deg)", easing: EASE.in, offset: 0.6 },
      { transform: "rotate(-64deg)", easing: EASE.out, offset: 0.7 },
      { transform: "rotate(-14deg)", easing: EASE.in, offset: 0.8 },
      { transform: "rotate(0deg)", easing: EASE.out, offset: 1 },
    ], { duration: 1800 });
    run(q(art, "head"), [
      { transform: "rotate(0deg)", offset: 0 },
      { transform: "rotate(-4deg)", offset: 0.25 },
      { transform: "rotate(2deg)", offset: 0.55 },
      { transform: "rotate(0deg)", offset: 0.85 },
    ], { duration, easing: EASE.glide, delay: 90 });
    run(q(art, "head-fin"), [
      { transform: "rotate(0deg)", offset: 0 },
      { transform: "rotate(7deg)", offset: 0.3 },
      { transform: "rotate(-5deg)", offset: 0.65 },
      { transform: "rotate(0deg)", offset: 1 },
    ], { duration: 1500, easing: EASE.spring, delay: 140 });
    sparkles(fx, { count: 2, delay: 700, dur: 700 });
  },

  happy(art, fx) {
    const duration = MOOD_MS.happy;
    run(q(art, "arm-left"), [
      { transform: "rotate(0deg)", offset: 0 },
      { transform: "rotate(-62deg)", offset: 0.22 },
      { transform: "rotate(-52deg)", offset: 0.34 },
      { transform: "rotate(-57deg)", offset: 0.5 },
      { transform: "rotate(-53deg)", offset: 0.72 },
      { transform: "rotate(0deg)", offset: 1 },
    ], { duration, easing: EASE.spring });
    run(q(art, "arm-right"), [
      { transform: "rotate(0deg)", offset: 0 },
      { transform: "rotate(-58deg)", offset: 0.24 },
      { transform: "rotate(-48deg)", offset: 0.36 },
      { transform: "rotate(-53deg)", offset: 0.52 },
      { transform: "rotate(-49deg)", offset: 0.74 },
      { transform: "rotate(0deg)", offset: 1 },
    ], { duration, easing: EASE.spring });
    run(q(art, "head"), [
      { transform: "translateY(0px) rotate(0deg)", easing: EASE.in, offset: 0 },
      { transform: "translateY(-5px) rotate(-3deg)", easing: EASE.spring, offset: 0.22 },
      { transform: "translateY(0px) rotate(2deg)", easing: EASE.glide, offset: 0.55 },
      { transform: "translateY(-3px) rotate(-1deg)", easing: EASE.spring, offset: 0.72 },
      { transform: "translateY(0px) rotate(0deg)", offset: 1 },
    ], { duration, delay: 70 });
    run(q(art, "head-fin"), [
      { transform: "rotate(0deg)", offset: 0 },
      { transform: "rotate(10deg)", offset: 0.28 },
      { transform: "rotate(-7deg)", offset: 0.58 },
      { transform: "rotate(0deg)", offset: 0.9 },
    ], { duration, easing: EASE.spring, delay: 150 });
    sparkles(fx, { count: 6, delay: 250, dur: 800 });
  },

  jump(art, fx, act) {
    const duration = MOOD_MS.jump;
    run(act, [
      { transform: "translateY(0px) scale(1, 1) rotate(0deg)", easing: EASE.in, offset: 0 },
      { transform: "translateY(2px) scale(1.1, .9) rotate(0deg)", easing: EASE.out, offset: 0.06 },
      { transform: "translateY(0px) scale(.94, 1.06) rotate(-2deg)", easing: EASE.out, offset: 0.1 },
      { transform: "translateY(-54px) scale(.98, 1.03) rotate(-3deg)", easing: EASE.in, offset: 0.22 },
      { transform: "translateY(0px) scale(1.1, .9) rotate(0deg)", easing: EASE.out, offset: 0.3 },
      { transform: "translateY(0px) scale(.94, 1.06) rotate(1deg)", easing: EASE.out, offset: 0.36 },
      { transform: "translateY(-46px) scale(.98, 1.03) rotate(3deg)", easing: EASE.in, offset: 0.47 },
      { transform: "translateY(0px) scale(1.09, .91) rotate(0deg)", easing: EASE.out, offset: 0.55 },
      { transform: "translateY(0px) scale(.95, 1.05) rotate(-1deg)", easing: EASE.out, offset: 0.61 },
      { transform: "translateY(-38px) scale(.99, 1.02) rotate(-2deg)", easing: EASE.in, offset: 0.72 },
      { transform: "translateY(0px) scale(1.08, .92) rotate(0deg)", easing: EASE.spring, offset: 0.81 },
      { transform: "translateY(0px) scale(1, 1) rotate(0deg)", offset: 1 },
    ], { duration });
    run(q(art, "arm-left"), [
      { transform: "rotate(0deg)", offset: 0 },
      { transform: "rotate(-70deg)", offset: 0.18 },
      { transform: "rotate(-58deg)", offset: 0.32 },
      { transform: "rotate(-72deg)", offset: 0.5 },
      { transform: "rotate(-58deg)", offset: 0.66 },
      { transform: "rotate(-68deg)", offset: 0.78 },
      { transform: "rotate(0deg)", offset: 1 },
    ], { duration, easing: EASE.spring });
    run(q(art, "arm-right"), [
      { transform: "rotate(0deg)", offset: 0 },
      { transform: "rotate(-64deg)", offset: 0.2 },
      { transform: "rotate(-52deg)", offset: 0.34 },
      { transform: "rotate(-66deg)", offset: 0.52 },
      { transform: "rotate(-52deg)", offset: 0.68 },
      { transform: "rotate(-60deg)", offset: 0.8 },
      { transform: "rotate(0deg)", offset: 1 },
    ], { duration, easing: EASE.spring });
    run(q(art, "head"), [
      { transform: "translateY(0px) rotate(0deg)", offset: 0 },
      { transform: "translateY(4px) rotate(0deg)", offset: 0.06 },
      { transform: "translateY(-4px) rotate(-2deg)", offset: 0.2 },
      { transform: "translateY(2px) rotate(1deg)", offset: 0.3 },
      { transform: "translateY(-3px) rotate(2deg)", offset: 0.47 },
      { transform: "translateY(2px) rotate(-1deg)", offset: 0.55 },
      { transform: "translateY(-2px) rotate(-2deg)", offset: 0.72 },
      { transform: "translateY(0px) rotate(0deg)", offset: 0.86 },
    ], { duration, delay: 60 });
    run(q(art, "head-fin"), [
      { transform: "rotate(0deg)", offset: 0 },
      { transform: "rotate(-9deg)", offset: 0.2 },
      { transform: "rotate(8deg)", offset: 0.34 },
      { transform: "rotate(-7deg)", offset: 0.5 },
      { transform: "rotate(7deg)", offset: 0.6 },
      { transform: "rotate(0deg)", offset: 0.9 },
    ], { duration, easing: EASE.spring, delay: 160 });
    dustBurst(fx, duration * 0.3);
    dustBurst(fx, duration * 0.55);
    dustBurst(fx, duration * 0.81);
    confetti(fx, duration * 0.42);
  },

  sad(art, fx, act) {
    const duration = MOOD_MS.sad;
    run(act, [
      { transform: "translateY(0px) scale(1, 1)", easing: EASE.soft, offset: 0 },
      { transform: "translateY(8px) scale(1, .982)", offset: 0.4 },
      { transform: "translateY(8px) scale(1, .978)", offset: 0.72 },
      { transform: "translateY(0px) scale(1, 1)", offset: 1 },
    ], { duration });
    poseSad(art, duration);
  },

  cry(art, fx, act) {
    const duration = MOOD_MS.cry;
    poseSad(art, duration);
    run(act, [
      { transform: "translateY(0px) translateX(0px)", offset: 0 },
      { transform: "translateY(8px) translateX(-1.5px)", offset: 0.16 },
      { transform: "translateY(8px) translateX(1.5px)", offset: 0.24 },
      { transform: "translateY(8px) translateX(-1.5px)", offset: 0.32 },
      { transform: "translateY(8px) translateX(1.5px)", offset: 0.4 },
      { transform: "translateY(8px) translateX(-1.5px)", offset: 0.48 },
      { transform: "translateY(8px) translateX(1.5px)", offset: 0.56 },
      { transform: "translateY(8px) translateX(-1.2px)", offset: 0.64 },
      { transform: "translateY(8px) translateX(0px)", offset: 0.74 },
      { transform: "translateY(0px) translateX(0px)", offset: 1 },
    ], { duration: 2200, easing: EASE.soft, delay: 200 });
    run(q(art, "arm-right"), [
      { transform: "rotate(11deg) translate(0px, 0px)", offset: 0 },
      { transform: "rotate(-50deg) translate(0px, 0px)", offset: 0.42 },
      { transform: "rotate(-46deg) translate(0px, 0px)", offset: 0.52 },
      { transform: "rotate(-52deg) translate(0px, 0px)", offset: 0.6 },
      { transform: "rotate(11deg) translate(0px, 0px)", offset: 1 },
    ], { duration, easing: EASE.glide, delay: 120 });
    tears(art, duration);
    const puddle = q(art, "puddle");
    run(puddle, [
      { opacity: 0, transform: "scale(.4, .3)", offset: 0 },
      { opacity: 0.9, transform: "scale(1, 1)", offset: 0.55 },
      { opacity: 0.95, transform: "scale(1.05, 1.15)", offset: 1 },
    ], { duration, easing: EASE.soft, composite: "replace" });
  },

  fly(art, fx) {
    const duration = MOOD_MS.fly;
    const tl = q(art, "track-left");
    const tr = q(art, "track-right");
    run(tl, [
      { transform: "rotate(0deg)", offset: 0 },
      { transform: "rotate(-34deg)", offset: 0.28 },
      { transform: "rotate(-32deg)", offset: 0.9 },
      { transform: "rotate(0deg)", offset: 1 },
    ], { duration, easing: EASE.spring });
    run(tr, [
      { transform: "rotate(0deg)", offset: 0 },
      { transform: "rotate(34deg)", offset: 0.28 },
      { transform: "rotate(32deg)", offset: 0.9 },
      { transform: "rotate(0deg)", offset: 1 },
    ], { duration, easing: EASE.spring });
    ["flame-left", "flame-right"].forEach((id, i) => {
      const el = q(art, id);
      if (!el) return;
      el.style.opacity = "1";
      run(el, [
        { opacity: 0.55, transform: "scale(1, .8)", offset: 0 },
        { opacity: 0.95, transform: "scale(.9, 1.25)", offset: 0.5 },
        { opacity: 0.6, transform: "scale(1.05, .85)", offset: 1 },
      ], { duration: 260, iterations: Infinity, easing: EASE.soft, composite: "replace", delay: i * 120 });
    });
    /* Thruster exhaust: a big flame plume under each track and smoke drifting
       out and down, so the flight reads as powered from below. The flames are
       the last two shapes so they draw over the smoke. */
    const exhaust = fxList(fx, "fx-fire");
    exhaust.slice(-2).forEach((el, i) => {
      run(el, [
        { opacity: 0.7, transform: "scale(1, .85)", offset: 0 },
        { opacity: 1, transform: "scale(.86, 1.3)", offset: 0.5 },
        { opacity: 0.65, transform: "scale(1.08, .8)", offset: 1 },
      ], { duration: 190, iterations: Infinity, easing: EASE.soft, composite: "replace", delay: i * 90 });
    });
    exhaust.slice(0, -2).forEach((el, i) => {
      const dx = i < 3 ? -16 : 16;
      run(el, [
        { opacity: 0, transform: "translate(0px, 0px) scale(.4)", offset: 0 },
        { opacity: 0.5, transform: `translate(${dx}px, 12px) scale(1.15)`, offset: 0.45 },
        { opacity: 0, transform: `translate(${dx * 2.6}px, 28px) scale(2.8)`, offset: 1 },
      ], { duration: 1050, iterations: Infinity, easing: EASE.out, composite: "replace", delay: i * 170 });
    });
    run(q(art, "arm-left"), [
      { transform: "rotate(0deg)", offset: 0 },
      { transform: "rotate(16deg)", offset: 0.3 },
      { transform: "rotate(14deg)", offset: 0.85 },
      { transform: "rotate(0deg)", offset: 1 },
    ], { duration, easing: EASE.glide });
    run(q(art, "arm-right"), [
      { transform: "rotate(0deg)", offset: 0 },
      { transform: "rotate(-12deg)", offset: 0.3 },
      { transform: "rotate(-10deg)", offset: 0.85 },
      { transform: "rotate(0deg)", offset: 1 },
    ], { duration, easing: EASE.glide });
    run(q(art, "head"), [
      { transform: "rotate(0deg)", offset: 0 },
      { transform: "rotate(-5deg)", offset: 0.35 },
      { transform: "rotate(-4deg)", offset: 0.85 },
      { transform: "rotate(0deg)", offset: 1 },
    ], { duration, easing: EASE.glide, delay: 120 });
    run(q(art, "head-fin"), [
      { transform: "rotate(0deg)", offset: 0 },
      { transform: "rotate(8deg)", offset: 0.3 },
      { transform: "rotate(-6deg)", offset: 0.6 },
      { transform: "rotate(0deg)", offset: 1 },
    ], { duration, easing: EASE.spring, delay: 180 });
    const shadow = q(art, "shadow");
    run(shadow, [
      { opacity: 1, transform: "scale(1, 1)", offset: 0 },
      { opacity: 0.5, transform: "scale(.55, .8)", offset: 0.45 },
      { opacity: 0.55, transform: "scale(.55, .8)", offset: 0.85 },
      { opacity: 1, transform: "scale(1, 1)", offset: 1 },
    ], { duration, easing: EASE.soft, composite: "replace" });
    sparkles(fx, { count: 2, delay: 500, dur: 600, rise: -10 });
  },

  blessing(art, fx, act) {
    const duration = MOOD_MS.blessing;
    run(act, [
      { transform: "translateY(0px)", offset: 0 },
      { transform: "translateY(-14px)", offset: 0.32 },
      { transform: "translateY(-13px)", offset: 0.82 },
      { transform: "translateY(0px)", offset: 1 },
    ], { duration, easing: EASE.soft });
    run(q(art, "arm-left"), [
      { transform: "rotate(0deg)", offset: 0 },
      { transform: "rotate(-72deg)", offset: 0.34 },
      { transform: "rotate(-76deg)", offset: 0.65 },
      { transform: "rotate(-70deg)", offset: 1 },
    ], { duration, easing: EASE.spring });
    run(q(art, "arm-right"), [
      { transform: "rotate(0deg)", offset: 0 },
      { transform: "rotate(-52deg)", offset: 0.36 },
      { transform: "rotate(-56deg)", offset: 0.66 },
      { transform: "rotate(-50deg)", offset: 1 },
    ], { duration, easing: EASE.spring });
    run(q(art, "head"), [
      { transform: "rotate(0deg)", offset: 0 },
      { transform: "rotate(-2deg)", offset: 0.4 },
      { transform: "rotate(2deg)", offset: 0.75 },
      { transform: "rotate(0deg)", offset: 1 },
    ], { duration, easing: EASE.soft });
    const glow = q(art, "glow");
    run(glow, [
      { opacity: 0, transform: "scale(.9)", offset: 0 },
      { opacity: 0.6, transform: "scale(1.05)", offset: 0.35 },
      { opacity: 0.45, transform: "scale(1.12)", offset: 0.7 },
      { opacity: 0, transform: "scale(1.15)", offset: 1 },
    ], { duration, easing: EASE.soft, composite: "replace" });
    run(q(art, "head-fin"), [
      { transform: "rotate(0deg)", offset: 0 },
      { transform: "rotate(5deg)", offset: 0.4 },
      { transform: "rotate(-4deg)", offset: 0.8 },
      { transform: "rotate(0deg)", offset: 1 },
    ], { duration, easing: EASE.soft, delay: 160 });
    sparkles(fx, { count: 6, delay: 300, dur: 1200, rise: -12 });
  },

  alert(art, fx, act) {
    const duration = MOOD_MS.alert;
    run(act, [
      { transform: "translateY(0px) scale(1, 1)", easing: EASE.in, offset: 0 },
      { transform: "translateY(0px) scale(1.08, .92)", easing: EASE.out, offset: 0.12 },
      { transform: "translateY(-16px) scale(.98, 1.02)", easing: EASE.in, offset: 0.3 },
      { transform: "translateY(0px) scale(1.07, .93)", easing: EASE.spring, offset: 0.48 },
      { transform: "translateY(-9px) scale(1, 1)", easing: EASE.in, offset: 0.64 },
      { transform: "translateY(0px) scale(1.05, .95)", easing: EASE.spring, offset: 0.78 },
      { transform: "translateY(0px) scale(1, 1)", offset: 1 },
    ], { duration });
    run(q(art, "head"), [
      { transform: "rotate(0deg)", offset: 0 },
      { transform: "rotate(-5deg)", offset: 0.2 },
      { transform: "rotate(5deg)", offset: 0.4 },
      { transform: "rotate(-3deg)", offset: 0.6 },
      { transform: "rotate(0deg)", offset: 0.8 },
    ], { duration, easing: EASE.glide });
    run(q(art, "head-fin"), [
      { transform: "rotate(0deg)", offset: 0 },
      { transform: "rotate(12deg)", offset: 0.25 },
      { transform: "rotate(-8deg)", offset: 0.55 },
      { transform: "rotate(0deg)", offset: 0.85 },
    ], { duration, easing: EASE.spring, delay: 120 });
  },

  neutral(art, fx, act) {
    const duration = MOOD_MS.neutral;
    run(act, [
      { transform: "translateY(0px) translateX(0px)", offset: 0 },
      { transform: "translateY(2px) translateX(4px)", offset: 0.3 },
      { transform: "translateY(2px) translateX(4px)", offset: 0.7 },
      { transform: "translateY(0px) translateX(0px)", offset: 1 },
    ], { duration, easing: EASE.soft });
    run(q(art, "head"), [
      { transform: "rotate(0deg)", offset: 0 },
      { transform: "rotate(3deg)", offset: 0.35 },
      { transform: "rotate(3deg)", offset: 0.7 },
      { transform: "rotate(0deg)", offset: 1 },
    ], { duration, easing: EASE.soft, delay: 100 });
    run(q(art, "head-fin"), [
      { transform: "rotate(0deg)", offset: 0 },
      { transform: "rotate(4deg)", offset: 0.4 },
      { transform: "rotate(-3deg)", offset: 0.75 },
      { transform: "rotate(0deg)", offset: 1 },
    ], { duration, easing: EASE.soft, delay: 180 });
  },
};

export function runMood(stage, mood) {
  const performance = MOOD_ANIMS[mood];
  if (!performance || !stage?.art) return () => {};
  const animations = [];

  // Every helper reaches motion through run(); swapping the active runner for
  // the length of this call records everything the mood starts, so a change of
  // mood can cancel exactly those animations and nothing else.
  activeRunner = (el, frames, opts) => {
    const a = rawRun(el, frames, opts);
    if (a) animations.push(a);
    return a;
  };
  try {
    performance(stage.art, stage.fx, stage.act);
    stage.shell.style.transition = "filter .6s cubic-bezier(.45,.05,.25,1)";
    stage.shell.style.filter = mood === "sad" || mood === "cry" ? "saturate(.72)" : "";
  } finally {
    activeRunner = null;
  }

  return () => {
    animations.forEach((a) => {
      try { a.cancel(); } catch { /* already finished */ }
    });
    ["fx-fire", "fx-sparkles", "fx-confetti", "fx-dust"].forEach((id) => showFx(stage.fx, id, false));
    ["flame-left", "flame-right", "puddle", "glow"].forEach((id) => {
      const el = q(stage.art, id);
      if (el) el.style.opacity = "0";
    });
  };
}

/* Soft landing after a drag or a reminder flight: one squash and a puff of
   dust, then the idle loop takes over again. */
export function playLanding(stage) {
  if (!stage?.act) return;
  rawRun(stage.act, [
    { transform: "translateY(0px) scale(1, 1)", offset: 0 },
    { transform: "translateY(4px) scale(1.09, .9)", offset: 0.32 },
    { transform: "translateY(0px) scale(.97, 1.03)", offset: 0.62 },
    { transform: "translateY(0px) scale(1, 1)", offset: 1 },
  ], { duration: 430, easing: EASE.spring, composite: "add", fill: "none" });
  dustBurst(stage.fx, 60);
  setTimeout(() => showFx(stage.fx, "fx-dust", false), 1000);
}

