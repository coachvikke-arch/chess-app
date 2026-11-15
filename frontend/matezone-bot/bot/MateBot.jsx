import { useEffect, useRef, useState } from "react";
import { faceFor, runMood, playLanding, blink, dartEyes } from "./botMotion";
import { moodImages, normalizeMood, MOOD_MS, PNG_FALLBACK } from "./botConfig";
import bodyUrl from "./img/layers/body.png";
import headUrl from "./img/layers/head.png";
import handLUrl from "./img/layers/handL.png";
import handRUrl from "./img/layers/handR.png";
import sleeveLUrl from "./img/layers/sleeveL.png";
import sleeveRUrl from "./img/layers/sleeveR.png";
import coverLUrl from "./img/layers/coverL.png";
import coverRUrl from "./img/layers/coverR.png";

const LAYERS = [
  bodyUrl, headUrl, handLUrl, handRUrl,
  sleeveLUrl, sleeveRUrl, coverLUrl, coverRUrl,
];

const SPARKLES = [[36, 64], [300, 58], [70, 160], [286, 150], [120, 22], [222, 26], [46, 242], [298, 238]];
const CONFETTI = ["#ffb347", "#7fd3ee", "#ff9bb3", "#fff3a8", "#4a7be8"];
const DUST = [[140, 350], [172, 352], [202, 349], [156, 355], [186, 351]];
const FIRE = [82, 227];

/* Idle pages get one quiet reaction every 20s. A real mood always wins. */
const AUTO_MOODS = ["happy", "jump", "blessing", "wave"];
const AUTO_EVERY_MS = 20000;

function usePrefersReducedMotion() {
  const [reduce, setReduce] = useState(() =>
    typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false
  );
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduce(media.matches);
    if (media.addEventListener) media.addEventListener("change", onChange);
    else media.addListener(onChange);
    return () => {
      if (media.removeEventListener) media.removeEventListener("change", onChange);
      else media.removeListener(onChange);
    };
  }, []);
  return reduce;
}

/* All eight layers are decoded before the first animated frame, so the swap
   from the flat PNG never shows a half-built character. Any failure keeps the
   PNG, exactly as the old renderer did. */
function useLayersReady() {
  const [state, setState] = useState("loading");
  useEffect(() => {
    let alive = true;
    Promise.all(LAYERS.map((src) => {
      const img = new Image();
      img.src = src;
      if (img.decode) return img.decode();
      return new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });
    })).then(
      () => alive && setState("ready"),
      () => alive && setState("failed")
    );
    return () => { alive = false; };
  }, []);
  return state;
}

function Eye({ cx, cy }) {
  return (
    <g transform={`translate(${cx} ${cy})`}>
      <g className="mzf-eye mzf-eye-open">
        <circle r="22" fill="#360072" />
        <circle r="17" fill="#ffffff" />
        <g className="mzf-iris">
          <g className="mzf-dart">
            <circle r="14.5" fill="#3a1170" />
            <ellipse cy="8.2" rx="9.5" ry="4.5" fill="#8a6cc4" opacity=".55" />
            <circle cx="-4.6" cy="-5.2" r="4.5" fill="#ffffff" />
            <circle cx="4.2" cy="2.6" r="2.1" fill="#ffffff" opacity=".85" />
          </g>
        </g>
      </g>
      <path
        className="mzf-eye mzf-eye-happy"
        d="M-14 3 Q0 -11 14 3"
        fill="none"
        stroke="#360072"
        strokeWidth="7"
        strokeLinecap="round"
      />
      <path
        className="mzf-eye mzf-eye-calm"
        d="M-14 0 Q0 8 14 0"
        fill="none"
        stroke="#360072"
        strokeWidth="6"
        strokeLinecap="round"
      />
    </g>
  );
}

export default function MateBot({ mood: rawMood = "idle", look = 0, flying = false }) {
  const mood = normalizeMood(rawMood);
  const reduce = usePrefersReducedMotion();
  const layerState = useLayersReady();
  const ready = layerState === "ready";

  const poseRef = useRef(null);
  const tiltRef = useRef(null);
  const headRef = useRef(null);
  const armLRef = useRef(null);
  const armRRef = useRef(null);
  const wristLRef = useRef(null);
  const wristRRef = useRef(null);
  const shadowRef = useRef(null);
  const puddleRef = useRef(null);
  const glowRef = useRef(null);
  const flamesRef = useRef(null);
  const fxRef = useRef(null);
  const faceRef = useRef(null);
  const wasFlying = useRef(false);

  const [autoMood, setAutoMood] = useState("idle");
  const shownMood = mood === "idle" ? autoMood : mood;
  const face = faceFor(shownMood);

  const stage = () => ({
    pose: poseRef.current,
    tilt: tiltRef.current,
    head: headRef.current,
    armL: armLRef.current,
    armR: armRRef.current,
    wristL: wristLRef.current,
    wristR: wristRRef.current,
    shadow: shadowRef.current,
    puddle: puddleRef.current,
    glow: glowRef.current,
    flames: flamesRef.current,
    fx: fxRef.current,
  });

  useEffect(() => {
    if (!ready || reduce) return undefined;
    return runMood(stage(), shownMood);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, reduce, shownMood]);

  /* One quiet reaction every 20 seconds keeps a resting page alive. */
  useEffect(() => {
    if (reduce || !ready) return undefined;
    let timer;
    const schedule = () => {
      timer = window.setTimeout(() => {
        if (!document.hidden && mood === "idle") {
          setAutoMood((current) => current === "idle"
            ? AUTO_MOODS[Math.floor(Math.random() * AUTO_MOODS.length)]
            : current);
        }
        schedule();
      }, AUTO_EVERY_MS);
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, [reduce, ready, mood]);

  useEffect(() => {
    if (autoMood === "idle") return undefined;
    const t = window.setTimeout(() => setAutoMood("idle"), MOOD_MS[autoMood] || 2200);
    return () => window.clearTimeout(t);
  }, [autoMood]);

  useEffect(() => {
    if (mood !== "idle") setAutoMood("idle");
  }, [mood]);

  const isFlying = Boolean(flying || mood === "fly");
  useEffect(() => {
    const previous = wasFlying.current;
    wasFlying.current = isFlying;
    if (previous && !isFlying && ready && !reduce) playLanding(stage());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFlying, ready, reduce]);

  /* Blinks are the life that makes a still pose read as alive. They are
     skipped while the eyes are already shut. */
  useEffect(() => {
    if (!ready || face.eyes !== "open") return undefined;
    let timer;
    const schedule = () => {
      timer = window.setTimeout(() => {
        if (!document.hidden) blink(faceRef.current);
        schedule();
      }, 3000 + Math.random() * 3000);
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, [ready, face.eyes]);

  useEffect(() => {
    if (!ready || reduce || face.eyes !== "open") return undefined;
    let timer;
    const schedule = () => {
      timer = window.setTimeout(() => {
        if (!document.hidden) {
          const x = Math.round((Math.random() - 0.5) * 8);
          const y = Math.round((Math.random() - 0.5) * 4);
          dartEyes(faceRef.current, x, y);
        }
        schedule();
      }, 2600 + Math.random() * 2400);
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, [ready, reduce, face.eyes]);

  return (
    <div className="mzb-stage" data-mood={shownMood} data-animated={ready ? "true" : "false"}>
      {ready ? (
        <>
          <div className="mzb-shadow" ref={shadowRef} />
          <div className="mzb-puddle" ref={puddleRef} />
          <div className="mzb-float">
            <div className="mzb-pose" ref={poseRef}>
              <div className="mzb-breathe">
                <div className="mzb-tilt" ref={tiltRef}>
                <div className="mzb-glow" ref={glowRef} />
                <img className="mzb-layer" src={bodyUrl} alt="" draggable="false" />
                <div className="mzb-head" ref={headRef}>
                  <div className="mzb-head-idle">
                    <img className="mzb-layer" src={headUrl} alt="" draggable="false" />
                    <svg
                      className="mzb-face"
                      viewBox="0 0 341 360"
                      aria-hidden="true"
                      focusable="false"
                      ref={faceRef}
                      data-eyes={face.eyes}
                      data-mouth={face.mouth}
                      data-brows={face.brows}
                      data-tears={face.tears ? "true" : "false"}
                      style={{ "--mzf-look": `${look * 4}px` }}
                    >
                      <Eye cx={108} cy={93} />
                      <Eye cx={207} cy={110} />

                      <g className="mzf-brow mzf-brow-l">
                        <path
                          d="M106 57 Q122 44 138 54"
                          fill="none"
                          stroke="#360072"
                          strokeWidth="9"
                          strokeLinecap="round"
                        />
                      </g>
                      <g className="mzf-brow mzf-brow-r">
                        <path
                          d="M205 74 Q221 60 238 79"
                          fill="none"
                          stroke="#360072"
                          strokeWidth="9"
                          strokeLinecap="round"
                        />
                      </g>

                      <g className="mzf-mouth mzf-mouth-smile">
                        <path d="M136 121 Q157 125 178 121 Q180 138 157 149 Q134 138 136 121 Z" fill="#2b0b5c" />
                        <ellipse cx="157" cy="142" rx="10.5" ry="5.5" fill="#ff4d81" />
                      </g>
                      <g className="mzf-mouth mzf-mouth-happy">
                        <path d="M134 118 Q157 122 180 118 Q183 139 157 153 Q131 139 134 118 Z" fill="#2b0b5c" />
                        <ellipse cx="157" cy="145" rx="11.5" ry="6.5" fill="#ff4d81" />
                      </g>
                      <g className="mzf-mouth mzf-mouth-frown">
                        <path
                          d="M141 140 Q157 123 173 140"
                          fill="none"
                          stroke="#360072"
                          strokeWidth="6"
                          strokeLinecap="round"
                        />
                      </g>
                      <g className="mzf-mouth mzf-mouth-o">
                        <ellipse cx="157" cy="132" rx="10.5" ry="12.5" fill="#2b0b5c" stroke="#360072" strokeWidth="4.5" />
                        <ellipse cx="157" cy="139" rx="5.5" ry="3.5" fill="#ff4d81" />
                      </g>
                      <g className="mzf-mouth mzf-mouth-flat">
                        <path d="M143 133 L171 133" fill="none" stroke="#360072" strokeWidth="6" strokeLinecap="round" />
                      </g>
                      <g className="mzf-mouth mzf-mouth-calm">
                        <path
                          d="M144 131 Q157 138 170 131"
                          fill="none"
                          stroke="#360072"
                          strokeWidth="5"
                          strokeLinecap="round"
                        />
                      </g>

                      <g className="mzf-tear mzf-tear-l" transform="translate(96 116)">
                        <g className="mzf-tear-drop">
                          <path d="M0 0 C-4 6 -5 10 0 13 C5 10 4 6 0 0 Z" fill="#9fe8f4" stroke="#360072" strokeWidth="1.6" />
                        </g>
                      </g>
                      <g className="mzf-tear mzf-tear-r" transform="translate(219 133)">
                        <g className="mzf-tear-drop">
                          <path d="M0 0 C-4 6 -5 10 0 13 C5 10 4 6 0 0 Z" fill="#9fe8f4" stroke="#360072" strokeWidth="1.6" />
                        </g>
                      </g>
                    </svg>
                  </div>
                </div>
                <div className="mzb-arm mzb-arm-l" ref={armLRef}>
                  <div className="mzb-arm-idle">
                    <div className="mzb-wrist mzb-wrist-l" ref={wristLRef}>
                      <div className="mzb-wrist-idle">
                        <img className="mzb-layer" src={handLUrl} alt="" draggable="false" />
                      </div>
                    </div>
                    <img className="mzb-layer" src={sleeveLUrl} alt="" draggable="false" />
                  </div>
                </div>
                <div className="mzb-arm mzb-arm-r" ref={armRRef}>
                  <div className="mzb-arm-idle">
                    <div className="mzb-wrist mzb-wrist-r" ref={wristRRef}>
                      <div className="mzb-wrist-idle">
                        <img className="mzb-layer" src={handRUrl} alt="" draggable="false" />
                      </div>
                    </div>
                    <img className="mzb-layer" src={sleeveRUrl} alt="" draggable="false" />
                  </div>
                </div>
                <img className="mzb-layer" src={coverLUrl} alt="" draggable="false" />
                <img className="mzb-layer" src={coverRUrl} alt="" draggable="false" />
                <svg className="mzb-flames" viewBox="0 0 341 360" aria-hidden="true" focusable="false" ref={flamesRef}>
                  {FIRE.map((x, i) => (
                    <g key={x} transform={`translate(${x} 338)`}>
                      <ellipse cy="4" rx="26" ry="12" fill="#ffb347" opacity=".3" />
                      <path
                        className={`mzb-flame${i ? " mzb-flame-b" : ""}`}
                        d="M0 0 C-20 10 -21 32 0 58 C21 32 20 10 0 0 Z"
                        fill="#ffb347"
                        stroke="#e07b1f"
                        strokeWidth="1.5"
                        strokeLinejoin="round"
                      />
                      <path className="mzb-flame-core" d="M0 8 C-11 17 -12 34 0 48 C12 34 11 17 0 8 Z" fill="#fff3a8" />
                    </g>
                  ))}
                </svg>
              </div>
            </div>
          </div>
        </div>
          <svg className="mzb-fx" viewBox="0 0 341 360" aria-hidden="true" focusable="false" ref={fxRef}>
            <g id="fx-sparkles" className="mzb-fx-layer">
              {SPARKLES.map(([x, y], i) => (
                <g key={i} transform={`translate(${x} ${y})`}>
                  <path
                    d="M0 -8 L2.2 -2.2 L8 0 L2.2 2.2 L0 8 L-2.2 2.2 L-8 0 L-2.2 -2.2 Z"
                    fill="#fff3a8"
                    stroke="#2b1f86"
                    strokeWidth="1.2"
                  />
                </g>
              ))}
            </g>
            <g id="fx-confetti" className="mzb-fx-layer">
              {Array.from({ length: 14 }, (_, i) => (
                <g key={i} transform={`translate(${64 + (i % 7) * 34} ${20 + Math.floor(i / 7) * 10})`}>
                  <rect x="-4" y="-3" width="8" height="6" rx="1.5" fill={CONFETTI[i % CONFETTI.length]} />
                </g>
              ))}
            </g>
            <g id="fx-dust" className="mzb-fx-layer">
              {DUST.map(([x, y], i) => (
                <g key={i} transform={`translate(${x} ${y})`}>
                  <circle r="6" fill="#f4f1e6" stroke="#c9c3b2" strokeWidth="1.5" />
                </g>
              ))}
            </g>
          </svg>
        </>
      ) : (
        <img className="mzb-png" src={moodImages[mood] || PNG_FALLBACK} alt="" draggable="false" />
      )}
    </div>
  );
}
