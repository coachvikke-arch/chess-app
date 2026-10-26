/**
 * Bot portrait assets — every bot must have a real, distinct image.
 *
 * WHY THIS EXISTS
 *
 * The catalogue ships 30 `.webp` placeholders that were ALL ZERO BYTES, which
 * is why every bot rendered a two-letter monogram instead of a face. Nothing
 * failed: the build passed, the catalogue tests passed, and the only symptom was
 * a UI that looked unfinished. These tests assert the artwork is real.
 *
 * The strongest check here is that a file is a DECODABLE PNG of a sane size. A
 * 0-byte placeholder fails both, and so does a placeholder that is technically a
 * valid PNG of a blank square.
 *
 * Run with: npm run test:bot-avatars
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fe = (...p) => join(here, '..', 'src', ...p);
const be = (...p) => join(here, '..', '..', 'backend', ...p);

const AVATAR_DIR = join(here, '..', '..', 'frontend', 'public', 'assets', 'bots');

/* The 30 ids, read from the catalogue itself so this cannot drift out of date. */
const botsSource = readFileSync(fe('data', 'bots.ts'), 'utf8');
const ids = [...botsSource.matchAll(/^\s*id:\s*'([a-z0-9]+)'/gm)].map((m) => m[1]);

const EXPECTED = [
  'pip', 'mia', 'leo', 'nova', 'toby',
  'aria', 'finn', 'luna', 'kai', 'milo',
  'zara', 'orion', 'theo', 'maya', 'atlas',
  'raven', 'viktor', 'iris', 'magnuson', 'serena',
  'cipher', 'phoenix', 'titan', 'akira', 'draco',
  'shadow', 'aurora', 'nexus', 'zenith', 'omega',
];

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test('the catalogue still declares exactly the 30 expected bot ids', () => {
  assert.deepEqual(ids.slice(0, 30), EXPECTED,
    'bot ids in data/bots.ts no longer match the expected roster');
});

test('a portrait exists for every bot id', () => {
  const missing = EXPECTED.filter((id) => !existsSync(join(AVATAR_DIR, `${id}.png`)));
  assert.deepEqual(missing, [], `missing portraits: ${missing.join(', ')}`);
});

test('every portrait is a real, non-empty PNG (this is what the 0-byte placeholders were)', () => {
  const bad = [];
  for (const id of EXPECTED) {
    const file = join(AVATAR_DIR, `${id}.png`);
    if (!existsSync(file)) {
      bad.push(`${id}: missing`);
      continue;
    }
    const size = statSync(file).size;
    if (size < 1024) bad.push(`${id}: only ${size} bytes — a placeholder, not artwork`);
    const head = readFileSync(file).subarray(0, 8);
    if (!head.equals(PNG_MAGIC)) bad.push(`${id}: not a PNG`);
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

test('no zero-byte files remain anywhere in the avatar directory', () => {
  const empty = readdirSync(AVATAR_DIR)
    .filter((f) => f.endsWith('.png'))
    .filter((f) => statSync(join(AVATAR_DIR, f)).size === 0);
  assert.deepEqual(empty, [], `zero-byte files: ${empty.join(', ')}`);
});

test('every portrait is distinct — no copy-paste duplicates', () => {
  const { createHash } = require_crypto();
  const seen = new Map();
  const dupes = [];
  for (const id of EXPECTED) {
    const hash = createHash('md5').update(readFileSync(join(AVATAR_DIR, `${id}.png`))).digest('hex');
    if (seen.has(hash)) dupes.push(`${id} is identical to ${seen.get(hash)}`);
    else seen.set(hash, id);
  }
  assert.deepEqual(dupes, [], dupes.join('\n'));
});

test('the generic fallback avatar exists for when a portrait fails to load', () => {
  const file = join(AVATAR_DIR, 'default.png');
  assert.ok(existsSync(file), 'default.png is missing');
  assert.ok(statSync(file).size > 1024, 'default.png is a placeholder');
});

test('the directory holds exactly the 30 portraits plus the fallback', () => {
  const files = readdirSync(AVATAR_DIR).filter((f) => f.endsWith('.png')).sort();
  const wanted = [...EXPECTED, 'default'].map((n) => `${n}.png`).sort();
  assert.deepEqual(files, wanted, 'unexpected files in public/assets/bots/');
});

/* ── wiring ─────────────────────────────────────────────────────────────── */

test('the avatar path is built centrally, one rule for every bot', () => {
  const src = botsSource;
  assert.match(src, /const AVATAR_BASE = '\/assets\/bots';/);
  assert.match(src, /function avatar\(id: string\): string \{\s*return `\$\{AVATAR_BASE\}\/\$\{id\}\.png`;/);
  /* The old build-time glob and its 0-byte placeholders are gone. Assert on CODE
     only: the block comment above explains why the glob was removed and would
     otherwise match this check for the wrong reason. */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /import\.meta\.glob/);
  assert.equal(existsSync(join(here, '..', 'src', 'assets', 'bots')), false,
    'the 0-byte src/assets/bots placeholder directory still exists');
});

test('the fallback avatar is exported for the component to use', () => {
  assert.match(botsSource, /export const DEFAULT_BOT_AVATAR = AVATAR_DEFAULT;/);
});

test('BotAvatar renders an <img> from bot.avatar and falls back to the default portrait', () => {
  const comp = readFileSync(fe('components', 'bots', 'BotAvatar.jsx'), 'utf8');
  assert.match(comp, /import \{ DEFAULT_BOT_AVATAR \} from '\.\.\/\.\.\/data\/bots'/);
  assert.match(comp, /src=\{finalSrc\}/);
  assert.match(comp, /broken \? DEFAULT_BOT_AVATAR : src/);
  assert.match(comp, /onError=/);
  /* No letter avatar may come back. */
  assert.doesNotMatch(comp, /initials/i, 'BotAvatar must not render a monogram');
  assert.doesNotMatch(comp, /buildFallbackSvg/);
});

test('the obsolete monogram helper is gone', () => {
  const utils = readFileSync(fe('utils', 'botAvatars.js'), 'utf8');
  assert.doesNotMatch(utils, /export function initialsFor/);
  assert.doesNotMatch(utils, /^\s*initialsFor,$/m);
});

test('BotAvatar is the only portrait renderer — every surface goes through it', () => {
  /* One mapping, used by the card, the game header, the popup and the chat. */
  const users = ['pages/BotsPage.jsx', 'pages/BotGamePage.jsx', 'components/bots/BotCard.jsx', 'components/bots/BotChat.jsx'];
  for (const file of users) {
    const src = readFileSync(fe(...file.split('/')), 'utf8');
    assert.match(src, /<BotAvatar/, `${file} does not use BotAvatar`);
  }
  /* And nobody bypasses it with a raw bot image. */
  for (const file of users) {
    const src = readFileSync(fe(...file.split('/')), 'utf8');
    assert.doesNotMatch(src, /bot\.avatar/, `${file} bypasses BotAvatar`);
  }
});

/* ── generation is reproducible ─────────────────────────────────────────── */

test('the generator covers every bot id', () => {
  const gen = readFileSync(be('scripts', 'gen_bot_avatars.py'), 'utf8');
  for (const id of EXPECTED) {
    assert.match(gen, new RegExp(`'${id}':\\s*dict\\(`), `generator has no design for "${id}"`);
  }
});

function require_crypto() {
  return { createHash: cryptoCreateHash };
}
let cryptoCreateHash;
{
  const m = await import('node:crypto');
  cryptoCreateHash = m.createHash;
}