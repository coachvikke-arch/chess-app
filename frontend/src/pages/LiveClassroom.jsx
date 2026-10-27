import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { isAdminRole, homeForRole } from '../utils/roles';
import { LiveClassProvider, useLiveClass } from '../context/LiveClassContext';
import { getJoinToken, endClass, normalizeMeetingUrl, setClassSpectateEnabled } from '../services/liveClassApi';
import { leaveLiveClass, on } from '../services/socket';
import PuzzleDrillArea from '../components/liveclass/PuzzleDrill';
import SpectateModal, { SpectateButton } from '../components/liveclass/SpectateModal';
import WatchClassmatesModal, { WatchClassmatesButton } from '../components/liveclass/WatchClassmatesModal';
import ChatPanel, { UnreadBadge } from '../components/liveclass/ChatPanel';
import PairPlayersModal from '../components/liveclass/PairPlayersModal';
import ClassroomJoinToasts from '../components/liveclass/ClassroomJoinToasts';
import LiveClassSocketBridge from '../components/liveclass/LiveClassSocketBridge';
import { isClassJoinSoundEnabled, setClassJoinSoundEnabled, subscribeClassJoinSound } from '../utils/classJoinSound';
import { setBotGameContext, clearBotGameContext, touchBotGameContext, BOT_CONTEXT_HEARTBEAT_MS } from '../utils/botGameContext';
import { useFullHeight } from '../context/FullHeightContext';
import Button from '../components/Button';
import usePageTitle from '../hooks/usePageTitle';
import { formatTime } from '../utils/formatTime';

/* The stored schedule is a date column plus a separate "HH:mm:ss" string, so
   joining them directly printed raw ISO next to a 24-hour clock. Build one
   local Date from the two (the time is what the coach scheduled in their own
   clock) and let the shared helper render it. */
function scheduleLabel(meta) {
  const raw = meta?.scheduledDate;
  if (!raw) return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  const match = /^(\d{1,2}):(\d{2})/.exec(String(meta?.startTime || ''));
  if (!match) return formatTime(date, { dateOnly: true });
  date.setHours(Number(match[1]), Number(match[2]), 0, 0);
  return formatTime(date);
}

/* Boot screen states */
const BOOT_LOADING = 'loading';
const BOOT_ERROR = 'error';

/* Ended-screen copy per reason: an ending the user did NOT choose gets an
   explanation instead of a silent drop. */
const END_COPY = {
  ended: {
    title: 'The class has ended',
    body: 'The instructor ended this session. Thanks for joining!',
  },
  cancelled: {
    title: 'The class was cancelled',
    body: 'The instructor cancelled this session.',
  },
  kicked: {
    title: 'You were removed from the class',
    body: 'The instructor removed you from this session.',
  },
};

function ClassroomInner({ socketError }) {
  const { classMeta, isInstructor, permissions, participants, connection, spectateEnabled, setSpectateEnabled, selfGameStatus } = useLiveClass();  const [fullscreen, setFullscreen] = useState(false);
  /* Why the room closed itself, if it did — null while live. A voluntary
     Leave navigates away instead (see goHome below). */
  const [endReason, setEndReason] = useState(null);
  const [pairingOpen, setPairingOpen] = useState(false);
  /* The room is one screen tall and never scrolls, so everything that is not
     part of the lesson itself lives behind one of these switches:
     - railOpen   : the chat / files / standings rail (collapse it and the board
                    takes the whole width back),
     - menuOpen   : the secondary header notes (view-only board, chat mode, the
                    external meeting link) that only matter once.
     Spectating opens as a modal card, not an inline strip. */
  const [railOpen, setRailOpen] = useState(true);
  /* Total unread private messages, published by ChatPanel. Surfaced on the rail
     toggle so a collapsed panel still shows that something is waiting. */
  const [chatUnread, setChatUnread] = useState(0);
  const [spectateOpen, setSpectateOpen] = useState(false);
  /* Student "watch classmates" modal. Only reachable once this student's own
     game in the class has finished and the instructor allows watching. */
  const [watchOpen, setWatchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  /* Optional soft chime when someone joins. OFF by default and stored
     per-user, so a coach's choice does not phone the whole room. */
  const [joinSound, setJoinSound] = useState(isClassJoinSoundEnabled);
  const menuRef = useRef(null);
  const menuBtnRef = useRef(null);
  /* Ref to the menu PANEL itself. The panel is portaled to <body>, so it lives
     OUTSIDE menuRef (which wraps only the ⋯ toggle button). Without this second
     ref the outside-press guard below cannot tell "a press on a menu item"
     from "a press outside", and it closed the menu on pointerdown - unmounting
     it before the click event could dispatch, so no menu item was ever
     clickable. */
  const menuPanelRef = useRef(null);
  const { user } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  /* subscribe to class lifecycle events */
  useEffect(() => {
    if (!classMeta?.id) return undefined;
    const handle = (reason) => (payload) => {
      if (payload?.classId != null && Number(payload.classId) !== Number(classMeta.id)) return;
      /* The instructor ends the class through their own endClass() call, which
         navigates them home — the room echo of that must not flash them the
         student's ended screen on the way out. */
      if (isInstructor && reason === 'ended') return;
      setEndReason(reason);
      leaveLiveClass(classMeta.id);
    };
    const offs = [
      on('class_ended', handle('ended')),
      on('class_cancelled', handle('cancelled')),
      on('class_kicked', handle('kicked')),
    ];
    return () => offs.forEach((off) => off());
  }, [classMeta?.id, isInstructor]);

  /* targeted toast when the instructor pairs THIS student into a game */
  useEffect(() => {
    if (!classMeta?.id) return undefined;
    const off = on('pvp-started', (payload) => {
      if (Number(payload?.classId) !== Number(classMeta.id)) return;
      const color = payload.myColor === 'white' ? 'White' : 'Black';
      showToast(
        `You've been paired! Play as ${color} vs ${payload.opponentName || 'your opponent'} (${payload.baseMinutes}+${payload.incrementSeconds}). Your board is ready.`,
        { duration: 9000, title: '⚔ Player vs Player' }
      );
    });
    return () => off();
  }, [classMeta?.id, showToast]);

  /* Room-level toast when the instructor pairs students into games */
  useEffect(() => {
    if (!classMeta?.id || !isInstructor) return undefined;
    const off = on('pvp-pairing', (payload) => {
      if (Number(payload?.classId) !== Number(classMeta.id)) return;
      const count = payload?.games?.length || 0;
      if (count > 0) {
        showToast(
          `Paired ${count} game${count === 1 ? '' : 's'} — students can start playing now.`,
          { duration: 5000, title: '⚔ Pairing Complete' }
        );
      }
    });
    return () => off();
  }, [classMeta?.id, isInstructor, showToast]);

  /* Publish the live class so a bot game started from inside the classroom can be
     attributed to it on the class leaderboard. Bot result reporting happens on a
     different page (the Bot Arena), so the classroom id is handed over through
     storage rather than props - see botGameContext.js. The entry is re-stamped
     on a heartbeat while the class is live, and cleared (for this class only)
     on unmount — and as soon as the class ends below, even though the ended
     screen keeps this component mounted. */
  useEffect(() => {
    const id = classMeta?.id;
    if (!id || endReason) return undefined;
    setBotGameContext({ classId: id, title: classMeta.title || '' });
    const beat = window.setInterval(() => touchBotGameContext(id), BOT_CONTEXT_HEARTBEAT_MS);
    return () => {
      window.clearInterval(beat);
      clearBotGameContext(id);
    };
  }, [classMeta?.id, classMeta?.title, endReason]);

  /* The overflow menu is hover-free on purpose: it only closes on an explicit
     press outside, Escape, or picking an item - otherwise it would vanish
     mid-move while someone is reading what it says. */
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDown = (e) => {
      /* The toggle button (menuRef) and the portaled panel (menuPanelRef) are
         both "inside". Everything else - including the dim backdrop - closes. */
      if (menuRef.current && menuRef.current.contains(e.target)) return;
      if (menuPanelRef.current && menuPanelRef.current.contains(e.target)) return;
      setMenuOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        menuBtnRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  /* Keep the menu toggle in sync if the join-sound preference changes. */
  useEffect(() => subscribeClassJoinSound(setJoinSound), []);

  const connectedError = socketError
    ? `Realtime room error: ${socketError}. Board and chat may not sync - try refreshing the page.`
    : '';

  /* Leaving is something the user CHOSE to do, so it should not strand them on
     a farewell screen that only offers a link. Go straight to their own
     dashboard instead.

     `homeForRole` rather than a hardcoded path: '/' is the public marketing
     page, and the dashboard differs per role (students vs coach/Super Admin),
     so a literal would drop a coach on the student side - or, from a stale
     session, on the sign-in page. `replace` keeps the classroom out of
     history so Back does not re-enter a class they just left. */
  const goHome = () => {
    leaveLiveClass(classMeta.id);
    navigate(homeForRole(user?.role), { replace: true });
  };

  /* The header back arrow, for everyone: leaving never ends the session, so
     the class stays live for everyone else. */
  function handleLeave() {
    if (!window.confirm('Leave the room? The class stays live for everyone else.')) return;
    goHome();
  }

  /* Instructors end the session for EVERYONE from the leave bar: the backend
     marks the class completed and emits `class_ended` to the room, which drops
     every OTHER client onto the ended screen. */
  function handleEnd() {
    if (!isInstructor) return;
    if (!window.confirm('End this classroom for everyone?')) return;
    endClass(classMeta.id)
      .then(goHome)
      .catch((err) => {
        const msg = err?.response?.data?.message || err.message || 'Could not end the class';
        if (window.confirm(`${msg}. Leave anyway?`)) goHome();
      });
  }

  /* Instructor switch: allow/deny students watching their classmates. Applied
     optimistically and reconciled by the socket `spectate_toggled` echo; on
     failure we revert and explain. */
  function toggleClassmateWatch() {
    if (!isInstructor) return;
    const next = !spectateEnabled;
    setSpectateEnabled(next);
    setMenuOpen(false);
    setClassSpectateEnabled(classMeta.id, next).catch((err) => {
      setSpectateEnabled(!next);
      showToast(err?.response?.data?.message || 'Could not update the setting', { title: 'Watch classmates' });
    });
  }

  /* An ending the user did NOT choose (instructor ended it, cancelled, or you
     were kicked) → explain it instead of silently dropping them. */
  if (endReason) {
    const copy = END_COPY[endReason];
    return (
      <div className="live-room-ended">
        <div className="live-room-ended-card">
          <span className="live-room-ended-glyph">🏁</span>
          <h1 className="live-room-ended-title">{copy.title}</h1>
          <p className="live-room-ended-sub">
            {copy.body}
          </p>
          <Button to={homeForRole(user?.role)} variant="primary" size="md">Back to my dashboard</Button>
        </div>
      </div>
    );
  }

  const isExternal = classMeta?.classType === 'external';
  /* Normalised once here: a stored URL without a scheme ("meet.google.com/x")
     is a relative path to the browser, so the raw value would 404 inside the
     app. Both the bar and the overflow menu link consume this. */
  const meetingUrl = normalizeMeetingUrl(classMeta?.meetingUrl);
  const inRoom = participants.filter((p) => p.status !== 'left');
  const connLabel = connection === 'reconnecting' ? 'Reconnecting'
    : connection === 'connected' ? 'Connected' : 'Connecting';
  const subtitle = [
    classMeta?.instructorName ? `Coach ${classMeta.instructorName}` : '',
    scheduleLabel(classMeta),
  ].filter(Boolean).join(' · ');

  const boardArea = (
    <div className="live-board-col">
      <PuzzleDrillArea />
    </div>
  );
  const chatArea = (
    <div className="live-chat-col">
      <ChatPanel panelVisible={railOpen} onUnreadChange={setChatUnread} />
    </div>
  );

  /* Everything that used to have its own row under the header - connection,
     view-only note, instructor note, chat mode, external video - now lives in
     one overflow menu. The bar keeps only what has to be readable at a glance
     while a lesson is running. */
  const secondary = (
    <div className="live-menu" ref={menuPanelRef}>
      <span className="live-menu-row">
        <span className={`live-dot ${connection === 'connected' ? 'live-dot-on' : 'live-dot-warn'}`} />
        <span className="live-menu-label">{connLabel}</span>
      </span>
      {!permissions.canDrawAnnotations && <span className="live-menu-row">👁 View-only board</span>}
      {isInstructor && <span className="live-menu-row">🎓 Instructor view</span>}
      {classMeta?.chatMode === 'instructor-only' && <span className="live-menu-row">🛡 Chat: instructor only</span>}
      <span className="live-menu-row">👥 {inRoom.length} in class</span>
      {isExternal && meetingUrl && (
        <a className="live-menu-row live-menu-link" href={meetingUrl} target="_blank" rel="noopener noreferrer" onClick={() => setMenuOpen(false)}>
          🔗 Open external video
        </a>
      )}
      <button
        type="button"
        className="live-menu-row live-menu-act"
        onClick={() => { setClassJoinSoundEnabled(!joinSound); setMenuOpen(false); }}
        aria-pressed={joinSound}
      >
        {joinSound ? '🔔 Join sounds: on' : '🔕 Join sounds: off'}
      </button>
      {isInstructor && (
        <button
          type="button"
          className="live-menu-row live-menu-act"
          onClick={toggleClassmateWatch}
          aria-pressed={spectateEnabled}
        >
          {spectateEnabled ? '👀 Watch classmates: allowed' : '🚫 Watch classmates: blocked'}
        </button>
      )}
      <button
        type="button"
        className="live-menu-row live-menu-act"
        onClick={() => { setFullscreen((f) => !f); setMenuOpen(false); }}
      >
        {fullscreen ? '⤓ Leave immersive view' : '⛶ Immersive view'}
      </button>
    </div>
  );

  /* The overflow menu is PORTALED to <body> with position:fixed + a very high
     z-index, behind a dim backdrop. The header (and the board / Board Tools
     columns) create stacking contexts, so an absolutely-positioned menu nested
     inside them could be painted over no matter how high its own z-index was.
     Portaling out of those contexts is what guarantees it sits on top. The
     backdrop closes the menu on outside tap; Escape and choosing an action
     close it too (see the menuOpen effect above). On phones it becomes a
     bottom sheet (see the .live-menu rules in index.css). */
  const menuPortal = menuOpen
    ? createPortal(
      <>
        <div className="live-menu-backdrop" onClick={() => setMenuOpen(false)} />
        {secondary}
      </>,
      document.body
    )
    : null;

  return (
    <div className={`live-room ${fullscreen ? 'live-room-fullscreen' : ''}`}>
      <header className="live-room-header">
        <div className="live-room-header-left">
          <span className="live-live-indicator">
            <span className="live-dot live-dot-on" />
            <span className="live-live-text">LIVE</span>
          </span>
          <h1 className="live-room-title">{classMeta?.title || 'Live Chess Class'}</h1>
          {subtitle ? (
            <span className="live-room-subtitle">
              {subtitle}
            </span>
          ) : null}
        </div>
        <div className="live-room-header-right">
          <span className="live-meta-chip live-conn-chip" title={`Realtime: ${connLabel}`}>
            <span className={`live-dot ${connection === 'connected' ? 'live-dot-on' : 'live-dot-warn'}`} />
            <span className="live-conn-text">{connLabel}</span>
          </span>
          <span className="live-meta-chip live-count-chip" title="People in the room">
            👥 {inRoom.length}
          </span>
          {isInstructor && (
            <Button type="button" variant="secondary" size="sm" onClick={() => setPairingOpen(true)}>
              ⚔ Pair
            </Button>
          )}
          {isExternal && meetingUrl && (
            <Button
              href={meetingUrl}
              target="_blank"
              rel="noopener noreferrer"
              variant="secondary"
              size="sm"
              className="live-open-video"
            >
              ▶ Open Video
            </Button>
          )}
          <div className="live-menu-wrap" ref={menuRef}>
            <button
              type="button"
              ref={menuBtnRef}
              className={`live-chip live-menu-btn ${menuOpen ? 'live-chip-on' : ''}`}
              aria-haspopup="true"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((o) => !o)}
              title="More"
            >
              ⋯
            </button>
            {/* The menu itself renders via a portal at the end of this tree
                (menuPortal), so it escapes the header's stacking context. */}
          </div>
          <button
            type="button"
            className={`live-chip live-rail-toggle ${railOpen ? 'live-chip-on' : ''} ${!railOpen && chatUnread ? 'live-chip-unread' : ''}`}
            onClick={() => setRailOpen((o) => !o)}
            title={railOpen ? 'Hide the side panel' : `Show the side panel${chatUnread ? ` · ${chatUnread} unread` : ''}`}
            aria-pressed={railOpen}
          >
            {railOpen ? '»' : '«'}
            {!railOpen && <UnreadBadge count={chatUnread} />}
          </button>
        </div>
      </header>

      {/* Destructive confirmation, deliberately NOT a floating button over the
          board: one click on "✕ End classroom" ends the session for every
          student in the room, so it sits under the header with the rest of the
          room's controls, where the confirm dialog can be read first. */}
      <div className="live-room-leavebar">
        <Button
          type="button"
          variant={isInstructor ? 'danger' : 'secondary'}
          size="md"
          onClick={isInstructor ? handleEnd : handleLeave}
        >
          {isInstructor ? '✕ End classroom' : '✕ Leave'}
        </Button>
      </div>

      {connectedError && (
        <div className="live-banner live-banner-warn">{connectedError}</div>
      )}

      {/* Renders nothing itself. Subscribes to participant_joined and raises a
          shared toast, so arrivals look like every other notification in the app
          instead of a bespoke panel. */}
      <ClassroomJoinToasts />

      <div className={`live-room-desktop ${railOpen ? '' : 'rail-closed'}`}>
        <div className="live-room-main live-room-main-single">
          {boardArea}
        </div>
        <div className="live-room-side">
          {chatArea}
        </div>
      </div>

      {/* Spectating opens as a big modal card, not an inline strip, so the
          board keeps its full height. */}
      {isInstructor && <SpectateButton onClick={() => setSpectateOpen(true)} />}
      {isInstructor && spectateOpen && (
        <SpectateModal onClose={() => setSpectateOpen(false)} />
      )}

      {/* Students: watch classmates, but only once their own board in this class
          is done and the instructor allows it. */}
      {!isInstructor && selfGameStatus === 'finished' && spectateEnabled && (
        <WatchClassmatesButton onClick={() => setWatchOpen(true)} />
      )}
      {!isInstructor && watchOpen && (
        <WatchClassmatesModal onClose={() => setWatchOpen(false)} />
      )}

      {pairingOpen && (
        <PairPlayersModal
          classId={classMeta?.id}
          students={participants.filter((p) => p.status !== 'left' && p.roleInClass === 'student')}
          onClose={() => setPairingOpen(false)}
          onStarted={(games, tc) => {
            showToast(`Started ${games.length} pairing${games.length === 1 ? '' : 's'} · ${tc.baseMinutes}+${tc.incrementSeconds}`);
            setPairingOpen(false);
          }}
        />
      )}

      {/* Overflow menu, portaled out of the header's stacking context so it
          always paints above the board and Board Tools. */}
      {menuPortal}
    </div>
  );
}

export default function LiveClassroom() {
  usePageTitle('Live Classroom');
  const { requestFullHeight } = useFullHeight();
  /* Reset on unmount: the shell is now persistent across routes, so the
     full-height flag must not leak into the next page. */
  useEffect(() => {
    requestFullHeight(true);
    return () => requestFullHeight(false);
  }, [requestFullHeight]);

  const { id } = useParams();
  const { user } = useAuth();
  const [boot, setBoot] = useState(null);
  const [status, setStatus] = useState(BOOT_LOADING);
  const [error, setError] = useState('');
  const [socketError, setSocketError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  /* One effect owns the whole join: the `alive` flag stops a late join-token
     response (or a socket ack, or an error) from touching state after the
     component unmounted or a retry superseded it. */
  useEffect(() => {
    let alive = true;
    (async () => {
      setStatus(BOOT_LOADING);
      setError('');
      setSocketError('');
      try {
        const data = await getJoinToken(id);
        if (!alive) return;
        setBoot(data);
        setStatus('ready');
        /* The socket join itself is owned by LiveClassSocketBridge, which
           mounts with the provider once `boot` is set - so it can attach its
           `class:init` listener before emitting, and re-join on reconnect. */
      } catch (err) {
        if (!alive) return;
        const statusCode = err?.response?.status;
        if (statusCode === 403) {
          setError('You are not authorized to join this class.');
        } else if (statusCode === 400) {
          setError('This class is not live yet. Come back when the instructor starts it.');
        } else {
          setError(err?.response?.data?.message || err.message || 'Failed to load the classroom.');
        }
        setStatus(BOOT_ERROR);
      }
    })();
    return () => {
      alive = false;
      if (id) leaveLiveClass(id);
    };
  }, [id, reloadKey]);

  if (status === BOOT_LOADING) {
    return (
      <div className="live-room-boot">
        <div className="live-room-boot-card">
          <div className="live-boot-spinner" />
          <p>Joining the live classroom…</p>
          {!user && <p className="text-sm text-ivory-500">Please log in first.</p>}
        </div>
      </div>
    );
  }

  if (status === BOOT_ERROR) {
    return (
      <div className="live-room-boot">
        <div className="live-room-boot-card">
          <span className="live-room-ended-glyph">🚪</span>
          <h1 className="live-room-ended-title">Cannot enter classroom</h1>
          <p className="live-room-ended-sub">{error}</p>
          <Button
            type="button"
            variant="primary" size="md"
            onClick={() => setReloadKey((k) => k + 1)}
          >
            ↻ Try again
          </Button>
          <Button to={isAdminRole(user?.role) ? '/admin/classes' : homeForRole(user?.role)} variant="primary" size="md">
            ← Back to my classes
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="cp-ink-all">
      <LiveClassProvider boot={boot}>
        <LiveClassSocketBridge classId={id} onSocketError={setSocketError} />
        <ClassroomInner socketError={socketError} />
      </LiveClassProvider>
    </div>
  );
}
