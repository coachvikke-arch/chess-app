import { useCallback, useEffect, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { useLiveClass } from '../../context/LiveClassContext';
import { on } from '../../services/socket';

export default function LiveMoveHistory({ asMobilePanel = false, hideHeader = false }) {
  const { chessState, viewIndex, setViewIndex, remoteReview, isInstructor } = useLiveClass();
  const [moves, setMoves] = useState([]);
  const listRef = useRef(null);
  /* Follow the latest move only while pinned to the bottom of the list; a
     manual scroll up is respected and a fresh move will not drag the reader
     back down until they scroll to the bottom again. */
  const pinnedRef = useRef(true);

  const fromState = useCallback((state) => {
    if (!state) return;
    try {
      if (state.pgn && String(state.pgn).trim()) {
        const g = new Chess();
        g.loadPgn(state.pgn, { strict: false });
        setMoves(g.history().slice());
      } else if (state.fen) {
        setMoves([]);
      }
    } catch (_) {}
  }, []);

  useEffect(() => {
    fromState(chessState);
  }, [chessState, fromState]);

  useEffect(() => {
    const off = on('chess_state_updated', fromState);
    return () => off();
  }, [fromState]);

  useEffect(() => {
    if (pinnedRef.current && listRef.current) {
      /* Scroll the LIST itself, never the page. scrollIntoView walks every
         scrollable ancestor — including the document — so opening the Moves
         tab (or a live move arriving while pinned) could nudge the whole
         classroom up or down. Setting scrollTop confines the follow to this
         panel, exactly as the chat feed does. */
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [moves.length]);

  const onScroll = (e) => {
    const el = e.target;
    pinnedRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 24;
  };

  const scrollChipIntoView = (e) => {
    try { e.currentTarget.scrollIntoView({ block: 'nearest' }); } catch { /* ignore */ }
  };

  const lastIdx = moves.length - 1;

  /* Event delegation on the list container rather than an onClick per chip:
     the list re-renders on every live move, and a handler bound to a chip can be
     lost with the node it was bound to. The container outlives its children, so
     a click keeps working after a re-render. Clicking a move asks the board to
     show the position AFTER it; clicking the latest move means "back to live",
     which is what `null` encodes.

     Only the INSTRUCTOR scrubs the list. A click here also drives the room —
     it is broadcast as the reviewed ply — so students and spectators read the
     moves but must never be able to move the class board. */
  const onListClick = (e) => {
    if (!isInstructor) return;
    const chip = e.target?.closest?.('[data-index]');
    if (!chip || !listRef.current || !listRef.current.contains(chip)) return;
    const idx = Number(chip.getAttribute('data-index'));
    if (!Number.isFinite(idx)) return;
    setViewIndex(idx >= lastIdx ? null : idx);
  };

  return (
    <div className={`live-chat-panel ${asMobilePanel ? 'live-chat-mobile-panel' : ''}`}>
      {!hideHeader && (
        <div className="live-chat-head">
          <span className="live-chat-title">♞ Move history</span>
        </div>
      )}
      <div className="live-move-count">
        ♘ Moves <span className="live-move-count-num">{moves.length}</span>
      </div>
      <div className="live-chat-list live-move-list" ref={listRef} onScroll={onScroll} onClick={onListClick}>
        {moves.length === 0 && <p className="live-chat-empty">No moves yet — instructor will take the first move.</p>}
        {moves.length > 0 && (
          <div className="live-move-rows">
            {Array.from({ length: Math.ceil(moves.length / 2) }).map((_, i) => {
              const rowHasCurrent = i * 2 === lastIdx || i * 2 + 1 === lastIdx;
              return (
                <div key={i} className={`live-move-row${rowHasCurrent ? ' live-move-row-current' : ''}`}>
                  <span className="live-move-num">{i + 1}.</span>
                  {[0, 1].map((offset) => {
                    const idx = i * 2 + offset;
                    if (idx >= moves.length) return <span key={offset} className="live-move-empty" />;
                    const isCurrent = idx === lastIdx;
                    /* This viewer's own click wins; otherwise the ply the
                       instructor is leading the room through is marked. */
                    const isViewed = viewIndex === idx
                      || (viewIndex == null && remoteReview != null && remoteReview.to === idx);
                    const scrub = isInstructor;
                    return (
                      <span
                        key={offset}
                        data-index={idx}
                        className={`live-move-chip${isCurrent ? ' live-move-chip-current' : ''}${isViewed ? ' live-move-chip-view' : ''}${scrub ? '' : ' live-move-chip-readonly'}`}
                        onClick={scrub ? scrollChipIntoView : undefined}
                        role={scrub ? 'button' : undefined}
                        aria-current={isViewed ? 'true' : undefined}
                        title={scrub ? `Show position after ${moves[idx]}` : moves[idx]}
                      >
                        {moves[idx]}
                      </span>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}