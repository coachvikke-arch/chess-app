import { botReact } from "./BotProvider";

/** Map real app events to reactions. Call these from your existing handlers, e.g.
 *  on puzzle solved:  BOT.puzzleSolved();   on API 500:  BOT.apiError();
 *  The message argument is a key into botI18n.js, so the bubble follows the
 *  language picked in Settings. */
export const BOT = {
  loginSuccess:    (name) => (name
    ? botReact("happy", "loginSuccess", 4500, { name })
    : botReact("happy", "loginSuccessPlain", 4500)),
  loginFail:       () => botReact("angry",     "loginFail"),
  puzzleSolved:    () => botReact("happy",     "puzzleSolved"),
  puzzleWrong:     () => botReact("sad",       "puzzleWrong"),
  gameWin:         () => botReact("happy",     "gameWin", 5000),
  gameLoss:        () => botReact("sad",       "gameLoss", 5000),
  timeLow:         () => botReact("scared",    "timeLow", 4000),
  blunder:         () => botReact("angry",     "blunder", 3500),
  newNotification: () => botReact("surprised", "newNotification"),
  levelUp:         () => botReact("surprised", "levelUp", 4500),
  apiError:        () => botReact("disgusted", "apiError"),
  saved:           () => botReact("happy",     "saved", 2000),
};
