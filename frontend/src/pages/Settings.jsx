import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import ChessBoard from '../components/ChessBoard';
import { Page } from '../components/ui';
import Modal from '../components/Modal';
import { useAuth } from '../context/AuthContext';
import { useSound } from '../context/SoundContext';
import { BOARD_THEMES, BOARD_THEMES_HIDDEN_IN_SETTINGS, getBoardTheme } from '../config/boardThemes';
import { PIECE_THEMES, PIECE_THEMES_HIDDEN_IN_SETTINGS, GLYPHS, getPieceTheme, pieceGlyphStyle } from '../config/pieceTheme';
import { BOARD_ANIMATION_PRESETS, useBoardAnimationId, setBoardAnimation } from '../config/boardAnimation';
import { useShowLegalMoves, setShowLegalMoves } from '../config/legalMoves';
import { getAllowPieceDrag, setAllowPieceDrag, useAllowPieceDrag } from '../config/pieceDrag';
import { useAutoQueen, setAutoQueen } from '../config/autoQueen';
import {
  useHaptics,
  setHaptics,
  isHapticsSupported,
  useHapticStrength,
  HAPTIC_STRENGTHS,
} from '../config/haptics';
import { playMoveEffectHaptics } from '../effects/moveEffect/haptics';
import { FacedPiece } from '../components/FacedPiece';
import { RoyalPiece } from '../components/RoyalPieces';
import Button from '../components/Button';
import { useToast } from '../components/Toast';

/* Settings is one flat white/blue list: nothing heavy is painted on the page.
   Every row opens ONE card that contains a real, playable board plus the
   controls for that row, so each setting is demonstrated by the thing it
   changes instead of by a picture of it.

   The preview is the app's own `ChessBoard`, not a static mock-up: it reads the
   live board theme, piece set, frame, legal-move, drag, auto-queen, animation
   and sound preferences exactly as a game board does. Changing a control inside
   the card therefore changes the board above it on the same tick, and what the
   user sees is what every other page in the app will show. */

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
/* A white pawn one rank from promotion with both kings out of the way, so the
   push is legal from any state the demo line has reached. */
const PROMOTION_FEN = '4k3/P7/8/8/8/8/1K6/8 w - - 0 1';
/* The line "Play a move" walks through — a quiet opening, so both colours get
   to be seen moving and the animation preset is on display for every ply. */
const DEMO_LINE = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'O-O', 'd6', 'd3', 'a6'];

/* The cards that get an automatic script. `look` and `frame` are left out on
   purpose: what they change is the board's own surface, and that repaints the
   moment a pick lands — a scripted move could show nothing new. */
const DEMO_SCRIPTS = ['anim', 'legal', 'drag', 'queen', 'sound', 'vib'];

/* The wait before the first action, so the card and its board are mounted and
   painted before anything moves, and the gap between the two taps the tap-to-move
   demo has to show one at a time. */
const DEMO_OPEN_MS = 420;
const DEMO_TAP_MS = 1100;

/* The animation dropdown lists the presets in this fixed order — the preset map
   is keyed by id and the stored value is still just the id. */
const ANIMATION_ORDER = ['glide', 'spring', 'snap', 'off'];

/* One entry per card: what the row shows, and what the card shows. Keeping them
   in the same object is what stops a row and its card from describing the
   setting differently. */
const CARDS = {
  look: {
    icon: '🎨',
    label: 'Board & Pieces',
    rowHint: 'Theme, piece set and custom colors',
    desc: 'Every pick applies instantly to every board in the app.',
    hint: 'Tap a piece, then a square — or drag — to play on the board you are setting up.',
  },
  frame: {
    icon: '🖼',
    label: 'Board Frame',
    rowHint: 'Decorative edge and coordinates around the board',
    desc: 'On draws the plinth and the file/rank labels; Off gives a bare board.',
    hint: 'The board above grows and shrinks its edge as you switch, exactly like the board you play on.',
  },
  anim: {
    icon: '⚡',
    label: 'Board Animation',
    rowHint: 'How pieces travel when a move is played',
    desc: 'Choose how a piece travels from its old square to its new one.',
    hint: 'The knight plays itself every time you pick a style, so the travel you are choosing is the travel you see.',
  },
  legal: {
    icon: '💡',
    label: 'Show Legal Moves',
    rowHint: 'Highlight possible moves when you select a piece',
    desc: 'Marks the squares a selected piece can actually reach.',
    hint: 'The knight on g1 selects itself: On leaves its dots and capture rings lit, Off leaves the same piece with nothing around it.',
  },
  drag: {
    icon: '✋',
    label: 'Drag Pieces',
    rowHint: 'Drag pieces to move them instead of tapping',
    desc: 'How a move is made on every board in the app.',
    hint: 'On: the knight is carried to f3 in one action. Off: it is tapped, then its destination is tapped — the demo replays whichever of those you just switched to.',
  },
  queen: {
    icon: '♛',
    label: 'Auto-queen',
    rowHint: 'Promote pawns to a Queen without asking',
    desc: 'What happens when a pawn reaches the last rank.',
    hint: 'The card puts a white pawn on the seventh and runs it to the back rank by itself: On makes a Queen at once, Off opens the piece picker.',
  },
  sound: {
    icon: '🔊',
    label: 'Move Sounds',
    rowHint: 'Knocks, captures, castling and check',
    desc: 'The cue each move plays, and how loud it is.',
    hint: 'A move plays itself when you open this card or flip the switch, so the cue arrives at the level you set. Dragging the slider answers with one knock.',
  },
  vib: {
    icon: '◉',
    label: 'Vibration',
    rowHint: 'A pulse on brilliant, mate and promotion moves',
    desc: 'A short pulse alongside the move effect.',
    hint: 'Each change fires the pulse a real brilliant move plays — same pattern, delay and strength scaling. "Test pulse" repeats it, and only a device with a vibration motor can answer.',
  },
};

const APPEARANCE_ROWS = ['look', 'frame', 'anim', 'legal', 'drag', 'queen'];

export default function Settings() {
  const { boardTheme, pieceSet, boardFrame, boardColors, hasCustomBoardColors, updatePrefs } = useAuth();
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  /* The same app-wide preference the Play Arena's toggle writes to, so sound is
     adjustable from the page a user actually goes to for preferences. */
  const { soundOn, setSoundOn, volume, setVolume, playSound, unlockAudio } = useSound();
  const { showToast } = useToast();

  /* Which card is open. Every detail screen is a centred card, so the page
     behind never changes and the list stays exactly where it was. */
  const [popup, setPopup] = useState(null);
  /* The row that opened the card, so closing hands focus back to it. */
  const triggerRef = useRef(null);

  /* The card's board. One chess.js instance, owned here and handed to the
     preview as its controlled game; a state bump repaints it after a move the
     board itself did not make (the demo buttons). The instance is recreated
     whenever a card opens, so a card always starts from the standard position. */
  const gameRef = useRef(null);
  const demoStepRef = useRef(0);
  const [, setTick] = useState(0);

  /* The automatic demo (see runDemo below): one action handed to the preview
     board at a time, and the token that retires a script still in flight. */
  const [demoAction, setDemoAction] = useState(null);
  const demoTokenRef = useRef(0);
  const demoNonceRef = useRef(0);
  const demoTimersRef = useRef([]);
  const volumeSampleRef = useRef(0);

  const activeThemeId = boardTheme || 'classic-green';
  const activePieceSet = pieceSet || 'cburnett';

  async function setTheme(id) {
    setSaving(true);
    setSavedMsg('');
    try {
      const u = await updatePrefs({ boardTheme: id });
      setSavedMsg(`Board theme updated to ${getBoardTheme(u.board_theme).name}.`);
    } catch {
      setSavedMsg('Failed to save board theme.');
    } finally {
      setSaving(false);
    }
  }

  async function setPieceSet(id) {
    setSaving(true);
    setSavedMsg('');
    try {
      const u = await updatePrefs({ pieceSet: id });
      setSavedMsg(`Piece set updated to ${getPieceTheme(u.piece_set).name}.`);
    } catch {
      setSavedMsg('Failed to save piece set.');
    } finally {
      setSaving(false);
    }
  }

  /* The frame toggle is independent of the board theme: it only decides whether
     the decorative plinth/ornament around the board is drawn. It is left to the
     server round-trip rather than optimistically flipped, so the switch can
     never show a state the backend did not actually store. */
  async function setBoardFrame(next) {
    setSaving(true);
    setSavedMsg('');
    try {
      const u = await updatePrefs({ boardFrame: next });
      setSavedMsg(`Board frame turned ${u.board_frame === false ? 'off' : 'on'}.`);
    } catch {
      setSavedMsg('Failed to save the frame setting.');
    } finally {
      setSaving(false);
    }
  }

  /* The choice is a display preference, stored per user on this device, and
     every board reads it live — so the card's own board is the confirmation and
     the toast is only a label for what just happened. The card then replays its
     script, because the only way to judge a travel is to watch a piece travel. */
  function pickAnimation(id) {
    setBoardAnimation(id);
    showToast(`Board animation set to ${BOARD_ANIMATION_PRESETS[id]?.name || id}.`, {
      tone: 'info',
      title: 'Board animation',
      source: 'Settings:animation',
    });
    runDemo('anim');
  }

  /* The volume slider is dragged, so it arrives as a stream of changes: one cue
     per pause in the drag rather than one per pixel. `playSound` is already mute
     when the switch is off, so a slide while muted stays quiet. */
  function sampleVolume(next) {
    setVolume(next);
    const now = Date.now();
    if (now - volumeSampleRef.current < 320) return;
    volumeSampleRef.current = now;
    playSound('move');
  }

  const animationId = useBoardAnimationId();
  const showLegalMoves = useShowLegalMoves();
  const allowPieceDrag = useAllowPieceDrag();
  const autoQueen = useAutoQueen();
  const haptics = useHaptics();
  const [hapticStrength, setHapticStrength] = useHapticStrength();

  /* Live preview shows the *currently applied* selection. */
  const selectable = BOARD_THEMES.filter((t) => !BOARD_THEMES_HIDDEN_IN_SETTINGS.has(t.id));
  const regular = selectable.filter((t) => !t.accessibility);
  const accessible = selectable.filter((t) => t.accessibility);

  // Only the non-hidden piece sets are offered in the picker.
  const pieceOptions = Object.values(PIECE_THEMES).filter(
    (p) => !PIECE_THEMES_HIDDEN_IN_SETTINGS.has(p.id)
  );

  const themeName = getBoardTheme(activeThemeId).name;
  const pieceName = getPieceTheme(activePieceSet || 'cburnett').name;
  const hapticsSupported = isHapticsSupported();
  const strengthLabel = HAPTIC_STRENGTHS.find((s) => s.id === hapticStrength)?.label || 'On';

  const rowValues = {
    look: `${themeName} · ${pieceName}`,
    frame: boardFrame ? 'On' : 'Off',
    anim: BOARD_ANIMATION_PRESETS[animationId]?.name || animationId,
    legal: showLegalMoves ? 'On' : 'Off',
    drag: allowPieceDrag ? 'On' : 'Off',
    queen: autoQueen ? 'On' : 'Off',
    sound: soundOn ? `${Math.round(volume * 100)}%` : 'Off',
    vib: haptics ? strengthLabel : 'Off',
  };

  /* ── the card's demo board ── */
  function openCard(id, trigger) {
    triggerRef.current = trigger;
    gameRef.current = new Chess(START_FEN);
    demoStepRef.current = 0;
    /* Retired before the new board mounts: the preview is keyed by the card, so
       a leftover action would replay itself on the fresh board. */
    stopDemo();
    setPopup(id);
    runDemo(id);
  }

  function closeCard() {
    stopDemo();
    setPopup(null);
  }

  /* ── the automatic demo ─────────────────────────────────────────────────────
     A card opens by showing its own setting in action, and changing one of its
     controls replays it, so the card answers "what does this actually do?" before
     anyone looks for a button. A script is a chain of timed actions handed down to
     the preview board (`demoAction`), and that board reads every live preference —
     so what the chain produces is the effect of the setting, not a drawing of it.

     `demoTokenRef` retires a chain. Opening a card, closing it, or starting a new
     run bumps the token, and any step still waiting sees a mismatch and goes out
     with it. The manual demo buttons retire it too: a hand-made move leaves the
     position the rest of the script was written against, and its dots would land
     on squares that no longer hold the pieces they expect. */
  function stopDemo() {
    demoTokenRef.current += 1;
    for (const timer of demoTimersRef.current) clearTimeout(timer);
    demoTimersRef.current = [];
    setDemoAction(null);
  }

  /* Runs `fn` unless the chain was retired while it waited. */
  function demoLater(ms, token, fn) {
    const timer = setTimeout(() => {
      demoTimersRef.current = demoTimersRef.current.filter((t) => t !== timer);
      if (token === demoTokenRef.current) fn();
    }, ms);
    demoTimersRef.current.push(timer);
  }

  /* One action for the board. A new nonce is what makes it fire, so the same
     square can be tapped again on the next run of the same script. */
  function act(action) {
    demoNonceRef.current += 1;
    setDemoAction({ ...action, nonce: demoNonceRef.current });
  }

  function runDemo(id) {
    const game = gameRef.current;
    if (!game || !DEMO_SCRIPTS.includes(id)) return;
    /* Every entry point here is a real gesture — a row tap, a switch, a chip —
       which is the only moment a browser honours an audio resume. Without this a
       card that opens and then plays its own move is silent on the first try. */
    unlockAudio();
    stopDemo();
    const token = demoTokenRef.current;

    game.load(id === 'queen' ? PROMOTION_FEN : START_FEN);
    demoStepRef.current = 0;
    repaint();
    /* The board is told to drop its own selection before the script starts, so a
       card replayed a second time does not find the piece the first run left
       selected and read its opening tap as a deselect. */
    act({ kind: 'reset' });

    const later = (ms, fn) => demoLater(ms, token, fn);
    const move = (from, to) => act({ kind: 'move', from, to });
    const tap = (square) => act({ kind: 'select', square });

    if (id === 'anim') later(DEMO_OPEN_MS, () => move('g1', 'f3'));
    else if (id === 'legal') later(DEMO_OPEN_MS, () => tap('g1'));
    else if (id === 'queen') later(DEMO_OPEN_MS, () => move('a7', 'a8'));
    else if (id === 'sound') later(DEMO_OPEN_MS, () => move('e2', 'e4'));
    else if (id === 'vib') later(DEMO_OPEN_MS, () => playMoveEffectHaptics({ type: 'brilliant' }));
    else if (id === 'drag') {
      /* Read when the step runs, not now: this script also replays the moment the
         switch flips, and this click handler's closure still holds the old value.
         On: the knight is carried to f3 in one action. Off: no piece can be
         carried, so the demo is the two taps a player makes instead. */
      later(DEMO_OPEN_MS, () => {
        if (getAllowPieceDrag()) move('g1', 'f3');
        else {
          tap('g1');
          later(DEMO_TAP_MS, () => tap('f3'));
        }
      });
    }
  }

  /* A chain must not outlive the page it was scripted on. */
  useEffect(() => () => stopDemo(), []); // eslint-disable-line react-hooks/exhaustive-deps

  /* Repaints the preview after the position changes from outside the board.
     A move the board makes itself already repaints, so only the demo buttons
     need this. */
  function repaint() {
    setTick((t) => t + 1);
  }

  /* Walks the scripted opening one ply at a time. Once the user has moved
     pieces the script no longer matches the position, so it falls back to any
     legal move and only re-seeds the start position when there is nothing left
     to play — the button must always produce a move. */
  function playDemoMove() {
    const game = gameRef.current;
    if (!game) return;
    stopDemo();
    let made = null;
    try {
      made = game.move(DEMO_LINE[demoStepRef.current % DEMO_LINE.length]);
    } catch {
      made = null;
    }
    demoStepRef.current += 1;
    if (!made) {
      const options = game.moves();
      if (options.length) {
        try {
          made = game.move(options[Math.floor(Math.random() * options.length)]);
        } catch {
          made = null;
        }
      } else {
        game.load(START_FEN);
        demoStepRef.current = 1;
        made = game.move('e4');
      }
    }
    repaint();
  }

  function setupPromotion() {
    const game = gameRef.current;
    if (!game) return;
    stopDemo();
    game.load(PROMOTION_FEN);
    repaint();
  }

  function resetBoard() {
    const game = gameRef.current;
    if (!game) return;
    stopDemo();
    game.load(START_FEN);
    demoStepRef.current = 0;
    repaint();
  }

  const { width: viewportWidth, height: viewportHeight } = useViewportSize();
  /* The card is a 440px column until the desktop breakpoint turns it into a wide
     two-panel one (the min-width: 1000px block in index.css — this flag has to
     match it), so the board follows that layout: on a phone it is capped by the
     card it sits in, on a desktop by the stage column it owns. The 1.35 divisor
     is the frame variant's own band, and the height budget is what is left for
     the badge, the board's well and the demo bar — which the pinned stage can
     never be taller than. */
  const desktop = viewportWidth >= 1000;
  const previewWidth = Math.round(Math.max(
    176,
    desktop
      ? Math.min(360, viewportWidth * 0.42 - 100, (viewportHeight - 250) / 1.35)
      : Math.min(272, viewportWidth - 150, (viewportHeight - 314) / 1.35)
  ));

  const status = savedMsg && (
    <p className={`set-status${savedMsg.startsWith('Failed') ? ' is-error' : ''}`} aria-live="polite">
      {savedMsg}
    </p>
  );

  const card = CARDS[popup];

  return (
    <>
      <Page
        title="Settings"
        piece="⚙"
        sub="Personalise your chessboard — the look applies everywhere you play."
        className="settings-page"
      >
        {/* The list-level rows have no card open, so this is where a save from
            the frame toggle gets reported. */}
        {!popup && status}

        <Group cap="Appearance">
          {/* Board theme, piece set and custom squares are one row: a board is
              only ever seen as a theme wearing a set on a colour, so the three
              are picked together against the same preview. */}
          {APPEARANCE_ROWS.map((id) => (
            <NavRow
              key={id}
              icon={CARDS[id].icon}
              label={CARDS[id].label}
              hint={CARDS[id].rowHint}
              value={rowValues[id]}
              onOpen={(el) => openCard(id, el)}
            />
          ))}
        </Group>

        <Group cap="Sound">
          <NavRow
            icon={CARDS.sound.icon}
            label={CARDS.sound.label}
            hint={CARDS.sound.rowHint}
            value={rowValues.sound}
            onOpen={(el) => openCard('sound', el)}
          />
          {/* Vibration rides the MoveEffect timeline (a tick on landing, then a
              short swell). Only offered where the Vibration API exists. */}
          {hapticsSupported && (
            <NavRow
              icon={CARDS.vib.icon}
              label={CARDS.vib.label}
              hint={CARDS.vib.rowHint}
              value={rowValues.vib}
              onOpen={(el) => openCard('vib', el)}
            />
          )}
        </Group>
      </Page>

      {/* ── one card per row ──
           Same shape every time: a playable board, the three ways to make it do
           something, and the control this row is about. Only the controls
           change, so nothing has to be relearned between cards. */}
      <Modal
        open={Boolean(card)}
        onClose={closeCard}
        title={card?.label}
        description={card?.desc}
        size="md"
        modalClass="mz-modal-settings"
        layerClass="mz-layer-settings"
        returnFocusRef={triggerRef}
        closeLabel={card ? `Close ${card.label}` : 'Close settings'}
      >
        {card && (
          <>
            {/* Badge, board and control bar travel together: the card keeps them
                pinned while the (often much longer) controls scroll under them,
                so a pick is always made with the board it changes on screen. */}
            <div className="set-stage">
              <p className="set-live">
                <span className="set-live-dot" aria-hidden />
                Live preview · applies instantly
              </p>

              <div className="set-preview">
                <ChessBoard
                  key={popup}
                  game={gameRef.current}
                  mode="game"
                  interactive
                  showLegalMoves
                  orientation="white"
                  boardWidth={previewWidth}
                  allowNativeArrows={false}
                  demoAction={demoAction}
                />
              </div>
            </div>

            {/* Everything that is not the board belongs to the controls column.
                On a phone that column simply continues under the pinned stage;
                on a desktop card the two become side by side (see the
                min-width: 1000px block in index.css), so nothing else in the card
                has to know which layout it is in. */}
            <div className="set-controls">
            <p className="set-note">{card.hint}</p>

            {status}

            {popup === 'look' && (
              <div className="set-card-body">
                <p className="set-cap">Board theme</p>
                <div className="set-chips">
                  {regular.map((t) => (
                    <Chip key={t.id} active={t.id === activeThemeId} disabled={saving} onPick={setTheme} value={t.id}>
                      <ThemeSwatch theme={t} />
                      {t.name}
                    </Chip>
                  ))}
                </div>

                {accessible.length > 0 && (
                  <>
                    <p className="set-cap is-spaced">High-contrast themes</p>
                    <div className="set-chips">
                      {accessible.map((t) => (
                        <Chip key={t.id} active={t.id === activeThemeId} disabled={saving} onPick={setTheme} value={t.id}>
                          <ThemeSwatch theme={t} />
                          {t.name}
                        </Chip>
                      ))}
                    </div>
                    <p className="set-note">
                      High-contrast themes improve piece visibility for low-vision and colour-blind players.
                    </p>
                  </>
                )}

                <p className="set-cap is-spaced">Piece set</p>
                <div className="set-chips">
                  {pieceOptions.map((p) => (
                    <Chip key={p.id} active={p.id === activePieceSet} disabled={saving} onPick={setPieceSet} value={p.id}>
                      <PieceIcon pieceId={p.id} />
                      {p.name}
                    </Chip>
                  ))}
                </div>

                <p className="set-cap is-spaced">Custom square colors</p>
                <BoardColorSettings
                  colors={boardColors}
                  hasCustom={hasCustomBoardColors}
                  onApply={(light, dark) => updatePrefs({ boardLightColor: light, boardDarkColor: dark })}
                />
              </div>
            )}

            {popup === 'frame' && (
              <SwitchRow
                label="Show the frame"
                hint={boardFrame ? 'Frame and coordinates shown' : 'Bare board — more space, same theme'}
                checked={Boolean(boardFrame)}
                disabled={saving}
                onChange={setBoardFrame}
              />
            )}

            {popup === 'anim' && (
              <div className="set-chips">
                {ANIMATION_ORDER.map((id) => (
                  <Chip
                    key={id}
                    active={id === animationId}
                    onPick={pickAnimation}
                    value={id}
                    title={BOARD_ANIMATION_PRESETS[id].description}
                  >
                    {BOARD_ANIMATION_PRESETS[id].name}
                  </Chip>
                ))}
              </div>
            )}

            {popup === 'legal' && (
              <SwitchRow
                label="Show legal moves"
                hint="Off hides the dots and rings on every board; you can still select and move a piece"
                checked={showLegalMoves}
                onChange={(next) => { setShowLegalMoves(next); runDemo('legal'); }}
              />
            )}

            {popup === 'drag' && (
              <SwitchRow
                label="Allow dragging"
                hint="Off means every move is made by tapping a piece and then a square"
                checked={allowPieceDrag}
                onChange={(next) => { setAllowPieceDrag(next); runDemo('drag'); }}
              />
            )}

            {popup === 'queen' && (
              <SwitchRow
                label="Promote straight to a Queen"
                hint="Off keeps the picker, so you can under-promote to a Rook, Bishop or Knight"
                checked={autoQueen}
                onChange={(next) => { setAutoQueen(next); runDemo('queen'); }}
              />
            )}

            {popup === 'sound' && (
              <div className="set-card-body">
                <SwitchRow
                  label="Move sounds"
                  hint="Off mutes every cue in the app, on this device"
                  checked={soundOn}
                  onChange={(next) => { setSoundOn(next); runDemo('sound'); }}
                />
                <div className="set-volume-row">
                  <label htmlFor="set-volume" className="set-volume-label">Volume</label>
                  <span className="set-volume-value tabular-nums">{Math.round(volume * 100)}%</span>
                </div>
                <input
                  id="set-volume"
                  type="range"
                  className="chess-range set-volume"
                  min="0"
                  max="2"
                  step="0.05"
                  value={volume}
                  disabled={!soundOn}
                  onChange={(e) => sampleVolume(Number(e.target.value))}
                  aria-label="Sound volume"
                />
                <p className="set-note">100% = as designed. Up to 200%.</p>
                <div className="set-actions">
                  {/* Plays a real move cue inside the click gesture, so it doubles
                      as the "is audio allowed at all in this browser?" check. */}
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="set-test"
                    disabled={!soundOn}
                    onClick={() => { unlockAudio(); playSound('move'); }}
                  >
                    🔊 Test sound
                  </Button>
                </div>
              </div>
            )}

            {popup === 'vib' && (
              <div className="set-card-body">
                <SwitchRow
                  label="Vibration"
                  hint="Off stops every move pulse"
                  checked={haptics}
                  onChange={(next) => { setHaptics(next); runDemo('vib'); }}
                />
                <p className="set-cap is-spaced">Strength</p>
                <div className="set-chips">
                  {HAPTIC_STRENGTHS.map((s) => (
                    <Chip
                      key={s.id}
                      active={s.id === hapticStrength}
                      onPick={(id) => { setHapticStrength(id); runDemo('vib'); }}
                      value={s.id}
                    >
                      {s.label}
                    </Chip>
                  ))}
                </div>
                <div className="set-actions">
                  {/* The app's own pulse: the same pattern, delay and strength
                     scaling a real brilliant move plays, so the test is honest. */}
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="set-test"
                    disabled={!haptics}
                    onClick={() => playMoveEffectHaptics({ type: 'brilliant' })}
                  >
                    ◉ Test pulse
                  </Button>
                </div>
                {!haptics && <p className="set-note">Turn vibration on to test it.</p>}
              </div>
            )}
            </div>
          </>
        )}
      </Modal>
    </>
  );
}

/* ── the row primitives, shared by every group ── */

/** Grouped-list container: a caption above a rounded, hairline-divided body. */
function Group({ cap, children }) {
  return (
    <div className="set-group">
      <p className="set-group-cap">{cap}</p>
      <div className="set-group-body">{children}</div>
    </div>
  );
}

/** The only row on this page: it opens the card for one setting, and shows the
 *  current value so nothing has to be opened just to read a state. The whole row
 *  is the tap target, which is what makes this usable with a thumb; the element
 *  itself is remembered so the card can hand focus back to it on close. */
function NavRow({ icon, label, hint, value, onOpen }) {
  return (
    <button type="button" className="set-row" onClick={(e) => onOpen(e.currentTarget)}>
      {icon && <span className="set-row-icon" aria-hidden>{icon}</span>}
      <span className="set-row-text">
        <span className="set-row-label">{label}</span>
        {hint && <span className="set-row-hint">{hint}</span>}
      </span>
      {value && <span className="set-row-value">{value}</span>}
      <span className="set-row-chevron" aria-hidden>›</span>
    </button>
  );
}

/** A labelled switch inside a card — the same control the list used to carry
 *  inline, now with room for the hint that explains what it does. */
function SwitchRow({ label, hint, checked, onChange, disabled }) {
  return (
    <label className="set-toggle">
      <span className="set-row-text">
        <span className="set-row-label">{label}</span>
        {hint && <span className="set-row-hint">{hint}</span>}
      </span>
      <input
        type="checkbox"
        className="set-switch"
        checked={Boolean(checked)}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

/** A chip is one choice in a wrapping row: pressed state is the applied value,
 *  so the whole list reads as "which of these is on" at a glance. */
function Chip({ active, value, onPick, disabled, title, children }) {
  return (
    <button
      type="button"
      className={`set-chip-btn${active ? ' is-active' : ''}`}
      aria-pressed={active}
      disabled={disabled}
      title={title}
      onClick={() => onPick(value)}
    >
      {children}
    </button>
  );
}

/** The two squares of a theme, as the chip sees them. The textured and
 *  ornate themes are still identified by name in the chip and shown properly by
 *  the playable board above. */
function ThemeSwatch({ theme }) {
  return (
    <span
      className="set-chip-swatch"
      aria-hidden
      style={{ backgroundImage: `linear-gradient(135deg, ${theme.lightSq} 50%, ${theme.darkSq} 50%)` }}
    />
  );
}

/* One knight is enough to tell two piece sets apart, and it keeps a chip the
   height of its text instead of a column of glyphs. It is always the BLACK
   knight: every offered set paints its white pieces near-white, which vanishes
   on a white chip, while the black side carries the set's tint, glow and font.
   The wrapper is what aligns the four kinds of artwork — the SVG sets take no
   className of their own. */
function PieceIcon({ pieceId, size = 20 }) {
  const theme = getPieceTheme(pieceId);
  return (
    <span className="set-chip-piece" aria-hidden>
      {theme.type === 'png' || theme.type === 'img' ? (
        <img src={theme.images.bN} alt="" draggable={false} width={size} height={size} />
      ) : theme.type === 'faced' ? (
        <FacedPiece type="n" side="b" size={size} />
      ) : theme.type === 'royal' ? (
        <RoyalPiece type="n" side="b" size={size} />
      ) : (
        <span style={pieceGlyphStyle(theme, 'bN', size)}>{GLYPHS.bN}</span>
      )}
    </span>
  );
}

/* The board size only matters while a card is open, but a phone rotated or a
   window resized mid-card must not leave the board wider than the card, or the
   pinned stage taller than the card itself. */
function useViewportSize() {
  const [size, setSize] = useState(() => ({
    width: typeof window === 'undefined' ? 360 : window.innerWidth,
    height: typeof window === 'undefined' ? 640 : window.innerHeight,
  }));
  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return size;
}

/* ── custom square colours ── */

const BOARD_COLOR_DEFAULTS = { light: '#EEEED2', dark: '#769656' };
const BOARD_COLOR_THEMES = [
  { name: 'Classic Green', light: '#EEEED2', dark: '#769656' },
  { name: 'Brown Wood', light: '#F0D9B5', dark: '#B58863' },
  { name: 'Ocean Blue', light: '#DEE3E6', dark: '#8CA2AD' },
  { name: 'Lilac Haze', light: '#E8E0F7', dark: '#9C86D4' },
  { name: 'Slate Gray', light: '#D9D9D9', dark: '#7A7A7A' },
  { name: 'Rose', light: '#F6DDE0', dark: '#C77D8A' },
  { name: 'Sand', light: '#F2E6C9', dark: '#C9A96B' },
];

function hexToHsv(hex) {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16) / 255;
  const g = parseInt(value.slice(2, 4), 16) / 255;
  const b = parseInt(value.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  let h = 0;
  if (delta) {
    if (max === r) h = 60 * (((g - b) / delta) % 6);
    else if (max === g) h = 60 * ((b - r) / delta + 2);
    else h = 60 * ((r - g) / delta + 4);
  }
  if (h < 0) h += 360;
  return { h, s: max === 0 ? 0 : delta / max, v: max };
}

function hsvToHex(h, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const rgb = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return `#${rgb.map((n) => Math.round((n + m) * 255).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

/** The custom-square section of the Board & Pieces card — panel content only.
 *  The card owns the title, the close button and the playable board, so the
 *  wheel, the two square colours and the quick palettes are all that live here.
 *  Nothing repaints the board until Apply, because the colours a user is
 *  composing are not applied colours yet. */
function BoardColorSettings({ colors, onApply, hasCustom }) {
  const { showToast } = useToast();
  const [draft, setDraft] = useState(colors || BOARD_COLOR_DEFAULTS);
  const [activeSquare, setActiveSquare] = useState('light');
  const [hexInput, setHexInput] = useState((colors || BOARD_COLOR_DEFAULTS).light);
  const [saving, setSaving] = useState(false);
  const wheelRef = useRef(null);
  const currentHex = draft[activeSquare];
  const hsv = useMemo(() => hexToHsv(currentHex), [currentHex]);
  const sameSquares = draft.light.toUpperCase() === draft.dark.toUpperCase();
  const pinAngle = ((hsv.h - 90) * Math.PI) / 180;
  const pinStyle = {
    left: `${50 + Math.cos(pinAngle) * hsv.s * 50}%`,
    top: `${50 + Math.sin(pinAngle) * hsv.s * 50}%`,
  };

  useEffect(() => setHexInput(draft[activeSquare]), [draft, activeSquare]);

  useEffect(() => {
    const canvas = wheelRef.current;
    if (!canvas) return;
    const size = 352;
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    const image = context.createImageData(size, size);
    const center = (size - 1) / 2;
    const radius = size / 2 - 2;
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const dx = x - center, dy = y - center;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const i = (y * size + x) * 4;
        if (distance > radius) { image.data[i + 3] = 0; continue; }
        let hue = (Math.atan2(dy, dx) * 180 / Math.PI + 90 + 360) % 360;
        const rgbHex = hsvToHex(hue, Math.min(1, distance / radius), hsv.v).slice(1);
        image.data[i] = parseInt(rgbHex.slice(0, 2), 16);
        image.data[i + 1] = parseInt(rgbHex.slice(2, 4), 16);
        image.data[i + 2] = parseInt(rgbHex.slice(4, 6), 16);
        image.data[i + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);
  }, [hsv.v]);

  useEffect(() => {
    const wheel = document.getElementById('board-color-wheel');
    if (!wheel) return;
    wheel.setAttribute('aria-valuetext', `${Math.round(hsv.h)} degrees hue, ${Math.round(hsv.s * 100)} percent saturation`);
  }, [hsv.h, hsv.s]);

  const changeActiveColor = (hex) => setDraft((d) => ({ ...d, [activeSquare]: hex }));
  const pickWheel = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left - rect.width / 2;
    const y = event.clientY - rect.top - rect.height / 2;
    const radius = rect.width / 2;
    const distance = Math.min(radius, Math.sqrt(x * x + y * y));
    const hue = (Math.atan2(y, x) * 180 / Math.PI + 90 + 360) % 360;
    changeActiveColor(hsvToHex(hue, distance / radius, hsv.v));
  };
  const handleWheelKey = (event) => {
    const amount = event.shiftKey ? 0.01 : 0.04;
    let { h, s } = hsv;
    if (event.key === 'ArrowLeft') h = (h - 4 + 360) % 360;
    else if (event.key === 'ArrowRight') h = (h + 4) % 360;
    else if (event.key === 'ArrowUp') s = Math.min(1, s + amount);
    else if (event.key === 'ArrowDown') s = Math.max(0, s - amount);
    else return;
    event.preventDefault();
    changeActiveColor(hsvToHex(h, s, hsv.v));
  };

  const apply = async (light, dark, reset = false) => {
    setSaving(true);
    try {
      await onApply(light, dark);
      setDraft({ light, dark });
      showToast(reset ? 'Board color reset successfully' : 'Board color applied successfully', { tone: 'success', title: 'Board Color' });
    } catch {
      // updatePrefs keeps the optimistic color on this device when the API is
      // unavailable, so the visible board has still been updated successfully.
      setDraft({ light, dark });
      showToast(reset ? 'Board color reset successfully' : 'Board color applied successfully', { tone: 'success', title: 'Board Color' });
    } finally { setSaving(false); }
  };

  const sliderFill = hsvToHex(hsv.h, hsv.s, 1);
  return (
    <div className="board-color-panel">
      <div className="board-color-wheel-column">
        <div className="board-color-wheel-wrap">
          <canvas
            ref={wheelRef}
            id="board-color-wheel"
            className="board-color-wheel"
            role="slider"
            aria-label="Color wheel: use arrow keys to adjust hue and saturation"
            aria-valuemin={0}
            aria-valuemax={360}
            tabIndex={0}
            onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); pickWheel(event); }}
            onPointerMove={(event) => { if (event.buttons || event.pressure > 0) pickWheel(event); }}
            onKeyDown={handleWheelKey}
          />
          <span className="board-color-wheel-pin" style={pinStyle} aria-hidden />
        </div>
        <p className="board-color-wheel-help">Drag to choose hue and saturation</p>
      </div>
      <div className="board-color-controls">
        <div className="board-color-tabs" role="group" aria-label="Choose square color">
          {['light', 'dark'].map((side) => (
            <button key={side} type="button" aria-pressed={activeSquare === side} onClick={() => setActiveSquare(side)}>
              {side === 'light' ? 'Light squares' : 'Dark squares'}
            </button>
          ))}
        </div>
        <label className="board-color-brightness">
          <span>Brightness <strong>{Math.round(hsv.v * 100)}%</strong></span>
          <input
            type="range" min="0" max="100" value={Math.round(hsv.v * 100)}
            aria-label="Brightness"
            style={{ '--board-color-slider': `linear-gradient(90deg, #000 0%, ${sliderFill} 100%)` }}
            onChange={(event) => changeActiveColor(hsvToHex(hsv.h, hsv.s, Number(event.target.value) / 100))}
          />
        </label>
        <div className="board-color-hex-block">
          <label className="board-color-hex-label" htmlFor="board-color-hex">Hex color</label>
          <div className="board-color-hex-row">
            <span className="board-color-chip" style={{ backgroundColor: currentHex }} aria-hidden />
            <input
              id="board-color-hex" className="board-color-hex" value={hexInput}
              aria-label={`${activeSquare === 'light' ? 'Light' : 'Dark'} square hex color`}
              onChange={(event) => {
                const raw = event.target.value;
                setHexInput(raw);
                const clean = raw.startsWith('#') ? raw : `#${raw}`;
                if (/^#[0-9A-Fa-f]{6}$/.test(clean)) changeActiveColor(clean.toUpperCase());
              }}
              onBlur={() => { if (!/^#?[0-9A-Fa-f]{6}$/.test(hexInput)) setHexInput(currentHex); }}
            />
          </div>
        </div>
      </div>
      <div className="board-color-themes">
        <p className="set-cap">Quick themes</p>
        <div>
          {BOARD_COLOR_THEMES.map((theme) => (
            <button
              type="button" key={theme.name} title={theme.name} aria-label={theme.name}
              onClick={() => setDraft({ light: theme.light, dark: theme.dark })}
              className={draft.light === theme.light && draft.dark === theme.dark ? 'selected' : ''}
            >
              <span style={{ backgroundColor: theme.light }} />
              <span style={{ backgroundColor: theme.dark }} />
            </button>
          ))}
        </div>
      </div>
      {sameSquares && <p className="board-color-error" role="alert">Light and dark squares need different colors</p>}
      <div className="board-color-actions">
        <Button type="button" variant="primary" size="sm" disabled={saving || sameSquares} loading={saving} onClick={() => apply(draft.light, draft.dark)}>Apply</Button>
        <Button type="button" variant="secondary" size="sm" disabled={saving} onClick={() => {
          setActiveSquare('light');
          setDraft(BOARD_COLOR_DEFAULTS);
          apply(BOARD_COLOR_DEFAULTS.light, BOARD_COLOR_DEFAULTS.dark, true);
        }}>Reset to default</Button>
      </div>
      <p className="set-note">
        {hasCustom
          ? 'Custom squares are applied — they are what the board above is wearing.'
          : 'A theme is applied. Press Apply to put your own squares on the board above.'}
      </p>
    </div>
  );
}
