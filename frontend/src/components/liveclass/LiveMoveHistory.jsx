import { useLiveClass } from '../../context/LiveClassContext';
import { useClassroomVariations } from '../../context/ClassroomVariationContext';
import { buildFullPgn, classroomPgnMeta } from '../../utils/gamePgn';
import useCopyFullPgn from '../../hooks/useCopyPgn';
import VariationMoveList from '../variation/VariationMoveList';

/* The classroom's Moves tab is the SHARED variation list: the class game's
 * mainline grid plus every branch the room has tried, nested under the move it
 * deviated from. Clicking a move is a pointer change, not an edit — the coach's
 * click moves the room, a student's click is a private look. */
export default function LiveMoveHistory({ asMobilePanel = false, hideHeader = false }) {
  const { isInstructor, classMeta } = useLiveClass();
  const classroom = useClassroomVariations();
  const moveCount = Math.max(0, classroom.tree.displayIds.length - 1);
  const copyFullPgn = useCopyFullPgn();
  /* The stored classroom PGN is the live movetext; the shared builder writes the
     tag block and closing result token around the very same moves. */
  const pgn = buildFullPgn({ pgn: classroom.pgn, ...classroomPgnMeta(classMeta) });

  return (
    <div className={`live-chat-panel ${asMobilePanel ? 'live-chat-mobile-panel' : ''}`}>
      {!hideHeader && (
        <div className="live-chat-head">
          <span className="live-chat-title">♞ Move history</span>
        </div>
      )}
      <div className="live-move-count">
        ♘ Moves <span className="live-move-count-num">{moveCount}</span>
      </div>
      <div className="live-chat-list live-move-list">
        <VariationMoveList
          tree={classroom.tree}
          title="Moves"
          readOnly={!isInstructor}
          canReset={isInstructor}
          onReset={classroom.resetVariations}
          branchActions={false}
          headless
          emptyText="No moves yet - moves played on the board appear here."
        />
      </div>
      {isInstructor && (
        <div className="live-v2-move-actions">
          {/* The room-wide way back: one confirm in the provider removes every
              branch for everyone (the list's own header is hidden here). */}
          {classroom.hasVariations && (
            <button type="button" className="live-chip" onClick={classroom.resetVariations} title="Remove every variation and return the room to the original line">
              ↩ Reset line
            </button>
          )}
          <button type="button" className="live-chip" onClick={() => copyFullPgn(pgn)}>Copy</button>
          <button
            type="button"
            className="live-chip"
            onClick={() => {
              const blob = new Blob([pgn], { type: 'application/x-chess-pgn' });
              const url = URL.createObjectURL(blob);
              const link = document.createElement('a');
              link.href = url;
              link.download = 'classroom-game.pgn';
              link.click();
              URL.revokeObjectURL(url);
            }}
          >PGN</button>
        </div>
      )}
    </div>
  );
}
