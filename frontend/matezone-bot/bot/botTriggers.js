import { useEffect } from "react";
import { useBot } from "./BotContext.jsx";

// 1. Game result. Call when a game ends. result is "win", "loss" or "draw".
export function useGameResultBot() {
  const { showBotFrom, userRole } = useBot();
  return (result) => {
    if (userRole !== 'student') return;
    const mood = { win: "happy", loss: "sad", draw: "neutral" }[result];
    if (mood) setTimeout(() => showBotFrom(result, mood), 1000);
  };
}

// 2. Login. Call once after login with the values returned by the backend.
// missedDays = whole days since the last login (0 if logged in yesterday or today first time).
export function showLoginBot(bot, { streak = 1, missedDays = 0, name = '', role = '', userId = '' }) {
  if (role !== 'student') return;
  const key = `mz-bot-login-${userId || 'student'}-${new Date().toDateString()}`;
  if (sessionStorage.getItem(key)) return;
  sessionStorage.setItem(key, "1");
  bot.showBotFrom("login", "calm", { name });
  if (missedDays > 0) bot.showBotFrom("missedDay", "sad", { name });
  else if (streak > 1) bot.showBotFrom("loginStreak", "happy", { streak, name });
}

// 3. Class reminders. classes = [{ id, name, startsAt (ISO string or Date), onOpen }]
export function useClassReminders(classes) {
  const { showBotFrom } = useBot();
  useEffect(() => {
    if (!classes || !classes.length) return;
    const check = () => {
      const now = Date.now();
      classes.forEach((c) => {
        const mins = (new Date(c.startsAt).getTime() - now) / 60000;
        const time = new Date(c.startsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        [[30, "classReminder30"], [5, "classReminder5"]].forEach(([limit, group]) => {
          const k = `mz-bot-${group}-${c.id}`;
          if (mins > 0 && mins <= limit && !sessionStorage.getItem(k)) {
            sessionStorage.setItem(k, "1");
            showBotFrom(group, "alert", { class: c.name, time }, { onClick: c.onOpen, duration: 8000 });
          }
        });
      });
    };
    check();
    const t = setInterval(check, 30000);
    return () => clearInterval(t);
  }, [classes, showBotFrom]);
}

// 4. Chat. Call when the user sends a message. Shows once per session.
export function showChatBot(bot) {
  if (bot?.userRole !== 'student') return;
  if (sessionStorage.getItem("mz-bot-chat")) return;
  sessionStorage.setItem("mz-bot-chat", "1");
  bot.showBotFrom("chatFirstMessage", "alert");
}
