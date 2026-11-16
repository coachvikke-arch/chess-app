import { useLayoutEffect, useState } from 'react';
import { COORD_DARK_INK, COORD_LIGHT_INK, contrastInk } from '../utils/colorContrast';

const DEFAULT_INK = { light: COORD_DARK_INK, dark: COORD_LIGHT_INK };

/* Coordinate ink for the board palette actually on screen. Square colours live
   on --board-light/--board-dark: AuthContext repoints them for the saved theme
   or the user's custom pair, and a Settings preview repaints them on its own
   host while the colour picker is dragged. Reading the computed values — and
   re-reading when the host chain or the root changes — keeps the coordinates
   readable on every board, including mid-drag recolours. */
export function useSquareInk(hostRef = null) {
  const [ink, setInk] = useState(DEFAULT_INK);

  useLayoutEffect(() => {
    const root = document.documentElement;
    const host = hostRef?.current || root;

    const read = () => {
      const style = getComputedStyle(host);
      const next = {
        light: contrastInk(style.getPropertyValue('--board-light')) || COORD_DARK_INK,
        dark: contrastInk(style.getPropertyValue('--board-dark')) || COORD_LIGHT_INK,
      };
      setInk((prev) => (prev.light === next.light && prev.dark === next.dark ? prev : next));
    };

    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ['style', 'data-board-color-custom'] });
    for (let el = host; el && el !== root; el = el.parentElement) {
      observer.observe(el, { attributes: true, attributeFilter: ['style'] });
    }
    return () => observer.disconnect();
  }, [hostRef]);

  return ink;
}

export default useSquareInk;
