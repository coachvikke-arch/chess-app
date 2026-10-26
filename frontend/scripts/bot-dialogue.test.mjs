// Behavioural tests for the Bot Chat dialogue service
// (frontend/src/services/BotDialogueService.js) -
//   run with: node --test scripts/bot-dialogue.test.mjs   (from frontend/)
//
// This module deliberately has NO imports, which is what lets it be tested
// directly in Node instead of being asserted against as source text. That
// matters here because the rules below are the ones that stop bots being
// obnoxious: a bot that comments on every ply is worse than a silent one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createBotSpeaker,
  reactToMove,
  lineForEvent,
  evaluateMood,
  COOLDOWN_MS,
  INACCURACY_CP,
  BLUNDER_CP,
} from '../src/services/BotDialogueService.js';

const BOT = {
  id: 'pip',
  name: 'Pip',
  difficulty: 'Beginner',
  greeting: "Hi! I'm Pip.",
  winMessage: 'Great game!',
  loseMessage: 'Good game!',
  drawMessage: 'So close!',
};

/* ── Test doubles ─────────────────────────────────────────────────────── */

/** Minimal Chess stand-in: reactToMove only needs the terminal getters and board(). */
function stubGame({ white = [], black = [], over = false } = {}) {
  const cells = [];
  for (const [color, pieces] of [['w', white], ['b', black]]) {
    for (const type of pieces) cells.push({ type, color });
  }
  cells.push({ type: 'k', color: 'w' }, { type: 'k', color: 'b' });
  return {
    board: () => [cells, cells.slice(), [], [], [], [], [], []],
    isCheckmate: () => over,
    isStalemate: () => false,
    isDraw: () => over,
  };
}

const quietMove = { san: 'Nf3', color: 'w', captured: undefined };

// ── Relevance: no idle chatter ──────────────────────────────────────────

test('stays silent on a quiet, balanced move', () => {
  const game = stubGame();
  const line = reactToMove({ bot: BOT, actor: 'bot', move: quietMove, gameAfter: game, lossCp: 0 });
  assert.equal(line, null, 'a non-event move must produce no line');
});

test('comments on a check', () => {
  const game = stubGame();
  const line = reactToMove({ bot: BOT, actor: 'bot', move: { san: 'Qxf7+', color: 'w' }, gameAfter: game });
  assert.ok(line, 'a check must get a reaction');
});

test('comments on a capture', () => {
  const game = stubGame();
  const line = reactToMove({
    bot: BOT,
    actor: 'human',
    move: { san: 'Bxf7', color: 'b', captured: { type: 'p' } },
    gameAfter: game,
  });
  assert.ok(line, 'a capture must get a reaction');
});

// ── Blunder detection is driven by real centipawn loss ──────────────────

test('a blunder-sized centipawn loss is called out', () => {
  const game = stubGame();
  const line = reactToMove({
    bot: BOT,
    actor: 'bot',
    move: { san: 'Qd5', color: 'w' },
    gameAfter: game,
    lossCp: BLUNDER_CP,
  });
  assert.ok(line, 'giving away a piece must be acknowledged');
});

test('a small centipawn loss stays below the blunder threshold', () => {
  const game = stubGame();
  const line = reactToMove({
    bot: BOT,
    actor: 'bot',
    move: { san: 'Qd5', color: 'w' },
    gameAfter: game,
    lossCp: INACCURACY_CP - 10,
  });
  assert.equal(line, null, 'a tiny imprecision must not trigger commentary');
});

// ── The game is over: defer to the result UI ────────────────────────────

test('says nothing once the game is finished', () => {
  const game = stubGame({ over: true });
  const line = reactToMove({
    bot: BOT,
    actor: 'bot',
    move: { san: 'Qxf7#', color: 'w', captured: { type: 'r' } },
    gameAfter: game,
  });
  assert.equal(line, null, 'a terminal position must be handled by the result modal');
});

// ── Cooldown ────────────────────────────────────────────────────────────

test('the cooldown suppresses a second line', () => {
  let now = 1000;
  const speaker = createBotSpeaker(BOT, { cooldownMs: COOLDOWN_MS, now: () => now });
  const game = stubGame();

  const first = speaker.react({ actor: 'bot', move: { san: 'Qxf7+', color: 'w' }, gameAfter: game });
  assert.ok(first, 'the first reaction should be allowed');

  const second = speaker.react({ actor: 'bot', move: { san: 'Qxf7+', color: 'w' }, gameAfter: game });
  assert.equal(second, null, 'the same reaction must be suppressed inside the cooldown');

  now += COOLDOWN_MS + 1;
  const third = speaker.react({ actor: 'bot', move: { san: 'Qxf7+', color: 'w' }, gameAfter: game });
  assert.ok(third, 'after the cooldown a new line is allowed');
});

test('the opening greeting ignores the cooldown', () => {
  let now = 1000;
  const speaker = createBotSpeaker(BOT, { cooldownMs: COOLDOWN_MS, now: () => now });
  assert.ok(speaker.greet());
  /* A second greeting immediately must still speak: the first line the player
     ever sees must never be swallowed by throttling. */
  assert.ok(speaker.greet());
});

// ── Mute really means silence ───────────────────────────────────────────

test('a muted speaker emits nothing at all', () => {
  const speaker = createBotSpeaker(BOT, { enabled: false });
  const game = stubGame();
  assert.equal(speaker.greet(), null);
  assert.equal(speaker.react({ actor: 'bot', move: { san: 'Qxf7+', color: 'w' }, gameAfter: game }), null);
  assert.equal(speaker.finish('loss'), null);
});

// ── Result lines come from the bot record ───────────────────────────────

test('result lines come from the bot record', () => {
  assert.equal(lineForEvent(BOT, 'loss'), BOT.loseMessage);
  assert.equal(lineForEvent(BOT, 'draw'), BOT.drawMessage);
  assert.equal(lineForEvent(BOT, 'win'), BOT.winMessage);
  assert.equal(lineForEvent(null, 'win'), null);
});

// ── Mood detection ──────────────────────────────────────────────────────

test('material advantage reads as winning for that side', () => {
  /* white has Q + 2R = 19, black only a king. */
  const game = stubGame({ white: ['q', 'r', 'r'] });
  assert.equal(evaluateMood(game, 'w'), 'winning');
  assert.equal(evaluateMood(game, 'b'), 'losing');
});

test('a bare king each way reads as balanced', () => {
  assert.equal(evaluateMood(stubGame(), 'w'), 'balanced');
});

test('a decided position produces a mood line', () => {
  const game = stubGame({ white: ['q', 'r', 'r'] });
  const line = reactToMove({ bot: BOT, actor: 'bot', move: { san: 'Ra8', color: 'w' }, gameAfter: game });
  assert.ok(line, 'a winning bot should say something');
});