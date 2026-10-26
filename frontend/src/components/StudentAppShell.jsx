import { FullHeightProvider } from '../context/FullHeightContext';
import AppShell from './AppShell';

/**
 * Student shell — uses the shared AppShell with the student portal config.
 * Header: "♛ Student Hub / Learning Center"
 * Footer: "♔ Every master was once a beginner."
 *
 * Sidebar menu items come from sidebarConfigs.js (studentLinks) — same items
 * as before, same labels, icons and routes.
 */
export default function StudentAppShell({ children }) {
  return (
    <FullHeightProvider>
      <AppShell portal="student">{children}</AppShell>
    </FullHeightProvider>
  );
}