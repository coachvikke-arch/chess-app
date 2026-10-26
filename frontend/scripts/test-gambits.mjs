/* Gambit library regression tests.

   The gambit collection is a curated dataset merged into the main opening
   library. These tests protect the parts that make it a *gambit* library:
   legal lines, accepted/declined labels that match the metadata, search
   aliases, and a clear distinction between pawn gambits, countergambits and
   sacrificial attacks. */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chess } from 'chess.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const dataDir = path.join(root, 'src', 'data');
const read = (name) => JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8'));
const base = read('openingsLibrary.json').openings || [];
const extra = read('gambitsLibrary.json').openings || [];
const all = [...base, ...extra];
const gambits = all.filter((o) => (o.style || []).includes('Gambit'));

const replay = (moves) => {
  const game = new Chess();
  for (const san of moves) game.move(san);
  return game;
};

test('the merged library exposes a substantial gambit collection', () => {
  assert.ok(gambits.length >= 24, `expected at least 24 gambits, found ${gambits.length}`);
  assert.ok(gambits.some((o) => o.side === 'white'), 'missing White gambits');
  assert.ok(gambits.some((o) => o.side === 'black'), 'missing Black countergambits');
});

test('every gambit has classification metadata that agrees with its side', () => {
  for (const o of gambits) {
    assert.ok(o.gambit, `${o.slug}: missing gambit metadata`);
    assert.equal(o.gambit.by, o.side, `${o.slug}: gambit.by must match side`);
    assert.ok(['pawn', 'piece'].includes(o.gambit.kind), `${o.slug}: bad gambit kind`);
    assert.equal(typeof o.gambit.acceptedMain, 'boolean', `${o.slug}: acceptedMain must be boolean`);
    assert.ok(o.gambit.classification, `${o.slug}: missing classification`);
  }
  assert.ok(gambits.some((o) => o.gambit.kind === 'pawn'), 'no pawn gambits');
  assert.ok(gambits.some((o) => o.gambit.kind === 'piece'), 'no piece-sacrifice gambits');
  assert.ok(gambits.some((o) => o.gambit.classification === 'Countergambit'), 'no countergambits');
  assert.ok(gambits.some((o) => o.gambit.classification === 'Sacrificial attack'), 'no sacrificial attacks');
});

test('accepted/declined labels are not contradicted by the metadata', () => {
  for (const o of gambits) {
    if (/Accepted/.test(o.name) && !/Declined/.test(o.name)) {
      assert.equal(o.gambit.acceptedMain, true, `${o.slug}: named Accepted but main line is marked declined`);
    }
    if (/Declined/.test(o.name)) {
      assert.equal(o.gambit.acceptedMain, false, `${o.slug}: named Declined but main line is marked accepted`);
    }
  }
});

test('every gambit line and variation is legal and non-empty', () => {
  for (const o of gambits) {
    assert.ok(o.moves.length >= 4, `${o.slug}: main line too short`);
    replay(o.moves);
    assert.ok(o.variations?.length, `${o.slug}: gambit needs at least one variation`);
    for (const v of o.variations) {
      assert.ok(v.moves.length >= 4, `${o.slug}/${v.id}: variation too short`);
      replay(v.moves);
    }
  }
});

test('aliases are searchable', () => {
  for (const o of gambits) {
    assert.ok(Array.isArray(o.aliases) && o.aliases.length, `${o.slug}: missing aliases`);
    assert.equal(new Set(o.aliases).size, o.aliases.length, `${o.slug}: duplicate alias within opening`);
    for (const alias of o.aliases) assert.ok(alias.trim(), `${o.slug}: blank alias`);
  }
  const lib = fs.readFileSync(path.join(root, 'src', 'lib', 'openings.js'), 'utf8');
  assert.match(lib, /\(o\.aliases \|\| \[\]\)\.join/, 'search haystack does not include aliases');
});

test('gambits keep valid ECO codes and unique slugs/names', () => {
  const slugs = new Set();
  const names = new Set();
  for (const o of gambits) {
    assert.match(o.eco, /^[A-E]\d{2}$/, `${o.slug}: invalid ECO ${o.eco}`);
    assert.ok(!slugs.has(o.slug), `${o.slug}: duplicate slug`);
    assert.ok(!names.has(o.name), `${o.slug}: duplicate name`);
    slugs.add(o.slug);
    names.add(o.name);
  }
});
