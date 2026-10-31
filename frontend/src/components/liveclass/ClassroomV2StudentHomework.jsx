import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';

const FILTERS = ['All', 'MCQ', 'Quiz', 'Play'];

export default function ClassroomV2StudentHomework() {
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState('All');
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  useEffect(() => {
    let active = true;
    api.get('/student/homework', { params: { page: 1, limit: 50 }, cache: false })
      .then((res) => { if (active) setItems(res.data?.items || []); })
      .catch(() => { if (active) setItems([]); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const visible = useMemo(() => items.filter((item) => {
    if (filter === 'All') return true;
    const name = `${item.type || ''} ${item.title || ''} ${item.description || ''}`.toLowerCase();
    return name.includes(filter.toLowerCase());
  }), [items, filter]);
  return <div className="cv2-student-homework">
    <div className="cv2-tabs">{FILTERS.map((name) => <button key={name} type="button" className={filter === name ? 'active' : ''} onClick={() => setFilter(name)}>{name}</button>)}</div>
    {loading ? <p className="cv2-muted">Loading homework…</p> : visible.length === 0 ? <p className="cv2-homework-empty">No homework</p> : <ul className="cv2-homework-list">{visible.map((item) => <li key={item.assignmentId}>
      <div><strong>{item.title}</strong><p>{item.progress?.solved || 0}/{item.progress?.total || item.puzzleCount || 0} completed</p></div>
      <span className={`cv2-homework-status status-${item.status}`}>{String(item.status || 'pending').replace('_', ' ')}</span>
      <button type="button" onClick={() => navigate(`/student/homework/${item.assignmentId}`)}>Open</button>
    </li>)}</ul>}
  </div>;
}
