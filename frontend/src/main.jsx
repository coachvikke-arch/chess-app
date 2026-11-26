import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { PermissionProvider } from './context/PermissionContext.jsx';
import { SidebarOrderProvider } from './context/SidebarOrderContext.jsx';
import { ChatProvider } from './context/ChatContext.jsx';
import { SoundProvider } from './context/SoundContext.jsx';
/* The toast provider has to sit above the router's pages: every page and the
   chat composer call useToast(), and without it that call returns null and
   destructuring it throws on first use. */
import { ToastProvider } from './components/Toast.jsx';
import { BotProvider as ClockBotProvider } from './components/bot/BotProvider.jsx';
import './index.css';
/* Certificates module styles. After index.css so it can rely on the same custom
   properties and shared .chess-* classes. */
import './certificates.css';
/* App-wide Tournaments-style light theme. MUST stay last: it normalises the
   legacy dark/cyan surfaces above by re-pointing tokens and restyling the
   shared .chess-* primitives, so import order is what makes it win. */
import './theme/academy-theme.css';

function AppWithBot() {
  return (
    <ClockBotProvider>
      <PermissionProvider>
        <SidebarOrderProvider>
          <ChatProvider>
            <SoundProvider>
              <ToastProvider>
                <App />
              </ToastProvider>
            </SoundProvider>
          </ChatProvider>
        </SidebarOrderProvider>
      </PermissionProvider>
    </ClockBotProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <AuthProvider>
        <AppWithBot />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);

/* Dev is deliberately excluded: a caching worker on top of Vite's HMR serves
   stale modules back into the editor and makes every change invisible. */
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
