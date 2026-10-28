/* MoveEffect integration — the wiring between the board and the overlay.
 *
 * Run: node --test scripts/move-effect-integration.test.mjs
 *
 * The overlay itself is one component with one clock; what can silently break
 * is the wiring around it: which moves trigger it, that external moves and
 * review verdicts reach it, that the real pieces step aside while it animates,
 * that it never stacks, and that audio/haptics stay on the shared preferences.
 * Those are asserted against the source, like the rest of this suite.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = (p) => readFileSync(join(here, '..', 'src', p), 'utf8');

const BOARD = src('components/ChessBoard.jsx');
const ANIMATED = src('components/board/AnimatedBoard.jsx');
const EFFECT = src('effects/moveEffect/MoveEffect.jsx');
const API = src('effects/moveEffect/index.js');
const CSS = src('effects/moveEffect/moveEffect.css');
const SOUND = src('utils/sound.js');
const HAPTICS = src('effects/moveEffect/haptics.js');
const HAPTIC_CFG = src('config/haptics.js');

test('ChessBoard mounts the overlay through the public module, not ad-hoc CSS', () => {
  assert.match(BOARD, /import MoveEffect from '\.\.\/effects\/moveEffect\/MoveEffect';/);
  assert.match(BOARD, /registerMoveEffectHost/);
  assert.match(BOARD, /subscribeMoveEffects/);
  assert.match(BOARD, /markMoveEffectHostActive/);
  assert.match(BOARD, /import \{ playEffectForMove \} from '\.\.\/effects\/moveEffect\/playForMove';/);
  assert.doesNotMatch(BOARD, /isSigmaVerdict/, 'live play has no second brilliant trigger');
  assert.doesNotMatch(BOARD, /import PromotionFX/, 'the old promotion-only overlay is gone');
  assert.doesNotMatch(BOARD, /<PromotionFX/, 'the old overlay is not rendered');
});

test('live promotion and checkmate use the one shared ply entry point', () => {
  assert.match(BOARD, /const request = playEffectForMove\(ply, 'live', \{/);
  assert.match(BOARD, /game: gameAfter,\s*\n\s*move,/);
  /* both the player's own move and exactly-one-ply external moves.
     `fired === false` means "this move carries no event" (clear the previous
     one); `null` means "this board is not the visible one" (clear nothing). */
  assert.match(BOARD, /const fired = triggerEventMoveEffect\(move, game\);[\s\S]{0,200}?if \(fired === false\) clearMoveEffects\(\);/);
  assert.match(BOARD, /const fired = triggerEventMoveEffect\(onePly, game\);[\s\S]{0,200}?if \(fired === false\) clearMoveEffects\(\);/);
});

test('quiet moves clear a previous badge, and self-moves cannot double-fire', () => {
  const apply = BOARD.slice(BOARD.indexOf('function applyMove('), BOARD.indexOf('function applyMove(') + 1800);
  const selfIdx = apply.indexOf('selfMoveRef.current = true;');
  const triggerIdx = apply.indexOf('triggerEventMoveEffect(move, game)');
  assert.ok(selfIdx > -1 && triggerIdx > -1, 'both markers present');
  assert.ok(selfIdx < triggerIdx, 'self-move marker set before the trigger');
  assert.match(apply, /\n      selfMoveRef\.current = true;/, 'outside the sound gate');
});

test('external moves still trigger while sound is off', () => {
  const watch = BOARD.slice(BOARD.indexOf('const positionHistoryRef'), BOARD.indexOf('const positionHistoryRef') + 2600);
  assert.match(watch, /const fired = triggerEventMoveEffect\(onePly, game\);/);
  assert.ok(watch.indexOf('triggerEventMoveEffect(onePly') < watch.indexOf('if (!soundEnabled) return;'));
});

test('review/keyboard runs are not restarted or cleared by the position watcher', () => {
  const watch = BOARD.slice(BOARD.indexOf('const positionHistoryRef'), BOARD.indexOf('const positionHistoryRef') + 3000);
  assert.match(watch, /const activeMatches = Boolean\(\s*active && active\.fen && positionKey\(active\.fen\) === positionKey\(currentFen\)/);
  assert.ok(watch.indexOf('const activeMatches') < watch.indexOf('triggerEventMoveEffect(onePly'));
});

test('brilliant is not re-triggered from the badge prop (single entry point)', () => {
  assert.doesNotMatch(BOARD, /seenBadgeRef/);
  assert.doesNotMatch(BOARD, /source: 'review-verdict'/);
});

test('the overlay is keyed, guarded by the picker, and persists after the timeline', () => {
  assert.match(BOARD, /\{moveEffect && !pendingPromo && \(/);
  assert.match(BOARD, /key=\{moveEffect\.id\}/);
  assert.match(BOARD, /onPhase=\{handleEffectPhase\}/);
  assert.match(BOARD, /if \(phase >= 2\) setHiddenSquares\(null\);/);
  assert.match(BOARD, /hidePieces=\{hiddenSquares && !reducedMotion \? hiddenSquares : false\}/);
});

test('reduced motion never hides the board and drops every overlay piece', () => {
  assert.match(EFFECT, /sage\(ghostRefs\.current\.get\(it\.key\), 'visibility', 'hidden'\);/);
  assert.match(EFFECT, /sage\(flyRef\.current, 'visibility', 'hidden'\);/);
});

test('opening the promotion picker clears a running effect', () => {
  assert.match(BOARD, /clearOwnMoveEffects\('promotion-picker'\);\s*\n\s*setPendingPromo\(/);
});

test('AnimatedBoard hides its own pieces only while the overlay owns them', () => {
  assert.match(ANIMATED, /hidePieces = false,/);
  assert.match(ANIMATED, /visibility: isHiddenSquare\(p\.square\) \? 'hidden' : undefined,/);
  assert.match(ANIMATED, /typeof hidePieces\.has === 'function'/);
});

test('the payload carries everything the renderer needs', () => {
  assert.match(BOARD, /pieces: pieceList,/);
  assert.match(BOARD, /captured,/);
  assert.match(BOARD, /kingSquare,/);
  assert.match(BOARD, /promotionPiece: req\.promotionPiece \|\| null,/);
  assert.match(BOARD, /orientation: req\.boardOrientation === 'black' \? 'black' : 'white',/);
  // en passant: the captured piece is NOT on `to`
  assert.match(BOARD, /square: enPassant \? last\.to\[0\] \+ last\.from\[1\] : last\.to,/);
});

test('review layers pass the sacrifice flag through the badge', () => {
  const badgeBuilders = [
    src('pages/GameReview.jsx'),
    src('pages/AnalysisBoard.jsx'),
    src('components/GameViewerCard.jsx'),
    src('components/SigmaMoves.jsx'),
  ];
  for (const file of badgeBuilders) {
    assert.match(file, /sacrifice: Boolean\(/, 'a moveBadge builder dropped the sacrifice flag');
  }
});

test('one master clock with a scrub/slow-mo path', () => {
  assert.match(EFFECT, /if \(seekMs != null\) \{/);
  assert.match(EFFECT, /const t = \(now - start\) \* rate;/);
  assert.match(EFFECT, /requestAnimationFrame\(tick\)/);
  // audio and haptics never fire while scrubbing or under reduced motion
  assert.match(EFFECT, /if \(reduced \|\| seekMs != null \|\| !audio\) return undefined;/);
  assert.match(EFFECT, /playMoveEffectSound\(\{ cue: SOUND, landingMs: T\.landing, rate \}\)/);
  assert.match(EFFECT, /playMoveEffectHaptics\(\{ type: effect\?\.type, rate \}\)/);
});

test('the mover is drawn in flight, everyone else as a ghost', () => {
  assert.match(EFFECT, /if \(p\.square === effect\.to\) continue;/);
  assert.match(EFFECT, /kind: 'captured'/);
  assert.match(EFFECT, /cfg\.morph \?/);
  // the promotion morph uses the effect's own colour for the old pawn
  assert.match(EFFECT, /renderPiece\(`\$\{String\(effect\?\.color \|\| 'w'\)\}\$\{String\(effect\?\.piece \|\| 'p'\)\.toUpperCase\(\)\}`/);
});

test('dim holes never re-dim overlapping squares', () => {
  assert.match(EFFECT, /composite\.push\('subtract'\);/);
  assert.match(EFFECT, /webkitComposite\.push\('destination-out'\);/);
  assert.match(EFFECT, /maskComposite = composite;/);
  assert.match(EFFECT, /webkitMaskComposite = webkitComposite;/);
});

test('overlay stacking and reduced-motion guard live in the effect stylesheet', () => {
  assert.match(CSS, /\.me-root \{[\s\S]*?z-index: 45;/);
  for (const cls of ['me-dim', 'me-hl', 'me-flash', 'me-piece', 'me-fly', 'me-ripple', 'me-seal', 'me-pill', 'me-sword', 'me-sword-arrow']) {
    assert.ok(CSS.includes(`.${cls}`), `missing .${cls}`);
  }
  assert.match(CSS, /@media \(prefers-reduced-motion: reduce\)/);
});

test('the API targets a host and can be cleared', () => {
  /* The target is resolved through ONE chain: the caller's own board, then the
     board that is currently on top, then the last board the user touched. The
     middle step is what makes the effect play on the board the user is looking
     at when two boards are mounted (the Play Arena's page board and its
     full-screen Play Mode board). */
  assert.match(API, /resolveEffectTarget\(\{/);
  assert.match(API, /explicitBoardId: config\.boardId,/);
  assert.match(API, /visibleHostId: getVisibleEffectHost\(\),/);
  assert.match(API, /activeHostId,/);
  assert.match(API, /export function clearMoveEffects\(reason = 'cleared'\)/);
  assert.match(API, /export function markMoveEffectHostActive\(id\)/);
});

test('sound and haptics stay on the existing preferences', () => {
  assert.match(SOUND, /export function playMoveEffectSound\(/);
  assert.match(SOUND, /if \(!enabled \|\| !cue\) return \(\) => \{\};/);
  assert.match(SOUND, /\.connect\(outputBus\(c\)\)/);
  assert.match(HAPTICS, /navigator\.vibrate/);
  assert.match(HAPTICS, /getHaptics/);
  assert.match(HAPTIC_CFG, /STORAGE_PREFIX = 'knightpath-haptics';/);
  assert.match(HAPTIC_CFG, /export function useHaptics\(/);
});
