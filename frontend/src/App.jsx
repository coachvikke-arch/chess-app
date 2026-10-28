import { useRef, useEffect, useState } from 'react';
import { Routes, Route, Navigate, Link, useLocation, useNavigationType, useNavigate } from 'react-router-dom';
import Navbar, { navLinks } from './components/Navbar';
import AdminAppShell from './components/AdminAppShell';
import StudentAppShell from './components/StudentAppShell';
import { useAuth } from './context/AuthContext';
import { homeForRole, isAdminRole } from './utils/roles';
import { APP_NAME, APP_NAME_SHORT, APP_TAGLINE } from './config/brand';
import ProtectedRoute from './components/ProtectedRoute';
/* Named export (not default), and it gates 17 routes below. It was missing
   entirely, which Rollup accepted as a global — the build stayed green and every
   one of those routes threw a ReferenceError on navigation. */
import { FeatureRoute } from './components/FeatureGate';
import ChessBackground from './components/ChessBackground';
import BackButton from './components/BackButton'; const track = () => {};
import LevelUpCelebration from './components/LevelUpCelebration';
import MeetingReviewPopup from './components/MeetingReviewPopup';
import MatchDeclineListener from './components/MatchDeclineListener';
import ChatReactionListener from './components/ChatReactionListener';
import ChatMessageToastListener from './components/ChatMessageToastListener';
import { ToastProvider } from './components/Toast';
import Home from './pages/Home';
import Login from './pages/Login';
import ResetPassword from './pages/ResetPassword';
import ChangePassword from './pages/ChangePassword';
import About from './pages/About';
import Contact from './pages/Contact';
import Courses from './pages/Courses';
import CourseDetails from './pages/CourseDetails';
import NotFound from './pages/NotFound';
import AccessDenied from './pages/AccessDenied';

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
import ManageTournaments from './pages/ManageTournaments';
import StudentTournaments from './pages/StudentTournaments';
import TournamentDetail from './pages/TournamentDetail';
import TournamentGame from './pages/TournamentGame';
import TournamentReadyListener from './components/TournamentReadyListener';
import Ratings from './pages/Ratings';
import TakeQuiz from './pages/TakeQuiz';
import GameAnalysis from './pages/GameAnalysis';
import GameReview from './pages/GameReview';
/* Dev-only playground for the "sigma move" overlay (no nav link). */
import MoveEffectDebug from './pages/MoveEffectDebug';
import Announcements from './pages/Announcements';
import Attendance from './pages/Attendance';
import Settings from './pages/Settings';
import LiveClassroom from './pages/LiveClassroom';
import MessagesPage from './pages/MessagesPage';
import ChatRequestsPage from './pages/ChatRequestsPage';

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
import PuzzleSolvingReport from './pages/PuzzleSolvingReport';
import ManageQuizzes from './pages/ManageQuizzes';
import PuzzleListing from './pages/PuzzleListing';

import Worklist from './pages/Worklist';
import AcademyHome from './pages/academy/AcademyHome';
import OpeningsLibrary from './pages/OpeningsLibrary';
import OpeningDetail from './pages/OpeningDetail';
import OpeningPractice from './pages/OpeningPractice';
import AcademyLevel from './pages/academy/AcademyLevel';
import AcademyLesson from './pages/academy/AcademyLesson';
import AcademyOpening from './pages/academy/AcademyOpening';
import AdminGmGames from './pages/AdminGmGames';
import DailyGame from './pages/DailyGame';
import GmPlayers from './pages/GmPlayers';
import GmPlayerProfile from './pages/GmPlayerProfile';
import BotsPage from './pages/BotsPage';
import BotGamePage from './pages/BotGamePage';
import BoardVision from './pages/BoardVision';
import TacticsPage from './features/tactics/pages/TacticsList';
import TacticPage from './features/tactics/pages/TacticDetail';
import { Spinner } from './components/ui';

function AdminLayout({ children }) {
  return <AdminAppShell>{children}</AdminAppShell>;
}

function StudentLayout({ children }) {
  return <StudentAppShell>{children}</StudentAppShell>;
}

/**
 * The Openings Library is reached from the sidebar of BOTH shells, so it has to
 * render INSIDE the caller's shell — the same way every other section does.
 * Before this it was a bare public route, so clicking "Openings Library" made
 * the shell (and every other section's nav button) disappear, which read as the
 * page having taken over the whole screen.
 *
 * The route stays public: a signed-out visitor still gets the plain page under
 * the top Navbar, because there is no shell for them to belong to.
 */
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

/**
 * A single bot match belongs to the signed-in user's own section: the shared
 * header (with its hamburger below 1024 px) and sidebar must stay reachable,
 * so the match renders inside the caller's shell instead of as a standalone
 * page. Signed-out visitors still get the plain full-screen board.
 */
function PlayLayout({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return children;
  return isAdminRole(user.role)
    ? <AdminAppShell>{children}</AdminAppShell>
    : <StudentAppShell>{children}</StudentAppShell>;
}

/* The homepage header carries the full site navigation — these links are shown
   here and nowhere else (the in-app Navbar deliberately omits them). */
const landingNavLinks = navLinks;

/* The landing wordmark keeps its two-tone treatment while still reading the
   name from the brand module: "MATE ZONE" white, "CHESS ACADEMY" gradient. */
const [BRAND_LEAD, ...BRAND_REST] = APP_NAME.split(' ');
const BRAND_REST_TEXT = BRAND_REST.join(' ');

/* Minimal sticky header for the homepage: logo + tagline (desktop),
   plus a three-bar hamburger that opens the site menu on phones. */
function LandingHeader() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    const onResize = () => { if (window.innerWidth >= 768) setOpen(false); };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  /* Announce the mobile menu state so the floating Back button can hide. */
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('chess-mobile-menu', { detail: { open } }));
  }, [open]);

  const dashLink = homeForRole(user?.role);
  const dashLabel = user?.role === 'superadmin' ? 'Super Admin' : isAdminRole(user?.role) ? 'Coach Panel' : 'Dashboard';

  return (
    <header className="nav-glass sticky top-0 z-40 shrink-0">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-2 px-2 sm:px-3 py-3 shrink-0">
        <div className="flex items-center gap-2 min-w-0 shrink-0">
          <button
            className="md:hidden text-slate-200 text-xl w-10 h-10 shrink-0 grid place-items-center rounded-lg hover:bg-white/10 transition"
            onClick={() => setOpen((o) => !o)}
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            aria-controls="landing-nav"
          >
            {open ? '✕' : '☰'}
          </button>
<Link
              to={user ? dashLink : '/'}
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 sm:gap-2.5 min-w-0"
            >
              <span className="text-2xl piece-glyph-spin text-blue-300" aria-hidden="true">♞</span>
              <span className="font-bold text-sm sm:text-base md:text-lg font-display text-white truncate">
                <span className="sm:hidden">{APP_NAME_SHORT}</span>
                <span className="hidden sm:inline">
                  {BRAND_LEAD} <span className="chess-gradient-text">{BRAND_REST_TEXT}</span>
                </span>
              </span>
            </Link>
          </div>

        <div className="flex items-center gap-3">
          {/* Desktop nav — the homepage header is the one place the full site
              navigation lives: the four public links plus Dashboard when the
              visitor is signed in (admins use their own panel). */}
          <nav className="hidden md:flex items-center gap-1">
            {landingNavLinks.map((l) => (
              <Link
                key={l.to}
                to={l.to}
                className="px-3 py-2 rounded-lg text-sm font-medium text-slate-200 hover:text-white hover:bg-white/10 transition"
              >
                {l.label}
              </Link>
            ))}
            {user && user.role !== 'admin' && (
              <Link
                to={dashLink}
                className="px-3 py-2 rounded-lg text-sm font-medium text-slate-200 hover:text-white hover:bg-white/10 transition"
              >
                {dashLabel}
              </Link>
            )}
          </nav>
          <span className="hidden lg:block text-sm text-slate-300">{APP_TAGLINE}</span>
        </div>
      </div>

      <div
        id="landing-nav"
        aria-hidden={!open}
        className={`absolute left-0 right-0 top-full md:hidden overflow-hidden transition-all duration-300 ease-in-out ${
          open ? 'max-h-[70vh] opacity-100 visible' : 'max-h-0 opacity-0 invisible'
        }`}
      >
        <nav className="bg-white/95 backdrop-blur-xl border-t border-ink-700/10 px-4 py-3 flex flex-col gap-1 shadow-[0_20px_44px_-10px_rgba(0,0,0,0.35)] max-h-[70vh] overflow-y-auto">
          {landingNavLinks.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              className="px-3 py-3 rounded-lg text-[0.95rem] font-medium text-slate-700 hover:text-gold-600 hover:bg-gold-500/10 transition"
              onClick={() => setOpen(false)}
            >
              {l.label}
            </Link>
          ))}
          <Link
            to={user ? dashLink : '/login'}
            onClick={() => {
              setOpen(false);
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
  const navigationType = useNavigationType();
  const lastKeyRef = useRef(null);
  /* The identity decides whether the Openings module is rendered inside a shell
     (which brings its own Back row) or as a plain public page. */
  const { user } = useAuth();

  // Count our own PUSH navigations so the global Back button knows whether it
  // can go back within the app. StrictMode-safe: only counts a key UPDATE.
  useEffect(() => {
    const prev = lastKeyRef.current;
    lastKeyRef.current = location.key;
    if (prev == null || prev === location.key) return;
    if (navigationType === 'PUSH') track();
  }, [location.key, navigationType]);

  // Scroll to the top of the page whenever the route changes.
  const pathname = location.pathname;
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0 });
  }, [pathname]);

  /* `/coach/*` (the AI Coach Training Academy) was removed from the admin side,
     so its branch is gone from this list too — leaving it would keep the shell
     logic alive for a section that no longer has routes.

     `/admin/*` and `/super/*` render inside AdminAppShell. They have to be named
     here, or the standalone <Navbar /> renders on top of the shell's own header
     and the user sees the logo, bell and account twice. */
  const isAdmin =
    location.pathname.startsWith('/admin') ||
    location.pathname.startsWith('/super');
  const isLanding = location.pathname === '/';
  const isStudent = location.pathname.startsWith('/student') || location.pathname.startsWith('/live-class');
  const isBare = ['/', '/login'].includes(location.pathname);
  /* A single bot match (/play/bot/:botId) is a full-screen play surface, so it
     stands the public Navbar down.

     WHY: `isStudent` is true only for `/student*` and `/live-class*`, so this
     path matched neither it nor `isBare`/`isOpeningsModule`, and the navbar
     condition fell through to render <Navbar />. That header is `sticky` and
     IN FLOW, so the page became navbar + 100vh - and a screen whose whole point
     is that it does not scroll, scrolled. The board is fitted to 100vh by
     `useFittedSquare`, which is only correct if nothing else claims height.

     The catalogue `/play/bots` is deliberately NOT included: it is ordinary
     browsing and should keep its navbar. The trailing slash is what separates
     them - '/play/bots'.startsWith('/play/bot/') is false. */
  const isFullScreenGame = location.pathname.startsWith('/play/bot/');
  /* The Openings module renders inside the caller's shell (see OpeningsLayout),
     and that shell brings its own header + sidebar. Rendering <Navbar /> as well
     would stack two headers, so the standalone bar stands down for these paths —
     for signed-out visitors too, who get the shell-less page from the layout. */
  const isOpeningsModule =
    location.pathname === '/openings' || location.pathname.startsWith('/openings/');

  /* The app shells (admin/super, student) render their OWN Back row, inside
     their own container, so that it lines up with the sidebar. This copy is for
     the public pages, which have no shell and therefore no sidebar to line up
     with. `/students/:id/report` is a standalone report opened in a new tab —
     it is not a shell, so it keeps the public row. The Openings module is a
     shell for a signed-in user and a plain public page for a visitor, so it
     follows the identity. */
  const inStudentShell = location.pathname.startsWith('/student/');
  const usesShell = isAdmin || inStudentShell || (isOpeningsModule && Boolean(user));

  return (
    <ToastProvider>
    <div className="min-h-screen flex flex-col">
      <ChessBackground />
      <MatchDeclineListener />
      <ChatReactionListener />
      <ChatMessageToastListener />
      <TournamentReadyListener />
      <LevelUpCelebration />
      <MeetingReviewPopup />
      {isLanding ? (
        <LandingHeader />
      ) : isBare || isOpeningsModule || isFullScreenGame ? null : isAdmin || isStudent ? null : (
        <Navbar />
      )}
      {/* The Back row. On the app shells it is rendered BY the shell (inside the
          shell's own container, so it lines up with the sidebar's left edge);
          this copy is for the public pages, which have no shell. */}
      {!usesShell && (
        <BackButton className="max-w-[90rem] mx-auto px-3 sm:px-4" />
      )}
      <div className="flex-1" key={location.pathname} style={{ animation: 'fade-in .5s ease both' }}>
        <Routes location={location}>
          {/* Live classroom — full-screen, no portal shell */}
          <Route path="/live-class/:id" element={<ProtectedRoute><LiveClassroom /></ProtectedRoute>} />

          {/* Standalone student report — opened in a new tab from the admin roster */}
          <Route path="/students/:studentId/report" element={<ProtectedRoute role="admin"><StudentReport /></ProtectedRoute>} />

          {/* Public */}
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          {/* Self-registration is closed. Old /register bookmarks and any stale
              "Create your own account" links are sent to /login rather than a
              blank page, and the notice there explains how to get an account. */}
          <Route path="/register" element={<Navigate to="/login" replace />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          {/* The forced password change: a student who signed in with the
              password the academy issued lands here before anything else. */}
          <Route
            path="/change-password"
            element={(
              <ProtectedRoute>
                <ChangePassword />
              </ProtectedRoute>
            )}
          />
          <Route path="/about" element={<About />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/courses" element={<Courses />} />
          <Route path="/courses/:id" element={<CourseDetails />} />
          <Route path="/leaderboard" element={<Leaderboard />} />
          <Route path="/announcements" element={<Announcements />} />
          <Route path="/daily" element={<DailyGame />} />
          <Route path="/players" element={<GmPlayers />} />
          <Route path="/players/:id" element={<GmPlayerProfile />} />
          {/* There WAS a `/games/:gameId` route here pointing at <GmGamePage />.
              No such component was ever written and nothing in the app links to
              that URL, but because the identifier was never imported, Rollup
              treated it as a global: the production build passed and the app
              only crashed for anyone who actually reached the route. Removed, so
              it falls through to the catch-all not-found at the end of this
              block instead. AdminGmGames (`/admin/gm-games`, `/student/gm-games`)
              opens a game through its own in-page selection. */}
          <Route path="/play/bots" element={<BotsPage />} />
          {/* Dev-only: scrub/slow-mo the MoveEffect timeline. */}
          <Route path="/dev/move-effect" element={<MoveEffectDebug />} />
          <Route path="/play/bot/:botId" element={<PlayLayout><BotGamePage /></PlayLayout>} />

          {/* Openings learning module — study, then practise. Order matters:
              /openings/practice would otherwise be swallowed by :slug.
              All three sit inside OpeningsLayout, which mounts the signed-in
              user's own shell so the sidebar and the other sections stay
              reachable. /openings is still reachable signed-out (the landing
              header links here), so it is deliberately NOT feature-gated. */}
          <Route path="/openings" element={<OpeningsLayout><OpeningsLibrary /></OpeningsLayout>} />
          <Route path="/openings/:slug/practice" element={<OpeningsLayout><OpeningPractice /></OpeningsLayout>} />
          <Route path="/openings/:slug" element={<OpeningsLayout><OpeningDetail /></OpeningsLayout>} />

          {/* Student */}
          <Route path="/student/dashboard" element={<ProtectedRoute role="student"><StudentLayout><StudentDashboard /></StudentLayout></ProtectedRoute>} />
          <Route path="/student/live-meetings" element={<ProtectedRoute role="student"><FeatureRoute feature="live_game"><StudentLayout><LiveMeetings /></StudentLayout></FeatureRoute></ProtectedRoute>} />
          <Route path="/student/attendance" element={<ProtectedRoute role="student"><StudentLayout><Attendance /></StudentLayout></ProtectedRoute>} />
          <Route path="/student/puzzles" element={<ProtectedRoute role="student"><FeatureRoute feature="puzzle_trainer"><StudentLayout><Puzzles /></StudentLayout></FeatureRoute></ProtectedRoute>} />
          {/* Homework — the list is its own page; the detail route mounts the
              same solver component the Puzzles page uses, scoped by :assignmentId. */}
          <Route path="/student/homework" element={<ProtectedRoute role="student"><FeatureRoute feature="puzzle_trainer"><StudentLayout><StudentHomework /></StudentLayout></FeatureRoute></ProtectedRoute>} />
          <Route path="/student/homework/:assignmentId" element={<ProtectedRoute role="student"><FeatureRoute feature="puzzle_trainer"><StudentLayout><Puzzles /></StudentLayout></FeatureRoute></ProtectedRoute>} />
          <Route path="/student/analysis" element={<ProtectedRoute role="student"><StudentLayout><AnalysisBoard /></StudentLayout></ProtectedRoute>} />
          <Route path="/student/assignments" element={<ProtectedRoute role="student"><FeatureRoute feature="assignments"><StudentLayout><Assignments /></StudentLayout></FeatureRoute></ProtectedRoute>} />
          {/* Game History is no longer its own page — it is the History tab inside
          Game Review. Old links/bookmarks redirect to it with the tab preselected. */}
      <Route path="/student/game-history" element={<ProtectedRoute role="student"><Navigate to="/student/review?tab=history" replace /></ProtectedRoute>} />
<Route path="/student/leaderboard" element={<ProtectedRoute role="student"><FeatureRoute feature="leaderboard"><StudentLayout><Leaderboard /></StudentLayout></FeatureRoute></ProtectedRoute>} />
          <Route path="/student/tournaments" element={<ProtectedRoute role="student"><StudentLayout><StudentTournaments /></StudentLayout></ProtectedRoute>} />
          <Route path="/student/tournaments/game/:gameId" element={<ProtectedRoute role="student"><StudentLayout><TournamentGame /></StudentLayout></ProtectedRoute>} />
          <Route path="/student/tournaments/:id" element={<ProtectedRoute role="student"><StudentLayout><TournamentDetail /></StudentLayout></ProtectedRoute>} />
          {/* Ratings: the analytical view of the same rating data the leaderboard ranks. */}
          <Route path="/student/ratings" element={<ProtectedRoute role="student"><FeatureRoute feature="leaderboard"><StudentLayout><Ratings /></StudentLayout></FeatureRoute></ProtectedRoute>} />
          <Route path="/student/profile" element={<ProtectedRoute role="student"><StudentLayout><Profile /></StudentLayout></ProtectedRoute>} />
          <Route path="/student/chess-profile" element={<ProtectedRoute role="student"><StudentLayout><ChessProfile /></StudentLayout></ProtectedRoute>} />
          {/* My Report — the student sees ONLY their own report: no id anywhere
              in the URL, the id comes from the session ('me'). */}
          <Route path="/student/report" element={<ProtectedRoute role="student"><StudentLayout><StudentReport studentMode studentId="me" /></StudentLayout></ProtectedRoute>} />
            <Route path="/student/performances" element={<ProtectedRoute role="student"><StudentLayout><StudentPerformances /></StudentLayout></ProtectedRoute>} />
            <Route path="/student/certificates" element={<ProtectedRoute role="student"><StudentLayout><MyCertificates /></StudentLayout></ProtectedRoute>} />
          <Route path="/student/game-analysis" element={<ProtectedRoute role="student"><StudentLayout><GameAnalysis /></StudentLayout></ProtectedRoute>} />
          <Route path="/student/review" element={<ProtectedRoute role="student"><FeatureRoute feature="game_analysis"><StudentLayout><GameReview /></StudentLayout></FeatureRoute></ProtectedRoute>} />
          {/* Student GM Games: browse + study the same library the coach imports
              into, gated by the same `gm_games` switch. `readOnly` drops the
              import/undo/delete controls, which stay coach-only server-side. */}
          <Route path="/student/gm-games" element={<ProtectedRoute role="student"><FeatureRoute feature="gm_games"><StudentLayout><AdminGmGames readOnly /></StudentLayout></FeatureRoute></ProtectedRoute>} />
          <Route path="/student/settings" element={<ProtectedRoute role="student"><FeatureRoute feature="profile_settings"><StudentLayout><Settings /></StudentLayout></FeatureRoute></ProtectedRoute>} />
          
          
          
          <Route path="/student/openings" element={<ProtectedRoute role="student"><FeatureRoute feature="piece_lessons"><StudentLayout><AcademyHome /></StudentLayout></FeatureRoute></ProtectedRoute>} />
          <Route path="/student/openings/level/:levelSlug" element={<ProtectedRoute role="student"><StudentLayout><AcademyLevel /></StudentLayout></ProtectedRoute>} />
          <Route path="/student/openings/lessons/:levelSlug/:lessonSlug" element={<ProtectedRoute role="student"><StudentLayout><AcademyLesson /></StudentLayout></ProtectedRoute>} />
          <Route path="/student/openings/course/:openingSlug" element={<ProtectedRoute role="student"><StudentLayout><AcademyOpening /></StudentLayout></ProtectedRoute>} />
          <Route path="/quizzes/:id" element={<ProtectedRoute role="student"><StudentLayout><TakeQuiz /></StudentLayout></ProtectedRoute>} />
          <Route path="/student/people" element={<ProtectedRoute role="student"><Navigate to="/student/messages?tab=people" replace /></ProtectedRoute>} />
          <Route path="/student/messages" element={<ProtectedRoute role="student"><FeatureRoute feature="messaging_coach"><StudentLayout><MessagesPage /></StudentLayout></FeatureRoute></ProtectedRoute>} />

          {/* Admin / Coach */}
          <Route path="/admin/dashboard" element={<ProtectedRoute role="admin"><AdminLayout><AdminDashboard /></AdminLayout></ProtectedRoute>} />
          <Route path="/admin/command-center" element={<ProtectedRoute role="admin"><AdminLayout><CommandCenter /></AdminLayout></ProtectedRoute>} />
          {/* Assigned-students report table. No `student_roster` gate here:
              the roster is what a coach's Reports page is FOR, so it is open
              to any admin; the backend still scopes rows to their own students. */}
          <Route path="/admin/reports" element={<ProtectedRoute role="admin"><AdminLayout><AdminReports /></AdminLayout></ProtectedRoute>} />

          {/* Super Admin — account registration (students + coaches). Only the
              superadmin role may see this page. */}
          <Route path="/super" element={<ProtectedRoute role="superadmin"><AdminLayout><SuperAdmin /></AdminLayout></ProtectedRoute>} />
          {/* Feature Access now lives inside the Super Admin console; keep the old
          deep link working by sending it there. */}
      <Route path="/super/features" element={<ProtectedRoute role="superadmin"><Navigate to="/super" replace /></ProtectedRoute>} />
          {/* Same idea for the sidebar reorder panel, but carrying which section to
          open so the link lands on the panel instead of account registration. */}
      <Route path="/super/sidebar-order" element={<ProtectedRoute role="superadmin"><Navigate to="/super?section=sidebar" replace /></ProtectedRoute>} />

          {/* Certificates — Super Admin only. The API is gated server-side by
              roleMiddleware('superadmin'); the route guard keeps a coach from
              reaching a page whose every request would 403. */}
          <Route path="/super/certificates" element={<ProtectedRoute role="superadmin"><AdminLayout><Certificates /></AdminLayout></ProtectedRoute>} />
          <Route path="/super/certificates/:studentId" element={<ProtectedRoute role="superadmin"><AdminLayout><StudentCertificates /></AdminLayout></ProtectedRoute>} />
          <Route path="/super/certificate-settings" element={<ProtectedRoute role="superadmin"><AdminLayout><CertificateSettings /></AdminLayout></ProtectedRoute>} />

          <Route path="/admin/students" element={<ProtectedRoute role="admin"><FeatureRoute feature="student_roster"><AdminLayout><Students /></AdminLayout></FeatureRoute></ProtectedRoute>} />
          <Route path="/admin/admins" element={<ProtectedRoute role="superadmin"><AdminLayout><Admins /></AdminLayout></ProtectedRoute>} />
          <Route path="/admin/admins/:id/report" element={<ProtectedRoute role="superadmin"><AdminLayout><AdminReport /></AdminLayout></ProtectedRoute>} />
          <Route path="/admin/admins/:id/performance" element={<ProtectedRoute role="superadmin"><AdminLayout><CoachReport /></AdminLayout></ProtectedRoute>} />
          <Route path="/admin/courses" element={<ProtectedRoute role="admin"><AdminLayout><ManageCourses /></AdminLayout></ProtectedRoute>} />
          <Route path="/admin/performances" element={<ProtectedRoute role="admin"><AdminLayout><ManagePerformances /></AdminLayout></ProtectedRoute>} />
          <Route path="/admin/classes" element={<ProtectedRoute role="admin"><AdminLayout><ManageClasses /></AdminLayout></ProtectedRoute>} />
          <Route path="/admin/batches" element={<ProtectedRoute role="admin"><AdminLayout><Batches /></AdminLayout></ProtectedRoute>} />
          <Route path="/admin/attendance" element={<ProtectedRoute role="admin"><AdminLayout><Attendance /></AdminLayout></ProtectedRoute>} />
          <Route path="/admin/assignments" element={<ProtectedRoute role="admin"><FeatureRoute feature="assign_lessons"><AdminLayout><ManageAssignments /></AdminLayout></FeatureRoute></ProtectedRoute>} />
          <Route path="/admin/worklist" element={<ProtectedRoute role="admin"><AdminLayout><Worklist /></AdminLayout></ProtectedRoute>} />
          <Route path="/admin/game-history" element={<ProtectedRoute role="admin"><Navigate to="/admin/review?tab=history" replace /></ProtectedRoute>} />
          <Route path="/admin/leaderboard" element={<ProtectedRoute role="admin"><AdminLayout><Leaderboard /></AdminLayout></ProtectedRoute>} />
          <Route path="/admin/tournaments" element={<ProtectedRoute role="admin"><AdminLayout><ManageTournaments /></AdminLayout></ProtectedRoute>} />
          <Route path="/admin/tournaments/game/:gameId" element={<ProtectedRoute role="admin"><AdminLayout><TournamentGame /></AdminLayout></ProtectedRoute>} />
          <Route path="/admin/tournaments/:id" element={<ProtectedRoute role="admin"><AdminLayout><TournamentDetail /></AdminLayout></ProtectedRoute>} />

          <Route path="/admin/puzzle-listing" element={<ProtectedRoute role="admin"><FeatureRoute feature="puzzle_authoring"><AdminLayout><PuzzleListing /></AdminLayout></FeatureRoute></ProtectedRoute>} />
          <Route path="/admin/homework" element={<ProtectedRoute role="admin"><AdminLayout><AdminHomework /></AdminLayout></ProtectedRoute>} />
          <Route path="/admin/puzzle-assignments" element={<ProtectedRoute role="admin"><AdminLayout><PuzzleSolvingReport /></AdminLayout></ProtectedRoute>} />
          <Route path="/admin/quizzes" element={<ProtectedRoute role="admin"><AdminLayout><ManageQuizzes /></AdminLayout></ProtectedRoute>} />
          <Route path="/admin/game-analysis" element={<ProtectedRoute role="admin"><AdminLayout><GameAnalysis /></AdminLayout></ProtectedRoute>} />
          <Route path="/admin/analysis" element={<ProtectedRoute role="admin"><AdminLayout><AnalysisBoard /></AdminLayout></ProtectedRoute>} />
          <Route path="/admin/chess-profile" element={<ProtectedRoute role="admin"><AdminLayout><ChessProfile /></AdminLayout></ProtectedRoute>} />
          <Route path="/admin/review" element={<ProtectedRoute role="admin"><FeatureRoute feature="live_review"><AdminLayout><GameReview /></AdminLayout></FeatureRoute></ProtectedRoute>} />
          
          
          <Route path="/admin/openings" element={<ProtectedRoute role="admin"><AdminLayout><AcademyHome /></AdminLayout></ProtectedRoute>} />
          <Route path="/admin/openings/level/:levelSlug" element={<ProtectedRoute role="admin"><AdminLayout><AcademyLevel /></AdminLayout></ProtectedRoute>} />
          <Route path="/admin/openings/lessons/:levelSlug/:lessonSlug" element={<ProtectedRoute role="admin"><AdminLayout><AcademyLesson /></AdminLayout></ProtectedRoute>} />
          <Route path="/admin/openings/course/:openingSlug" element={<ProtectedRoute role="admin"><AdminLayout><AcademyOpening /></AdminLayout></ProtectedRoute>} />
          <Route path="/admin/gm-games" element={<ProtectedRoute role="admin"><AdminLayout><AdminGmGames /></AdminLayout></ProtectedRoute>} />
          <Route path="/admin/announcements" element={<ProtectedRoute role="admin"><AdminLayout><Announcements /></AdminLayout></ProtectedRoute>} />
          <Route path="/admin/settings" element={<ProtectedRoute role="admin"><AdminLayout><Settings /></AdminLayout></ProtectedRoute>} />
          <Route path="/admin/profile" element={<ProtectedRoute role="admin"><AdminLayout><AdminProfile /></AdminLayout></ProtectedRoute>} />
          {/* People is not a separate section any more — the directory lives as the
              People tab inside Messages, which is where you actually use it.
              The old deep link redirects into that tab so bookmarks and any
              old sidebar entry still land somewhere useful. */}
          <Route path="/admin/people" element={<ProtectedRoute role="admin"><Navigate to="/admin/messages?tab=people" replace /></ProtectedRoute>} />
          <Route path="/admin/messages" element={<ProtectedRoute role="admin"><FeatureRoute feature="messaging_students"><AdminLayout><MessagesPage /></AdminLayout></FeatureRoute></ProtectedRoute>} />
            {/* Coach-approval queue for student-to-student messaging. Reachable by
                superadmin too (read-only oversight), so it is role="admin" only and
                the page itself branches on the exact role. Not feature-gated: the
                queue must stay reachable even when the messenger is switched off. */}
            <Route path="/admin/chat-requests" element={<ProtectedRoute role="admin"><AdminLayout><ChatRequestsPage /></AdminLayout></ProtectedRoute>} />

          {/* The AI Coach Training Academy was removed from the admin side at the
              user's request, so its `/coach/ai-coach-training/*` routes are gone
              and the admin menu no longer links to it. The feature's own files
              (features/coachAcademy/**) are intentionally left on disk so this
              can be reverted by re-adding the routes; nothing imports them now. */}

          {/* Chess Tactics — the 45-tactic learning section. The shell mounts are
              gated by Feature Access like every other section; the standalone
              /tactics routes stay public (no shell, no role to gate on). Progress
              is stored locally and scoped per user. */}
          <Route path="/tactics" element={<TacticsPage />} />
          <Route path="/tactics/:slug" element={<TacticPage />} />
          <Route path="/student/tactics" element={<ProtectedRoute role="student"><FeatureRoute feature="chess_tactics"><StudentLayout><TacticsPage /></StudentLayout></FeatureRoute></ProtectedRoute>} />
<Route path="/student/tactics/:slug" element={<ProtectedRoute role="student"><FeatureRoute feature="chess_tactics"><StudentLayout><TacticPage /></StudentLayout></FeatureRoute></ProtectedRoute>} />
        {/* Board Vision — vision training (dashboard + trainer + results). No
            feature gate: it is core training like Play Arena, always reachable. */}
        <Route path="/student/board-vision" element={<ProtectedRoute role="student"><StudentLayout><BoardVision /></StudentLayout></ProtectedRoute>} />
        <Route path="/admin/tactics" element={<ProtectedRoute role="admin"><FeatureRoute feature="chess_tactics"><AdminLayout><TacticsPage /></AdminLayout></FeatureRoute></ProtectedRoute>} />
        <Route path="/admin/tactics/:slug" element={<ProtectedRoute role="admin"><FeatureRoute feature="chess_tactics"><AdminLayout><TacticPage /></AdminLayout></FeatureRoute></ProtectedRoute>} />

        {/* Explicit 403 page (also rendered inline by ProtectedRoute on wrong-role) */}
        <Route path="/access-denied" element={<AccessDenied />} />

        {/* Catch-all 404 — must be LAST */}
        <Route path="*" element={<NotFound />} />
        </Routes>
      </div>
    </div>
    </ToastProvider>
  );
}
