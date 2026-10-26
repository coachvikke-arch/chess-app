import { useEffect, useState } from 'react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { Page, Card, Chip, Spinner } from '../components/ui';
import { isAdminRole } from '../utils/roles';
import Button from '../components/Button';

export default function GameAnalysis() {
  const { user } = useAuth();
  const [pgn, setPgn] = useState('');
  const [games, setGames] = useState(null);
  const [completion, setCompletion] = useState(null);
  const [completionOpen, setCompletionOpen] = useState({});

  function load() {
    if (isAdminRole(user?.role)) {
      api.get('/game-analysis').then((res) => setGames(res.data)).catch(() => setGames([]));
      api.get('/puzzles/completion').then((res) => setCompletion(res.data.students || [])).catch(() => setCompletion([]));
    }
  }
  useEffect(load, [user]);

  async function submitGame() {
    await api.post('/game-analysis', { pgn });
    setPgn('');
    alert('Game submitted for coach review!');
  }

  async function giveFeedback(id, feedback) {
    await api.put(`/game-analysis/${id}/feedback`, { feedback });
    load();
  }

  if (isAdminRole(user?.role)) {
    return (
      <Page title="Analysis Submissions" piece="♖" sub="Review your students' games and their puzzle completion.">
        {/* Puzzle completion */}
        <Card title="Puzzle Completion" piece="♞" className="max-w-4xl mb-6">
          {completion === null && <Spinner />}
          {completion?.length === 0 && <p className="chess-empty">No students yet.</p>}
          <div className="space-y-2">
            {completion?.map((s) => {
              const pct = s.total_puzzles > 0 ? Math.round((s.solved / s.total_puzzles) * 100) : 0;
              return (
                <div key={s.student_id} className="rounded-xl border border-ivory-700/50 bg-black/[0.03] p-3">
                  <button
                    className="w-full flex flex-wrap items-center gap-3 text-left"
                    onClick={() => setCompletionOpen((o) => ({ ...o, [s.student_id]: !o[s.student_id] }))}
                  >
                    <span className="text-gold-400">♙</span>
                    <span className="font-medium text-ivory-100 text-sm">{s.name}</span>
                    <span className="ml-auto text-xs text-ivory-500">
                      {s.solved} / {s.total_puzzles} completed
                    </span>
                    <Chip tone="green">{pct}%</Chip>
                    <span className="text-xs text-ivory-500">
                      {s.attempted} attempt{s.attempted !== 1 ? 's' : ''} · {s.points} pts
                    </span>
                  </button>
                  {completionOpen[s.student_id] && (
                    <div className="mt-3 pt-3 border-t border-ivory-700/40" style={{ animation: 'board-pop .25s both' }}>
                      {s.solved_puzzles?.length ? (
                        <ul className="grid md:grid-cols-2 gap-1.5">
                          {s.solved_puzzles.map((p, i) => (
                            <li key={i} className="flex items-center justify-between text-xs text-ivory-300">
                              <span>♞ {p.theme || 'Tactics'}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-xs text-ivory-500">No puzzles completed yet.</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>

        <div className="space-y-3 max-w-4xl">
          {games === null && <Spinner />}
          {games?.length === 0 && <div className="chess-card"><p className="chess-empty">No submissions yet.</p></div>}
          {games?.map((g) => (
            <Card key={g.id}>
              <div className="flex items-center justify-between">
                <p className="font-medium text-ivory-100 flex items-center gap-2">
                  <span className="text-gold-400">♟</span>{g.student_name}
                </p>
                {g.coach_feedback && <Chip tone="green">Reviewed</Chip>}
              </div>
              <p className="text-xs text-ivory-500 break-all mt-2 font-mono">{g.pgn}</p>
              <textarea placeholder="Write your feedback for this game…" defaultValue={g.coach_feedback || ''} rows={2}
                className="chess-input mt-3 resize-none"
                onBlur={(e) => giveFeedback(g.id, e.target.value)} />
            </Card>
          ))}
        </div>
      </Page>
    );
  }

  return (
    <Page title="Submit a Game for Analysis" piece="♖" sub="Paste your PGN and get personal feedback from the coach.">
      <div className="max-w-2xl">
        <Card className="max-w-2xl">
          <label className="text-sm font-medium text-ivory-300">Your game (PGN)</label>
          <textarea placeholder="1. e4 e5 2. Nf3 Nc6 …" value={pgn} onChange={(e) => setPgn(e.target.value)}
            rows={9} className="chess-input mt-2 resize-none font-mono" />
          <Button onClick={submitGame} variant="primary" size="md" className="mt-4">
            Submit for Review ♗
          </Button>
        </Card>
      </div>
    </Page>
  );
}