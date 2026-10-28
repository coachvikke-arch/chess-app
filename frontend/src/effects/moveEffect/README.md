# MoveEffect — the "sigma move" overlay

A single-timeline chess effect for three events: **brilliant**, **checkmate**
and **promotion**. One clock drives every layer, so the piece flight, the
grayscale ripple, the per-piece wobble, the badge/pill/sword envelopes, the
sound and the haptics can never drift apart — and the whole thing can be
scrubbed or slowed down for tuning. (Those three events are animation-only: the
envelopes still exist, but the overlay draws no seal, pill or sword — see
"Per-event look".)

```
playMoveEffect({ type, from, to, piece, color, boardOrientation, ... })
clearMoveEffects()
```

`ChessBoard` registers itself as a host and mounts the overlay inside its own
square area (above the pieces, below the promotion picker). Every board does
this automatically; a request without `boardId` goes to the most recently
touched board.

## Files

| File | Responsibility |
| --- | --- |
| `config.js` | every tunable number: timings, ripple, wobble, geometry, sound, haptics, per-event colours |
| `timeline.js` | pure maths (easing, ripple radius, flight, wobble, badge/pill/sword envelopes, path squares) |
| `MoveEffect.jsx` | the overlay: one `requestAnimationFrame` loop writing transforms/opacity/mask to refs |
| `moveEffect.css` | static look only (no animation properties in the hot path) |
| `haptics.js` | vibration pattern, on/off from `config/haptics.js` |
| `completion.js` | `revealAfterCheckmate` — when a result card may open after a mate |
| `index.js` | public API + host registry |

## Master timeline

`t` is milliseconds from the moment the board starts dimming. `L` = landing.

| t (ms) | What happens |
| --- | --- |
| 0 → 50 | board dims (grayscale + tint); the mover's path squares stay clear |
| 30 → 180 | mover flies to the hover spot, scale 1 → 1.25 |
| 180 → 400 | hover, lifted, on the dimmed board |
| 400 → 470 | drop onto the target (cubic ease-in), scale 1.25 → 1 |
| 440 | captured piece disappears (just before landing) |
| **470 (L)** | landing: ripple starts, seal pops, highlights appear |
| L → L+250 | seal badge pop (`easeOutBack`) |
| 600 → 850 | pill grows right out of the seal |
| 2600 → 2850 | pill label fades |
| 2850 → 3050 | pill collapses |
| 3130 → 3430 | sacrifice sword pops (brilliant + sacrifice only) |
| 3250 → 3500 | orange arrow grows out of the sword |
| **1470** | ripple has swept the board → real pieces are released, ghost layer hidden |
| **3600** | choreography ends; the overlay fades out (420 ms) and is unmounted a beat later |

`settle` (1470) matters twice: it is when `ChessBoard` stops hiding its own
pieces (`onPhase(2)`), and when the overlay hides its ghost copies.

## Result card

`revealAfterCheckmate({ to }, show)` is how every surface waits for a mate
before opening its result card. It fires when the effect for THAT move reports
done, or after `MOVE_EFFECT_REVEAL_DELAY_MS` (1970 ms) if the effect never
mounted (reduced motion, a board that is not on screen). Cancelling the call
does not fire `show`, so a caller can drop a stale wait. There is no per-position
dedupe here: a repeated mate (rematch, same line) is a new effect and a new
card. Surfaces keep their own once-per-game guard.

The card itself opens ~2 s after the mate — after the king wobble and the
"Checkmate" bubble, before the overlay has faded — and stays until the user
picks Rematch / New game or closes it.

## Ripple

Radius in squares, `x` seconds after landing:

```
r(x) = 10.5 * (1 - exp(-2.6 * x))
```

A square at distance `d` is crossed at `x = -ln(1 - d / 10.5) / 2.6`, so every
piece and flash is scheduled from geometry, not hard-coded delays. The dim is a
masked grayscale layer: the flight path and the area inside the expanding front
are punched out, and overlapping holes use `mask-composite: subtract` so they
never re-dim each other.

## Wobble

Each piece reacts when the front reaches its square:

```
decay  = exp(-7 * tau)
rotate = side * 11° * kingMultiplier * decay * sin(26 * tau)
scale  = 1 + 0.16 * kingMultiplier * decay
```

Pivot is `50% 85%` (the base of the glyph). `kingMultiplier` is `1.85` for the
mated king in the checkmate event. Side is `+1` right of the ripple origin,
`-1` left.

## Per-event look (`MOVE_EFFECTS`)

| type | accent | badge | label | ripple origin | notes |
| --- | --- | --- | --- | --- | --- |
| `brilliant` | `#2cc3a5` | `!!` | BRILLIANT | target square | orange sword + arrow when `sacrifice` |
| `checkmate` | `#e5484d` | `#` | CHECKMATE | mated king | king wobbles 1.85× |
| `promotion` | `#2cc3a5` | `=Q` | PROMOTION | target square | pawn morphs to the chosen piece at L, 1.3 → 1 pop |

Unknown/legacy verdicts fall back to `brilliant`.

All three events are **animation only** (`utils/moveFeedback.js`): the flight,
the dim, the ripple, the wobble and the promotion morph play, but the overlay
draws no seal badge, no pill, no sword and no "PROMOTED" badge. The one text
the overlay still draws is the king-anchored **Checkmate** bubble at 600 ms —
a mate ends the game, so the board has to say so.

## Payload

```js
playMoveEffect({
  type: 'brilliant' | 'checkmate' | 'promotion',
  from: 'f3', to: 'f6',
  piece: 'q',                  // chess.js type letter
  color: 'w',
  boardOrientation: 'white',   // or 'black'
  // optional:
  promotionPiece: 'q',
  sacrifice: true,             // brilliant only: sword badge
  captured: { square: 'f6', code: 'bn' },  // needed when history is unavailable
  kingSquare: 'e1',            // checkmate origin; ChessBoard derives it
  boardId: '<host id>' | undefined,
})
```

The board builds `pieces` from the position after the move, hands over the
captured piece (including en passant, where it is not on `to`), and hides its
own pieces until `settle`. The overlay then draws the mover in flight and every
other piece as a ghost, which is what makes per-piece wobble possible.

## Triggers in `ChessBoard`

- **promotion / checkmate** — right after the move is applied, on the player's
  own move and on exactly-one-ply external moves (bot, socket, review step).
- **brilliant** — when the `moveBadge` verdict becomes a sigma verdict on a new
  square. Edge-triggered with a `seenBadgeRef` sentinel, so re-renders and
  scrubbing one move never replay it.
- Any other move calls `clearMoveEffects()`, removing the previous badge and
  highlights.

## Sound and haptics

`playMoveEffectSound` in `utils/sound.js` routes through the existing output bus,
so volume/mute and the limiter apply:

- thud at L+60: sine 150 → 52 Hz, 240 ms, fast decay
- swell at L+140: 640 ms, 3 harmonics `[1, 0.4, 0.2]`, frequency/gain keyframes
  from `SOUND.swell`

Haptics: a 25 ms tick at L+50, then 14 × 40 ms slots (on-times in
`HAPTIC.swell.onMs`) from L+140. Both are rate-scaled and are skipped while
scrubbing, under reduced motion, and when the user's Sound/Vibration settings
are off (`config/haptics.js`).

## Reduced motion

`prefers-reduced-motion` (or the debug switch) drops the dim, flight, ripple,
pill and sword: the seal and the two square highlights appear immediately. The
board is never hidden in this mode.

## Tuning

Change a number in `config.js`; nothing else needs to move. The debug screen at
**`/dev/move-effect`** has one button per event, a sacrifice toggle, orientation
and reduced-motion switches, a 0.25× replay and a scrubber over the full
timeline (paused seek, audio/haptics muted).

## Tests

```
node --test scripts/move-effect-timeline.test.mjs      # pure maths / config
node --test scripts/move-effect-integration.test.mjs   # board wiring / triggers
npm run test:moveeffect
```
