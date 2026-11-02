import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import Button from './Button';
import { useToast } from './Toast';
import { isAdminChannelPair } from '../utils/chatAdminRequests';
import {
  sendAdminChatRequest,
  cancelAdminChatRequest,
} from '../utils/chatAdminRequests';
import {
  sendChatRequest,
  cancelChatRequest,
} from '../utils/chatRequests';

/** The action slot at the right end of a People row.
 *
 * WHY IT READS NOTHING BUT THE SERVER'S FIELDS
 * `chatState`, `canMessage`, `canDecideAdminRequest`, `adminRequestId`,
 * `peerRequestId` and `requestDirection` all come from listContacts. This component
 * never re-derives a permission from a role string, so a row cannot offer a button
 * the API would refuse, and when the coach answers, the socket push re-reads the
 * directory and this slot repaints itself. It holds no request state beyond "a tap
 * is in flight".
 *
 * WHY A COACH GETS NOTHING HERE
 * Answering an ask is not a row action any more: it lives in the Requests panel
 * above the list. Rendering Accept on the row as well would put two buttons on one
 * decision, and a coach who clicked the row's and then the panel's would be looking
 * at two different requests.
 */
export default function PeopleRowAction({ contact, onOpenChat }) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const { showToast } = useToast();

  const run = async (fn, failure, success) => {
    setBusy(true);
    try {
      await fn();
      if (success) showToast(success, { tone: 'success' });
      /* No local state to update: the server pushes the transition to both sides,
         ChatContext re-reads the directory, and this row repaints. */
    } catch (err) {
      showToast(err?.response?.data?.message || failure, { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  /* A channel that is already open is one button deep, not one tap away. */
  if (contact.canMessage) {
    return (
      <Button type="button" variant="primary" size="sm"
        aria-label={`Open the chat with ${contact.name}`}
        onClick={() => onOpenChat(Number(contact.id), contact.name)}>
        Chat
      </Button>
    );
  }

  /* A pending ask a coach or the owner is meant to answer is the Requests panel's
     paperwork — see the header. */
  if (contact.canDecideAdminRequest && contact.adminRequestId) return null;

  const cancel = (call, id, failure) => () => run(() => call(id), failure, null);

  if (isAdminChannelPair(user?.role, contact.role)) {
    const id = Number(contact.adminRequestId);
    if (contact.chatState === 'pending' && id) {
      return (
        <span className="flex shrink-0 items-center gap-1.5">
          <SentLabel />
          <Button type="button" variant="secondary" size="sm" disabled={busy}
            aria-label={`Cancel the chat request to ${contact.name}`}
            onClick={cancel(cancelAdminChatRequest, id, 'Could not cancel this request.')}>
            Cancel
          </Button>
        </span>
      );
    }
    if (contact.chatState === 'none' || contact.chatState === 'cancelled') {
      return (
        <Button type="button" variant="primary" size="sm" disabled={busy}
          aria-label={`Request a chat with ${contact.name}`}
          onClick={() => run(
            () => sendAdminChatRequest(Number(contact.id)),
            'Could not send the request.',
            'Request sent. Your coach will be notified.',
          )}>
          {contact.chatState === 'cancelled' ? 'Request again' : 'Request chat'}
        </Button>
      );
    }
    return null;
  }

  /* ── The peer queue: a classmate ──
   * `requestDirection` is what separates the two halves of one pending row: the
   * learner who filed the ask can take it back, the classmate it was filed against
   * is only waiting. Neither may write yet, which the send gate already enforces. */
  const id = Number(contact.peerRequestId);
  if (contact.chatState === 'pending') {
    if (contact.requestDirection === 'sent' && id) {
      return (
        <span className="flex shrink-0 items-center gap-1.5">
          <SentLabel />
          <Button type="button" variant="secondary" size="sm" disabled={busy}
            aria-label={`Cancel the chat request to ${contact.name}`}
            onClick={cancel(cancelChatRequest, id, 'Could not cancel this request.')}>
            Cancel
          </Button>
        </span>
      );
    }
    return (
      <span className="shrink-0 text-xs font-semibold text-ivory-500 text-right">
        Waiting for<br />your coach
      </span>
    );
  }

  if (['none', 'cancelled', 'rejected'].includes(contact.chatState)) {
    const again = contact.chatState !== 'none';
    return (
      <Button type="button" variant="primary" size="sm" disabled={busy}
        aria-label={`Request a chat with ${contact.name}`}
        onClick={() => run(
          () => sendChatRequest(Number(contact.id)),
          'Could not send the request.',
          'Request sent. Your coach will be notified.',
        )}>
        {again ? 'Request again' : 'Request chat'}
      </Button>
    );
  }

  return null;
}

/* The ask is with the coach, so the row says where it is rather than offering a
   second way to send it. A label, not a disabled button: a greyed-out control
   invites the tap that does nothing. */
function SentLabel() {
  return (
    <span className="shrink-0 rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-bold text-gold-500 ring-1 ring-gold-500/25">
      Request sent
    </span>
  );
}
