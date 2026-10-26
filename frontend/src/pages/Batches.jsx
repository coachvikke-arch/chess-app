import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { PageHeader, Chip } from '../components/ui';
import Button from '../components/Button';

/* Admin batches (groups) manager: create / rename / assign a coach / delete.
   A batch is what connects a student to group-based classes, attendance and
   the coach(s) listed on reports. */

export function BatchesPanel() {
  const [groups, setGroups] = useState([]);
  const [coaches, setCoaches] = useState([]);
  const [students, setStudents] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [studentSearch, setStudentSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [notes, setNotes] = useState('');
  const [editing, setEditing] = useState(null); // group row being edited

  function load() {
    api.get('/groups').then((res) => setGroups(res.data || [])).catch(() => {});
    api.get('/students/coaches').then((res) => setCoaches(res.data || [])).catch(() => {});
    api.get('/students').then((res) => setStudents(res.data || [])).catch(() => {});
  }

  useEffect(load, []);

  const filteredStudents = students.filter((s) =>
    !studentSearch.trim() ||
    `${s.name} ${s.email} ${s.group_name || ''}`.toLowerCase().includes(studentSearch.trim().toLowerCase())
  );

  function toggleStudent(id) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function closeCreate() {
    setShowCreate(false);
    setName('');
    setDescription('');
    setSelectedIds([]);
    setStudentSearch('');
  }

  async function createBatch(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      const res = await api.post('/groups', { name: name.trim(), description: description.trim() || null });
      const groupId = res.data.id;
      if (selectedIds.length > 0) {
        await Promise.allSettled(
          selectedIds.map((studentId) => api.post('/groups/assign', { studentId, groupId }))
        );
      }
      const notes = `Batch created.${selectedIds.length ? ` ${selectedIds.length} student${selectedIds.length === 1 ? '' : 's'} assigned.` : ''}`;
      closeCreate();
      load();
      setNotes(notes);
    } catch (err) {
      setNotes(err.response?.data?.message || 'Failed to create batch');
    } finally {
      setCreating(false);
    }
  }

  async function saveEdit(e) {
    e.preventDefault();
    if (!editing) return;
    setBusyId(editing.id);
    try {
      await api.put(`/groups/${editing.id}`, {
        name: editing.name,
        description: editing.description,
        coachId: editing.coach_id ? String(editing.coach_id) : null,
      });
      setEditing(null);
      load();
    } catch (err) {
      setNotes(err.response?.data?.message || 'Failed to update batch');
    } finally {
      setBusyId(null);
    }
  }

  async function remove(g) {
    const members = g.student_count || 0;
    if (!confirm(
      members > 0
        ? `Delete batch "${g.name}"? Its ${members} student(s) will be unassigned (their records stay).`
        : `Delete batch "${g.name}"?`
    )) return;
    try {
      await api.delete(`/groups/${g.id}`);
      load();
    } catch (err) {
      setNotes(err.response?.data?.message || 'Failed to delete batch');
    }
  }

  return (
    <>
      <div className="flex justify-end mb-4">
        <div className="flex items-center gap-2">
          {notes && <span className="text-xs text-ivory-500">{notes}</span>}
          <Button onClick={() => setShowCreate(true)} variant="primary" size="md" className="!px-4 !py-2 text-sm">+ New Batch</Button>
        </div>
      </div>

      {groups.length === 0 && (
        <div className="chess-card !p-10 text-center">
          <p className="text-5xl mb-3 text-gold-400">♘</p>
          <p className="text-ivory-300 font-medium mb-1">No batches yet</p>
          <p className="text-sm text-ivory-500 mb-4">
            Create a batch and add students right in the dialog — or assign later from the Students section (Edit details → Batch / Group).
            Classes scheduled to a batch automatically appear on every student's report.
          </p>
          <Button onClick={() => setShowCreate(true)} variant="primary" size="md">+ New Batch</Button>
        </div>
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {groups.map((g) => (
          <div key={g.id} className="chess-card !p-5 flex flex-col">
            {editing?.id === g.id ? (
              <form onSubmit={saveEdit} className="flex flex-col gap-3 flex-1">
                <label className="block">
                  <span className="text-xs text-ivory-500">Name *</span>
                  <input className="chess-input" required value={editing.name}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                </label>
                <label className="block">
                  <span className="text-xs text-ivory-500">Description</span>
                  <input className="chess-input" value={editing.description || ''}
                    onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
                </label>
                <label className="block">
                  <span className="text-xs text-ivory-500">Coach</span>
                  <select className="chess-input" value={editing.coach_id ? String(editing.coach_id) : ''}
                    onChange={(e) => setEditing({ ...editing, coach_id: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">No coach assigned</option>
                    {coaches.map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
                  </select>
                </label>
                <div className="flex gap-2 mt-auto">
                  <Button disabled={busyId === g.id} variant="primary" size="sm" className="!py-2 !px-3 !text-xs flex-1">
                    {busyId === g.id ? 'Saving…' : 'Save'}
                  </Button>
                  <Button type="button" onClick={() => setEditing(null)} variant="secondary" size="sm" className="!py-2 !px-3 !text-xs">Cancel</Button>
                </div>
              </form>
            ) : (
              <>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-display font-semibold text-lg text-ivory-100 leading-tight">{g.name}</h3>
                  <span className="flex items-center gap-2 shrink-0">
                    <button onClick={() => setEditing({ ...g, coach_id: g.coach_id || null })} className="text-ivory-500 hover:text-gold-400 text-sm" title="Edit batch">✎</button>
                    <button onClick={() => remove(g)} className="text-ivory-500 hover:text-red-600 text-sm" title="Delete batch">🗑</button>
                  </span>
                </div>
                <p className="text-sm text-ivory-500 mt-1">{g.description || 'No description'}</p>
                <div className="flex flex-wrap items-center gap-2 mt-3">
                  <Chip tone="green">{g.student_count || 0} student{g.student_count === 1 ? '' : 's'}</Chip>
                  {g.coach_name && <Chip>Coach · {g.coach_name}</Chip>}
                </div>
                <div className="mt-auto pt-4 text-xs text-ivory-500">
                  Created {new Date(g.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="mt-6 text-sm text-ivory-500 leading-relaxed">
        <p>
          <span className="text-gold-400">♘ Batch flows:</span> assign a student to a batch (Students → Edit details),
          schedule a class and pick the batch — or pick individual students — and it shows up on the student&apos;s
          <Link to="/student/dashboard" className="chess-link">dashboard</Link>.
        </p>
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-[var(--z-modal-backdrop)] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={closeCreate}>
          <div className="chess-card w-full max-w-md max-h-[85vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()} style={{ animation: 'board-pop .3s both' }}>
            <div className="flex items-start justify-between mb-1">
              <h3 className="text-base font-bold text-ivory-300">New batch</h3>
              <button onClick={closeCreate} className="text-ivory-500 hover:text-ivory-300 text-xl leading-none" title="Close">✕</button>
            </div>
            <p className="text-xs text-ivory-500 mb-4">A batch groups students together for classes and reporting.</p>
            <form onSubmit={createBatch} className="space-y-3">
              <input required placeholder="Batch name e.g. Beginner Mornings" value={name}
                onChange={(e) => setName(e.target.value)} className="chess-input" />
              <input placeholder="Description (optional)" value={description}
                onChange={(e) => setDescription(e.target.value)} className="chess-input" />
              <div>
                <span className="text-xs text-ivory-500">Add students (optional)</span>
                <input placeholder="Search students…" value={studentSearch}
                  onChange={(e) => setStudentSearch(e.target.value)} className="chess-input mt-1" />
                <div className="mt-1 max-h-44 overflow-y-auto rounded-lg border border-ivory-700/50 bg-black/[0.03] p-2 space-y-0.5">
                  {filteredStudents.length === 0 && (
                    <p className="text-xs text-ivory-500 text-center py-3">No students found.</p>
                  )}
                  {filteredStudents.map((s) => (
                    <label key={s.id} className="flex items-center gap-2 cursor-pointer text-sm text-ivory-300 py-1.5 px-1.5 rounded hover:bg-black/5">
                      <input
                        type="checkbox"
                        className="accent-emerald-500"
                        checked={selectedIds.includes(s.id)}
                        onChange={() => toggleStudent(s.id)}
                      />
                      <span className="truncate">{s.name}</span>
                      {s.group_name && <span className="text-[10px] text-gold-400 shrink-0">in {s.group_name}</span>}
                    </label>
                  ))}
                </div>
                {selectedIds.length > 0 && (
                  <p className="text-xs text-gold-400 mt-1.5">
                    {selectedIds.length} student{selectedIds.length === 1 ? '' : 's'} selected
                  </p>
                )}
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" onClick={closeCreate} variant="secondary" size="md" className="!py-2 !px-4 text-sm">Cancel</Button>
                <Button type="submit" disabled={creating || !name.trim()} variant="primary" size="md" className="!py-2 !px-4 text-sm">
                  {creating ? 'Creating…' : 'Create batch'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

export default function Batches() {
  return (
    <PageHeader title="Batches & Groups" icon="♘" subtitle="Organise students into batches; assign each batch a coach.">
      <BatchesPanel />
    </PageHeader>
  );
}