import { FullHeightProvider } from '../context/FullHeightContext';
import AppShell from './AppShell';

/**
 * Admin/Coach shell — uses the shared AppShell with the admin portal config.
 * Header: "♛ Coach Suite / Command Center"
 * Footer: "♔ Every master was once a beginner."
 */
export default function AdminAppShell({ children }) {
  return (
    <FullHeightProvider>
      <AppShell portal="admin">{children}</AppShell>
    </FullHeightProvider>
  );
}