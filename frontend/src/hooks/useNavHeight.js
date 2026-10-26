import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * The height of the app's sticky top bar, measured from the DOM.
 *
 * Two things need it and neither can hard-code a number: the top bar is
 * `py`-padded, so its height changes with the content (the profile chip, the
 * notification bell, the longest brand line), and the shells and the public
 * pages size their bars differently.
 *
 * The measurement is also published as the CSS custom property
 * `--app-nav-h`, so a stylesheet can anchor to it (the sidebar's sticky top
 * and height) without React having to thread the number through every
 * component.
 *
 * It is re-measured on every route change: the bar comes and goes with the
 * surface, so a surface with no bar must report 0 rather than the height of
 * the bar on the previous one.
 *
 * @returns {number|null} the measured height in px, 0 when the surface has no
 *   top bar at all, and null while it has not been measured yet.
 */
export default function useNavHeight() {
  const [height, setHeight] = useState(null);
  const { pathname } = useLocation();

  useEffect(() => {
    const publish = () => {
      const header = document.querySelector('header.nav-glass');
      const next = header ? Math.round(header.getBoundingClientRect().height) : 0;
      try {
        document.documentElement.style.setProperty('--app-nav-h', `${next}px`);
      } catch { /* no document (tests) */ }
      setHeight((prev) => (prev === next ? prev : next));
    };

    publish();
    const header = document.querySelector('header.nav-glass');
    let ro = null;
    if (header && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(publish);
      ro.observe(header);
    }
    window.addEventListener('resize', publish);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener('resize', publish);
    };
  }, [pathname]);

  return height;
}
