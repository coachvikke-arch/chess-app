import { useEffect, useState } from 'react';
import api from '../services/api';
import { PageHeader, Chip } from '../components/ui';
import Button from '../components/Button';

export default function ManageQuizzes() {
  const [quizzes, setQuizzes] = useState([]);
  const [form, setForm] = useState({ title: '', description: '' });
  const [question, setQuestion] = useState({ question: '', options: '', correctAnswer: '', explanation: '' });
  const [questions, setQuestions] = useState([]);

  function load() { api.get('/quizzes').then((res) => setQuizzes(res.data)).catch(() => {}); }
  useEffect(load, []);

  function addQuestion() {
    if (!question.question || !question.correctAnswer) return;
    setQuestions([...questions, { ...question, options: question.options.split(',').map((o) => o.trim()) }]);
    setQuestion({ question: '', options: '', correctAnswer: '', explanation: '' });
  }

  async function createQuiz(e) {
    e.preventDefault();
    await api.post('/quizzes', { ...form, questions });
    setForm({ title: '', description: '' });
    setQuestions([]);
    load();
  }

  return (
    <PageHeader title="Quiz Builder" icon="🏆" subtitle="Craft the questions that crown the quiz champions.">
      <form onSubmit={createQuiz} className="chess-card mb-8 space-y-4">
        <div className="grid md:grid-cols-2 gap-3">
          <input required placeholder="Quiz title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="chess-input" />
          <input placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="chess-input" />
        </div>

        <div className="border-t border-ivory-700/50 pt-4">
          <p className="text-sm font-medium text-ivory-300 mb-3 flex items-center gap-2">
            <span className="text-gold-400">♛</span> Add question
          </p>
          <div className="grid md:grid-cols-4 gap-2">
            <input placeholder="Question" value={question.question} onChange={(e) => setQuestion({ ...question, question: e.target.value })} className="chess-input md:col-span-2" />
            <input placeholder="Options, comma separated" value={question.options} onChange={(e) => setQuestion({ ...question, options: e.target.value })} className="chess-input" />
            <input placeholder="Correct answer" value={question.correctAnswer} onChange={(e) => setQuestion({ ...question, correctAnswer: e.target.value })} className="chess-input" />
          </div>
          <Button type="button" onClick={addQuestion} variant="secondary" size="md" className="!py-2 !px-4 text-sm mt-3">
            + Add question to quiz
          </Button>
          {questions.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2">
              {questions.map((q, i) => (
                <li key={i}><Chip tone="gold">Q{i + 1}: {q.question}</Chip></li>
              ))}
            </ul>
          )}
        </div>

        <Button variant="primary" size="md">Create Quiz ♛</Button>
      </form>

      <div className="grid md:grid-cols-2 gap-3">
        {quizzes.map((q) => (
          <div key={q.id} className="chess-card chess-card-hover">
            <p className="font-medium text-ivory-100">{q.title}</p>
            <p className="text-sm text-ivory-500">{q.description}</p>
          </div>
        ))}
        {quizzes.length === 0 && <div className="chess-card md:col-span-2"><p className="chess-empty">No quizzes yet.</p></div>}
      </div>
    </PageHeader>
  );
}