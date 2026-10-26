import { Link } from 'react-router-dom';
import BotAvatar from './BotAvatar';

/**
 * One bot in the catalogue grid.
 *
 * A locked bot stays a real button (not a div) so screen readers announce it as
 * unavailable, and the lock reason is exposed via `title` + an sr-only span
 * rather than colour alone — the tier pill also carries the text.
 */
export default function BotCard({
  bot,
  unlocked = false,
  lockReason = '',
  record = null,
  onSelect,
  selected = false,
  timeControl = '5min',
  color = 'white',
}) {
  const defeated = Boolean(record?.defeated);
  const played = Boolean(record && record.gamesPlayed > 0);

  const body = (
    <>
      {/* Badges are positioned against the card, so they stay put at every size. */}
      {defeated && (
        <span className="absolute left-2 top-2 text-sm" title="Defeated" aria-label="Defeated">
          🏆
        </span>
      )}
      {!unlocked && (
        <span
          className="absolute right-2 top-2 rounded-full border border-ivory-500/70 bg-ink-900/90 px-2 py-0.5 text-[11px] font-semibold text-ivory-200"
          aria-hidden="true"
        >
          🔒
        </span>
      )}

      <BotAvatar bot={bot} size={72} className="w-16 h-16 sm:w-[72px] sm:h-[72px]" />

      {/* Text contrast. The theme is LIGHT (--ink-800 is white, --ivory-700 is the
          faintest token), so "more visible" means moving DOWN the ivory scale
          toward --ivory-100, not up. Name was ivory-200 and the rating line was
          ivory-500, which is a weak grey on white. */}
      <span className="text-center leading-tight">
        <span className="block text-sm font-bold text-ivory-100">{bot.name}</span>
        <span className="block text-xs font-medium text-ivory-300">
          {bot.rating} · {bot.difficulty}
        </span>
      </span>

      {/* Win/loss tally, so a returning player can see progress without
          opening the bot. Only shown once they have actually played. */}
      {played && (
        <span className="text-[11px] font-medium text-ivory-300 tabular-nums">
          {record.wins}W · {record.losses}L{record.draws ? ` · ${record.draws}D` : ''}
        </span>
      )}
    </>
  );

  /* Box borders. Previously ivory-700/40, which is the faintest token at 40%
     opacity on a white card - the grid read as a set of vague shapes. Locked
     cards also dropped the WHOLE card to opacity-50, taking their text with
     them, so a locked bot was barely legible; it is now opacity-70, still
     clearly set back but readable. */
  const shell = unlocked
    ? 'border-ivory-500/60 bg-ink-800 shadow-[0_2px_10px_rgba(0,0,0,0.10)] hover:border-gold-500/80 hover:shadow-[0_6px_20px_rgba(0,0,0,0.16)] hover:scale-[1.02]'
    : 'border-ivory-500/40 bg-ink-800/60 opacity-70 cursor-not-allowed';

  const ring = selected ? 'ring-2 ring-emerald-500' : '';

  /* Locked bots link nowhere: no target, no navigation, no dead URL. */
  if (!unlocked) {
    return (
      <div
        className={`relative flex flex-col items-center gap-2 rounded-2xl border p-3 transition ${shell}`}
        aria-disabled="true"
      >
        {body}
        <span className="sr-only">Locked. {lockReason}</span>
      </div>
    );
  }

  return (
    <Link
      to={`/play/bot/${bot.id}?tc=${timeControl}&color=${color}`}
      onClick={() => onSelect && onSelect(bot)}
      className={`relative flex flex-col items-center gap-2 rounded-2xl border p-3 transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${shell} ${ring}`}
      title={bot.description || bot.name}
      aria-label={`Play ${bot.name}, rated ${bot.rating}, ${bot.difficulty}${defeated ? ', already defeated' : ''}`}
    >
      {body}
    </Link>
  );
}