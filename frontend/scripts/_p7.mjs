import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('scripts/_build_tactics.mjs','utf8');
s = s.replace("solution: ['Qh4#'], opponentReplies: [],", "solution: ['Qh4+'], opponentReplies: [],");
writeFileSync('scripts/_build_tactics.mjs', s,'utf8');
