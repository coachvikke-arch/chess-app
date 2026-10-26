import { useCallback, useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';

export function useUrlTab(key = 'tab', defaultTab) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const raw = params.get(key);
  const [tab, setTab] = useState(raw && raw.trim() ? raw : defaultTab);

  useEffect(() => {
    const v = params.get(key);
    if (v && v.trim()) setTab(v);
    else if (defaultTab) setTab(defaultTab);
  }, [params, key, defaultTab]);

  const changeTab = useCallback((next) => {
    if (next === tab) return;
    const sp = new URLSearchParams(window.location.search);
    if (next == null || next === defaultTab) sp.delete(key);
    else sp.set(key, next);
    navigate({ search: sp.toString() ? '?' + sp.toString() : '' }, { replace: false });
    setTab(next ?? defaultTab ?? null);
  }, [tab, key, defaultTab, navigate]);

  // ensure default handling: if default is non-null and missing, push via replace
  useEffect(() => {
    if (defaultTab != null && !params.get(key)) {
      const sp = new URLSearchParams(window.location.search);
      sp.set(key, defaultTab);
      navigate({ search: '?' + sp.toString() }, { replace: true });
    }
  }, []); // eslint-disable-line

  return [tab, changeTab];
}
