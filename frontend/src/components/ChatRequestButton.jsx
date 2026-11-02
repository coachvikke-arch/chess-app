import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getEligibility,
  sendChatRequest,
  cancelChatRequest,
  requestPromptCopy,
} from '../utils/chatRequests';
import { useAuth } from '../context/AuthContext';
import { coachNamesFrom } from '../utils/coachNames';
import Button from './Button';
import Portal from './Portal';

export default function ChatRequestButton({ targetUserId, targetName, size = 'sm', className = '' }) {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [access, setAccess] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const confirmRef = useRef(null);

  const isSelf = user && Number(targetUserId) === Number(user.id);

  const load = useCallback(async () => {
    if (!targetUserId || isSelf) { setLoading(false); return; }
    setLoading(true);
    try {
      setAccess(await getEligibility(targetUserId));
      setError(null);
    } catch (e) {
      setAccess({ state: 'unavailable', canMessage: false, message: 'Could not verify chat permission.' });
      setError(e.response?.data?.message || e.message || 'Could not verify chat permission.');
    } finally {
      setLoading(false);
    }
  }, [targetUserId, isSelf]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!confirming) return;
    confirmRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') setConfirming(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirming]);

  const openConversation = () => {
    const base = user?.role === 'student' ? '/student' : '/admin';
    navigate(`${base}/messages`, { state: { openUserId: Number(targetUserId) } });
  };

  const doSendRequest = async () => {
    setBusy(true);
    setError(null);
    try {
      /* One endpoint for every pair that needs a coach's answer, learner↔learner
         included: the server works out who decides (the asker's coach, with the
         other student's coach copied) and refuses a pairing outside the cohort. */
      await sendChatRequest(targetUserId);
      setNotice('Request sent. Waiting for coach approval.');
      setConfirming(false);
      await load();
    } catch (e) {
      setError(e.response?.data?.message || e.message || 'Could not send the request.');
      await load();
    } finally {
      setBusy(false);
    }
  };

  const withdrawRequest = async () => {
    const id = Number(access?.requestId);
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      await cancelChatRequest(id);
      setNotice('Request cancelled.');
      await load();
    } catch (e) {
      setError(e.response?.data?.message || e.message || 'Could not cancel this request.');
    } finally {
      setBusy(false);
    }
  };

  if (isSelf) return null;

  if (loading) {
    return (
      <span className={`text-xs text-ivory-500 ${className}`}>Checking…</span>
    );
  }

  const state = access?.state || 'none';
  const prompt = requestPromptCopy(state);
  const coachNames = coachNamesFrom({
    coach_names: access?.coachNames,
    coach_name: access?.coachName,
  });
  const coachWhoLabel = coachNames.length > 0 ? ` (${coachNames.join(', ')})` : '';
  const buttonSize = size === 'lg' ? 'md' : 'sm';
  /* The vocabulary is the People row's: an open channel is "Chat", an ask that was
     refused or stopped is asked again with "Request again". */
  const askAgain = state === 'cancelled' || state === 'rejected';
  /* `allowed`, not `canMessage`: /chat-requests/eligibility answers with the
     permission service's own object, where the "may write right now" flag is
     `allowed`. `canMessage` only exists on the People-list rows, so reading it
     here left this branch dead and an already-accepted pair still offered
     "Request chat". */
  if (access?.allowed) {
    return (
      <Button
        type="button"
        onClick={openConversation}
        aria-label={`Open the chat with ${targetName || 'user'}`}
        variant="primary"
        size={buttonSize}
        className={className}
      >
        Chat
      </Button>
    );
  }
  if (state === 'pending') {
    return (
      <div className={className}>
        <span className="flex items-center gap-2">
          <span className="rounded-lg bg-blue-50 px-3 py-2 text-xs font-bold text-gold-500 ring-1 ring-gold-500/25">
            Request sent
          </span>
          {access?.requestId && (
            <Button type="button" variant="secondary" size={buttonSize} disabled={busy}
              aria-label="Cancel this chat request"
              onClick={withdrawRequest}>
              Cancel
            </Button>
          )}
        </span>
        <p className="mt-1 text-xs text-amber-300/90">
          Waiting for your coach&apos;s approval.
        </p>
      </div>
    );
  }

  const blocked = state === 'unavailable';
  const cooldownActive = Boolean(access?.cooldownEndsAt) && access?.canRequest === false;

  return (
    <div className={className}>
      <Button
        type="button"
        disabled={blocked || busy || cooldownActive}
        onClick={() => setConfirming(true)}
        aria-label={`Send a chat request to ${targetName || 'this user'}`}
        variant="primary"
        size={buttonSize}
      >
        {busy ? 'Sending…' : askAgain ? 'Request again' : 'Request chat'}
      </Button>

      {cooldownActive && (
        <p className="mt-1 text-xs text-ivory-400">
          You can send another request after{' '}
          {new Date(access.cooldownEndsAt).toLocaleDateString()}.
        </p>
      )}
      {state === 'rejected' && (
        <p className="mt-1 text-xs font-bold text-red-400">
          ✕ Rejected — your chat request was not approved by the coach.
        </p>
      )}
      {state === 'cancelled' && (
        <p className="mt-1 text-xs text-ivory-300">
          This chat was cancelled. Sending a new request starts a fresh approval.
        </p>
      )}
      {notice && (
        <p role="status" className="mt-1 text-xs text-emerald-300/90">{notice}</p>
      )}
      {error && (
        <p role="alert" className="mt-1 text-xs text-red-300/90">{error}</p>
      )}

      {/* Confirmation before submitting, so a request never leaves without the
          user seeing exactly who it goes to. */}
      {confirming && (
        <Portal>
        <div
          className="fixed inset-0 z-[var(--z-z-modal-backdrop)] grid place-items-center bg-black/70 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setConfirming(false); }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="chatreq-title"
            className="w-full max-w-md rounded-2xl border border-ivory-700/60 bg-ink-800 p-5 shadow-xl"
          >
            <h3 id="chatreq-title" className="font-display text-lg font-bold text-ivory-100">
              {prompt?.title || 'Chat Request Required'}
            </h3>
            <p className="mt-2 text-sm text-ivory-300">
              {prompt?.body}
            </p>
            <p className="mt-2 text-sm text-ivory-400">
              {/* Name every coach who will actually be asked, so the student is
                  never surprised when a coach they did not expect replies. */}
              {coachNames.length > 1 ? 'Your coaches' : 'Your coach'}
              {coachWhoLabel} will be asked to approve this.
            </p>

            <div className="mt-5 flex justify-end gap-2">
              <Button
                type="button"
                onClick={() => setConfirming(false)}
                variant="secondary" size="sm" className="px-3 py-1.5 text-xs"
              >
                Cancel
              </Button>
              <Button
                ref={confirmRef}
                type="button"
                onClick={doSendRequest}
                disabled={busy}
                variant="primary" size="sm" className="px-3 py-1.5 text-xs"
              >
                {busy ? 'Sending…' : 'Send Chat Request'}
              </Button>
            </div>
          </div>
        </div>
        </Portal>
      )}
    </div>
  );
}