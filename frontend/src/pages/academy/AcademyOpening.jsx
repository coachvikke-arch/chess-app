import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { Chess } from 'chess.js';
import api from '../../services/api';
import ChessBoard from '../../components/ChessBoard';
import { Page, Card, Chip, Spinner } from '../../components/ui';
import { playSound } from '../../utils/sound';
import academyBase from '../../utils/academyBase';
import useBoardWidth, { useFittedBoardWidth } from '../../hooks/useBoardWidth';

const MODES = [
  { key: 'learn', label: 'Learn', icon: '📖', desc: 'Study each move and its idea.' },
  { key: 'follow', label: 'Follow', icon: '👣', desc: 'Play along — the next move is hinted.' },
  { key: 'practice', label: 'Practice', icon: '🎯', desc: 'Recite the line from memory. No hints.' },
];

/** Stable order: main line first, then variations by order index. */
function orderLines(list) {
  return (list || [])
    .slice()
    .sort((a, b) => (a.isMainLine ? -1 : b.isMainLine ? 1 : a.orderIndex - b.orderIndex));
}

export default function AcademyOpening() {
  const { openingSlug } = useParams();
  const location = useLocation();
  const base = academyBase(location.pathname);
  const [course, setCourse] = useState(null);
  const [lines, setLines] = useState([]);
  const [courseLesson, setCourseLesson] = useState(null);
  const [loadErr, setLoadErr] = useState('');

  const [mainLine, setMainLine] = useState(null);
  const [mode, setMode] = useState('learn');

  const gameRef = useRef(new Chess());
  const [ply, setPly] = useState(0);
  const [phase, setPhase] = useState('idle'); // idle|user|auto|done|wrong
  const [savedMsg, setSavedMsg] = useState('');
  const [courseDone, setCourseDone] = useState(false);
  const [sidebarLine, setSidebarLine] = useState(null);
  const boardWidth = useFittedBoardWidth(460);

  useEffect(() => {
    api
      .get(`/openings/courses/${openingSlug}`, { cache: false })
      .then((res) => {
        setCourse(res.data.course);
        const ordered = orderLines(res.data.lines || []);
        setLines(ordered);
        const start = ordered.find((l) => !l.learned) || ordered[0] || null;
        setMainLine(start);
        setSidebarLine(start);
        setCourseDone(ordered.length > 0 && ordered.every((l) => l.learned));
        const levelSlug = res.data.course?.side === 'black' ? 'advanced' : 'intermediate';
        return api.get(`/academy/levels/${levelSlug}`, { cache: false }).catch(() => null);
      })
      .then((res) => {
        if (res) {
          const match = (res.data.lessons || []).find((l) => l.openingSlug === openingSlug);
          setCourseLesson(match || null);
        }
      })
      .catch(() => setLoadErr('Opening not found.'));
  }, [openingSlug]);

  const side = course?.side || 'white';
  const isUserPly = (p) => (side === 'white' ? p % 2 === 0 : p % 2 === 1);

  const explanationMap = useMemo(() => {
    const m = new Map();
    for (const ex of mainLine?.explanations || []) m.set(ex.moveIndex, ex.text);
    return m;
  }, [mainLine]);

  const hintArrow = useMemo(() => {
    if (mode === 'practice' || phase === 'idle' || phase === 'done' || !mainLine) return null;
    if (ply >= mainLine.moves.length) return null;
    const san = mainLine.moves[ply];
    const expected = (gameRef.current.moves({ verbose: true }) || []).find((mm) => mm.san === san);
    return expected ? { from: expected.from, to: expected.to, color: '#00C853' } : null;
  }, [mainLine, ply, phase, mode]);

  useEffect(() => () => clearTimeout(window.__academyTimer), []);

  function loadLine(line, resetMode) {
    if (!line?.moves?.length) return;
    clearTimeout(window.__academyTimer);
    gameRef.current = new Chess();
    setSidebarLine(line);
    setPly(0);
    setPhase('idle');
    setSavedMsg('');
    if (resetMode === 'follow' || resetMode === 'practice') {
      let p = 0;
      while (p < line.moves.length && !isUserPly(p)) {
        gameRef.current.move(line.moves[p]);
        p += 1;
      }
      setPly(p);
      requestAnimationFrame(() => setPhase(p >= line.moves.length ? 'done' : 'user'));
    } else {
      setPhase('learn');
    }
  }

  function autoPlayOpponent(line, fromPly) {
    clearTimeout(window.__academyTimer);
    window.__academyTimer = setTimeout(() => {
      let p = fromPly;
      while (p < line.moves.length && !isUserPly(p)) {
        gameRef.current.move(line.moves[p]);
        p += 1;
      }
      setPly(p);
      if (p >= line.moves.length) setPhase('done');
      else setPhase('user');
    }, 550);
  }

  /** Re-fetch the course so `learned` flags are fresh, then load the next line. */
  async function refreshAndAdvance(completedLine) {
    try {
      const res = await api.get(`/openings/courses/${openingSlug}`, { cache: false });
      const ordered = orderLines(res.data.lines || []);
      setCourse(res.data.course);
      setLines(ordered);
      const allDone = ordered.length > 0 && ordered.every((l) => l.learned);
      setCourseDone(allDone);
      const completedIdx = ordered.findIndex((l) => l.id === completedLine.id);
      const next =
        ordered.find((l, i) => i > completedIdx && !l.learned) || ordered.find((l) => !l.learned) || null;
      if (allDone || !next) return;
      loadLine(next, mode);
      setSavedMsg(`Next up — ${next.name || 'next line'}.`);
    } catch {
      // course unchanged; simply stay on the completed line
    }
  }

  async function finishLine(line) {
    setPhase('done');
    try {
      await api.post(`/openings/courses/${openingSlug}/progress`, { lineId: line.id, correct: true });
      if (mode === 'practice') {
        // also mark the academy opening lesson as passed (practice session)
        try {
          await api.post('/academy/sessions/complete', {
            levelSlug: course.side === 'black' ? 'advanced' : 'intermediate',
            lessonSlug: courseLesson?.slug || openingSlug,
            sessionKind: 'opening-practice',
            total: 1,
            correct: 1,
            timeMs: 0,
            exercises: [],
          });
          setSavedMsg('✓ Line mastered — lesson progress saved!');
        } catch {
          setSavedMsg('✓ Line mastered!');
        }
      } else {
        setSavedMsg('✓ Line completed — progress saved.');
      }
      await refreshAndAdvance(line);
    } catch {
      if (mode === 'practice') {
        try {
          await api.post('/academy/sessions/complete', {
            levelSlug: course.side === 'black' ? 'advanced' : 'intermediate',
            lessonSlug: courseLesson?.slug || openingSlug,
            sessionKind: 'opening-practice',
            total: 1,
            correct: 1,
            timeMs: 0,
            exercises: [],
          });
          setSavedMsg('✓ Line completed.');
        } catch {
          setSavedMsg('✓ Line completed.');
        }
      } else {
        setSavedMsg('✓ Line completed.');
      }
    }
  }

  function onMove(move) {
    if (!mainLine || phase !== 'user') return;
    const expected = mainLine.moves[ply];
    if (!expected || move.san !== expected) {
      gameRef.current.undo();
      playSound('illegal');
      setPhase('user');
      return;
    }
    playSound('move');
    const nextPly = ply + 1;
    setPly(nextPly);
    if (nextPly >= mainLine.moves.length) finishLine(mainLine);
    else if (isUserPly(nextPly)) setPhase('user');
    else autoPlayOpponent(mainLine, nextPly);
  }

  if (loadErr) {
    return (
      <Page title="Academy" piece="♘">
        <Card title="Not found"><p className="text-ivory-500">{loadErr}</p></Card>
      </Page>
    );
  }
  if (!course || !mainLine) return <Page title="Academy" piece="♘"><Spinner text="Loading opening…" /></Page>;

  const coordinateText = mainLine.moves
    .map((san, i) => `${i % 2 === 0 ? Math.floor(i / 2) + 1 + '. ' : ''}${san}`)
    .join(' ');

  return (
    <Page title={course.title} piece="♘" sub={course.side === 'black' ? 'Black repertoire' : 'White opening'}>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Chip tone="gold">{course.ecoCode || 'Opening'}</Chip>
        <Chip tone="">{course.difficulty || 'Standard'}</Chip>
        <Link to={base} className="text-xs text-ivory-500 hover:text-gold-400">← Academy</Link>
      </div>

      <p className="text-sm text-ivory-500 mb-6 max-w-3xl leading-relaxed">
        {course.description}
      </p>

      {courseDone && (
        <div className="mb-6 max-w-3xl rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-4 text-sm text-emerald-600">
          🎉 Course complete — you&apos;ve mastered all {lines.length} lines of {course.title}. Review any line
          below or head back to the academy.
        </div>
      )}

      {/* Mode tabs */}
      <div className="grid grid-cols-3 gap-3 mb-6 max-w-3xl">
        {MODES.map((m) => (
          <button
            key={m.key}
            onClick={() => {
              setMode(m.key);
              loadLine(sidebarLine || mainLine, m.key);
            }}
            className={`rounded-2xl border p-3.5 text-left transition-all ${
              mode === m.key
                ? 'border-gold-500/40 bg-gold-500/10 shadow-[inset_0_0_24px_rgba(96,165,250,0.06)]'
                : 'border-ivory-700/50 bg-black/[0.03] hover:bg-black/[0.06]'
            }`}
          >
            <span className="text-lg">{m.icon}</span>
            <p className={`font-semibold mt-1 ${mode === m.key ? 'text-gold-400' : 'text-ivory-300'}`}>{m.label}</p>
            <p className="text-[0.7rem] text-ivory-500 leading-snug mt-0.5">{m.desc}</p>
          </button>
        ))}
      </div>

      <div className="grid lg:grid-cols-[1fr_360px] gap-6 items-start">
        {/* Board */}
        <div className="flex justify-center">
          <div>
            <ChessBoard
              game={gameRef.current}
              boardWidth={boardWidth}
              interactive={phase === 'user'}
              showLegalMoves={false}
              clickToMove
              draggableColor={side}
              onMove={onMove}
              customArrows={hintArrow ? [hintArrow] : []}
            />
            <div className="text-center mt-3 text-xs text-ivory-500">
              {courseDone
                ? '🎉 All lines mastered!'
                : mode === 'learn' && side === 'white'
                  ? 'Browse the main line below.'
                  : mode === 'learn'
                    ? 'Browsing the line as Black.'
                    : phase === 'done'
                      ? '✔ Line complete.'
                      : phase === 'user'
                        ? `Your move — ${side === 'white' ? 'White' : 'Black'} to play${mode === 'follow' ? ' (hint arrow shown)' : ''}.`
                        : 'Loading…'}
            </div>
          </div>
        </div>

        {/* Right column: move list + coach text */}
        <div className="space-y-4">
          <div className="rounded-2xl border border-ivory-700/50 bg-ink-900/40 p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-semibold text-ivory-300">{sidebarLine?.name || 'Main line'}</p>
              <span className="text-xs text-ivory-500">
                {mode === 'practice' ? 'recitation' : 'follow'}
              </span>
            </div>

            {(mode === 'learn' || phase === 'done' || phase === 'idle' || phase === 'learn') && (
              <p className="text-sm text-ivory-500 leading-relaxed font-mono mb-3">{coordinateText}</p>
            )}

            {/* Step through moves (learn mode) */}
            {mode === 'learn' && (
              <div>
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {mainLine.moves.map((san, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        const g = new Chess();
                        for (let k = 0; k <= i; k++) g.move(mainLine.moves[k]);
                        gameRef.current = g;
                        setPly(i + 1);
                        setPhase('learn');
                      }}
                      className={`px-2 py-1 rounded-md text-xs font-mono transition-colors ${
                        ply - 1 === i
                          ? 'bg-gold-500/20 text-gold-400 border border-gold-500/40'
                          : i < ply
                            ? 'text-ivory-500 bg-black/[0.04] border border-ivory-700/50 hover:bg-black/[0.08]'
                            : 'text-ivory-500 bg-transparent border border-transparent'
                      }`}
                    >
                      {san}
                    </button>
                  ))}
                </div>
                {explanationMap.get(ply - 1) && (
                  <p className="text-sm text-ivory-500 leading-relaxed bg-black/[0.03] border border-ivory-700/50 rounded-xl p-3">
                    {explanationMap.get(ply - 1)}
                  </p>
                )}
              </div>
            )}

            {/* Across-line explanations during follow/practice */}
            {(mode === 'follow' || mode === 'practice') && explanationMap.get(ply - 1) && (
              <p className="text-sm text-ivory-500 leading-relaxed bg-black/[0.03] border border-ivory-700/50 rounded-xl p-3">
                {explanationMap.get(ply - 1)}
              </p>
            )}

            {savedMsg && <p className="mt-3 text-xs text-emerald-600 font-semibold">{savedMsg}</p>}
          </div>

          {/* Variation picker — ordered checklist, one by one */}
          {lines.length > 1 && (
            <div className="rounded-2xl border border-ivory-700/50 bg-ink-900/40 p-4">
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm font-semibold text-ivory-300">Lines & variations</p>
                <span className="text-xs text-ivory-500">
                  {lines.filter((l) => l.learned).length}/{lines.length} mastered
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-black/[0.06] mb-3 overflow-hidden">
                <div
                  className="h-full bg-emerald-400/80 transition-all"
                  style={{
                    width: `${lines.length ? Math.round((lines.filter((l) => l.learned).length / lines.length) * 100) : 0}%`,
                  }}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                {lines.map((l, i) => {
                  const isNext = !l.learned && lines.slice(0, i).every((x) => x.learned);
                  const active = sidebarLine?.id === l.id;
                  return (
                    <button
                      key={l.id}
                      onClick={() => loadLine(l, mode)}
                      className={`flex items-start gap-2 text-left px-3 py-2 rounded-lg text-xs transition-colors ${
                        active && !l.learned
                          ? 'bg-gold-500/15 text-gold-400 border border-gold-500/30'
                          : active
                            ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/30'
                            : l.learned
                              ? 'text-ivory-400 hover:bg-black/[0.05] border border-transparent'
                              : 'text-ivory-500 hover:bg-black/[0.05] border border-transparent'
                      }`}
                    >
                      <span
                        className={`mt-0.5 shrink-0 flex h-5 w-5 items-center justify-center rounded-full text-[0.65rem] ${
                          l.learned ? 'bg-emerald-400/20 text-emerald-600' : 'bg-black/[0.06] text-ivory-500'
                        }`}
                      >
                        {l.learned ? '✓' : i + 1}
                      </span>
                      <span className="min-w-0">
                        <span className="block font-semibold">
                          {l.name || (l.isMainLine ? 'Main line' : l.moves.slice(0, 4).join(' '))}
                        </span>
                        <span className="block text-[0.65rem] text-ivory-500 overflow-hidden text-ellipsis whitespace-nowrap">
                          {l.moves.join(' ')}
                        </span>
                      </span>
                      {isNext && <span className="ml-auto shrink-0 text-[0.6rem] font-semibold text-gold-400 self-center">Next</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </Page>
  );
}