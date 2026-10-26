import { useMemo, useState } from 'react';
import { useUrlTab } from '../hooks/useUrlTab';
import AnimatedBoard from '../components/board/AnimatedBoard';
import useArrowKeys from '../hooks/useArrowKeys';
import { Page, Piece } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useSound } from '../context/SoundContext';
import { BOARD_THEMES, BOARD_THEMES_HIDDEN_IN_SETTINGS, getBoardTheme, getBoardThemeStyles } from '../config/boardThemes';
import { PIECE_THEMES, PIECE_THEMES_HIDDEN_IN_SETTINGS, GLYPHS, getPieceTheme, pieceGlyphStyle, buildCustomPieces } from '../config/pieceTheme';
import { marbledSquareStyle } from '../config/ornateTheme';
import { BOARD_ANIMATION_PRESETS, useBoardAnimationId, setBoardAnimation } from '../config/boardAnimation';
import { useShowLegalMoves, setShowLegalMoves } from '../config/legalMoves';
import { setAllowPieceDrag, useAllowPieceDrag } from '../config/pieceDrag';
import { useAutoQueen, setAutoQueen } from '../config/autoQueen';
import {
  useHaptics,
  setHaptics,
  isHapticsSupported,
  useHapticStrength,
  HAPTIC_STRENGTHS,
} from '../config/haptics';
import { FacedPiece } from '../components/FacedPiece';
import { RoyalPiece } from '../components/RoyalPieces';
import Button from '../components/Button';

const PREVIEW_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/* Board theme and piece set are picked on ONE page under ONE preview, so the
   combination you are choosing is the thing on screen. The root list is the
   mobile idiom (grouped rows, value + chevron, drill into a sub-page). */

/** Tiny static board preview for a specific theme + piece set. */
export function ThemePreview({ themeId, pieceSet, size = 160 }) {
  const theme = getBoardTheme(themeId);
  const marbleSquares = useMemo(() => {
    if (!theme.ornate) return null;
    const s = {};
    for (let f = 0; f < 8; f++) {
      for (let r = 0; r < 8; r++) {
        const isDark = (f + r) % 2 === 0;
        s['abcdefgh'[f] + (r + 1)] = marbledSquareStyle(isDark ? theme.darkSq : theme.lightSq, isDark, theme);
      }
    }
    return s;
  }, [theme]);
  const customPieces = useMemo(() => buildCustomPieces(getPieceTheme(pieceSet || 'cburnett')), [pieceSet]);
  const themeStyles = getBoardThemeStyles(theme);
  return (
    <AnimatedBoard
      position={PREVIEW_FEN}
      boardWidth={size}
      boardOrientation="white"
      arePiecesDraggable={false}
      arePiecesAnimated={false}
      animationDuration={0}
      showNotation={false}
      customPieces={customPieces}
      customDarkSquareStyle={themeStyles.darkSquareStyle || { backgroundColor: theme.darkSq }}
      customLightSquareStyle={themeStyles.lightSquareStyle || { backgroundColor: theme.lightSq }}
      customSquareStyles={marbleSquares || undefined}
      customBoardStyle={
        themeStyles.boardStyle || {
          borderRadius: '10px',
          overflow: 'hidden',
          boxShadow: '0 8px 18px rgba(0,0,0,0.25)',
          /* Mirrors the real board's ornate edge, so a themed board in the
             picker looks the same as it will once applied. */
          ...(theme.ornate ? { border: '2px solid rgba(96,165,250,0.8)' } : {}),
        }
      }
    />
  );
}

export default function Settings() {
  const { boardTheme, pieceSet, boardFrame, updatePrefs } = useAuth();
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  /* The same app-wide preference the Play Arena's toggle writes to, so sound is
     adjustable from the page a user actually goes to for preferences. */
  const { soundOn, setSoundOn, volume, setVolume, playSound, unlockAudio } = useSound();

  /* Which settings sub-page is open, or `null` for the root list.
     Settings follows the same model as a phone's Settings app: one root list of
     grouped rows, and tapping a row drills into a sub-page with a back button.
     It used to open straight onto the Board panel with a live board already
     rendered, so arriving at the page dumped you into the most expensive view
     and the controls read as one long form instead of as navigation. */
  const [view, setView] = useUrlTab('view', null);

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

  // Live preview shows the *currently applied* selection.
  const selectable = BOARD_THEMES.filter((t) => !BOARD_THEMES_HIDDEN_IN_SETTINGS.has(t.id));
  const regular = selectable.filter((t) => !t.accessibility);
  const accessible = selectable.filter((t) => t.accessibility);

  // Only the non-hidden piece sets are offered in the Settings picker.
  const pieceOptions = Object.values(PIECE_THEMES).filter(
    (p) => !PIECE_THEMES_HIDDEN_IN_SETTINGS.has(p.id)
  );

  const themeName = getBoardTheme(activeThemeId).name;
  const pieceName = getPieceTheme(activePieceSet || 'cburnett').name;
  const animationId = useBoardAnimationId();
  const animationPreset = BOARD_ANIMATION_PRESETS[animationId] || BOARD_ANIMATION_PRESETS.glide;
  const showLegalMoves = useShowLegalMoves();
  const allowPieceDrag = useAllowPieceDrag();
  const autoQueen = useAutoQueen();
  const haptics = useHaptics();
  const [hapticStrength, setHapticStrength] = useHapticStrength();

  /* ── the one shared ◀ Prev / Next ▶ pair ──
     Both lists sit on this page, so a bare pair of arrows would have to guess
     which one to move — that ambiguity is the whole reason this used to be two
     separate tabs. The fix is not two pairs of arrows (back to the old
     "which one did I just tap?" problem) but ONE pair with an explicit target
     selector inside the same row, so what the arrows will do is always stated
     before you press them.

     The cursor is DERIVED from the applied selection, not stored. Stepping
     applies the change immediately, so the selection and the cursor can never
     disagree — no index state, no sync effect, nothing to fall out of step when
     the theme is changed from somewhere else. */
  const [stepTarget, setStepTarget] = useState('board');

  /* Step over `selectable` (regular + high-contrast), NOT `regular`. Anything
     visible on this page must be reachable by the arrows, and it also keeps
     findIndex from returning -1: with a high-contrast theme applied, a
     `regular`-only list would put the cursor on Classic Green while
     Hi-Contrast was actually applied — the stepper would lie. */
  const themeIdx = Math.max(0, selectable.findIndex((t) => t.id === activeThemeId));
  const pieceIdx = Math.max(0, pieceOptions.findIndex((p) => p.id === activePieceSet));

  function stepTheme(delta) {
    if (!selectable.length) return;
    setTheme(selectable[(themeIdx + delta + selectable.length) % selectable.length].id);
  }
  function stepPiece(delta) {
    if (!pieceOptions.length) return;
    setPieceSet(pieceOptions[(pieceIdx + delta + pieceOptions.length) % pieceOptions.length].id);
  }

  /* ← / → drive the SAME stepper the ◀ / ▶ buttons drive.
     This used to do nothing at all: Settings was the only board-navigating page
     in the app with no `useArrowKeys` binding, so the arrows that step every
     other board (replay, review, chess profile, library, openings) were dead
     here. The keys are enabled only on the "Board & Pieces" sub-page — the only
     place there is anything to step — and `stepTarget` picks which list moves,
     so the keyboard cannot disagree with the on-screen target selector.
     A save in flight is not re-checked here on purpose: the buttons don't
     disable either, and the stepper derives its cursor from the APPLIED
     selection, so holding the key simply keeps stepping from where it lands. */
  useArrowKeys(
    () => (stepTarget === 'board' ? stepTheme(-1) : stepPiece(-1)),
    () => (stepTarget === 'board' ? stepTheme(1) : stepPiece(1)),
    { enabled: view === 'look' },
  );

  const onBoard = stepTarget === 'board';
  const stepName = onBoard ? selectable[themeIdx]?.name : pieceOptions[pieceIdx]?.name;

  /* The board and the pieces are chosen together on one page, so they share a
     single live preview: a theme only makes sense next to the set it will be
     seen with, and one board shows both at once. */
  const preview = (
    <div className="flex items-center justify-center pb-3 mb-3">
      <div className="text-center">
        <ThemePreview
          themeId={activeThemeId}
          pieceSet={activePieceSet}
          size={Math.max(180, Math.min(300, (typeof window !== 'undefined' ? window.innerWidth : 360) - 96))}
        />
        <p className="mt-3 text-xs text-ivory-500">Live preview · {themeName} + {pieceName}</p>
      </div>
    </div>
  );

  const backBar = (label) => (
    <button type="button" className="set-back" onClick={() => setView(null)}>
      <span aria-hidden>‹</span> {label}
    </button>
  );

  const saveNote = savedMsg && (
    <p className={`text-sm text-center mb-4 ${savedMsg.startsWith('Failed') ? 'chess-error' : 'chess-link'}`}>
      {savedMsg}
    </p>
  );

  return (
    <Page title="Settings" piece="⚙" sub="Personalise your chessboard — the look applies everywhere you play.">
      {/* ── ROOT: the list, exactly like a phone's Settings app ──
          Grouped rows, no board, nothing heavy rendered. Each row either shows
          its current value or drills into a sub-page. */}
      {view === null && (
        <>
          {saveNote}

          <Group cap="Appearance">
            {/* One row for the whole look. Board theme and piece set are two
                halves of the same choice — a theme is only ever seen with a
                piece set — so they open together instead of as two rows that
                each hide half the result. */}
            <NavRow
              icon="🎨"
              label="Board &amp; Pieces"
              hint="Theme and piece set, chosen together"
              value={`${themeName} · ${pieceName}`}
              onClick={() => setView('look')}
            />
            {/* Board Frame is its own row with its own pair of buttons. It used
                to be a checkbox buried inside the Board panel, where it was easy
                to miss and looked like part of the theme picker. Two explicit
                buttons make both choices visible and each is a single tap. */}
            <div className="set-row">
              <span className="set-row-icon" aria-hidden>🖼</span>
              <span className="set-row-text">
                <span className="set-row-label">Board Frame</span>
                <span className="set-row-hint">
                  {boardFrame
                    ? 'Plinth, gold trim and coordinates shown'
                    : 'Bare board — more space, same theme'}
                </span>
              </span>
              <div className="set-seg" role="group" aria-label="Board frame">
                <button
                  type="button"
                  aria-pressed={boardFrame}
                  disabled={saving}
                  onClick={() => setBoardFrame(true)}
                >
                  On
                </button>
                <button
                  type="button"
                  aria-pressed={!boardFrame}
                  disabled={saving}
                  onClick={() => setBoardFrame(false)}
                >
                  Off
                </button>
              </div>
            </div>
            <NavRow
              icon="⚡"
              label="Board Animation"
              hint="How pieces travel when a move is played"
              value={animationPreset.name}
              onClick={() => setView('anim')}
            />
            {/* Master switch for the legal-move hints. Off hides the dots/rings
                on every board, but a piece can still be selected and moved. */}
            <SwitchRow
              icon="💡"
              label="Show Legal Moves"
              hint="Highlight possible moves when you select a piece"
              checked={showLegalMoves}
              onChange={setShowLegalMoves}
            />
            {/* Gesture switch: when off (default) pieces move by tapping a piece
                then a destination; when on, pieces can also be dragged. */}
            <SwitchRow
              icon="✋"
              label="Drag Pieces"
              hint="Drag pieces to move them instead of tapping"
              checked={allowPieceDrag}
              onChange={setAllowPieceDrag}
            />
            {/* Promotion shortcut: skip the picker and always promote to a
                Queen. Off by default so the player still chooses. */}
            <SwitchRow
              icon="♛"
              label="Auto-queen"
              hint="Promote pawns to a Queen automatically, without asking"
              checked={autoQueen}
              onChange={setAutoQueen}
            />
          </Group>

          <Group cap="Sound">
            <SwitchRow
              icon="🔊"
              label="Move Sounds"
              hint="Knocks, captures, castling, check"
              checked={soundOn}
              onChange={setSoundOn}
            />
            <NavRow
              icon="🎚"
              label="Volume"
              value={`${Math.round(volume * 100)}%`}
              onClick={() => setView('sound')}
            />
            {/* Vibration rides the MoveEffect timeline (a tick on landing, then
                a short swell). Only offered where the Vibration API exists. */}
            {isHapticsSupported() && (
              <>
                <SwitchRow
                  icon="◉"
                  label="Vibration"
                  hint="A short pulse on brilliant, mate and promotion moves"
                  checked={haptics}
                  onChange={setHaptics}
                />
                {haptics && (
                  <div className="set-row">
                    <span className="set-row-icon" aria-hidden>≋</span>
                    <span className="set-row-text">
                      <span className="set-row-label">Vibration Strength</span>
                      <span className="set-row-hint">How long each pulse stays on</span>
                    </span>
                    <div className="set-seg" role="group" aria-label="Vibration strength">
                      {HAPTIC_STRENGTHS.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          aria-pressed={hapticStrength === s.id}
                          onClick={() => setHapticStrength(s.id)}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </Group>
        </>
      )}

      {/* ── Board & Pieces: ONE page ──
          Both pickers live in the same card under a single live preview, so the
          combination you are actually going to see is on screen while you
          choose. They used to be two separate drill-downs, which meant picking
          a theme, going back, then picking pieces and never seeing the two
          together. */}
      {view === 'look' && (
        <>
          {backBar('Settings')}
          <h2 className="set-sub-title">Board &amp; Pieces</h2>
          {saveNote}
          <div className="chess-card">
            {preview}

            <div className="set-stepper">
              <div className="set-seg set-stepper-target" role="group" aria-label="Choose what the arrows move">
                <button
                  type="button"
                  onClick={() => setStepTarget('board')}
                  aria-pressed={onBoard}
                >
                  Board Theme
                </button>
                <button
                  type="button"
                  onClick={() => setStepTarget('pieces')}
                  aria-pressed={!onBoard}
                >
                  Piece Set
                </button>
              </div>
              <div className="set-stepper-nav">
                <button
                  type="button"
                  className="set-stepper-btn"
                  aria-label={`Previous ${onBoard ? 'board theme' : 'piece set'}`}
                  aria-keyshortcuts="ArrowLeft"
                  title="Previous (←)"
                  onClick={() => (onBoard ? stepTheme(-1) : stepPiece(-1))}
                >
                  ◀
                </button>
                <span className="set-stepper-name" aria-live="polite">{stepName}</span>
                <button
                  type="button"
                  className="set-stepper-btn"
                  aria-label={`Next ${onBoard ? 'board theme' : 'piece set'}`}
                  aria-keyshortcuts="ArrowRight"
                  title="Next (→)"
                  onClick={() => (onBoard ? stepTheme(1) : stepPiece(1))}
                >
                  ▶
                </button>
              </div>
            </div>

            <p className="text-xs uppercase tracking-wider text-ivory-500 font-semibold mb-2">Board Theme</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {regular.map((t) => (
                <ThemeOption key={t.id} theme={t} active={t.id === activeThemeId} saving={saving} onPick={setTheme} pieceSet={activePieceSet} />
              ))}
            </div>

            {accessible.length > 0 && (
              <>
                <p className="text-xs uppercase tracking-wider text-ivory-500 font-semibold mt-6 mb-2">High-contrast themes</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {accessible.map((t) => (
                    <ThemeOption key={t.id} theme={t} active={t.id === activeThemeId} saving={saving} onPick={setTheme} pieceSet={activePieceSet} />
                  ))}
                </div>
                <p className="text-xs text-ivory-500 mt-2">High-contrast themes improve piece visibility for low-vision and colour-blind players.</p>
              </>
            )}

            <div className="pt-5 mt-6 border-t border-ivory-700/40">
              <p className="text-xs uppercase tracking-wider text-ivory-500 font-semibold mb-2">Piece Set</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {pieceOptions.map((p) => (
                  <PieceOption key={p.id} p={p} active={p.id === activePieceSet} saving={saving} onPick={setPieceSet} />
                ))}
              </div>
              <p className="text-xs text-ivory-500 mt-3">
                Every set renders with its own colours &amp; glow and applies instantly across the whole app.
              </p>
            </div>
          </div>
        </>
      )}

      {/* ── Board Animation sub-page ──
          Four presets, one tap each. The choice is a display preference, so it
          is stored per user on this device and every board reads it live. */}
      {view === 'anim' && (
        <>
          {backBar('Settings')}
          <h2 className="set-sub-title">Board Animation</h2>
          {saveNote}
          <div className="chess-card">
            <div className="flex flex-col gap-2">
              {['glide', 'spring', 'snap', 'off'].map((id) => {
                const p = BOARD_ANIMATION_PRESETS[id];
                const active = animationId === id;
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      setBoardAnimation(id);
                      setSavedMsg(`Board animation set to ${p.name}.`);
                    }}
                    className="flex items-center justify-between px-3 py-2.5 rounded-lg text-left"
                    style={{
                      border: `1px solid ${active ? 'rgba(59, 130, 246, 0.65)' : 'rgba(37, 99, 235, 0.2)'}`,
                      background: active ? 'rgba(59, 130, 246, 0.16)' : 'var(--surface-soft)',
                    }}
                  >
                    <span>
                      <span className="block text-sm font-semibold" style={{ color: 'var(--ivory-100)' }}>{p.name}</span>
                      <span className="block text-xs" style={{ color: 'var(--ivory-500)' }}>{p.description}</span>
                    </span>
                    {active && <span aria-hidden style={{ color: '#93c5fd' }}>✓</span>}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-ivory-500 mt-3">
              Applies to every board — play, puzzles, review and the live classroom. &ldquo;Off&rdquo; moves pieces instantly.
            </p>
          </div>
        </>
      )}

      {/* ── Volume sub-page ──
          Sound also lives in the Play Arena; both write the same app-wide
          preference, so the two controls can never disagree. */}
      {view === 'sound' && (
        <>
          {backBar('Settings')}
          <h2 className="set-sub-title">Volume</h2>
          {saveNote}
          <div className="chess-card">
            <div className="flex items-center justify-between">
              <label htmlFor="set-volume" className="text-sm text-ivory-200">Output level</label>
              <span className="text-sm text-ivory-400 tabular-nums">{Math.round(volume * 100)}%</span>
            </div>
            <input
              id="set-volume"
              type="range"
              className="chess-range mt-2"
              min="0"
              max="2"
              step="0.05"
              value={volume}
              disabled={!soundOn}
              onChange={(e) => setVolume(Number(e.target.value))}
              aria-label="Sound volume"
            />
            <p className="text-[11px] leading-snug text-ivory-500 mt-1">
              100% = as designed. Up to 200%.
            </p>

            <div className="pt-4 mt-4 border-t border-ivory-700/40">
              {/* Plays a real move cue inside the click gesture, so it doubles as
                  the "is audio allowed at all in this browser?" check. */}
              <Button
                type="button"
                onClick={() => { unlockAudio(); playSound('move'); }}
                disabled={!soundOn}
                variant="secondary" size="sm" fullWidth className="!py-2 !px-3 text-xs w-full"
              >
                🔊 Test sound
              </Button>
            </div>
          </div>
        </>
      )}
    </Page>
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

/** A row that drills into a sub-page: label + hint on the left, current value
 *  and a chevron on the right. The whole row is the tap target, not just the
 *  text, which is what makes this usable with a thumb. */
function NavRow({ icon, label, hint, value, onClick }) {
  return (
    <button type="button" className="set-row" onClick={onClick}>
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

/** A row with an inline switch — the standard place for a plain on/off
 *  preference, since it needs no sub-page to change it. */
function SwitchRow({ icon, label, hint, checked, onChange }) {
  return (
    <label className="set-row">
      {icon && <span className="set-row-icon" aria-hidden>{icon}</span>}
      <span className="set-row-text">
        <span className="set-row-label">{label}</span>
        {hint && <span className="set-row-hint">{hint}</span>}
      </span>
      <input
        type="checkbox"
        className="set-switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

function ThemeOption({ theme, active, saving, onPick, pieceSet }) {
  return (
    <button
      disabled={saving}
      onClick={() => onPick(theme.id)}
      title={theme.name}
      className={`group rounded-xl border p-3 transition ${
        active
          ? 'border-gold-500/60 bg-gold-700/15 shadow-[0_0_20px_rgba(96,165,250,0.12)]'
          : 'border-ivory-700/50 bg-black/[0.03] hover:border-gold-500/40 hover:bg-black/[0.05]'
      }`}
    >
      <ThemePreview themeId={theme.id} pieceSet={pieceSet} size={120} />
      <p className="mt-2 text-sm font-semibold text-ivory-300 truncate">{theme.name}</p>
      {theme.accessibility && (
        <span className="mt-1 inline-block text-[0.6rem] px-1.5 py-0.5 rounded-full bg-gold-500/10 text-gold-500 border border-gold-500/30">
          High-contrast
        </span>
      )}
      {active && (
        <span className="mt-1 inline-block text-[0.6rem] px-1.5 py-0.5 rounded-full bg-gold-500/15 text-gold-400 border border-gold-500/30">
          Current
        </span>
      )}
    </button>
  );
}

/* Royal-range piece types shown in every swatch row. */
const SWATCH_TYPES = ['K', 'Q', 'R', 'B', 'N', 'P'];

/** Glyph-only preview of a piece set — transparent background (no board, no
    squares). One white row + one black row, styled exactly like the on-board
    pieces via the shared pieceGlyphStyle(). */
function PieceSwatch({ pieceId, base = 16 }) {
  const theme = getPieceTheme(pieceId);
  return (
    <div className="flex flex-col items-center gap-1 leading-none min-h-[3.4rem]" aria-hidden>
      {['w', 'b'].map((side) => (
        <div key={side} className="flex items-center justify-center gap-1.5 leading-none select-none">
          {SWATCH_TYPES.map((pc) => {
            const key = side + pc;
            if (theme.type === 'png' || theme.type === 'img')
              return <img key={pc} src={theme.images[key]} alt="" draggable={false} style={{ width: base * (theme.scale || 0.74), height: base * (theme.scale || 0.74), ...(side === 'b' && theme.blackFilter ? { filter: theme.blackFilter } : {}) }} />;
            if (theme.type === 'faced')
              return <FacedPiece key={pc} type={pc.toLowerCase()} side={side} size={base} />;
            if (theme.type === 'royal')
              return <RoyalPiece key={pc} type={pc.toLowerCase()} side={side} size={base} />;
            return <span key={pc} style={pieceGlyphStyle(theme, key, base)}>{GLYPHS[key]}</span>;
          })}
        </div>
      ))}
    </div>
  );
}

function PieceOption({ p, active, saving, onPick }) {
  return (
    <button
      disabled={saving}
      onClick={() => onPick(p.id)}
      title={p.name}
      className={`group rounded-xl border p-2 text-center transition ${
        active
          ? 'border-gold-500/60 bg-gold-700/15 shadow-[0_0_20px_rgba(96,165,250,0.12)]'
          : 'border-ivory-700/50 bg-black/[0.03] hover:border-gold-500/40 hover:bg-black/[0.05]'
      }`}
    >
      <PieceSwatch pieceId={p.id} />
      <p className="mt-1.5 text-sm font-semibold text-ivory-300 truncate">{p.name}</p>
      {active && (
        <span className="mt-1 inline-block text-[0.6rem] px-1.5 py-0.5 rounded-full bg-gold-500/15 text-gold-400 border border-gold-500/30">
          Current
        </span>
      )}
    </button>
  );
}
