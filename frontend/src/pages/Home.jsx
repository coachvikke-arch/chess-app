import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import AnimatedBoard from '../components/AnimatedBoard';
import { Piece, Card, Reveal } from '../components/ui';
import Button from '../components/Button';
import usePageTitle from '../hooks/usePageTitle';
import { APP_NAME, APP_TAGLINE, APP_COPYRIGHT } from '../config/brand';

/**
 * Writes a headline whole-word by whole-word ("writing" effect): each word
 * fades+slides up once, one after another, and stays. Runs exactly once —
 * words are never re-animated. `active` holds the effect, so a page can start
 * the sentence only when it wants to.
 */
function WriteWords({ words, className = '', wordMs = 340, caret = '▌', gradientFrom = Infinity, active = true }) {
  const [count, setCount] = useState(0);
  // Reveal one whole word at a time: count increments until words.length is
  // reached, then stays put (no loop).
  const done = count >= words.length;
  useEffect(() => {
    if (!active || done) return; // held, or finished — leave the words as they are
    const t = setTimeout(() => setCount((c) => c + 1), wordMs);
    return () => clearTimeout(t);
  }, [active, count, done, wordMs]);
  if (!active) return <span className={className} />;
  const shown = words.slice(0, count);
  return (
    <span className={className}>
      {shown.map((w, i) => (
        <span
          key={`${i}-${w}`}
          className={`ww-word ${i >= gradientFrom ? 'chess-gradient-text' : ''}`}
          style={{ '--i': i }}
        >
          {w}{' '}
        </span>
      ))}
      {!done && <span className="ww-caret">{caret}</span>}
    </span>
  );
}

const steps = [
  { icon: '♟', title: 'Enroll in a course', desc: 'Pick your level and start a structured curriculum.' },
  { icon: '♘', title: 'Attend live classes', desc: 'Train with the coach in real-time sessions.' },
  { icon: '♞', title: 'Solve daily puzzles', desc: 'Sharpen tactics with a puzzle every single day.' },
  { icon: '♔', title: 'Track your progress', desc: 'Streaks, ratings and leaderboards keep you sharp.' },
];

export default function Home() {
  usePageTitle('Home');

  return (
    <div>
      {/* Hero — the only dark band on the page. */}
      <section className="landing-hero relative overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 py-16 md:py-24 grid md:grid-cols-2 gap-12 items-center w-full">
          <div>
            <Reveal>
              <span className="inline-flex items-center gap-2 chess-chip chess-chip-gold mb-5">
                <span className="animate-pulse">♟</span> Where grandmasters are made
              </span>
              <h1 className="font-display font-bold text-4xl md:text-6xl leading-[1.05] text-ivory-100">
                <WriteWords
                  words={['Learn', 'Chess.', 'Think', 'Better.', 'Play', 'Stronger.']}
                  gradientFrom={4}
                  className="inline-flex flex-wrap items-baseline"
                />
              </h1>
              <p className="mt-5 text-ivory-300 text-lg max-w-xl">
                Structured courses, live coaching, daily puzzles and real feedback —
                everything you need to learn and play, in one place.
              </p>
            </Reveal>
            <Reveal delay={0.15}>
              <div className="mt-9 flex flex-wrap items-center gap-4">
                <Button to="/login" variant="primary" size="lg">
                  <Piece p="♘" spin /> Login
                </Button>
              </div>
            </Reveal>
            <Reveal delay={0.3}>
              <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3 text-ivory-500 text-sm">
                <span className="inline-flex items-center gap-2">
                  <span className="text-gold-500">★</span> 5.0 coach rating
                </span>
                <span className="inline-flex items-center gap-2">
                  <span className="text-gold-500">★</span> 5,000+ learners
                </span>
                <span className="inline-flex items-center gap-2">
                  <span className="text-gold-500">★</span> Live &amp; recorded classes
                </span>
              </div>
            </Reveal>
          </div>
          <Reveal delay={0.2}>
            <div className="ml-2 md:ml-6 flex justify-center md:justify-end">
              <AnimatedBoard size={420} />
            </div>
          </Reveal>
        </div>
      </section>

      <footer className="border-t border-ivory-700/40">
        <div className="max-w-7xl mx-auto px-4 py-10 text-center">
          <p className="inline-flex items-center gap-2 font-display font-bold text-ivory-100">
            <span className="text-gold-400" aria-hidden="true">♞</span>
            {APP_NAME}
          </p>
          <p className="text-sm text-ivory-500 mt-2">{APP_TAGLINE}</p>
          <p className="text-xs text-ivory-700 mt-4">{APP_COPYRIGHT}</p>
        </div>
      </footer>
    </div>
  );
}