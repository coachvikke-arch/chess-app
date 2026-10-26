import { useState } from 'react';
import CustomizePositionModal from './CustomizePositionModal';
import Button from './Button';

/* Shared Setup Board entry point — the "⚙ Setup Board" button plus the modal
   wiring behind it. GameReview renders this on BOTH the admin and the student
   shell, so the two sides share one button, one modal and one set of options
   (piece palette, clear, reset/start position, apply/done) and can never drift
   apart. Callers only supply where the starting FEN comes from and what happens
   when a position is applied.
*/
export default function SetupBoardButton({
  getInitialFen,
  onApply,
  className,
  title,
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        onClick={() => setOpen(true)}
        variant="secondary"
        size="sm"
        className={className || '!h-8 !px-3 text-xs'}
        title={title || 'Customize position piece by piece'}
      >
        ⚙ Setup Board
      </Button>

      {open && (
        <CustomizePositionModal
          initialFen={typeof getInitialFen === 'function' ? getInitialFen() : getInitialFen}
          onApply={(fen) => {
            setOpen(false);
            onApply?.(fen);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
