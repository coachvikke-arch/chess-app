import { useRef, useEffect, useLayoutEffect, useState } from 'react';
import { Routes, Route, Navigate, Link, useLocation, useNavigate } from 'react-router-dom';
import Navbar, { navLinks } from './components/Navbar';
import Logo from './components/Logo';
/* These four are default exports; importing them by name made Rollup fail the
   whole bundle with "is not exported by ...". */
import ChessBackground from './components/ChessBackground';
import MatchDeclineListener from './components/MatchDeclineListener';
import ChatMessageToastListener from './components/ChatMessageToastListener';
import LevelUpCelebration from './components/LevelUpCelebration';
import MeetingReviewPopup from './components/MeetingReviewPopup';
import { useAuth } from './context/AuthContext';
import { homeForRole, isAdminRole } from './utils/roles';
import { APP_NAME, APP_NAME_SHORT, APP_TAGLINE } from './config/brand';
import ProtectedRoute from './components/ProtectedRoute';
import { FeatureRoute } from './components/FeatureGate';
import { useChat } from './context/ChatContext';
import GameAnalysis from './pages/GameAnalysis';
import BackButton from './components/BackButton';
import useEffectOnce from './hooks/useEffectOnce';
import About from './pages/About';
import ChatReactionListener from './components/ChatReactionListener.jsx';
import Contact from './pages/Contact';
import Courses from './pages/Courses';
import CourseDetails from './pages/CourseDetails';
import NotFound from './pages/NotFound';
import AdminDashboard from './pages/AdminDashboard';
import CommandCenter from './pages/CommandCenter';
import AdminReports from './pages/AdminReports';
import Students from './pages/Students';
import Admins from './pages/Admins';
import AdminReport from './pages/AdminReport';
import CoachReport from './pages/CoachReport';
import SuperAdmin from './pages/SuperAdmin';
import Certificates from './pages/Certificates';
import StudentCertificates from './pages/StudentCertificates';
import CertificateSettings from './pages/CertificateSettings';
import Batches from './pages/Batches';
import ManageCourses from './pages/ManageCourses';
import ManageClasses from './pages/ManageClasses';
import ManageAssignments from './pages/ManageAssignments';
import ManageQuizzes from './pages/ManageQuizzes';
import PuzzleGenerator from './pages/PuzzleGenerator';
import PuzzleSolvingReport from './pages/PuzzleSolvingReport';
import PuzzleListing from './pages/PuzzleListing';
import StudentDashboard from './pages/StudentDashboard';
import StudentReport from './pages/StudentReport';
import StudentPerformances from './pages/StudentPerformances';
import MyCertificates from './pages/MyCertificates';
import ManagePerformances from './pages/ManagePerformances';
import LiveMeetings from './pages/LiveMeetings';
import ChessProfile from './pages/ChessProfile';
import Puzzles from './pages/Puzzles';
import StudentHomework from './pages/StudentHomework';
import AdminHomework from './pages/AdminHomework';
import AnalysisBoard from './pages/AnalysisBoard';
import Assignments from './pages/Assignments';
import Profile from './pages/Profile';
import AdminProfile from './pages/AdminProfile';
import Leaderboard from './pages/Leaderboard';
import Tournaments from './pages/Tournaments';
import TournamentDetail from './pages/TournamentDetail';
import TournamentGame from './pages/TournamentGame';
import TournamentReadyListener from './components/TournamentReadyListener';
import Ratings from './pages/Ratings';
import TakeQuiz from './pages/TakeQuiz';
import GameReview from './pages/GameReview';
import MoveEffectDebug from './pages/MoveEffectDebug';
import Announcements from './pages/Announcements';
import Attendance from './pages/Attendance';
import Settings from './pages/Settings';
import LiveClassroom from './pages/LiveClassroom';
import MessagesPage from './pages/MessagesPage';
import ChatRequestsPage from './pages/ChatRequestsPage';
import Notifications from './pages/Notifications';

/* The shells and the pages below were referenced by the route table but never
   imported, so every one of them was a bare global reference: Rollup warns and
   keeps going, and the first render of App throws "Home is not defined". */
import AdminAppShell from './components/AdminAppShell';
import StudentAppShell from './components/StudentAppShell';
import Button from './components/Button';
import { Spinner } from './components/ui';
import Home from './pages/Home';
import Login from './pages/Login';
import ResetPassword from './pages/ResetPassword';
import DailyGame from './pages/DailyGame';
import GmPlayers from './pages/GmPlayers';
import GmPlayerProfile from './pages/GmPlayerProfile';
import BotsPage from './pages/BotsPage';
import BotGamePage from './pages/BotGamePage';
import OpeningsLibrary from './pages/OpeningsLibrary';
import OpeningDetail from './pages/OpeningDetail';
import OpeningPractice from './pages/OpeningPractice';
import StudentTournaments from './pages/StudentTournaments';
import ManageTournaments from './pages/ManageTournaments';
import BoardVision from './pages/BoardVision';
import AccessDenied from './pages/AccessDenied';
import TacticsPage from './features/tactics/pages/TacticsList';
import TacticPage from './features/tactics/pages/TacticDetail';

/* The two portal shells, plus the two shared sections that have to render INSIDE
   the caller's shell: the Openings Library and a single bot match are reachable
   from both sidebars, so wrapping them keeps the header and sidebar on screen
   instead of replacing the whole page. */
function AdminLayout({ children }) {
  return <AdminAppShell>{children}</AdminAppShell>;
}

function StudentLayout({ children }) {
  return <StudentAppShell>{children}</StudentAppShell>;
}

function OpeningsLayout({ children }) {
  const { user, loading } = useAuth();
  /* Don't guess while auth is resolving — rendering the public page and then
     swapping in a shell a frame later would flash the wrong header. */
  if (loading) return <Spinner />;
  if (!user) return children;
  return isAdminRole(user.role)
    ? <AdminAppShell>{children}</AdminAppShell>
    : <StudentAppShell>{children}</StudentAppShell>;
}

function PlayLayout({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return children;
  return isAdminRole(user.role)
    ? <AdminAppShell>{children}</AdminAppShell>
    : <StudentAppShell>{children}</StudentAppShell>;
}

function LandingHeader() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onResize = () => setMobileOpen(false);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const dashLink = homeForRole(user?.role);
  const dashLabel = user?.role === 'superadmin' ? 'Super Admin' : isAdminRole(user?.role) ? 'Coach Panel' : 'Dashboard';

  return (
    <header
      id="landing-header"
      className="nav-glass sticky top-0 z-40 shrink-0 border-b border-ivory-700/50 bg-ink-800/80 backdrop-blur-sm"
    >
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-2 px-2 sm:px-3 py-3 shrink-0">
        <div className="flex items-center gap-2 min-w-0 shrink-0">
          <span className="inline-flex shrink-0">
            <Logo
              alt="Mate Zone Chess Academy"
              height={44}
              className="shrink-0"
            />
          </span>
          <nav className="md:hidden">
            <button
              className="md:hidden text-slate-200 hover:text-white text-[26px] leading-none w-[44px] h-[44px] shrink-0 grid place-items-center rounded-lg hover:bg-white/10 transition"
              onClick={() => setMobileOpen((o) => !o)}
              aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={mobileOpen}
              aria-controls="landing-nav"
            >
              {mobileOpen ? '✕' : '☰'}
            </button>
          </nav>
          <Link
            to={user ? dashLink : '/'}
            onClick={() => setMobileOpen(false)}
            className="flex items-center gap-2 sm:gap-2.5 min-w-0"
          >
            <span className="text-2xl piece-glyph-spin text-blue-300" aria-hidden="true">♞</span>
            <span className="font-bold text-sm sm:text-base md:text-lg font-display text-white truncate">
              <span className="sm:hidden">{APP_NAME_SHORT}</span>
              <span className="hidden sm:inline">
                <span className="chess-gradient-text">Chess Academy</span>
              </span>
            </span>
          </Link>
        </div>

        <div className="flex items-center gap-3">
          {user ? (
            <>
              <nav className="hidden md:flex items-center gap-1">
                {['/contact'].map((l) => (
                  <Link
                    key={l}
                    to={l}
                    className="px-3 py-2 rounded-lg text-sm font-medium text-slate-200 hover:text-white hover:bg-white/10 transition"
                  >
                    {l}
                  </Link>
                ))}
              </nav>
              <span className="hidden lg:block text-sm text-slate-300">
                {user.role === 'superadmin'
                  ? 'Academy owner'
                  : user.role === 'admin'
                  ? 'Coach'
                  : 'Student'}
              </span>
            </>
          ) : (
            <>
              <Link
                to="/login"
                className="hidden sm:inline text-sm text-slate-200 hover:text-white font-medium transition"
              >
                Login
              </Link>
              <Button to="/login" variant="primary" size="md" className="!px-4 !py-2 text-sm">
                Login
              </Button>
            </>
          )}
        </div>
      </div>

      <div
        id="landing-nav"
        aria-hidden={!mobileOpen}
        className={`absolute left-0 right-0 top-full md:hidden overflow-hidden transition-all duration-300 ease-in-out ${mobileOpen ? 'max-h-[70vh] opacity-100 visible' : 'max-h-0 opacity-0 invisible'}`}
      >
        <nav className="bg-white/95 backdrop-blur-xl border-t border-ink-700/10 px-4 py-3 flex flex-col gap-1 shadow-[0_20px_44px_-10px_rgba(0,0,0,0.35)] max-h-[70vh] overflow-y-auto">
          {['/contact'].map((l) => (
            <Link
              key={l}
              to={l}
              className="px-3 py-3 rounded-lg text-[0.95rem] font-medium text-slate-700 hover:text-gold-600 hover:bg-gold-500/10 transition"
              onClick={() => setMobileOpen(false)}
            >
              {l}
            </Link>
          ))}
          <Link
            to={user ? dashLink : '/login'}
            onClick={() => {
              setMobileOpen(false);
              if (user) navigate(dashLink);
            }}
            className="px-3 py-3 mt-1 pt-3 border-t border-ink-700/10 rounded-lg text-[0.95rem] font-semibold text-gold-600 hover:bg-gold-500/10 transition"
          >
            {user ? dashLabel : 'Login'}
          </Link>
        </nav>
      </div>
    </header>
  );
}


export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const lastKeyRef = useRef(null);
  const { user } = useAuth();

  /* Which chrome belongs to the current route. Decided by PATH, not by identity:
     a signed-in student reading /about still needs the public navbar, while
     /admin, /student and the Openings module carry their own shell.
     These four were referenced below but never declared, so App threw before it
     could render a single route. */
  const pathname = location.pathname;
  const isAdmin = pathname.startsWith('/admin') || pathname.startsWith('/super');
  const isStudent = pathname.startsWith('/student');
  const isOpeningsModule = pathname === '/openings' || pathname.startsWith('/openings/');
  /* A single bot match is a full-screen surface that renders inside the caller's
     shell, so the standalone navbar stands down for it too — otherwise the
     in-flow sticky header pushes the 100vh board past the viewport. */
  const isFullScreenGame = pathname.startsWith('/play/bot/');
  const hideStandaloneNavbar = isAdmin || isStudent || isOpeningsModule || isFullScreenGame;
  /* The shells render their own Back row inside their own container. The
     Openings module is a shell only for a signed-in user. */
  const usesShell = isAdmin || pathname.startsWith('/student/') || (isOpeningsModule && Boolean(user));

  // Count our own PUSH navigations so the global Back button knows whether it
  // can go back within the app. StrictMode-safe: only counts a key UPDATE.
  useEffect(() => {
    const prev = lastKeyRef.current;
    lastKeyRef.current = location.key;
    if (prev == null || prev === location.key) return;
    // Simple navigation tracking
    if (location.key !== prev) {
      const trackedNavKey = location.key;
    }
  }, [location.key]);

  // Scroll to the top of the page whenever the route changes.
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0 });
  }, [pathname]);

  return (
    <div>
      <div className="min-h-screen flex flex-col">
        <ChessBackground />
        <MatchDeclineListener />
        <ChatReactionListener />
        <ChatMessageToastListener />
        <TournamentReadyListener />
        <LevelUpCelebration />
        <MeetingReviewPopup />
        {location.pathname === '/' ? (
          <LandingHeader />
        ) : location.pathname === '/login' || location.pathname === '/register' ? null : (
          hideStandaloneNavbar ? null : (
            <Navbar />
          )
        )}
        {!usesShell && (
          <BackButton className="max-w-[90rem] mx-auto px-3 sm:px-4" />
        )}
        <div className="flex-1" key={location.pathname} style={{ animation: 'fade-in .5s ease both' }}>
          <Routes location={location}>
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Navigate to="/login" replace />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/about" element={<About />} />
            <Route path="/contact" element={<Contact />} />
            <Route path="/courses" element={<Courses />} />
            <Route path="/courses/:id" element={<CourseDetails />} />
            <Route path="/about" element={<About />} /> 
            <Route path="/leaderboard" element={<Leaderboard />} />
            <Route path="/announcements" element={<Announcements />} />
            <Route path="/daily" element={<DailyGame />} />
            <Route path="/players" element={<GmPlayers />} />
            <Route path="/players/:id" element={<GmPlayerProfile />} />
            <Route path="/play/bots" element={<BotsPage />} />
            <Route path="/dev/move-effect" element={<MoveEffectDebug />} />
            <Route path="/play/bot/:botId" element={<PlayLayout><BotGamePage /></PlayLayout>} />
            <Route path="/openings" element={<OpeningsLayout><OpeningsLibrary /></OpeningsLayout>} />
            <Route path="/openings/:slug/practice" element={<OpeningsLayout><OpeningPractice /></OpeningsLayout>} />
            <Route path="/openings/:slug" element={<OpeningsLayout><OpeningDetail /></OpeningsLayout>} />
            {/* Student */}
            <Route path="/student/dashboard" element={<ProtectedRoute role="student"><StudentLayout><StudentDashboard /></StudentLayout></ProtectedRoute>} />
            <Route path="/student/live-meetings" element={<ProtectedRoute role="student"><FeatureRoute feature="live_game"><StudentLayout><LiveMeetings /></StudentLayout></FeatureRoute></ProtectedRoute>} />
            <Route path="/student/attendance" element={<ProtectedRoute role="student"><StudentLayout><Attendance /></StudentLayout></ProtectedRoute>} />
            <Route path="/student/puzzles" element={<ProtectedRoute role="student"><FeatureRoute feature="puzzle_trainer"><StudentLayout><Puzzles /></StudentLayout></FeatureRoute></ProtectedRoute>} />
            <Route path="/student/homework" element={<ProtectedRoute role="student"><FeatureRoute feature="puzzle_trainer"><StudentLayout><StudentHomework /></StudentLayout></FeatureRoute></ProtectedRoute>} />
            <Route path="/student/homework/:assignmentId" element={<ProtectedRoute role="student"><FeatureRoute feature="puzzle_trainer"><StudentLayout><Puzzles /></StudentLayout></FeatureRoute></ProtectedRoute>} />
            <Route path="/student/analysis" element={<ProtectedRoute role="student"><StudentLayout><AnalysisBoard /></StudentLayout></ProtectedRoute>} />
            <Route path="/student/assignments" element={<ProtectedRoute role="student"><FeatureRoute feature="assignments"><StudentLayout><Assignments /></StudentLayout></FeatureRoute></ProtectedRoute>} />
            <Route path="/student/people" element={<ProtectedRoute role="student"><Navigate to="/student/messages?tab=people" replace /></ProtectedRoute>} />
            <Route path="/student/messages" element={<ProtectedRoute role="student"><FeatureRoute feature="messaging_coach"><StudentLayout><MessagesPage /></StudentLayout></FeatureRoute></ProtectedRoute>} />
            <Route path="/student/notifications" element={<ProtectedRoute role="student"><StudentLayout><Notifications /></StudentLayout></ProtectedRoute>} />
            <Route path="/student/leaderboard" element={<ProtectedRoute role="student"><FeatureRoute feature="leaderboard"><StudentLayout><Leaderboard /></StudentLayout></FeatureRoute></ProtectedRoute>} />
            <Route path="/student/tournaments" element={<ProtectedRoute role="student"><StudentLayout><StudentTournaments /></StudentLayout></ProtectedRoute>} />
            <Route path="/student/tournaments/game/:gameId" element={<ProtectedRoute role="student"><StudentLayout><TournamentGame /></StudentLayout></ProtectedRoute>} />
            <Route path="/student/ratings" element={<ProtectedRoute role="student"><FeatureRoute feature="leaderboard"><StudentLayout><Ratings /></StudentLayout></FeatureRoute></ProtectedRoute>} />
            <Route path="/student/profile" element={<ProtectedRoute role="student"><StudentLayout><Profile /></StudentLayout></ProtectedRoute>} />
            <Route path="/student/chess-profile" element={<ProtectedRoute role="student"><StudentLayout><ChessProfile /></StudentLayout></ProtectedRoute>} />
            <Route path="/student/game-analysis" element={<ProtectedRoute role="student"><FeatureRoute feature="game_analysis"><StudentLayout><GameReview /></StudentLayout></FeatureRoute></ProtectedRoute>} />
            {/* Admin / Coach */}
            <Route path="/admin/dashboard" element={<ProtectedRoute role="admin"><AdminLayout><AdminDashboard /></AdminLayout></ProtectedRoute>} />
            <Route path="/admin/command-center" element={<ProtectedRoute role="admin"><AdminLayout><CommandCenter /></AdminLayout></ProtectedRoute>} />
            <Route path="/admin/reports" element={<ProtectedRoute role="admin"><AdminLayout><AdminReports /></AdminLayout></ProtectedRoute>} />
            <Route path="/admin/students" element={<ProtectedRoute role="admin"><FeatureRoute feature="student_roster"><AdminLayout><Students /></AdminLayout></FeatureRoute></ProtectedRoute>} />
            <Route path="/admin/admins" element={<ProtectedRoute role="superadmin"><AdminLayout><Admins /></AdminLayout></ProtectedRoute>} />
            <Route path="/admin/admins/:id/report" element={<ProtectedRoute role="superadmin"><AdminLayout><AdminReport /></AdminLayout></ProtectedRoute>} />
            <Route path="/admin/courses" element={<ProtectedRoute role="admin"><AdminLayout><ManageCourses /></AdminLayout></ProtectedRoute>} />
            <Route path="/admin/courses/create-puzzles" element={<ProtectedRoute role="admin"><AdminLayout><PuzzleGenerator /></AdminLayout></ProtectedRoute>} />
            <Route path="/admin/performances" element={<ProtectedRoute role="admin"><AdminLayout><ManagePerformances /></AdminLayout></ProtectedRoute>} />
            <Route path="/admin/classes" element={<ProtectedRoute role="admin"><AdminLayout><ManageClasses /></AdminLayout></ProtectedRoute>} />
            <Route path="/admin/batches" element={<ProtectedRoute role="admin"><AdminLayout><Batches /></AdminLayout></ProtectedRoute>} />
            <Route path="/admin/attendance" element={<ProtectedRoute role="admin"><AdminLayout><Attendance /></AdminLayout></ProtectedRoute>} />
            <Route path="/admin/assignments" element={<ProtectedRoute role="admin"><FeatureRoute feature="assign_lessons"><AdminLayout><ManageAssignments /></AdminLayout></FeatureRoute></ProtectedRoute>} />
            <Route path="/admin/worklist" element={<ProtectedRoute role="admin"><Navigate to="/admin/homework" replace /></ProtectedRoute>} />
            <Route path="/admin/game-history" element={<ProtectedRoute role="admin"><Navigate to="/admin/review?tab=history" replace /></ProtectedRoute>} />
            <Route path="/admin/leaderboard" element={<ProtectedRoute role="admin"><AdminLayout><Leaderboard /></AdminLayout></ProtectedRoute>} />
            <Route path="/admin/tournaments" element={<ProtectedRoute role="admin"><AdminLayout><ManageTournaments /></AdminLayout></ProtectedRoute>} />
            <Route path="/admin/tournaments/game/:gameId" element={<ProtectedRoute role="admin"><AdminLayout><TournamentGame /></AdminLayout></ProtectedRoute>} />
            <Route path="/admin/puzzle-listing" element={<ProtectedRoute role="admin"><FeatureRoute feature="puzzle_authoring"><AdminLayout><PuzzleListing /></AdminLayout></FeatureRoute></ProtectedRoute>} />
            <Route path="/admin/homework" element={<ProtectedRoute role="admin"><AdminLayout><AdminHomework /></AdminLayout></ProtectedRoute>} />
            <Route path="/admin/notifications" element={<ProtectedRoute role="admin"><AdminLayout><Notifications /></AdminLayout></ProtectedRoute>} />
            <Route path="/admin/puzzle-assignments" element={<ProtectedRoute role="admin"><AdminLayout><PuzzleSolvingReport /></AdminLayout></ProtectedRoute>} />
            <Route path="/admin/quizzes" element={<ProtectedRoute role="admin"><AdminLayout><ManageQuizzes /></AdminLayout></ProtectedRoute>} />
            <Route path="/admin/game-analysis" element={<ProtectedRoute role="admin"><AdminLayout><GameAnalysis /></AdminLayout></ProtectedRoute>} />
            <Route path="/admin/analysis" element={<ProtectedRoute role="admin"><AdminLayout><AnalysisBoard /></AdminLayout></ProtectedRoute>} />
            <Route path="/admin/profile" element={<ProtectedRoute role="admin"><AdminLayout><AdminProfile /></AdminLayout></ProtectedRoute>} />
            {/* Super Admin */}
            <Route path="/super" element={<ProtectedRoute role="superadmin"><AdminLayout><SuperAdmin /></AdminLayout></ProtectedRoute>} />
            <Route path="/super/features" element={<ProtectedRoute role="superadmin"><Navigate to="/super" replace /></ProtectedRoute>} />
            <Route path="/super/sidebar-order" element={<ProtectedRoute role="superadmin"><Navigate to="/super?section=sidebar" replace /></ProtectedRoute>} />
            <Route path="/super/certificates" element={<ProtectedRoute role="superadmin"><AdminLayout><Certificates /></AdminLayout></ProtectedRoute>} />
            <Route path="/super/certificates/:studentId" element={<ProtectedRoute role="superadmin"><AdminLayout><StudentCertificates /></AdminLayout></ProtectedRoute>} />
            <Route path="/super/certificate-settings" element={<ProtectedRoute role="superadmin"><AdminLayout><CertificateSettings /></AdminLayout></ProtectedRoute>} />
            {/* Tatics */}
            <Route path="/tactics" element={<TacticsPage />} />
            <Route path="/tactics/:slug" element={<TacticPage />} />
            <Route path="/student/tactics" element={<ProtectedRoute role="student"><FeatureRoute feature="chess_tactics"><StudentLayout><TacticsPage /></StudentLayout></FeatureRoute></ProtectedRoute>} />
            <Route path="/student/tactics/:slug" element={<ProtectedRoute role="student"><FeatureRoute feature="chess_tactics"><StudentLayout><TacticPage /></StudentLayout></FeatureRoute></ProtectedRoute>} />
            {/* Board Vision */}
            <Route path="/student/board-vision" element={<ProtectedRoute role="student"><StudentLayout><BoardVision /></StudentLayout></ProtectedRoute>} />
            <Route path="/admin/tactics" element={<ProtectedRoute role="admin"><FeatureRoute feature="chess_tactics"><AdminLayout><TacticPage /></AdminLayout></FeatureRoute></ProtectedRoute>} />
            <Route path="/admin/tactics/:slug" element={<ProtectedRoute role="admin"><FeatureRoute feature="chess_tactics"><AdminLayout><TacticPage /></AdminLayout></FeatureRoute></ProtectedRoute>} />
            {/* 403 page */}
            <Route path="/access-denied" element={<AccessDenied />} />
            {/* Catch-all 404 — must be LAST */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}