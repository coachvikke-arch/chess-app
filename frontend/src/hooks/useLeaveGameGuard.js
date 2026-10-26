import { useState, useEffect, useRef, useCallback } from 'react';

export function useLeaveGameGuard(isLive) {
  const [open, setOpen] = useState(false);
  const pushedRef = useRef(false);

  useEffect(() => {
    if (!isLive) return;
    const onBeforeUnload = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onBeforeUnload);

    const onPop = () => {
      if (!isLive) return;
      // keep the user on the page
      try { window.history.pushState({ leaveGuard: true }, '', window.location.href); } catch {}
      setOpen(true);
    };
    window.addEventListener('popstate', onPop);

    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('popstate', onPop);
    };
  }, [isLive]);

  const stay = useCallback(() => setOpen(false), []);
  const leave = useCallback(() => {
    setOpen(false);
    try { window.history.back(); } catch {}
  }, []);

  return { open, stay, leave };
}
