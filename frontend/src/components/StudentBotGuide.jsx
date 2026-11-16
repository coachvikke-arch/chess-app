import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useBot } from '../../matezone-bot/bot/BotContext.jsx';

/* One row per student route, all four columns required: the bubble always
   navigates somewhere useful, so a page without a row would be a page where
   the bot stays silent. Destinations are the page the sentence nudges toward,
   never the page it is already on, so tapping the message always moves. */
const GUIDES = [
  ['/student/dashboard', 'navDashboard', 'calm', '/student/trainer'],
  ['/student/homework', 'navHomework', 'calm', '/student/trainer'],
  ['/student/puzzles', 'navHomework', 'calm', '/student/trainer'],
  ['/student/trainer', 'navTrainer', 'calm', '/student/analysis'],
  ['/student/openings', 'navAcademy', 'calm', '/student/trainer'],
  ['/openings', 'navOpenings', 'calm', '/student/trainer'],
  ['/student/board-vision', 'navBoardVision', 'calm', '/student/trainer'],
  ['/student/leaderboard', 'navLeaderboard', 'calm', '/student/trainer'],
  ['/student/live-meetings', 'navMeetings', 'alert', '/student/attendance'],
  ['/student/messages', 'navMessages', 'calm', '/student/messages?tab=people'],
  ['/student/notifications', 'navNotifications', 'calm', '/student/messages'],
  ['/student/assignments', 'navAssignments', 'calm', '/student/homework'],
  ['/student/attendance', 'navAttendance', 'calm', '/student/live-meetings'],
  ['/student/analysis', 'navArena', 'calm', '/student/review'],
  ['/student/profile', 'navProfile', 'calm', '/student/chess-profile'],
  ['/student/report', 'navReport', 'calm', '/student/trainer'],
  ['/student/performances', 'navPerformances', 'calm', '/student/analysis'],
  ['/student/certificates', 'navCertificates', 'happy', '/student/report'],
  ['/student/chess-profile', 'navChessProfile', 'calm', '/student/review'],
  ['/student/ratings', 'navRatings', 'calm', '/student/review'],
  ['/student/tournaments', 'navTournaments', 'calm', '/student/review'],
  ['/student/review', 'navReview', 'calm', '/student/analysis'],
  ['/student/settings', 'navSettings', 'calm', '/student/profile'],
  ['/student/tactics', 'navTactics', 'calm', '/student/trainer'],
  ['/student/gm-games', 'navGmGames', 'calm', '/student/review'],
  ['/student/game-analysis', 'navGameAnalysis', 'calm', '/student/review'],
];

export default function StudentBotGuide() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { enabled, suppressed, showBotFrom } = useBot();

  useEffect(() => {
    if (user?.role !== 'student' || !enabled || suppressed) return undefined;
    const guide = GUIDES.find(([path]) => pathname === path || pathname.startsWith(`${path}/`));
    if (!guide) return undefined;
    const [path, group, mood, destination] = guide;
    const key = `mz-bot-nav-${user.id}-${path}`;
    if (sessionStorage.getItem(key)) return undefined;

    const timer = window.setTimeout(() => {
      sessionStorage.setItem(key, '1');
      showBotFrom(group, mood, {}, { onClick: () => navigate(destination) });
    }, 650);
    return () => window.clearTimeout(timer);
  }, [enabled, navigate, pathname, showBotFrom, suppressed, user?.id, user?.role]);

  return null;
}
