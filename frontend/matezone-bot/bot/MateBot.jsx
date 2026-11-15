import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  getArtwork, PART_ORIGINS, STAGE_ORIGIN,
  applyFace, runMood, playLanding, blink, dartEyes,
} from "./botMotion";
import { moodImages, normalizeMood, MOOD_MS, PNG_FALLBACK } from "./botConfig";

const artwork = getArtwork();

const SPARKLES = [[36, 64], [300, 58], [70, 160], [286, 150], [120, 22], [222, 26]];
const CONFETTI = ["#ffb347", "#7fd3ee", "#ff9bb3", "#fff3a8", "#4a7be8"];
const DUST = [[140, 350], [172, 352], [202, 349], [156, 355], [186, 351]];
const FIRE = [82, 226];
const SMOKE = [[82, 378], [68, 366], [96, 366], [226, 378], [212, 366], [240, 366]];

/* Idle pages get one of these little reactions on their own every 20s. */
const AUTO_MOODS = ["happy", "jump", "blessing", "wave"];
const AUTO_EVERY_MS = 20000;

const EYES_SHUT_MOODS = new Set(["sad", "cry", "blessing"]);

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

export default function MateBot({ mood: rawMood = "idle", look = 0, flying = false }) {
  const mood = normalizeMood(rawMood);
  const reduce = usePrefersReducedMotion();
  const hostRef = useRef(null);
  const fxRef = useRef(null);
  const actRef = useRef(null);
  const shellRef = useRef(null);
  const svgRef = useRef(null);
  const wasFlying = useRef(false);
  const [autoMood, setAutoMood] = useState("idle");
  const shownMood = mood === "idle" ? autoMood : mood;

  useLayoutEffect(() => {
    if (!artwork.ok || !hostRef.current) return;
    const svg = hostRef.current.querySelector("svg");
    if (!svg) return;
    Object.entries(PART_ORIGINS).forEach(([id, origin]) => {
      const part = svg.querySelector(`#${id}`);
      if (!part) return;
      part.style.transformBox = "view-box";
      part.style.transformOrigin = origin;
    });
    svgRef.current = svg;
  }, []);

  const stage = () => ({
    art: svgRef.current,
    fx: fxRef.current,
    act: actRef.current,
    shell: shellRef.current,
  });

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return undefined;
    applyFace(svg, shownMood, look);
    if (reduce) return undefined;
    return runMood(stage(), shownMood);
    // look is applied separately so a bubble moving never restarts a mood.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownMood, reduce, artwork.ok]);

  useEffect(() => {
    if (svgRef.current) applyFace(svgRef.current, shownMood, look);
  }, [look, shownMood]);

  /* One quiet reaction every 20 seconds keeps a resting page alive. A real
     mood always wins, and the celebration steps aside as soon as one starts. */
  useEffect(() => {
    if (reduce) return undefined;
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
  }, [reduce, mood]);

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
    if (previous && !isFlying && !reduce) playLanding(stage());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFlying, reduce]);

  /* Blinks and pupil darts are the life that makes the idle pose read as alive.
     They are skipped while the face is already shut or the tab is hidden. */
  useEffect(() => {
    if (!artwork.ok || reduce || EYES_SHUT_MOODS.has(shownMood)) return undefined;
    let timer;
    const schedule = () => {
      timer = window.setTimeout(() => {
        if (!document.hidden && svgRef.current) blink(svgRef.current);
        schedule();
      }, 3000 + Math.random() * 3000);
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, [shownMood, reduce]);

  useEffect(() => {
    if (!artwork.ok || reduce) return undefined;
    let timer;
    const schedule = () => {
      timer = window.setTimeout(() => {
        if (!document.hidden && svgRef.current) {
          const x = Math.round((Math.random() - 0.5) * 8);
          const y = Math.round((Math.random() - 0.5) * 4);
          dartEyes(svgRef.current, x, y);
        }
        schedule();
      }, 2600 + Math.random() * 2400);
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, [shownMood, reduce]);

  return (
    <div className="mzb-bob" data-flying={isFlying ? "true" : undefined} data-animated={artwork.ok ? "true" : "false"}>
      <div className="mzb-lift">
        <div className="mzb-act" ref={actRef} style={{ transformOrigin: STAGE_ORIGIN }}>
          <div className="mzb-shell" ref={shellRef}>
            {artwork.ok ? (
              <div
                className="mzb-svg-host"
                ref={hostRef}
                dangerouslySetInnerHTML={{ __html: artwork.markup }}
              />
            ) : (
              <img
                className="mzb-png"
                src={moodImages[mood] || PNG_FALLBACK}
                alt=""
                draggable="false"
              />
            )}
          </div>
          <svg className="mzb-fx" viewBox="0 0 340 370" aria-hidden="true" ref={fxRef}>
            <g id="fx-fire" className="mzb-fx-layer">
              {SMOKE.map(([x, y], i) => (
                <g key={`smoke-${i}`} transform={`translate(${x} ${y})`}>
                  <circle r="13" fill="#cfd6df" />
                </g>
              ))}
              {FIRE.map((x, i) => (
                <g key={`flame-${i}`} transform={`translate(${x} 344)`}>
                  <g>
                    <ellipse cx="0" cy="4" rx="34" ry="16" fill="#ffb347" opacity=".32" />
                    <path
                      d="M0 0 C-27 12 -29 44 0 80 C29 44 27 12 0 0 Z"
                      fill="#ffb347"
                      stroke="#e07b1f"
                      strokeWidth="1.5"
                      strokeLinejoin="round"
                    />
                    <path d="M0 9 C-15 21 -16 44 0 62 C16 44 15 21 0 9 Z" fill="#fff3a8" />
                  </g>
                </g>
              ))}
            </g>
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
        </div>
      </div>
    </div>
  );
}
