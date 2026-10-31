import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useLiveClass } from '../../context/LiveClassContext';
import { useClassEndTimer } from '../../hooks/useClassEndTimer';
import { homeForRole } from '../../utils/roles';
import { leaveLiveClass } from '../../services/socket';
import PuzzleDrillArea from './PuzzleDrill';
import ChatPanel from './ChatPanel';
import LiveMoveHistory from './LiveMoveHistory';
import ClassroomLeaderboard from './ClassroomLeaderboard';
import ClassroomV2StudentHomework from './ClassroomV2StudentHomework';
import EvalBar from '../EvalBar';
import { searchBest } from '../../utils/engine';

const TABS = [
  ['moves', '♞ Moves'], ['chat', '💬 Chat'], ['students', '👥 Students'],
  ['homework', '📋 Homework'], ['leaderboard', '🏆 Leaderboard'],
];

export default function ClassroomV2Student() {
  const { classMeta, participants, evalVisible, chessState } = useLiveClass();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { label } = useClassEndTimer(classMeta, true);
  const [tab, setTab] = useState('moves');
  const [evalInfo, setEvalInfo] = useState(null);
  useEffect(() => {
    if (!evalVisible || !chessState?.fen) { setEvalInfo(null); return undefined; }
    let live = true;
    searchBest(chessState.fen, { maxDepth: 10, timeMs: 900 }).then((result) => { if (live) setEvalInfo(result); }).catch(() => { if (live) setEvalInfo(null); });
    return () => { live = false; };
  }, [evalVisible, chessState?.fen]);
  const title = classMeta?.title || 'Live Chess Class';
  const classmates = useMemo(() => (participants || []).filter((p) => p.roleInClass !== 'host' && p.status !== 'left'), [participants]);
  const leave = () => {
    if (!window.confirm('Leave this class?')) return;
    leaveLiveClass(classMeta?.id);
    navigate(homeForRole(user?.role), { replace: true });
  };
  const boardTools = (
    <div className="cv2-student-tools">
      <button type="button" className="live-chip" onClick={() => window.dispatchEvent(new Event('classroom-v2:flip'))}>⇅ Flip board</button>
      <label><input type="checkbox" defaultChecked onChange={() => window.dispatchEvent(new Event('classroom-v2:coordinates'))} /> Coordinates</label>
      <label><input type="checkbox" defaultChecked onChange={() => window.dispatchEvent(new Event('classroom-v2:sound'))} /> Board sound</label>
    </div>
  );
  return (
    <main className="cv2-shell">
      <header className="cv2-header">
        <div><span className="live-live-indicator"><span className="live-dot live-dot-on" /> LIVE</span><h1>{title}</h1><p>{classMeta?.instructorName ? `Coach ${classMeta.instructorName}` : 'Your instructor'}</p></div>
        <div className="cv2-header-actions"><button type="button" className="live-chip" onClick={() => { try { localStorage.setItem(`classroomMode:${user?.id || 'user'}`, 'classic'); } catch {} navigate(`/live-class/${classMeta?.id}`); }}>Classic | V2</button><span className="cv2-timer">⏱ {label || '--:--'}</span><button type="button" className="live-chip" onClick={leave}>← Leave class</button></div>
      </header>
      <div className="cv2-layout cv2-student-layout">
        <section className="cv2-board-area" aria-label="Shared classroom chessboard">
          <div className="cv2-turn">{chessState?.currentTurn === 'b' ? 'Black to move' : 'White to move'}<span /></div>
          <div className="cv2-boardrow">{evalVisible && <EvalBar evaluation={evalInfo?.evaluation} mate={evalInfo?.mate} orientation="white" height="100%" showLabel />}<div><PuzzleDrillArea /></div></div>
          {boardTools}
        </section>
        <section className="cv2-panel">
          <div className="cv2-panel-title"><strong>Classroom Activity</strong><span>{classmates.length} students</span></div>
          <nav className="cv2-tabs" aria-label="Classroom tabs">{TABS.map(([key, label]) => <button key={key} type="button" className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{label}{key === 'students' ? ` (${classmates.length})` : ''}</button>)}</nav>
          <div className="cv2-tab-content">
            {tab === 'moves' && <LiveMoveHistory asMobilePanel={false} hideHeader />}
            {tab === 'chat' && <ChatPanel asMobilePanel={false} panelVisible hideHeader tabOverride="chat" onTabChange={setTab} />}
            {tab === 'students' && <ul className="cv2-roster">{classmates.map((p) => <li key={p.userId}><span className={`live-dot ${p.status === 'active' ? 'live-dot-on' : ''}`} />{p.name || `Student ${p.userId}`}<small>{p.status === 'active' ? 'online' : 'offline'}</small></li>)}</ul>}
            {tab === 'homework' && <ClassroomV2StudentHomework />}
            {tab === 'leaderboard' && <ClassroomLeaderboard asMobilePanel={false} />}
          </div>
        </section>
      </div>
    </main>
  );
}
