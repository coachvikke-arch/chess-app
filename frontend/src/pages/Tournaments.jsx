/* Tournaments main page */
import { useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../components/Toast';
import { useChat } from '../context/ChatContext';
import Button from '../components/Button';

function Tournaments() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { threadFor, messages, conversations, contacts, searchQuery } = useChat();

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0 });
  }, [user?.role]);

  return (
    <div className="chat-screen w-full">
      <div className="rounded-2xl border border-ivory-700/50 bg-ink-800 overflow-hidden chat-card">
        <div className="flex items-center gap-1.5 px-3 py-3 border-b border-ivory-700/40">
          <h1 className="text-xl font-bold text-ivory-300">Tournaments</h1>
        </div>

        <div className="p-4">
          {user ? (
            <div>
              <p className="text-ivory-600 mb-4">
                Manage and view tournament events.
              </p>
              {user.role === 'superadmin' && (
                <p className="text-ivory-500 mb-2">Super Admin view</p>
              ) || user.role === 'admin' && (
                <p className="text-ivory-500 mb-2">Coach view</p>
              ) || user.role === 'student' && (
                <p className="text-ivory-500 mb-2">Student view</p>
              )}
            </div>
          ) : (
            <Button to="/login" variant="primary">
              Login to view tournaments
            </Button>
          )}

          {searchQuery && (
            <p className="mt-4 text-ivory-500">Search: {searchQuery}</p>
          )}

          {conversations?.length > 0 ? (
            <p className="mt-4 text-ivory-500">
              You have {conversations.length} active tournament conversation(s)
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default Tournaments;