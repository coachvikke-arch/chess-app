import { useCallback, useMemo, useState } from 'react';
import { Chess } from 'chess.js';
import { buildLine, lineLength, expectedSan, plyMoveNumber, branchPly, lineToString } from '../../lib/openings';
import Button from '../Button';

function LineChip({ line, active, onClick, branchPly, isVariationMove }) {
  return (
    <button
      type="button"
      className={`op-line-chip ${active ? 'op-line-chip--active' : ''} ${isVariationMove ? 'op-line-chip--variation' : ''}`}
      onClick={onClick}
      title={isVariationMove ? `${line.name} (variation move)` : line.name}
    >
      {line.name}
    </button>
  );
}

function MoveChip({ move, index, total, active, isVariationMove, onClick }) {
  const isLast = index === total - 1;
  return (
    <button
      type="button"
      className={`op-move-chip ${active ? 'op-move-chip--active' : ''} ${isVariationMove ? 'op-move-chip--variation' : ''} ${isLast ? 'op-move-chip--last' : ''}`}
      onClick={() => onClick(index)}
      disabled={isLast && active}
      aria-label={`Move ${index + 1}: ${move}`}
    >
      {move}
    </button>
  );
}

export default function OpeningLearnTab({ opening, lines, currentLineId, onLineSelect, onPracticeClick, ply, setPly, total, plies, branch }) {
  const line = lines.find(l => l.id === currentLineId) || lines[0];
  const current = plies[Math.min(ply, plies.length - 1)] || plies[0];
  const expected = expectedSan(line, ply);
  const moveNumber = plyMoveNumber(ply);
  const isVariationMove = branch !== null && ply >= branch;
  const variationName = isVariationMove && !line.isMain ? line.name : null;
  const variationIdea = isVariationMove && line.notes ? line.notes[ply + 1] : null;

  const moveList = useMemo(() => {
    const moves = [];
    const game = new Chess();
    for (const san of line.moves) {
      try {
        const mv = game.move(san);
        if (mv) moves.push(mv.san);
      } catch (e) {
        console.warn(`Illegal move in opening "${opening.name}" line "${line.name}": ${san}`, e);
        break;
      }
    }
    return moves;
  }, [line.moves, opening.name, line.name]);

  const handleLineSelect = (lineId) => {
    onLineSelect(lineId);
    setPly(0);
  };

  const goToMove = (moveIndex) => {
    setPly(Math.min(moveIndex, total));
  };

  const nextMove = () => {
    if (ply < total) setPly(ply + 1);
  };

  const prevMove = () => {
    if (ply > 0) setPly(ply - 1);
  };

  const restart = () => setPly(0);

  const isAtEnd = ply >= total;
  const nextLabel = isAtEnd ? 'Practice now' : 'Next';

  return (
    <div className="op-learn-tab">
      <div className="op-learn-line-selector" role="tablist" aria-label="Select line to learn">
        {lines.map((l) => (
          <LineChip
            key={l.id}
            line={l}
            active={l.id === currentLineId}
            onClick={() => handleLineSelect(l.id)}
            branchPly={branchPly(opening, l)}
            isVariationMove={!l.isMain}
          />
        ))}
      </div>

      <div className="op-learn-move-info">
        <span className="op-learn-move-number">
          {moveNumber}{plies[ply]?.color === 'b' ? '…' : '.'}
        </span>
        <span className="op-learn-move-san">{expected || '—'}</span>
        {variationName && (
          <span className="op-learn-variation-badge">{variationName}</span>
        )}
      </div>

      <div className="op-learn-controls">
        <button
          type="button"
          className="op-nav-btn"
          onClick={restart}
          disabled={ply === 0}
          title="Restart"
        >
          ⏮
        </button>
        <button
          type="button"
          className="op-nav-btn"
          onClick={prevMove}
          disabled={ply === 0}
          title="Previous move (←)"
        >
          ◀
        </button>
        <button
          type="button"
          className="op-nav-btn"
          onClick={nextMove}
          disabled={ply >= total}
          title={isAtEnd ? 'Start practice' : 'Next move (→)'}
        >
          {isAtEnd ? '▶✦' : '▶'}
        </button>
        <button
          type="button"
          className="op-nav-btn"
          onClick={() => setPly(total)}
          disabled={ply >= total}
          title="Jump to end"
        >
          ⏭
        </button>
        <span className="op-nav-count">Move {Math.min(Math.floor(ply / 2) + 1, Math.ceil(total / 2))}</span>
      </div>

      <div className="op-learn-move-chips" role="list" aria-label="Moves in this line">
        {moveList.map((move, i) => (
          <MoveChip
            key={i}
            move={move}
            index={i}
            total={moveList.length}
            active={i === ply}
            isVariationMove={branch !== null && i >= branch}
            onClick={goToMove}
          />
        ))}
      </div>

      <div className="op-learn-explanation">
        {ply > 0 ? (
          <>
            <strong>{moveNumber}{plies[ply]?.color === 'b' ? '…' : '.'}{expected}</strong>
            {line.notes?.[ply] || opening.notes?.[ply] || opening.description}
            {variationIdea && (
              <p className="op-learn-variation-idea">
                <em>{variationName}: </em>{variationIdea}
              </p>
            )}
          </>
        ) : (
          <p>Step through the line to see why each move was played.</p>
        )}
      </div>

      {isAtEnd && (
        <Button type="button" variant="primary" size="md" className="op-practice-cta" onClick={onPracticeClick}>
          Practice this line
        </Button>
      )}
    </div>
  );
}