import { useState } from 'react';
import Button from './Button';
import { useToast } from './Toast';
import {
  sendAdminChatRequest,
  acceptAdminChatRequest,
  cancelAdminChatRequest,
} from '../utils/chatAdminRequests';

/**
 * The action slot of a coach/learner People row - the two ends of the allocated
 * admin request, in one place.
 *
 * WHY IT RENDERS NOTHING BUT RATHER THAN DECIDING ANYTHING
 * Every branch is driven by `contact.chatState` / `contact.adminRequestId` /
 * `contact.canDecideAdminRequest`, all of which come from the server's contacts
 * payload. The row therefore cannot offer an action the API would refuse, and when
 * the coach answers, the socket push re-reads the contacts and both rows repaint
 * themselves - this component holds no request state of its own beyond "a tap is in
 * flight". ChatRequestButton is the peer queue's equivalent; this one is simpler
 * because there is exactly one decider and two outcomes.
 */
export default function AdminChatRequestButton({ contact }) {
  const [busy, setBusy] = useState(false);
  const { showToast } = useToast();

  const run = async (fn, failure) => {
    setBusy(true);
    try {
      await fn();
      /* No local state to update: the server pushes admin_chat_request to both
         sides, ChatContext re-reads the directory, and this row repaints. */
    } catch (err) {
      showToast(err?.response?.data?.message || failure, { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  /* The coach's decision. `canDecideAdminRequest` is only ever true for the admin
     the request was named on, so no role check belongs here. */
  if (contact.canDecideAdminRequest && contact.adminRequestId) {
    const id = Number(contact.adminRequestId);
    return (
      <span className="flex shrink-0 items-center gap-1.5">
        <Button
          type="button"
          variant="primary"
          size="sm"
          disabled={busy}
          aria-label={`Accept chat request from ${contact.name}`}
          onClick={() => run(
            () => acceptAdminChatRequest(id),
            'Could not accept this request.',
          )}
        >
          {busy ? '…' : 'Accept'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={busy}
          aria-label={`Cancel chat request from ${contact.name}`}
          onClick={() => run(
            () => cancelAdminChatRequest(id),
            'Could not cancel this request.',
          )}
        >
          Cancel
        </Button>
      </span>
    );
  }

  /* The student's ask. An accepted or pending pair gets no button: the row itself
     opens the chat, and a pending row already says "Request pending" underneath. */
  if (contact.chatState === 'none' || contact.chatState === 'cancelled') {
    return (
      <Button
        type="button"
        variant="primary"
        size="sm"
        disabled={busy}
        aria-label={`Request chat with ${contact.name}`}
        onClick={() => run(
          () => sendAdminChatRequest(Number(contact.id)),
          'Could not send the request.',
        )}
      >
        {busy ? 'Sending…' : 'Request chat'}
      </Button>
    );
  }

  if (contact.chatState === 'pending') {
    return (
      <Button type="button" variant="primary" size="sm" disabled aria-disabled="true">
        Request pending
      </Button>
    );
  }

  return null;
}
