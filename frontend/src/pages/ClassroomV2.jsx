import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { homeForRole } from '../utils/roles';
import { LiveClassProvider, useLiveClass } from '../context/LiveClassContext';
import { getJoinToken } from '../services/liveClassApi';
import { leaveLiveClass } from '../services/socket';
import LiveClassSocketBridge from '../components/liveclass/LiveClassSocketBridge';
import ClassroomV2Coach from '../components/liveclass/ClassroomV2Coach';
import ClassroomV2Student from '../components/liveclass/ClassroomV2Student';

const BOOT_LOADING = 'loading';
const BOOT_ERROR = 'error';

function ClassroomV2Room({ socketError }) {
  const { isInstructor } = useLiveClass();
  /* Classroom V2 renders the SAME live class as the Classic room — same classId,
     same socket room, same board/chat state — only the chrome differs. No
     restart, no end, no separate class. */
  if (isInstructor) return <ClassroomV2Coach socketError={socketError} />;
  return <ClassroomV2Student socketError={socketError} />;
}

function ClassroomV2() {
  const params = useParams();
  const id = params.id || params.classId;
  const { user } = useAuth();
  const [boot, setBoot] = useState(null);
  const [status, setStatus] = useState(BOOT_LOADING);
  const [error, setError] = useState('');
  const [socketError, setSocketError] = useState('');

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
  }, [id]);

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
          <button type="button" className="btn-secondary" onClick={() => (window.location.href = homeForRole(user?.role))}>← Back to my classes</button>
        </div>
      </div>
    );
  }

  return (
    <div className="cp-ink-all">
      <LiveClassProvider boot={boot}>
        <LiveClassSocketBridge classId={id} onSocketError={setSocketError} />
        <ClassroomV2Room socketError={socketError} />
      </LiveClassProvider>
    </div>
  );
}

export default ClassroomV2;
