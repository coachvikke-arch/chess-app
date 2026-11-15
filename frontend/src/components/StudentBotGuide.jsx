import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { DIFFICULTY_BANDS, getBotsByDifficulty } from '../data/bots';
import { useAuth } from '../context/AuthContext';
import { useBot } from '../../matezone-bot/bot/BotContext.jsx';

const GUIDES = [
  ['/student/dashboard', 'navDashboard', 'calm', '/student/trainer'],
  ['/student/homework', 'navHomework', 'calm', '/student/trainer'],
  ['/student/puzzles', 'navHomework', 'calm', '/student/trainer'],
  ['/student/trainer', 'navTrainer', 'calm', '/student/analysis'],
  ['/student/openings', 'navAcademy', 'calm', '/student/trainer'],
  ['/openings', 'navOpenings', 'calm', '/student/trainer'],
  ['/student/board-vision', 'navBoardVision', 'calm', '/student/trainer'],
  ['/student/leaderboard', null, 'calm', null],
  ['/student/live-meetings', 'navMeetings', 'alert', '/student/attendance'],
  ['/student/messages', 'navMessages', 'calm', null],
  ['/student/attendance', 'navAttendance', 'calm', '/student/live-meetings'],
  ['/play/bots', 'navPlayBots', 'happy', 'random-bot'],
  ['/student/analysis', 'navArena', 'calm', '/student/review'],
  ['/student/profile', 'navProfile', 'calm', '/student/profile'],
  ['/student/report', 'navReport', 'calm', '/student/trainer'],
  ['/student/performances', 'navPerformances', 'calm', '/student/analysis'],
  ['/student/certificates', 'navCertificates', 'happy', '/student/report'],
  ['/student/chess-profile', 'navChessProfile', 'calm', '/student/review'],
  ['/student/ratings', 'navRatings', 'calm', '/student/analysis'],
  ['/student/tournaments', 'navTournaments', 'calm', '/student/analysis'],
  ['/student/review', 'navReview', 'calm', '/student/analysis'],
  ['/student/settings', 'navSettings', 'calm', '/student/trainer'],
  ['/student/tactics', 'navTactics', 'calm', '/student/tactics'],
  ['/student/gm-games', 'navGmGames', 'calm', '/student/review'],
];

function randomBotPath() {
  const bots = DIFFICULTY_BANDS.flatMap((band) => getBotsByDifficulty(band.id));
  if (!bots.length) return '/play/bots';
  const selected = bots[Math.floor(Math.random() * bots.length)];
  return `/play/bot/${selected.id}`;
}

export default function StudentBotGuide() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { enabled, suppressed, showBotFrom } = useBot();

  useEffect(() => {
    if (user?.role !== 'student' || !enabled || suppressed) return undefined;
    const guide = GUIDES.find(([path]) => pathname === path || pathname.startsWith(`${path}/`));
    if (!guide || !guide[1]) return undefined;
    const [path, group, mood, destination] = guide;
    const key = `mz-bot-nav-${user.id}-${path}`;
    if (sessionStorage.getItem(key)) return undefined;

    const timer = window.setTimeout(() => {
      sessionStorage.setItem(key, '1');
      const onClick = destination
        ? () => navigate(destination === 'random-bot' ? randomBotPath() : destination)
        : undefined;
      showBotFrom(group, mood, {}, { ...(onClick ? { onClick } : {}) });
    }, 650);
    return () => window.clearTimeout(timer);
  }, [enabled, navigate, pathname, showBotFrom, suppressed, user?.id, user?.role]);

  return null;
}
