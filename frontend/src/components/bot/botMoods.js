// One place for mood names, default speech lines and how long a reaction lasts.
// `say` is only a fallback; live messages come from botI18n keys.
export const MOODS = {
  neutral:     { label: "Idle",        say: "" },
  happy:       { label: "Happy",       say: "Great job! 🎉" },
  sad:         { label: "Sad",         say: "Oh no… try again." },
  angry:       { label: "Angry",       say: "That's not right!" },
  scared:      { label: "Scared",      say: "Hurry — time is almost up!" },
  surprised:   { label: "Surprised",   say: "Whoa! Something new!" },
  disgusted:   { label: "Disgusted",   say: "Yuck! Something went wrong." },
  celebrating: { label: "Celebrating", say: "Let's celebrate!" },
  laughing:    { label: "Laughing",    say: "Hehe!" },
  thinking:    { label: "Thinking",    say: "Hmm…" },
  sleeping:    { label: "Sleeping",    say: "Zzz…" },
  waving:      { label: "Waving",      say: "Hello!" },
  dancing:     { label: "Dancing",     say: "La la la!" },
  crying:      { label: "Crying",      say: "Waaa…" },
  excited:     { label: "Excited",     say: "Yes!" },
};
export const MOOD_LIST = Object.keys(MOODS);
export const DEFAULT_MS = 3500;
