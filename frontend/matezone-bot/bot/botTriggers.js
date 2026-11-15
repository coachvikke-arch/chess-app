import { useEffect } from "react";
import { useBot } from "./BotContext.jsx";
import { MOOD_MS } from "./botConfig";

const CRY_BUBBLE_MS = 5200;

// 1. Game result. Call when a game ends. result is "win", "loss" or "draw".
// extra: { gameId, ratingChange } — the rating number arrives a moment later,
// so it is passed on a second call with result "cry" when the drop is heavy.
export function useGameResultBot() {
  const { showBotFrom, userRole, userId } = useBot();
  return (result, extra = {}) => {
    if (userRole !== "student") return;
    const streakKey = `mz-bot-loss-streak-${userId || "student"}`;
    const cryKey = extra.gameId ? `mz-bot-cry-${extra.gameId}` : undefined;

    if (result === "win") {
      localStorage.setItem(streakKey, "0");
      (async () => {
        await showBotFrom("win", "jump", {}, { duration: MOOD_MS.jump + 300 });
        await showBotFrom("win", "happy", {});
      })();
      return;
    }

    if (result === "draw") {
      localStorage.setItem(streakKey, "0");
      showBotFrom("draw", "neutral", {});
      return;
    }

    if (result === "loss") {
      const losses = (Number(localStorage.getItem(streakKey)) || 0) + 1;
      localStorage.setItem(streakKey, String(losses));
      const bigDrop = Number(extra.ratingChange) <= -15;
      (async () => {
        await showBotFrom("loss", "sad", {}, { duration: 3000 });
        if (losses >= 3 || bigDrop) {
          await showBotFrom("cry", "cry", {}, { duration: CRY_BUBBLE_MS, key: cryKey });
        }
      })();
      return;
    }

    if (result === "cry") {
      showBotFrom("cry", "cry", {}, { duration: CRY_BUBBLE_MS, key: cryKey });
    }
  };
}

// 2. Login. Call once after login with the values returned by the backend.
// missedDays = whole days since the last login (0 if logged in yesterday or today first time).
export function showLoginBot(bot, { streak = 1, missedDays = 0, name = '', role = '', userId = '' }) {
  if (role !== 'student' || !bot) return;
  const key = `mz-bot-login-${userId || 'student'}-${new Date().toDateString()}`;
  if (sessionStorage.getItem(key)) return;
  sessionStorage.setItem(key, "1");

  const show = (group, mood, vars, opts) => bot.showBotFrom(group, mood, { name, ...vars }, opts);

  (async () => {
    if (missedDays > 0) {
      await show("missedDay", "sad", {}, { duration: 3200 });
      await show("login", "wave", {}, { duration: 2800 });
      return;
    }
    if (streak >= 3) {
      await show("blessing", "blessing", { streak }, { duration: MOOD_MS.blessing + 400 });
      await show("loginStreak", "happy", { streak }, {});
      return;
    }
    await show("login", "wave", {}, { duration: 2800 });
    if (streak > 1) await show("loginStreak", "happy", { streak }, {});
  })();
}

// 3. Class reminders. classes = [{ id, name, startsAt (ISO string or Date), onOpen }]
export function useClassReminders(classes) {
  const { showBotFrom } = useBot();
  useEffect(() => {
    if (!classes || !classes.length) return undefined;
    const check = () => {
      const now = Date.now();
      classes.forEach((c) => {
        const mins = (new Date(c.startsAt).getTime() - now) / 60000;
        const time = new Date(c.startsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        [[30, "classReminder30"], [5, "classReminder5"]].forEach(([limit, group]) => {
          const k = `mz-bot-${group}-${c.id}`;
          if (mins > 0 && mins <= limit && !sessionStorage.getItem(k)) {
            sessionStorage.setItem(k, "1");
            const vars = { class: c.name, time };
            // Alert first, then a short flight to the edge of the screen, so the
            // reminder is impossible to miss without covering the page.
            showBotFrom(group, "alert", vars, { onClick: c.onOpen, duration: 1800, key: `${k}-alert` })
              .then(() => showBotFrom(group, "fly", vars, {
                onClick: c.onOpen, duration: 6000, key: `${k}-fly`, flyToEdge: true,
              }));
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
  bot.showBotFrom("chatFirstMessage", "alert", {}, { duration: 3600 });
}
