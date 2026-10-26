import { useEffect, useState } from 'react';
import api from '../services/api';
import { Page, Card, Chip } from '../components/ui';
import Button from '../components/Button';

export default function Assignments() {
  const [assignments, setAssignments] = useState([]);
  const [answers, setAnswers] = useState({});

  useEffect(() => {
    api.get('/assignments').then((res) => setAssignments(res.data)).catch(() => {});
  }, []);

  async function submit(id) {
    await api.post(`/assignments/${id}/submit`, { answer: answers[id] || '' });
    alert('Assignment submitted!');
  }

  return (
    <Page title="Assignments" piece="♜" sub="Review and submit your homework before the deadline.">
      <div className="space-y-4 max-w-4xl">
        {assignments.map((a) => (
          <Card key={a.id} className="max-w-4xl">
            <div className="flex justify-between items-start gap-4">
              <div>
                <h2 className="font-semibold text-ivory-100">{a.title}</h2>
                <p className="text-sm text-ivory-500 mt-1">{a.description}</p>
              </div>
              <Chip tone="gold">{a.difficulty}</Chip>
            </div>
            {a.due_date && <p className="text-xs text-ivory-500 mt-3 flex items-center gap-1">⚑ Due: {a.due_date}</p>}
            <textarea
              placeholder="Type your answer here…"
              className="chess-input mt-3 resize-none"
              rows={3}
              onChange={(e) => setAnswers({ ...answers, [a.id]: e.target.value })}
            />
            <Button onClick={() => submit(a.id)} variant="primary" size="md" className="!py-2.5 !px-5 mt-3">
              Submit ♟
            </Button>
          </Card>
        ))}
        {assignments.length === 0 && <div className="chess-card"><p className="chess-empty">No assignments yet.</p></div>}
      </div>
    </Page>
  );
}