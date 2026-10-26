/* Chess sounds: recorded chess.com-style samples + synthesized fallbacks, all
 * played through one Web Audio graph. No <audio> elements, so the volume
 * multiplier and the master limiter apply to every cue. */

let ctx = null;

/* ── On/off preference ──────────────────────────────────────────────────────
 * This used to be a bare module flag that only `AnalysisBoard` (the Play Arena)
 * ever wrote to, which meant the sound setting lived in one page's React state
 * and was lost on navigation. It is now persisted, so the choice the user makes
 * applies to EVERY board in the app and survives a reload.
 */
const ENABLED_KEY = 'kpa_sound_enabled';

function readStoredEnabled() {
  try {
    const v = localStorage.getItem(ENABLED_KEY);
    if (v === null || v === undefined || v === '') return true;
    return v !== '0' && v !== 'false';
  } catch {
    return true;  // private mode — stay enabled rather than mute the app
  }
}

/* Listeners so React can re-render when the preference changes. Without this a
 * toggle could only be rendered by the component that owns the state. */
const enabledListeners = new Set();

function notifyEnabled() {
  enabledListeners.forEach((fn) => {
    try { fn(enabled); } catch { /* a bad listener must not break audio */ }
  });
}

/** Subscribe to on/off changes. Returns an unsubscribe function. */
export function subscribeSoundEnabled(fn) {
  enabledListeners.add(fn);
  return () => enabledListeners.delete(fn);
}

let enabled = readStoredEnabled();

/* ── Volume ────────────────────────────────────────────────────────────────
 * Every sound's `gain` is authored as an absolute peak, so volume is a single
 * multiplier applied inside `tone()`. Doing it here rather than at each call
 * site means one knob scales all ~40 cues consistently.
 *
 * Ceiling is 200% rather than 100%: the synthesized cues are quiet relative to
 * system volume, and the request was explicitly to make moves loud. 1.0 still
 * means "the volume the cues were authored at", so an existing listener who
 * sets 100% hears exactly what they heard before.
 */
const VOLUME_KEY = 'kpa_sound_volume';
const VOLUME_MAX = 2;

function clampVolume(v) {
  // localStorage.getItem returns null for "unset" — that must mean the default,
  // not zero, or a first-time visitor would get a silent board.
  if (v === null || v === undefined || v === '') return 1;
  const n = Number(v);
  if (!Number.isFinite(n)) return 1;
  return Math.min(VOLUME_MAX, Math.max(0, n));
}

function readStoredVolume() {
  try { return clampVolume(localStorage.getItem(VOLUME_KEY)); } catch { return 1; }
}

/* Read the stored volume at module load, not on first play, so every page that
 * imports `playSound` (academy, puzzles, live classes) is already at the
 * user's chosen level without each one having to opt in. */
let volume = readStoredVolume();

/* Same subscription pattern as the on/off flag, so a volume slider anywhere
 * (Settings, the Play Arena) can re-render every other consumer of the value. */
const volumeListeners = new Set();

function notifyVolume() {
  volumeListeners.forEach((fn) => {
    try { fn(volume); } catch { /* ignore */ }
  });
}

/** Subscribe to volume changes. Returns an unsubscribe function. */
export function subscribeSoundVolume(fn) {
  volumeListeners.add(fn);
  return () => volumeListeners.delete(fn);
}

export function setSoundVolume(v) {
  const next = clampVolume(v);
  if (next === volume) return;
  volume = next;
  try { localStorage.setItem(VOLUME_KEY, String(volume)); } catch { /* private mode */ }
  notifyVolume();
}

export const getSoundVolume = () => volume;

/* ── Audio context lifecycle ───────────────────────────────────────────────
 * Browsers block audio until the user has interacted with the page: an
 * AudioContext constructed outside a user gesture starts in the `suspended`
 * state and `resume()` is rejected. The old code created the context lazily
 * from inside `playSound()`, and several callers run OUTSIDE a gesture (the
 * `playSound('victory')` effect, engine callbacks, celebration mounts), so the
 * context was frequently born suspended — and because `resume()` was called
 * fire-and-forget, the tone was scheduled on a frozen clock and silently
 * dropped. That is why making a move was mute.
 *
 * Fix, in three parts:
 *   1. `unlockAudio()` resumes the context from a real gesture; we bind it to
 *      the first pointerdown/keydown/touchstart anywhere in the app.
 *   2. `resumeCtx()` returns a promise and never leaves a rejected promise
 *      unhandled.
 *   3. `tone()` waits for the context to actually be running before scheduling,
 *      instead of scheduling into a suspended one and hoping.
 */
let unlockBound = false;
let master = null;      // master gain → limiter → destination (see outputBus)

function ensureContext() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  // A fresh context needs a fresh bus — the old nodes belong to the old graph.
  master = null;
  return ctx;
}

/** Resume a suspended context. Resolves true only when it is really running. */
function resumeCtx(c) {
  if (!c || c.state !== 'suspended') return Promise.resolve(Boolean(c));
  try {
    const p = c.resume();
    if (p && typeof p.then === 'function') {
      return p.then(() => c.state !== 'suspended', () => false);
    }
  } catch {
    /* fall through — treated as "not running" below */
  }
  return Promise.resolve(c.state !== 'suspended');
}

function audio() {
  const c = ensureContext();
  if (!c) return null;
  if (c.state === 'suspended') resumeCtx(c);   // best effort; tone() re-checks
  return c;
}

/* Resume the context from a genuine user gesture. Safe to call repeatedly. */
export function unlockAudio() {
  const c = ensureContext();
  if (!c) return;
  resumeCtx(c);
}

/* Browsers only honour a resume() issued during a gesture, so watch for
   gestures continuously rather than once. We deliberately do NOT unbind after
   the first one: the context is suspended again every time the user flips
   "Sound effects" off, and the re-enable happens in a React effect (outside
   the gesture), which the browser rejects. Staying bound costs a boolean
   check per click and makes the resume land in a real gesture every time. */
function bindUnlock() {
  if (unlockBound || typeof window === 'undefined' || !window.addEventListener) return;
  unlockBound = true;
  const onGesture = () => {
    if (ctx && ctx.state === 'suspended') resumeCtx(ctx);
    /* Warm the MP3 cache inside this gesture. decodeAudioData is async, so
       doing it here means the samples are ready by the time a move is made
       instead of the first move falling back to the synthesized tone. */
    preloadSamples();
  };
  ['pointerdown', 'keydown', 'touchstart'].forEach((e) =>
    window.addEventListener(e, onGesture, { passive: true })
  );
}
bindUnlock();

/* ── Master bus ────────────────────────────────────────────────────────────
 * Every cue is a stack of oscillators all summing onto `ctx.destination`. The
 * peaks we author are safe in isolation, but they are NOT safe in aggregate:
 * `celebrate` is 13 staggered voices whose authored peaks sum to ~4.85, and a
 * user dragging the volume to 200% pushes a single `move` to 1.1. Either case
 * clips the output and turns into digital distortion — a harsh buzz, which is
 * worse than being quiet.
 *
 * So all voices route through one gain node into a DynamicsCompressor acting as
 * a limiter. Gain above the threshold is compressed rather than clipped, so the
 * mix stays loud and clean no matter how the user sets the slider. Browsers
 * without DynamicsCompressorNode fall back to the raw destination, which is
 * where we started.
 *
 * MASTER_GAIN is the app-wide boost. The cues are authored for a laptop
 * speaker at a normal system volume, and on a phone they were simply too
 * quiet: a move is a 30 ms event, so it has to be well above the ambient noise
 * to register at all. The boost sits BEFORE the limiter, so the limiter still
 * catches the aggregate overshoot (the 13-voice fanfare, the slider at 200%)
 * and the output never clips.
 */
const MASTER_GAIN = 1.5;

function outputBus(c) {
  if (master) return master;
  try {
    const g = c.createGain();
    const limiter = c.createDynamicsCompressor();
    /* Threshold sits just below the loudest normal cue (move peaks at 0.60,
       boosted to 0.90) so ordinary play passes through completely untouched,
       and only genuine overshoot — the 13-voice celebrate stack, or the slider
       at 200% — gets pulled down. An earlier -6 dB threshold compressed the
       normal move itself, which made the volume slider do nothing above 100%.
       Ratio 20 is firm enough to keep the result under 1.0 rather than merely
       rounding the corner. */
    limiter.threshold.value = -1;
    limiter.knee.value = 2;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    g.gain.value = MASTER_GAIN;
    g.connect(limiter).connect(c.destination);
    master = g;
  } catch {
    master = c.destination;
  }
  return master;
}

function tone(freq, dur, { type = 'sine', gain = 0.06, when = 0, slideTo = null } = {}) {
  const c = audio();
  if (!c) return;
  const peak = gain * volume;
  /* exponentialRampToValueAtTime throws on a target of 0, and a gain envelope
     that starts and ends at 0.0001 is only meaningful if the peak is above it.
     Muted volume (or a zero-gain cue) therefore plays nothing instead of
     throwing and killing the rest of the sound via the caller's try/catch. */
  if (!(peak > 0.0001)) return;

  const start = () => {
    // Re-read currentTime at schedule time: if we waited on a resume() the
    // clock has moved, and using the stale t0 would play the tone in the past.
    const t0 = c.currentTime + when;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(outputBus(c));
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  };

  if (c.state === 'suspended') {
    /* Still locked (no gesture yet, or the resume was rejected). Wait for the
       resume to land and only then schedule — otherwise the oscillators are
       queued against a frozen clock and are dropped when nothing resumes it. */
    resumeCtx(c).then((running) => { if (running) start(); });
    return;
  }
  start();
}

/* (`thump` — the old single-sine move helper — was removed when `woodTok`
   replaced it for move/capture/castle; nothing else used it.) */

export function setSoundEnabled(v) {
  const next = Boolean(v);
  /* No-op when unchanged: AnalysisBoard re-runs its effect on every render, and
   * `suspend()`/`resume()` are expensive enough that calling them needlessly
   * would thrash the audio graph. */
  if (next === enabled) return;
  enabled = next;
  try { localStorage.setItem(ENABLED_KEY, enabled ? '1' : '0'); } catch { /* private mode */ }
  notifyEnabled();

  const c = ctx;
  if (!c) return;                       // nothing built yet; nothing to do
  if (!enabled) { try { c.suspend(); } catch { /* ignore */ } return; }
  /* Re-enabling is driven by a React effect, i.e. OUTSIDE the click gesture,
     so this resume is often rejected. That is fine: the gesture listener above
     retries on the user's next interaction, and `tone()` re-checks the state
     before scheduling — so the very next move still makes a sound. */
  if (c.state === 'suspended') resumeCtx(c);
}

export const isSoundEnabled = () => enabled;

/* ── Cue levels ────────────────────────────────────────────────────────────
 * These peaks were authored at 0.03–0.19, which is genuinely inaudible on
 * laptop speakers and phone earpieces — the reason moves "made no sound" even
 * when the audio graph was working correctly. They are now roughly 3× louder
 * and rebalanced so `move` (the cue you hear most) is the loudest thing in a
 * normal game; the rarer cues (check, mate, victory) sit above it so they
 * still cut through.
 *
 * They were raised AGAIN (the request was for louder move effects): a move is
 * a 30 ms event, so it has to sit clearly above the ambient noise to register
 * on a phone. On top of the app-wide MASTER_GAIN these peaks land at ~0.90 for
 * a normal move, and the master limiter catches the aggregate overshoot.
 *
 * Peaks stay well under 1.0 because `tone()` stacks overlapping voices on one
 * destination bus — a loud cue plus a couple of tails would clip and distort.
 */
const G = {
  select: 0.10, move: 0.60, capture: 0.55, castle: 0.50, promotion: 0.42, // original (volume scaling removed)
  check: 0.46, illegal: 0.36, good: 0.44, bad: 0.38, victory: 0.56, celebrate: 0.66,
};

/* ── The per-move "piece on wood" sound ───────────────────────────────────
 * A chess.com-style move cue is not a single tone — it is the sound of a
 * wooden piece being set down, which has two parts:
 *
 *   1. a hard TRANSIENT — the knock of the base hitting the board, a very
 *      short high-frequency blip. This is what makes it read as "wood".
 *   2. a short resonant BODY that pitches down fast as the board rings.
 *
 * The old cue was one low sine, which is why it read as a dull thud.
 *
 * Every move also nudges the pitch by a few percent. Without that, a rapid
 * sequence (e.g. stepping through a 40-move game) plays an identical waveform
 * every time and sounds like a machine gun; the variation makes a run of moves
 * sound like distinct physical placements. The jitter cycles through 5 fixed
 * values rather than using Math.random() so it stays reproducible.
 */
let moveSeq = 0;

function woodTok(bodyFreq, dur, gain, { bright = 1, body = 0.58, when = 0 } = {}) {
  const jitter = 1 + (((moveSeq++) % 5) - 2) * 0.015;   // ±3%
  // 1. the knock
  tone(1720 * jitter, 0.026, { type: 'triangle', gain: gain * 0.5 * bright, when });
  // 2. the body ringing down
  tone(bodyFreq * jitter, dur, { type: 'sine', gain, when, slideTo: bodyFreq * jitter * body });
}

/* ── Recorded cues ──────────────────────────────────────────────────────────
 * Real MP3 samples (the chess.com "default" sound pack) played through the SAME
 * Web Audio graph as the synthesized cues, so the volume slider and the master
 * limiter apply to them too. An <audio> element would have been simpler but
 * would bypass both.
 *
 * Files are served from /sounds (downloaded into public/sounds) rather than
 * hotlinked from the CDN: no third-party request on every move, no CORS
 * dependency, and the app keeps working offline.
 */
const SAMPLE_FILES = {
  'move-self':     '/sounds/move-self.mp3',
  'move-opponent': '/sounds/move-opponent.mp3',
  capture:         '/sounds/capture.mp3',
  castle:          '/sounds/castle.mp3',
  'move-check':    '/sounds/move-check.mp3',
  promote:         '/sounds/promote.mp3',
};

const sampleBuffers = new Map();   // name → AudioBuffer
const sampleLoading = new Map();   // name → Promise, so we never double-fetch

function loadSample(name) {
  if (sampleBuffers.has(name)) return Promise.resolve(sampleBuffers.get(name));
  if (sampleLoading.has(name)) return sampleLoading.get(name);
  const p = (async () => {
    const c = audio();
    if (!c) return null;
    const res = await fetch(SAMPLE_FILES[name]);
    if (!res.ok) return null;
    const buf = await c.decodeAudioData(await res.arrayBuffer());
    sampleBuffers.set(name, buf);
    return buf;
  })().catch(() => null);
  sampleLoading.set(name, p);
  return p;
}

/* Warm the cache so the very first move isn't silent while the fetch lands. */
function preloadSamples() {
  Object.keys(SAMPLE_FILES).forEach((n) => { loadSample(n); });
}

function startSample(c, buf, gainScale) {
  const src = c.createBufferSource();
  src.buffer = buf;
  const g = c.createGain();
  g.gain.value = volume * gainScale;
  src.connect(g).connect(outputBus(c));
  src.start();
}

/**
 * Play a recorded cue if it is available. Returns false when the sample is
 * still loading, so the caller can fall back to the synthesized tone on the very
 * first move (before any preload finished) instead of dropping the sound.
 */
function playSample(name, gainScale = 1) {
  const c = audio();
  if (!c) return false;
  const cached = sampleBuffers.get(name);
  if (cached) { startSample(c, cached, gainScale); return true; }
  loadSample(name).then((buf) => {
    if (buf && enabled) startSample(c, buf, gainScale);
  });
  return false;
}

export function playSound(kind) {
  if (!enabled) return;
  try {
    switch (kind) {
      case 'select':
        tone(820, 0.05, { type: 'triangle', gain: G.select });
        break;
      /* Recorded samples are tried first; if one is still loading (or failed to
         fetch/decode) we fall back to the synthesized cue so a move is never
         silent. `playSample` returns true only when it actually played. */
      case 'move':
      case 'move-self':
        if (!playSample('move-self')) woodTok(212, 0.13, G.move);
        break;
      case 'move-opponent':
        if (!playSample('move-opponent')) woodTok(186, 0.12, G.move * 0.85);
        break;
      case 'capture':
        if (playSample('capture')) break;
        /* A capture is the same knock, but lower and harder — a bigger piece
           hitting the board — plus a short bright ring for the "crack". */
        woodTok(158, 0.15, G.capture, { bright: 1.45, body: 0.5 });
        tone(1180, 0.05, { type: 'triangle', gain: G.capture * 0.3, when: 0.004 });
        break;
      case 'castle':
        if (playSample('castle')) break;
        /* Two placements: the king is set, then the rook. */
        woodTok(228, 0.11, G.castle, { body: 0.6 });
        woodTok(198, 0.13, G.castle * 0.9, { when: 0.11, body: 0.6 });
        break;
      case 'promotion':
        if (playSample('promote')) break;
        tone(392, 0.09, { type: 'triangle', gain: G.promotion });
        tone(587, 0.14, { type: 'triangle', gain: G.promotion, when: 0.07 });
        break;
      case 'check':
        /* move-check.mp3 is chess.com's "your move gave check" cue, which is
           exactly when we fire this (the opponent's king is in check). */
        if (playSample('move-check')) break;
        tone(660, 0.1, { type: 'square', gain: G.check });
        tone(880, 0.16, { type: 'square', gain: G.check, when: 0.08 });
        break;
      case 'illegal':
        tone(95, 0.14, { type: 'sawtooth', gain: G.illegal });
        break;
      case 'good':
        tone(523, 0.09, { type: 'triangle', gain: G.good });
        tone(784, 0.2, { type: 'triangle', gain: G.good, when: 0.08 });
        break;
      case 'bad':
        tone(280, 0.12, { type: 'sawtooth', gain: G.bad });
        tone(200, 0.2, { type: 'sawtooth', gain: G.bad, when: 0.1 });
        break;
      case 'victory':
        tone(523, 0.1, { type: 'triangle', gain: G.victory });
        tone(659, 0.1, { type: 'triangle', gain: G.victory, when: 0.09 });
        tone(784, 0.12, { type: 'triangle', gain: G.victory, when: 0.17 });
        tone(1046, 0.32, { type: 'triangle', gain: G.victory, when: 0.26 });
        break;
      case 'celebrate':
        /* loud party fanfare: ascending arpeggio + burst + crash */
        tone(523, 0.10, { type: 'triangle', gain: G.celebrate * 0.72 });
        tone(659, 0.10, { type: 'triangle', gain: G.celebrate * 0.78, when: 0.08 });
        tone(784, 0.10, { type: 'triangle', gain: G.celebrate * 0.84, when: 0.16 });
        tone(1046, 0.14, { type: 'triangle', gain: G.celebrate * 0.90, when: 0.24 });
        tone(1318, 0.14, { type: 'triangle', gain: G.celebrate * 0.96, when: 0.32 });
        tone(1568, 0.18, { type: 'triangle', gain: G.celebrate, when: 0.40 });
        /* crash layer at the peak */
        tone(1568, 0.25, { type: 'sawtooth', gain: G.celebrate * 0.30, when: 0.40, slideTo: 660 });
        tone(2093, 0.30, { type: 'triangle', gain: G.celebrate * 0.62, when: 0.48 });
        /* sparkle cascade */
        tone(2637, 0.08, { type: 'sine', gain: G.celebrate * 0.44, when: 0.56 });
        tone(3136, 0.08, { type: 'sine', gain: G.celebrate * 0.38, when: 0.62 });
        tone(2637, 0.08, { type: 'sine', gain: G.celebrate * 0.38, when: 0.68 });
        tone(3136, 0.14, { type: 'sine', gain: G.celebrate * 0.50, when: 0.74 });
        break;
      default:
        break;
    }
  } catch {
    /* audio not available */
  }
}

/* ── Chess.com move-cue classification ─────────────────────────────────────
 * `ChessBoard` used to own this if/else chain inline, which meant the rules
 * ("a castle is two thunks", "a capture is a harder knock", "your opponent's
 * move gets the duller sample") only applied to boards that happened to route
 * their moves through that one `applyMove` call site. Boards that drive the
 * Chess instance themselves — the bot in the Play Arena, the engine, the live
 * PvP board, the tournament board, the coach's shared board — bypassed it
 * entirely and were silent.
 *
 * Hoisting the rules here means every caller, however the move arrived, gets the
 * same chess.com-style cue.
 */

/**
 * Decide which cue a chess.js move object should play.
 * @param {object}  move      a chess.js verbose move ({ san, color, flags, captured })
 * @param {object}  opts
 * @param {boolean} opts.isSelf  true → the local player's move, false → the opponent's
 * @returns {string} a `playSound` kind
 */
export function classifyMove(move, { isSelf = true } = {}) {
  if (!move) return isSelf ? 'move-self' : 'move-opponent';
  const san = move.san || '';
  const flags = move.flags || '';
  /* Order matters: castling and promotion are special moves that may also be
     captures (e.g. O-O-O capturing on h8), and they have their own cues, so
     they must be tested before the generic capture branch. */
  if (san.includes('O-O')) return 'castle';
  if (san.includes('='))   return 'promotion';
  /* 'e' in flags is an en-passant capture, which never sets `captured` to a
     piece object but IS a capture and must sound like one. */
  if (flags.includes('e') || move.captured) return 'capture';
  return isSelf ? 'move-self' : 'move-opponent';
}

/**
 * Play the correct chess.com-style cue for a move, plus the check cue when the
 * move leaves the opponent in check.
 *
 * @param {object}  move      chess.js verbose move
 * @param {object}  opts
 * @param {boolean} opts.isSelf    local player (or "no notion of other") → move-self
 * @param {boolean} opts.inCheck   play the check cue after the move cue
 */
export function playMoveSound(move, { isSelf = true, inCheck = false } = {}) {
  if (!enabled) return;
  playSound(classifyMove(move, { isSelf }));
  if (inCheck) playSound('check');
}

/* ── MoveEffect cue ─────────────────────────────────────────────────────────
 * The two-part sound of the "sigma move" landing:
 *   1. a thud — a 150 → 52 Hz sine sweep with a fast decay (~240 ms)
 *   2. a swell — three harmonics (fundamental + 2nd at .4x + 3rd at .2x) with
 *      the authored frequency and gain envelopes, so it survives a phone
 *      speaker where a pure low sine would be inaudible.
 *
 * Timing is authored in effects/moveEffect/config.js and passed in, already
 * scaled for slow motion. Everything is scheduled on the shared master bus, so
 * the in-app sound switch, the volume slider, the limiter and the device mute
 * switch all apply exactly as they do to the recorded move cues.
 *
 * Returns a disposer that stops any voices still scheduled/playing.
 */
export function playMoveEffectSound({ offsetSec = 0, rate = 1, cue = null, landingMs = 0 } = {}) {
  if (!enabled || !cue) return () => {};
  const c = audio();
  if (!c) return () => {};

  const speed = 1 / Math.max(0.05, rate);
  const stopped = [];
  const startAt = c.currentTime + Math.max(0, offsetSec);
  const fromLanding = (ms) => startAt + ((landingMs + ms) / 1000) * speed;
  const cueGain = cue.gainScale || 1;

  const build = () => {
    const peak = (cue.thud?.gain || 0.5) * volume * cueGain;

    /* 1. thud */
    if (cue.thud) {
      const at = fromLanding(cue.thud.at);
      const dur = cue.thud.durationMs / 1000 * speed;
      if (peak > 0.0001) {
        const osc = c.createOscillator();
        const g = c.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(cue.thud.fromHz, at);
        osc.frequency.exponentialRampToValueAtTime(cue.thud.toHz, at + dur);
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(peak, at + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
        osc.connect(g).connect(outputBus(c));
        osc.start(at);
        osc.stop(at + dur + 0.03);
        stopped.push(osc);
      }
    }

    /* 2. swell */
    const swell = cue.swell;
    if (swell && volume > 0) {
      const swellStart = fromLanding(swell.at);
      const end = swellStart + (swell.durationMs / 1000) * speed;
      const gainScale = (swell.gain || 0.34) * volume * cueGain;

      swell.harmonics.forEach((harmGain, index) => {
        const mult = index + 1;
        const osc = c.createOscillator();
        const g = c.createGain();
        osc.type = 'sine';

        /* frequency envelope, relative to the swell start */
        const freq = osc.frequency;
        const keys = Array.isArray(swell.freqKeys) && swell.freqKeys.length
          ? swell.freqKeys
          : [[0, 41], [swell.durationMs, 36]];
        freq.setValueAtTime(keys[0][1] * mult, swellStart);
        for (let i = 1; i < keys.length; i += 1) {
          const [ms, hz] = keys[i];
          const at = swellStart + (ms / 1000) * speed;
          freq.exponentialRampToValueAtTime(Math.max(1, hz * mult), at);
        }

        /* gain envelope, relative to the landing moment (L) */
        const gains = Array.isArray(swell.gainKeys) && swell.gainKeys.length
          ? swell.gainKeys
          : [[swell.at, 0], [swell.at + swell.durationMs, 0]];
        const first = gains[0];
        g.gain.setValueAtTime(
          Math.max(0.0001, first[1] * harmGain * gainScale),
          fromLanding(first[0]),
        );
        for (let i = 1; i < gains.length; i += 1) {
          const [ms, value] = gains[i];
          g.gain.linearRampToValueAtTime(
            Math.max(0.0001, value * harmGain * gainScale),
            fromLanding(ms),
          );
        }

        osc.connect(g).connect(outputBus(c));
        osc.start(swellStart);
        osc.stop(end + 0.03);
        stopped.push(osc);
      });
    }
  };

  if (c.state === 'suspended') {
    resumeCtx(c).then((running) => { if (running) build(); });
  } else {
    build();
  }

  return () => {
    for (const osc of stopped) {
      try { osc.stop(); } catch { /* already stopped */ }
    }
    stopped.length = 0;
  };
}