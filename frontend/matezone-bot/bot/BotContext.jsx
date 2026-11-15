import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { botMessages } from "./botMessages";
import { BUBBLE_MS, MOOD_MS, normalizeMood } from "./botConfig";

const BotCtx = createContext(null);
export const useBot = () => useContext(BotCtx);

const fill = (text, vars = {}) => text.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? vars[k] : ""));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/* A bubble should stay up long enough to read, and long enough for its mood
   animation to finish, so emotion changes never cut each other off. */
const displayMs = (mood, opts = {}) => {
  if (opts.duration) return opts.duration;
  const anim = MOOD_MS[normalizeMood(mood)] || 0;
  return anim ? Math.max(anim + 600, 3600) : BUBBLE_MS;
};

export function BotProvider({ userId = "", userRole = "", firstName = "", children }) {
  const enabledKey = `mz-bot-enabled-${userId}`;
  const [enabled, setEnabledState] = useState(() => localStorage.getItem(enabledKey) !== "off");
  const [suppressed, setSuppressed] = useState(false); // set true while a game is being played
  const [current, setCurrent] = useState(null);
  const queue = useRef([]);
  const showing = useRef(null); // the item currently on screen, with its resolver
  const timer = useRef(null);

  // Auth can replace a cached identity with the guest identity after mount
  // (for example, when /login discovers there is no valid token). Read the
  // preference for the new identity so a previous user's disabled setting
  // does not keep the shared bot hidden on public pages.
  useEffect(() => {
    setEnabledState(localStorage.getItem(enabledKey) !== "off");
  }, [enabledKey]);

  const setEnabled = (on) => {
    localStorage.setItem(enabledKey, on ? "on" : "off");
    setEnabledState(on);
  };

  /* Resolve the finished item, then play the next one. Every showBot() call
     returns a promise that settles here, which is what lets trigger code write
     readable sequences ("jump, then happy") without overlapping animations. */
  const next = useCallback(() => {
    clearTimeout(timer.current);
    const done = showing.current;
    showing.current = null;
    setCurrent(null);
    if (done?.resolve) done.resolve(true);

    const item = queue.current.shift() || null;
    if (!item) return;
    showing.current = item;
    setCurrent(item);
    timer.current = setTimeout(next, item.duration || displayMs(item.mood));
  }, []);

  // showBot("happy", "text", { onClick, key, duration }) → Promise<boolean>
  const showBot = useCallback((mood, message, opts = {}) => {
    const key = opts.key;
    if (key && (showing.current?.key === key || queue.current.some((q) => q.key === key))) {
      return Promise.resolve(false);
    }
    return new Promise((resolve) => {
      queue.current.push({
        ...opts,
        key,
        mood: normalizeMood(mood),
        message,
        id: `${Date.now()}-${Math.random()}`,
        resolve,
      });
      if (!showing.current) next();
    });
  }, [next]);

  // showBotFrom("win", "happy", { name, streak }) picks a random sentence from botMessages
  const showBotFrom = useCallback((group, mood, vars = {}, opts = {}) => {
    const list = botMessages[group];
    if (!list) return Promise.resolve(false);
    return showBot(mood, fill(pick(list), { name: firstName, ...vars }), opts);
  }, [firstName, showBot]);

  const dismiss = useCallback(() => next(), [next]);

  /* When the window is hidden the bubble timers still run, so a returning tab
     can land on a message that has been "read" while nobody was looking. That
     matches the old behaviour and keeps queue arithmetic simple. */
  useEffect(() => () => clearTimeout(timer.current), []);

  const value = useMemo(
    () => ({
      enabled, authenticated: Boolean(userId), userId, userRole, setEnabled, suppressed,
      setSuppressed, current, showBot, showBotFrom, dismiss, firstName,
    }),
    [enabled, userId, userRole, suppressed, current, showBot, showBotFrom, dismiss, firstName]
  );
  return <BotCtx.Provider value={value}>{children}</BotCtx.Provider>;
}
