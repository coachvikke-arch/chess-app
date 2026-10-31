import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../Toast';
import { homeForRole } from '../../utils/roles';
import { useLiveClass } from '../../context/LiveClassContext';
import { useClassEndTimer } from '../../hooks/useClassEndTimer';
import { endClass, extendClass, updateClass } from '../../services/liveClassApi';
import { leaveLiveClass, on, emit } from '../../services/socket';
import { formatTime } from '../../utils/formatTime';
import { searchBest, searchTopMoves } from '../../utils/engine';
import api from '../../services/api';
import PuzzleDrillArea from './PuzzleDrill';
import EvalBar from '../EvalBar';
import ChatPanel from './ChatPanel';
import LiveMoveHistory from './LiveMoveHistory';
import ClassroomLeaderboard from './ClassroomLeaderboard';
import ClassAssignmentsPanel from './ClassAssignmentsPanel';
import CourseFilesPanel from './CourseFilesPanel';
import PairPlayersModal from './PairPlayersModal';

const MIN_MS = 60 * 1000;
const FIVE_MIN_MS = 5 * 60 * 1000;
const PANEL_PRESETS = { S: 300, M: 420, L: 560 };

const toTimeString = (ms) => {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

const fmtClock = (ms) => {
  if (ms == null) return null;
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const p = (n) => String(n).padStart(2, '0');
  if (h > 0) return `${h}:${p(m)}:${p(s)}`;
  return `${m}:${p(s)}`;
};

const COACH_TABS = [
  { id: 'moves', label: 'Moves', icon: '♞' },
  { id: 'chat', label: 'Chat', icon: '💬' },
  { id: 'students', label: 'Students', icon: '👥' },
  { id: 'homework', label: 'Homework', icon: '📋' },
  { id: 'leaderboard', label: 'Leaderboard', icon: '🏆' },
  { id: 'engine', label: 'Engine', icon: '🧠' },
];

function CoachStudentsPanel() {
  const { classMeta, participants, setClassMeta, removeParticipant } = useLiveClass();
  const { user } = useAuth();
  const moveGrants = classMeta?.moveGrants || [];
  const { showToast } = useToast();
  const classId = classMeta?.id;
  const panelPresetKey = `liveV2PanelPreset:${user?.id || 'user'}`;
  const panelCustomKey = `liveV2PanelWidth:${user?.id || 'user'}`;
  const [q, setQ] = useState('');
  const [invitees, setInvitees] = useState([]);
  const [inviteOpen, setInviteOpen] = useState(false);

  const inRoom = useMemo(() => (participants || []).filter((p) => p.status !== 'left'), [participants]);
  const onlineCount = useMemo(() => inRoom.filter((p) => p.status === 'active').length, [inRoom]);
  const roster = useMemo(() => [...inRoom].sort((a, b) => {
    const ah = a.roleInClass === 'host' ? 0 : 1;
    const bh = b.roleInClass === 'host' ? 0 : 1;
    if (ah !== bh) return ah - bh;
    return (a.name || '').localeCompare(b.name || '');
  }), [inRoom]);
  const filtered = useMemo(() => {
    const needle = (q || '').trim().toLowerCase();
    if (!needle) return roster;
    return roster.filter((p) => (p.name || '').toLowerCase().includes(needle) || String(p.userId ?? '').includes(needle));
  }, [roster, q]);

  const grantOf = (userId) => (moveGrants || []).find((g) => Number(g.userId) === Number(userId));

  const loadInvitees = useCallback(async () => {
    if (!classId) return;
    try {
      const res = await api.get(`/classes/${classId}/inviteable-students`, { cache: false });
      setInvitees(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      showToast(err?.response?.data?.message || err.message || 'Could not load the invite list', { title: 'Add students' });
    }
  }, [classId, showToast]);

  useEffect(() => { if (inviteOpen) loadInvitees(); }, [inviteOpen, loadInvitees]);

  const sendReaction = (emoji, targetUserId = undefined) => {
    if (!classId) return;
    emit('class_reaction', { classId, emoji, userId: Number(user?.id), targetUserId });
  };

  return (
    <div className="live-v2-students">
      <div className="live-v2-students-summary">
        <span>{onlineCount} of {inRoom.length} online</span>
        <span className="live-v2-students-actions">
          <button type="button" className="live-chip" onClick={() => setInviteOpen((o) => !o)}>+ Add</button>
          {['👍', '❤️', '😂', '🎉', '😮', '😢'].map((e) => (
            <button key={e} type="button" className="live-chip" onClick={() => sendReaction(e)}>{e}</button>
          ))}
        </span>
      </div>

      {inviteOpen && (
        <div className="live-v2-invite">
          <div className="live-v2-invite-head">
            <span>Add students to this class</span>
            <button type="button" className="live-icobtn" onClick={() => setInviteOpen(false)} aria-label="Close">✕</button>
          </div>
          {invitees.length === 0 && <p className="live-chat-empty">No one new to add right now.</p>}
          {invitees.map((s) => (
            <div key={s.userId ?? s.id} className="live-v2-invite-row">
              <span>{s.name || s.email || `Student ${s.userId ?? ''}`}</span>
              <button
                type="button"
                className="live-chip"
                onClick={() => {
                  emit('invite_students', { classId, userIds: [s.userId ?? s.id] }, (res) => {
                    if (res?.ok === false) showToast(res.error || 'Could not send the invite', { title: 'Add students' });
                    else showToast(`${s.name || 'Student'} was invited.`, { title: 'Add students' });
                  });
                }}
              >Invite</button>
            </div>
          ))}
        </div>
      )}

      <input className="live-chat-input" placeholder="🔍 Search students…" value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="live-v2-student-list">
        {filtered.length === 0 && <li className="live-participants-empty">No students match.</li>}
        {filtered.map((p) => {
          const isHost = p.roleInClass === 'host';
          const g = grantOf(p.userId);
          const offline = p.status !== 'active';
          return (
            <li key={p.userId} className="live-participant">
              <span className={`live-participant-avatar ${p.status === 'active' ? 'is-online' : ''}`}>{(p.name || '?').trim().charAt(0).toUpperCase() || '?'}</span>
              <span className="live-participant-name">
                {p.name}
                {isHost && <span className="live-participant-host">HOST</span>}
              </span>
              <span className="live-v2-student-id">@{p.userId ?? p.email}</span>
              {offline && <span className="live-v2-student-off">offline</span>}
              {!isHost && (
                <span className="live-participant-actions">
                  <button type="button" className="live-chip" title={`Send a reaction to ${p.name}`} onClick={() => sendReaction('👏', p.userId)}>👏</button>
                  <button type="button" className="live-chip" title={`Message ${p.name}`} onClick={() => {
                    const message = window.prompt(`Private message to ${p.name}`);
                    if (!message?.trim()) return;
                    emit('chat_dm_reply', { classId, toUserId: p.userId, text: message.trim() }, (res) => {
                      if (res?.ok === false) showToast(res.error || 'Could not send the message', { title: 'Private message' });
                      else showToast(`Message sent to ${p.name}`, { title: 'Private message' });
                    });
                  }}>✉</button>
                  <select aria-label={`Move permission for ${p.name}`} value={g?.moveSide || 'none'} onChange={(e) => {
                    const side = e.target.value;
                    emit('student_move_grant', { classId, userId: p.userId, side }, (res) => {
                      if (res?.ok === false) { showToast(res.error, { title: 'Student moves' }); return; }
                      setClassMeta((prev) => prev ? ({ ...prev, moveGrants: [...(prev.moveGrants || []).filter((item) => Number(item.userId) !== Number(p.userId)), { userId: p.userId, moveSide: side, canDraw: Boolean(g?.canDraw) }] }) : prev);
                    });
                  }}>
                    <option value="none">None</option><option value="white">White</option><option value="black">Black</option><option value="both">Both</option>
                  </select>
                  <label className="live-v2-draw-toggle"><input type="checkbox" checked={Boolean(g?.canDraw)} aria-label={`Allow ${p.name} to draw`} onChange={(e) => {
                    const canDraw = e.target.checked;
                    emit('student_draw_grant', { classId, userId: p.userId, canDraw }, (res) => {
                      if (res?.ok === false) { showToast(res.error, { title: 'Student drawing' }); return; }
                      setClassMeta((prev) => prev ? ({ ...prev, moveGrants: [...(prev.moveGrants || []).filter((item) => Number(item.userId) !== Number(p.userId)), { userId: p.userId, moveSide: g?.moveSide || 'none', canDraw }] }) : prev);
                    });
                  }} /> Draw</label>
                  <button
                    type="button"
                    className="live-participant-remove"
                    title={`Remove ${p.name} from the class`}
                    onClick={() => { if (window.confirm(`Remove ${p.name} from the class?`)) { emit('admin:remove_participant', { classId, userId: p.userId }, (res) => { if (res?.ok === false) showToast(res.error, { title: 'Students' }); }); } }}
                  >⛔</button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <p className="live-v2-students-hint">Coach-only: grant colours, remove students, send reactions.</p>
    </div>
  );
}

export default function ClassroomV2Coach({ socketError }) {
  const {
    classMeta, isInstructor, participants, chessState, setClassMeta, setIsInstructor, patchPermissions,
    replaceParticipants, upsertParticipant, removeParticipant, connection, evalVisible, setEvalVisible,
    openQuizAsk, closeQuizAsk, quizAsk, moveGrants, setStudentActivity, bulkSetActivity, clearStudentActivity,
  } = useLiveClass();
  const { user } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const classId = classMeta?.id;
  const title = classMeta?.title || 'Live Chess Class';

  const { endMs, remainingMs, label } = useClassEndTimer(classMeta, true);
  const timerUrgent = remainingMs != null && remainingMs <= MIN_MS;

  const [titleDraft, setTitleDraft] = useState(title);
  useEffect(() => { setTitleDraft(classMeta?.title || ''); }, [classMeta?.title]);

  const saveTitle = useCallback(async () => {
    const t = titleDraft.trim();
    if (!t || !classId) return;
    if (t === classMeta?.title) return;
    try {
      await updateClass(classId, { title: t });
      setClassMeta((prev) => (prev ? { ...prev, title: t } : prev));
      showToast('Title updated', { title: 'Class title' });
    } catch (err) {
      showToast(err?.response?.data?.message || err.message || 'Could not update the title', { title: 'Class title' });
    }
  }, [classId, classMeta?.title, titleDraft, setClassMeta, showToast]);

  const hosted = useMemo(
    () => ({
      swap: () => emit('chess_control', { classId, action: 'swap', payload: {} }),
      loadPgn: (pgn) => emit('chess_control', { classId, action: 'load_pgn', payload: { pgn } }),
      loadFen: (fen) => emit('chess_control', { classId, action: 'load_fen', payload: { fen } }),
    }),
    [classId]
  );

  const [evalInfo, setEvalInfo] = useState(null);
  useEffect(() => {
    if (!evalVisible || !chessState?.fen) { setEvalInfo(null); return undefined; }
    let cancelled = false;
    searchBest(chessState.fen, { maxDepth: 12, timeMs: 1500 })
      .then((res) => { if (!cancelled) setEvalInfo(res); })
      .catch(() => { if (!cancelled) setEvalInfo(null); });
    return () => { cancelled = true; };
  }, [evalVisible, chessState?.fen]);

  const askQuiz = useCallback(async (selected = null) => {
    const fen = selected?.fen || chessState?.fen;
    if (!fen) { showToast('The board has no position to ask about.', { title: 'Ask quiz' }); return; }
    let solution = Array.isArray(selected?.solution) ? selected.solution : [];
    if (!solution.length) {
      try {
        const res = await searchBest(fen, { maxDepth: 12, timeMs: 1500 });
        if (res?.uci) solution = [res.uci];
      } catch { /* position-only quizzes are not accepted yet */ }
    }
    openQuizAsk({ title: selected?.title || title || 'Class quiz', fen, solution });
  }, [chessState?.fen, title, openQuizAsk, showToast]);

  const goHome = () => { navigate(homeForRole(user?.role), { replace: true }); };
  const handleLeave = () => {
    if (!window.confirm('Leave the room? The class stays live for everyone else.')) return;
    leaveLiveClass(classId);
    goHome();
  };
  const handleEnd = () => {
    if (!window.confirm('End this classroom for everyone?')) return;
    endClass(classId)
      .then(() => { leaveLiveClass(classId); navigate(homeForRole(user?.role), { replace: true }); })
      .catch((err) => {
        const msg = err?.response?.data?.message || err.message || 'Could not end the class';
        if (window.confirm(`${msg}. Leave anyway?`)) { leaveLiveClass(classId); navigate(homeForRole(user?.role), { replace: true }); }
      });
  };

  const [extendOpen, setExtendOpen] = useState(false);
  const dismissedAtRef = useRef(null);
  useEffect(() => {
    if (remainingMs == null) { setExtendOpen(false); return; }
    const prev = dismissedAtRef.current;
    dismissedAtRef.current = remainingMs;
    if (prev == null) { if (remainingMs <= FIVE_MIN_MS) setExtendOpen(true); return; }
    if (prev > FIVE_MIN_MS && remainingMs <= FIVE_MIN_MS) setExtendOpen(true);
    else if (prev > MIN_MS && remainingMs <= MIN_MS) setExtendOpen(true);
    else if (prev <= MIN_MS && remainingMs > MIN_MS) setExtendOpen(false);
  }, [remainingMs]);

  const handleExtend = async (minutes) => {
    const mins = Number(minutes);
    if (!Number.isFinite(mins) || mins <= 0) return;
    const target = endMs != null ? endMs + mins * 60000 : Date.now() + mins * 60000;
    try {
      await extendClass(classId, mins);
      setClassMeta((prev) => (prev ? { ...prev, endTime: toTimeString(target) } : prev));
      showToast(`Class extended by ${mins} minute${mins === 1 ? '' : 's'}`, { title: 'Class extended' });
    } catch (err) {
      showToast(err?.response?.data?.message || err.message || 'Could not extend the class', { title: 'Extend failed' });
      return;
    }
    setExtendOpen(false);
  };

  const menuRef = useRef(null);
  const menuPanelRef = useRef(null);
  const menuBtnRef = useRef(null);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDown = (e) => {
      if (menuRef.current && menuRef.current.contains(e.target)) return;
      if (menuPanelRef.current && menuPanelRef.current.contains(e.target)) return;
      setMenuOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') { setMenuOpen(false); menuBtnRef.current?.focus(); } };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [menuOpen]);

  const subtitle = useMemo(() => {
    const parts = [];
    if (classMeta?.instructorName) parts.push(`Coach ${classMeta.instructorName}`);
    const raw = classMeta?.scheduledDate;
    if (raw) {
      const date = new Date(raw);
      const match = /^(\d{1,2}):(\d{2})/.exec(String(classMeta?.startTime || ''));
      if (!Number.isNaN(date.getTime()) && match) date.setHours(Number(match[1]), Number(match[2]), 0, 0);
      const time = formatTime(date, { dateOnly: false });
      if (time) parts.push(time);
    }
    return parts.join(' · ');
  }, [classMeta?.instructorName, classMeta?.scheduledDate, classMeta?.startTime]);

  const [activityTab, setActivityTab] = useState('moves');
  const [panelSection, setPanelSection] = useState('activity');
  const [pairingOpen, setPairingOpen] = useState(false);
  const [panelWidth, setPanelWidth] = useState(() => {
    try {
      const custom = Number(localStorage.getItem(panelCustomKey));
      if (Number.isFinite(custom) && custom > 240) return custom;
      const preset = localStorage.getItem(panelPresetKey);
      if (preset && PANEL_PRESETS[preset]) return PANEL_PRESETS[preset];
    } catch { /* ignore */ }
    return PANEL_PRESETS.M;
  });
  const [customWidth, setCustomWidth] = useState(null);
  const width = customWidth ?? panelWidth;

  const setPreset = (p) => {
    setCustomWidth(null);
    setPanelWidth(PANEL_PRESETS[p]);
    try { localStorage.setItem(panelPresetKey, p); localStorage.removeItem(panelCustomKey); } catch { /* ignore */ }
  };
  const resetPanelWidth = () => {
    setCustomWidth(null);
    setPanelWidth(PANEL_PRESETS.M);
    try { localStorage.removeItem(panelCustomKey); localStorage.setItem(panelPresetKey, 'M'); } catch { /* ignore */ }
  };

  const dragStateRef = useRef(null);
  useEffect(() => {
    const onMove = (e) => {
      const st = dragStateRef.current;
      if (!st) return;
      const next = Math.min(640, Math.max(280, st.startWidth + (st.startX - e.clientX)));
      setCustomWidth(next);
      try { localStorage.setItem(panelCustomKey, String(Math.round(next))); } catch { /* ignore */ }
    };
    const onUp = () => { dragStateRef.current = null; };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
  }, []);

  const startPanelDrag = (e) => {
    e.preventDefault();
    dragStateRef.current = { startX: e.clientX, startWidth: width };
  };

  const [engineLines, setEngineLines] = useState([]);
  const [engineOn, setEngineOn] = useState(true);
  const fenForEngine = chessState?.fen;
  useEffect(() => {
    if (activityTab !== 'engine' || !engineOn) { setEngineLines([]); return undefined; }
    let cancelled = false;
    if (fenForEngine) {
      searchTopMoves(fenForEngine, { maxDepth: 14, timeMs: 1500, multiPv: 3 }).then((r) => { if (!cancelled) setEngineLines(r); });
    } else {
      setEngineLines([]);
    }
    return () => { cancelled = true; };
  }, [activityTab, fenForEngine, engineOn]);

  const inRoomCount = useMemo(() => (participants || []).filter((p) => p.status !== 'left').length, [participants]);

  const [recording, setRecording] = useState(classMeta?.recording === true);
  useEffect(() => setRecording(classMeta?.recording === true), [classMeta?.recording]);
  const setClassroomSetting = (setting, value) => {
    emit('classroom_setting', { classId, setting, value }, (res) => {
      if (res?.ok === false) { showToast(res.error || 'Could not update classroom setting', { title: 'Classroom settings' }); return; }
      if (setting === 'recording') setRecording(Boolean(value));
      if (setting === 'evalVisible') { setEvalVisible(Boolean(value)); setClassMeta((prev) => prev ? { ...prev, evalVisible: Boolean(value) } : prev); }
      if (setting === 'locked') setClassMeta((prev) => prev ? { ...prev, boardLocked: Boolean(value) } : prev);
      if (setting === 'hidden') setClassMeta((prev) => prev ? { ...prev, boardHidden: Boolean(value) } : prev);
    });
  };
  const fireBoardTool = (tool) => window.dispatchEvent(new CustomEvent(`classroom-v2:${tool}`));

  const activityPanel = (
    <div className="live-v2-activity" style={{ width }}>
      <div className="live-v2-activity-head">
        <span className="live-v2-activity-title">Classroom Activity</span>
        <span className="live-v2-activity-sub">👥 {inRoomCount} in class</span>
      </div>
      <div className="live-v2-main-tabs"><button type="button" className={panelSection === 'activity' ? 'active' : ''} onClick={() => setPanelSection('activity')}>Activity</button><button type="button" className={panelSection === 'pgn' ? 'active' : ''} onClick={() => setPanelSection('pgn')}>PGN Library</button></div>
      {panelSection === 'activity' && <>
      <div className="live-v2-activity-presets">
        {(['S', 'M', 'L'] || []).map((p) => (
          <button key={p} type="button" className={`live-chip ${!customWidth && width === PANEL_PRESETS[p] ? 'live-chip-on' : ''}`} onClick={() => setPreset(p)}>{p}</button>
        ))}
        <button type="button" className="live-chip" onClick={resetPanelWidth} title="Reset to the default width">Reset</button>
      </div>
      <div className="live-v2-activity-tabs">
        {COACH_TABS.map((t) => (
          <button key={t.id} type="button" className={`live-chip ${activityTab === t.id ? 'live-chip-on' : ''}`} onClick={() => setActivityTab(t.id)}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>
      <div className="live-chat-tabbody" style={{ display: activityTab === 'moves' ? 'block' : 'none' }}>
        <LiveMoveHistory asMobilePanel={false} hideHeader />
      </div>
      <div className="live-chat-tabbody" style={{ display: activityTab === 'chat' ? 'block' : 'none' }}>
        <ChatPanel asMobilePanel={false} panelVisible hideHeader tabOverride="chat" onTabChange={setActivityTab} />
      </div>
      <div className="live-chat-tabbody" style={{ display: activityTab === 'students' ? 'block' : 'none' }}>
        <CoachStudentsPanel />
      </div>
      <div className="live-chat-tabbody" style={{ display: activityTab === 'homework' ? 'block' : 'none' }}>
        <ClassAssignmentsPanel active />
      </div>
      <div className="live-chat-tabbody" style={{ display: activityTab === 'leaderboard' ? 'block' : 'none' }}>
        <ClassroomLeaderboard asMobilePanel={false} />
      </div>
      <div className="live-chat-tabbody" style={{ display: activityTab === 'engine' ? 'block' : 'none' }}>
        <div className="live-v2-engine">
          <div className="live-v2-engine-head">🧠 Stockfish <button type="button" className={`live-chip ${engineOn ? 'live-chip-on' : ''}`} onClick={() => setEngineOn((v) => !v)}>{engineOn ? 'On' : 'Off'}</button></div>
          {!engineOn && <p className="live-chat-empty">Engine is off.</p>}
          {engineOn && engineLines.length === 0 && <p className="live-chat-empty">No engine lines yet.</p>}
          {engineOn && engineLines.map((l, i) => (
            <div key={i} className="live-v2-engine-line">
              <span>➔ {l.uci || l.move || `move ${i + 1}`}</span>
              <span>{l.score?.value != null ? (l.score.value > 0 ? `+${(l.score.value / 100).toFixed(2)}` : (l.score.value / 100).toFixed(2)) : ''} · depth {l.depth}</span>
            </div>
          ))}
        </div>
      </div>
      </>}
      {isInstructor && (
        <div className="live-chat-tabbody" style={{ display: panelSection === 'pgn' ? 'block' : 'none' }}>
          <CourseFilesPanel asMobilePanel={false} hideHeader />
        </div>
      )}
      <div
        className="live-v2-activity-resize"
        onPointerDown={startPanelDrag}
        onDoubleClick={resetPanelWidth}
        title="Drag to resize - double-click to reset"
      >⠿</div>
    </div>
  );

  return (
    <div className="cp-ink-all">
      <div className="live-room live-room-v2">
        <header className="live-room-header">
          <div className="live-room-header-left">
            <span className="live-live-indicator">
              <span className="live-dot live-dot-on" />
              <span className="live-live-text">LIVE</span>
            </span>
            <input className="live-room-title live-v2-title-input" aria-label="Class title" value={titleDraft} onChange={(e) => setTitleDraft(e.target.value)} onBlur={saveTitle} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
            {subtitle ? <span className="live-room-subtitle">{subtitle}</span> : null}
          </div>
          <div className="live-room-header-right">
            <button type="button" className="live-chip" onClick={() => { try { localStorage.setItem(`classroomMode:${user?.id || 'user'}`, 'classic'); } catch {} navigate(`/live-class/${classId}`); }}>Classic | V2</button>
            <span className="live-meta-chip live-conn-chip" title="Realtime status">
              <span className={`live-dot ${connection === 'connected' ? 'live-dot-on' : 'live-dot-warn'}`} />
              <span className="live-conn-text">{connection === 'connected' ? 'Connected' : connection}</span>
            </span>
            <span className="live-meta-chip live-count-chip" title="People in the room">👥 {inRoomCount}</span>
            <span className={`live-meta-chip ${timerUrgent ? 'live-count-chip live-count-chip-danger' : ''}`} title="Class ends at ...">
              ⏱ {label ?? '--:--'}
            </span>
            <button type="button" className="live-chip live-icobtn live-v2-header-history" onClick={() => setActivityTab('moves')} title="Move history">◷</button>
            <button type="button" className="live-chip live-icobtn live-v2-file-button" onClick={() => setPanelSection('pgn')} title="Open the PGN Library">📁 <span>Load PGNs</span></button>
            <button type="button" className="live-chip live-icobtn live-v2-header-settings" onClick={() => fireBoardTool('setup')} title="Board settings">⚙</button>
            <button type="button" className="live-chip live-icobtn live-v2-header-settings" onClick={() => fireBoardTool('swap')} title="Swap colors">⇄</button>
            <button type="button" className="live-chip live-count-chip-danger live-v2-end-btn" onClick={handleEnd}>✕ End Classroom</button>
            <div className="live-menu-wrap" ref={menuRef}>
              <button type="button" ref={menuBtnRef} className={`live-chip live-menu-btn ${menuOpen ? 'live-chip-on' : ''}`} aria-haspopup="true" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)} title="More">⋯</button>
            </div>
            <button type="button" variant="secondary" size="sm" onClick={handleLeave}>← Leave</button>
          </div>
        </header>

        <div className="live-room-desktop">
          <div className="live-room-main live-room-main-single">
            <div className="live-board-col">
              <div className="live-v2-boardrow">
                {evalVisible && <EvalBar evaluation={evalInfo?.evaluation} mate={evalInfo?.mate} orientation="white" height="100%" showLabel />}
                <PuzzleDrillArea />
              </div>
            </div>
          </div>
          <div className="live-room-side">
            <div className="live-chat-col" style={{ width }}>{activityPanel}</div>
          </div>
        </div>

        {isInstructor && extendOpen && remainingMs != null && createPortal(
          <div className="live-extend-overlay" role="dialog" aria-modal="true" aria-label="Class ending soon">
            <div className="live-extend-card">
              <div className="live-extend-head">
                <span className="live-extend-title">Class ends in {label}</span>
                <button type="button" className="live-extend-x" onClick={() => { setExtendOpen(false); dismissedAtRef.current = remainingMs; }} aria-label="Close">✕</button>
              </div>
              <p className="live-extend-sub">Extend it so the lesson isn't cut off.</p>
              <div className="live-extend-actions">
                {[10, 15, 30, 60].map((m) => (
                  <button key={m} type="button" className="live-chip" onClick={() => handleExtend(m)}>+{m} min</button>
                ))}
              </div>
              <div className="live-extend-custom">
                <input type="number" min={1} max={240} defaultValue={10} id="live-extend-minutes" className="live-extend-input" aria-label="Custom minutes" />
                <button type="button" className="btn-primary" onClick={() => { const el = document.getElementById('live-extend-minutes'); handleExtend(el?.value ? Number(el.value) : 10); }}>Extend</button>
              </div>
            </div>
          </div>, document.body
        )}

        {menuOpen && createPortal(
          <>
            <div className="live-menu-backdrop" onClick={() => setMenuOpen(false)} />
            <div className="live-menu" ref={menuPanelRef}>
              <span className="live-menu-row">👥 {inRoomCount} in class</span>
              <button type="button" className="live-menu-row live-menu-act" onClick={() => { fireBoardTool('playbot'); setMenuOpen(false); }}>🤖 Play Bot</button>
              <button type="button" className="live-menu-row live-menu-act" onClick={() => { setPairingOpen(true); setMenuOpen(false); }}>⚔ Battle</button>
              <button type="button" className="live-menu-row live-menu-act" onClick={() => { navigate('/classroom/board-vision'); setMenuOpen(false); }}>👁 Board Vision</button>
              <button type="button" className="live-menu-row live-menu-act" onClick={() => { fireBoardTool('bestmove'); setMenuOpen(false); }}>🧠 Best Move</button>
              <div className="live-v2-nav-menu"><button type="button" className="live-menu-row live-menu-act" onClick={() => fireBoardTool('start')}>⏮ Start</button><button type="button" className="live-menu-row live-menu-act" onClick={() => fireBoardTool('first')}>◀ First</button><button type="button" className="live-menu-row live-menu-act" onClick={() => fireBoardTool('prev')}>‹ Prev</button><button type="button" className="live-menu-row live-menu-act" onClick={() => fireBoardTool('next')}>Next ›</button><button type="button" className="live-menu-row live-menu-act" onClick={() => fireBoardTool('last')}>Last ▶</button></div>
              <button type="button" className="live-menu-row live-menu-act" onClick={() => { setClassroomSetting('evalVisible', !evalVisible); }}>◧ {evalVisible ? 'Hide' : 'Show'} Eval Bar</button>
              <button type="button" className="live-menu-row live-menu-act" onClick={() => setClassroomSetting('recording', !recording)}>⏺ {recording ? 'Stop' : 'Record'} Class</button>
              <button type="button" className="live-menu-row live-menu-act" onClick={() => { setClassroomSetting('locked', !classMeta?.boardLocked); }}>🔒 {classMeta?.boardLocked ? 'Unlock' : 'Lock'} board</button>
              <button type="button" className="live-menu-row live-menu-act" onClick={() => { setClassroomSetting('hidden', !classMeta?.boardHidden); }}>◉ {classMeta?.boardHidden ? 'Show' : 'Hide'} board to students</button>
              <button type="button" className="live-menu-row live-menu-act" onClick={() => { fireBoardTool('setup'); setMenuOpen(false); }}>⚙ Set Up Position</button>
              <button type="button" className="live-menu-row live-menu-act" onClick={() => { fireBoardTool('position'); setMenuOpen(false); }}>⎘ Load PGN / FEN / Study</button>
              <button type="button" className="live-menu-row live-menu-act" onClick={() => { setPanelSection('pgn'); setMenuOpen(false); }}>📚 Load PGNs</button>
              <button type="button" className="live-menu-row live-menu-act" onClick={() => fireBoardTool('coordinates')}>▦ Show Coordinates</button>
              <button type="button" className="live-menu-row live-menu-act" onClick={() => fireBoardTool('illegal')}>⚠ Illegal Moves On/Off</button>
              <button type="button" className="live-menu-row live-menu-act" onClick={() => fireBoardTool('sound')}>🔊 Board Sound On/Off</button>
              <button type="button" className="live-menu-row live-menu-act" onClick={() => fireBoardTool('flip')}>⇅ Flip board</button>
              <button type="button" className="live-menu-row live-menu-act" onClick={() => { setMenuOpen(false); handleEnd(); }}>✕ End Classroom</button>
              <button type="button" className="live-menu-row live-menu-act" onClick={() => { setMenuOpen(false); handleLeave(); }}>← Leave</button>
            </div>
          </>,
          document.body
        )}

        {pairingOpen && <PairPlayersModal classId={classId} students={(participants || []).filter((p) => p.status !== 'left' && p.roleInClass === 'student')} onClose={() => setPairingOpen(false)} onStarted={() => setPairingOpen(false)} />}
      </div>
    </div>
  );
}
