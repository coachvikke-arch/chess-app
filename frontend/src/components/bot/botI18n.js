// Every Clock Bot string lives here — reaction lines, page-aware lines,
// idle activities and the settings/controls around it, per language.
// Triggers pass keys, never sentences, so switching language also translates
// a bubble that is already on screen.

export const BOT_LANG_KEY = "mz_bot_lang";
export const DEFAULT_LANG = "en";

export const BOT_LANGS = [
  { id: "en", label: "English" },
  { id: "ta", label: "தமிழ்" },
];

/* Names stay in Latin script in both languages — they are proper nouns. */
export const POKE_PLAYERS = [
  "Magnus Carlsen", "Hikaru Nakamura", "Fabiano Caruana", "Ding Liren",
  "Ian Nepomniachtchi", "Wesley So", "Anish Giri", "Viswanathan Anand",
  "Praggnanandhaa", "Gukesh", "Arjun Erigaisi", "Nodirbek Abdusattorov",
];

export const BOT_STRINGS = {
  en: {
    // real events
    loginSuccess: "Hello, {name}! Welcome back!",
    loginSuccessPlain: "Hello! Welcome back!",
    pokeAngry: "Don't play with me! Play with {name}!",
    slowDown: "Hey! Slow down!",
    tooFast: "Whoa! Too fast!",
    headSpinning: "My head is spinning!",
    needRest: "I need a little rest!",
    dizzyOk: "I'm okay now!",
    loginFail: "Wrong username or password!",
    puzzleSolved: "Excellent! Well done!",
    puzzleWrong: "Try again!",
    gameWin: "You won!",
    gameLoss: "Good try! Keep practising!",
    timeLow: "Hurry! Time is running out!",
    blunder: "Ouch! That was a blunder.",
    newNotification: "You have a new notification!",
    levelUp: "Congratulations!",
    apiError: "Something went wrong!",
    saved: "Successfully saved!",
    greet: "Hi! Need a hint?",

    // page entry lines
    dash1: "Welcome back! Ready to improve your chess?",
    dash2: "Let's make today a great chess day!",
    hw1: "Let's complete your homework!",
    hw2: "Take your time and find the best move!",
    tr1: "Can you solve this puzzle?",
    tr2: "Think carefully before moving!",
    ar1: "Ready for battle?",
    ar2: "Show me your best chess moves!",
    rv1: "Let's learn from your mistakes!",
    rv2: "Every mistake makes you stronger!",
    lb1: "Let's climb the leaderboard!",
    lb2: "Keep working towards the top!",
    tn1: "Good luck in your tournament!",
    tn2: "Play smart and stay focused!",
    pf1: "Let's check your chess progress!",
    pf2: "Your progress is your best motivation!",
    st1: "Make your academy experience comfortable!",
    op1: "Learn a new opening today!",
    op2: "Strong openings win games!",
    co1: "Your students are waiting to learn!",
    co2: "Great coaches build great players!",
    ac1: "Keep practising every day!",
    ac2: "Every game is a chance to grow!",

    // idle mascot activities
    idleThink: "Hmm… what is the best move here?",
    idleWatch: "I'm watching your clock!",
    idleHello: "Hello, champion!",
    idleLaugh: "Chess makes every day better!",
    idleDance: "A little dance between moves!",
    idleSleep: "Just resting my eyes…",
    idleExcited: "I feel a great move coming!",

    // settings / controls
    section: "Clock bot",
    showBot: "Show Clock Bot",
    showBotHint: "The floating mascot that reacts to your games, puzzles and alerts.",
    language: "Bot language",
    languageHint: "Language for the Clock Bot messages and settings.",
    label: "Chess bot",
  },
  ta: {
    // real events
    loginSuccess: "வணக்கம், {name}! மீண்டும் வரவேற்கிறேன்!",
    loginSuccessPlain: "வணக்கம்! மீண்டும் வரவேற்கிறேன்!",
    pokeAngry: "என்னுடன் விளையாடாதீர்கள்! {name} உடன் விளையாடுங்கள்!",
    slowDown: "ஏய்! மெதுவாக நகர்த்துங்கள்!",
    tooFast: "அடடா! ரொம்ப வேகமாக இருக்கே!",
    headSpinning: "எனக்குத் தலை சுத்துகிறது!",
    needRest: "கொஞ்சம் ஓய்வு வேண்டும்!",
    dizzyOk: "இப்போது நான் நன்றாக இருக்கிறேன்!",
    loginFail: "பயனர்பெயர் அல்லது கடவுச்சொல் தவறு!",
    puzzleSolved: "அருமை! சிறப்பாகச் செய்தீர்கள்!",
    puzzleWrong: "மீண்டும் முயற்சி செய்யுங்கள்!",
    gameWin: "நீங்கள் வெற்றி பெற்றீர்கள்!",
    gameLoss: "நல்ல முயற்சி! தொடர்ந்து பயிற்சி செய்யுங்கள்!",
    timeLow: "சீக்கிரம்! நேரம் முடிவடைகிறது!",
    blunder: "அய்யோ! அது ஒரு பெரிய தவறு.",
    newNotification: "உங்களுக்கு புதிய அறிவிப்பு உள்ளது!",
    levelUp: "வாழ்த்துகள்!",
    apiError: "ஏதோ தவறு ஏற்பட்டுள்ளது!",
    saved: "வெற்றிகரமாகச் சேமிக்கப்பட்டது!",
    greet: "வணக்கம்! உதவி வேண்டுமா?",

    // page entry lines
    dash1: "மீண்டும் வரவேற்கிறேன்! இன்று செஸ் பயிற்சியைத் தொடங்கலாமா?",
    dash2: "இன்று ஒரு சிறந்த செஸ் நாளாக அமையட்டும்!",
    hw1: "உங்கள் வீட்டுப்பாடத்தை முடிப்போம்!",
    hw2: "பொறுமையாக சிறந்த நகர்வைக் கண்டுபிடியுங்கள்!",
    tr1: "இந்த புதிரை உங்களால் தீர்க்க முடியுமா?",
    tr2: "நகர்த்துவதற்கு முன் கவனமாக சிந்தியுங்கள்!",
    ar1: "போட்டிக்குத் தயாரா?",
    ar2: "உங்கள் சிறந்த செஸ் நகர்வுகளைக் காட்டுங்கள்!",
    rv1: "உங்கள் தவறுகளிலிருந்து கற்றுக்கொள்வோம்!",
    rv2: "ஒவ்வொரு தவறும் உங்களை மேலும் வலிமையாக்கும்!",
    lb1: "தரவரிசையில் மேலே செல்வோம்!",
    lb2: "உச்சத்தை நோக்கி தொடர்ந்து பயிற்சி செய்யுங்கள்!",
    tn1: "போட்டியில் வெற்றி பெற வாழ்த்துகள்!",
    tn2: "புத்திசாலித்தனமாக விளையாடி கவனம் செலுத்துங்கள்!",
    pf1: "உங்கள் செஸ் முன்னேற்றத்தைப் பார்ப்போம்!",
    pf2: "உங்கள் முன்னேற்றமே சிறந்த ஊக்கம்!",
    st1: "உங்களுக்கு ஏற்றவாறு அமைப்புகளை மாற்றுங்கள்!",
    op1: "இன்று ஒரு புதிய ஓப்பனிங்கைக் கற்றுக்கொள்ளுங்கள்!",
    op2: "வலுவான ஓப்பனிங் ஆட்டங்களை வெல்ல உதவும்!",
    co1: "உங்கள் மாணவர்கள் கற்றுக்கொள்ள காத்திருக்கிறார்கள்!",
    co2: "சிறந்த பயிற்சியாளர்கள் சிறந்த வீரர்களை உருவாக்குகிறார்கள்!",
    ac1: "தினமும் பயிற்சி செய்யுங்கள்!",
    ac2: "ஒவ்வொரு ஆட்டமும் வளர வாய்ப்பு!",

    // idle mascot activities
    idleThink: "ஹ்ம்ம்… இங்கே சிறந்த நகர்வு எது?",
    idleWatch: "நான் உங்கள் கடிகாரத்தைக் கவனிக்கிறேன்!",
    idleHello: "வணக்கம், சாம்பியன்!",
    idleLaugh: "செஸ் ஒவ்வொரு நாளையும் சிறப்பாக்குகிறது!",
    idleDance: "நகர்வுகளுக்கிடையே சிறு நடனம்!",
    idleSleep: "கண்களை சிறிது ஓய்வெடுக்க வைக்கிறேன்…",
    idleExcited: "ஒரு சிறந்த நகர்வு வரப்போகிறது!",

    // settings / controls
    section: "கிளாக் போட்",
    showBot: "Clock Bot-ஐக் காட்டு",
    showBotHint: "உங்கள் ஆட்டங்கள், புதிர்கள் மற்றும் அறிவிப்புகளுக்கு வினைபுரியும் மிதக்கும் கதாபாத்திரம்.",
    language: "போட் மொழி",
    languageHint: "கிளாக் போட் செய்திகள் மற்றும் அமைப்புகளுக்கான மொழி.",
    label: "சதுரங்க போட்",
  },
};

/* Route → page key. Longest/most specific patterns first; anything else in the
   authenticated app falls back to the generic academy lines. */
const PAGE_ROUTES = [
  [/^\/student\/dashboard/, "dashboard"],
  [/^\/student\/homework/, "homework"],
  [/^\/student\/trainer/, "trainer"],
  [/^\/student\/puzzles/, "trainer"],
  [/^\/student\/analysis/, "arena"],
  [/^\/student\/review/, "review"],
  [/^\/student\/game-analysis/, "review"],
  [/^\/student\/leaderboard/, "leaderboard"],
  [/^\/student\/tournaments/, "tournaments"],
  [/^\/(student\/)?openings/, "openings"],
  [/^\/student\/(profile|chess-profile)/, "profile"],
  [/^\/student\/settings/, "settings"],
  [/^\/admin\/settings/, "settings"],
  [/^\/admin\//, "coach"],
  [/^\/student\//, "academy"],
];

export const pageKeyFor = (pathname) => {
  const hit = PAGE_ROUTES.find(([re]) => re.test(pathname || ""));
  return hit ? hit[1] : "academy";
};

export const PAGE_ENTRY = {
  dashboard: { key: "dash1", mood: "happy" },
  homework: { key: "hw1", mood: "excited" },
  trainer: { key: "tr1", mood: "thinking" },
  arena: { key: "ar1", mood: "excited" },
  review: { key: "rv1", mood: "thinking" },
  leaderboard: { key: "lb1", mood: "excited" },
  tournaments: { key: "tn1", mood: "celebrating" },
  openings: { key: "op1", mood: "thinking" },
  profile: { key: "pf1", mood: "happy" },
  settings: { key: "st1", mood: "happy" },
  coach: { key: "co1", mood: "happy" },
  academy: { key: "ac1", mood: "happy" },
};

export const PAGE_AUTO = {
  dashboard: [{ key: "dash2", mood: "excited" }, { key: "dash1", mood: "happy" }],
  homework: [{ key: "hw2", mood: "thinking" }, { key: "hw1", mood: "happy" }],
  trainer: [{ key: "tr2", mood: "thinking" }, { key: "tr1", mood: "surprised" }],
  arena: [{ key: "ar2", mood: "excited" }, { key: "ar1", mood: "surprised" }],
  review: [{ key: "rv2", mood: "happy" }, { key: "rv1", mood: "thinking" }],
  leaderboard: [{ key: "lb2", mood: "excited" }, { key: "lb1", mood: "happy" }],
  tournaments: [{ key: "tn2", mood: "thinking" }, { key: "tn1", mood: "celebrating" }],
  openings: [{ key: "op2", mood: "thinking" }, { key: "op1", mood: "happy" }],
  profile: [{ key: "pf2", mood: "happy" }, { key: "pf1", mood: "thinking" }],
  settings: [{ key: "st1", mood: "happy" }, { key: "ac2", mood: "thinking" }],
  coach: [{ key: "co2", mood: "happy" }, { key: "co1", mood: "excited" }],
  academy: [{ key: "ac2", mood: "excited" }, { key: "ac1", mood: "happy" }],
};

export const IDLE_ACTIVITIES = [
  { key: "idleThink", mood: "thinking" },
  { key: "idleHello", mood: "waving" },
  { key: "idleLaugh", mood: "laughing" },
  { key: "idleDance", mood: "dancing" },
  { key: "idleWatch", mood: "surprised" },
  { key: "idleExcited", mood: "excited" },
  { key: "idleSleep", mood: "sleeping" },
];

export const readLang = () => {
  try {
    const v = localStorage.getItem(BOT_LANG_KEY);
    return BOT_STRINGS[v] ? v : DEFAULT_LANG;
  } catch {
    return DEFAULT_LANG;
  }
};

export const writeLang = (lang) => {
  try {
    localStorage.setItem(BOT_LANG_KEY, BOT_STRINGS[lang] ? lang : DEFAULT_LANG);
  } catch {
    /* private mode: preference just won't persist */
  }
};

export function translate(lang, key, params) {
  const pack = BOT_STRINGS[lang] || BOT_STRINGS[DEFAULT_LANG];
  let text = pack[key] ?? BOT_STRINGS[DEFAULT_LANG][key] ?? key;
  if (params) {
    text = text.replace(/\{(\w+)\}/g, (m, name) => (params[name] ?? m));
  }
  return text;
}
