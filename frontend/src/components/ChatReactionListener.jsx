import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { on } from '../services/socket';
import { useToast } from './Toast';
import { useAuth } from '../context/AuthContext';

export default function ChatReactionListener() {
  const { showToast } = useToast();
  const { user } = useAuth();
  const navigate = useNavigate();
  const meId = Number(user?.id ?? 0);
  const isStudent = user?.role === 'student';

  useEffect(() => {
    const off = on('chat_reaction', (payload) => {
      if (!payload) return;
      const from = Number(payload.userId);
      if (!from || from === meId) return;          /* my own reaction */
      if (payload.added === false) return;         /* someone un-reacted */
      /* Only the message AUTHOR gets told — in a group everyone sees the
         reaction, but reacting to someone else's message isn't news to me. */
      if (payload.authorId != null && Number(payload.authorId) !== meId) return;

      showToast(`${payload.actorName || 'Someone'} reacted ${payload.emoji || ''} to your message.`, {
        tone: 'info',
        title: `${payload.emoji || '💬'} New reaction`,
        duration: 6000,
        action: {
          label: 'Open chat',
          onClick: () => navigate(isStudent ? '/student/messages' : '/admin/messages'),
        },
      });
    });
    return off;
  }, [showToast, meId, navigate, isStudent]);

  return null;
}

/* Both import styles are exported on purpose: this component is pulled in by
   default in App.jsx, and a named import elsewhere must keep resolving rather
   than fail the whole bundle with "does not provide an export named". */
export { ChatReactionListener };
