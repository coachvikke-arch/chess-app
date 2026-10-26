'use strict';

/**
 * Tournament game configuration constants.
 *
 * All timings are expressed in MILLISECONDS unless noted otherwise, and are
 * reachable from one place so a single edit can tune the tournament experience.
 * These values are also mirrored to the frontend (see
 * src/config/tournamentConfig.js) where the board UI consumes them.
 */

/** First-move countdown for White. White must make the first move within this
 *  window after both players are connected; otherwise White forfeits. */
const FIRST_MOVE_COUNTDOWN_MS = Number(process.env.TOURN_FIRST_MOVE_COUNTDOWN_MS) || 60 * 1000;

/** No-show timeout: a player who never opens the game within this window of the
 *  pairing loses the pairing (forfeit). */
const NO_SHOW_TIMEOUT_MS = Number(process.env.TOURN_NO_SHOW_TIMEOUT_MS) || 60 * 1000;

/** Disconnect timeout while it is the opponent's turn (or the disconnected
 *  player is on the move): with no reconnection, the opponent may claim the win,
 *  or the system auto-awards after this full timeout. */
const DISCONNECT_TIMEOUT_MS = Number(process.env.TOURN_DISCONNECT_TIMEOUT_MS) || 60 * 1000;

/** Draw-offer cooldown: a player may offer a draw at most once every this many
 *  of their own moves. */
const DRAW_OFFER_COOLDOWN_MOVES = Number(process.env.TOURN_DRAW_OFFER_COOLDOWN) || 5;

/** Minimum move count before a draw can score in Arena tournaments. */
const ARENA_DRAW_MIN_MOVES = Number(process.env.TOURN_ARENA_DRAW_MIN_MOVES) || 30;

/** Minimum move count before an Arena draw earns +1 point (2 when on fire). */
const ARENA_DRAW_POINT_MIN_MOVES = Number(process.env.TOURN_ARENA_DRAW_POINT_MIN_MOVES) || 30;

/** Draw-offer toggle: on by default; set TOURN_DRAW_OFFER_ENABLED=false to turn off. */
const DRAW_OFFER_ENABLED = process.env.TOURN_DRAW_OFFER_ENABLED !== 'false';

/** Berserk toggle (Arena): before the first move the player may halve the clock
 *  and drop the increment. Disabled for zero-initial-time controls. */
/** Pause between a finished round and the next auto-generated one (ms). */
const ROUND_TRANSITION_MS = Number(process.env.TOURN_ROUND_TRANSITION_MS) >= 0 && process.env.TOURN_ROUND_TRANSITION_MS !== undefined
  ? Number(process.env.TOURN_ROUND_TRANSITION_MS) : 10 * 1000;

const BERSERK_ENABLED = process.env.TOURN_BERSERK_ENABLED !== 'false';

/** Armageddon (Knockout decider): White 5 minutes, Black 4 minutes, Black wins
 *  on a drawn decider. */
const ARMAGEDDON_WHITE_MS = Number(process.env.TOURN_ARM_WHITE_MS) || 5 * 60 * 1000;
const ARMAGEDDON_BLACK_MS = Number(process.env.TOURN_ARM_BLACK_MS) || 4 * 60 * 1000;

/** Switch the board orientation when the player's colour is at the bottom. */
const ORIENT_WHITE_BOTTOM = 'white';
const ORIENT_BLACK_BOTTOM = 'black';

/** Result codes (server-side, persisted on tournament_games). */
const RESULT = {
  WHITE: 'white',
  BLACK: 'black',
  DRAW: 'draw',
  ABANDON: 'abandon',
  FORFEIT_NO_SHOW: 'forfeit_no_show',
};

/** Termination reason codes (server-side). */
const REASON = {
  CHECKMATE: 'checkmate',
  RESIGN: 'resign',
  TIMEOUT: 'timeout',
  FORFEIT_NO_SHOW: 'forfeit_no_show',
  ABANDON: 'abandon',
  STALEMATE: 'stalemate',
  REPETITION: 'repetition',
  FIFTY_MOVE: 'fifty_move',
  INSUFFICIENT_MATERIAL: 'insufficient_material',
  AGREEMENT: 'agreement',
  ADMIN: 'admin',
  ARMAGEDDON: 'armageddon',
};

module.exports = {
  FIRST_MOVE_COUNTDOWN_MS,
  NO_SHOW_TIMEOUT_MS,
  DISCONNECT_TIMEOUT_MS,
  DRAW_OFFER_COOLDOWN_MOVES,
  ARENA_DRAW_MIN_MOVES,
  ARENA_DRAW_POINT_MIN_MOVES,
  DRAW_OFFER_ENABLED,
  BERSERK_ENABLED,
  ROUND_TRANSITION_MS,
  ARMAGEDDON_WHITE_MS,
  ARMAGEDDON_BLACK_MS,
  ORIENT_WHITE_BOTTOM,
  ORIENT_BLACK_BOTTOM,
  RESULT,
  REASON,
};
