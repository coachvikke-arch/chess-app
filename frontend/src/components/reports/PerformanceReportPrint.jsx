import { useEffect, useRef } from 'react';
import { exportStudentReportPdf, PRINT_WIDTH_PX } from '../../pages/StudentReportPrint';
import { BarChart } from '../../utils/charts';
import { APP_NAME } from '../../config/brand';

/*
 * Print-only twin of the on-screen Performance Report. It renders the SAME
 * response, in the same order, as print blocks; the PDF exporter captures each
 * block separately and packs them onto A4 pages. The visible report is not
 * touched. Literal colours are used here because html2canvas drops CSS
 * variables — this is the same convention the existing student report print
 * layout follows.
 */

const ordinal = (n) => {
  if (!Number.isInteger(n) || n <= 0) return '';
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] || 'th'}`;
};
const duration = (mins) => {
  const m = Math.max(0, Number(mins) || 0);
  const h = Math.floor(m / 60);
  return h ? `${h}h ${m % 60}m` : `${m}m`;
};
const periodOf = (data) => data.periodLabel || `${data.from} - ${data.to}`;
const fmtDate = (v) => (v ? new Date(`${v}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

function Block({ children }) {
  return <div className="rp-block" data-print-block="" data-print-section="performance">{children}</div>;
}

function Tiles({ tiles }) {
  return (
    <div className="rp-tiles">
      {tiles.map((t) => (
        <div className="rp-tile" key={t.label}>
          <div className="rp-tile-icon" aria-hidden="true">{t.icon}</div>
          <div className="rp-tile-label">{t.label}</div>
          <div className="rp-tile-value">{t.value}</div>
          <div className="rp-tile-sub">{t.sub}</div>
        </div>
      ))}
    </div>
  );
}

function Table({ headers, rows }) {
  return (
    <table className="rp-table">
      <thead><tr>{headers.map((h) => <th key={h}>{h}</th>)}</tr></thead>
      <tbody>
        {rows.map((cells, i) => (
          <tr key={i}>{cells.map((c, j) => <td key={j}>{c}</td>)}</tr>
        ))}
      </tbody>
    </table>
  );
}

export default function PerformanceReportPrint({ job, onDone, onError }) {
  const rootRef = useRef(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current || !job) return;
    ran.current = true;
    const { data, includeRemarks, mode } = job;
    const root = rootRef.current;
    let cancelled = false;

    async function run() {
      await document.fonts?.ready;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (cancelled || !root) return;

      if (mode === 'print') {
        document.body.classList.add('performance-report-printing');
        try {
          window.print();
        } finally {
          document.body.classList.remove('performance-report-printing');
          onDone();
        }
        return;
      }

      const pdf = await exportStudentReportPdf({
        root,
        name: data.student?.name || 'Student',
        sections: [['performance', 'Performance Report']],
        dateStr: periodOf(data),
      });
      if (cancelled) return;
      pdf.save(`Performance_Report_${data.student?.name || 'student'}_${data.from}_to_${data.to}.pdf`.replace(/[^\w\-_.]+/g, '_'));
      onDone();
    }

    run().catch((err) => {
      if (cancelled) return;
      onError?.(err.message || 'Export failed');
      onDone();
    });
    return () => { cancelled = true; };
  }, [job, onDone, onError]);

  if (!job) return null;
  const { data, includeRemarks } = job;
  const { student, from, to, summary, insights, weeklySolved, rating, sessions, quiz, tournaments, remarks } = data;

  return (
    <div id="sr-print-root" ref={rootRef} aria-hidden="true" style={{
      position: 'fixed', left: '-10000px', top: 0, width: PRINT_WIDTH_PX,
      background: '#ffffff', pointerEvents: 'none',
    }}>
      <Block>
        <div className="rp-card">
          <p className="rp-muted" style={{ fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{APP_NAME}</p>
          <h1 className="rp-name" style={{ fontSize: 22 }}>Performance Report</h1>
          <p className="rp-email">{student?.name || ''} · {periodOf(data)}</p>
        </div>
      </Block>

      <Block>
        <div className="rp-card">
          <h3 className="rp-card-title">Summary</h3>
          <Tiles tiles={[
            { icon: '♘', label: 'Classes attended', value: `${summary.classes.attended}/${summary.classes.scheduled}`, sub: `${summary.classes.attendancePct}% attendance` },
            { icon: '⏱', label: 'Learning time', value: duration(summary.learningTimeMinutes), sub: 'total time in class' },
            { icon: '♟', label: 'Quiz puzzles solved', value: `${summary.puzzles.solved}/${summary.puzzles.attempted}`, sub: `${summary.puzzles.solvedPct}% solved · ${summary.puzzles.points} points` },
            { icon: '♛', label: 'Tournaments', value: summary.tournaments.played, sub: summary.tournaments.bestFinish ? `Best finish: ${ordinal(summary.tournaments.bestFinish)}` : 'No ranked finish' },
          ]} />
        </div>
      </Block>

      <Block>
        <div className="rp-card">
          <h3 className="rp-card-title">Insights</h3>
          <Tiles tiles={[
            { icon: '★', label: 'Best topic', value: insights.bestTopic?.topic || '—', sub: insights.bestTopic ? `${insights.bestTopic.solved} solved · ${insights.bestTopic.accuracy}% accuracy` : '' },
            { icon: '♻', label: 'Needs practice', value: insights.needsPractice?.topic || '—', sub: insights.needsPractice ? `${insights.needsPractice.accuracy}% accuracy` : '' },
            { icon: '⚡', label: 'Points per solved puzzle', value: `${insights.pointsPerSolved.value} pts`, sub: `Class average ${insights.pointsPerSolved.classAverage} pts` },
            { icon: '🔥', label: 'Solving streak', value: `${insights.solvingStreak.days} day${insights.solvingStreak.days === 1 ? '' : 's'}`, sub: insights.solvingStreak.from ? `${fmtDate(insights.solvingStreak.from)} - ${fmtDate(insights.solvingStreak.to)}` : '' },
          ]} />
        </div>
      </Block>

      <Block>
        <div className="rp-card">
          <h3 className="rp-card-title">Puzzles solved per week</h3>
          <BarChart items={weeklySolved} height={150} color="#60a5fa" />
        </div>
      </Block>

      <Block>
        <div className="rp-card">
          <h3 className="rp-card-title">Rating progress</h3>
          <div className="rp-kv"><span>Start</span><span>{rating.start}</span></div>
          <div className="rp-kv"><span>Now</span><span>{rating.end}</span></div>
          <div className="rp-kv"><span>Change</span><span>{rating.change > 0 ? '+' : ''}{rating.change}</span></div>
          <div className="rp-kv"><span>Leaderboard rank</span><span>{rating.rank ?? '—'}</span></div>
        </div>
      </Block>

      <Block>
        <div className="rp-card">
          <h3 className="rp-card-title">Sessions</h3>
          <p className="rp-muted">Completed classes this student was enrolled in</p>
          <p className="rp-muted">
            Scheduled {sessions.scheduled} · Attended {sessions.attended} · Duration {duration(sessions.durationMinutes)}
          </p>
          {sessions.rows.length ? (
            <Table
              headers={['S.No.', 'Session', 'Coach', 'Scheduled', 'Attended', 'Duration']}
              rows={sessions.rows.map((r) => [r.sNo, r.session, r.coach, fmtDate(r.scheduled), r.attendance, duration(r.durationMinutes)])}
            />
          ) : <p className="rp-muted">No completed classes fall inside the selected dates.</p>}
        </div>
      </Block>

      <Block>
        <div className="rp-card">
          <h3 className="rp-card-title">Quiz Assignments</h3>
          <p className="rp-muted">Puzzle-solving activities only. Play-vs-Computer and multiple-choice homework are not counted here.</p>
          <p className="rp-muted">
            Topics {quiz.topics} · Assigned {quiz.assigned} · Attempted {quiz.attempted} · Solved {quiz.solved} · Points {quiz.points}
          </p>
          {quiz.rows.length ? (
            <Table
              headers={['S.No.', 'Topic', 'Assigned', 'Attempted', 'Solved', 'Progress', 'Accuracy', 'Points']}
              rows={quiz.rows.map((r) => [r.sNo, r.topic, r.assigned, r.attempted, r.solved, `${r.progress}%`, `${r.accuracy}%`, r.points])}
            />
          ) : <p className="rp-muted">No puzzle assignments fall inside the selected dates.</p>}
        </div>
      </Block>

      <Block>
        <div className="rp-card">
          <h3 className="rp-card-title">Tournaments</h3>
          <p className="rp-muted">Completed tournaments played in this range</p>
          <p className="rp-muted">
            Played {tournaments.played} · Wins {tournaments.wins} · Drawn {tournaments.drawn} · Lost {tournaments.lost}
          </p>
          {tournaments.rows.length ? (
            <Table
              headers={['S.No.', 'Tournament', 'Played on', 'Wins', 'Drawn', 'Lost', 'Position']}
              rows={tournaments.rows.map((r) => [r.sNo, r.tournament, fmtDate(r.playedOn), r.wins, r.drawn, r.lost, r.position ? ordinal(r.position) : '—'])}
            />
          ) : <p className="rp-muted">This student did not play a completed tournament inside the selected dates.</p>}
        </div>
      </Block>

      {includeRemarks && (
        <Block>
          <div className="rp-card">
            <h3 className="rp-card-title">Coach remarks</h3>
            <p className="rp-muted" style={{ whiteSpace: 'pre-wrap' }}>{remarks?.text || 'No remarks yet.'}</p>
          </div>
        </Block>
      )}
    </div>
  );
}
