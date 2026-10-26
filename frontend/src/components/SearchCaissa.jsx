import { useEffect, useRef } from 'react';
import lottie from 'lottie-web';
import searchCaissa from '../assets/search-caissa.json';

/**
 * SearchCaissa — the "Search Caissa" Lottie (a knight under a searching
 * magnifying glass), shown while Stockfish is analysing the moves.
 * Loops automatically; accepts a className for sizing.
 */
export default function SearchCaissa({ className = '' }) {
  const el = useRef(null);

  useEffect(() => {
    if (!el.current) return undefined;
    const anim = lottie.loadAnimation({
      container: el.current,
      renderer: 'svg',
      loop: true,
      autoplay: true,
      animationData: searchCaissa,
    });
    return () => anim.destroy();
  }, []);

  return <div className={`mascot-lottie-search ${className}`} ref={el} aria-hidden="true" />;
}