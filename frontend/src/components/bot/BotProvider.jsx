import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { MOODS, DEFAULT_MS } from "./botMoods";
import {
  BOT_LANG_KEY, BOT_STRINGS, DEFAULT_LANG, IDLE_ACTIVITIES, PAGE_AUTO, PAGE_ENTRY,
  pageKeyFor, readLang, translate, writeLang,
} from "./botI18n";

const Ctx = createContext(null);
const KEY = "mz_bot_hidden";
const MIN_GAP_MS = 1500;      // two real events never fire closer than this
const REAL_QUIET_MS = 5000;   // auto/page lines stay off this long after a real event
const AUTO_GAP_MS = 5000;     // never cut a bubble short to show an automatic line
const AUTO_EVERY_MS = 15000;  // idle reaction cadence
const ENTRY_DELAY_MS = 800;   // let the page paint before the greeting

const readHidden = () => {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
};
const writeHidden = (on) => {
  try {
    if (on) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch { /* private mode: preference just won't persist */ }
};

/** Fire a reaction from ANYWHERE (axios interceptors, socket handlers, plain JS):
 *  botReact("sad", "puzzleWrong") — the message is a key from botI18n.js.
 *  `params` fills {placeholders}; `force` skips the real-event throttle. */
export const botReact = (mood, msg, ms, params, force) =>
  window.dispatchEvent(new CustomEvent("bot:react", { detail: { mood, msg, ms, params, force } }));

export function BotProvider({ children }) {
  const { pathname } = useLocation();
  const [mood, setMood] = useState("neutral");
  const [msgKey, setMsgKey] = useState("");
  const [msgParams, setMsgParams] = useState(null);
  const [visible, setVisible] = useState(() => !readHidden());
  const [mounted, setMounted] = useState(false);
  const [lang, setLangState] = useState(readLang);
  const timer = useRef();
  const lastRealAt = useRef(0);
  const lastAnyAt = useRef(0);
  const lastAutoKey = useRef("");
  const pageRef = useRef(null);

  const apply = useCallback((m, key, ms = DEFAULT_MS, params = null) => {
    clearTimeout(timer.current);
    setMood(m);
    setMsgKey(key ?? "");
    setMsgParams(params);
    if (m !== "neutral") {
      timer.current = setTimeout(() => {
        setMood("neutral");
        setMsgKey("");
        setMsgParams(null);
      }, ms);
    }
  }, []);

  /* Real app events. They own the stage: accepted even mid automatic line,
     throttled only against each other. `force` is reserved for the user's own
     gesture on the bot, which must respond no matter what just played. */
  const react = useCallback((m = "neutral", key, ms = DEFAULT_MS, params = null, force = false) => {
    if (!MOODS[m]) return;
    const now = Date.now();
    if (!force && now - lastRealAt.current < MIN_GAP_MS) return;
    lastRealAt.current = now;
    lastAnyAt.current = now;
    apply(m, key, ms, params);
  }, [apply]);

  /* Automatic lines (page entry + idle cadence). Never trample a real event,
     never restart a message that is still readable. */
  const autoReact = useCallback((m, key, ms = DEFAULT_MS, gap = AUTO_GAP_MS) => {
    if (!MOODS[m] || !key) return;
    if (document.hidden) return;
    const now = Date.now();
    if (now - lastRealAt.current < REAL_QUIET_MS) return;
    if (now - lastAnyAt.current < gap) return;
    lastAnyAt.current = now;
    lastAutoKey.current = key;
    apply(m, key, ms);
  }, [apply]);

  const t = useCallback((key, params) => translate(lang, key, params), [lang]);

  const setLang = useCallback((next) => {
    if (!BOT_STRINGS[next]) return;
    writeLang(next);
    setLangState(next);
  }, []);

  useEffect(() => {
    const on = (e) => react(e.detail?.mood, e.detail?.msg, e.detail?.ms, e.detail?.params, e.detail?.force);
    const onStorage = (e) => {
      if (e.key === KEY || e.key === null) setVisible(!readHidden());
      if (e.key === BOT_LANG_KEY || e.key === null) setLangState(readLang());
    };
    window.addEventListener("bot:react", on);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("bot:react", on);
      window.removeEventListener("storage", onStorage);
      clearTimeout(timer.current);
    };
  }, [react]);

  /* Page-entry line. Fires once per page key, never on re-renders, and only
     once the overlay actually exists (mounted) and the player can see it. */
  useEffect(() => {
    if (!visible || !mounted) return undefined;
    const page = pageKeyFor(pathname);
    if (pageRef.current === page) return undefined;
    const line = PAGE_ENTRY[page];
    const id = setTimeout(() => {
      pageRef.current = page;
      /* A route greeting may follow closely on the heels of the previous page,
         so it uses a short gap; it still yields to real app events. */
      if (line) autoReact(line.mood, line.key, 3800, 1200);
    }, ENTRY_DELAY_MS);
    return () => clearTimeout(id);
  }, [pathname, visible, mounted, autoReact]);

  /* One managed idle timer for the whole app. Restarts only when visibility or
     mounting changes, never on a render; paused while the tab is hidden. */
  useEffect(() => {
    if (!visible || !mounted) return undefined;
    let id = 0;
    const tick = () => {
      if (!document.hidden) {
        const page = pageKeyFor(pathname);
        const pageLines = PAGE_AUTO[page] || PAGE_AUTO.academy;
        const usePage = Math.random() < 0.7;
        let line = usePage
          ? pageLines[Math.floor(Math.random() * pageLines.length)]
          : IDLE_ACTIVITIES[Math.floor(Math.random() * IDLE_ACTIVITIES.length)];
        if (line.key === lastAutoKey.current && usePage && pageLines.length > 1) {
          line = pageLines.find((l) => l.key !== lastAutoKey.current);
        }
        autoReact(line.mood, line.key, 3800);
      }
      id = window.setTimeout(tick, AUTO_EVERY_MS);
    };
    id = window.setTimeout(tick, AUTO_EVERY_MS);
    /* Returning to the tab starts a fresh 15 s, so the first line is not
       burned the instant the window regains focus. */
    const onVisible = () => {
      if (document.hidden) return;
      clearTimeout(id);
      id = window.setTimeout(tick, AUTO_EVERY_MS);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [visible, mounted, autoReact, pathname]);

  const hide = useCallback(() => {
    writeHidden(true);
    setVisible(false);
    clearTimeout(timer.current);
    setMood("neutral");
    setMsgKey("");
    setMsgParams(null);
  }, []);
  const show = useCallback(() => { writeHidden(false); setVisible(true); }, []);

  const msg = msgKey ? t(msgKey, msgParams) : "";

  const value = useMemo(
    () => ({
      mood, msg, visible, lang: lang || DEFAULT_LANG, react, hide, show,
      setLang, t, mounted, setMounted,
    }),
    [mood, msg, visible, lang, react, hide, show, setLang, t, mounted]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useBot = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useBot must be used inside <BotProvider>");
  return v;
};
