import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { on } from '../services/socket';
import { useToast } from './Toast';
import { useAuth } from '../context/AuthContext';

/* Always-mounted: the moment a tournament board is created for this student the
   server pushes `tournament:game:ready`. Show a toast with a one-tap Play button
   so nobody misses their pairing (and loses to the no-show timer). */
export default function TournamentReadyListener() {
  const { showToast } = useToast();
  const { user } = useAuth();
  const navigate = useNavigate();
  const isStudent = user?.role === 'student';

  useEffect(() => {
    if (!isStudent) return undefined;
    const off = on('tournament:game:ready', (p) => {
      if (!p || !p.gameId) return;
      showToast(`Your tournament game vs ${p.opponent || 'your opponent'} is ready - you have the ${p.color} pieces.`, {
        tone: 'success',
        title: 'Your board is ready',
        duration: 20000,
        dedupeKey: `tournament-ready:${p.gameId}`,
        action: { label: 'Play now', onClick: () => navigate(`/student/tournaments/game/${p.gameId}`) },
      });
    });
    return off;
  }, [isStudent, showToast, navigate]);

  return null;
}
