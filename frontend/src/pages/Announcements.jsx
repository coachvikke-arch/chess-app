import { useEffect, useState } from 'react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { Page, Card } from '../components/ui';
import { isAdminRole } from '../utils/roles';
import Button from '../components/Button';

export default function Announcements() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ title: '', message: '' });

  function load() { api.get('/announcements').then((res) => setItems(res.data)).catch(() => {}); }
  useEffect(load, []);

  async function create(e) {
    e.preventDefault();
    try {
      await api.post('/announcements', form);
      setForm({ title: '', message: '' });
      showToast('Announcement posted.', { tone: 'success', title: 'Posted' });
      load();
    } catch {
      showToast('Failed to post announcement.', { tone: 'error', title: 'Post failed' });
    }
  }

  async function remove(id) {
    if (!window.confirm('Delete this announcement? This cannot be undone.')) return;
    try {
      await api.delete(`/announcements/${id}`);
      showToast('Announcement deleted.', { tone: 'success', title: 'Deleted' });
      load();
    } catch {
      showToast('Failed to delete announcement.', { tone: 'error', title: 'Delete failed' });
    }
  }

  return (
    <Page title="Announcements" piece="♚" sub="Regal updates from the coach — read or post them here.">
      <div className="max-w-3xl">
        {isAdminRole(user?.role) && (
          <form onSubmit={create} className="chess-card mb-8">
            <input required placeholder="Title" value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="chess-input mb-3" />
            <textarea required placeholder="Message" value={form.message}
              onChange={(e) => setForm({ ...form, message: e.target.value })} rows={3}
              className="chess-input mb-3 resize-none" />
            <Button variant="primary" size="md">Post Announcement ♔</Button>
          </form>
        )}
        <div className="space-y-3">
          {items.map((a) => (
            <Card key={a.id} className="max-w-3xl relative">
              <p className="font-semibold text-ivory-100 flex items-center gap-2">
                <span className="text-gold-400">♔</span>{a.title}
              </p>
              <p className="text-sm text-ivory-500 mt-1 leading-relaxed">{a.message}</p>
              {isAdminRole(user?.role) && (
                <button
                  onClick={() => remove(a.id)}
                  className="absolute top-3 right-3 text-xs text-red-600/70 hover:text-red-600 transition-colors"
                  title="Delete announcement"
                >
                  ✕
                </button>
              )}
            </Card>
          ))}
          {items.length === 0 && <div className="chess-card"><p className="chess-empty">No announcements yet.</p></div>}
        </div>
      </div>
    </Page>
  );
}
