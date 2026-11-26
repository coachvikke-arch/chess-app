import { useEffect, useRef, useState } from 'react';
import ResponsiveBoard from '../ResponsiveBoard';

/* ──────────────────────────────────────────────────────────────────────────
 * The shared analysis board for variations.
 *
 * It renders the CURRENT tree node's FEN and sends every legal move back into
 * useVariationTree, so a new move becomes a branch and a move that already
 * exists on this line is a navigation — the board itself never decides either.
 * The mainline is reached through the same pointer, which is why stepping back
 * onto the game always restores the exact original line.
 * ────────────────────────────────────────────────────────────────────────── */

const isTypingTarget = (el) => {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
};

export default function VariationBoard({
  tree,
  keyboard = false,
  className = '',
  maxWidth = 400,
  interactive = true,
  onTreeMove = null,
  ...boardProps
}) {
  /* A move can only be refused if the tree and the board disagree for a frame
     (a server update arrived between paint and click). Remounting at the tree's
     FEN is the cheap way back to one position. */
  const [epoch, setEpoch] = useState(0);
  const treeRef = useRef(tree);
  treeRef.current = tree;

  const handleMove = (move) => {
    const current = treeRef.current;
    const result = current.playMove(move);
    if (result.illegal) {
      setEpoch((e) => e + 1);
      return;
    }
    if (onTreeMove) onTreeMove(result, move);
  };

  /* Left/Right walk the current line, Up/Down switch between moves that were
     played from the same position, Home/End jump to the ends. Opt-in, because
     surfaces that already own keys (Game Review) integrate navigation
     themselves. */
  useEffect(() => {
    if (!keyboard) return undefined;
    const onKey = (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey || isTypingTarget(e.target)) return;
      const t = treeRef.current;
      let handled = true;
      switch (e.key) {
        case 'ArrowLeft': t.goBack(); break;
        case 'ArrowRight': t.goForward(); break;
        case 'ArrowUp': handled = t.goSibling(-1); break;
        case 'ArrowDown': handled = t.goSibling(1); break;
        case 'Home': t.goToStart(); break;
        case 'End': t.goToEnd(); break;
        default: handled = false;
      }
      if (handled) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keyboard]);

  return (
    <ResponsiveBoard
      {...boardProps}
      key={epoch}
      className={className}
      maxWidth={maxWidth}
      fen={tree.currentFen}
      lastMove={tree.currentLastMove}
      interactive={interactive}
      onMove={handleMove}
    />
  );
}
