import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import api from '../../services/api';
import { Page, Card, Bar, Spinner } from '../../components/ui';
import academyBase from '../../utils/academyBase';

export default function AcademyLevel() {
  const { levelSlug } = useParams();
  const location = useLocation();
  const base = academyBase(location.pathname);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setData(null);
    setError(null);
    api
      .get(`/academy/levels/${levelSlug}`, { cache: false })
      .then((res) => setData(res.data))
      .catch((err) => {
        const msg = err.response?.data?.message;
        if (err.response?.status === 403) setError({ locked: true, msg });
        else setError({ locked: false, msg: msg || 'Failed to load level' });
      });
  }, [levelSlug]);

  if (error) {
    return (
      <Page title="Academy" piece="♘">
        <Card title={error.locked ? '🔒 Level locked' : 'Something went wrong'}>
          <p className="text-ivory-500">{error.msg || 'Could not load this level.'}</p>
        </Card>
      </Page>
    );
  }
  if (!data) return <Page title="Academy" piece="♘"><Spinner text="Loading level…" /></Page>;

  const { level, lessons } = data;

  return (
    <Page
      title={level.name}
      piece={level.icon}
      sub={level.description}
    >
      <div className="rounded-2xl border border-ivory-700/50 bg-black/[0.03] p-4 mb-6 flex items-center gap-4">
        <div className="flex-1">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="text-ivory-500">
              {level.completedLessons}/{level.totalLessons} lessons complete
            </span>
            <span className="font-semibold text-ivory-500">{level.pct}%</span>
          </div>
          <Bar pct={level.pct} />
        </div>
        <div className="hidden md:block text-center px-5">
          <p className="font-display text-lg font-bold" style={{ color: level.accent }}>
            {level.pct >= 100
              ? '✅ Mastered'
              : /* Staff see the real percentage instead of a "0% to unlock next"
                   target: their unlock was granted by role, not by progress. */
                level.staffPreview
                ? 'Coach access'
                : `${level.neededPct}% to unlock next`}
          </p>
          <p className="text-[0.65rem] uppercase tracking-wider text-ivory-500">Level target</p>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {lessons.map((lesson, i) => (
          <Link key={lesson.slug} to={`${base}/lessons/${level.slug}/${lesson.slug}`} className="group block">
            <div className="rounded-2xl border border-ivory-700/50 bg-black/[0.03] hover:bg-black/[0.06] transition-colors p-4 flex items-center gap-4">
              <span
                className="w-11 h-11 rounded-xl flex items-center justify-center text-2xl shrink-0"
                style={{
                  background: lesson.complete ? `${level.accent}22` : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${lesson.complete ? level.accent + '66' : 'rgba(255,255,255,0.08)'}`,
                }}
              >
                {lesson.complete ? '✅' : lesson.icon}
              </span>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-ivory-300">{lesson.title}</p>
                  {lesson.kind === 'opening' && <ChipSmall>Opening</ChipSmall>}
                  {lesson.kind === 'training' && <ChipSmall>Training</ChipSmall>}
                </div>
                <p className="text-xs text-ivory-500 mt-0.5">
                  {lesson.kind === 'opening'
                    ? 'Learn, follow and practice this opening.'
                    : lesson.kind === 'training'
                      ? 'A timed drilling session to lock in your knowledge.'
                      : `${lesson.exerciseCount} exercise${lesson.exerciseCount === 1 ? '' : 's'}`}
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <Bar pct={lesson.pct} />
                  <span className="text-[0.65rem] text-ivory-500 shrink-0">
                    {lesson.completedExercises}/{lesson.exerciseCount}
                  </span>
                </div>
              </div>

              <span className="text-ivory-500 group-hover:text-gold-400 transition-colors text-xl shrink-0">→</span>
            </div>
          </Link>
        ))}
      </div>
    </Page>
  );
}

function ChipSmall({ children }) {
  return <span className="text-[0.6rem] uppercase tracking-wider font-bold text-gold-400 bg-gold-500/10 border border-gold-500/20 px-2 py-0.5 rounded-full">{children}</span>;
}