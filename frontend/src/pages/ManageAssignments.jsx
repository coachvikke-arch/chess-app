import { useEffect, useState } from 'react';
import api from '../services/api';
import { PageHeader, Chip } from '../components/ui';
import Button from '../components/Button';

export default function ManageAssignments() {
  const [assignments, setAssignments] = useState([]);
  const [form, setForm] = useState({ title: '', description: '', dueDate: '', difficulty: 'Medium' });
  const [submissions, setSubmissions] = useState({});
  const [openId, setOpenId] = useState(null);

  function load() {
    api.get('/assignments').then((res) => setAssignments(res.data)).catch(() => { });
  }
  useEffect(load, []);

  async function create(e) {
    e.preventDefault();
    await api.post('/assignments', form);
    setForm({ title: '', description: '', dueDate: '', difficulty: 'Medium' });
    load();
  }

  async function viewSubmissions(id) {
    setOpenId(openId === id ? null : id);
    if (!submissions[id]) {
      const res = await api.get(`/assignments/${id}/submissions`);
      setSubmissions({ ...submissions, [id]: res.data });
    }
  }

  async function grade(submissionId, assignmentId, score) {
    await api.put(`/assignments/submissions/${submissionId}/grade`, { score, approved: true });
    const res = await api.get(`/assignments/${assignmentId}/submissions`);
    setSubmissions({ ...submissions, [assignmentId]: res.data });
  }

  return (
    <PageHeader title="Manage Assignments" icon="♜" subtitle="Set the exercises, then grade your students' submissions.">
      <form onSubmit={create} className="chess-card mb-8 grid md:grid-cols-4 gap-3">
        <input required placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="chess-input" />
        <input placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="chess-input md:col-span-2" />
        <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} className="chess-input" />
        <Button variant="primary" size="md" className="md:col-span-4 md:w-52 justify-self-start">Create Assignment ♜</Button>
      </form>

      <div className="space-y-3">
        {assignments.map((a) => (
          <div key={a.id} className="chess-card">
            <div className="flex justify-between items-center gap-4">
              <div>
                <p className="font-medium text-ivory-100">{a.title}</p>
                <p className="text-sm text-ivory-500">{a.description}</p>
              </div>
              <button onClick={() => viewSubmissions(a.id)} className="chess-link text-sm shrink-0">
                {openId === a.id ? 'Hide' : 'View'} Submissions
              </button>
            </div>
            {openId === a.id && (
              <div className="mt-3 border-t border-ivory-700/50 pt-3 space-y-2" style={{ animation: 'fade-up .4s both' }}>
                {(submissions[a.id] || []).map((s) => (
                  <div key={s.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-ivory-300 truncate">
                      <span className="text-gold-400">♟</span> {s.student_name}: {s.answer?.slice(0, 60)}
                    </span>
                    <input
                      type="number"
                      placeholder="Score"
                      defaultValue={s.score ?? ''}
                      className="chess-input !w-24 !py-1.5 !text-xs shrink-0"
                      onBlur={(e) => grade(s.id, a.id, Number(e.target.value))}
                    />
                  </div>
                ))}
                {(submissions[a.id] || []).length === 0 && <p className="chess-empty text-left !py-2">No submissions yet.</p>}
              </div>
            )}
          </div>
        ))}
        {assignments.length === 0 && <div className="chess-card"><p className="chess-empty">No assignments yet.</p></div>}
      </div>
    </PageHeader>
  );
}