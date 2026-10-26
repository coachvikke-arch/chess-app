import { useEffect } from 'react';
import Button from './Button';

export default function LeaveGameConfirmDialog({ open, onStay, onLeave }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onStay(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onStay]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[var(--z-modal-backdrop)] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onStay}>
      <div className="chess-card max-w-sm w-full p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display text-lg font-bold text-ivory-100 mb-2">Leave the game?</h3>
        <p className="text-sm text-ivory-500 mb-4">Your game is still in progress.</p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" className="!px-3 !py-1.5 text-xs" onClick={onStay}>Stay</Button>
          <Button variant="primary" size="sm" className="!px-3 !py-1.5 text-xs" onClick={onLeave}>Leave</Button>
        </div>
      </div>
    </div>
  );
}
