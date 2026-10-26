import { useEffect, useState } from 'react';
import { DEFAULT_BOT_AVATAR } from '../../data/bots';

/**
 * Bot portrait.
 *
 * Every bot has a real PNG in `public/assets/bots/<id>.png`, and `bot.avatar`
 * is that path (built once, centrally, in `data/bots.ts`). This component is the
 * single place a portrait is rendered, so the selection screen, the game header,
 * the post-game popup and the chat panel all show the same face.
 *
 * FALLBACK
 *
 * If a portrait fails to load, we fall back to a generic chess avatar
 * (`default.png`) rather than to letters. The old fallback drew the bot's
 * two-letter monogram, which was ambiguous by construction: `mia` and `milo`
 * both render "MI", so a coach could not tell them apart in a result list.
 *
 * The `broken` state is keyed on the src so switching bots re-arms the real
 * image instead of leaving the previous bot stuck on the fallback.
 */
export default function BotAvatar({
  bot,
  size = 64,
  className = '',
  rounded = 'rounded-full',
  alt,
}) {
  const [broken, setBroken] = useState(false);
  const src = bot?.avatar || DEFAULT_BOT_AVATAR;
  const label = alt || `${bot?.name || 'Bot'} avatar`;

  /* A new bot means a new asset; re-arm the <img> attempt. */
  useEffect(() => {
    setBroken(false);
  }, [src]);

  const finalSrc = broken ? DEFAULT_BOT_AVATAR : src;

  return (
    <img
      src={finalSrc}
      alt={label}
      width={size}
      height={size}
      onError={() => {
        /* Guard against a loop: if even default.png fails, stop retrying and
           render an empty box rather than firing a request on every render. */
        if (!broken) setBroken(true);
      }}
      data-bot-avatar={broken ? 'fallback' : 'portrait'}
      className={`shrink-0 object-cover border border-ivory-700/40 ${rounded} ${className}`}
      style={{ width: size, height: size }}
    />
  );
}