import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { botMessages } from "./botMessages";
import { BUBBLE_MS } from "./botConfig";

const BotCtx = createContext(null);
export const useBot = () => useContext(BotCtx);

const fill = (text, vars = {}) => text.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? vars[k] : ""));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export function BotProvider({ userId = "", userRole = "", firstName = "", children }) {
  const enabledKey = `mz-bot-enabled-${userId}`;
  const [enabled, setEnabledState] = useState(() => localStorage.getItem(enabledKey) !== "off");
  const [suppressed, setSuppressed] = useState(false); // set true while a game is being played
  const [current, setCurrent] = useState(null);
  const queue = useRef([]);
  const timer = useRef(null);
  const showing = useRef(false);

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

  const next = useCallback(() => {
    clearTimeout(timer.current);
    const item = queue.current.shift() || null;
    showing.current = !!item;
    setCurrent(item);
    if (item) timer.current = setTimeout(next, item.duration || BUBBLE_MS);
  }, []);

  // showBot("happy", "text", { onClick, key, duration })
  const showBot = useCallback((mood, message, opts = {}) => {
    if (opts.key && queue.current.some((q) => q.key === opts.key)) return;
    queue.current.push({ mood, message, ...opts, id: Date.now() + Math.random() });
    if (!showing.current) next();
  }, [next]);

  // showBotFrom("win", { name, streak }) picks a random sentence from botMessages
  const showBotFrom = useCallback((group, mood, vars = {}, opts = {}) => {
    const list = botMessages[group];
    if (!list) return;
    showBot(mood, fill(pick(list), { name: firstName, ...vars }), opts);
  }, [firstName, showBot]);

  const dismiss = useCallback(() => next(), [next]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const value = useMemo(
    () => ({ enabled, authenticated: Boolean(userId), userRole, setEnabled, suppressed, setSuppressed, current, showBot, showBotFrom, dismiss, firstName }),
    [enabled, userId, userRole, suppressed, current, showBot, showBotFrom, dismiss, firstName]
  );
  return <BotCtx.Provider value={value}>{children}</BotCtx.Provider>;
}
