#!/usr/bin/env node
/* Wires the HTTPS mail relay:
   - Gmail SMTP credentials  -> Vercel project env (the relay function uses them)
   - relay URL + fresh secret -> Railway service env (the API posts to it)
   Nothing is printed except variable names, and the secret is generated here,
   so it is never written down or passed on a command line.
   Run from anywhere: node scripts/configure-mail-relay.mjs */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT_ID = 'prj_auvQCHV3AhM0aMR8qb2klzKvt1Nf';
const TEAM_ID = 'team_c43KdBBFZOY6tFUfr8JLTnMQ';
const RELAY_URL = process.env.MAIL_RELAY_URL || 'https://mate-zone-chess-academy.vercel.app/api/mail-relay';

const envText = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
function envGet(key) {
  const m = envText.match(new RegExp(`^${key}=(.*)$`, 'm'));
  if (!m) return '';
  let value = m[1].replace(/\r$/, '');
  if (/^".*"$/.test(value) || /^'.*'$/.test(value)) value = value.slice(1, -1);
  return value;
}

const MAIL_KEYS = ['MAIL_HOST', 'MAIL_PORT', 'MAIL_SECURE', 'MAIL_USER', 'MAIL_PASS', 'MAIL_FROM', 'MAIL_FROM_NAME'];
const mailEnv = Object.fromEntries(MAIL_KEYS.map((k) => [k, envGet(k)]));
for (const required of ['MAIL_HOST', 'MAIL_USER', 'MAIL_PASS', 'MAIL_FROM']) {
  if (!mailEnv[required]) {
    console.error(`Missing ${required} in ${path.join(ROOT, '.env')}`);
    process.exit(1);
  }
}

const relaySecret = crypto.randomBytes(32).toString('hex');

const authPath = path.join(process.env.APPDATA || '', 'com.vercel.cli', 'Data', 'auth.json');
const vercelToken = JSON.parse(fs.readFileSync(authPath, 'utf8')).token;

async function setVercelEnv(key, value) {
  const res = await fetch(
    `https://api.vercel.com/v10/projects/${PROJECT_ID}/env?teamId=${TEAM_ID}&upsert=true`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${vercelToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value, type: 'encrypted', target: ['production', 'preview'] }),
    },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Vercel ${key}: ${data.error?.message || res.status}`);
  console.log(`  vercel  ${key}`);
}

function setRailwayEnv(key, value) {
  const result = spawnSync(
    'npx',
    ['--yes', '@railway/cli', 'variable', 'set', key, '--stdin', '--skip-deploys'],
    { cwd: ROOT, input: value, encoding: 'utf8', shell: process.platform === 'win32' },
  );
  if (result.status !== 0) {
    throw new Error(`Railway ${key}: ${(result.stderr || result.stdout || '').trim().split('\n').pop()}`);
  }
  console.log(`  railway ${key}`);
}

for (const [key, value] of Object.entries(mailEnv)) {
  await setVercelEnv(key, value);
}
await setVercelEnv('MAIL_RELAY_SECRET', relaySecret);

setRailwayEnv('MAIL_TRANSPORT', 'relay');
setRailwayEnv('MAIL_RELAY_URL', RELAY_URL);
setRailwayEnv('MAIL_RELAY_SECRET', relaySecret);

console.log(`Done. Relay: ${RELAY_URL}`);
console.log('Redeploy the Railway service so it picks up MAIL_TRANSPORT=relay.');
