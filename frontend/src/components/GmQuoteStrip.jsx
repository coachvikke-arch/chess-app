import { gmQuotes } from '../lib/gmQuotes';
import { useQuoteOfTheDay } from '../lib/quoteOfTheDay';

function formatDailyLabel(date) {
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function GmQuoteStrip({ variant = 'light' }) {
  const current = useQuoteOfTheDay(gmQuotes);
  return (
    <div className={`gm-quote-strip${variant === 'dark' ? ' dark' : ''}`} role="region" aria-label="Famous grandmaster quote of the day">
      <span className="gm-quote-mark" aria-hidden="true">“</span>
      <div className="gm-quote-body">
        <p className="gm-quote-text">{current.en}</p>
        <p className="gm-quote-tamil">{current.ta}</p>
        <span className="gm-quote-author">— {current.author}</span>
        <span className="gm-quote-daily">{formatDailyLabel(new Date())}</span>
      </div>
    </div>
  );
}