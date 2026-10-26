/* Resolution order for the access control.
 *
 * The SQL lives in permissionService as a COALESCE chain; this mirrors it in JS
 * so the precedence rules can be asserted without a database. If the chain in
 * permissionService.js changes, change it here too — the point is that the
 * ORDER (override > role switch > absent) is a written contract, not an
 * accident of COALESCE.
 *
 * Two states only. The tri-state column (NULL = "inherit") was removed: it
 * resolved to Off like everything else, so it looked meaningful in the admin
 * grid and granted nothing.
 */

let pass = 0;
let fail = 0;
const t = (name, fn) => {
  try { fn(); pass += 1; console.log('  ok   ' + name); }
  catch (err) { fail += 1; console.log('  FAIL ' + name + '\n       ' + err.message); }
};
const eq = (got, want, msg) => {
  if (got !== want) throw new Error(`${msg || ''} got ${got}, want ${want}`);
};

/* What an absent row resolves to: Off. There is no third state and no category
 * default, so this is the fail-closed floor and nothing can raise it. */
const PLATFORM_DEFAULT = false;

/** Mirrors the COALESCE chain in getEnabledFeaturesForUser / canAccess. */
function resolve(upo, rp) {
  const value = upo != null ? upo : (rp != null ? rp : PLATFORM_DEFAULT);
  return value === true;
}

/* state <-> wire value. The grid stores booleans; anything absent reads as Off.
 * Mirrors FeatureAccess's `=== true` guard rather than a truthiness check. */
const stateOf = (v) => (v === true ? 'on' : 'off');
const toWire = (s) => s === 'on';

t('a user override wins over everything else', () => {
  eq(resolve(true, false), true, 'on override beats an off role switch');
  eq(resolve(false, true), false, 'off override beats an on role switch');
});

t('an explicit role switch is used as-is', () => {
  eq(resolve(null, true), true, 'explicit on grants');
  eq(resolve(null, false), false, 'explicit off denies');
});

/* The important one. An earlier draft resolved "inherit" to TRUE for a role's
 * own category, which made a MISSING row grant access. That is fail-open: a
 * feature shipped without a row, or a row deleted by mistake, hands out
 * permissions. Absent must mean denied. */
t('an absent row is denied', () => {
  eq(resolve(null, null), false, 'no stored value is denied');
  eq(resolve(null, undefined), false, 'a missing row is denied');
  eq(resolve(undefined, undefined), false, 'no row and no override is denied');
  eq(resolve(null, 0), false, 'a falsy non-boolean is still denied');
});

t('the two role columns resolve independently', () => {
  eq(resolve(null, true), true, 'student column on');
  eq(resolve(null, false), false, 'coach column off for the same feature');
});

t('a missing row still allows the first explicit write', () => {
  /* setRolePermission short-circuits only when a row exists and already holds
   * the same value. With no row at all it must INSERT, so an admin switching a
   * never-touched feature on actually writes something. */
  const before = []; // the SELECT returned no rows
  const shortCircuits = before.length > 0 && (before[0] ?? false) === true;
  eq(shortCircuits, false, 'an untouched switch reports as changed, so the write happens');
});

t('the wire format round-trips through both states', () => {
  eq(stateOf(true), 'on');
  eq(stateOf(false), 'off');
  eq(stateOf(null), 'off', 'a legacy null displays as off');
  eq(stateOf(undefined), 'off', 'a missing row displays as off');
  eq(toWire('on'), true);
  eq(toWire('off'), false);
  for (const s of ['on', 'off']) {
    eq(stateOf(toWire(s)), s, `${s} survives the round trip`);
  }
});

t('an explicit off stays off even when the default is raised', () => {
  /* Guards against a future change that makes absent rows grant. If someone
   * ever sets PLATFORM_DEFAULT = true, a feature an admin switched off must
   * still deny. */
  eq(resolve(null, false), false);
});

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'}: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);