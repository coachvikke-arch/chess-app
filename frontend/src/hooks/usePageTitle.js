import { useEffect } from 'react';
import { appTitle } from '../config/brand';

/**
 * Sets document.title to "<page> | MATE ZONE CHESS ACADEMY".
 *
 * Called by the shared Page / PageHeader components, and directly by pages
 * that render their own heading. Every page that mounts owns the title, so no
 * route-level effect can overwrite it afterwards.
 */
export default function usePageTitle(page) {
  useEffect(() => {
    if (!page) return;
    document.title = appTitle(page);
  }, [page]);
}
