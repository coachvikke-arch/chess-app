import BotAvatar from './BotAvatar';

/**
 * Bot Chat — the bot's single line of commentary plus the on/off toggle.
 *
 * This is deliberately NOT a messaging UI. The brief asks for bots that feel
 * alive, and the fastest way to ruin that is to make them chatty: there is no
 * input box, no history and no thread, just one line that changes when
 * something worth reacting to actually happened (see BotDialogueService's
 * cooldown + relevance rules).
 *
 * When muted, the whole region is removed rather than hidden, so an off toggle
 * really does mean silence.
 */
export default function BotChat({ bot, line, enabled, onToggle, thinking = false }) {
  return (
    <div className="rounded-2xl border border-ivory-700/40 bg-ink-800/60 p-3">
      <div className="flex items-center gap-2">
        <BotAvatar bot={bot} size={28} rounded="rounded-full" />
        <div className="min-w-0 flex-1">
          {/* An explicit separator, not just a margin: `ml-1.5` on an inline
              span renders as "PipBeginner" whenever the margin is dropped
              (text extraction, print styles, or a CSS reset). */}
          <p className="truncate text-xs font-semibold text-ivory-200">
            {bot?.name}
            <span className="px-1.5 font-normal text-ivory-500" aria-hidden="true">
              ·
            </span>
            <span className="sr-only">, </span>
            <span className="font-normal text-ivory-500">{bot?.difficulty}</span>
          </p>
        </div>

        {/* The accessible name is set with aria-label rather than an sr-only
            span. Visually hidden text still shows up in text extraction, copy,
            and print, which is how "Chat on — Bot Chat" ended up visible as one
            run-on string. aria-label contributes to the accessible name
            without appearing in the rendered text. */}
        <button
          type="button"
          onClick={() => onToggle(!enabled)}
          className="shrink-0 rounded-lg border border-ivory-700/40 px-2 py-1 text-[11px] text-ivory-400 transition hover:border-gold-500/60 hover:text-gold-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
          aria-pressed={enabled}
          aria-label={enabled ? 'Bot Chat on' : 'Bot Chat off'}
        >
          {enabled ? 'Chat on' : 'Chat off'}
        </button>
      </div>

      {enabled && (
        <p
          className="mt-2 text-sm italic text-ivory-300"
          /* The line changes on its own; announce it politely so it does not
             interrupt whatever the player is doing on the board. */
          aria-live="polite"
        >
          {thinking ? (
            <span className="text-ivory-500">{bot?.name} is thinking…</span>
          ) : line ? (
            <>“{line}”</>
          ) : (
            <span className="text-ivory-500">No comment.</span>
          )}
        </p>
      )}
    </div>
  );
}