import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { PermissionProvider } from './context/PermissionContext.jsx';
import { SidebarOrderProvider } from './context/SidebarOrderContext.jsx';
import { ChatProvider } from './context/ChatContext.jsx';
import { SoundProvider } from './context/SoundContext.jsx';
import './index.css';
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
                <App />
              </SoundProvider>
            </ChatProvider>
          </SidebarOrderProvider>
        </PermissionProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
