import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { Page, Chip, Spinner } from '../components/ui';
import Button from '../components/Button';
import ChessBoard from '../components/ChessBoard';
import {
  fetchTopics,
  startGeneration,
  getJob,
  cancelGeneration,
  savePuzzles,
  fetchPgnFolders,
  createPgnFolder,
} from '../utils/puzzleGeneratorApi';

/* Fallback catalogue — mirrors services/puzzleGenerator/topics.js so the
   dropdown still works if the topic endpoint cannot be reached. */
const FALLBACK_TOPICS = [
  ['fork', 'Fork', true], ['pin', 'Pin', true], ['skewer', 'Skewer', true],
  ['discovered-attack', 'Discovered Attack', true], ['discovered-check', 'Discovered Check', true],
  ['double-check', 'Double Check', true], ['deflection', 'Deflection', false],
  ['decoy', 'Decoy/Attraction', false], ['interference', 'Interference', false],
  ['clearance', 'Clearance', false], ['removing-defender', 'Removing the Defender', false],
  ['overloading', 'Overloading', false], ['zwischenzug', 'Zwischenzug', false],
  ['x-ray', 'X-Ray', false], ['trapped-piece', 'Trapped Piece', false],
  ['hanging-piece', 'Hanging Piece', true], ['sacrifice', 'Sacrifice', false],
  ['quiet-move', 'Quiet Move', false], ['zugzwang', 'Zugzwang', false],
  ['back-rank-mate', 'Back Rank Mate', true], ['smothered-mate', 'Smothered Mate', true],
  ['arabian-mate', 'Arabian Mate', true], ['anastasia-mate', "Anastasia's Mate", true],
  ['hook-mate', 'Hook Mate', false], ['boden-mate', "Boden's Mate", false],
  ['mate-in-1', 'Mate in 1', true], ['mate-in-2', 'Mate in 2', true],
  ['mate-in-3', 'Mate in 3', true], ['promotion', 'Promotion/Underpromotion', true],
  ['endgame', 'Endgame Tactics', false], ['perpetual-check', 'Perpetual Check', false],
  ['stalemate-trick', 'Stalemate Trick', false], ['exposed-king', 'Exposed King', false],
].map(([id, label, engine]) => ({ id, label, engine, lichess: true }));

const DIFFICULTIES = [
  { id: 'any', label: 'Any' },
  { id: 'easy', label: 'Easy (< 1200)' },
  { id: 'medium', label: 'Medium (1200–1800)' },
  { id: 'hard', label: 'Hard (> 1800)' },
];

const SOURCES = [
  { id: 'lichess+engine', label: 'Lichess + Engine' },
  { id: 'lichess', label: 'Lichess only' },
  { id: 'engine', label: 'Engine only' },
];

/* ── small helpers ─────────────────────────────────────────────────────── */

function flattenTree(tree, out = []) {
  for (const node of tree || []) {
    out.push(node);
    flattenTree(node.children, out);
  }
  return out;
}

function folderPath(flat, id) {
  const byId = new Map(flat.map((f) => [f.id, f]));
  const names = [];
  let cur = byId.get(id);
  const guard = new Set();
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id);
    names.unshift(cur.name);
    cur = cur.parentId != null ? byId.get(cur.parentId) : null;
  }
  return names.length ? `PGN library / ${names.join(' / ')}` : 'PGN library';
}

function moveNumberText(fen, sanMoves) {
  const parts = String(fen || '').split(/\s+/);
  const turn = parts[1] === 'b' ? 'b' : 'w';
  let no = Number(parts[5]) || 1;
  const tokens = [];
  let i = 0;
  if (turn === 'b' && sanMoves.length) {
    tokens.push(`${no}...`, sanMoves[0]);
    no += 1;
    i = 1;
  }
  while (i < sanMoves.length) {
    tokens.push(`${no}.`, sanMoves[i]);
    if (sanMoves[i + 1]) tokens.push(sanMoves[i + 1]);
    i += 2;
    no += 1;
  }
  return tokens.join(' ');
}

function sourceLabel(source) {
  return source === 'engine' ? 'Engine' : 'Lichess';
}

/* ── tree node ─────────────────────────────────────────────────────────── */

function FolderRow({ node, depth, expanded, onToggle, selectedId, onSelect }) {
  const hasKids = node.children.length > 0;
  const open = expanded.has(node.id);
  const selected = selectedId === node.id;
  return (
    <div>
      <div
        className={`pg-tree-row ${selected ? 'is-selected' : ''}`}
        style={{ paddingLeft: `${0.35 + depth * 0.95}rem` }}
        role="button"
        tabIndex={0}
        onClick={() => onSelect(node.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(node.id); }
        }}
      >
        <button
          type="button"
          className={`pg-tree-chevron ${hasKids ? '' : 'is-empty'} ${open ? 'is-open' : ''}`}
          aria-label={open ? 'Collapse folder' : 'Expand folder'}
          onClick={(e) => { e.stopPropagation(); if (hasKids) onToggle(node.id); }}
        >
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M6 3.5l5 4.5-5 4.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <span className="pg-tree-icon" aria-hidden="true">📁</span>
        <span className="pg-tree-name">{node.name}</span>
        <span className="pg-tree-count">{node.gameCount}</span>
      </div>
      {hasKids && open && (
        <div>
          {node.children.map((child) => (
            <FolderRow
              key={child.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── page ──────────────────────────────────────────────────────────────── */

export default function PuzzleGenerator() {
  const [topics, setTopics] = useState(FALLBACK_TOPICS);
  const [topicId, setTopicId] = useState('fork');
  const [count, setCount] = useState('12');
  const [difficulty, setDifficulty] = useState('any');
  const [source, setSource] = useState('lichess+engine');
  const [formError, setFormError] = useState('');

  const [job, setJob] = useState(null);
  const [running, setRunning] = useState(false);
  const [jobError, setJobError] = useState('');
  const pollRef = useRef(null);

  const [puzzles, setPuzzles] = useState([]);
  const [included, setIncluded] = useState(() => new Set());
  const [index, setIndex] = useState(0);
  const [showSolution, setShowSolution] = useState(false);
  const [previewPly, setPreviewPly] = useState(0);
  const [showPgn, setShowPgn] = useState(false);
  const [copied, setCopied] = useState('');

  const [saveOpen, setSaveOpen] = useState(false);
  const [folders, setFolders] = useState([]);
  const [foldersLoading, setFoldersLoading] = useState(false);
  const [foldersError, setFoldersError] = useState('');
  const [expanded, setExpanded] = useState(() => new Set());
  const [selectedFolder, setSelectedFolder] = useState(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [folderError, setFolderError] = useState('');
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [saveError, setSaveError] = useState('');

  const [boardWidth, setBoardWidth] = useState(320);
  const stripRef = useRef(null);
  const numberRefs = useRef([]);
  const boardObserverRef = useRef(null);

  const topic = useMemo(
    () => topics.find((t) => t.id === topicId) || topics[0] || { id: 'fork', label: 'Fork', engine: true },
    [topics, topicId]
  );
  const current = puzzles[index] || null;
  const flatFolders = useMemo(() => flattenTree(folders), [folders]);
  const selectedPath = selectedFolder != null ? folderPath(flatFolders, selectedFolder) : null;
  const includedPuzzles = useMemo(
    () => puzzles.filter((p) => included.has(p.id)),
    [puzzles, included]
  );

  /* ── board sizing ──
     The board renders its decorative frame around the measured surface, so the
     component is ~1.17× the `boardWidth` it is given (plus the label band).
     Sizing against the card's own width — not the viewport — is what keeps the
     page from scrolling sideways on a narrow phone. */
  const boardHostRef = useCallback((el) => {
    if (boardObserverRef.current) {
      boardObserverRef.current.disconnect();
      boardObserverRef.current = null;
    }
    if (!el) return;
    const measure = () => {
      const width = el.clientWidth;
      if (!width) return;
      /* The frame adds 2 × band (band is 20–46px, 8.2% of the board) and 28px
         of padding/border, so the component is ~1.164× boardWidth + 28. Below
         a 244px board the band is pinned at its 20px minimum, which makes the
         whole component boardWidth + 68 instead. */
      const fit = Math.floor((width - 30) / 1.164);
      const board = fit < 244 ? Math.min(fit, width - 72) : fit;
      setBoardWidth(Math.max(160, Math.min(320, board)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    boardObserverRef.current = observer;
  }, []);

  useEffect(() => () => boardObserverRef.current?.disconnect(), []);

  /* ── topics from the backend (catalogue stays authoritative) ── */
  useEffect(() => {
    let alive = true;
    fetchTopics()
      .then((list) => { if (alive && Array.isArray(list) && list.length) setTopics(list); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  /* ── job polling ── */
  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  const applyJob = useCallback((data) => {
    setJob(data);
    if (data.status === 'done') {
      stopPolling();
      setRunning(false);
      const list = Array.isArray(data.puzzles) ? data.puzzles : [];
      setPuzzles(list);
      setIncluded(new Set(list.map((p) => p.id)));
      setIndex(0);
      setShowSolution(false);
      setPreviewPly(0);
      setShowPgn(false);
      setSaveOpen(false);
      setSaveMessage('');
      setSaveError('');
    } else if (data.status === 'failed') {
      stopPolling();
      setRunning(false);
      setJobError(data.error || 'Generation failed.');
    } else if (data.status === 'cancelled') {
      stopPolling();
      setRunning(false);
    }
  }, [stopPolling]);

  const pollOnce = useCallback(async (jobId) => {
    try {
      const data = await getJob(jobId);
      applyJob(data);
    } catch (err) {
      stopPolling();
      setRunning(false);
      setJobError(err.response?.data?.message || err.message || 'Lost track of the generation job.');
    }
  }, [applyJob, stopPolling]);

  const handleGenerate = async () => {
    setFormError('');
    setJobError('');
    const n = Number(count);
    if (!Number.isInteger(n) || n < 1 || n > 100) {
      setFormError('Enter a number from 1 to 100');
      return;
    }
    if (source === 'engine' && !topic.engine) {
      setFormError(`No engine theme detector for ${topic.label} yet. Switch the source to Lichess only or Lichess + Engine.`);
      return;
    }
    setPuzzles([]);
    setIncluded(new Set());
    setIndex(0);
    setShowSolution(false);
    setPreviewPly(0);
    setShowPgn(false);
    setSaveOpen(false);
    setJob(null);
    setSaveMessage('');
    setSaveError('');
    try {
      const { jobId } = await startGeneration({
        topic: topic.id, count: n, difficulty, source,
      });
      setRunning(true);
      setJob({ status: 'running', step: 'Starting', progress: 0, counts: { lichess: 0, engine: 0 } });
      stopPolling();
      pollRef.current = setInterval(() => { pollOnce(jobId); }, 1000);
      pollOnce(jobId);
    } catch (err) {
      setRunning(false);
      setJobError(err.response?.data?.message || err.message || 'Could not start the generator.');
    }
  };

  const handleCancel = async () => {
    if (!job?.id) { setRunning(false); stopPolling(); return; }
    try {
      await cancelGeneration(job.id);
    } catch { /* the job may already be gone */ }
    stopPolling();
    setRunning(false);
  };

  /* ── navigation ── */
  const goTo = useCallback((next) => {
    setIndex((cur) => {
      const target = Math.max(0, Math.min(puzzles.length - 1, next));
      void cur;
      return target;
    });
    setShowSolution(false);
    setPreviewPly(0);
    setShowPgn(false);
  }, [puzzles.length]);

  useEffect(() => {
    const onKey = (e) => {
      if (!puzzles.length) return;
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(index - 1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); goTo(index + 1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, puzzles.length, goTo]);

  useEffect(() => {
    const el = numberRefs.current[index];
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [index, puzzles.length]);

  /* ── solution / preview ── */
  const preview = useMemo(() => {
    if (!current) return { fen: null, lastMove: null };
    if (!showSolution || previewPly === 0) return { fen: current.fen, lastMove: null };
    const chess = new Chess(current.fen);
    let lastMove = null;
    for (let i = 0; i < previewPly; i += 1) {
      try {
        const move = chess.move(current.solutionSan[i]);
        lastMove = move ? { from: move.from, to: move.to } : lastMove;
      } catch {
        break;
      }
    }
    return { fen: chess.fen(), lastMove };
  }, [current, showSolution, previewPly]);

  const handleCopy = async () => {
    if (!current) return;
    const text = current.pgn || '';
    try {
      await navigator.clipboard.writeText(text);
      setCopied('Copied');
    } catch {
      setCopied('Copy failed — select the PGN and copy manually');
    }
    setTimeout(() => setCopied(''), 2200);
  };

  /* ── save panel ── */
  const loadFolders = useCallback(async () => {
    setFoldersLoading(true);
    setFoldersError('');
    try {
      const tree = await fetchPgnFolders();
      setFolders(tree);
      setExpanded((prev) => (prev.size ? prev : new Set(tree.map((n) => n.id))));
    } catch (err) {
      setFoldersError(err.response?.data?.message || err.message || 'Could not load the PGN library.');
    } finally {
      setFoldersLoading(false);
    }
  }, []);

  const openSavePanel = () => {
    setSaveOpen(true);
    setSaveMessage('');
    setSaveError('');
    setFolderError('');
    loadFolders();
  };

  const handleCreateFolder = async () => {
    setFolderError('');
    const name = newFolderName.trim();
    if (!name) { setFolderError('Enter a folder name.'); return; }
    const parentId = selectedFolder ?? null;
    const duplicate = flatFolders.some(
      (f) => (f.parentId ?? null) === parentId && f.name.toLowerCase() === name.toLowerCase()
    );
    if (duplicate) {
      setFolderError(`A folder named "${name}" already exists in this location.`);
      return;
    }
    setCreating(true);
    try {
      const created = await createPgnFolder({ name, parentId });
      setNewFolderName('');
      await loadFolders();
      if (created?.id != null) {
        setSelectedFolder(created.id);
        setExpanded((prev) => {
          const next = new Set(prev);
          if (parentId != null) next.add(parentId);
          next.add(created.id);
          return next;
        });
      }
    } catch (err) {
      setFolderError(err.response?.data?.message || err.message || 'Could not create the folder.');
    } finally {
      setCreating(false);
    }
  };

  const handleSave = async () => {
    setSaveError('');
    setSaveMessage('');
    if (!includedPuzzles.length) { setSaveError('Select at least one puzzle with Include'); return; }
    if (selectedFolder == null) { setSaveError('Pick a folder to save into, or create one.'); return; }
    setSaving(true);
    try {
      const result = await savePuzzles({
        folderId: selectedFolder,
        puzzles: includedPuzzles.map((p) => ({
          fen: p.fen,
          theme: p.theme,
          themes: p.themes,
          difficulty: p.difficulty,
          rating: p.rating,
          source: p.source,
          solutionSan: p.solutionSan,
          solutionUci: p.solutionUci,
        })),
      });
      const skipped = Number(result.skipped) || 0;
      setSaveMessage(
        `${result.saved} puzzle(s) saved to ${result.folderPath}.`
        + (skipped ? ` ${skipped} already in the library and skipped.` : '')
      );
      await loadFolders();
    } catch (err) {
      setSaveError(err.response?.data?.message || err.message || 'Could not save the puzzles.');
    } finally {
      setSaving(false);
    }
  };

  const toggleInclude = (id) => {
    setIncluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /* ── derived status text ── */
  const lichessCount = puzzles.filter((p) => p.source === 'lichess').length;
  const engineCount = puzzles.length - lichessCount;
  const statusLine = puzzles.length
    ? `${puzzles.length} puzzle(s): ${lichessCount} from Lichess, ${engineCount} from engine.`
    : '';
  const warnings = Array.isArray(job?.warnings) ? job.warnings : [];

  return (
    <Page
      title="Puzzle Generator"
      piece="🧩"
      sub="Build tactic puzzles from the Lichess database and your own games, preview them, then save them into a PGN library folder."
    >
      <div className="pg-back-row">
        <Button to="/admin/courses" variant="secondary" size="sm">← Back to Courses</Button>
      </div>

      {/* ── controls ── */}
      <section className="chess-card pg-controls" aria-label="Generator controls">
        <div className="pg-grid">
          <label className="pg-field">
            <span>Tactic topic</span>
            <select value={topicId} onChange={(e) => setTopicId(e.target.value)}>
              {topics.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          </label>

          <label className="pg-field">
            <span>How many puzzles</span>
            <input
              type="number"
              min="1"
              max="100"
              value={count}
              onChange={(e) => { setCount(e.target.value); setFormError(''); }}
              aria-invalid={Boolean(formError)}
            />
            {formError === 'Enter a number from 1 to 100' && (
              <em className="pg-error">{formError}</em>
            )}
          </label>

          <label className="pg-field">
            <span>Difficulty</span>
            <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
              {DIFFICULTIES.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
            </select>
          </label>

          <label className="pg-field">
            <span>Source</span>
            <select value={source} onChange={(e) => setSource(e.target.value)}>
              {SOURCES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>

          <div className="pg-generate">
            <Button onClick={handleGenerate} disabled={running} loading={running} size="md">
              {running ? 'Generating…' : 'Generate'}
            </Button>
            {running && (
              <Button onClick={handleCancel} variant="secondary" size="md">Cancel</Button>
            )}
          </div>
        </div>

        {!topic.engine && source !== 'lichess' && (
          <p className="pg-note">
            {topic.label} has no engine theme detector yet — {source === 'engine'
              ? 'switch the source to Lichess only or Lichess + Engine.'
              : 'this run will use Lichess puzzles only.'}
          </p>
        )}
        {formError && formError !== 'Enter a number from 1 to 100' && (
          <p className="pg-error pg-error-block" role="alert">{formError}</p>
        )}

        {running && job && (
          <div className="pg-progress-wrap" aria-live="polite">
            <div className="pg-progress">
              <div className="pg-progress-fill" style={{ width: `${Math.max(3, job.progress || 0)}%` }} />
            </div>
            <p className="pg-progress-step">
              {job.step || 'Working…'}
              <span>{Math.round(job.progress || 0)}%</span>
            </p>
          </div>
        )}

        {jobError && <p className="pg-error pg-error-block" role="alert">{jobError}</p>}

        {!running && statusLine && <p className="pg-status">{statusLine}</p>}
        {!running && warnings.length > 0 && (
          <ul className="pg-warnings">
            {warnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        )}
      </section>

      {/* ── results ── */}
      {running && !puzzles.length && (
        <div className="chess-card mt-5"><Spinner text="Building your puzzles — this can take a minute or two." /></div>
      )}

      {!running && !puzzles.length && !jobError && !statusLine && (
        <div className="chess-card mt-5 pg-empty">
          <p className="pg-empty-title">No puzzles yet</p>
          <p>Pick a tactic topic, choose how many, then press Generate. Puzzles appear here one at a time on a single board.</p>
        </div>
      )}

      {current && (
        <section className="chess-card pg-viewer" aria-label="Puzzle preview">
          <header className="pg-viewer-head">
            <div className="pg-viewer-title">
              <h2>Puzzle {index + 1} of {puzzles.length}</h2>
              <div className="pg-tags">
                <Chip>{current.theme}</Chip>
                <Chip>{current.difficulty}</Chip>
                {current.rating ? <Chip>{current.rating}</Chip> : null}
                <span className={`pg-source ${current.source === 'engine' ? 'is-engine' : 'is-lichess'}`}>
                  {sourceLabel(current.source)}
                </span>
              </div>
            </div>
            <label className="pg-include">
              <input
                type="checkbox"
                checked={included.has(current.id)}
                onChange={() => toggleInclude(current.id)}
              />
              <span>Include</span>
            </label>
          </header>

          <div className="pg-board">
            <div className="pg-board-fit" ref={boardHostRef}>
              <ChessBoard
                key={`${current.id}-${previewPly}`}
                fen={preview.fen}
                interactive={false}
                clickToMove={false}
                showLegalMoves={false}
                lastMove={preview.lastMove}
                orientation={current.solverColor === 'b' ? 'black' : 'white'}
                boardWidth={boardWidth}
              />
            </div>
            <p className="pg-turn">
              {current.solverColor === 'b' ? 'Black to move' : 'White to move'}
            </p>
          </div>

          <div className="pg-nav">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => goTo(index - 1)}
              disabled={index === 0}
            >Previous</Button>

            <div className="pg-number-strip" ref={stripRef}>
              {puzzles.map((p, i) => (
                <button
                  key={p.id}
                  ref={(el) => { numberRefs.current[i] = el; }}
                  type="button"
                  className={`pg-number ${i === index ? 'is-active' : ''} ${included.has(p.id) ? '' : 'is-excluded'}`}
                  onClick={() => goTo(i)}
                  aria-current={i === index ? 'true' : undefined}
                >
                  {i + 1}
                </button>
              ))}
            </div>

            <Button
              variant="secondary"
              size="sm"
              onClick={() => goTo(index + 1)}
              disabled={index === puzzles.length - 1}
            >Next</Button>
          </div>

          <div className="pg-solution">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => { setShowSolution((v) => !v); setPreviewPly(0); }}
            >
              {showSolution ? 'Hide solution' : 'Show solution'}
            </Button>

            {showSolution && (
              <div className="pg-solution-body">
                <p className="pg-solution-line">
                  {moveNumberText(current.fen, current.solutionSan)}
                </p>
                <div className="pg-solution-steps">
                  <Button
                    variant="ghost" size="sm"
                    onClick={() => setPreviewPly((p) => Math.max(0, p - 1))}
                    disabled={previewPly === 0}
                  >◀</Button>
                  <span className="pg-step-count">{previewPly} / {current.solutionSan.length}</span>
                  <Button
                    variant="ghost" size="sm"
                    onClick={() => setPreviewPly((p) => Math.min(current.solutionSan.length, p + 1))}
                    disabled={previewPly >= current.solutionSan.length}
                  >▶</Button>
                  <button
                    type="button"
                    className="pg-reset"
                    onClick={() => setPreviewPly(0)}
                  >Reset board</button>
                </div>
              </div>
            )}
          </div>

          <div className="pg-actions">
            <Button onClick={openSavePanel} size="md">Save to PGN library</Button>
            <Button variant="secondary" size="md" onClick={() => setShowPgn((v) => !v)}>
              {showPgn ? 'Hide PGN' : 'Show PGN'}
            </Button>
            <Button variant="secondary" size="md" onClick={handleCopy}>Copy PGN</Button>
            {copied && <span className="pg-copied" role="status">{copied}</span>}
          </div>

          {showPgn && (
            <pre className="pg-pgn" aria-label="PGN for this puzzle">{current.pgn}</pre>
          )}

          {/* ── save panel ── */}
          {saveOpen && (
            <div className="pg-save">
              <div className="pg-save-head">
                <h3>Save {includedPuzzles.length} puzzle(s) to the PGN library</h3>
                <Button variant="ghost" size="sm" onClick={() => setSaveOpen(false)}>Close</Button>
              </div>

              {foldersLoading && <p className="pg-muted">Loading folders…</p>}
              {foldersError && <p className="pg-error" role="alert">{foldersError}</p>}

              {!foldersLoading && !foldersError && (
                folders.length ? (
                  <div className="pg-tree" role="tree" aria-label="PGN library folders">
                    {folders.map((node) => (
                      <FolderRow
                        key={node.id}
                        node={node}
                        depth={0}
                        expanded={expanded}
                        onToggle={(id) => setExpanded((prev) => {
                          const next = new Set(prev);
                          if (next.has(id)) next.delete(id);
                          else next.add(id);
                          return next;
                        })}
                        selectedId={selectedFolder}
                        onSelect={setSelectedFolder}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="pg-muted">No folders yet — create one below.</p>
                )
              )}

              <p className="pg-selected">
                {selectedPath
                  ? <>Selected: <strong>{selectedPath}</strong></>
                  : 'No folder selected. Pick a folder to save into, or create one.'}
              </p>

              <div className="pg-new-folder">
                <input
                  type="text"
                  value={newFolderName}
                  placeholder={selectedFolder != null
                    ? `New folder inside ${selectedPath?.split(' / ').pop() || 'selection'}`
                    : 'New top-level folder'}
                  onChange={(e) => { setNewFolderName(e.target.value); setFolderError(''); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleCreateFolder(); }}
                />
                <Button variant="secondary" size="sm" onClick={handleCreateFolder} disabled={creating || !newFolderName.trim()}>
                  {creating ? 'Creating…' : 'Create folder'}
                </Button>
              </div>
              {folderError && <p className="pg-error" role="alert">{folderError}</p>}

              {saveError && <p className="pg-error pg-error-block" role="alert">{saveError}</p>}
              {saveMessage && <p className="pg-success" role="status">{saveMessage}</p>}

              <div className="pg-save-actions">
                <Button onClick={handleSave} loading={saving} disabled={!includedPuzzles.length || selectedFolder == null}>
                  Save here
                </Button>
              </div>
            </div>
          )}
        </section>
      )}
    </Page>
  );
}
