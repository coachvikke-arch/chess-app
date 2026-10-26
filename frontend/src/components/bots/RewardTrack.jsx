import { COIN_TRACK_TOTAL, REWARD_MILESTONES } from '../../services/BotProgressService';

/**
 * Bot Coin total + the five milestone unlocks.
 *
 * Locked milestones deliberately show what they are WITHOUT saying what they
 * unlock: teasing a board theme by name would give the player nothing to chase,
 * but a generic "Locked" chip gives them a target. Claiming a milestone is a
 * pure client-side unlock of the local preference — the actual catalogue lives
 * in the theme registries.
 */
export default function RewardTrack({ coins = 0, compact = false }) {
  const next = REWARD_MILESTONES.find((m) => coins < m.coins) || null;
  const nextAt = next ? next.coins : COIN_TRACK_TOTAL;
  const progressPct = Math.min(100, Math.round((coins / nextAt) * 100));

  return (
    <section
      className="rounded-2xl border border-blue-500/45 bg-blue-500/[0.07] p-3 sm:p-4"
      aria-labelledby="reward-track-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="reward-track-title" className="text-sm font-bold text-ivory-100">
          Bot Coins
        </h2>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-gold-500/40 bg-gold-500/10 px-3 py-1 text-sm font-semibold text-gold-400">
          <span aria-hidden="true">🪙</span>
          <span className="tabular-nums">{coins}</span>
          <span className="sr-only">Bot Coins</span>
        </span>
      </div>

      {/* Progress toward the next milestone. The bar is decorative; the numbers
          below carry the same information for assistive tech. */}
      <div
        className="mt-3 h-2 w-full overflow-hidden rounded-full bg-ink-900/70"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={nextAt}
        aria-valuenow={Math.min(coins, nextAt)}
        aria-label={`Bot Coins toward next reward`}
      >
        <div className="h-full rounded-full bg-gold-500 transition-all" style={{ width: `${progressPct}%` }} />
      </div>

      <p className="mt-2 text-xs font-medium text-ivory-300">
        {next ? (
          <>
            <span className="tabular-nums">{nextAt - coins}</span> more to go for your next reward.
          </>
        ) : (
          <>All milestone rewards unlocked.</>
        )}
      </p>

      {!compact && (
        <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {REWARD_MILESTONES.map((m) => {
            const claimed = coins >= m.coins;
            return (
              <li
                key={m.coins}
                className={`flex items-center gap-2 rounded-xl border px-2 py-1.5 text-xs ${
                  claimed
                    ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300'
                    : 'border-blue-500/40 bg-blue-500/10 text-ivory-200'
                }`}
              >
                <span aria-hidden="true">{claimed ? '✓' : '🔒'}</span>
                <span className="tabular-nums">{m.coins}</span>
                <span className="sr-only">
                  {claimed ? `Unlocked: ${m.label}` : `Locked: ${m.label}`}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}