import emblemUrl from '../assets/logo-emblem.png';
import { APP_NAME_SHORT } from '../config/brand';

/**
 * Shared brand lockup: the MZ emblem artwork, then the name as real text.
 *
 * The name is not taken from the logo file — the artwork carries no wordmark,
 * and baking one in would make it unreadable at header sizes.
 *
 * `height` is the emblem height in px and the name scales from it, which keeps
 * one proportion across every header. `name={false}` gives the artwork alone.
 *
 * The emblem ships on a transparent background, keyed out of the black the
 * artwork was drawn on, so it sits on the light bars without a box around it.
 *
 * The image is imported so Vite emits it with a hashed URL. A bare
 * "assets/logo-emblem.png" src is a *relative* URL: it resolves against the
 * current route, so /login asked for /login/assets/logo-emblem.png and the
 * header rendered a broken image.
 */
export default function Logo({
  src = emblemUrl,
  alt = 'Mate Zone Chess Academy',
  height = 44,
  name = APP_NAME_SHORT,
  className = '',
  style = {},
}) {
  const [head, ...tail] = String(name).split(' ');
  return (
    <span
      className={`brand-lockup ${className}`}
      style={{ '--brand-h': `${height}px`, ...style }}
    >
      <img src={src || emblemUrl} alt={name ? '' : alt} className="brand-emblem" />
      {name && (
        <span className="brand-name">
          {head}
          {tail.length > 0 && <b>{` ${tail.join(' ')}`}</b>}
        </span>
      )}
    </span>
  );
}
