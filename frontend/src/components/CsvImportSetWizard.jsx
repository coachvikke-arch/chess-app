import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../services/api';
import { nameWithNumbering } from '../pages/Library';
import FolderTree from './FolderTree';
import Button from './Button';

/* ── Tiny client-side CSV parser: handles quoted commas, "" escapes, CRLF ── */
function parseCsvLines(text) {
  const src = String(text || '').replace(/^\uFEFF/, '');
  const rows = [];
  let cur = [];
  let buf = '';
  let inQ = false;
  const cell = () => { cur.push(buf); buf = ''; };
  const row = () => { cell(); if (cur.some((c) => c.trim() !== '')) rows.push(cur); cur = []; };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQ) {
      if (ch === '"') { if (src[i + 1] === '"') { buf += '"'; i++; } else inQ = false; }
      else buf += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') cell();
    else if (ch === '\r') { /* skip */ }
    else if (ch === '\n') row();
    else buf += ch;
  }
  if (buf.trim() !== '' || cur.length > 0) row();
  return rows;
}

const FIELD_LABELS = {
  title: { label: 'Title / Theme', required: false, hint: 'Optional per-puzzle title' },
  fen: { label: 'FEN', required: true, hint: 'Chess position' },
  moves: { label: 'Moves', required: true, hint: 'Solution (or trigged sequence)' },
  rating: { label: 'Rating', required: false, hint: 'Optional numeric rating' },
  themes: { label: 'Themes', required: false, hint: 'Optional, space-separated' },
};

const FIELD_KEYS = Object.keys(FIELD_LABELS);

/* Multi-step CSV import wizard for "one file → one puzzle set with titles". */
export default function CsvImportSetWizard({ onClose, onImported }) {
  const [step, setStep] = useState(0); // 0 upload, 1 map, 2 importing, 3 summary
  const [fileName, setFileName] = useState('');
  const [rawCsv, setRawCsv] = useState('');
  const [headers, setHeaders] = useState([]);
  const [preview, setPreview] = useState([]);
  const [setTitle, setSetTitle] = useState('');
  const [puzzleName, setPuzzleName] = useState('');
  const [movesAreDirect, setMovesAreDirect] = useState(true);
  const [columnMap, setColumnMap] = useState({});     // fieldKey -> header key
  const [grid, setGrid] = useState([]);               // full parsed table (header + rows)
  const [previewRow, setPreviewRow] = useState(0);
  const [job, setJob] = useState(null);
  const [error, setError] = useState('');
  const [folderId, setFolderId] = useState(null);     // destination folder (null = root / no folder)
  const fileInputRef = useRef(null);
  const [folderTreeKey, setFolderTreeKey] = useState(0);

  const normalizeHeader = (h) => String(h || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');

  const autoDetectMap = useCallback((hdrs) => {
    const map = {};
    // Prefer exact/obvious header names first.
    for (const key of FIELD_KEYS) {
      const nk = normalizeHeader(key);
      const idx = hdrs.findIndex((h) => normalizeHeader(h) === nk);
      if (idx >= 0) { map[key] = hdrs[idx]; continue; }
    }
    if (!map.title) {
      // Accept Theme/Title-like columns.
      const t = hdrs.find((h) => /title|theme/i.test(h));
      if (t) map.title = t;
    }
    if (!map.moves) { const m = hdrs.find((h) => /solution|solut/i.test(h)); if (m) map.moves = m; }
    return map;
  }, []);

  const handleFile = (file) => {
    if (!file) return;
    setError('');
    setFileName(file.name);
    file.text().then((text) => {
      const parsedGrid = parseCsvLines(text);
      if (parsedGrid.length === 0) { setError('The file appears to be empty.'); return; }
      const hdrs = parsedGrid[0];
      setHeaders(hdrs);
      setGrid(parsedGrid);
      setPreview(parsedGrid.slice(1, 6));
      setRawCsv(text);
      const map = autoDetectMap(hdrs);
      setColumnMap(map);
      // Suggest a set title from the file name (without extension).
      setSetTitle((prev) => prev || file.name.replace(/\.csv$/i, '').trim());
      setStep(1); // confirm mapping + naming before import
    }).catch(() => setError('Could not read that file.'));
  };

  const mappedCells = (rowCells, rowHeaders) => {
    const out = {};
    for (const key of FIELD_KEYS) {
      const hk = columnMap[key];
      if (!hk) { out[key] = ''; continue; }
      const idx = rowHeaders.indexOf(hk);
      out[key] = idx >= 0 ? rowCells[idx] : '';
    }
    return out;
  };

  const canStart = setTitle.trim() && columnMap.fen && columnMap.moves;

  /* Rows that will actually produce a puzzle (mirrors the backend validator's
     acceptance rules) — used to preview the "{baseName} #N" naming. */
  const validRowCount = useMemo(() => {
    if (grid.length < 2) return 0;
    let count = 0;
    for (const cells of grid.slice(1)) {
      const m = mappedCells(cells, headers);
      if (!m.fen && !m.moves) continue; // blank spacer row
      if (!m.fen || !m.moves) continue;
      const moveCount = String(m.moves || '').split(/[\s_,|]+/).filter(Boolean).length;
      if (moveCount === 0) continue;
      if (!movesAreDirect && moveCount < 2) continue;
      count++;
    }
    return count;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid, columnMap, headers, movesAreDirect]);

  const startImport = async () => {
    if (!canStart) return;
    setError('');
    setStep(2);
    setJob(null);
    try {
      const res = await api.post('/puzzles/import-csv-set', {
        csv: rawCsv,
        setTitle: setTitle.trim(),
        puzzleName: puzzleName.trim(),
        columnMap,
        movesAreDirect,
        fileName,
        folderId: folderId ?? null,
      });
      pollJob(res.data.jobId);
    } catch (err) {
      setError(err.response?.data?.message || err.message);
      setStep(1);
    }
  };

  const pollJob = async (jobId) => {
    let lastStatus = 'processing';
    const tick = async () => {
      const r = await api.get(`/puzzles/import-jobs/${jobId}`, { cache: false });
      setJob(r.data);
      lastStatus = r.data.status;
      if (r.data.status === 'done' || r.data.status === 'error') {
        setStep(3);
        if (r.data.status === 'done' && onImported) onImported();
      } else {
        setTimeout(tick, 700);
      }
    };
    try { await tick(); } catch { setJob({ status: 'error', error: 'Could not reach the import job.' }); setStep(3); }
  };

  const downloadErrors = () => {
    if (!job) return;
    fetchJobCsv(job.id);
  };

  const fetchJobCsv = async (jobId) => {
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/puzzles/import-jobs/${jobId}/errors.csv`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const text = await res.text();
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `import-errors-${jobId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const summary = job || {};
  const pct = summary.totalRows ? Math.round(((summary.processed || 0) / summary.totalRows) * 100) : 0;

  return (
    <div className="fixed inset-0 z-[var(--z-modal-backdrop)] grid place-items-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-[min(94vw,52rem)] max-h-[90vh] overflow-y-auto rounded-2xl border border-ivory-700/50 bg-ink-800 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-xl font-bold flex items-center gap-2">
            <span className="text-gold-400">📦</span> Import Puzzles from CSV <span className="text-ivory-500 text-sm font-medium">→ one set</span>
          </h2>
          <button onClick={onClose} className="text-ivory-500 hover:text-ivory-300 text-xl leading-none" title="Close">×</button>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 text-xs mb-5">
          {['Upload CSV', 'Map columns', 'Import', 'Done'].map((label, i) => (
            <div key={label} className="flex items-center gap-2">
              <span className={`px-2.5 py-1 rounded-full border text-[0.7rem] font-semibold ${
                i === step ? 'border-gold-400/60 bg-gold-500/15 text-gold-500'
                : i < step ? 'border-emerald-400/50 bg-emerald-500/10 text-emerald-600'
                : 'border-ivory-700/60 text-ivory-500'}`}>{i + 1} {label}</span>
              {i < 3 && <span className="text-ivory-500">→</span>}
            </div>
          ))}
        </div>

        {/* STEP 0 — upload */}
        {step === 0 && (
          <div>
            <label className="block w-full cursor-pointer rounded-xl border-2 border-dashed border-gold-500/30 bg-black/[0.02] p-10 text-center hover:border-gold-500/60 transition">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv,text/plain"
                className="hidden"
                onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ''; }}
              />
              <div className="text-5xl mb-3">📤</div>
              <p className="text-gold-500 font-semibold">Choose a CSV file</p>
              <p className="text-ivory-500 text-sm mt-1">PuzzleId, FEN, Moves, Rating, Title… — extra columns are safe to include.</p>
            </label>
            {error && <p className="mt-3 text-sm chess-error">{error}</p>}
          </div>
        )}

        {/* STEP 1 — mapping preview */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs uppercase tracking-wider text-ivory-500 font-semibold">Set / folder name</label>
                <input
                  className="chess-input mt-1 w-full"
                  value={setTitle}
                  onChange={(e) => setSetTitle(e.target.value)}
                  placeholder="e.g. Mate in 2 – Beginner Set"
                />
                <p className="text-[0.7rem] text-ivory-500 mt-1">All rows are grouped into this one set.</p>
              </div>
              <div>
                <label className="text-xs uppercase tracking-wider text-ivory-500 font-semibold">Moves column format</label>
                <select className="chess-input mt-1 w-full" value={movesAreDirect ? 'direct' : 'trigger'} onChange={(e) => setMovesAreDirect(e.target.value === 'direct')}>
                  <option value="direct">Moves are the solution (FEN is the puzzle position)</option>
                  <option value="trigger">First move is a trigger (lichess-style)</option>
                </select>
              </div>
            </div>

            <div className="rounded-xl border border-ivory-700/50 bg-black/[0.02] p-4">
              <label className="text-xs uppercase tracking-wider text-ivory-500 font-semibold">Puzzle Name (optional)</label>
              <input
                className="chess-input mt-1 w-full"
                value={puzzleName}
                onChange={(e) => setPuzzleName(e.target.value)}
                placeholder="e.g. Mate in 4 — blank keeps each row's own title"
              />
              {puzzleName.trim() ? (
                validRowCount > 0 ? (
                  <div className="mt-2 rounded-lg border border-ivory-700/50 bg-black/[0.02] p-3">
                    <p className="text-xs text-ivory-500">
                      {validRowCount === 1
                        ? `1 puzzle will be named ${puzzleName.trim()} #1`
                        : `${validRowCount} puzzles will be named ${puzzleName.trim()} #1 to #${validRowCount}`}
                    </p>
                    <div className="mt-1.5 flex flex-col gap-1">
                      {Array.from({ length: Math.min(validRowCount, 5) }, (_, i) => (
                        <span key={i} className="text-xs font-mono text-ivory-300">
                          #{i + 1} → {nameWithNumbering(puzzleName.trim(), 'hash', i + 1)}
                        </span>
                      ))}
                      {validRowCount > 5 && <span className="text-[0.7rem] text-ivory-500">… and {validRowCount - 5} more</span>}
                    </div>
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-red-600/80">No valid rows found in the CSV — check that FEN and Moves are mapped.</p>
                )
              ) : (
                <p className="mt-2 text-xs text-ivory-500">Leave blank to keep each row's own title (or “Puzzle #N”).</p>
              )}
            </div>

            <div className="rounded-xl border border-ivory-700/50 bg-black/[0.02] p-4">
              <p className="text-xs uppercase tracking-wider text-ivory-500 font-semibold mb-3">Column mapping</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {FIELD_KEYS.map((key) => (
                  <div key={key} className="flex items-center justify-between gap-2">
                    <label className="text-sm text-ivory-300 flex-1">
                      <span className="text-gold-400">{FIELD_LABELS[key].label}</span>
                      {!FIELD_LABELS[key].required && <span className="text-ivory-500 text-xs"> (optional)</span>}
                      {!FIELD_LABELS[key].required && <span className="text-ivory-500 text-xs"> (auto)</span>}
                    </label>
                    <select
                      className="chess-input !py-1.5 text-sm flex-1"
                      value={columnMap[key] || ''}
                      onChange={(e) => setColumnMap((m) => ({ ...m, [key]: e.target.value }))}
                    >
                      <option value="">— none —</option>
                      {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                ))}
              </div>
              {(!columnMap.fen || !columnMap.moves) && (
                <p className="text-xs text-red-600 mt-2">FEN and Moves must both be mapped.</p>
              )}
            </div>

            {/* Destination folder (tree picker) */}
            <div className="rounded-xl border border-ivory-700/50 bg-black/[0.02] p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs uppercase tracking-wider text-ivory-500 font-semibold">Destination folder</p>
                <span className="text-[0.65rem] text-ivory-500">
                  {folderId ? `Picked folder #${folderId}` : 'Top level (no folder)'}
                </span>
              </div>
              <FolderTree
                key={folderTreeKey}
                compact
                selectedId={folderId}
                onSelect={(id) => setFolderId(id ?? null)}
                onChanged={() => setFolderTreeKey((k) => k + 1)}
              />
              {folderId !== null && (
                <button
                  type="button"
                  onClick={() => setFolderId(null)}
                  className="mt-1.5 text-xs text-ivory-500 hover:text-ivory-300 transition"
                >
                  Upload to top level instead (no folder)
                </button>
              )}
            </div>

            {/* Preview */}
            <div className="rounded-xl border border-ivory-700/50 bg-black/[0.02] p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs uppercase tracking-wider text-ivory-500 font-semibold">Preview (first {preview.length} rows)</p>
                <div className="flex items-center gap-2">
                  <Button disabled={previewRow === 0} onClick={() => setPreviewRow((r) => Math.max(0, r - 1))} variant="secondary" size="sm" className="!px-2 !py-1 text-xs">◀</Button>
                  <span className="text-xs text-ivory-500">{previewRow + 1} / {preview.length || 1}</span>
                  <Button disabled={previewRow >= preview.length - 1} onClick={() => setPreviewRow((r) => Math.min(preview.length - 1, r + 1))} variant="secondary" size="sm" className="!px-2 !py-1 text-xs">▶</Button>
                </div>
              </div>
              {preview.length > 0 ? (() => {
                const cells = preview[previewRow];
                const m = mappedCells(cells, headers);
                return (
                  <div className="space-y-1 text-sm">
                    <p><span className="text-ivory-500">Title:</span> <span className="text-ivory-300">{m.title || '(auto: Puzzle #…)'}</span></p>
                    <p className="break-all"><span className="text-ivory-500">FEN:</span> <span className="font-mono text-ivory-300">{m.fen || '—'}</span></p>
                    <p className="break-all"><span className="text-ivory-500">Moves:</span> <span className="font-mono text-ivory-300">{m.moves || '—'}</span></p>
                    <p><span className="text-ivory-500">Rating:</span> <span className="text-ivory-300">{m.rating || '—'}</span> <span className="ml-3 text-ivory-500">Themes:</span> <span className="text-ivory-300">{m.themes || '—'}</span></p>
                  </div>
                );
              })() : <p className="text-sm chess-empty">No data rows.</p>}
            </div>

            <div className="flex justify-end gap-2">
              <Button onClick={() => setStep(0)} variant="secondary" size="md" className="!px-4">Back</Button>
              <Button disabled={!canStart} onClick={startImport} variant="primary" size="md" className="!px-5 disabled:opacity-40">Start Import</Button>
            </div>
            {error && <p className="text-sm chess-error">{error}</p>}
          </div>
        )}

        {/* STEP 2 — importing (progress) */}
        {step === 2 && (
          <div className="py-6 text-center">
            <div className="chess-spinner mb-3 text-4xl"><span>♞</span></div>
            <p className="font-semibold text-ivory-300">Importing into “{setTitle}”…</p>
            <p className="text-sm text-ivory-500 mt-1 mb-4">{fileName} · validating FEN + moves</p>
            <div className="mx-auto max-w-md">
              <div className="chess-bar"><div className="chess-bar-fill" style={{ width: `${pct}%` }} /></div>
              <p className="text-xs text-ivory-500 mt-2">{pct}% — {summary.processed || 0} / {summary.totalRows || '…'} rows</p>
            </div>
            {error && <p className="mt-3 text-sm chess-error">{error}</p>}
          </div>
        )}

        {/* STEP 3 — summary */}
        {step === 3 && (
          <div className="space-y-4">
            {summary.status === 'done' ? (
              <>
                <div className="rounded-xl border border-ivory-700/50 bg-black/[0.02] p-4">
                  <p className="font-semibold text-ivory-300 flex items-center gap-2">✅ Import complete — “{summary.setTitle}” is ready to assign.</p>
                  <p className="text-sm text-ivory-500 mt-1">{summary.fileName} · {summary.setCode ? `set ${summary.setCode}` : ''}</p>
                </div>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="rounded-xl border border-ivory-700/50 p-3"><p className="text-2xl font-bold text-ivory-300">{summary.totalRows || 0}</p><p className="text-xs text-ivory-500">Total rows</p></div>
                  <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-3"><p className="text-2xl font-bold text-emerald-600">{summary.imported || 0}</p><p className="text-xs text-emerald-600/70">Imported</p></div>
                  <div className={`rounded-xl border p-3 ${summary.skipped ? 'border-red-400/30 bg-red-500/10' : 'border-ivory-700/50'}`}><p className="text-2xl font-bold text-ivory-300">{summary.skipped || 0}</p><p className="text-xs text-ivory-500">Skipped</p></div>
                </div>

                {(summary.errors || []).length > 0 && (
                  <details className="mt-2">
                    <summary className="text-xs text-red-600 cursor-pointer">{summary.errors.length} row{summary.errors.length === 1 ? '' : 's'} failed — show details</summary>
                    <ul className="mt-2 max-h-44 overflow-y-auto space-y-1 rounded-xl border border-red-400/20 bg-red-500/5 p-2">
                      {summary.errors.map((e, i) => (
                        <li key={i} className="text-[0.7rem] text-red-600/90"><span className="text-red-600 font-semibold">Row {e.row}:</span> {e.reason}</li>
                      ))}
                    </ul>
                  </details>
                )}

                <div className="flex flex-wrap justify-end gap-2 mt-3">
                  {(summary.errors || []).length > 0 && <Button onClick={downloadErrors} variant="secondary" size="md" className="!px-4">Download error report (CSV)</Button>}
                  <Button onClick={onClose} variant="primary" size="md" className="!px-5">Done</Button>
                </div>
              </>
            ) : (
              <div className="text-center">
                <div className="text-4xl mb-2">⚠️</div>
                <p className="font-semibold text-ivory-300">Import failed</p>
                <p className="text-sm text-ivory-500 mt-1">{summary.error || 'Unknown error'}</p>
                <div className="flex justify-center gap-2 mt-4">
                  <Button onClick={() => setStep(1)} variant="secondary" size="md" className="!px-4">Back to mapping</Button>
                </div>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}