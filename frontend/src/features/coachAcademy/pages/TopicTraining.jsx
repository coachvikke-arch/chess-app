/**
 * AI Coach Training Academy — topic training page.
 *
 * The 16-step flow lives here, with the topic's chat, notes and mode switcher
 * around it. Notes are saved on an explicit action rather than on every
 * keystroke: the store writes to localStorage, and autosaving a textarea would
 * mean a write per character.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Page, Card, Spinner, Chip } from '../../../components/ui';
import useAcademyProgress from '../hooks/useAcademyProgress';
import { getTopic, getModule, getLevelRecord, ALL_TOPICS } from '../services/academyStore';
import { TRAINING_MODES } from '../data/levels';
import TrainingFlow from '../components/TrainingFlow';
import CoachChat from '../components/CoachChat';
import { MasteryChip, ActionButton } from '../components/AcademyUI';
import { formatRelative } from '../utils/format';

export default function CoachAcademyTopic() {
  const { topicId } = useParams();
  const p = useAcademyProgress();

  const topic = useMemo(() => getTopic(topicId), [topicId]);
  const level = useMemo(() => getLevelRecord(topic?.level), [topic?.level]);
  const module_ = useMemo(() => getModule(topic?.moduleId), [topic?.moduleId]);

  const [mode, setMode] = useState('learn');
  const [notes, setNotes] = useState('');
  const [savedAt, setSavedAt] = useState(null);
  const [chat, setChat] = useState([]);

  /* Topic-specific chat, separate from the general coach chat. */
  useEffect(() => {
    setChat(p.state.chat?.[topic?.id] || []);
    setSavedAt(null);
    /* Load any saved note so switching topics and back does not lose work. */
    setNotes(p.state.topics?.[topic?.id]?.notes || '');
  }, [topic?.id, p.state.chat, p.state.topics]);

  if (!topic) {
    return (
      <Page title="Topic" piece="♟">
        <Spinner text="That topic does not exist." />
        <Link to="/coach/ai-coach-training" className="block text-center text-sm text-gold-400 mt-4">
          Back to the academy
        </Link>
      </Page>
    );
  }

  const info = p.forTopic(topic.id);

  function handleScore(criterion, value, extra = {}) {
    p.recordCriterion(topic.id, criterion, value, { source: mode });
    if (extra.correct !== undefined) p.recordPractice(topic.id, { correct: extra.correct });
    if (criterion === 'recognition' && typeof value === 'number') {
      p.recordTopicTest(topic.id, value);
    }
  }

  const sendChat = useCallback(
    (text, meta) => {
      const entry = { ...meta, text, at: Date.now() };
      setChat((c) => {
        const next = [...c, entry].slice(-60);
        p.sendChat(text, { ...meta, topicId: topic.id });
        return next;
      });
    },
    [p, topic.id],
  );

  const resetChat = useCallback(() => {
    p.resetChat(topic.id);
    setChat([]);
  }, [p, topic.id]);

  function saveNotes() {
    p.saveNote(topic.id, notes);
    setSavedAt(Date.now());
  }

  return (
    <Page title={topic.name} piece="♟" sub={topic.summary} wide>
      <div className="grid gap-5 lg:grid-cols-[1fr,320px] items-start">
        <div className="space-y-5">
          {/* Level / module breadcrumb */}
          <div className="flex items-center gap-2 text-xs text-ivory-500 flex-wrap">
            <Link to="/coach/ai-coach-training" className="hover:text-ivory-100">
              Academy
            </Link>
            <span aria-hidden="true">/</span>
            {level && (
              <>
                <Link to={`/coach/ai-coach-training/level/${level.n}`} className="hover:text-ivory-100">
                  Level {level.n}
                </Link>
                <span aria-hidden="true">/</span>
              </>
            )}
            <span>{module_?.title}</span>
          </div>

          {/* Mode switcher — the seven training modes. */}
          <div className="flex flex-wrap gap-1.5">
            {TRAINING_MODES.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => setMode(m.key)}
                title={m.hint}
                aria-pressed={mode === m.key}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition border ${
                  mode === m.key
                    ? 'bg-gold-500 text-ink-900 border-gold-500'
                    : 'border-ivory-700/50 text-ivory-500 hover:text-ivory-100 hover:border-gold-500/50'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          <TrainingFlow
            topic={topic}
            topics={ALL_TOPICS}
            record={info.record}
            percent={info.percent}
            onScore={handleScore}
            messages={chat}
            onChatSend={sendChat}
            onChatReset={resetChat}
            mode={mode}
          />

          {/* Notes */}
          <Card title="Coach notes" piece="✎">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              placeholder="Your own summary, a student to revisit, a phrasing that worked…"
              className="w-full rounded-xl bg-black/[0.06] border border-ivory-700/50 px-3 py-2 text-sm text-ivory-100 placeholder:text-ivory-700 focus:outline-none focus:border-gold-500/70"
            />
            <div className="flex items-center gap-3 mt-3">
              <ActionButton onClick={saveNotes}>Save notes</ActionButton>
              {savedAt && <span className="text-xs text-green-300">Saved {formatRelative(savedAt)}</span>}
            </div>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-5">
          <Card title="Your record" piece="◐">
            <div className="flex items-center gap-3 mb-3">
              <div className="text-3xl font-display font-bold text-gold-400">{info.percent}%</div>
              <MasteryChip state={info.record.state} />
            </div>
            <ul className="space-y-1.5 text-sm">
              {Object.entries(info.record.scores || {}).map(([k, v]) => (
                <li key={k} className="flex justify-between">
                  <span className="text-ivory-500">{k}</span>
                  <span className="text-ivory-100">{v}%</span>
                </li>
              ))}
              {info.record.practiceDone > 0 && (
                <li className="flex justify-between">
                  <span className="text-ivory-500">practice attempts</span>
                  <span className="text-ivory-100">{info.record.practiceDone}</span>
                </li>
              )}
              {info.record.testBest > 0 && (
                <li className="flex justify-between">
                  <span className="text-ivory-500">best test</span>
                  <span className="text-ivory-100">{info.record.testBest}%</span>
                </li>
              )}
            </ul>
            {info.record.lastSeen && (
              <p className="text-xs text-ivory-700 mt-3">Last seen {formatRelative(info.record.lastSeen)}</p>
            )}
            {info.record.mistakes?.length > 0 && (
              <div className="mt-3">
                <p className="text-xs uppercase tracking-wider text-ivory-500 mb-1">Flagged</p>
                <div className="flex flex-wrap gap-1">
                  {info.record.mistakes.map((m) => (
                    <Chip key={m} tone="amber">
                      {m}
                    </Chip>
                  ))}
                </div>
              </div>
            )}
            <div className="mt-4">
              <ActionButton
                variant="danger"
                onClick={() => p.flagForRevision(topic.id, 'coach requested')}
              >
                Flag for revision
              </ActionButton>
            </div>
          </Card>

          {/* Topic-level chat */}
          <Card title="Ask about this topic" piece="♛">
            <CoachChat
              topic={topic}
              topics={[]}
              level={topic.level}
              messages={chat}
              onSend={sendChat}
              onReset={resetChat}
            />
          </Card>

          {/* Misconception, always visible — it is what the simulation tests. */}
          {topic.misconception && (
            <Card title="Student misconception" piece="⚠">
              <p className="text-sm text-ivory-300">{topic.misconception}</p>
            </Card>
          )}
        </div>
      </div>
    </Page>
  );
}