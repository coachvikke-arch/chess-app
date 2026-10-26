import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

export function useUrlView(key = 'view') {
  const navigate = useNavigate();
  const read = () => {
    const sp = new URLSearchParams(window.location.search);
    return sp.get(key);
  };
  const [value, setValue] = useState(read());

  useEffect(() => {
    const onPop = () => setValue(read());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [key]);

  const setView = useCallback((next, options = {}) => {
    if (next === value && !options.replace) return;
    const sp = new URLSearchParams(window.location.search);
    if (next == null) sp.delete(key);
    else sp.set(key, next);
    navigate({ search: sp.toString() ? '?' + sp.toString() : '' }, { replace: !!options.replace });
    setValue(next);
  }, [value, key, navigate]);

  return [value, setView];
}
