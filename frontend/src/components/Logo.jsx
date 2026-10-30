import logoUrl from '../assets/logo.jpeg';

/**
 * Shared brand logo.
 *
 * The image is imported so Vite emits it with a hashed URL. A bare
 * "assets/logo.jpeg" src is a *relative* URL: it resolves against the current
 * route, so /login and /admin/dashboard asked for /login/assets/logo.jpeg and
 * every header rendered a broken image.
 *
 * `height` sets the size (default 40px) and the width follows the aspect ratio.
 * `src` stays overridable for a logo supplied from elsewhere.
 */
export default function Logo({ src = logoUrl, alt = 'Mate Zone', height = 40, className = '', style = {} }) {
  return (
    <img
      src={src || logoUrl}
      alt={alt}
      className={className}
      style={{
        width: 'auto',
        height,
        objectFit: 'contain',
        ...style,
      }}
    />
  );
}
