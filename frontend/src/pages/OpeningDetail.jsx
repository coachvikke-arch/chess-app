import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Page } from '../components/ui';
import ChessBoard from '../components/ChessBoard';
import { DIFFICULTY_TONE } from '../components/openings/OpeningCard';
import {
  getOpening,
  buildLine,
  lineLength,
  plyMoveNumber,
  getLine,
  listLines,
  branchPly,
} from '../lib/openings';
import { useFittedBoardWidth } from '../hooks/useBoardWidth';
import { getOpeningProgress, setStatus, STATUS } from '../lib/openingsProgress';
import useArrowKeys from '../hooks/useArrowKeys';
import OpeningLearnTab from '../components/openings/OpeningLearnTab';
import OpeningPracticeTab from '../components/openings/OpeningPracticeTab';

import { useAuth } from '../context/AuthContext';
import { useUrlTab } from '../hooks/useUrlTab';
import Button from '../components/Button';

const TAG_STYLES = {
  'Dead last': 'chess-chip-red',
  'Classic': 'chess-chip-gold',
  'Sharp': 'chess-chip-red',
  'Solid': 'chess-chip-green',
  'Troll': 'chess-chip-amber',
  'Gambit': 'chess-chip-red',
  'Aggressive': 'chess-chip-red',
  'Positional': 'chess-chip-gold',
};

function TagBadge({ tag }) {
  if (!tag) return null;
  const tone = TAG_STYLES[tag] || 'chess-chip';
  return <span className={`chess-chip ${tone}`}>{tag}</span>;
}

function TakeTwistCard({ title, children, variant }) {
  return (
    <div className={`op-take-twist op-take-twist--${variant}`}>
      <h4 className="op-take-twist-title">{title}</h4>
      <p className="op-take-twist-text">{children}</p>
    </div>
  );
}

function deriveTake(opening) {
  if (opening.take) return opening.take;
  const notes = opening.notes || {};
  const firstNote = notes[1] || notes['1'];
  if (firstNote) return firstNote;
  return opening.description;
}

function deriveTwist(opening) {
  if (opening.twist) return opening.twist;
  const notes = opening.notes || {};
  const lastMoveIdx = (opening.moves || []).length;
  const lastNote = notes[lastMoveIdx] || notes[String(lastMoveIdx)];
  if (lastNote) return lastNote;
  const ideas = opening.keyIdeas || [];
  if (ideas.length) return ideas[ideas.length - 1];
  return 'The line contains a surprise that changes the evaluation.';
}

function deriveTag(opening) {
  if (opening.tag) return opening.tag;
  const styles = opening.style || [];
  if (styles.includes('Gambit')) return 'Gambit';
  if (styles.includes('Aggressive')) return 'Sharp';
  if (styles.includes('Solid')) return 'Solid';
  if (styles.includes('Positional')) return 'Classic';
  return styles[0] || 'Classic';
}

const TABS = [
  { id: 'learn', label: 'Learn', icon: '🎓' },
  { id: 'practice', label: 'Practice', icon: '♟' },
];

const TAB_IDS = TABS.map((t) => t.id);

export default function OpeningDetail() {
  const { slug } = useParams();
  const [params, setParams] = useSearchParams();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const opening = getOpening(slug);

  const variationParam = params.get('v') || '';
  const lines = useMemo(() => listLines(opening), [opening]);
  const line = useMemo(() => getLine(opening, variationParam), [opening, variationParam]);
  const branch = useMemo(() => branchPly(opening, line), [opening, line]);

  const { plies } = useMemo(
    () => (line ? buildLine(line) : { plies: [] }),
    [line]
  );
  const [ply, setPly] = useState(0);
  const [progress, setProgress] = useState(null);
  const [rawTab, setActiveTab] = useUrlTab('tab', 'learn');
  /* Old links and saved URLs may still say ?tab=story (or anything else).
     The card now has exactly Learn and Practice, so unknown values fall back
     to Learn instead of rendering no panel at all. */
  const activeTab = rawTab === 'practice' ? 'practice' : 'learn';
  useEffect(() => {
    if (!TAB_IDS.includes(rawTab)) setActiveTab('learn');
  }, [rawTab, setActiveTab]);

  useEffect(() => { setPly(0); }, [slug, line?.id]);
  useEffect(() => {
    if (opening) setProgress(getOpeningProgress(opening.slug, userId));
  }, [opening, userId, ply]);

  if (!opening) {
    return (
      <Page title="Openings" piece="♞" sub="That opening isn't in the library.">
        <div className="chess-card chess-empty">
          <p className="mb-3">♙ Opening not found — it isn't in the library.</p>
          <Button to="/openings" variant="secondary" size="md">Back to the library</Button>
        </div>
      </Page>
    );
  }

  const current = plies[Math.min(ply, plies.length - 1)] || plies[0];
  const difficultyTone = DIFFICULTY_TONE[opening.difficulty] || 'gold';
  const total = lineLength(line || { moves: [] });
  const boardWidth = useFittedBoardWidth(440);
  const tag = deriveTag(opening);
  const take = deriveTake(opening);
  const twist = deriveTwist(opening);

  const undo = useCallback(() => setPly(p => Math.max(0, p - 1)), []);
  const redo = useCallback(() => setPly(p => Math.min(total, p + 1)), [total]);
  useArrowKeys(undo, redo, { enabled: activeTab === 'learn' });

  const mark = (status) => {
    setStatus(opening.slug, status, userId);
    setProgress(getOpeningProgress(opening.slug, userId));
  };

  const goToBranch = () => {
    if (!branch) return;
    setPly(Math.min(branch, total));
  };

  const selectLine = useCallback(
    (id) => {
      /* Keep ?tab=... — switching the line while practising must not kick the
         learner back to Learn. */
      const next = new URLSearchParams(params);
      if (id === 'main') next.delete('v');
      else next.set('v', id);
      setParams(next, { replace: true });
    },
    [params, setParams]
  );

  const handlePracticeClick = () => setActiveTab('practice');

  const tabKeyDown = (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const index = TAB_IDS.indexOf(activeTab);
    const step = e.key === 'ArrowRight' ? 1 : -1;
    const next = TAB_IDS[(index + step + TAB_IDS.length) % TAB_IDS.length];
    setActiveTab(next);
    requestAnimationFrame(() => document.getElementById(`op-tab-${next}`)?.focus());
  };

  const takeTwist = (
    <div className="op-story-cards">
      <TakeTwistCard title="The take" variant="dark" children={take} />
      <TakeTwistCard title="The plot twist" variant="yellow" children={twist} />
    </div>
  );

  const branchNote = branch && !line.isMain ? (
    <p className="op-branch-note">
      <span className="chess-card-piece" aria-hidden="true">⑂</span>
      This line follows the main line to{' '}
      <button type="button" className="chess-link" onClick={goToBranch}>
        {plyMoveNumber(Math.max(0, branch - 1))}&hellip;
      </button>
      {', then continues on its own.'}
    </p>
  ) : null;

  return (
    <Page title={opening.name} piece="♞" sub={opening.description} wide>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button to="/openings" variant="secondary" size="sm" className="!py-2 !px-3 text-xs">← Library</Button>
        <span className="chess-chip">{opening.eco}</span>
        <TagBadge tag={tag} />
        <span className={`chess-chip chess-chip-${difficultyTone}`}>{opening.difficulty}</span>
        <span className="chess-chip">{opening.style?.join(', ') || opening.style}</span>
        {opening.gambit && <span className="chess-chip chess-chip-red">{opening.gambit.classification}</span>}
        <span className="chess-chip">{opening.side === 'white' ? 'White' : 'Black'}</span>
        <span className="text-xs text-ivory-500 ml-auto">
          {activeTab === 'practice' ? 'Practice' : `Ply ${ply}/${total}`} · {opening.family}
        </span>
      </div>

      {lines.length > 1 && (
        <div className="op-lines" role="tablist" aria-label="Opening lines">
          {lines.map((l) => {
            const active = l.id === line?.id;
            const lBranch = branchPly(opening, l);
            return (
              <button
                key={l.id}
                type="button"
                role="tab"
                aria-selected={active}
                className={`op-line-tab ${active ? 'op-line-tab--active' : ''}`}
                onClick={() => selectLine(l.id)}
                title={l.isMain
                  ? 'The main line of this opening'
                  : `Branches from the main line at move ${Math.floor((lBranch || 0) / 2) + 1}`}
              >
                <span className="op-line-tab-label">{l.name}</span>
                <span className="op-line-tab-meta">
                  {l.moves.length} {l.moves.length === 1 ? 'ply' : 'plies'}
                  {!l.isMain && lBranch ? ` · after ${plyMoveNumber(lBranch - 1)}...` : ''}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="op-tabs" role="tablist" aria-label="Opening detail tabs" onKeyDown={tabKeyDown}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            id={`op-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`op-panel-${tab.id}`}
            tabIndex={activeTab === tab.id ? 0 : -1}
            className={`op-tab ${activeTab === tab.id ? 'op-tab--active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <span className="op-tab-icon">{tab.icon}</span>
            <span className="op-tab-label">{tab.label}</span>
          </button>
        ))}
      </div>

      {activeTab === 'learn' && (
        <div className="op-detail" id="op-panel-learn" role="tabpanel" aria-labelledby="op-tab-learn">
          <div className="op-board-col">
            <div className="w-full min-w-0 flex justify-center">
              <ChessBoard
                fen={current?.fen}
                boardWidth={boardWidth}
                orientation={opening.side === 'white' ? 'white' : 'black'}
                interactive={false}
                showNotation
                highlightLastMove
                lastMove={current ? { from: current.from, to: current.to } : null}
              />
            </div>
            <div className="op-nav">
              <button type="button" className="op-nav-btn" onClick={() => setPly(0)} disabled={ply === 0} title="Jump to the start position"><span aria-hidden="true">⏮</span><span className="sr-only">Start</span></button>
              <button type="button" className="op-nav-btn" onClick={undo} disabled={ply === 0} title="Previous move (←)"><span aria-hidden="true">◀</span><span className="sr-only">Undo</span></button>
              <button type="button" className="op-nav-btn" onClick={redo} disabled={ply >= total} title="Next move (→)"><span aria-hidden="true">▶</span><span className="sr-only">Redo</span></button>
              <button type="button" className="op-nav-btn" onClick={() => setPly(total)} disabled={ply >= total} title="Jump to the end of the line"><span aria-hidden="true">⏭</span><span className="sr-only">End</span></button>
              <span className="op-nav-count">Move {Math.min(Math.floor(ply / 2) + 1, Math.ceil(total / 2))}</span>
            </div>
          </div>

          <div className="op-detail-side">
            {branchNote}
            {takeTwist}
            <OpeningLearnTab
              opening={opening}
              lines={lines}
              currentLineId={line?.id}
              onLineSelect={selectLine}
              onPracticeClick={handlePracticeClick}
              ply={ply}
              setPly={setPly}
              total={total}
              plies={plies}
              branch={branch}
            />
          </div>
        </div>
      )}

      {activeTab === 'practice' && (
        <div id="op-panel-practice" role="tabpanel" aria-labelledby="op-tab-practice">
          <OpeningPracticeTab
            opening={opening}
            variationParam={variationParam}
            onLineSelect={selectLine}
            onBackToStudy={() => setActiveTab('learn')}
          />
        </div>
      )}

      <div className="op-detail-actions">
        <Button
          type="button"
          onClick={handlePracticeClick}
          variant="primary" size="md"
        >
          ♟ Practice {line && !line.isMain ? 'this line' : 'this opening'}
        </Button>
        <Button
          type="button"
          onClick={() => mark(STATUS.LEARNED)}
          variant={progress?.status === STATUS.LEARNED ? 'primary' : 'secondary'}
          size="md"
        >
          {progress?.status === STATUS.LEARNED ? '✓ Learned' : 'Mark as learned'}
        </Button>
        <Button
          type="button"
          onClick={() => mark(STATUS.IN_PROGRESS)}
          variant={progress?.status === STATUS.IN_PROGRESS ? 'primary' : 'secondary'}
          size="md"
        >
          ◐ In progress
        </Button>
      </div>
    </Page>
  );
}