import { useEffect, useState } from 'react';
import api from '../services/api';
import { PageHeader, Spinner } from '../components/ui';
import { useToast } from '../components/Toast';
import Button from '../components/Button';

/* Authors curate their own shelf: this lists what *I* uploaded, with upload
   and delete. A coach's posts reach only their allocated students; a Super
   Admin's posts reach everyone — that rule lives server-side, so there is no
   audience picker here to misconfigure. */
export default function ManagePerformances() {
  const { showToast } = useToast();
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [photo, setPhoto] = useState(null);
  const [preview, setPreview] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const load = () => {
    api
      .get('/performances', { cache: false })
      .then((res) => { setItems(res.data || []); setError(''); })
      .catch((err) => setError(err.response?.data?.message || 'Could not load performances.'));
  };

  useEffect(load, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const pickPhoto = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast('Please choose an image file.', { tone: 'error', title: 'Photo upload' });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      showToast('Photo must be under 5MB.', { tone: 'error', title: 'Photo upload' });
      return;
    }
    setPhoto(file);
    setPreview(URL.createObjectURL(file));
  };

  const publish = async (e) => {
    e.preventDefault();
    if (!title.trim()) {
      showToast('Give the performance a title first.', { tone: 'error', title: 'Missing title' });
      return;
    }
    setSaving(true);
    try {
      const body = new FormData();
      body.append('title', title.trim());
      body.append('details', details.trim());
      if (photo) body.append('photo', photo);
      await api.post('/performances', body);
      setTitle('');
      setDetails('');
      setPhoto(null);
      setPreview('');
      load();
      showToast('Performance published.', { tone: 'success', title: 'Top Performances' });
    } catch (err) {
      showToast(err.response?.data?.message || 'Publish failed.', { tone: 'error', title: 'Top Performances' });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    if (!window.confirm('Delete this performance? Students will stop seeing it.')) return;
    setDeletingId(id);
    try {
      await api.delete(`/performances/${id}`);
      load();
      showToast('Performance deleted.', { tone: 'success', title: 'Top Performances' });
    } catch (err) {
      showToast(err.response?.data?.message || 'Delete failed.', { tone: 'error', title: 'Top Performances' });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <PageHeader title="Top Performances" icon="🏆" subtitle="Celebrate wins — your posts reach your allocated students">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] items-start">
        <form onSubmit={publish} className="chess-card space-y-3">
          <h2 className="chess-card-title mb-0">
            <span className="chess-card-piece">📸</span>
            <span className="flex-1">New performance</span>
          </h2>
          <label className="block">
            <span className="text-xs text-ivory-500">Title *</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Arjun wins the U-12 district title"
              maxLength={120}
              className="chess-input mt-1"
            />
          </label>
          <label className="block">
            <span className="text-xs text-ivory-500">Details</span>
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="Tournament, prize, score…"
              rows={4}
              maxLength={2000}
              className="chess-input mt-1"
            />
          </label>
          <div>
            <span className="text-xs text-ivory-500">Photo</span>
            <div className="mt-1 flex items-center gap-3">
              <label className="app-btn app-btn--secondary app-btn--md cursor-pointer">
                Choose photo
                <input type="file" accept="image/*" className="hidden" onChange={pickPhoto} />
              </label>
              {preview ? (
                <img src={preview} alt="" className="w-16 h-16 rounded-xl object-cover border border-ivory-700/40" />
              ) : (
                <span className="text-xs text-ivory-500">Optional · under 5MB</span>
              )}
            </div>
          </div>
          <Button disabled={saving} variant="primary" size="md" fullWidth className="w-full !py-2.5 text-sm">
            {saving ? 'Publishing…' : 'Publish performance'}
          </Button>
        </form>

        <div className="min-w-0">
          {error ? (
            <div className="chess-card p-8 text-center">
              <p className="font-semibold text-ivory-100">Couldn’t load performances</p>
              <p className="text-sm text-ivory-500 mt-1">{error}</p>
            </div>
          ) : items === null ? (
            <Spinner text="Loading performances…" />
          ) : items.length === 0 ? (
            <div className="chess-card p-8 text-center">
              <p className="text-4xl mb-3">🏆</p>
              <p className="font-semibold text-ivory-100">Nothing published yet</p>
              <p className="text-sm text-ivory-500 mt-1">Your first celebration will appear here — and on your students’ screens.</p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {items.map((item) => (
                <article key={item.id} className="chess-card overflow-hidden !p-0">
                  {item.image_url ? (
                    <img src={item.image_url} alt="" loading="lazy" className="w-full h-40 object-cover" />
                  ) : (
                    <div className="w-full h-40 grid place-items-center bg-black/[0.04] text-4xl" aria-hidden="true">🏆</div>
                  )}
                  <div className="p-4">
                    <h3 className="font-display font-bold text-ivory-100 leading-snug">{item.title}</h3>
                    {item.details && <p className="mt-1 text-sm text-ivory-500 leading-relaxed whitespace-pre-line">{item.details}</p>}
                    <div className="mt-3 flex items-center justify-between gap-2">
                      <span className="text-xs text-ivory-500">
                        {item.created_at ? new Date(item.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : ''}
                      </span>
                      <Button
                        type="button"
                        onClick={() => remove(item.id)}
                        disabled={deletingId === item.id}
                        variant="danger" size="sm" className="!py-1.5 !px-3 !text-xs"
                      >
                        {deletingId === item.id ? 'Deleting…' : 'Delete'}
                      </Button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    </PageHeader>
  );
}
