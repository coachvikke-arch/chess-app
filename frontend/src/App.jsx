import { Suspense, useEffect, useState } from 'react';
import { Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import Navbar from './components/Navbar';
import Logo from './components/Logo';
import SplashScreen from './components/SplashScreen';
/* These four are default exports; importing them by name made Rollup fail the
   whole bundle with "is not exported by ...". */
import ChessBackground from './components/ChessBackground';
import MatchDeclineListener from './components/MatchDeclineListener';
import MatchAcceptNavigator from './components/MatchAcceptNavigator';
import ChatMessageToastListener from './components/ChatMessageToastListener';
import LevelUpCelebration from './components/LevelUpCelebration';
import MeetingReviewPopup from './components/MeetingReviewPopup';
import { useAuth } from './context/AuthContext';
import { homeForRole, isAdminRole } from './utils/roles';
import ProtectedRoute from './components/ProtectedRoute';
import { FeatureRoute } from './components/FeatureGate';
import GameAnalysis from './pages/GameAnalysis';
import BackButton from './components/BackButton';
import About from './pages/About';
import ChatReactionListener from './components/ChatReactionListener.jsx';
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
import StudentHomework from './pages/StudentHomework';
import AdminHomework from './pages/AdminHomework';
import Assignments from './pages/Assignments';
import Profile from './pages/Profile';
import AdminProfile from './pages/AdminProfile';
import Leaderboard from './pages/Leaderboard';
import TournamentDetail from './pages/TournamentDetail';
import TournamentGame from './pages/TournamentGame';
import TournamentReadyListener from './components/TournamentReadyListener';
import Ratings from './pages/Ratings';
import TakeQuiz from './pages/TakeQuiz';
import MoveEffectDebug from './pages/MoveEffectDebug';
import Announcements from './pages/Announcements';
import Attendance from './pages/Attendance';
import Settings from './pages/Settings';
import ChatRequestsPage from './pages/ChatRequestsPage';
import Notifications from './pages/Notifications';

/* The shells and the pages below were referenced by the route table but never
   imported, so every one of them was a bare global reference: Rollup warns and
   keeps going, and the first render of App throws "Home is not defined". */
import AdminAppShell from './components/AdminAppShell';
import StudentAppShell from './components/StudentAppShell';
import { Spinner, RouteFallback } from './components/ui';
import Home from './pages/Home';
import Login from './pages/Login';
import ResetPassword from './pages/ResetPassword';
import DailyGame from './pages/DailyGame';
import GmPlayers from './pages/GmPlayers';
import GmPlayerProfile from './pages/GmPlayerProfile';
import StudentTournaments from './pages/StudentTournaments';
import ManageTournaments from './pages/ManageTournaments';
import BoardVision from './pages/BoardVision';
import AccessDenied from './pages/AccessDenied';
import TacticsPage from './features/tactics/pages/TacticsList';
import TacticPage from './features/tactics/pages/TacticDetail';
import ChangePassword from './pages/ChangePassword';
import AcademyHome from './pages/academy/AcademyHome';
import AcademyLevel from './pages/academy/AcademyLevel';
import AcademyLesson from './pages/academy/AcademyLesson';
import AcademyOpening from './pages/academy/AcademyOpening';
/* The twelve heavy sections — the review/analysis boards, the classroom, the
   bot and openings pages, puzzles, messages — come from the same module that
   the sidebar hover-preloader uses, so a click loads the exact chunk that was
   already warmed. Static imports here would pull all of them into the landing
   page bundle and make the first paint wait for them. */
import {
  GameReview,
  AnalysisBoard,
  OpeningsLibrary,
  OpeningDetail,
  OpeningPractice,
  AdminGmGames,
  BotsPage,
  BotGamePage,
  LiveClassroom,
  Puzzles,
  PuzzleTrainer,
  MessagesPage,
} from './utils/lazyPages';

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
      className="nav-glass sticky top-0 z-[var(--z-navbar)] shrink-0 border-b border-ivory-700/50 bg-ink-800/80 backdrop-blur-sm"
    >
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-2 px-2 sm:px-3 py-3 shrink-0">
        <div className="flex items-center gap-2 min-w-0 shrink-0">
          {/* Same order as every in-app header: menu button first, then the brand. */}
          {user && (
            <nav className="md:hidden">
              <button
                className="text-slate-200 hover:text-white text-[26px] leading-none w-[44px] h-[44px] shrink-0 grid place-items-center rounded-lg hover:bg-white/10 transition"
                onClick={() => setMobileOpen((o) => !o)}
                aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
                aria-expanded={mobileOpen}
                aria-controls="landing-nav"
              >
                {mobileOpen ? '✕' : '☰'}
              </button>
            </nav>
          )}
          <Logo height={44} className="shrink-0" />
        </div>

        <div className="flex items-center gap-3">
          {/* The standalone /contact page is gone — the form now lives in the
              `#contact` section at the foot of this same landing page, so this
              is a same-page scroll, not a route. `preventDefault` because the
              router would otherwise leave the hash in the URL without moving. */}
          <a
            href="#contact"
            onClick={(e) => {
              e.preventDefault();
              document.getElementById('contact')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
            className="px-3 py-2 rounded-lg text-sm font-medium text-slate-200 hover:text-white hover:bg-white/10 transition"
          >
            Contact
          </a>
          {user && (
            <span className="hidden lg:block text-sm text-slate-300">
              {user.role === 'superadmin'
                ? 'Academy owner'
                : user.role === 'admin'
                ? 'Coach'
                : 'Student'}
            </span>
          )}
        </div>
      </div>

      <div
        id="landing-nav"
        aria-hidden={!mobileOpen}
        className={`absolute left-0 right-0 top-full md:hidden overflow-hidden transition-all duration-300 ease-in-out ${mobileOpen ? 'max-h-[70vh] opacity-100 visible' : 'max-h-0 opacity-0 invisible'}`}
      >
        <nav className="bg-white/95 backdrop-blur-xl border-t border-ink-700/10 px-4 py-3 flex flex-col gap-1 shadow-[0_20px_44px_-10px_rgba(0,0,0,0.35)] max-h-[70vh] overflow-y-auto">
          <Link
            to={dashLink}
            onClick={() => setMobileOpen(false)}
            className="px-3 py-3 rounded-lg text-[0.95rem] font-semibold text-gold-600 hover:bg-gold-500/10 transition"
          >
            {dashLabel}
          </Link>
        </nav>
      </div>
    </header>
  );
}

/* Sign-in side road: these pages carry their own brand, so the standalone
   navbar stands down for them. */
const AUTH_ONLY_PAGES = new Set(['/login', '/register', '/reset-password']);

export default function App() {
  const location = useLocation();
  const { user } = useAuth();

  /* Choose the page chrome from the current path, not just the signed-in
     user's role. Public pages keep the public navbar; portal routes use their
     own shell. */
  const pathname = location.pathname;
  const isAdmin = pathname.startsWith('/admin') || pathname.startsWith('/super') || pathname.startsWith('/coach');
  const isStudent = pathname.startsWith('/student');
  const isLiveClass = pathname.startsWith('/live-class');
  const isOpeningsModule = pathname === '/openings' || pathname.startsWith('/openings/');
  /* A single bot match is a full-screen surface that renders inside the caller's
     shell, so the standalone navbar stands down for it too — otherwise the
     in-flow sticky header pushes the 100vh board past the viewport. */
  const isFullScreenGame = pathname.startsWith('/play/bot/');
  const hideStandaloneNavbar = isAdmin || isStudent || isOpeningsModule || isFullScreenGame || isLiveClass;
  /* Portal shells provide their own navigation row. Public Openings pages
     and unauthenticated bot matches keep the standalone navigation. */
  const usesShell =
    !isLiveClass &&
    (isAdmin ||
      pathname.startsWith('/student/') ||
      (isOpeningsModule && Boolean(user)) ||
      (isFullScreenGame && Boolean(user)));

  // Scroll to the top of the page whenever the route changes.
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0 });
  }, [pathname]);

  return (
    <div>
      {/* First-load splash. It sits outside the location-keyed subtree below, so
          it plays once per app load and a route change cannot restart it, while
          the landing page mounts and lays out underneath it. */}
      <SplashScreen />
      <div className="min-h-screen flex flex-col">
        <ChessBackground />
        <MatchDeclineListener />
        <MatchAcceptNavigator />
        <ChatReactionListener />
        <ChatMessageToastListener />
        <TournamentReadyListener />
        <LevelUpCelebration />
        <MeetingReviewPopup />
        {location.pathname === '/' ? (
          <LandingHeader />
        ) : AUTH_ONLY_PAGES.has(location.pathname) ? null : (
          hideStandaloneNavbar ? null : (
            <Navbar />
          )
        )}
        {!usesShell && (
          <BackButton className="max-w-[90rem] mx-auto px-3 sm:px-4" />
        )}
        <div className="flex-1" key={location.pathname} style={{ animation: 'fade-in .5s ease both' }}>
          <Suspense fallback={<RouteFallback />}>
          <Routes location={location}>
            {/* Live classroom — full-screen, no portal shell */}
            <Route path="/live-class/:id" element={<ProtectedRoute><LiveClassroom /></ProtectedRoute>} />
            <Route path="/classroom/board-vision" element={<ProtectedRoute><BoardVision /></ProtectedRoute>} />
            {/* Standalone student report — opened in a new tab from the admin roster */}
            <Route path="/students/:studentId/report" element={<ProtectedRoute role="admin"><StudentReport /></ProtectedRoute>} />
            <Route path="/change-password" element={<ProtectedRoute><ChangePassword /></ProtectedRoute>} />
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Navigate to="/login" replace />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/about" element={<About />} />
            {/* The /contact page is removed; the form is the `#contact` section
                on the landing page. Old links and bookmarks still land home. */}
            <Route path="/contact" element={<Navigate to="/#contact" replace />} />
            <Route path="/courses" element={<Courses />} />
            <Route path="/courses/:id" element={<CourseDetails />} />
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
            <Route path="/student/trainer" element={<ProtectedRoute role="student"><FeatureRoute feature="puzzle_trainer"><StudentLayout><PuzzleTrainer /></StudentLayout></FeatureRoute></ProtectedRoute>} />
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
            <Route path="/student/tournaments/:id" element={<ProtectedRoute role="student"><StudentLayout><TournamentDetail /></StudentLayout></ProtectedRoute>} />
            <Route path="/student/ratings" element={<ProtectedRoute role="student"><FeatureRoute feature="leaderboard"><StudentLayout><Ratings /></StudentLayout></FeatureRoute></ProtectedRoute>} />
            <Route path="/student/profile" element={<ProtectedRoute role="student"><StudentLayout><Profile /></StudentLayout></ProtectedRoute>} />
            <Route path="/student/chess-profile" element={<ProtectedRoute role="student"><StudentLayout><ChessProfile /></StudentLayout></ProtectedRoute>} />
            <Route path="/student/report" element={<ProtectedRoute role="student"><StudentLayout><StudentReport studentMode studentId="me" /></StudentLayout></ProtectedRoute>} />
            <Route path="/student/performances" element={<ProtectedRoute role="student"><StudentLayout><StudentPerformances /></StudentLayout></ProtectedRoute>} />
            <Route path="/student/certificates" element={<ProtectedRoute role="student"><StudentLayout><MyCertificates /></StudentLayout></ProtectedRoute>} />
            <Route path="/student/game-analysis" element={<ProtectedRoute role="student"><StudentLayout><GameAnalysis /></StudentLayout></ProtectedRoute>} />
            <Route path="/student/review" element={<ProtectedRoute role="student"><FeatureRoute feature="game_analysis"><StudentLayout><GameReview /></StudentLayout></FeatureRoute></ProtectedRoute>} />
            <Route path="/student/game-history" element={<ProtectedRoute role="student"><Navigate to="/student/review?tab=history" replace /></ProtectedRoute>} />
            <Route path="/student/gm-games" element={<ProtectedRoute role="student"><FeatureRoute feature="gm_games"><StudentLayout><AdminGmGames readOnly /></StudentLayout></FeatureRoute></ProtectedRoute>} />
            <Route path="/student/settings" element={<ProtectedRoute role="student"><FeatureRoute feature="profile_settings"><StudentLayout><Settings /></StudentLayout></FeatureRoute></ProtectedRoute>} />
            <Route path="/student/openings" element={<ProtectedRoute role="student"><FeatureRoute feature="piece_lessons"><StudentLayout><AcademyHome /></StudentLayout></FeatureRoute></ProtectedRoute>} />
            <Route path="/student/openings/level/:levelSlug" element={<ProtectedRoute role="student"><StudentLayout><AcademyLevel /></StudentLayout></ProtectedRoute>} />
            <Route path="/student/openings/lessons/:levelSlug/:lessonSlug" element={<ProtectedRoute role="student"><StudentLayout><AcademyLesson /></StudentLayout></ProtectedRoute>} />
            <Route path="/student/openings/course/:openingSlug" element={<ProtectedRoute role="student"><StudentLayout><AcademyOpening /></StudentLayout></ProtectedRoute>} />
            <Route path="/quizzes/:id" element={<ProtectedRoute role="student"><StudentLayout><TakeQuiz /></StudentLayout></ProtectedRoute>} />
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
            <Route path="/admin/tournaments/:id" element={<ProtectedRoute role="admin"><AdminLayout><TournamentDetail /></AdminLayout></ProtectedRoute>} />
            <Route path="/admin/puzzle-listing" element={<ProtectedRoute role="admin"><FeatureRoute feature="puzzle_authoring"><AdminLayout><PuzzleListing /></AdminLayout></FeatureRoute></ProtectedRoute>} />
            <Route path="/admin/homework" element={<ProtectedRoute role="admin"><AdminLayout><AdminHomework /></AdminLayout></ProtectedRoute>} />
            <Route path="/admin/messages" element={<ProtectedRoute role="admin"><AdminLayout><MessagesPage /></AdminLayout></ProtectedRoute>} />
            <Route path="/admin/notifications" element={<ProtectedRoute role="admin"><AdminLayout><Notifications /></AdminLayout></ProtectedRoute>} />
            <Route path="/admin/announcements" element={<ProtectedRoute role="admin"><AdminLayout><Announcements /></AdminLayout></ProtectedRoute>} />
            <Route path="/admin/puzzle-assignments" element={<ProtectedRoute role="admin"><AdminLayout><PuzzleSolvingReport /></AdminLayout></ProtectedRoute>} />
            <Route path="/admin/quizzes" element={<ProtectedRoute role="admin"><AdminLayout><ManageQuizzes /></AdminLayout></ProtectedRoute>} />
            <Route path="/admin/game-analysis" element={<ProtectedRoute role="admin"><AdminLayout><GameAnalysis /></AdminLayout></ProtectedRoute>} />
            <Route path="/admin/review" element={<ProtectedRoute role="admin"><FeatureRoute feature="live_review"><AdminLayout><GameReview /></AdminLayout></FeatureRoute></ProtectedRoute>} />
            <Route path="/admin/analysis" element={<ProtectedRoute role="admin"><AdminLayout><AnalysisBoard /></AdminLayout></ProtectedRoute>} />
            <Route path="/admin/openings" element={<ProtectedRoute role="admin"><AdminLayout><AcademyHome /></AdminLayout></ProtectedRoute>} />
            <Route path="/admin/openings/level/:levelSlug" element={<ProtectedRoute role="admin"><AdminLayout><AcademyLevel /></AdminLayout></ProtectedRoute>} />
            <Route path="/admin/openings/lessons/:levelSlug/:lessonSlug" element={<ProtectedRoute role="admin"><AdminLayout><AcademyLesson /></AdminLayout></ProtectedRoute>} />
            <Route path="/admin/openings/course/:openingSlug" element={<ProtectedRoute role="admin"><AdminLayout><AcademyOpening /></AdminLayout></ProtectedRoute>} />
            <Route path="/admin/gm-games" element={<ProtectedRoute role="admin"><AdminLayout><AdminGmGames /></AdminLayout></ProtectedRoute>} />
            <Route path="/admin/chess-profile" element={<ProtectedRoute role="admin"><AdminLayout><ChessProfile /></AdminLayout></ProtectedRoute>} />
            <Route path="/admin/chat-requests" element={<ProtectedRoute role="admin"><AdminLayout><ChatRequestsPage /></AdminLayout></ProtectedRoute>} />
            <Route path="/admin/admins/:id/performance" element={<ProtectedRoute role="superadmin"><AdminLayout><CoachReport /></AdminLayout></ProtectedRoute>} />
            <Route path="/admin/settings" element={<ProtectedRoute role="admin"><AdminLayout><Settings /></AdminLayout></ProtectedRoute>} />
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
            <Route path="/admin/tactics" element={<ProtectedRoute role="admin"><FeatureRoute feature="chess_tactics"><AdminLayout><TacticsPage /></AdminLayout></FeatureRoute></ProtectedRoute>} />
            <Route path="/admin/tactics/:slug" element={<ProtectedRoute role="admin"><FeatureRoute feature="chess_tactics"><AdminLayout><TacticPage /></AdminLayout></FeatureRoute></ProtectedRoute>} />
            {/* 403 page */}
            <Route path="/access-denied" element={<AccessDenied />} />
            {/* Catch-all 404 — must be LAST */}
            <Route path="*" element={<NotFound />} />
          </Routes>
          </Suspense>
        </div>
      </div>
    </div>
  );
}
