/* UCI bridge subprocess, spawned by validate-classification.mjs.
   The Stockfish npm build only prints to its own stdout in Node (it exposes
   no onmessage callback), so we run it as a child process: stdin lines are
   forwarded as UCI commands, and the engine's UCI output flows straight to
   this process's stdout, which the parent captures over a pipe. */

'use strict';
const readline = require('readline');
const { createRequire } = require('node:module');
const req = createRequire(__filename); // resolves 'stockfish' from frontend/node_modules
const stockfish = req('stockfish');

stockfish('single') // full NNUE single build — parity with scripts/copy-stockfish.mjs
  .then((engine) => {
    const rl = readline.createInterface({ input: process.stdin, terminal: false });
    rl.on('line', (line) => {
      if (line && line.trim()) engine.sendCommand(line.trim());
    });
    process.on('SIGTERM', () => process.exit(0));
  })
  .catch((err) => {
    console.error('engine-bridge init failed:', err);
    process.exit(1);
  });