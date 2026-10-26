import { useState } from 'react';
import ChessAvatar from './ChessAvatar';
import Background from '../avatar-assets/backgrounds/Background';
import { SVG_VIEWBOX } from '../avatar-assets/shared';
import {
  PIECE_OPTIONS,
  FACE_OPTIONS,
  ACCESSORY_OPTIONS,
  BODY_COLORS,
  BACKGROUND_OPTIONS,
  defaultChessConfig,
  randomChessConfig,
  DEFAULT_CONFIG,
} from '../utils/avatar';
import Button from './Button';

const PREVIEW_STYLE = {
  basePiece: 'pawn',
  bodyColor: '#4a90d9',
  face: 'happy',
  accessory: 'none',
  background: '#ffd966',
};

function SectionTitle({ children }) {
  return (
    <p className="text-[0.65rem] uppercase tracking-wider text-ivory-500 font-semibold mb-1.5 mt-1">
      {children}
    </p>
  );
}

function swatchRing(active) {
  return active
    ? 'ring-2 ring-gold-300 scale-105 bg-gold-500/20'
    : 'bg-black/5 hover:bg-black/5';
}

export default function AvatarBuilder({ config, onSave, onClose }) {
  const [step, setStep] = useState('piece'); // 'piece' | 'style'
  const [draft, setDraft] = useState(() => {
    const saved = config && config.basePiece ? config : defaultChessConfig('student');
    return { ...DEFAULT_CONFIG, ...saved };
  });

  const set = (key, value) => setDraft((d) => ({ ...d, [key]: value }));

  const pickPiece = (value) => {
    set('basePiece', value);
    setStep('style');
  };

  return (
    <div className="fixed inset-0 z-[var(--z-modal-backdrop)] overflow-y-auto bg-black/60 grid place-items-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg chess-card !p-5 my-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display text-lg font-bold text-ivory-100">♟ Build Your Avatar</h3>
          <button type="button" onClick={onClose} className="text-ivory-500 hover:text-gold-400 text-xl leading-none" title="Close">✕</button>
        </div>

        {/* live preview */}
        <div className="flex items-center gap-4 mb-5">
          <span className="relative">
            <ChessAvatar config={draft} size={112} className="ring-4 ring-gold-500/40 shadow-[0_0_32px_rgba(59,130,246,0.35)]" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ivory-300">Live preview</p>
            <p className="text-xs text-ivory-500">Pick a piece to get started, then style it your way.</p>
            <p className="text-xs text-ivory-500 mt-1">
              {step === 'piece' ? 'Step 1 of 2 · Choose your piece' : 'Step 2 of 2 · Make it yours'}
            </p>
          </div>
        </div>

        {step === 'piece' ? (
          <>
            <SectionTitle>Choose your piece</SectionTitle>
            <div className="grid grid-cols-3 gap-2.5 mb-5">
              {PIECE_OPTIONS.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => pickPiece(value)}
                  className={`flex flex-col items-center gap-1.5 rounded-xl p-2.5 transition ${swatchRing(draft.basePiece === value)}`}
                  title={label}
                >
                  <ChessAvatar
                    config={{ ...draft, basePiece: value }}
                    size={58}
                  />
                  <span className="text-[0.7rem] font-semibold text-ivory-300">{label}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            {/* body color */}
            <SectionTitle>Body color</SectionTitle>
            <div className="flex flex-wrap gap-2 mb-4">
              {BODY_COLORS.map(({ value, label, text }) => (
                <button
                  key={value}
                  type="button"
                  title={label}
                  onClick={() => set('bodyColor', value)}
                  className={`w-9 h-9 rounded-full grid place-items-center transition shadow ${draft.bodyColor === value ? 'ring-2 ring-gold-300 scale-110' : 'hover:scale-105'}`}
                  style={{ background: value, color: text }}
                >
                  {draft.bodyColor === value && <span className="text-sm font-bold">✓</span>}
                </button>
              ))}
            </div>

            {/* face */}
            <SectionTitle>Face</SectionTitle>
            <div className="flex flex-wrap gap-1.5 mb-4">
              {FACE_OPTIONS.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  title={label}
                  onClick={() => set('face', value)}
                  className={`p-0.5 rounded-full transition ${swatchRing(draft.face === value)}`}
                >
                  <ChessAvatar config={{ ...PREVIEW_STYLE, face: value }} size={38} />
                </button>
              ))}
            </div>

            {/* accessory */}
            <SectionTitle>Accessory</SectionTitle>
            <div className="flex flex-wrap gap-1.5 mb-4">
              {ACCESSORY_OPTIONS.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  title={label}
                  onClick={() => set('accessory', value)}
                  className={`p-0.5 rounded-full transition ${swatchRing(draft.accessory === value)}`}
                >
                  {value === 'none' ? (
                    <span className="grid place-items-center w-[38px] h-[38px] rounded-full text-xs text-ivory-500 border border-dashed border-ivory-500/40">✕</span>
                  ) : (
                    <ChessAvatar config={{ ...PREVIEW_STYLE, accessory: value }} size={38} />
                  )}
                </button>
              ))}
            </div>

            {/* background */}
            <SectionTitle>Background</SectionTitle>
            <div className="flex flex-wrap gap-2 mb-5">
              {BACKGROUND_OPTIONS.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  title={label}
                  onClick={() => set('background', value)}
                  className={`grid place-items-center w-9 h-9 rounded-full overflow-hidden transition ${draft.background === value ? 'ring-2 ring-gold-300 scale-110' : 'hover:scale-105'} shadow ring-1 ring-black/10`}
                >
                  <svg viewBox={SVG_VIEWBOX} className="w-full h-full block">
                    <Background color={value} />
                  </svg>
                </button>
              ))}
            </div>
          </>
        )}

        {/* actions */}
        <div className="flex flex-wrap gap-2 justify-end items-center">
          {step === 'style' && (
            <Button type="button" variant="secondary" size="md" className="!px-4 !py-2 text-sm" onClick={() => setStep('piece')}>
              ← Piece
            </Button>
          )}
          <Button
            type="button"
            variant="secondary" size="md" className="!px-4 !py-2 text-sm"
            onClick={() => setDraft(randomChessConfig())}
          >
            🎲 Surprise Me
          </Button>
          <Button type="button" variant="secondary" size="md" className="!px-4 !py-2 text-sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary" size="md" className="!px-5 !py-2 text-sm disabled:opacity-50"
            onClick={() => onSave(draft)}
          >
            Save Avatar
          </Button>
        </div>
      </div>
    </div>
  );
}