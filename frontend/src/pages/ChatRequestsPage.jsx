import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useChat } from '../context/ChatContext';
import { coachNamesFrom } from '../utils/coachNames';
import { onNotification } from '../services/socket';
import {
  listChatRequestInbox,
  listAllChatRequests,
  approveChatRequest,
  rejectChatRequest,
  cancelChatRequest,
  getChatRequest,
  CHAT_REQUEST_STATUSES,
  STATUS_BADGE_CLASS,
  statusLabel,
  formatDateTime,
} from '../utils/chatRequests';
import Button from '../components/Button';
import Pagination, { PAGE_SIZE } from '../components/Pagination';
import { usePagination } from '../hooks/usePagination';

/* Coach-approval queue for chat requests.
 *
 * ONE QUEUE, SHARED BY THREE ROLES, because this app has no separate coach role:
 * a coach IS an 'admin', and 'superadmin' is the academy owner. The same list is
 * shown to all three:
 *   - the REQUESTING student's primary coach  (the admin who sent the student)
 *   - the TARGETING student's primary coach   (the admin who owns the other student)
 *   - superadmin                              (academy oversight)
 *
 * All three see who gave the request to whom, and all three may APPROVE or REJECT
 * it - first action wins. Anyone accountable for either student can therefore stop
 * a request, and no admin can wave through a pairing a colleague objects to.
 *
 * The panel is snapshotted per request, so it is read from the request record and
 * NOT from the viewer's role: an admin who is not on the panel for a given request
 * sees no buttons at all, even though the page is the same for everybody. That is
 * what every card's `request.canDecide` comes from the server for. */

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'cancelled', label: 'Cancelled' },
];

/** Statuses that still describe a chat somebody could stop. */
const CANCELLABLE = ['pending', 'approved'];

/** Status chip using the app's existing chess-chip vocabulary. */
function StatusBadge({ status }) {
  const cls =
    status === 'approved' ? 'chess-chip-green'
    : status === 'rejected' ? 'chess-chip-red'
    : status === 'pending' ? 'chess-chip-amber'
    : 'chess-chip';
  return <span className={`chess-chip ${cls}`}>{statusLabel(status)}</span>;
}

/** Admin id suffix, so oversight can name the exact account that decided. */
function decidedBySuffix(userId) {
  return userId != null ? ` (ID ${userId})` : '';
}

/**
 * Confirmation for cancelling a chat.
 *
 * Separate from ConfirmDialog because the decision is materially different: it
 * can end a LIVE conversation (the request may already be approved and the two
 * users may be mid-thread), so it names both people, spells out that messaging
 * stops immediately, and collects an optional reason that is stored on the
 * request and written to the audit log.
 */
function CancelChatDialog({ request, busy, error, onClose, onConfirm }) {
  const [reason, setReason] = useState('');
  const confirmRef = useRef(null);

  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const wasApproved = request.status === 'approved';

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal-backdrop)] grid place-items-center bg-black/70 p-4"
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cancel-chat-title"
        className="w-full max-w-md rounded-2xl border border-ivory-700/60 bg-ink-800 p-5 shadow-xl"
      >
        <h3 id="cancel-chat-title" className="font-display text-lg font-bold text-ivory-100">
          Cancel this chat between {request.requesterName} and {request.targetName}?
        </h3>
        <p className="mt-2 text-sm text-ivory-300">
          They will no longer be able to message each other.
        </p>
        {wasApproved && (
          <p className="mt-2 text-sm text-amber-300/90">
            This chat is already approved, so messaging stops immediately. The existing
            history is kept for coach and admin review.
          </p>
        )}

        <label className="mt-4 block text-xs font-bold uppercase tracking-wide text-ivory-500">
          Reason <span className="font-normal normal-case">(optional)</span>
        </label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          rows={3}
          placeholder="Why is this chat being cancelled?"
          className="chess-input mt-1.5 w-full resize-none text-sm"
        />

        {/* The dialog stays open on failure: the server may refuse because the
            chat was decided a moment ago, which is something the user has to be
            able to read before trying again. */}
        {error && (
          <p role="alert" className="mt-2 text-xs text-red-300">{error}</p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button
            type="button"
            onClick={onClose}
            disabled={busy}
            variant="secondary" size="sm" className="px-3 py-1.5 text-xs"
          >
            Keep chat
          </Button>
          <Button
            ref={confirmRef}
            type="button"
            onClick={() => onConfirm(reason)}
            disabled={busy}
            variant="danger" size="sm"
          >
            {busy ? 'Working…' : 'Yes, cancel chat'}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * "Cancel chat" plus its confirmation, in one self-contained control.
 *
 * Rendered in two places - the card's action row and inside the detail panel -
 * so it must own its own dialog state, and it must never be mounted when the
 * server did not authorise it.
 *
 * `canCancel` is the server's answer for THIS viewer on THIS request, not a
 * client-side guess about roles. A coach on the panel may cancel any chat; a
 * student may cancel only their own; everyone else sees no button, and would get
 * a 403 if the markup were forged.
 */
function CancelChatControl({ request, onCancelled, size = 'sm' }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const allowed =
    request?.canCancel === true && CANCELLABLE.includes(request?.status);
  if (!allowed) return null;

  const confirm = async (reason) => {
    setBusy(true);
    setError(null);
    try {
      await cancelChatRequest(request.id, reason);
      setOpen(false);
      await onCancelled?.();
    } catch (e) {
      /* Keep the dialog open so the refusal is readable, and drop the stale
         `canCancel` so the button cannot be pressed into the same 409 again. */
      setError(e.response?.data?.message || e.message || 'That action failed.');
      if (e.response?.status === 409) await onCancelled?.();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="danger"
        size={size}
        onClick={() => { setError(null); setOpen(true); }}
      >
        Cancel chat
      </Button>
      {open && (
        <CancelChatDialog
          request={request}
          busy={busy}
          error={error}
          onClose={() => setOpen(false)}
          onConfirm={confirm}
        />
      )}
    </>
  );
}

/** One request card. Shows every field the spec asks the coach to see. */
function RequestCard({ request, canDecide, onApprove, onReject, onOpenDetail, onCancelled, hideActions = false }) {
  /* Shared normaliser: shapeRequest sends [{ id, name }] and older rows only
     have the single coachName. */
  const coachNames = coachNamesFrom({
    coach_names: request.coachNames,
    coach_name: request.coachName,
  });

  return (
    <article className="chess-card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display text-base font-bold text-ivory-100 truncate">
              {request.requesterName}
              <span className="text-ivory-500 font-normal"> → </span>
              {request.targetName}
            </h3>
            <StatusBadge status={request.status} />
          </div>

          <dl className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-xs text-ivory-400">
            <div className="flex gap-1.5">
              <dt className="text-ivory-500">Requesting user:</dt>
              <dd className="text-ivory-300">
                {request.requesterName} (ID {request.requesterUserId})
              </dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-ivory-500">Target user:</dt>
              <dd className="text-ivory-300">
                {request.targetName} (ID {request.targetUserId})
              </dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-ivory-500">Reviewed by:</dt>
              <dd className="text-ivory-300">
                {/* Both students&apos; coaches plus Super Admin. Naming the panel is
                    what tells a coach whether they are the one who must answer. */}
                {coachNames.length > 0 ? coachNames.join(', ') : 'No admin available'}
              </dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-ivory-500">Requested:</dt>
              <dd className="text-ivory-300">{formatDateTime(request.createdAt)}</dd>
            </div>
            {request.approvedAt && (
              <div className="flex gap-1.5">
                <dt className="text-ivory-500">Approved:</dt>
                <dd className="text-ivory-300">
                  {formatDateTime(request.approvedAt)}
                  {request.approvedBy
                    ? ` by ${request.approvedBy}${decidedBySuffix(request.approvedByUserId)}`
                    : ''}
                </dd>
              </div>
            )}
            {request.rejectedAt && (
              <div className="flex gap-1.5">
                <dt className="text-ivory-500">Rejected:</dt>
                <dd className="text-ivory-300">
                  {formatDateTime(request.rejectedAt)}
                  {request.rejectedBy
                    ? ` by ${request.rejectedBy}${decidedBySuffix(request.rejectedByUserId)}`
                    : ''}
                </dd>
              </div>
            )}
            {request.cancelledAt && (
              <div className="flex gap-1.5">
                <dt className="text-ivory-500">Cancelled:</dt>
                <dd className="text-ivory-300">
                  {formatDateTime(request.cancelledAt)}
                  {request.cancelledBy
                    ? ` by ${request.cancelledBy}${decidedBySuffix(request.cancelledByUserId)}`
                    : ''}
                </dd>
              </div>
            )}
            {request.cancelReason && (
              <div className="flex gap-1.5">
                <dt className="text-ivory-500">Reason:</dt>
                <dd className="text-ivory-300 whitespace-pre-wrap break-words">{request.cancelReason}</dd>
              </div>
            )}
          </dl>
        </div>

        {/* Suppressed inside the detail panel, where a "Details" button that
            reopens the panel you are already in would be a no-op trap. */}
        {!hideActions && (
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            onClick={() => onOpenDetail(request)}
            variant="secondary" size="sm" className="px-2.5 py-1 text-xs"
          >
            Details
          </Button>
          {/* Approve/Reject are rendered only for the recorded approver, and
              only while the request is still pending. The server re-checks
              both conditions. */}
          {canDecide && request.status === 'pending' && (
            <>
              <Button
                type="button"
                onClick={() => onApprove(request)}
                variant="primary" size="sm" className="px-2.5 py-1 text-xs"
              >
                Accept
              </Button>
              <Button
                type="button"
                onClick={() => onReject(request)}
                variant="danger" size="sm" className="px-2.5 py-1 text-xs"
              >
                Reject
              </Button>
            </>
          )}
          {/* Available for the whole life of the chat - pending AND approved -
              because stopping an existing conversation is exactly the case that
              needs it. Renders nothing unless the server said this viewer may. */}
          <CancelChatControl request={request} onCancelled={onCancelled} />
        </div>
        )}
      </div>
    </article>
  );
}

/** Confirmation dialog. Both decisions are irreversible in the UI, so both ask. */
function ConfirmDialog({ action, request, busy, onCancel, onConfirm }) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  const approving = action === 'approve';
  return (
    <div
      className="fixed inset-0 z-[var(--z-modal-backdrop)] grid place-items-center bg-black/70 p-4"
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onCancel(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className="w-full max-w-md rounded-2xl border border-ivory-700/60 bg-ink-800 p-5 shadow-xl"
      >
        <h3 id="confirm-title" className="font-display text-lg font-bold text-ivory-100">
          {approving ? 'Approve chat request?' : 'Reject chat request?'}
        </h3>
        <p className="mt-2 text-sm text-ivory-300">
          {approving ? (
            <>
              <strong className="text-ivory-100">{request.requesterName}</strong> will be able to
              message <strong className="text-ivory-100">{request.targetName}</strong> immediately,
              and both will be notified.
            </>
          ) : (
            <>
              <strong className="text-ivory-100">{request.requesterName}</strong> will not be able
              to message <strong className="text-ivory-100">{request.targetName}</strong>. They will
              be notified, and may only request again once the re-request rules allow it.
            </>
          )}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button
            type="button"
            onClick={onCancel}
            disabled={busy}
            variant="secondary" size="sm" className="px-3 py-1.5 text-xs"
          >
            Cancel
          </Button>
          <Button
            ref={ref}
            type="button"
            onClick={onConfirm}
            disabled={busy}
            variant={approving ? 'primary' : 'danger'}
            size="sm"
            className="px-3 py-1.5 text-xs"
          >
            {busy ? 'Working…' : approving ? 'Approve' : 'Reject'}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Detail drawer: the request plus the full history for that pair. */
function DetailPanel({ requestId, onClose, onCancelled }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await getChatRequest(requestId));
      setError(null);
    } catch (e) {
      setError(e.response?.data?.message || e.message);
    }
  }, [requestId]);

  useEffect(() => {
    let alive = true;
    getChatRequest(requestId)
      .then((d) => { if (alive) setData(d); })
      .catch((e) => { if (alive) setError(e.response?.data?.message || e.message); });
    return () => { alive = false; };
  }, [requestId]);

  /* After a cancellation the badge has to flip to Cancelled and the new
   * Cancelled by/at/reason lines have to appear in place - so re-read the request
   * rather than patching the copy in memory, and let the list behind refresh too. */
  const reload = useCallback(async () => {
    await load();
    await onCancelled?.();
  }, [load, onCancelled]);

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal-backdrop)] flex justify-end bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Chat request details"
        className="w-full max-w-md h-full overflow-y-auto border-l border-ivory-700/60 bg-ink-800 p-5"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-lg font-bold text-ivory-100">Request details</h2>
          <Button
            type="button"
            onClick={onClose}
            aria-label="Close details"
            variant="secondary" size="sm" className="px-2.5 py-1 text-xs"
          >
            Close
          </Button>
        </div>

        {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
        {!data && !error && <p className="mt-3 text-sm text-ivory-500">Loading…</p>}

        {data && (
          <>
            <RequestCard
              request={data.request}
              hideActions
            />

            {/* The cancel action lives inside the detail panel too, not only on
                the card: "stop this chat" is a decision somebody makes AFTER
                reading who it is between and when it was approved. */}
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-ivory-700/40 pt-4">
              <CancelChatControl
                request={data.request}
                onCancelled={reload}
                size="lg"
              />
              {data.request.status === 'cancelled' && (
                <p className="text-xs text-ivory-500">
                  This chat has ended. A new request can still be sent for the same pair.
                </p>
              )}
            </div>

            <h3 className="mt-6 font-display text-sm font-bold uppercase tracking-wide text-ivory-400">
              History for this pair
            </h3>
            {data.history.length === 0 ? (
              <p className="mt-2 text-sm text-ivory-500">No earlier requests.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {data.history.map((h) => (
                  <li key={h.id} className="rounded-xl border border-ivory-700/40 p-3 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-ivory-300">
                        #{h.id} · {h.requesterName} → {h.targetName}
                      </span>
                      <StatusBadge status={h.status} />
                    </div>
                    <p className="mt-1 text-ivory-500">{formatDateTime(h.createdAt)}</p>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function ChatRequestsPage() {
  const { user } = useAuth();
  const isSuper = user?.role === 'superadmin';
  /* Keep the sidebar badge honest: deciding here settles requests, so refresh
     the pending count right away instead of waiting for the context poll. */
  const { refreshRequestBadge } = useChat();

  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [confirm, setConfirm] = useState(null); // { action, request }
  const [busy, setBusy] = useState(false);
  const [detailId, setDetailId] = useState(null);
  const [flash, setFlash] = useState(null);
  const listTopRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      /* Panel members read the same queue, so there is one endpoint for all three
         roles. Super Admin additionally gets the academy-wide oversight list. Two
         different endpoints, not one endpoint with a role check on the client, so
         the data a user can see is decided server-side. */
      const res = isSuper
        ? await listAllChatRequests({ status, q: search.trim() })
        : await listChatRequestInbox(status === 'all' ? null : status);
      setRequests(res.requests || []);
      setError(null);
    } catch (e) {
      setError(e.response?.data?.message || e.message || 'Failed to load chat requests.');
    } finally {
      setLoading(false);
    }
  }, [isSuper, status, search]);

  /* One effect, not two. An immediate effect plus a debounced one would both
     fire whenever `load` changed - which is every keystroke, because `load`
     depends on `search` - and double-fetch the whole list. */
  useEffect(() => {
    if (!isSuper) { load(); return undefined; }
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [isSuper, load]);

  /* Keep an OPEN queue live.
   *
   * Without this the page only ever fetched on mount, so a coach who left the
   * Chat Requests tab open never saw a request arrive - the bell updated but
   * the queue behind it did not, which reads as "the request never reached the
   * other admins". Three cheap triggers, because each covers a case the others
   * miss: the socket covers a live tab, focus covers a tab that was in the
   * background, and the poll covers a dropped socket connection. */
  useEffect(() => {
    const refresh = () => { load(); };

    // A request notification reaches EVERY approver, so this fires for all of them.
    const offNotification = onNotification(refresh);

    const onFocus = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);

    const poll = setInterval(refresh, 30000);

    return () => {
      offNotification();
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
      clearInterval(poll);
    };
  }, [load]);

  const counts = useMemo(() => {
    const map = { pending: 0, approved: 0, rejected: 0, cancelled: 0 };
    for (const r of requests) if (map[r.status] != null) map[r.status] += 1;
    return map;
  }, [requests]);

  /* A new status tab or search is a different queue, so it starts at page 1.
     Deciding on a request refetches the list; if that empties the current page
     the shared pager falls back to the last page that still has rows. */
  const pager = usePagination(requests, PAGE_SIZE, {
    resetKeys: [status, search],
    scrollRef: listTopRef,
  });

  /* Shared by the card button and the detail panel: re-read the list so the
   * badge becomes Cancelled, and settle the sidebar count, which was counting
   * this request as pending a moment ago. */
  const afterCancel = useCallback(async () => {
    setFlash('Chat cancelled. Both users were notified and can no longer message each other.');
    setError(null);
    await load();
    refreshRequestBadge();
  }, [load, refreshRequestBadge]);

  const runDecision = async () => {
    if (!confirm) return;
    const { action, request } = confirm;
    setBusy(true);
    try {
      if (action === 'approve') await approveChatRequest(request.id);
      else await rejectChatRequest(request.id);
      setFlash(
        action === 'approve'
          ? `Approved. ${request.requesterName} can now message ${request.targetName}.`
          : `Rejected. ${request.requesterName} was notified.`
      );
      setConfirm(null);
      await load();
      refreshRequestBadge();
    } catch (e) {
      setError(e.response?.data?.message || e.message || 'That action failed.');
      setConfirm(null);
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-ivory-100">Chat Requests</h1>
          <p className="mt-1 text-sm text-ivory-400">
            {isSuper
              ? 'Every chat request across the academy. Either student\u2019s coach or a Super Admin can approve or reject.'
              : 'Chat requests between your students. You can approve or reject any request where you are one of the two students\u2019 coaches, and cancel a chat that is still pending or already approved.'}
          </p>
        </div>
        <span className="chess-chip chess-chip-amber">{counts.pending} pending</span>
      </header>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setStatus(f.key)}
              aria-pressed={status === f.key}
              className={[
                'px-3 py-1.5 rounded-lg text-xs font-bold transition',
                status === f.key
                  ? 'bg-gold-500 text-white'
                  : 'bg-slate-100 text-ivory-500 hover:text-ivory-300',
              ].join(' ')}
            >
              {f.label}
            </button>
          ))}
        </div>

        {isSuper && (
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by user or coach…"
            aria-label="Search chat requests by user or coach"
            className="chess-input min-w-0 flex-1 text-sm"
          />
        )}
      </div>

      {flash && (
        <p role="status" className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
          {flash}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      <div ref={listTopRef} className="mt-4 space-y-3">
        {loading && <p className="text-sm text-ivory-500">Loading requests…</p>}

        {!loading && requests.length === 0 && (
          <p className="rounded-xl border border-ivory-700/40 p-6 text-center text-sm text-ivory-500">
            No chat requests{status !== 'all' ? ` with status "${status}"` : ''}.
          </p>
        )}

        {!loading && pager.currentItems.map((r) => (
          <RequestCard
            key={r.id}
            request={r}
            /* Per row, not per role: a coach viewing their History is an observer
               on most of it. Only `canDecide` - the server's answer for THIS viewer
               on THIS request - unlocks Accept/Reject, so the UI can never offer a
               button the API would reject. */
            canDecide={r.canDecide === true}
            onApprove={(request) => setConfirm({ action: 'approve', request })}
            onReject={(request) => setConfirm({ action: 'reject', request })}
            onOpenDetail={(request) => setDetailId(request.id)}
            onCancelled={afterCancel}
          />
        ))}
      </div>

      <Pagination
        currentPage={pager.currentPage}
        totalPages={pager.totalPages}
        totalItems={pager.totalItems}
        onPageChange={pager.setPage}
        itemLabel="requests"
      />

      {confirm && (
        <ConfirmDialog
          action={confirm.action}
          request={confirm.request}
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={runDecision}
        />
      )}
      {detailId && (
        <DetailPanel
          requestId={detailId}
          onClose={() => setDetailId(null)}
          onCancelled={afterCancel}
        />
      )}
    </div>
  );
}

export { CHAT_REQUEST_STATUSES, STATUS_BADGE_CLASS };