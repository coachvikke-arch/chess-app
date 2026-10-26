import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLiveClass } from '../../context/LiveClassContext';
import { on } from '../../services/socket';
import { playSound } from '../../utils/sound';
import { isClassJoinSoundEnabled, subscribeClassJoinSound } from '../../utils/classJoinSound';
import {
  appendJoinToast,
  describeJoin,
  pruneJoinToasts,
  JOIN_TOAST_MS,
} from '../../utils/joinToastStack';

/* How often the auto-dismiss sweep runs. Small enough that a card disappears
   promptly after its 4s lifetime, large enough to be free. */
const TICK_MS = 200;

function JoinToastCard({ toast, onDismiss, onHoldStart, onHoldEnd }) {
  return (
    <div
      className="join-toast"
      role="status"
      aria-live="polite"
      onMouseEnter={() => onHoldStart(toast.id)}
      onMouseLeave={() => onHoldEnd(toast.id)}
      onFocus={() => onHoldStart(toast.id)}
      onBlur={() => onHoldEnd(toast.id)}
    >
      <span className="join-toast-avatar" aria-hidden="true">{toast.initial || '?'}</span>
      <div className="join-toast-body">
        <p className="join-toast-title">{toast.title}</p>
        <p className="join-toast-msg">{toast.message}</p>
      </div>
      <button
        type="button"
        className="join-toast-close"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
      >
        ✕
      </button>
    </div>
  );
}

/**
 * "X joined the class" toasts for the live classroom.
 *
 * Driven by the server's single `participant:joined` broadcast, which every
 * client in the room receives - the joiner included. Each client renders it
 * from its own perspective: the joiner reads "You joined <class>", everyone
 * else reads "<name> joined the class". Server-side dedupe (30s per person)
 * means a refresh or reconnect does not raise a second popup, and because the
 * component only listens for join events it never invents one from the initial
 * roster snapshot.
 */
export default function ClassroomJoinToasts() {
  const { user } = useAuth();
  const { classMeta } = useLiveClass();
  const [toasts, setToasts] = useState([]);
  const [soundOn, setSoundOn] = useState(isClassJoinSoundEnabled);

  const seq = useRef(1);
  /* Ids the pointer (or focus) is currently holding, so the sweep leaves them. */
  const held = useRef(new Map()); // id -> heldSince(ms)
  /* The handler must not be torn down and re-added when the sound preference
     changes - that could drop an event mid-flight. Read it through a ref. */
  const soundRef = useRef(soundOn);

  useEffect(() => { soundRef.current = soundOn; }, [soundOn]);
  useEffect(() => subscribeClassJoinSound(setSoundOn), []);

  const dismiss = useCallback((id) => {
    held.current.delete(id);
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const holdStart = useCallback((id) => {
    if (!held.current.has(id)) held.current.set(id, Date.now());
  }, []);

  const holdEnd = useCallback((id) => {
    const start = held.current.get(id);
    held.current.delete(id);
    if (start == null) return;
    /* Push the birth time forward by however long it was held so the card gets
       its full lifetime once the pointer leaves. */
    const paused = Date.now() - start;
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, bornAt: t.bornAt + paused } : t)));
  }, []);

  /* Auto-dismiss sweep: drop everything past its lifetime except held cards. */
  useEffect(() => {
    const timer = setInterval(() => {
      setToasts((prev) => pruneJoinToasts(prev, { isHeld: (id) => held.current.has(id) }));
    }, TICK_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const off = on('participant:joined', (p) => {
      if (!p || p.userId == null) return;
      const isMe = user?.id != null && Number(p.userId) === Number(user.id);
      const { title, message } = describeJoin({
        name: p.name,
        role: p.role,
        className: classMeta?.title,
        isMe,
      });
      const who = String(p.name || '').trim() || '?';
      const entry = {
        id: seq.current++,
        name: who,
        initial: who.charAt(0).toUpperCase(),
        title,
        message,
        mine: isMe,
        bornAt: Date.now(),
      };
      setToasts((prev) => appendJoinToast(prev, entry));
      if (soundRef.current) playSound('good');
    });
    return () => off();
  }, [user?.id, classMeta?.title]);

  if (toasts.length === 0) return null;

  return (
    <div className="join-toast-stack">
      {toasts.map((t) => (
        <JoinToastCard
          key={t.id}
          toast={t}
          onDismiss={dismiss}
          onHoldStart={holdStart}
          onHoldEnd={holdEnd}
        />
      ))}
    </div>
  );
}
