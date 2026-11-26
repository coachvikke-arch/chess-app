/* CSV for the Performance Report. Built from the same response the screen
   renders, so the downloaded rows are the rows on screen for the chosen dates. */

const esc = (value) => {
  const text = value == null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const row = (cells) => cells.map(esc).join(',');
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
const fmtDate = (v) => (v ? new Date(`${v}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '');

export function downloadPerformanceCsv(data, includeRemarks) {
  if (!data) return;
  const { student, from, to, summary, insights, weeklySolved, rating, sessions, quiz, tournaments, remarks } = data;
  const period = data.periodLabel || `${from} - ${to}`;
  const lines = [];
  const push = (...cells) => lines.push(row(cells));
  const section = (title) => { lines.push(''); push(title); };

  push('Performance Report');
  push('Student', student?.name || '');
  push('Period', period);
  lines.push('');

  section('Summary');
  push('Metric', 'Value', 'Detail');
  push('Classes attended', `${summary.classes.attended}/${summary.classes.scheduled}`, `${summary.classes.attendancePct}% attendance`);
  push('Learning time', duration(summary.learningTimeMinutes), 'total time in class');
  push('Quiz puzzles solved', `${summary.puzzles.solved}/${summary.puzzles.attempted}`, `${summary.puzzles.solvedPct}% solved, ${summary.puzzles.points} points`);
  push('Tournaments', summary.tournaments.played, summary.tournaments.bestFinish ? `Best finish: ${ordinal(summary.tournaments.bestFinish)}` : 'No ranked finish');

  section('Insights');
  push('Insight', 'Value', 'Detail');
  push('Best topic', insights.bestTopic?.topic || '', insights.bestTopic ? `${insights.bestTopic.solved} solved, ${insights.bestTopic.accuracy}% accuracy` : '');
  push('Needs practice', insights.needsPractice?.topic || '', insights.needsPractice ? `${insights.needsPractice.accuracy}% accuracy` : '');
  push('Points per solved puzzle', insights.pointsPerSolved.value, `Class average ${insights.pointsPerSolved.classAverage}`);
  push('Solving streak', `${insights.solvingStreak.days} days`, insights.solvingStreak.from ? `${fmtDate(insights.solvingStreak.from)} - ${fmtDate(insights.solvingStreak.to)}` : '');

  section('Puzzles solved per week');
  push('Week', 'Solved');
  weeklySolved.forEach((w) => push(w.label, w.value));

  section('Rating progress');
  push('Start', 'Now', 'Change', 'Leaderboard rank');
  push(rating.start, rating.end, rating.change, rating.rank ?? '—');

  section('Sessions — Completed classes this student was enrolled in');
  push('S.No.', 'Session', 'Coach', 'Scheduled', 'Attended', 'Duration');
  sessions.rows.forEach((r) => push(r.sNo, r.session, r.coach, fmtDate(r.scheduled), r.attendance, duration(r.durationMinutes)));
  if (!sessions.rows.length) push('', 'No completed classes fall inside the selected dates.');

  section('Quiz Assignments — Puzzle-solving activities only');
  push('S.No.', 'Topic', 'Assigned', 'Attempted', 'Solved', 'Progress', 'Accuracy', 'Points');
  quiz.rows.forEach((r) => push(r.sNo, r.topic, r.assigned, r.attempted, r.solved, `${r.progress}%`, `${r.accuracy}%`, r.points));
  if (!quiz.rows.length) push('', 'No puzzle assignments fall inside the selected dates.');

  section('Tournaments — Completed tournaments played in this range');
  push('S.No.', 'Tournament', 'Played on', 'Wins', 'Drawn', 'Lost', 'Position');
  tournaments.rows.forEach((r) => push(r.sNo, r.tournament, fmtDate(r.playedOn), r.wins, r.drawn, r.lost, r.position ? ordinal(r.position) : '—'));
  if (!tournaments.rows.length) push('', 'This student did not play a completed tournament inside the selected dates.');

  if (includeRemarks) {
    section('Coach remarks');
    push(remarks?.text || 'No remarks yet.');
  }

  const blob = new Blob(['\ufeff', lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `Performance_Report_${student?.name || 'student'}_${from}_to_${to}.csv`.replace(/[^\w\-_.]+/g, '_');
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
