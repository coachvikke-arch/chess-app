import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { isAdminRole } from '../utils/roles';
import { Card, Chip } from '../components/ui';

/**
 * Reports hub.
 *
 * `/reports` used to have no route of its own: staff reports lived at
 * `/admin/reports` and students at `/student/report`, so the obvious URL
 * landed on the 404 page. This page is the single door to every existing
 * report, chosen by role so a student never sees a staff-only link.
 */
const STAFF_REPORTS = [
  {
    to: '/admin/reports',
    icon: '♙',
    tag: 'Students',
    title: 'Student Reports',
    desc: 'The assigned-student roster with attendance, homework and profile actions.',
  },
  {
    to: '/admin/puzzle-assignments',
    icon: '♟',
    tag: 'Tactics',
    title: 'Puzzle Solving Report',
    desc: 'Who solved what, accuracy by theme, and pending homework assignments.',
  },
  {
    to: '/admin/performances',
    icon: '🏆',
    tag: 'Showcase',
    title: 'Top Performances',
    desc: 'Academy-wide best results and featured games.',
  },
  {
    to: '/admin/chess-profiles',
    icon: '♛',
    tag: 'Chess',
    title: 'Student Chess Profiles',
    desc: 'Per-student rating pools, recent games and level progress.',
  },
];

const STUDENT_REPORTS = [
  {
    to: '/student/report',
    icon: '📊',
    tag: 'Personal',
    title: 'My Report',
    desc: 'Your combined activity, classes, assignments, tournaments and performance.',
  },
  {
    to: '/student/performances',
    icon: '🏆',
    tag: 'Showcase',
    title: 'Top Performances',
    desc: 'The academy’s best results and featured games.',
  },
  {
    to: '/student/ratings',
    icon: '♕',
    tag: 'Chess',
    title: 'Ratings',
    desc: 'Your rating history and progress by time control.',
  },
  {
    to: '/student/certificates',
    icon: '🎓',
    tag: 'Awards',
    title: 'Certificates',
    desc: 'Certificates earned from level ups and tournament results.',
  },
];

export default function Reports() {
  const { user } = useAuth();
  const reports = isAdminRole(user?.role) ? STAFF_REPORTS : STUDENT_REPORTS;

  return (
    <div className="chess-page">
      <header className="chess-page-head">
        <h1 className="chess-page-title">
          <span className="piece-title-icon">📊</span>
          <span className="chess-gradient-text">Reports</span>
        </h1>
        <p className="chess-page-sub">
          Every report available to your account, in one place.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {reports.map((report) => (
          <Link key={report.to} to={report.to} className="block">
            <Card
              title={report.title}
              piece={report.icon}
              className="h-full"
              actions={<Chip tone="gold">{report.tag}</Chip>}
            >
              <p className="text-ivory-500 text-sm leading-relaxed">{report.desc}</p>
              <span className="mt-4 inline-block text-sm font-semibold text-gold-400">
                Open report →
              </span>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
