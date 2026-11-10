import emblemUrl from '../assets/logo-emblem.png';
import { APP_NAME_SHORT } from '../config/brand';

/**
 * Shared brand lockup: the MZ emblem artwork, then the name as real text.
 *
 * The name is not taken from the logo file — the artwork carries no wordmark,
 * and baking one in would make it unreadable at header sizes.
 *
 * `height` sets `--brand-h`, which sizes the NAME, so one proportion holds
 * across every header. The emblem is a fixed 36px at every width in the brand
 * rules, and it is drawn with no box around it.
 *
 * The emblem ships on a transparent background — cropped out of the brand
 * artwork above its wordmark — so it sits directly on the bar: no chip, frame
 * or forced square. The old file had a white rounded card baked into it, which
 * is what read as a box.
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
