import { useCallback } from 'react';
import { useToast } from '../components/Toast';
import { copyText } from '../utils/clipboard';
import { buildFullPgn } from '../utils/gamePgn';

/*
 * The one copy path every "Copy PGN" button uses: build the full PGN, put it on
 * the clipboard (with the non-secure-context fallback in utils/clipboard), then
 * confirm with the small "Copied!" toast.
 *
 * Accepts either a game object (see buildFullPgn's shape) or an already-built
 * PGN string, so a caller that shows the PGN on screen copies exactly that text.
 */
export default function useCopyPgn() {
  const { showToast } = useToast();
  return useCallback(async (gameOrText) => {
    const text = typeof gameOrText === 'string' ? gameOrText : buildFullPgn(gameOrText);
    const ok = await copyText(text);
    showToast(ok ? 'Copied!' : 'Could not copy the PGN — select it and copy manually.', {
      tone: ok ? 'success' : 'error',
      duration: 2000,
    });
    return ok;
  }, [showToast]);
}
