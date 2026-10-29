import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { Page, Spinner } from '../components/ui';
import Button from '../components/Button';
import { useAuth } from '../context/AuthContext';
import { notificationTarget } from '../utils/notificationRoutes';

const ICONS = {
  message: '💬', group_message: '💬', chat_reaction: '😀', match_request: '⚔️',
  assignment: '✏️', homework: '📋', puzzle: '♞', quiz: '📝', tournament: '🏆',
  announcement: '📢', certificate: '🏅', class: '📹', lesson: '📹', review: '♟',
};

function timeAgo(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const mins = Math.max(0, Math.floor((Date.now() - d.getTime()) / 60000));
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
}

/**
 * Notifications page — the fallback destination for any notification the
 * type/title routing cannot place on a feature page. Tapping a row marks it
 * read and follows the same routing map the bell popups use.
 */
export default function Notifications() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    api.get('/notifications', { cache: false })
      .then((res) => setItems(Array.isArray(res.data) ? res.data : []))
      .catch((err) => setError(err.response?.data?.message || 'Failed to load notifications'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  function open(n) {
    if (!n.is_read) {
      api.put(`/notifications/${n.id}/read`, {}).catch(() => {});
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)));
    }
    const target = notificationTarget(n, user);
    if (target?.to) navigate(target.to, target.state ? { state: target.state } : undefined);
  }

  function markAll() {
    api.put('/notifications/read-all', {}).catch(() => {});
    setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
  }

  const unread = items.filter((n) => !n.is_read).length;

  return (
    <Page piece="🔔" title="Notifications" sub="Everything the academy has sent you">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <p className="text-xs text-ivory-500">
          {items.length} total · <span className={unread ? 'text-gold-400 font-semibold' : ''}>{unread} unread</span>
        </p>
        <div className="flex items-center gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={load}>Refresh</Button>
          <Button type="button" variant="primary" size="sm" onClick={markAll} disabled={unread === 0}>
            Mark all read
          </Button>
        </div>
      </div>

      {loading ? (
        <Spinner />
      ) : error ? (
        <div className="chess-card text-center py-10">
          <p className="chess-error">{error}</p>
          <Button onClick={load} variant="secondary" size="sm" className="mt-3">Retry</Button>
        </div>
      ) : items.length === 0 ? (
        <div className="chess-card text-center py-12">
          <span className="block text-5xl mb-3 piece-glyph-spin text-gold-500/40">🔔</span>
          <p className="text-base font-semibold text-ivory-300">You're all caught up.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => open(n)}
              className={`chess-card w-full text-left flex items-start gap-3 ${n.is_read ? 'opacity-75' : ''}`}
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-ivory-700/50 bg-black/[0.04] text-base">
                {ICONS[n.type] || '🔔'}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-ivory-100">{n.title || 'Notification'}</span>
                  {!n.is_read && <span className="h-2 w-2 rounded-full bg-gold-400" aria-label="Unread" />}
                  <span className="ml-auto text-[0.65rem] text-ivory-500">{timeAgo(n.created_at)}</span>
                </span>
                <span className="mt-0.5 block text-xs text-ivory-500">{n.message || ''}</span>
              </span>
              <span className="self-center text-ivory-500" aria-hidden="true">›</span>
            </button>
          ))}
        </div>
      )}
    </Page>
  );
}
