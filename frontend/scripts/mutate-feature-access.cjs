/* Mutation harness for feature-access-panel.test.mjs.
 *
 * Each entry is a real defect that previously reached the browser with a green
 * `npm run build`. For every one the render test MUST fail. If a mutation
 * survives, the suite has a blind spot worth naming.
 *
 * Run: node scripts/mutate-feature-access.cjs
 */
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'src', 'pages', 'FeatureAccess.jsx');
const original = fs.readFileSync(FILE, 'utf8');

const VALUE = "checked={feature[role.key === 'student' ? 'student_enabled' : 'coach_enabled'] === true}";

const MUTATIONS = [
  /* The original bug: the role variable shadowed the feature-row variable, so
     the lookup resolved off the role object and every column rendered the same. */
  {
    name: 'M1 value read off the role object (the shadowing bug)',
    find: VALUE,
    replace: "checked={feature[role.key === 'student' ? 'student_inherited' : 'coach_inherited'] === true}",
  },
  {
    name: 'M2 both columns show the student value',
    find: VALUE,
    replace: 'checked={feature.student_enabled === true}',
  },
  {
    name: 'M3 saving keyed without the role (cross-column disable)',
    find: 'disabled={Boolean(saving[`${feature.key}:${role.key}`])}',
    replace: 'disabled={Boolean(saving[`${feature.key}`])}',
  },
  {
    name: 'M4 onToggle args swapped (saves the role as the feature key)',
    find: 'onToggle(feature.key, role.key, next)',
    replace: 'onToggle(role.key, feature.key, next)',
  },
  {
    name: 'M5 role cell label hardcoded to Student (columns indistinguishable on mobile)',
    find: '<span className="perm-rolecell__name">{role.label}</span>',
    replace: '<span className="perm-rolecell__name">Student</span>',
  },
  {
    name: 'M6 On/Off text label removed (state only shown by knob position)',
    find: "{checked ? 'On' : 'Off'}",
    replace: "{''}",
  },
  {
    name: 'M7 aria-checked hardcoded (state no longer exposed to AT)',
    find: 'aria-checked={checked}',
    replace: 'aria-checked={false}',
  },
  {
    name: 'M8 toggle inverts (clicking On switches it Off)',
    find: 'onClick={() => onChange(!checked)}',
    replace: 'onClick={() => onChange(checked)}',
  },
  ];

/* Mutants that look like defects but change nothing. They are listed so nobody
 * re-adds them expecting a catch:
 *   - `Boolean(x)` in place of `x === true`: Boolean(null) is already false, so
 *     a legacy NULL row still reads as Off. The `=== true` guard is clearer
 *     about intent, not more correct.
 *   - Adding a data-* attribute to a cell: pure markup addition, no behaviour.
 *   - Swapping which branch reads which key, when both branches are the two
 *     real role keys: with a two-role map that is a rename, not a behaviour
 *     change the output can distinguish. */
const EQUIVALENT = [
  'Boolean() in place of === true',
  'adding a data-* attribute',
  'swapping the two real role keys in the ternary',
  /* Duplicate React keys only misbehave during reconciliation of a live tree.
     renderToStaticMarkup renders each element once and never reconciles, so no
     static-render test can see it. Catching this needs a DOM test with a state
     update, which this suite does not have. */
  'collapsing the two role cells onto one React key',
];

function runTests() {
  try {
    return execFileSync('node', ['--test', 'scripts/feature-access-panel.test.mjs'], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    return `${err.stdout || ''}${err.stderr || ''}`;
  }
}

const counts = (out) => ({
  pass: (out.match(/pass (\d+)/) || [, '?'])[1],
  fail: (out.match(/fail (\d+)/) || [, '?'])[1],
});

const base = counts(runTests());
console.log(`baseline: pass=${base.pass} fail=${base.fail}`);
if (base.fail !== '0') {
  console.error('baseline is not green - fix the suite before trusting mutations');
  process.exit(1);
}

let survived = 0;
for (const m of MUTATIONS) {
  if (!original.includes(m.find)) {
    console.log(`  SKIP      ${m.name} (anchor not found - source drifted)`);
    survived += 1;
    continue;
  }
  fs.writeFileSync(FILE, original.replace(m.find, m.replace), 'utf8');
  const r = counts(runTests());
  const caught = Number(r.fail) > 0;
  if (!caught) survived += 1;
  console.log(`  ${caught ? 'CAUGHT  ' : 'SURVIVED'}  ${m.name}  (fail=${r.fail})`);
}

fs.writeFileSync(FILE, original, 'utf8');
console.log(`\n${survived === 0 ? 'ALL MUTATIONS CAUGHT' : `${survived} MUTATION(S) SURVIVED`}`);
console.log('restored original source');
process.exit(survived === 0 ? 0 : 1);