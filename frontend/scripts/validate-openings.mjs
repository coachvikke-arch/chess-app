/* Validates src/data/openingsLibrary.json:
   1. parses as JSON
   2. every opening has the required fields
   3. every `moves` line is LEGAL in full (chess.js is the judge)
   4. every `notes` key points at a real ply in the line
   5. every VARIATION line is legal, canonically spelled, uniquely id'd, and
      leaves the main line at some point (an identical copy is a data bug)

   Run: node scripts/validate-openings.mjs
*/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chess } from 'chess.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(here, '..', 'src', 'data');
const file = path.join(dataDir, 'openingsLibrary.json');
const gambitFile = path.join(dataDir, 'gambitsLibrary.json');
const raw = fs.readFileSync(file, 'utf8');
const gambitRaw = fs.readFileSync(gambitFile, 'utf8');

const REQUIRED = ['slug', 'name', 'eco', 'side', 'family', 'style', 'difficulty', 'description', 'moves'];
const DIFFICULTIES = ['Beginner', 'Intermediate', 'Advanced'];
const STYLES = ['Aggressive', 'Positional', 'Solid', 'Gambit'];
const SIDES = ['white', 'black'];

let errors = 0;
let warnings = 0;
const err = (m) => { errors++; console.error(`  x ${m}`); };
const warn = (m) => { warnings++; console.log(`  ! ${m}`); };

let data;
try {
  data = JSON.parse(raw);
} catch (e) {
  console.error('FATAL: file is not valid JSON ->', e.message);
  process.exit(1);
}

const gambitData = JSON.parse(gambitRaw);
const openings = [...(data.openings || []), ...(gambitData.openings || [])];
console.log(`\nValidating ${openings.length} openings from openingsLibrary.json + gambitsLibrary.json\n`);

const slugs = new Set();
const names = new Set();
for (const o of openings) {
  const label = o.slug || o.name || '(unnamed)';
  for (const f of REQUIRED) {
    if (o[f] === undefined || o[f] === null || o[f] === '') err(`${label}: missing "${f}"`);
  }
  if (slugs.has(o.slug)) err(`${label}: duplicate slug`);
  slugs.add(o.slug);
  if (names.has(o.name)) err(`${label}: duplicate opening name "${o.name}"`);
  names.add(o.name);
  if (o.aliases !== undefined && (!Array.isArray(o.aliases) || o.aliases.some((a) => typeof a !== 'string'))) {
    err(`${label}: "aliases" must be an array of strings`);
  }
  if ((o.style || []).includes('Gambit') && !o.gambit) {
    warn(`${label}: Gambit style without gambit classification metadata`);
  }
  if (o.gambit) {
    if (!['white', 'black'].includes(o.gambit.by)) err(`${label}: gambit.by must be white or black`);
    if (o.gambit.by !== o.side) err(`${label}: gambit.by must match side`);
    if (!['pawn', 'piece'].includes(o.gambit.kind)) err(`${label}: gambit.kind must be pawn or piece`);
    if (!['pawn', 'piece', 'knight', 'bishop', 'initiative'].includes(o.gambit.sacrificed)) {
      err(`${label}: invalid gambit.sacrificed`);
    }
    if (typeof o.gambit.acceptedMain !== 'boolean') err(`${label}: gambit.acceptedMain must be boolean`);
    if (!o.gambit.classification) err(`${label}: missing gambit.classification`);
  }
  if (!SIDES.includes(o.side)) err(`${label}: bad side "${o.side}"`);
  if (!DIFFICULTIES.includes(o.difficulty)) err(`${label}: bad difficulty "${o.difficulty}"`);
  if (!Array.isArray(o.style) || o.style.some((s) => !STYLES.includes(s))) {
    err(`${label}: bad style list ${JSON.stringify(o.style)}`);
  }
  if (!Array.isArray(o.moves) || o.moves.length < 2) {
    err(`${label}: needs at least 2 moves`);
    continue;
  }

  // Replay the whole line - a single illegal move fails the opening.
  const g = new Chess();
  const replayed = [];
  for (const [i, san] of o.moves.entries()) {
    try {
      const m = g.move(san);
      if (!m) throw new Error('no move returned');
      replayed.push(m.san);
    } catch {
      err(`${label}: ILLEGAL move "${san}" at ply ${i + 1} (line so far: ${o.moves.slice(0, i).join(' ')})`);
      break;
    }
  }
  // SAN must be canonical or the library display will drift from reality.
  for (let i = 0; i < replayed.length; i++) {
    if (replayed[i] !== o.moves[i]) {
      warn(`${label}: ply ${i + 1} canonical SAN is "${replayed[i]}", library has "${o.moves[i]}"`);
    }
  }

  // Notes must reference plies that exist.
  const notes = o.notes || {};
  for (const k of Object.keys(notes)) {
    const ply = Number(k);
    if (!Number.isInteger(ply) || ply < 1 || ply > o.moves.length) {
      err(`${label}: note key "${k}" is not a ply in 1..${o.moves.length}`);
    }
  }
  // Each side's own moves should be explained at least once.
  const side = o.side;
  const ownPlies = [];
  for (let i = 0; i < o.moves.length; i++) {
    const isWhite = i % 2 === 0;
    if ((side === 'white' && isWhite) || (side === 'black' && !isWhite)) ownPlies.push(i + 1);
  }
  const annotated = ownPlies.filter((p) => notes[p]);
  if (annotated.length === 0) warn(`${label}: no notes for the ${side} side's own moves`);
  else if (annotated.length < Math.min(3, ownPlies.length)) {
    warn(`${label}: only ${annotated.length}/${ownPlies.length} own moves annotated`);
  }

  /* ── variations ──────────────────────────────────────────────────────────
     Each variation is a full line from move 1, so it is held to exactly the
     same standard as the main line: legal, canonical, and with note keys that
     point at real plies. A variation that never departs from the main line is
     also rejected - it would render as a duplicate tab. */
  const variations = o.variations || [];
  if (!Array.isArray(variations)) {
    err(`${label}: "variations" must be an array`);
  } else {
    const ids = new Set();
    for (const v of variations) {
      const vlabel = `${label}/${v?.id || '(unnamed)'}`;
      if (!v || typeof v !== 'object') { err(`${label}: variation is not an object`); continue; }
      if (!v.id) err(`${vlabel}: missing "id"`); 
      else if (ids.has(v.id)) err(`${vlabel}: duplicate variation id`);
      else ids.add(v.id);
      if (!v.name) err(`${vlabel}: missing "name"`);
      if (!Array.isArray(v.moves) || v.moves.length < 2) {
        err(`${vlabel}: needs at least 2 moves`);
        continue;
      }

      const vg = new Chess();
      const vReplay = [];
      for (const [i, san] of v.moves.entries()) {
        let m;
        try {
          m = vg.move(san);
          if (!m) throw new Error('no move returned');
        } catch {
          err(`${vlabel}: ILLEGAL move "${san}" at ply ${i + 1} (line so far: ${v.moves.slice(0, i).join(' ')})`);
          break;
        }
        vReplay.push(m.san);
      }
      for (let i = 0; i < vReplay.length; i++) {
        if (vReplay[i] !== v.moves[i]) {
          warn(`${vlabel}: ply ${i + 1} canonical SAN is "${vReplay[i]}", library has "${v.moves[i]}"`);
        }
      }

      /* Notes are keyed against the VARIATION's own ply numbering. */
      const vnotes = v.notes || {};
      for (const k of Object.keys(vnotes)) {
        const ply = Number(k);
        if (!Number.isInteger(ply) || ply < 1 || ply > v.moves.length) {
          err(`${vlabel}: note key "${k}" is not a ply in 1..${v.moves.length}`);
        }
      }

      /* The learner must own at least one move, or the drill has nothing to ask. */
      const voff = side === 'black' ? 1 : 0;
      let vOwn = 0;
      for (let i = voff; i < v.moves.length; i += 2) vOwn += 1;
      if (vOwn < 1) err(`${vlabel}: ${side} owns no moves in the line`);

      /* Must actually branch away from the main line. */
      const same = v.moves.length === o.moves.length
        && v.moves.every((san, i) => san === o.moves[i]);
      if (same) err(`${vlabel}: identical to the main line - it is not a variation`);
    }
  }
}

const fam = {};
for (const o of openings) fam[o.family] = (fam[o.family] || 0) + 1;
const bySide = openings.reduce((a, o) => ({ ...a, [o.side]: (a[o.side] || 0) + 1 }), {});
const byDiff = openings.reduce((a, o) => ({ ...a, [o.difficulty]: (a[o.difficulty] || 0) + 1 }), {});

console.log('  families :', Object.entries(fam).map(([k, v]) => `${k} (${v})`).join(', '));
console.log('  by side  :', JSON.stringify(bySide));
console.log('  by level :', JSON.stringify(byDiff));
const variationTotal = openings.reduce((a, o) => a + (o.variations?.length || 0), 0);
const withVariations = openings.filter((o) => (o.variations?.length || 0) > 0).length;
console.log('  lines    :', `${openings.length} main + ${variationTotal} variations (${withVariations} openings)`);
console.log('');

if (errors) {
  console.error(`FAILED - ${errors} error(s), ${warnings} warning(s)\n`);
  process.exit(1);
}
console.log(`PASSED - ${openings.length} openings + ${variationTotal} variations, all lines legal, ${warnings} warning(s)\n`);
