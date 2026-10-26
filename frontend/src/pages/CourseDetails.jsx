import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { Chip, Reveal, Spinner } from '../components/ui';
import Button from '../components/Button';
import usePageTitle from '../hooks/usePageTitle';

export default function CourseDetails() {
  const { id } = useParams();
  const { user } = useAuth();
  const [course, setCourse] = useState(null);
  usePageTitle(course?.title || 'Course Details');

  useEffect(() => {
    api.get(`/courses/${id}`).then((res) => setCourse(res.data)).catch(() => {});
  }, [id]);

  async function markComplete(lessonId) {
    await api.post(`/lessons/${lessonId}/complete`);
    alert('Lesson marked as completed!');
  }

  if (!course) return <div className="max-w-4xl mx-auto p-8"><Spinner /></div>;

  return (
    <div className="max-w-4xl mx-auto px-4 py-10" style={{ animation: 'fade-up .6s both' }}>
      <Chip tone="gold">{course.level}</Chip>
      <h1 className="font-display text-4xl font-bold mt-3">
        <span className="chess-gradient-text">{course.title}</span>
      </h1>
      <p className="text-ivory-500 mt-3 text-lg leading-relaxed">{course.description}</p>

      <div className="mt-8 space-y-6">
        {course.modules.map((m, mi) => (
          <Reveal key={m.id} delay={mi * 0.1}>
            <div className="chess-card">
              <h2 className="font-display font-semibold text-xl mb-3 flex items-center gap-2">
                <span className="text-gold-400 piece-glyph-spin">♝</span> {m.title}
              </h2>
              <ul className="divide-y divide-white/10">
                {m.lessons.map((l) => (
                  <li key={l.id} className="py-3 flex items-center justify-between gap-4">
                    <div>
                      <p className="font-medium text-ivory-100">{l.title}</p>
                      {l.description && <p className="text-sm text-ivory-500">{l.description}</p>}
                    </div>
                    {user?.role === 'student' && (
                      <Button onClick={() => markComplete(l.id)} variant="secondary" size="md" className="!py-2 !px-3.5 text-sm">
                        Mark Complete ✓
                      </Button>
                    )}
                  </li>
                ))}
                {m.lessons.length === 0 && <p className="chess-empty text-left !py-3">No lessons yet.</p>}
              </ul>
            </div>
          </Reveal>
        ))}
        {course.modules.length === 0 && (
          <div className="chess-card"><p className="chess-empty">Modules coming soon.</p></div>
        )}
      </div>
    </div>
  );
}