/**
 * SamplePuzzleCard — practice positions taken from the Lichess puzzle database.
 *
 * The 45 tactics above teach one pattern each on a hand-built diagram. These
 * are the same ideas in real games: every position here is an engine-verified
 * Lichess puzzle, rated 600-1200, and already advanced past the opponent's
 * blunder (`trigger`), so the reader is the side to move. See
 * scripts/build_tactics_samples.mjs for how the data is produced.
 *
 * The card is a question again — unlike TacticCard, which only explains. It
 * shows the position with nothing drawn on it and keeps the line hidden until
 * "Show solution" is pressed; that press then replays the line move by move and
 * settles on the starting position with the key move arrowed, so the final
 * image answers "what should I have played?" at a glance.
 *
 * Progress is deliberately NOT stored: these are a sample pool, and ticking
 * them off would compete with the 45 taught tactics on the same screen.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import TacticBoard from './TacticBoard';
import Button from '../../../components/Button';
import { SAMPLE_SOURCE, SAMPLE_TOPICS } from '../data';

const REPLAY_MS = 800;

/** The positions the replay walks: start, then one frame per ply of the line. */
function buildFrames(puzzle) {
  const frames = [{ fen: puzzle.fen, label: 'The position' }];
  const chess = new Chess(puzzle.fen);
  puzzle.solution.forEach((san, i) => {
    try {
      chess.move(san);
      frames.push({ fen: chess.fen(), label: san });
    } catch {
      return;
    }
    const reply = puzzle.opponentReplies?.[i];
    if (reply) {
      try {
        chess.move(reply);
        frames.push({ fen: chess.fen(), label: reply });
      } catch { /* the builder already validated; never draw a broken frame */ }
    }
  });
  return frames;
}

/** Arrow and square wash for the solver's first move, drawn on the start FEN. */
function keyMoveMarks(puzzle) {
  try {
    const played = new Chess(puzzle.fen).move(puzzle.solution[0]);
    return {
      arrows: [{ from: played.from, to: played.to }],
      highlights: [
        { square: played.from, color: 'green' },
        { square: played.to, color: 'orange' },
      ],
    };
  } catch {
    return { arrows: null, highlights: null };
  }
}

const side = (puzzle) => (puzzle.turn === 'white' ? 'White' : 'Black');
/* The side that played the blunder that created the puzzle. Naming it beats a
   bare SAN: "after fxg5" reads as a stray move, "after Black's fxg5" reads as
   the reason the position exists. */
const triggerSide = (puzzle) => (puzzle.turn === 'white' ? 'Black' : 'White');

export default function SamplePuzzleCard() {
  const [topicIndex, setTopicIndex] = useState(0);
  const [puzzleIndex, setPuzzleIndex] = useState(0);
  const [mode, setMode] = useState('ask');   // ask | play | answer
  const [frame, setFrame] = useState(0);
  const timers = useRef([]);

  const topic = SAMPLE_TOPICS[topicIndex] || SAMPLE_TOPICS[0];
  const puzzle = topic.puzzles[puzzleIndex] || topic.puzzles[0];
  const frames = useMemo(() => buildFrames(puzzle), [puzzle]);
  const marks = useMemo(() => keyMoveMarks(puzzle), [puzzle]);

  const clearTimers = useCallback(() => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const reset = useCallback((nextTopic, nextPuzzle) => {
    clearTimers();
    setMode('ask');
    setFrame(0);
    if (nextTopic != null) setTopicIndex(nextTopic);
    if (nextPuzzle != null) setPuzzleIndex(nextPuzzle);
  }, [clearTimers]);

  /* Show the line: walk the frames, then land on the answered position. */
  const showSolution = useCallback(() => {
    clearTimers();
    setMode('play');
    setFrame(0);
    frames.slice(1).forEach((_, offset) => {
      timers.current.push(window.setTimeout(() => setFrame(offset + 1), (offset + 1) * REPLAY_MS));
    });
    timers.current.push(
      window.setTimeout(() => setMode('answer'), frames.length * REPLAY_MS),
    );
  }, [clearTimers, frames]);

  const step = (delta) => {
    const count = topic.puzzles.length;
    reset(null, (puzzleIndex + delta + count) % count);
  };

  const caption = mode === 'play'
    ? frames[Math.min(frame, frames.length - 1)].label
    : mode === 'answer'
      ? `Solution: ${puzzle.line}`
      : `${side(puzzle)} to play after ${triggerSide(puzzle)}'s ${puzzle.trigger}.`;

  const board = mode === 'play' ? frames[Math.min(frame, frames.length - 1)].fen : puzzle.fen;
  const answered = mode === 'answer';

  return (
    <section className="tactic-card sample-card">
      <header className="tactic-head">
        <span className="tactic-number" aria-hidden="true">♟</span>
        <div className="tactic-head-text">
          <p className="tactic-eyebrow">
            <span className="tactic-chip">Practice</span>
            <span className="tactic-chip">Lichess-verified</span>
            <span className="tactic-chip">Level 600–1200</span>
          </p>
          <h2 className="tactic-title">
            Real positions to <span className="tactic-title-name">practise</span>.
          </h2>
        </div>
      </header>

      <div className="sample-chips" role="tablist" aria-label="Puzzle topics">
        {SAMPLE_TOPICS.map((t, i) => (
          <button
            key={t.theme}
            type="button"
            role="tab"
            aria-selected={i === topicIndex}
            className={`sample-chip${i === topicIndex ? ' is-current' : ''}`}
            onClick={() => reset(i, 0)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="tactic-body">
        <div className="tactic-board-col">
          <TacticBoard
            fen={board}
            arrows={answered ? marks.arrows : null}
            highlights={answered ? marks.highlights : null}
          />
          <p className="tactic-caption">{caption}</p>

          <div className="tactic-actions">
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={showSolution}
              disabled={mode === 'play'}
            >
              {mode === 'play' ? 'Showing…' : answered ? 'Replay the line' : 'Show solution'}
            </Button>

            <div className="sample-pager">
              <button
                type="button"
                className="sample-pager-btn"
                onClick={() => step(-1)}
                aria-label="Previous puzzle"
              >
                ←
              </button>
              <span className="sample-pager-count">
                {puzzleIndex + 1} / {topic.puzzles.length}
              </span>
              <button
                type="button"
                className="sample-pager-btn"
                onClick={() => step(1)}
                aria-label="Next puzzle"
              >
                →
              </button>
            </div>
          </div>
        </div>

        <div className="tactic-blocks">
          <section className="tactic-block is-dark">
            <h3 className="tactic-block-label">The idea</h3>
            <p className="tactic-block-text">{topic.blurb}</p>
          </section>
          <section className="tactic-block is-light">
            <h3 className="tactic-block-label">This position</h3>
            <p className="tactic-block-text">
              A level {puzzle.rating} Lichess puzzle. {side(puzzle)} to move after {triggerSide(puzzle)}'s {puzzle.trigger}.
            </p>
          </section>
          <section className="tactic-block is-do">
            <h3 className="tactic-block-label">Solution</h3>
            <p className="tactic-block-text">
              {answered
                ? `${puzzle.line}${puzzle.mate ? ' — mate.' : '.'}`
                : 'Hidden. Choose your move first, then reveal it.'}
            </p>
          </section>

          <p className="sample-credit">
            Positions from the{' '}
            <a href={SAMPLE_SOURCE.url} target="_blank" rel="noreferrer">Lichess puzzle database</a>
            {' '}({SAMPLE_SOURCE.license}).{' '}
            <a href={puzzle.url} target="_blank" rel="noreferrer">Puzzle {puzzle.id} on Lichess</a>.
          </p>
        </div>
      </div>
    </section>
  );
}
