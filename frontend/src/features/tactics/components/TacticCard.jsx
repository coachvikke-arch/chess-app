/**
 * TacticCard — one tactic, from the faded number to the three teaching blocks.
 *
 * Everything here is driven by ONE data object (see ../data/index.js). There is
 * no per-tactic markup anywhere in the app: adding tactic 46 means adding a JSON
 * object, and this file needs no change.
 *
 * EXPLANATION MODE (no puzzle)
 * The reader never has to find or play anything. The card opens on the starting
 * position with the tactic's own highlights and arrows already drawn, so the
 * idea — what moves, where it lands, what it attacks — is legible on arrival:
 *
 *     moving piece -> key square -> target 1 / target 2
 *
 * "Replay tactic" is the only control, and it is a playback control: it walks
 * the stored `solution` (with any `opponentReplies`) forward as a timed sequence
 * and lands back on the same fully annotated board. Nothing about it validates a
 * move, because nothing here is a question.
 *
 * `solution` therefore means "the moves this card demonstrates", not "the moves
 * the reader must find". The same array feeds the replay timeline.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import TacticBoard from './TacticBoard';
import Button from '../../../components/Button';

const pad2 = (n) => String(n).padStart(2, '0');

/** One beat of the demonstration: a position, and what the card draws on it. */
function frame(fen, label, arrows = null, highlights = null) {
  return { fen, label, arrows, highlights };
}

/**
 * Expand a tactic into the frames its replay walks through.
 *
 * White's `solution` and Black's `opponentReplies` are interleaved so a reader
 * watching the replay sees the same conversation the data describes. Every move
 * is played through chess.js, so an entry that does not parse is dropped rather
 * than leaving the board in a state the engine disagrees with. The first frame
 * is bare (position only) and the last carries the annotations, which makes the
 * reveal of the arrows the payoff of the sequence.
 */
function buildFrames(tactic) {
  const solution = tactic.solution || [];
  const replies = tactic.opponentReplies || [];
  const arrows = tactic.arrows || [];
  const highlights = tactic.highlights || [];

  const opening = frame(tactic.fen, 'Starting position');
  const closing = frame(tactic.fen, 'What the tactic does', arrows, highlights);

  if (!solution.length) return [closing];

  const beats = [opening];
  const chess = new Chess(tactic.fen);
  let played = 0;

  for (let i = 0; i < solution.length; i++) {
    try { chess.move(solution[i]); } catch { break; }
    played += 1;
    beats.push(frame(chess.fen(), solution[i]));

    const reply = replies[i];
    if (reply) {
      try { chess.move(reply); } catch { continue; }
      beats.push(frame(chess.fen(), reply));
    }
  }

  if (!played) return [closing];

  /* The annotations are drawn on the position the tactic produced, so the arrows
     that start on the key square land on the squares they actually attack. */
  return [...beats, frame(beats[beats.length - 1].fen, 'What the tactic does', arrows, highlights)];
}

export default function TacticCard({
  tactic,
  onExplained,
  solved,
  compact = false,
}) {
  const frames = useMemo(() => buildFrames(tactic), [tactic]);

  /* Opening state is the LAST frame, not the first: the reader lands straight on
     the annotated board instead of an empty diagram they have to unlock. */
  const lastIndex = frames.length - 1;
  const [index, setIndex] = useState(lastIndex);
  const [playing, setPlaying] = useState(false);
  const timers = useRef([]);

  const clearTimers = useCallback(() => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
  }, []);

  /* Any change of tactic (Prev/Next, deep link) resets to that tactic's
     explained state, and stops any replay that was still running. */
  useEffect(() => {
    clearTimers();
    setPlaying(false);
    setIndex(lastIndex);
    return clearTimers;
  }, [lastIndex, clearTimers]);

  /* Report the explanation once the annotated board is what is on screen, so
     progress tracks having studied the tactic rather than having solved it. */
  useEffect(() => {
    if (!playing) onExplained?.(tactic);
  }, [playing, onExplained, tactic]);

  const replay = useCallback(() => {
    clearTimers();
    if (frames.length < 2) return;

    setPlaying(true);
    setIndex(0);

    frames.slice(1).forEach((_, offset) => {
      timers.current.push(
        window.setTimeout(() => setIndex(offset + 1), (offset + 1) * 850),
      );
    });
    timers.current.push(
      window.setTimeout(() => setPlaying(false), frames.length * 850),
    );
  }, [clearTimers, frames]);

  const shown = frames[index];
  const atEnd = index === lastIndex;

  return (
    <article className={`tactic-card ${compact ? 'is-compact' : ''}`.trim()}>
      {/* ── header: number badge + category chips + title ── */}
      <header className="tactic-head">
        <span className="tactic-number" aria-hidden="true">{pad2(tactic.id)}</span>
        <div className="tactic-head-text">
          <p className="tactic-eyebrow">
            <span className="tactic-chip">Tactic {pad2(tactic.id)}</span>
            <span className="tactic-chip">{tactic.category}</span>
          </p>
          <h2 className="tactic-title">
            The <span className="tactic-title-name">{tactic.title}</span>.
          </h2>
        </div>
      </header>

      <div className="tactic-body">
        {/* ── board column ── */}
        <div className="tactic-board-col">
          <TacticBoard
            fen={shown.fen}
            arrows={shown.arrows}
            highlights={shown.highlights}
          />
          <p className="tactic-caption">
            {playing && !atEnd ? shown.label : tactic.caption}
          </p>

          <div className="tactic-actions">
            {frames.length > 1 && (
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={replay}
                disabled={playing}
              >
                {playing ? 'Replaying…' : 'Replay tactic'}
              </Button>
            )}
            {solved && <span className="tactic-solved" aria-label="Studied">✓ studied</span>}
          </div>
        </div>

        {/* ── the three teaching blocks ── */}
        <div className="tactic-blocks">
          <section className="tactic-block is-dark">
            <h3 className="tactic-block-label">What it is</h3>
            <p className="tactic-block-text">{tactic.whatItIs}</p>
          </section>
          <section className="tactic-block is-light">
            <h3 className="tactic-block-label">Why it wins</h3>
            <p className="tactic-block-text">{tactic.whyItWins}</p>
          </section>
          <section className="tactic-block is-do">
            <h3 className="tactic-block-label">Do this</h3>
            <p className="tactic-block-text">{tactic.doThis}</p>
          </section>

          {/* The slug is deliberately visible: these are the same tags the puzzle
              and analysis screens use, and a coach naming one to a student should
              be able to find it here. */}
          <p className="tactic-tags">
            {(tactic.tags || []).map((tag) => (
              <span key={tag} className="tactic-tag">{tag}</span>
            ))}
          </p>
        </div>
      </div>
    </article>
  );
}