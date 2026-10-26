import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import usePageTitle from '../hooks/usePageTitle';

const HeaderContext = createContext({
  heading: null,
  registerHeading: () => {},
  unregisterHeading: () => {},
});

/**
 * Provider for page heading data (icon, title, subtitle).
 * Pages register their heading on mount and unregister on unmount.
 * The TopNavbar consumes this context to display the heading on desktop/tablet.
 */
export function HeaderProvider({ children }) {
  const [heading, setHeading] = useState(null);

  const registerHeading = useCallback((newHeading) => {
    setHeading(newHeading);
  }, []);

  const unregisterHeading = useCallback(() => {
    setHeading(null);
  }, []);

  return (
    <HeaderContext.Provider value={{ heading, registerHeading, unregisterHeading }}>
      {children}
    </HeaderContext.Provider>
  );
}

/**
 * Hook to access the current page heading from the HeaderContext.
 * Returns the heading object or null if none registered.
 */
export function useHeader() {
  return useContext(HeaderContext);
}

/**
 * PageHeader component - replaces the heading block inside Page component.
 * Registers the heading in the HeaderContext on mount, unregisters on unmount.
 * On mobile, renders the heading in-page (as before).
 * On desktop/tablet, renders nothing in-page (heading shows in navbar).
 * 
 * @param {Object} props
 * @param {string} props.icon - Chess piece icon (e.g., '♕', '📚')
 * @param {string} props.title - Page title
 * @param {string} props.subtitle - Page subtitle/description
 * @param {boolean} props.wide - Whether to use wide layout (max-w-[90rem])
 * @param {React.ReactNode} props.children - Page content
 */
export function PageHeader({ icon, title, subtitle, wide = false, children }) {
  const { registerHeading, unregisterHeading } = useHeader();
  usePageTitle(title);

  useEffect(() => {
    registerHeading({ icon, title, subtitle });
    return () => unregisterHeading();
  }, [icon, title, subtitle, registerHeading, unregisterHeading]);

  return (
    <div className={`chess-page ${wide ? 'chess-page-wide' : ''}`}>
      {/* Mobile heading - visible below 1024px */}
      <header className="page-header-mobile chess-page-head lg:hidden">
        <h1 className="chess-page-title">
          <span className="piece-title-icon">{icon}</span>
          {title && <span className="chess-gradient-text">{title}</span>}
        </h1>
        {subtitle && <p className="chess-page-sub">{subtitle}</p>}
      </header>
      {children}
    </div>
  );
}

export default HeaderContext;