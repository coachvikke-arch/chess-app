import { createContext, useContext, useState, useCallback } from 'react';

const FullHeightContext = createContext(null);

/**
 * Provider for full-height page mode. Pages that need the full viewport height
 * (Play Arena, Game Review, Live Classroom) can call useFullHeight() and set
 * it to true. The AdminAppShell will then apply the 'admin-content-full' class
 * to the content area, making it fill the remaining height without scrolling.
 */
export function FullHeightProvider({ children }) {
  const [isFullHeight, setIsFullHeight] = useState(false);

  const requestFullHeight = useCallback((enabled) => {
    setIsFullHeight(enabled);
  }, []);

  return (
    <FullHeightContext.Provider value={{ isFullHeight, requestFullHeight }}>
      {children}
    </FullHeightContext.Provider>
  );
}

export function useFullHeight() {
  const context = useContext(FullHeightContext);
  if (!context) {
    // Return default values instead of throwing, so components work without provider
    return { isFullHeight: false, requestFullHeight: () => {} };
  }
  return context;
}

export default FullHeightContext;