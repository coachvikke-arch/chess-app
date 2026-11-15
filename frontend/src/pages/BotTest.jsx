import Bot from "../../matezone-bot/bot/Bot.jsx";
import { BotProvider, useBot } from "../../matezone-bot/bot/BotContext.jsx";
import { showLoginBot } from "../../matezone-bot/bot/botTriggers.js";
import { MOODS, MOOD_MS } from "../../matezone-bot/bot/botConfig";

const EMOTIONS = MOODS.map((mood) => [mood, mood[0].toUpperCase() + mood.slice(1)]);

const SENTENCE = {
  idle: "Idle life: float, breathe, blink, tiny tilt.",
  wave: "Hello there! Wave hello.",
  happy: "Happy: smile, bounce, sparkles.",
  jump: "Jump: squash, hop, land, confetti.",
  sad: "Sad: head down, slow breath.",
  cry: "Cry: tears, sob, puddle, wipe.",
  fly: "Fly: thrusters, flames, hover.",
  blessing: "Blessing: glows and wishes you well.",
  alert: "Alert: quick hop, big eyes.",
  neutral: "Neutral: flat mouth, one brow up.",
};

const box = { display: "flex", flexWrap: "wrap", gap: 8, margin: "12px 0" };
const btn = {
  border: "2px solid #0b2347", background: "#fff", color: "#0b2347", borderRadius: 8,
  padding: "8px 14px", font: "600 .9rem system-ui, sans-serif", cursor: "pointer",
};

function Panel() {
  const bot = useBot();
  if (!bot) return null;
  const { showBot, showBotFrom, userId, userRole } = bot;

  const play = (mood) => {
    const duration = Math.max((MOOD_MS[mood] || 0) + 600, 3000);
    showBot(mood, SENTENCE[mood] || mood, { duration });
  };

  const queueTest = async () => {
    await showBot("happy", "Queue 1 of 3: happy.", { duration: 2400 });
    await showBot("jump", "Queue 2 of 3: jump.", { duration: 3200 });
    await showBot("wave", "Queue 3 of 3: wave.", { duration: 2600 });
  };

  const resetLoginKey = () => {
    Object.keys(sessionStorage)
      .filter((k) => k.startsWith("mz-bot-login-"))
      .forEach((k) => sessionStorage.removeItem(k));
  };

  const loginCombo = () => {
    resetLoginKey();
    showLoginBot(bot, {
      role: "student", userId: userId || "bot-test", name: "Student",
      streak: 4, missedDays: 0,
    });
  };

  const missedDayCombo = () => {
    resetLoginKey();
    showLoginBot(bot, {
      role: "student", userId: userId || "bot-test", name: "Student",
      streak: 1, missedDays: 2,
    });
  };

  const reminderCombo = () => {
    const vars = { class: "Tactics Class", time: "4:30 PM" };
    showBotFrom("classReminder5", "alert", vars, { duration: 1800 })
      .then(() => showBotFrom("classReminder5", "fly", vars, { duration: 6000, flyToEdge: true }));
  };

  return (
    <div style={{ padding: 24, maxWidth: 760, font: "500 15px/1.5 system-ui, sans-serif", color: "#0b2347" }}>
      <h1 style={{ font: "700 22px system-ui, sans-serif", margin: "0 0 6px" }}>Bot animation test</h1>
      <p style={{ margin: "0 0 4px" }}>
        The bot in the corner is the real floating component. Drag it to see the flight and the
        soft landing, then use the buttons to play each emotion.
      </p>
      <p style={{ margin: 0, color: "#4a586b" }}>
        Role in this harness: <strong>{userRole || "guest"}</strong>. Reduced motion follows the OS
        setting: with it on, only faces and bubbles change.
      </p>

      <h2 style={{ font: "700 16px system-ui", marginTop: 20 }}>Emotions</h2>
      <div style={box}>
        {EMOTIONS.map(([mood, label]) => (
          <button key={mood} type="button" style={btn} onClick={() => play(mood)}>{label}</button>
        ))}
      </div>

      <h2 style={{ font: "700 16px system-ui", marginTop: 12 }}>Combos</h2>
      <div style={box}>
        <button type="button" style={btn} onClick={queueTest}>Queue test (3 in a row)</button>
        <button type="button" style={btn} onClick={loginCombo}>Login combo (streak 4)</button>
        <button type="button" style={btn} onClick={missedDayCombo}>Missed day combo</button>
        <button type="button" style={btn} onClick={reminderCombo}>Class reminder combo</button>
      </div>
    </div>
  );
}

/* Dev harness for the animation set. A signed-in student drives the real global
   bot; otherwise a local provider with a fake student identity mounts a second
   copy of the same Bot component, so drag, queue and reminders can be exercised
   without touching an account. */
export default function BotTest() {
  const outer = useBot();
  const isStudent = Boolean(outer?.authenticated && outer?.userRole === 'student');
  if (isStudent) return <Panel />;
  return (
    <BotProvider userId="bot-test" userRole="student" firstName="Student">
      <Panel />
      <Bot />
    </BotProvider>
  );
}
