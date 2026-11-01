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
import './index.css';
import './styles/classroom-v2.css';
/* Certificates module styles. After index.css so it can rely on the same custom
   properties and shared .chess-* classes. */
import './certificates.css';
/* App-wide Tournaments-style light theme. MUST stay last: it normalises the
   legacy dark/cyan surfaces above by re-pointing tokens and restyling the
   shared .chess-* primitives, so import order is what makes it win. */
import './theme/academy-theme.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <AuthProvider>
        {/* Inside AuthProvider: permission resolution depends on the signed-in user. */}
        <PermissionProvider>
          {/* Also inside AuthProvider and above the shells, because the Super
              Admin's nav order is fetched for the signed-in user and has to
              reach every nav at once — rail, phone menu and student menu. */}
          <SidebarOrderProvider>
            <ChatProvider>
              {/* Outermost inside the router: the sound preference is app-wide, so */}
              {/* every board and settings surface reads the same value. */}
              <SoundProvider>
                <ToastProvider>
                  <App />
                </ToastProvider>
              </SoundProvider>
            </ChatProvider>
          </SidebarOrderProvider>
        </PermissionProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);

/* Hand the screen over from the inline boot splash in index.html. It waits for
   #root to actually hold the rendered tree rather than a fixed delay, so the
   splash is gone the moment there is something to look at — and if the app
   never mounts, the splash stays, which beats a blank page. */
const bootSplash = document.getElementById('boot-splash');
if (bootSplash) {
  const handOff = () => {
    if (document.querySelector('#root > *')) bootSplash.remove();
    else requestAnimationFrame(handOff);
  };
  requestAnimationFrame(handOff);
}

/* Dev is deliberately excluded: a caching worker on top of Vite's HMR serves
   stale modules back into the editor and makes every change invisible. */
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
