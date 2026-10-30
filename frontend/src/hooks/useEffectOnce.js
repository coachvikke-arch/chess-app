/**
 * useEffectOnce - Run an effect only once on mount
 * 
 * Usage:
 * const [value, setValue] = useState(null);
 * useEffectOnce(() => {
 *   fetchData().then(data => setValue(data));
 * }, []);
 * 
 * This is useful when you want the effect to run like useEffect but only on the
 * initial render, not on re-renders or re-mounts.
 */
import { useEffect } from 'react';

function useEffectOnce(effect, deps) {
  const mountedRef = useRef(true);

  useEffect(() => {
    if (mountedRef.current) {
      mountedRef.current = false;
      return effect();
    }
  }, deps);
}

export default useEffectOnce;
