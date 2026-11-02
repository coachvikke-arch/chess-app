/**
 * Sidebar menu configs per portal.
 *
 * Each portal keeps its own menu items, labels, icons and routes.
 * Role-based visibility is preserved per item via feature/superOnly/superHidden.
 *
 * Shared Sidebar component renders whatever config it receives.
 */

export const adminLinks = [
  /* Owner-only entries at the top. Super Admin sees everything; coaches skip `superOnly`. */
  { to: '/super', label: 'Super Admin', icon: '♚', superOnly: true },
  { to: '/super/certificates', label: 'Certificates', icon: '♕', superOnly: true },
  { to: '/super/certificate-settings', label: 'Certificate Settings', icon: '✈', superOnly: true },
  { to: '/admin/dashboard', label: 'Dashboard', icon: '♕' },
  { to: '/admin/homework', label: 'Homework', icon: '📋' },
  { to: '/admin/command-center', label: 'Command Center', icon: '🗓', feature: 'analytics' },
  { to: '/admin/messages', label: 'Messages', icon: '💬', feature: 'messaging_students', badge: true },
  /* The old "✉ Chat Requests" row is gone on purpose: an ask is answered in the
     Requests section at the top of the Chat page, so the nav no longer needs a
     second door to the same queue. The /admin/chat-requests page and its route
     stay — a staff notification still opens the full request history there. */
  { to: '/admin/students', label: 'Students & Batches', superLabel: 'Students & Admins', icon: '♙', feature: 'student_roster' },
  /* The "♞ Student Reports" row is gone from the admin nav on purpose. The
     feature itself stays: the /admin/reports route, its page and its data all
     work, so anyone who reaches the report through a saved link or a direct URL
     lands on it exactly as before. Only the menu button was removed. */
  { to: '/admin/classes', label: 'Classes & Attendance', icon: '♘' },
  { to: '/admin/attendance', label: 'Offline Attendance', icon: '📋' },
  { to: '/admin/leaderboard', label: 'Leaderboard', icon: '♛' },
  { to: '/admin/tournaments', label: 'Tournaments', icon: '🏆' },
  { to: '/openings', label: 'Openings Library', icon: '♗' },
  { to: '/admin/openings', label: 'Academy', icon: '♘', feature: 'piece_lessons' },
  { to: '/admin/tactics', label: 'Chess Tactics', icon: '♗', feature: 'chess_tactics' },
  { to: '/admin/courses', label: 'Courses', icon: '📚' },
  { to: '/admin/performances', label: 'Top Performances', icon: '🏆' },
  { to: '/admin/gm-games', label: 'GM Games', icon: '♞', feature: 'gm_games' },
  { to: '/admin/puzzle-listing', label: 'Puzzle Listing', icon: '♟', feature: 'puzzle_authoring' },
  { to: '/admin/analysis', label: 'Play Arena', icon: '♝' },
  { to: '/admin/review', label: 'Game Review', icon: '♚', feature: 'live_review' },
  { to: '/admin/chess-profile', label: 'Chess Profile', icon: '♛' },
  { to: '/admin/announcements', label: 'Announcements', icon: '♚', feature: 'messaging_students' },
  { to: '/admin/settings', label: 'Settings', icon: '⚙' },
  { to: '/admin/profile', label: 'My Profile', icon: '♙' },
];

export const studentLinks = [
  { to: '/student/dashboard', label: 'Dashboard', icon: '♕' },
  { to: '/student/homework', label: 'Homework', icon: '📋', feature: 'puzzle_trainer' },
  { to: '/student/trainer', label: 'Puzzle Trainer', icon: '♞', feature: 'puzzle_trainer' },
  { to: '/openings', label: 'Openings', icon: '♞', feature: 'opening_library' },
  { to: '/student/openings', label: 'Academy', icon: '♘', feature: 'piece_lessons' },
  { to: '/student/gm-games', label: 'GM Games', icon: '♞', feature: 'gm_games' },
  { to: '/student/live-meetings', label: 'Live Meetings', icon: '📹', feature: 'live_game' },
  { to: '/student/messages', label: 'Messages', icon: '💬', feature: 'messaging_coach', badge: true },
  { to: '/student/attendance', label: 'Attendance', icon: '📋' },
  { to: '/student/analysis', label: 'Play Arena', icon: '♖' },
  { to: '/play/bots', label: 'Play vs Bots', icon: '🤖' },
  { to: '/student/profile', label: 'My Profile', icon: '👤' },
  { to: '/student/report', label: 'My Report', icon: '📊' },
  { to: '/student/performances', label: 'Top Performances', icon: '🏆' },
  { to: '/student/certificates', label: 'Certificates', icon: '🎓' },
  { to: '/student/chess-profile', label: 'Chess Profile', icon: '♛' },
  { to: '/student/leaderboard', label: 'Leaderboard', icon: '♛', feature: 'leaderboard' },
  { to: '/student/tournaments', label: 'Tournaments', icon: '🏆' },
  { to: '/student/ratings', label: 'Ratings', icon: '♕', feature: 'leaderboard' },
  
  { to: '/student/review', label: 'Game Review', icon: '♚', feature: 'game_analysis' },
  { to: '/student/tactics', label: 'Chess Tactics', icon: '♗', feature: 'chess_tactics' },
  { to: '/student/board-vision', label: 'Board Vision', icon: '👁' },
  { to: '/student/settings', label: 'Settings', icon: '⚙', feature: 'profile_settings' },
];

/**
 * Portal config — shared by AdminAppShell and StudentLayout.
 */
export const portalConfigs = {
  admin: {
    links: adminLinks,
    headerIcon: '♛',
    headerTitle: 'Coach Suite',
    headerSubtitle: 'Command Center',
    footerIcon: '♔',
    footerText: 'Every master was once a beginner.',
  },
  student: {
    links: studentLinks,
    headerIcon: '♛',
    headerTitle: 'Student Hub',
    headerSubtitle: 'Learning Center',
    footerIcon: '♔',
    footerText: 'Every master was once a beginner.',
  },
  superadmin: {
    links: adminLinks,
    headerIcon: '♛',
    headerTitle: 'Coach Suite',
    headerSubtitle: 'Command Center',
    footerIcon: '♔',
    footerText: 'Every master was once a beginner.',
  },
};

export const getPortalConfig = (portal) => portalConfigs[portal] || portalConfigs.admin;