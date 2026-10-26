import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { Page, Chip, Reveal } from '../components/ui';

const LEVEL_ICONS = { Beginner: '♙', Intermediate: '♘', Advanced: '♞', 'Fide Rated': '♕' };

export default function Courses() {
  const [courses, setCourses] = useState([]);

  useEffect(() => {
    api.get('/courses').then((res) => setCourses(res.data)).catch(() => {});
  }, []);

  return (
    <Page title="Our Courses" piece="♗" sub="Choose your path — from first move to first master point.">
      <div className="grid md:grid-cols-3 gap-6">
        {courses.map((c, i) => (
          <Reveal key={c.id} delay={i * 0.1}>
            <Link to={`/courses/${c.id}`}
              className="chess-card chess-card-hover block overflow-hidden !p-0 h-full group">
              <div className="h-36 bg-[radial-gradient(circle_at_30%_30%,rgba(96,165,250,0.22),transparent_60%),linear-gradient(135deg,#1c2822,#0e1613)] flex items-center justify-center relative overflow-hidden">
                <div className="absolute inset-0 opacity-[0.15] bg-[repeating-conic-gradient(rgba(243,234,219,0.3)_0%_25%,transparent_0%_50%)] bg-[length:28px_28px]" />
                <span className="text-6xl text-gold-400 piece-glyph-spin group-hover:scale-125 transition-transform">
                  {LEVEL_ICONS[c.level] || '♟'}
                </span>
              </div>
              <div className="p-5">
                <Chip tone="gold">{c.level}</Chip>
                <h2 className="font-display font-semibold text-lg mt-2 text-ivory-100 group-hover:text-gold-400 transition">{c.title}</h2>
                <p className="text-sm text-ivory-500 mt-2 line-clamp-3">{c.description}</p>
                <span className="chess-link text-xs mt-3 inline-block">Enter course →</span>
              </div>
            </Link>
          </Reveal>
        ))}
        {courses.length === 0 && (
          <div className="chess-card md:col-span-3">
            <p className="chess-empty">
              <span className="block text-4xl mb-2 piece-glyph-spin">♟</span>
              No courses published yet — check back soon.
            </p>
          </div>
        )}
      </div>
    </Page>
  );
}