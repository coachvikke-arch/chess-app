import { useMemo, useState } from 'react';
import { useUrlView } from '../hooks/useUrlView';
import { Link, useNavigate } from 'react-router-dom';
import { DIFFICULTY_BANDS, getBotsByDifficulty } from '../data/bots';
import { TIME_CONTROLS, COLOR_CHOICES, DEFAULT_TIME_CONTROL, DEFAULT_COLOR, getNextChallenge } from '../services/BotService';
import { useBotProgress } from '../hooks/useBotProgress';
import { useAuth } from '../context/AuthContext';
import { homeForRole } from '../utils/roles';
import BotAvatar from '../components/bots/BotAvatar';
import BotCard from '../components/bots/BotCard';
import RewardTrack from '../components/bots/RewardTrack';
import Button from '../components/Button';
import usePageTitle from '../hooks/usePageTitle';

/**
 * /play/bots — the bot catalogue.
 *
 * Structure: a sticky setup bar (time control + colour) that applies to the
 * whole page, then one section per difficulty tier in ladder order. Tapping a
 * bot selects it and reveals its details plus a "Play" affordance; the card is
 * also a direct link, so the page works without ever touching the button.
 */
export default function BotsPage() {
  usePageTitle('Play Bots');
  const navigate = useNavigate();
  const { rewards, settings, syncState, forBot, updateSetting } = useBotProgress();
  const { user } = useAuth();

  /* Back returns to the signed-in user's own home. For a student that is
     /student/dashboard; for a coach or the owner it is their own panel, which
     avoids the wrong-role bounce a hardcoded /student/dashboard would cause.
     A signed-out visitor is sent at the student dashboard too, where
     ProtectedRoute takes them to /login. */
  const backTarget = user ? homeForRole(user.role) : '/student/dashboard';

  const [timeControl, setTimeControl] = useState(DEFAULT_TIME_CONTROL);
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [selectedId, setSelectedId] = useUrlView('bot');

  const selected = selectedId ? forBot(selectedId) : null;
  const chatOn = settings.chat !== false;

  /* Tiers in ladder order. Every tier is open now — the unlock ladder that used
     to sit between them was removed — so the only per-tier state left is how
     many of its bots the player has beaten. The roster comes from the per-bot
     `difficulty` field, not from the band. */
  const tiers = useMemo(
    () =>
      DIFFICULTY_BANDS.map((band) => {
        const bots = getBotsByDifficulty(band.id)
          .map((bot) => forBot(bot.id))
          .filter(Boolean);
        const beaten = bots.filter((b) => b.defeated).length;
        return { band, bots, beaten, total: bots.length };
      }),
    [forBot],
  );

  const play = (bot) => {
    if (!bot?.unlocked) return;
    navigate(`/play/bot/${bot.id}?tc=${timeControl}&color=${color}`);
  };

  return (
    <div className="min-h-screen bg-ink-900 text-ivory-100">
      <div className="mx-auto max-w-7xl space-y-5 px-3 py-4 sm:px-4 sm:py-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 sm:gap-3">
            <Link
              to={backTarget}
              className="rounded-lg border border-ivory-500/60 px-2 py-1 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
            >
              ← Back
            </Link>
            <h1 className="flex items-center gap-2 text-xl font-bold sm:text-2xl">
              <span aria-hidden="true">🤖</span> Play vs Bots
            </h1>
          </div>

          <div className="flex items-center gap-2">
            {/* Sync is informational only — offline play is fully supported, so
                this never blocks or warns the player. */}
            {syncState === 'syncing' && <span className="text-xs text-ivory-300">Syncing…</span>}
            <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-500/50 bg-blue-500/12 px-3 py-1 text-sm font-bold text-ivory-100">
              <span aria-hidden="true">🪙</span>
              <span className="tabular-nums">{rewards.coins}</span>
              <span className="sr-only">Bot Coins</span>
            </span>
          </div>
        </header>

        <RewardTrack coins={rewards.coins} />

        {/* ── Setup: applies to whichever bot is picked ─────────────────── */}
        <section
          className="sticky top-0 z-20 rounded-2xl border border-blue-500/45 bg-blue-500/[0.07] p-3 backdrop-blur sm:p-4"
          aria-label="Game setup"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <fieldset className="min-w-0">
              <legend className="sr-only">Time control</legend>
              <div className="flex flex-wrap gap-1.5">
                {TIME_CONTROLS.map((tc) => (
                  <button
                    key={tc.id}
                    type="button"
                    onClick={() => setTimeControl(tc.id)}
                    aria-pressed={timeControl === tc.id}
                    className={`rounded-lg border px-2.5 py-1.5 text-xs transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${
                      timeControl === tc.id
                        ? 'border-blue-600 bg-blue-500/25 text-blue-900 font-semibold'
                        : 'border-blue-500/45 bg-blue-500/10 text-ivory-200 font-medium hover:bg-blue-500/20 hover:border-blue-500'
                    }`}
                  >
                    <span aria-hidden="true">{tc.icon} </span>
                    {tc.label}
                    <span className="ml-1 hidden text-ivory-300 sm:inline">{tc.sub}</span>
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend className="sr-only">Play as</legend>
              <div className="flex gap-1.5">
                {COLOR_CHOICES.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setColor(c.id)}
                    aria-pressed={color === c.id}
                    className={`rounded-lg border px-2.5 py-1.5 text-xs transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${
                      color === c.id
                        ? 'border-blue-600 bg-blue-500/25 text-blue-900 font-semibold'
                        : 'border-blue-500/45 bg-blue-500/10 text-ivory-200 font-medium hover:bg-blue-500/20 hover:border-blue-500'
                    }`}
                  >
                    <span aria-hidden="true">{c.glyph} </span>
                    {c.label}
                  </button>
                ))}
              </div>
            </fieldset>

            <div className="flex-1" />

            {/* Only rendered once a bot is actually chosen. Previously this also
                drew a disabled "Select a bot" button, which was dead weight: it
                started disabled and could only leave that state by the user
                picking a card elsewhere on the page.

                shrink-0 + whitespace-nowrap are load-bearing. This button sits in
                a flex-row next to a `flex-1` spacer, and flex items shrink by
                default, so the spacer used to squeeze the label down to nothing
                and the text appeared to vanish. Pinning the width stops that. */}
            {selected && selected.unlocked && (
              <Button
                type="button"
                variant="primary"
                size="lg"
                className="w-full shrink-0 whitespace-nowrap sm:w-auto"
                onClick={() => play(selected)}
              >
                {`Play ${selected.bot.name}`}
              </Button>
            )}
          </div>
        </section>

        {/* ── Selected bot detail ───────────────────────────────────────── */}
        {selected && (
          <section className="flex flex-col gap-4 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-4 sm:flex-row">
            <BotAvatar bot={selected.bot} size={64} />
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-semibold">{selected.bot.name}</h2>
              <p className="text-sm text-ivory-200">
                Rated {selected.bot.rating} · {selected.bot.difficulty}
                {selected.record?.bestAccuracy ? ` · best accuracy ${selected.record.bestAccuracy}%` : ''}
              </p>
              {selected.bot.description && (
                <p className="mt-2 text-sm text-ivory-300">{selected.bot.description}</p>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                {selected.defeated && (
                  <span className="rounded-full border border-blue-500/45 bg-blue-500/12 px-2 py-0.5 text-xs font-semibold text-ivory-100">
                    Defeated
                  </span>
                )}
                {selected.record?.gamesPlayed > 0 && (
                  <span className="rounded-full border border-blue-500/40 bg-blue-500/10 px-2 py-0.5 text-xs font-semibold text-ivory-200 tabular-nums">
                    {selected.record.wins}W · {selected.record.losses}L · {selected.record.draws}D
                  </span>
                )}
                <BotChatToggle enabled={chatOn} onToggle={(v) => updateSetting('chat', v)} />
              </div>

              {/* Next-bot challenge: only meaningful once this one is beaten. */}
              {selected.defeated && (() => {
                const next = getNextChallenge(selected.bot.id);
                const nextInfo = next ? forBot(next.id) : null;
                if (!nextInfo) return null;
                return (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="mt-3"
                    onClick={() => play(nextInfo)}
                  >
                    Next challenge: {nextInfo.bot.name} ({nextInfo.bot.rating})
                  </Button>
                );
              })()}
            </div>
          </section>
        )}

        {/* ── Tiers ─────────────────────────────────────────────────────────
            There used to be a "New to chess? Start here" strip above this,
            featuring the first four NEWCOMER_BOT_IDS. Every one of those bots is
            difficulty Beginner, and the Beginner tier always rendered
            (`requiresDefeats: 0`), so all four were rendered a second time
            immediately below - two live cards per bot, each with its own
            selected/locked state. The tier grid is the canonical catalogue, so
            the redundant strip is gone rather than the tier entries. */}
        {tiers.map(({ band, bots, beaten, total }) => (
          <section key={band.id} className="space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold text-ivory-200">
                {band.icon} {band.label}
                <span className="ml-2 text-xs font-normal text-ivory-500">{band.blurb}</span>
              </h2>
              <span className="text-xs text-ivory-300 tabular-nums">
                {beaten}/{total} defeated
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {bots.map((b) => (
                <BotCard
                  key={b.bot.id}
                  bot={b.bot}
                  record={b.record}
                  unlocked={b.unlocked}
                  lockReason={b.lockReason}
                  onSelect={() => setSelectedId(b.bot.id)}
                  selected={selectedId === b.bot.id}
                  timeControl={timeControl}
                  color={color}
                />
              ))}
            </div>
          </section>
        ))}

        <p className="pb-6 text-center text-xs text-ivory-600">
          Bot games run entirely on your device — no internet needed after the first load.
        </p>
      </div>
    </div>
  );
}

/** Compact chat toggle used inside the selected-bot panel. */
function BotChatToggle({ enabled, onToggle }) {
  return (
    <button
      type="button"
      onClick={() => onToggle(!enabled)}
      aria-pressed={enabled}
      className="rounded-full border border-blue-500/40 bg-blue-500/10 px-2 py-0.5 text-xs font-semibold text-ivory-200 hover:bg-blue-500/20 hover:border-blue-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
    >
      {enabled ? '💬 Chat on' : '💬 Chat off'}
    </button>
  );
}