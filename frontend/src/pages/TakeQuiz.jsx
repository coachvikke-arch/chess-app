import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../services/api';
import { Page, Card, Spinner } from '../components/ui';
import Button from '../components/Button';

export default function TakeQuiz() {
  const { id } = useParams();
  const [quiz, setQuiz] = useState(null);
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);

  useEffect(() => { api.get(`/quizzes/${id}`).then((res) => setQuiz(res.data)); }, [id]);

  async function submit() {
    const res = await api.post(`/quizzes/${id}/submit`, { answers });
    setResult(res.data);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  if (!quiz) return <Page title="Quiz" piece="♛"><Spinner /></Page>;

  return (
    <Page title={quiz.title} piece="♛" sub={quiz.description}>
      <div className="max-w-2xl space-y-4">
        {result && (
          <div className="chess-card border-gold-500/30 p-6 text-center" style={{ animation: 'board-pop .5s both' }}>
            <span className="text-5xl inline-block piece-glyph-spin text-gold-400">♛</span>
            <h2 className="font-display text-2xl font-bold mt-3">Score: {result.score}%</h2>
            <p className="text-ivory-500 text-sm mt-1">
              {result.score >= 70 ? 'Beautifully played!' : result.score >= 40 ? 'Keep training — you\'re improving.' : 'A tough one. Review and try again.'}
            </p>
          </div>
        )}

        {quiz.questions.map((q, qi) => (
          <Card key={q.id} className="max-w-2xl">
            <p className="font-medium text-ivory-100 mb-3 flex items-start gap-2">
              <span className="text-gold-400 font-display">{qi + 1}.</span> {q.question}
            </p>
            <div className="space-y-2">
              {(q.options || []).map((opt) => {
                const selected = answers[q.id] === opt;
                return (
                  <label key={opt}
                    className={`flex items-center gap-3 text-sm rounded-xl border px-3.5 py-2.5 cursor-pointer transition ${
                      selected
                        ? 'border-gold-500/60 bg-gold-700/15 text-gold-500'
                        : 'border-ivory-700/50 bg-black/[0.03] text-ivory-300 hover:border-gold-500/30'
                    }`}>
                    <input
                      type="radio"
                      name={`q-${q.id}`}
                      className="accent-gold-500"
                      checked={selected}
                      onChange={() => setAnswers({ ...answers, [q.id]: opt })}
                    />
                    {opt}
                  </label>
                );
              })}
            </div>
          </Card>
        ))}

        <Button onClick={submit} variant="primary" size="lg">
          Submit Quiz ♞
        </Button>
      </div>
    </Page>
  );
}