/* The ONE place that maps a notification to the page it belongs to.
 *
 * Add a new notification type by adding one entry to NOTIFICATION_TYPE_ROUTES:
 *   type: ({ hasId, id, isAdmin, base, home }) => ({ to, state? })
 *
 * Anything the map cannot resolve (including rows written by a bare notify()
 * with type = NULL) falls through the title/#class-id tiers below and finally
 * to the Notifications page — a real page that always exists, so a tap is
 * never a dead control. */

export const NOTIFICATION_TYPE_ROUTES = {
  /* Chat. MessagesPage accepts these state keys and clears them after opening,
     so revisiting Messages won't re-open the thread. */
  message: ({ base, hasId, id }) =>
    hasId ? { to: `${base}/messages`, state: { openUserId: id } } : { to: `${base}/messages` },
  group_message: ({ base, hasId, id }) =>
    hasId ? { to: `${base}/messages`, state: { openGroupId: id } } : { to: `${base}/messages` },
  /* related_id is a MESSAGE id here, not a person, so open the list only. */
  chat_reaction: ({ base }) => ({ to: `${base}/messages` }),
  /* Online games / challenges are surfaced by the Analysis page — that is where
     acceptGame/declineGame and "Challenge waiting" live. */
  match_request: ({ base }) => ({ to: `${base}/analysis` }),
  /* related_id is the REQUEST id, not a user id, so it must NOT be passed as
     openUserId. Coaches land on their queue; students land on Messages where
     the People tab carries the request buttons. */
  chat_request: ({ base, isAdmin }) =>
    isAdmin ? { to: `${base}/chat-requests` } : { to: `${base}/messages?tab=people` },

  assignment: ({ base }) => ({ to: `${base}/assignments` }),
  homework: ({ base }) => ({ to: `${base}/homework` }),
  puzzle: ({ base, isAdmin }) => ({ to: isAdmin ? `${base}/puzzle-listing` : `${base}/puzzles` }),
  review: ({ base }) => ({ to: `${base}/review` }),
  tournament: ({ base, hasId, id }) =>
    hasId ? { to: `${base}/tournaments/${id}` } : { to: `${base}/tournaments` },
  certificate: ({ base, user }) => {
    /* The certificate pages are role-gated: students have /student/certificates
       and only a superadmin can open /super/certificates, so a plain admin is
       sent to the inbox rather than a route that would bounce them. */
    if (user?.role === 'superadmin') return { to: '/super/certificates' };
    if (base === '/admin') return { to: `${base}/notifications`, fallback: true };
    return { to: `${base}/certificates` };
  },
  announcement: ({ base, isAdmin }) => ({ to: isAdmin ? `${base}/announcements` : '/announcements' }),
  quiz: ({ home, hasId, id }) => (hasId ? { to: `/quizzes/${id}` } : home),
  class: ({ base, isAdmin }) =>
    isAdmin ? { to: `${base}/classes` } : { to: `${base}/live-meetings` },
  lesson: ({ base, isAdmin }) =>
    isAdmin ? { to: `${base}/classes` } : { to: `${base}/live-meetings` },
};

/** Where tapping a notification should take you. Always returns `{ to, state? }`. */
export function notificationTarget(n, user) {
  if (!n) return null;
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';
  const base = isAdmin ? '/admin' : '/student';
  const home = `${base}/dashboard`;
  const inbox = `${base}/notifications`;
  const id = Number(n.related_id);
  const hasId = Number.isInteger(id) && id > 0;

  const route = NOTIFICATION_TYPE_ROUTES[n.type];
  if (route) return route({ hasId, id, isAdmin, base, home, inbox, user });

  /* Tier 2 — class reminders carry a routable class id in the body. */
  const classToken = /#class-(\d+)/.exec(`${n.message || ''}`);
  if (classToken) return { to: `/live-class/${classToken[1]}` };

  /* Tier 3 — the real title strings written by the bare notify() calls. */
  const t = `${n.title || ''} ${n.message || ''}`.toLowerCase();
  if (!t.trim()) return { to: inbox, fallback: true };

  /* Written ONLY by tournamentController, and carry no "tournament" keyword. */
  if (/(game result recorded|game finished)/.test(t)) return { to: `${base}/tournaments` };

  if (/(tournament|registered for|you were added to)/.test(t)) {
    return hasId ? { to: `${base}/tournaments/${id}` } : { to: `${base}/tournaments` };
  }
  if (/(class starting soon|class|meeting|live class)/.test(t)) {
    return isAdmin ? { to: `${base}/classes` } : { to: `${base}/live-meetings` };
  }
  /* Credential/security notices are written only by authController and
     adminController; Profile is where a user would go to secure their account. */
  if (/(password|credential|sign-in|sign in|invalid)/.test(t)) return { to: `${base}/profile` };
  if (/(welcome)/.test(t)) return { to: home };
  if (/(assignment|homework)/.test(t)) return { to: `${base}/homework` };
  if (/(puzzle)/.test(t)) return { to: isAdmin ? `${base}/puzzle-listing` : `${base}/puzzles` };
  if (/(certificate)/.test(t)) return base === '/admin' ? { to: '/super/certificates' } : { to: `${base}/certificates` };
  if (/(announcement)/.test(t)) return { to: isAdmin ? `${base}/announcements` : '/announcements' };
  if (/(message|chat|reacted)/.test(t)) return { to: `${base}/messages` };
  if (/(leaderboard|rating|badge)/.test(t)) return { to: `${base}/leaderboard` };
  if (/(attendance)/.test(t)) return { to: `${base}/attendance` };
  if (/(review|analysis|game report)/.test(t)) return { to: `${base}/review` };
  return { to: inbox, fallback: true };
}
