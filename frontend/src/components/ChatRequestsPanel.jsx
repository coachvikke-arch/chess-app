import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { on } from '../services/socket';
import Button from './Button';
import { useToast } from './Toast';
import {
  listChatRequestInbox,
  approveChatRequest,
  cancelChatRequest,
} from '../utils/chatRequests';
import {
  listMyAdminChatRequests,
  acceptAdminChatRequest,
  cancelAdminChatRequest,
} from '../utils/chatAdminRequests';

/** The one place a coach answers a chat request.
 *
 * WHY IT IS A SECTION AND NOT A ROW BUTTON
 * An ask can be decided from exactly one surface. The People rows used to carry
 * Accept/Cancel beside the learner, and the coach's request queue carries them too,
 * so the same ask had two buttons in two places and a coach who used the row's could
 * then be looking at another coach's row. The rows now show only what the ask is
 * waiting on; the decision is here, one row per ask, with the two outcomes the flow
 * allows.
 *
 * WHY BOTH QUEUES
 * Two tables hold the academy's asks and neither contains the other: a learner↔learner
 * pairing is decided on the peer queue (`chat_requests`, where the recorded approvers
 * are the two students' coaches), and a learner↔their-own-coach ask is a row of
 * `chat_admin_requests` with exactly one named decider. A coach who only saw one of
 * them would silently never answer the other.
 *
 * The lists are the server's own — /chat-requests/inbox returns the asks this account
 * is a recorded decider on, and /chat-admin-requests returns the asks named on it (or
 * all of them for the academy owner). Nothing is filtered by role here.
 */
export default function ChatRequestsPanel() {
  const { user } = useAuth();
  const isStaff = user?.role === 'admin' || user?.role === 'superadmin';
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(null);
  const { showToast } = useToast();

  const load = useCallback(async () => {
    if (!isStaff) { setItems([]); return; }
    const [peer, adminSide] = await Promise.all([
      listChatRequestInbox('pending').catch(() => ({ requests: [] })),
      listMyAdminChatRequests('pending').catch(() => ({ requests: [] })),
    ]);
    setItems([
      /* A learner asking a classmate has to name BOTH of them, or the coach is left
         looking at two identical "New chat request" rows and has to open each one. */
      ...(peer.requests || []).map((r) => ({
        key: `peer-${r.id}`,
        id: r.id,
        who: r.requesterName,
        text: `${r.requesterName} wants to chat with ${r.targetName}`,
        accept: approveChatRequest,
        decline: cancelChatRequest,
      })),
      /* A learner asking their own coach is a pair, not a third person: from here the
         asker is whoever else is in the room. */
      ...(adminSide.requests || []).filter((r) => r.canDecide).map((r) => ({
        key: `admin-${r.id}`,
        id: r.id,
        who: r.studentName,
        text: `${r.studentName} wants to chat with you`,
        accept: acceptAdminChatRequest,
        decline: cancelAdminChatRequest,
      })),
    ]);
  }, [isStaff]);

  useEffect(() => { load(); }, [load]);

  /* One listener per queue, plus the plain bell: an ask that arrives while this panel
     is open has to appear without the 15s poll, and one that another coach answered has
     to leave. */
  useEffect(() => {
    if (!isStaff) return undefined;
    const offs = [
      on('chat_request', load),
      on('admin_chat_request', load),
      on('notification', load),
    ];
    return () => offs.forEach((off) => off?.());
  }, [isStaff, load]);

  if (items.length === 0) return null;

  const decide = (item, call, failure) => {
    setBusy(item.key);
    Promise.resolve(call(item.id))
      .then(load)
      /* Re-reading the contacts is the coach's own repaint, and the requester's comes
         from the socket push the endpoint sends. Both are needed: without this the
         row next door still reads "Their request". */
      .catch((err) => showToast(err?.response?.data?.message || failure, { tone: 'error' }))
      .finally(() => setBusy(null));
  };

  return (
    <div className="border-b border-ivory-700/40 bg-slate-100/70">
      <p className="px-4 pt-3.5 pb-1 text-[11px] font-bold uppercase tracking-wider text-ivory-500">
        Requests · {items.length}
      </p>
      <ul className="px-3 pb-3">
        {items.map((item) => (
          <li key={item.key}
            className="mt-1.5 flex items-center gap-2 rounded-xl border border-ivory-700/40 bg-ink-900 px-3 py-2.5">
            <p className="min-w-0 flex-1 text-sm font-semibold text-ivory-300">
              {item.text}
            </p>
            <span className="flex shrink-0 items-center gap-1.5">
              <Button type="button" variant="primary" size="sm"
                disabled={busy === item.key}
                aria-label={`Accept ${item.who}'s chat request`}
                onClick={() => decide(item, item.accept, 'Could not accept this request.')}>
                {busy === item.key ? '…' : 'Accept'}
              </Button>
              <Button type="button" variant="secondary" size="sm"
                disabled={busy === item.key}
                aria-label={`Cancel ${item.who}'s chat request`}
                onClick={() => decide(item, item.decline, 'Could not cancel this request.')}>
                Cancel
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
