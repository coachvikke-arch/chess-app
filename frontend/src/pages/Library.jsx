import { useCallback, useEffect, useMemo, useRef, useState, Fragment } from 'react';
import { useUrlView } from '../hooks/useUrlView';
import { Chess } from 'chess.js';
import { Folder, House, EllipsisVertical, Puzzle } from 'lucide-react';
import ChessBoard from '../components/ChessBoard';
import { Page, Card, Chip, Spinner } from '../components/ui';
import { useToast } from '../components/Toast';
import {
  fetchLibrary,
  createFolder as apiCreateFolder,
  updateFolder as apiUpdateFolder,
  deleteFolder as apiDeleteFolder,
  createItem as apiCreateItem,
  createItems as apiCreateItems,
  updateItem as apiUpdateItem,
  deleteItem as apiDeleteItem,
  reorderItem as apiReorderItem,
  importLibrary,
  bulkRenameItems,
  readLegacyLibrary,
  clearLegacyLibrary,
} from '../utils/libraryApi';
import FolderTree from '../components/FolderTree';
import api from '../services/api';
import useArrowKeys from '../hooks/useArrowKeys';
import Button from '../components/Button';

/* ── storage ─────────────────────────────────────────────────────────────── */

const PAGE_SIZE = 8;
const INVALID_NAME = /[/\\:*?"<>|]/;

/* The library is server-backed and shared by every admin + the superadmin.
   The old per-browser localStorage copy is read exactly once, for the one-time
   import prompt (see `importOffer` below). There is no write-back to it. */

const EMPTY_LIBRARY = { folders: [] };

/* ── helpers ─────────────────────────────────────────────────────────────── */

function validateFolderName(name, parentId, folders) {
  const value = String(name || '').trim();
  if (!value) return 'Folder name cannot be empty.';
  if (INVALID_NAME.test(value)) return 'Folder name cannot contain / \\ : * ? " < > |';
  const dupe = folders.some((f) => f.parentId === parentId && f.name.toLowerCase() === value.toLowerCase());
  if (dupe) return `A folder named "${value}" already exists in this location.`;
  return '';
}

function validateNotation(type, notation) {
  const value = String(notation || '').trim();
  if (!value) return 'Notation cannot be empty.';
  try {
    if (type === 'pgn') {
      const g = new Chess();
      g.loadPgn(value);
      if (g.history().length === 0) return 'No moves found in this PGN.';
    } else {
      new Chess(value); // throws if invalid
    }
    return '';
  } catch {
    return type === 'pgn' ? 'Invalid PGN — check the move text.' : 'Invalid FEN — check the position.';
  }
}

/* ── bulk upload: PGN vs Lichess puzzle CSV ───────────────────────────────── */

/* Route a selected file to the right parser based on extension, then content. */
function detectLibraryUploadType(name, text) {
  if (/\.csv$/i.test(name)) return 'csv';
  if (/\.pgn$/i.test(name)) return 'pgn';
  const head = (text || '').replace(/\r?\n/, ' ').slice(0, 120).toLowerCase();
  return /,/.test(head) && /(fen|moves|puzzleid)/.test(head) ? 'csv' : 'pgn';
}

/* Parse a Lichess puzzle export header: PuzzleId,FEN,Moves,Rating,...,Themes,GameUrl,OpeningTags,DailyDate */
function parseLichessCsv(raw) {
  const lines = String(raw || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const header = (lines[0] || '').split(',').map((h) => h.replace(/^"+|"+$/g, '').trim().toLowerCase());
  const find = (needle) => header.findIndex((h) => h === needle || h.includes(needle));
  const iFen = find('fen');
  const iMoves = find('moves');
  const iPuzzle = find('puzzleid');
  const iRating = find('rating');
  const iThemes = find('themes');
  const iGameUrl = find('gameurl');
  const iOpening = find('openingtags');
  if (iFen < 0 || iMoves < 0) return { format: false, rows: [] };

  const rows = [];
  for (let n = 1; n < lines.length; n++) {
    const cols = lines[n].split(',');
    const get = (idx) => (idx >= 0 ? (cols[idx] || '').replace(/^"+|"+$/g, '').trim() : '');
    if (!get(iFen)) continue;
    rows.push({
      row: n + 1,
      puzzleId: get(iPuzzle),
      fen: get(iFen),
      moves: get(iMoves),
      rating: get(iRating),
      themes: get(iThemes),
      gameUrl: get(iGameUrl),
      openingTags: get(iOpening),
    });
  }
  return { format: true, rows };
}

/* Server CSV column auto-map — mirrors the CSV import wizard's detection so a
   Library upload can also create a Puzzle-listing set from the same file. */
function csvColumnAutoMap(text) {
  const first = String(text || '').split(/\r?\n/).find((l) => l.trim() !== '');
  if (!first) return {};
  const headers = first.split(',').map((h) => h.replace(/^"+|"+$/g, '').trim()).filter(Boolean);
  const findExact = (k) => headers.find((h) => h.toLowerCase() === k);
  const findCont = (k) => headers.find((h) => h.toLowerCase().includes(k));
  const map = {};
  const fen = findExact('fen') || findCont('fen');
  if (fen) map.fen = fen;
  const moves = findExact('moves') || findCont('moves');
  if (moves) map.moves = moves;
  const rating = findExact('rating') || findCont('rating');
  if (rating) map.rating = rating;
  const themes = findExact('themes') || findCont('themes');
  if (themes) map.themes = themes;
  const title = findExact('puzzleid') || headers.find((h) => /puzzle\s?[-_]?id/i.test(h)) || findExact('title') || findCont('theme');
  if (title) map.title = title;
  return map;
}

/* Mirror a puzzle CSV upload to the Puzzle Listing as a server set (the same
   endpoint the CSV import wizard uses). Returns the created set's title.
   Retries transient failures (network, 429 rate-limit, 5xx) a few times before
   giving up, so a single flaky response doesn't drop the set. */
async function mirrorPuzzleCsvSet(csvText, fileName, movesAreDirect) {
  const setTitle = String(fileName || '').replace(/\.csv$/i, '').trim() || 'Puzzle set';
  const payload = {
    csv: csvText,
    setTitle,
    columnMap: csvColumnAutoMap(csvText),
    movesAreDirect: Boolean(movesAreDirect),
    puzzleName: '',
    fileName,
    folderId: null,
  };
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await api.post('/puzzles/import-csv-set', { ...payload });
      return setTitle;
    } catch (err) {
      const status = err && err.response ? err.response.status : 0;
      const retriable = !status || status === 408 || status === 429 || status >= 500;
      if (!retriable || attempt === maxAttempts) throw err;
      await new Promise((res) => setTimeout(res, attempt * 800));
    }
  }
  throw new Error('mirror failed');
}

function moveFromUci(uci) {
  const mv = { from: uci.slice(0, 2), to: uci.slice(2, 4) };
  if (uci.length > 4) mv.promotion = uci.slice(4);
  return mv;
}

/* Convert one Lichess row into a PGN-style library entry (UCI → SAN via chess.js). */
function puzzleEntryFromCsvRow(row, skipTriggers, today) {
  const fen = String(row.fen || '').trim();
  const uciMoves = String(row.moves || '').trim().split(/\s+/).filter(Boolean);
  if (!fen) return { error: `row ${row.row} has no FEN` };
  if (uciMoves.length === 0) return { error: `row ${row.row} has no moves` };
  try {
    let startFen = fen;
    let solution = uciMoves;
    if (skipTriggers) {
      if (uciMoves.length < 2) return { error: `row ${row.row} is only a trigger move — nothing left to solve` };
      const setup = new Chess(fen);
      setup.move(moveFromUci(uciMoves[0]));
      startFen = setup.fen();
      solution = uciMoves.slice(1);
    }
    const game = new Chess(startFen);
    for (const uci of solution) game.move(moveFromUci(uci));
    const themes = String(row.themes || '').split(/\s+/).filter(Boolean);
    const opening = String(row.openingTags || '').split(/\s+/).filter(Boolean);
    return {
      item: {
        title: String(row.puzzleId || `Puzzle ${row.rating || '_'}`).trim() || 'Puzzle',
        type: 'pgn',
        notation: game.pgn({ maxWidth: 0 }),
        createdAt: today,
        source: 'lichess-puzzle',
        meta: {
          puzzleId: String(row.puzzleId || '').trim(),
          rating: row.rating ? (Number(row.rating) || row.rating) : null,
          themes,
          gameUrl: String(row.gameUrl || '').trim(),
          opening,
        },
      },
    };
  } catch (err) {
    return { error: `row ${row.row}: ${String(err?.message || err).replace(/^Error:?\s*/i, '')}` };
  }
}

export function buildReplay(item, moveIndex) {
  if (!item) return null;
  if (item.type === 'pgn') {
    try {
      const full = new Chess();
      full.loadPgn(item.notation);
      const moves = full.history({ verbose: true });
      const idx = Math.max(0, Math.min(moveIndex, moves.length));
      /* Seed the display game from the PGN's real starting position. Files that
         begin from a non-standard position (e.g. puzzle entries with a
         [SetUp "1"]/[FEN "..."] header) MUST replay from that FEN — replaying
         from a fresh standard board makes every move illegal and silently
         falls back to an empty board. */
      const startFen = full.header().FEN || new Chess().fen();
      const startSide = sideOf(startFen);
      const game = new Chess(startFen);
      for (let i = 0; i < idx; i++) game.move(moves[i]);
      return {
        game,
        moves,
        startSide,
        lastMove: idx > 0 ? { from: moves[idx - 1].from, to: moves[idx - 1].to } : null,
      };
    } catch {
      return { game: new Chess(), moves: [], startSide: 'w', lastMove: null };
    }
  }
  try {
    const game = new Chess(item.notation);
    return { game, moves: [], startSide: sideOf(item.notation), lastMove: null };
  } catch {
    return { game: new Chess(), moves: [], startSide: 'w', lastMove: null };
  }
}

/* Which side is to move in a FEN string ('w' | 'b'). */
function sideOf(fen) {
  const t = String(fen || '').trim().split(/\s+/)[1] || 'w';
  return t === 'b' ? 'b' : 'w';
}

/* Build numbered move rows. When a PGN starts with Black to move (FEN header
   says 'b'), move index 0 is Black's, the first row renders "1... X", and the
   next pair is numbered 2 (white then black) — matching real PGN notation. */
export function pairRows(moves, startSide = 'w') {
  const blackFirst = startSide === 'b' && moves.length > 0;
  const rows = [];
  if (blackFirst) {
    rows.push({ number: 1, white: null, whiteIdx: null, black: moves[0], blackIdx: 0 });
    for (let i = 1; i < moves.length; i += 2) {
      rows.push({
        number: Math.floor(i / 2) + 2,
        white: moves[i],
        whiteIdx: i,
        black: moves[i + 1] || null,
        blackIdx: i + 1 === moves.length ? null : i + 1,
      });
    }
  } else {
    for (let i = 0; i < moves.length; i += 2) {
      rows.push({
        number: Math.floor(i / 2) + 1,
        white: moves[i],
        whiteIdx: i,
        black: moves[i + 1] || null,
        blackIdx: i + 1 === moves.length ? null : i + 1,
      });
    }
  }
  return rows;
}

/* Responsive board width: fill its column, capped at 460px. */
function useBoardWidth() {
  const ref = useRef(null);
  const [w, setW] = useState(420);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, Math.max(240, Math.min(w, 460))];
}

export { useBoardWidth };

/* The themed frame adds a marble band + border around the inner squares, so a
   board sized to the full column width overflows it. On narrow screens the
   inner board is fitted to the frame-overhead rule used by the live boards
   (outer ≈ inner·1.164 + 30, or inner + 70 for small boards), within the
   document width minus the page/card chrome. Wide layouts keep the 460 cap. */
function fitBoardToViewport(raw, docW) {
  const capped = Math.max(240, Math.min(raw, 460));
  if (!docW || docW > 900) return capped;
  const budget = Math.max(200, docW - 56);
  return Math.max(200, Math.min(capped, Math.floor(Math.min((budget - 30) / 1.164, budget - 70))));
}

/* ── modal primitives ────────────────────────────────────────────────────── */

function Overlay({ children, onClose, wide }) {
  return (
    <div className="fixed inset-0 z-[var(--z-modal)] grid place-items-center bg-black/60 backdrop-blur-[2px] p-4" onMouseDown={onClose}>
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className={`w-full ${wide ? 'max-w-lg' : 'max-w-md'} rounded-2xl border border-ivory-700/50 bg-ink-900 shadow-[0_24px_70px_-20px_rgba(0,0,0,0.7)] p-5 max-h-[92vh] overflow-y-auto`}
      >
        {children}
      </div>
    </div>
  );
}

function Field({ label, children, hint }) {
  return (
    <label className="block mb-3.5">
      <span className="block text-xs font-semibold text-ivory-300 mb-1.5">{label}</span>
      {children}
      {hint && <span className="block text-[0.65rem] text-ivory-500 mt-1">{hint}</span>}
    </label>
  );
}

const FOLDER_TYPES = [
  { value: 'general', label: 'General' },
  { value: 'pgn', label: 'PGN Storage' },
  { value: 'fen', label: 'FEN Storage' },
  { value: 'mixed', label: 'Mixed' },
];

/* ── create folder modal ─────────────────────────────────────────────────── */

function FolderModal({ folders, initialParentId, onSubmit, onClose }) {
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState(initialParentId || 'root');
  const [description, setDescription] = useState('');
  const [type, setType] = useState('general');
  const [error, setError] = useState('');

  const parents = folders.filter((f) => f.parentId !== initialParentId || true);

  function submit(e) {
    e.preventDefault();
    const err = validateFolderName(name, parentId === 'root' ? null : parentId, folders);
    if (err) {
      setError(err);
      return;
    }
    onSubmit({ name: name.trim(), parentId: parentId === 'root' ? null : parentId, description: description.trim(), type });
  }

  return (
    <Overlay onClose={onClose}>
      <h3 className="text-base font-bold text-ivory-300 mb-4">Create New Folder</h3>
      <form onSubmit={submit}>
        <Field label="Folder Name">
          <input
            className="chess-input w-full"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Mating Motifs 1"
            autoFocus
          />
        </Field>

        <Field label="Parent Folder / Location">
          <select className="chess-input w-full" value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="root">Root (top level)</option>
            {parents
              .filter((f) => f.id !== initialParentId)
              .map((f) => (
                <option key={f.id} value={f.id}>
                  📁 {f.name}
                </option>
              ))}
          </select>
        </Field>

        <Field label="Description" hint="Optional — a short note for this folder.">
          <textarea
            className="chess-input w-full resize-none"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What will live in this folder?"
          />
        </Field>

        <Field label="Folder Type" hint="Optional — links content to imported games and tools.">
          <div className="grid grid-cols-2 gap-2">
            {FOLDER_TYPES.map((t) => (
              <button
                type="button"
                key={t.value}
                onClick={() => setType(t.value)}
                className={`text-left px-3 py-2 rounded-lg text-xs font-semibold border transition ${
                  type === t.value
                    ? 'border-gold-500/50 bg-gold-500/10 text-gold-400'
                    : 'border-ivory-700/50 bg-black/[0.03] text-ivory-500 hover:bg-black/[0.06]'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </Field>

        {error && <p className="text-xs text-red-600 mb-3">⚠ {error}</p>}

        <div className="flex justify-end gap-2 mt-2">
          <Button type="button" onClick={onClose} variant="secondary" size="md" className="!py-2 !px-4 text-sm">
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="md" className="!py-2 !px-4 text-sm">
            Create Folder
          </Button>
        </div>
      </form>
    </Overlay>
  );
}

/* ── add / rename item modal ─────────────────────────────────────────────── */

function ItemModal({ folder, editing, onSave, onClose }) {
  const [title, setTitle] = useState(editing ? editing.title : '');
  const [type, setType] = useState(editing ? editing.type : 'pgn');
  const [notation, setNotation] = useState(editing ? editing.notation : '');
  const [error, setError] = useState('');

  function submit(e) {
    e.preventDefault();
    const t = title.trim();
    if (!t) {
      setError('Title cannot be empty.');
      return;
    }
    const verr = validateNotation(type, notation);
    if (verr) {
      setError(verr);
      return;
    }
    onSave({ title: t, type, notation: notation.trim() });
  }

  return (
    <Overlay onClose={onClose} wide>
      <h3 className="text-base font-bold text-ivory-300 mb-1">
        {editing ? 'Rename entry' : 'Add New Entry'}
      </h3>
      <p className="text-xs text-ivory-500 mb-4">Inside “{folder.name}”</p>
      <form onSubmit={submit}>
        <Field label="Title">
          <input className="chess-input w-full" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Back-rank mate" autoFocus />
        </Field>

        <div className="flex gap-2 mb-3.5">
          {['pgn', 'fen'].map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={`flex-1 px-3 py-2 rounded-lg text-xs font-bold border transition ${
                type === t
                  ? 'border-gold-500/50 bg-gold-500/10 text-gold-400'
                  : 'border-ivory-700/50 bg-black/[0.03] text-ivory-500 hover:bg-black/[0.06]'
              }`}
            >
              {t === 'pgn' ? 'PGN (game moves)' : 'FEN (position only)'}
            </button>
          ))}
        </div>

        <Field label={type === 'pgn' ? 'PGN Notation' : 'FEN Notation'} hint={type === 'pgn' ? 'Paste a full PGN — or a move list like “1. e4 e5”.' : 'A single FEN string, e.g. rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'}>
          <textarea
            className="chess-input w-full resize-none font-mono text-xs"
            rows={5}
            value={notation}
            onChange={(e) => setNotation(e.target.value)}
            placeholder={type === 'pgn' ? '1. e4 e5 2. Nf3 Nc6 …' : 'FEN here…'}
          />
        </Field>

        {error && <p className="text-xs text-red-600 mb-3">⚠ {error}</p>}

        <div className="flex justify-end gap-2 mt-2">
          <Button type="button" onClick={onClose} variant="secondary" size="md" className="!py-2 !px-4 text-sm">
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="md" className="!py-2 !px-4 text-sm">
            {editing ? 'Save' : 'Add Entry'}
          </Button>
        </div>
      </form>
    </Overlay>
  );
}

/* ── bulk rename modal ───────────────────────────────────────────────────── */

const NUMBER_STYLES = [
  { key: 'hash', label: '#1 #2 #3', format: (n) => `#${n}` },
  { key: 'plain', label: '1 2 3', format: (n) => `${n}` },
  { key: 'paren', label: '(1) (2) (3)', format: (n) => `(${n})` },
];

/* ── shared "{baseName} {numbering}" naming — used by bulk rename AND import ── */

export function nameWithNumbering(baseName, styleKey, index) {
  const style = NUMBER_STYLES.find((s) => s.key === styleKey) || NUMBER_STYLES[0];
  return `${baseName} ${style.format(index)}`;
}

const BULK_ORDER_OPTIONS = [
  { key: 'order', label: 'As shown in list' },
  { key: 'alpha', label: 'Alphabetical A→Z' },
  { key: 'rating', label: 'Rating high→low' },
];

function orderedItems(items, orderKey) {
  const arr = [...items];
  if (orderKey === 'alpha') {
    arr.sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), undefined, { sensitivity: 'base' }));
  } else if (orderKey === 'rating') {
    arr.sort((a, b) => Number(b.meta?.rating || 0) - Number(a.meta?.rating || 0));
  }
  return arr;
}

function BulkRenameModal({ folder, onApply, onClose }) {
  const [base, setBase] = useState('');
  const [styleKey, setStyleKey] = useState('hash');
  const [orderKey, setOrderKey] = useState('order');
  const [step, setStep] = useState('config'); // 'config' | 'confirm'

  const baseName = base.trim();
  const renames = useMemo(() => {
    if (!baseName) return [];
    return orderedItems(folder.items, orderKey).map((it, i) => ({
      id: it.id,
      title: nameWithNumbering(baseName, styleKey, i + 1),
    }));
  }, [baseName, styleKey, orderKey, folder.items]);

  /* segmented option buttons (numbering style / file order) */
  const segment = (options, key, setKey) => (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => setKey(o.key)}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition ${
            key === o.key
              ? 'border-gold-500/50 bg-gold-500/10 text-gold-400'
              : 'border-ivory-700/50 bg-black/[0.03] text-ivory-500 hover:bg-black/[0.06]'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );

  return (
    <Overlay onClose={onClose} wide>
      {step === 'config' ? (
        <>
          <h3 className="text-base font-bold text-ivory-300 mb-1">Rename all files</h3>
          <p className="text-xs text-ivory-500 mb-4">
            {folder.items.length} file{folder.items.length === 1 ? '' : 's'} in “{folder.name}” — Puzzle IDs are kept, only the display name changes.
          </p>

          <Field label="Base name">
            <input
              className="chess-input w-full"
              value={base}
              onChange={(e) => setBase(e.target.value)}
              placeholder={folder.name.replace(/[\s]+[A-Z]$/, '') || 'e.g. Mate in 4'}
              autoFocus
            />
          </Field>

          <div className="mb-3">
            <p className="text-xs font-bold text-ivory-300 mb-1.5">Numbering style</p>
            {segment(NUMBER_STYLES, styleKey, setStyleKey)}
          </div>

          <div className="mb-4">
            <p className="text-xs font-bold text-ivory-300 mb-1.5">Order files by</p>
            {segment(BULK_ORDER_OPTIONS, orderKey, setOrderKey)}
          </div>

          <p className="text-xs font-bold text-ivory-300 mb-1.5">
            Preview ({renames.length} of {folder.items.length})
          </p>
          <div className="rounded-lg border border-ivory-700/50 bg-black/[0.02] p-3 max-h-40 overflow-y-auto mb-4">
            {renames.length === 0 && <p className="text-xs text-ivory-500">Type a base name to see a preview.</p>}
            {renames.slice(0, 8).map((r) => (
              <div key={r.id} className="flex items-center gap-2 text-xs font-mono py-0.5">
                <span className="text-ivory-500">→</span>
                <span className="text-ivory-500 truncate">{r.title}</span>
              </div>
            ))}
            {renames.length > 8 && <p className="text-[0.7rem] text-ivory-500 pt-1">… and {renames.length - 8} more</p>}
          </div>

          <div className="flex justify-end gap-2 mt-2">
            <Button type="button" onClick={onClose} variant="secondary" size="md" className="!py-2 !px-4 text-sm">
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!baseName}
              onClick={() => setStep('confirm')}
              variant="primary" size="md" className="!py-2 !px-4 text-sm disabled:opacity-40 disabled:pointer-events-none"
            >
              Continue
            </Button>
          </div>
        </>
      ) : (
        <>
          <h3 className="text-base font-bold text-ivory-300 mb-1">Confirm bulk rename</h3>
          <p className="text-xs text-ivory-500 mb-4">
            This will rename all <span className="font-bold text-ivory-500">{renames.length}</span> files in “{folder.name}”. Continue?
          </p>
          <div className="rounded-lg border border-gold-500/20 bg-gold-500/[0.06] p-3 mb-4">
            <p className="text-xs text-ivory-300">
              Example: <span className="font-mono text-ivory-300">{renames[0]?.title}</span>,{' '}
              <span className="font-mono text-ivory-300">{renames[1]?.title}</span>, …{' '}
              <span className="font-mono text-ivory-300">{renames[renames.length - 1]?.title}</span>
            </p>
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <Button type="button" onClick={() => setStep('config')} variant="secondary" size="md" className="!py-2 !px-4 text-sm">
              Back
            </Button>
            <Button
              type="button"
              disabled={renames.length === 0}
              onClick={() => onApply(renames)}
              variant="primary" size="md" className="!py-2 !px-4 text-sm disabled:opacity-40 disabled:pointer-events-none"
            >
              Rename all
            </Button>
          </div>
        </>
      )}
    </Overlay>
  );
}

/* ── move item modal ─────────────────────────────────────────────────────── */

function MoveModal({ current, folders, item, onPick, onClose }) {
  const targets = folders.filter((f) => f.id !== current);
  return (
    <Overlay onClose={onClose} wide>
      <h3 className="text-base font-bold text-ivory-300 mb-1">Move entry</h3>
      <p className="text-xs text-ivory-500 mb-4">Where should “{item.title}” go?</p>
      <div className="flex flex-col gap-2 max-h-72 overflow-y-auto">
        {targets.length === 0 && <p className="text-xs text-ivory-500 py-4 text-center">No other folders yet — create one first.</p>}
        {targets.map((f) => (
          <button
            key={f.id}
            onClick={() => onPick(f.id)}
            className="flex items-center justify-between text-left px-4 py-3 rounded-xl border border-ivory-700/50 bg-black/[0.03] hover:bg-black/[0.06] transition"
          >
            <span className="text-sm font-semibold text-ivory-300">📁 {f.name}</span>
            <span className="text-xs text-ivory-500">{f.items.length} items</span>
          </button>
        ))}
      </div>
      <div className="flex justify-end mt-4">
        <Button onClick={onClose} variant="secondary" size="md" className="!py-2 !px-4 text-sm">
          Cancel
        </Button>
      </div>
    </Overlay>
  );
}

/* Flatten folders into dropdown options, indenting nested children. */
function folderSelectOptions(folders) {
  const byParent = new Map();
  const group = (p) => {
    let a = byParent.get(p);
    if (!a) { a = []; byParent.set(p, a); }
    return a;
  };
  (folders || []).forEach((f) => group(f.parentId || '__root__').push(f));
  const out = [];
  const seen = new Set();
  const walk = (parentKey, depth) => {
    (byParent.get(parentKey) || []).forEach((f) => {
      if (seen.has(f.id)) return;
      seen.add(f.id);
      out.push({ id: f.id, name: f.name, depth });
      walk(f.id, depth + 1);
    });
  };
  walk('__root__', 0);
  (folders || []).forEach((f) => {
    if (!seen.has(f.id)) out.push({ id: f.id, name: f.name, depth: 0 });
  });
  return out;
}

function MoveFolderModal({ current, folders, onPick, onClose }) {
  const targets = folders.filter((f) => f.id !== current);
  return (
    <Overlay onClose={onClose} wide>
      <h3 className="text-base font-bold text-ivory-300 mb-1">Move folder</h3>
      <p className="text-xs text-ivory-500 mb-4">Choose a new location for this folder.</p>
      <div className="flex flex-col gap-2 max-h-72 overflow-y-auto">
        <button
          onClick={() => onPick(null)}
          className="flex items-center justify-between text-left px-4 py-3 rounded-xl border border-ivory-700/50 bg-black/[0.03] hover:bg-black/[0.06] transition"
        >
          <span className="text-sm font-semibold text-ivory-300">🏠 Top level</span>
        </button>
        {targets.length === 0 && <p className="text-xs text-ivory-500 py-4 text-center">No other folders yet — create one first.</p>}
        {targets.map((f) => (
          <button
            key={f.id}
            onClick={() => onPick(f.id)}
            className="flex items-center justify-between text-left px-4 py-3 rounded-xl border border-ivory-700/50 bg-black/[0.03] hover:bg-black/[0.06] transition"
          >
            <span className="text-sm font-semibold text-ivory-300">📁 {f.name}</span>
            <span className="text-xs text-ivory-500">{f.items.length} items</span>
          </button>
        ))}
      </div>
      <div className="flex justify-end mt-4">
        <Button onClick={onClose} variant="secondary" size="md" className="!py-2 !px-4 text-sm">
          Cancel
        </Button>
      </div>
    </Overlay>
  );
}

function UploadModal({ folders, files, onUpload, onClose, progress }) {
  const [mode, setMode] = useState(folders.length ? 'existing' : 'new');
  const [folderId, setFolderId] = useState(folders[0]?.id ?? '');
  const [newName, setNewName] = useState('');
  const [newParentId, setNewParentId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const hasCsv = files.some((f) => /\.csv$/i.test(f.name));
  const [skipTriggers, setSkipTriggers] = useState(true);
  const [baseName, setBaseName] = useState('');
  const [csvRowCount, setCsvRowCount] = useState(0);

  /* Detect Lichess CSV format from the first file's header → default the
     "first move is a trigger" checkbox on for Lichess exports. */
  useEffect(() => {
    if (!hasCsv) return;
    let cancelled = false;
    const csv = files.find((f) => /\.csv$/i.test(f.name));
    csv
      .slice(0, 4096)
      .text()
      .then((t) => {
        if (cancelled) return;
        const header = (t.split(/\r?\n/, 1)[0] || '').toLowerCase();
        setSkipTriggers(header.includes('puzzleid') && header.includes('fen') && header.includes('moves'));
      })
      .catch(() => {
        if (!cancelled) setSkipTriggers(false);
      });
    return () => {
      cancelled = true;
    };
  }, [hasCsv, files]);

  /* How many rows will actually become entries (for the naming preview) —
     mirrors the acceptance rules in puzzleEntryFromCsvRow. */
  useEffect(() => {
    if (!hasCsv) {
      setCsvRowCount(0);
      return;
    }
    let cancelled = false;
    let total = 0;
    (async () => {
      for (const f of files.filter((file) => /\.csv$/i.test(file.name))) {
        try {
          const parsed = parseLichessCsv(await f.text());
          if (!parsed.format) continue;
          total += parsed.rows.filter((r) => {
            const moveCount = String(r.moves || '').trim().split(/\s+/).filter(Boolean).length;
            return r.fen && moveCount > 0 && (!skipTriggers || moveCount >= 2);
          }).length;
        } catch {
          /* unreadable file — just skipped from the count */
        }
      }
      if (!cancelled) setCsvRowCount(total);
    })();
    return () => {
      cancelled = true;
    };
  }, [hasCsv, files, skipTriggers]);

  async function submit(e) {
    e.preventDefault();
    if (mode === 'new') {
      const err = validateFolderName(newName, newParentId, folders);
      if (err) {
        setError(err);
        return;
      }
    } else if (!folderId) {
      setError('Pick a destination folder.');
      return;
    }
    setBusy(true);
    setError('');
    await onUpload({
      targetFolderId: mode === 'existing' ? folderId : null,
      folderName: mode === 'new' ? newName.trim() : null,
      newFolderParentId: mode === 'new' ? newParentId : null,
      skipTriggers,
      baseName: baseName.trim(),
    });
    setBusy(false);
  }

  return (
    <Overlay onClose={busy ? undefined : onClose} wide>
      <h3 className="text-base font-bold text-ivory-300 mb-1">Bulk Upload PGN / Puzzle CSV</h3>
      <p className="text-xs text-ivory-500 mb-4">
        {files.length} file{files.length === 1 ? '' : 's'} selected — PGN games and Lichess puzzle CSVs are saved as library entries.
      </p>

      <div className="flex flex-col gap-1.5 mb-4 max-h-32 overflow-y-auto">
        {files.map((f, i) => (
          <span key={`${f.name}-${i}`} className="text-[0.7rem] text-ivory-400 bg-black/[0.03] border border-ivory-700/50 rounded-lg px-3 py-1.5 truncate">
            {/\.csv$/i.test(f.name) ? '🧩' : '♟'} {f.name}
          </span>
        ))}
      </div>

      {progress && (
        <div className="mb-3">
          <div className="flex items-center justify-between text-[0.68rem] text-ivory-500 mb-1">
            <span className="truncate mr-2">{progress.text || 'Importing…'}</span>
            <span className="shrink-0">
              {progress.total ? Math.min(progress.done + 1, progress.total) : 0}/{progress.total}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-black/5 overflow-hidden">
            <div
              className="h-full rounded-full bg-gold-400 transition-all"
              style={{ width: `${progress.total ? Math.min(100, ((progress.done + 1) / progress.total) * 100) : 100}%` }}
            />
          </div>
        </div>
      )}

      <form onSubmit={submit}>
        <div className="flex gap-2 mb-4">
          {['existing', 'new'].map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m);
                setError('');
              }}
              className={`flex-1 text-sm py-2 rounded-lg border transition ${
                mode === m
                  ? 'border-gold-400/40 bg-gold-400/10 text-gold-500'
                  : 'border-ivory-700/50 bg-black/[0.03] text-ivory-500 hover:bg-black/[0.06]'
              }`}
            >
              {m === 'existing' ? 'Existing folder' : 'New folder'}
            </button>
          ))}
        </div>

        {mode === 'existing' ? (
          <Field label="Destination folder">
            {folders.length === 0 ? (
              <p className="text-xs text-ivory-500">No folders yet — create one first or upload to a new folder.</p>
            ) : (
              <>
                <FolderTree
                  localFolders={folders}
                  selectedId={folderId || null}
                  onSelect={(id) => setFolderId(id || '')}
                  compact
                  allowCreate={false}
                  className="max-h-48 overflow-y-auto"
                />
                {folderId && (
                  <button
                    type="button"
                    onClick={() => setFolderId('')}
                    className="mt-1.5 text-xs text-ivory-500 hover:text-ivory-500 transition"
                  >
                    Upload to top level instead (no folder)
                  </button>
                )}
              </>
            )}
          </Field>
        ) : (
          <>
            <Field label="New folder name">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. My Openings"
                className="w-full rounded-lg border border-ivory-700/50 bg-ink-900 px-3 py-2.5 text-sm text-ivory-300 outline-none placeholder:text-ivory-500 focus:ring-2 focus:ring-gold-400/30"
              />
            </Field>
            <Field label="Save inside (folder)">
              {folders.length === 0 ? (
                <p className="text-xs text-ivory-500">No folders yet — this new folder will be created at the top level.</p>
              ) : (
                <>
                  <select
                    value={newParentId || ''}
                    onChange={(e) => setNewParentId(e.target.value)}
                    className="w-full rounded-lg border border-ivory-700/50 bg-ink-900 px-3 py-2.5 text-sm text-ivory-300 outline-none focus:ring-2 focus:ring-gold-400/30"
                  >
                    <option value="">Top level (no folder)</option>
                    {folderSelectOptions(folders).map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.depth ? `${'\u00A0\u00A0'.repeat(f.depth)}└ ` : ''}{f.name}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1.5 text-xs text-ivory-500">
                    {newParentId ? 'New folder will be saved inside the selected folder.' : 'No folder selected — saving at the top level.'}
                  </p>
                </>
              )}
            </Field>
          </>
        )}

        {hasCsv && (
          <>
            <div className="mb-3">
              <Field label="Puzzle Name (optional)">
                <input
                  value={baseName}
                  onChange={(e) => setBaseName(e.target.value)}
                  placeholder="e.g. Mate in 4 — blank keeps Puzzle IDs"
                  className="w-full rounded-lg border border-ivory-700/50 bg-ink-900 px-3 py-2.5 text-sm text-ivory-300 outline-none placeholder:text-ivory-500 focus:ring-2 focus:ring-gold-400/30"
                />
              </Field>
              {baseName.trim() ? (
                csvRowCount > 0 ? (
                  <div className="mt-2 rounded-lg border border-ivory-700/50 bg-black/[0.02] p-3">
                    <p className="text-xs text-ivory-500">
                      {csvRowCount === 1
                        ? `1 puzzle will be named ${baseName.trim()} #1`
                        : `${csvRowCount} puzzles will be named ${baseName.trim()} #1 to #${csvRowCount}`}
                    </p>
                    <div className="mt-1.5 flex flex-col gap-1">
                      {Array.from({ length: Math.min(csvRowCount, 5) }, (_, i) => (
                        <span key={i} className="text-xs font-mono text-ivory-300">
                          #{i + 1} → {nameWithNumbering(baseName.trim(), 'hash', i + 1)}
                        </span>
                      ))}
                      {csvRowCount > 5 && (
                        <span className="text-[0.7rem] text-ivory-500">… and {csvRowCount - 5} more</span>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-red-600/80">No valid rows found in the CSV — check that it has FEN and Moves columns.</p>
                )
              ) : (
                <p className="mt-2 text-xs text-ivory-500">Leave blank to keep the current names (using the Puzzle ID).</p>
              )}
            </div>
            <label className="flex items-center gap-2.5 mb-3 cursor-pointer select-none border border-ivory-700/50 bg-black/[0.03] rounded-lg px-3 py-2.5">
              <input
                type="checkbox"
                checked={skipTriggers}
                onChange={(e) => setSkipTriggers(e.target.checked)}
                className="w-4 h-4 accent-gold-400"
              />
              <span className="text-xs text-ivory-300 leading-snug">
                First move is a <b className="text-gold-500">trigger/setup move</b> (skip it) — apply it to the FEN and keep only the real solution.
              </span>
            </label>
          </>
        )}

        {error && <p className="text-xs text-red-600 mb-3">⚠ {error}</p>}

        <div className="flex justify-end gap-2 mt-2">
          <Button type="button" onClick={onClose} disabled={busy} variant="secondary" size="md" className="!py-2 !px-4 text-sm disabled:opacity-50">
            Cancel
          </Button>
          <Button type="submit" disabled={busy} variant="primary" size="md" className="!py-2 !px-4 text-sm disabled:opacity-60">
            {busy ? 'Importing…' : `Upload to ${mode === 'new' ? 'new folder' : 'folder'}`}
          </Button>
        </div>
      </form>
    </Overlay>
  );
}

/* ── rename folder modal ─────────────────────────────────────────────────── */

function RenameFolderModal({ folder, folders, onSave, onClose }) {
  const [name, setName] = useState(folder.name);
  const [error, setError] = useState('');
  const others = folders.filter((f) => f.id !== folder.id);

  function submit(e) {
    e.preventDefault();
    const err = validateFolderName(name, folder.parentId, others);
    if (err) {
      setError(err);
      return;
    }
    onSave(name.trim());
  }

  return (
    <Overlay onClose={onClose}>
      <h3 className="text-base font-bold text-ivory-300 mb-1">Rename folder</h3>
      <form onSubmit={submit}>
        <div className="mt-4">
          <Field label="Folder name">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-ivory-700/50 bg-ink-900 px-3 py-2.5 text-sm text-ivory-300 outline-none placeholder:text-ivory-500 focus:ring-2 focus:ring-gold-400/30"
            />
          </Field>
        </div>
        {error && <p className="text-xs text-red-600 mb-3">⚠ {error}</p>}
        <div className="flex justify-end gap-2 mt-2">
          <Button type="button" onClick={onClose} variant="secondary" size="md" className="!py-2 !px-4 text-sm">
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="md" className="!py-2 !px-4 text-sm">
            Save
          </Button>
        </div>
      </form>
    </Overlay>
  );
}

/* ── delete folder modal ─────────────────────────────────────────────────── */

/* Deleting a folder cascades: the subtree goes with it (the schema enforces
   this), so the confirmation has to state EXACTLY what will be destroyed —
   the folder itself, any nested subfolders, and every entry across all of
   them. Anything less would understate the blast radius. */
function DeleteFolderModal({ folder, subfolderCount, count, onConfirm, onClose }) {
  const subs = subfolderCount || 0;
  return (
    <Overlay onClose={onClose}>
      <h3 className="text-base font-bold text-ivory-300 mb-1">Delete folder?</h3>
      <p className="text-xs text-ivory-500 mt-3 mb-3 leading-relaxed">
        This will permanently delete <b className="text-ivory-400">&quot;{folder.name}&quot;</b>
        {subs > 0 && (
          <>
            , the <b className="text-ivory-400">{subs} subfolder{subs === 1 ? '' : 's'}</b> nested
            inside it
            {subs === 1 ? '' : 's'}
          </>
        )}
        , and <b className="text-ivory-400">{count} file{count === 1 ? '' : 's'}</b> across
        {' '}all of {subs > 0 ? 'them' : 'it'}.
      </p>
      <p className="text-xs text-red-400/90 mb-5 leading-relaxed font-semibold">
        These changes are permanent and cannot be undone. Every admin will see the deletion.
      </p>
      <div className="flex justify-end gap-2">
        <Button type="button" onClick={onClose} variant="secondary" size="md" className="!py-2 !px-4 text-sm">
          Cancel
        </Button>
        <Button
          type="button"
          onClick={onConfirm}
          variant="danger" size="md" className="!py-2 !px-4 text-sm"
        >
          Delete {count + subs + 1} item{count + subs + 1 === 1 ? '' : 's'} permanently
        </Button>
      </div>
    </Overlay>
  );
}

/* ── the page ────────────────────────────────────────────────────────────── */

export default function Library() {
  const [data, setData] = useState(EMPTY_LIBRARY);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [openFolderId, setOpenFolderId] = useState(null);
  const [selectedItemId, setSelectedItemId] = useUrlView('item');
  const [moveIndex, setMoveIndex] = useState(0);
  const [reorder, setReorder] = useState(false);
  const [page, setPage] = useState(1);
  const [menuFor, setMenuFor] = useState(null);
  /* Search across the WHOLE library, not just the folder on screen — an admin
     usually knows the file's name, not which folder it was filed under. */
  const [search, setSearch] = useState('');

  const [folderModal, setFolderModal] = useState(null); // { parentId }
  const [itemModal, setItemModal] = useState(null);     // { editing: item|null }
  const [moveModal, setMoveModal] = useState(null);     // { itemId }
  const [folderMenuFor, setFolderMenuFor] = useState(null);  // folder id with ⋮ menu open
  const [folderKebabFor, setFolderKebabFor] = useState(null); // folder id with grid kebab menu open
  const [renameFolderState, setRenameFolderState] = useState(null); // folder being renamed
  const [deleteFolderState, setDeleteFolderState] = useState(null); // { folder, deleteIds, count }
  const [moveFolderState, setMoveFolderState] = useState(null); // folder being moved (kebab → Move)
  const [bulkRenameFor, setBulkRenameFor] = useState(null); // folder getting a bulk rename

  const [uploadFiles, setUploadFiles] = useState(null); // File[] chosen via picker
  const [uploadProgress, setUploadProgress] = useState(null); // { done, total, text }
  const uploadInputRef = useRef(null);

  const { showToast } = useToast();
  const [listRef, boardWidth] = useBoardWidth();

  /* ── server-backed library ───────────────────────────────────────────────
     One shared library for every admin and the superadmin. Mutations go to the
     API and are followed by a refetch, so the page always renders what the
     server holds rather than a locally patched copy. */
  const refresh = useCallback(async () => {
    try {
      const next = await fetchLibrary();
      setData({ folders: next?.folders || [] });
      setLoadError('');
      return next;
    } catch (err) {
      setLoadError(err?.response?.data?.message || err?.message || 'Could not load the library.');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  /* Run an async mutation: disable the UI, await it, then refetch so every
     admin sees the same data on their next render. Never leaves a stale copy. */
  const runMutation = useCallback(async (fn, successToast) => {
    setBusy(true);
    try {
      await fn();
      await refresh();
      if (successToast) showToast(successToast.msg, { tone: 'success', title: successToast.title });
      return true;
    } catch (err) {
      showToast(err?.message || 'Something went wrong.', { tone: 'error', title: 'Library' });
      // A failed write may have left the server ahead of us — resync either way.
      await refresh();
      return false;
    } finally {
      setBusy(false);
    }
  }, [refresh, showToast]);

  /* ── one-time import of the old per-browser library ────────────────────────
     If this browser still holds a localStorage library, offer to upload it.
     The server nests it under a fresh "Imported - …" folder, so this is safe
     to offer at any time and never touches what other admins already have.
     The local copy is deleted only after the server confirms success. */
  const [importOffer, setImportOffer] = useState(null); // { folders }
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (loading || loadError) return;
    const legacy = readLegacyLibrary();
    if (legacy) setImportOffer((prev) => prev || legacy);
  }, [loading, loadError]);

  async function doImport() {
    if (!importOffer) return;
    setImporting(true);
    try {
      const res = await importLibrary(importOffer.folders);
      // The server confirmed the upload, and only NOW is it safe to drop the
      // local copy. Nothing above this line deletes anything.
      clearLegacyLibrary();
      setImportOffer(null);
      setData({ folders: res?.library?.folders || [] });
      showToast(
        `Imported into "${res?.containerName}" — ${res?.foldersImported ?? 0} folders, ${res?.itemsImported ?? 0} entries.`,
        { tone: 'success', title: 'Library imported' }
      );
    } catch (err) {
      // Failure keeps the localStorage copy untouched, so nothing is lost and
      // the admin can retry.
      showToast(err?.response?.data?.message || err?.message || 'The upload failed.', {
        tone: 'error', title: 'Import failed',
      });
    } finally {
      setImporting(false);
    }
  }

  const openFolder = data.folders.find((f) => f.id === openFolderId) || null;
  const items = openFolder?.items || [];
  const childFolders = openFolderId ? data.folders.filter((f) => f.parentId === openFolderId) : [];
  const selectedItem = useMemo(() => items.find((i) => i.id === selectedItemId) || null, [items, selectedItemId]);

  /* Search over FOLDERS only. An admin is looking for where something lives, so
     a query matches folder names alone — listing individual puzzles here would
     bury that. It still spans the WHOLE library, not just the folder on
     screen: you usually know a folder's name, not its location. */
  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    return data.folders
      .filter((f) => String(f.name || '').toLowerCase().includes(q))
      .map((folder) => ({ kind: 'folder', folder }));
  }, [search, data.folders]);

  /* Opening a hit lands on that folder. */
  const openSearchResult = useCallback((r) => {
    setOpenFolderId(r.folder.id);
    setSearch('');
  }, []);

  /* entering a folder → select first item, reset view state */
  useEffect(() => {
    setSelectedItemId(items[0]?.id ?? null);
    setMoveIndex(0);
    setPage(1);
    setReorder(false);
    setMenuFor(null);
    setBulkRenameFor(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openFolderId]);

  /* keep a valid selection alive after delete / reorder */
  useEffect(() => {
    if (!selectedItemId) return;
    if (!items.some((i) => i.id === selectedItemId)) setSelectedItemId(items[0]?.id ?? null);
  }, [items, selectedItemId]);

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    if (page > totalPages) setPage(totalPages);
  }, [items.length, page]);

  const view = useMemo(() => buildReplay(selectedItem, moveIndex), [selectedItem, moveIndex]);

  /* ← / → keyboard move navigation (matches the ⏮ ◀ ▶ ⏭ buttons) */
  useArrowKeys(
    () => { if (view?.moves?.length) setMoveIndex((m) => Math.max(0, m - 1)); },
    () => { const len = view?.moves?.length ?? 0; if (len) setMoveIndex((m) => Math.min(len, m + 1)); },
    { enabled: !!selectedItem }
  );

  /* ── mutations ──
     Every one of these calls the shared API and then refetches, so what the
     page shows is always the server's current state — never a local guess. */

  function createFolder(fields) {
    return runMutation(
      () => apiCreateFolder(fields),
      { msg: `Folder "${fields.name}" created successfully`, title: 'New folder' }
    );
  }

  /* Items live nested inside their folder object (folder.items[]), so renaming
     only touches the folder record — no per-item folder reference to update. */
  function renameFolder(folderId, name) {
    setFolderMenuFor(null);
    setRenameFolderState(null);
    return runMutation(
      () => apiUpdateFolder(folderId, { name }),
      { msg: `Folder renamed to "${name}"`, title: 'Renamed' }
    );
  }

  /* The delete confirmation is shown before anything is called. It states the
     folder itself, how many nested subfolders go with it, and how many entries
     are lost across the whole subtree — the DB cascades, so all of it really
     does go. The actual delete is a single API call in confirmDeleteFolder. */
  function askDeleteFolder(folderId) {
    const ids = new Set([folderId]);
    const stack = [folderId];
    while (stack.length) {
      const cur = stack.pop();
      for (const f of data.folders) {
        if (f.parentId === cur && !ids.has(f.id)) {
          ids.add(f.id);
          stack.push(f.id);
        }
      }
    }
    const removed = data.folders.filter((f) => ids.has(f.id));
    const count = removed.reduce((n, f) => n + f.items.length, 0);
    const subfolderCount = removed.length - 1; // every folder except the one named
    setFolderMenuFor(null);
    setDeleteFolderState({
      folder: data.folders.find((f) => f.id === folderId),
      deleteIds: [...ids],
      subfolderCount,
      count,
    });
  }

  function confirmDeleteFolder() {
    const { folder, count } = deleteFolderState;
    setDeleteFolderState(null);
    return runMutation(
      () => apiDeleteFolder(folder.id),
      { msg: `Folder and ${count} file${count === 1 ? '' : 's'} deleted`, title: 'Deleted' }
    );
  }

  function addItem(fields) {
    if (!openFolderId) {
      showToast('Open a folder before adding an entry.', { tone: 'error', title: 'No folder open' });
      return Promise.resolve(false);
    }
    return runMutation(
      () => apiCreateItem({ ...fields, folderId: openFolderId }),
      { msg: `"${fields.title}" added to ${openFolder?.name}`, title: 'Entry saved' }
    );
  }

  function handleFilesSelected(e) {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    if (!files.length) return;
    setUploadFiles(files);
  }

  async function performUpload({ targetFolderId, folderName, newFolderParentId = null, skipTriggers, baseName }) {
    const today = new Date().toISOString().slice(0, 10);
    const okItems = [];
    const badNames = [];
    let skippedRows = 0;
    let importedPuzzles = 0;
    let hasCsv = false;
    const mirrorSets = [];
    let mirrorFailed = false;
    const rawBase = String(baseName || '').trim();

    for (const file of uploadFiles) {
      let text = '';
      try {
        text = await file.text();
      } catch {
        badNames.push(file.name);
        continue;
      }

      if (detectLibraryUploadType(file.name, text) === 'csv') {
        hasCsv = true;
        const parsed = parseLichessCsv(text);
        if (!parsed.format) {
          badNames.push(`${file.name} (not a Lichess puzzle CSV)`);
          continue;
        }
        setUploadProgress({ done: 0, total: parsed.rows.length, text: `${file.name} — parsing…` });
        const rowsBefore = okItems.length;
        for (let i = 0; i < parsed.rows.length; i++) {
          const r = puzzleEntryFromCsvRow(parsed.rows[i], skipTriggers, today);
          if (r.error) skippedRows++;
          else {
            if (rawBase) r.item.title = nameWithNumbering(rawBase, 'hash', importedPuzzles + 1);
            okItems.push(r.item);
            importedPuzzles++;
          }
          if (i % 100 === 0) {
            setUploadProgress({ done: i, total: parsed.rows.length, text: `${file.name} — row ${Math.min(i + 1, parsed.rows.length)}/${parsed.rows.length}` });
            await new Promise((res) => setTimeout(res, 0));
          }
        }
        /* Keep the Puzzle Listing in sync: mirror this file as a separate set
           (same import the CSV wizard would do — one set per uploaded file). */
        if (okItems.length > rowsBefore) {
          try {
            mirrorSets.push(await mirrorPuzzleCsvSet(text, file.name, !skipTriggers));
          } catch {
            mirrorFailed = true;
          }
        }
      } else {
        const verr = validateNotation('pgn', text);
        if (verr) {
          badNames.push(file.name);
          continue;
        }
        okItems.push({ title: file.name.replace(/\.pgn$/i, ''), type: 'pgn', notation: text.trim(), createdAt: today });
      }
    }

    setUploadProgress(null);

    if (okItems.length === 0) {
      showToast(
        hasCsv ? 'No puzzles could be imported — check the CSV columns (need FEN and Moves).' : 'No valid files to upload — check the PGN content.',
        { tone: 'error', title: 'Upload failed' }
      );
      return;
    }

    /* Upload writes to the shared library: create the folder first if the upload
       asked for a new one, then push every parsed entry in one bulk call. Both
       steps are awaited before the single refetch, so the page never shows a
       half-finished import. A failure resyncs so the view matches the server. */
    let uploadResult = null;
    let folderId = targetFolderId;
    try {
      if (folderName) {
        const created = await apiCreateFolder({
          name: folderName, parentId: newFolderParentId || null, description: '', type: 'general',
        });
        folderId = created.id;
      }
      if (folderId == null) {
        showToast('Choose a destination folder for the upload.', { tone: 'error', title: 'Upload failed' });
        await refresh();
        return;
      }

      const folderNameForToast =
        folderName || data.folders.find((f) => f.id === folderId)?.name || openFolder?.name || 'folder';

      await apiCreateItems(folderId, okItems);
      await refresh();
      uploadResult = { folderId, folderNameForToast };
    } catch (err) {
      await refresh();
      showToast(err?.message || 'The upload failed.', { tone: 'error', title: 'Upload failed' });
      return;
    }
    const { folderNameForToast } = uploadResult;

    if (hasCsv) {
      const mirrorNote = mirrorSets.length
        ? mirrorSets.length === 1
          ? `. Also added to Puzzle Listing as "${mirrorSets[0]}"`
          : `. Also added ${mirrorSets.length} puzzle sets to Puzzle Listing`
        : '';
      showToast(`Imported ${importedPuzzles} puzzle${importedPuzzles === 1 ? '' : 's'} to ${folderNameForToast}${mirrorNote}`, {
        tone: 'success',
        title: 'Puzzles imported',
      });
      if (mirrorFailed) {
        showToast('Saved to the Library only — could not also create a Puzzle Listing set (admin access required).', {
          tone: 'error',
          title: 'Puzzle set not created',
        });
      }
      if (skippedRows) {
        showToast(`${skippedRows} row${skippedRows === 1 ? '' : 's'} skipped due to errors.`, { tone: 'error', title: 'Import incomplete' });
      }
    } else {
      showToast(`Uploaded ${okItems.length} file${okItems.length === 1 ? '' : 's'} to ${folderNameForToast}`, {
        tone: 'success',
        title: 'Upload complete',
      });
    }
    if (badNames.length) {
      showToast(`Could not import ${badNames.length} file${badNames.length === 1 ? '' : 's'} (bad format).`, {
        tone: 'error',
        title: 'Some files skipped',
      });
    }
    setUploadFiles(null);
  }

  function renameItem(itemId, title) {
    return runMutation(
      () => apiUpdateItem(itemId, { title }),
      { msg: 'Entry renamed.', title: 'Renamed' }
    );
  }

  /* Bulk rename is ONE server-side transaction — every title changes or none
     does, so a mid-way network failure can no longer leave the folder half
     renamed. One refetch afterwards. */
  function bulkRenameAll(renames) {
    setBulkRenameFor(null);
    return runMutation(async () => {
      await bulkRenameItems(renames);
    }, null).then((ok) => {
      const n = renames.length;
      showToast(ok
        ? `${n} file${n === 1 ? '' : 's'} renamed`
        : 'Could not rename the files.',
      { tone: ok ? 'success' : 'error', title: ok ? 'Bulk rename' : 'Bulk rename failed' });
    });
  }

  function deleteItem(itemId) {
    if (!window.confirm('Delete this entry? This cannot be undone.')) return;
    setMenuFor(null);
    return runMutation(
      () => apiDeleteItem(itemId),
      { msg: 'Entry deleted.', title: 'Deleted' }
    );
  }

  function moveItem(itemId, destFolderId) {
    setMenuFor(null);
    setMoveModal(null);
    return runMutation(
      () => apiUpdateItem(itemId, { folderId: destFolderId }),
      { msg: 'Entry moved.', title: 'Moved' }
    );
  }

  /* The cycle guard is re-checked server-side (a recursive CTE), but keeping the
     client check means the user gets the message without a round trip. Returns
     an error string for the caller to toast, or '' on success. */
  function moveFolder(folderId, newParentId) {
    if (folderId === newParentId) return 'A folder cannot be moved inside itself.';
    const descendants = new Set();
    const stack = [folderId];
    while (stack.length) {
      const cur = stack.pop();
      for (const f of data.folders) {
        if (f.parentId === cur && !descendants.has(f.id)) {
          descendants.add(f.id);
          stack.push(f.id);
        }
      }
    }
    if (newParentId != null && (newParentId === folderId || descendants.has(newParentId))) {
      return 'A folder cannot be moved inside itself or its own subfolders.';
    }
    setFolderMenuFor(null);
    setMoveFolderState(null);
    runMutation(
      () => apiUpdateFolder(folderId, { parentId: newParentId }),
      { msg: 'Folder moved', title: 'Moved' }
    );
    return '';
  }

  function reorderItem(itemId, dir) {
    return runMutation(() => apiReorderItem(itemId, dir), null);
  }

  function exportItem(item) {
    const blob = new Blob([item.notation], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(item.title || 'entry').replace(/[^a-z0-9-_]+/gi, '-')}.${item.type === 'pgn' ? 'pgn' : 'fen'}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setMenuFor(null);
  }

  const moveRows = useMemo(() => pairRows(view?.moves || [], view?.startSide), [view]);
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const pageItems = reorder ? items : items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  /* ── render: breadcrumb + folder grid + items/board ── */

  const path = useMemo(() => {
    if (!openFolderId) return [];
    const arr = [];
    let cur = data.folders.find((f) => f.id === openFolderId);
    while (cur) {
      arr.unshift(cur);
      cur = cur.parentId ? data.folders.find((f) => f.id === cur.parentId) : null;
    }
    return arr;
  }, [openFolderId, data.folders]);
  const visibleFolders = openFolder ? childFolders : data.folders.filter((f) => !f.parentId);

  return (
    <Page
      title={openFolder ? openFolder.name : 'PGN / FEN Library'}
      piece={openFolder ? '📁' : '📚'}
      sub={openFolder ? (openFolder.description || 'Your study library.') : 'Folder your games, studies and board positions — then replay them move by move.'}
    >
      {/* First paint has no data yet (the library is fetched, not read from
          localStorage), so say so rather than flashing "no folders". */}
      {loading && (
        <div className="chess-card mb-5 flex items-center gap-3" aria-busy="true">
          <Spinner />
          <span className="text-sm text-ivory-400">Loading the shared library…</span>
        </div>
      )}

      {!loading && loadError && (
        <div className="chess-card mb-5" role="alert">
          <p className="text-sm font-semibold text-red-300">Could not load the library</p>
          <p className="text-sm text-ivory-400 mt-1">{loadError}</p>
          <Button onClick={refresh} variant="secondary" size="md" className="!py-2 !px-4 text-sm mt-3">
            ↻ Try again
          </Button>
        </div>
      )}

      {/* One-time upload of this browser's old, private localStorage library.
          The local copy is kept until the upload succeeds. */}
      {!loading && !loadError && importOffer && (
        <div className="chess-card mb-5 border-gold-500/50" role="status">
          <p className="text-sm font-semibold text-ivory-100">
            Import this browser&apos;s old library?
          </p>
          <p className="text-sm text-ivory-400 mt-1">
            This browser still holds {importOffer.folders.length} folder
            {importOffer.folders.length === 1 ? '' : 's'} from the old local-only library. Uploading
            copies them into the shared library, inside a new folder named
            &quot;Imported - …&quot;, so nothing already there is touched — and they become visible to
            every admin and the superadmin. Your local copy is kept until the upload succeeds.
          </p>
          <div className="flex gap-2 mt-3">
            <Button onClick={doImport} disabled={importing} variant="primary" size="md" className="!py-2 !px-4 text-sm">
              {importing ? 'Uploading…' : '⬆ Import to shared library'}
            </Button>
            <Button
              onClick={() => setImportOffer(null)}
              disabled={importing}
              variant="secondary" size="md" className="!py-2 !px-4 text-sm"
            >
              Not now
            </Button>
          </div>
        </div>
      )}

      {/* toolbar */}
      <div className="flex flex-wrap items-center justify-end gap-2 mb-5">
        {/* Search sits with the toolbar so it is reachable from anywhere in
            the library, not only from the folder currently open. */}
        <div className="live-course-search !m-0 flex-1 sm:flex-none sm:min-w-[240px] sm:max-w-sm">
          <span className="live-course-search-icon" aria-hidden="true">🔍</span>
          <input
            type="search"
            className="live-course-search-input"
            placeholder="Search folders…"
            aria-label="Search folders"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              type="button"
              className="live-course-search-clear"
              onClick={() => setSearch('')}
              aria-label="Clear search"
              title="Clear search"
            >✕</button>
          )}
        </div>
        <Button onClick={() => uploadInputRef.current?.click()} variant="secondary" size="md" className="!py-2 !px-4 text-sm">
          ⬆ Bulk PGN or CSV
        </Button>
        <Button to="/admin/courses/create-puzzles" variant="secondary" size="md" className="!py-2 !px-4 text-sm">
          <Puzzle size={16} aria-hidden="true" />
          Create Puzzles
        </Button>
        <Button
          onClick={() => setFolderModal({ parentId: openFolder ? openFolder.id : null })}
          variant="primary" size="md" className="!py-2 !px-4 text-sm"
        >
          + New Folder
        </Button>
        <input
          ref={uploadInputRef}
          type="file"
          accept=".pgn,.csv"
          multiple
          className="hidden"
          onChange={handleFilesSelected}
        />
      </div>

      {/* Search results stand in for the folder grid while a query is active.
          Folders only — an admin is locating a folder, so individual puzzles
          are deliberately not listed here. */}
      {searchResults && (
        <div className="live-course-results mb-5" aria-label="Folder search results">
          <p className="live-course-results-count">
            {searchResults.length === 0
              ? `No folders match "${search.trim()}"`
              : `${searchResults.length} folder${searchResults.length === 1 ? '' : 's'} found`}
          </p>
          {searchResults.slice(0, 60).map((r) => {
            const fileCount = (r.folder.items || []).length;
            const subCount = data.folders.filter((f) => f.parentId === r.folder.id).length;
            return (
              <button
                key={r.folder.id}
                type="button"
                onClick={() => openSearchResult(r)}
                className="w-full text-left flex items-center gap-2.5 px-3 py-2 rounded-lg border border-ivory-700/50 bg-black/[0.04] hover:border-gold-500/30 transition"
                title={`Open ${r.folder.name}`}
              >
                <span className="w-6 h-6 shrink-0 grid place-items-center text-sm" aria-hidden="true">📁</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ivory-300">
                    {r.folder.name}
                  </span>
                  <span className="block truncate text-[0.65rem] text-ivory-500">
                    {subCount > 0
                      ? `${subCount} subfolder${subCount === 1 ? '' : 's'} · ${fileCount} file${fileCount === 1 ? '' : 's'}`
                      : `${fileCount} file${fileCount === 1 ? '' : 's'}`}
                  </span>
                </span>
              </button>
            );
          })}
          {searchResults.length > 60 && (
            <p className="live-course-results-count">
              Showing the first 60 — refine your search to narrow it down.
            </p>
          )}
        </div>
      )}

      {/* breadcrumb + folder grid are hidden while searching: the results above
          already occupy the page body, and showing both would duplicate rows. */}
      <div hidden={!!searchResults}>
      {/* breadcrumb */}
      <nav className="flex flex-wrap items-center gap-1 text-sm mb-6" aria-label="Breadcrumb">
        <button
          onClick={() => setOpenFolderId(null)}
          className={`flex items-center gap-1.5 rounded-lg py-1 pr-2 pl-1.5 transition ${
            openFolder ? 'text-ivory-400 hover:bg-black/[0.05] hover:text-gold-400' : 'font-bold text-ivory-300'
          }`}
        >
          <House className="h-4 w-4" />
          <span>{openFolder ? 'Home' : 'All folders'}</span>
        </button>
        {path.map((f, i) => (
          <Fragment key={f.id}>
            <span className="text-ivory-500 select-none">›</span>
            {i === path.length - 1 ? (
              <span className="truncate rounded-lg py-1 px-2 font-bold text-ivory-300">{f.name}</span>
            ) : (
              <button
                onClick={() => setOpenFolderId(f.id)}
                className="truncate rounded-lg py-1 px-2 text-ivory-400 transition hover:bg-black/[0.05] hover:text-gold-400"
              >
                {f.name}
              </button>
            )}
          </Fragment>
        ))}
      </nav>

      {/* folder cards grid */}
      {visibleFolders.length > 0 && (
        <div className="mb-8">
          <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-ivory-500 mb-2">
            Folders ({visibleFolders.length})
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {visibleFolders.map((cf) => {
              const subCount = data.folders.filter((f) => f.parentId === cf.id).length;
              return (
              <div
                key={cf.id}
                className="group relative flex items-center gap-1 rounded-xl border border-ivory-700/50 bg-ink-800/70 p-2 shadow-sm transition hover:border-gold-500/40 hover:bg-ink-800 hover:shadow-lg"
              >
                <button
                  onClick={() => setOpenFolderId(cf.id)}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-lg p-1.5 text-left"
                  title={`Open ${cf.name}`}
                >
                  <Folder className="h-5 w-5 shrink-0 text-gold-400" fill="currentColor" strokeWidth={0.6} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-ivory-300">{cf.name}</span>
                    <span className="block text-[0.65rem] text-ivory-500 mt-0.5">
                      {subCount > 0
                        ? `${subCount} folder${subCount === 1 ? '' : 's'}`
                        : `${cf.items.length} game${cf.items.length === 1 ? '' : 's'}`}
                    </span>
                  </span>
                </button>
                <button
                  onClick={() => setFolderKebabFor(folderKebabFor === cf.id ? null : cf.id)}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ivory-500 transition hover:bg-black/[0.06] hover:text-ivory-300"
                  title={`Options for ${cf.name}`}
                >
                  <EllipsisVertical className="h-4 w-4" />
                </button>
                {folderKebabFor === cf.id && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setFolderKebabFor(null)} />
                    <div className="absolute right-2 top-11 z-20 w-44 rounded-xl border border-ivory-700/50 bg-ink-800 p-1.5 shadow-2xl flex flex-col">
                      {[
                        { label: 'Rename', fn: () => { setRenameFolderState(cf); setFolderKebabFor(null); } },
                        { label: 'Move', fn: () => { setMoveFolderState(cf); setFolderKebabFor(null); } },
                        { label: 'Delete', fn: () => { setFolderKebabFor(null); askDeleteFolder(cf.id); }, danger: true },
                      ].map((a) => (
                        <button
                          key={a.label}
                          onClick={a.fn}
                          className={`text-left px-3 py-2 rounded-lg text-xs font-medium transition ${
                            a.danger ? 'text-red-600 hover:bg-red-500/10' : 'text-ivory-500 hover:bg-black/[0.06]'
                          }`}
                        >
                          {a.label}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
              );
            })}
          </div>
        </div>
      )}

      {visibleFolders.length === 0 && (
        <div className="mb-8">
          <p className="chess-empty">No folders here yet. Use "+ New Folder" to create one.</p>
        </div>
      )}
      </div>

      {/* items + board (inside a folder) — only once the folder has entries.
          Stays visible while searching: opening a hit selects the item, and
          its detail view is exactly what the admin wants to see. */}
      {openFolder && items.length > 0 && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,35%)_minmax(0,65%)] items-start">
        {/* ── LEFT: items list ── */}
        <Card className="lg:sticky lg:top-6">
          <div className="flex items-center justify-between gap-3 mb-3">
            <h3 className="font-bold text-ivory-300 text-sm">
              {openFolder.name} <span className="text-ivory-500 font-medium">({items.length}) Games</span>
            </h3>
            <div className="flex items-center gap-2">
              <Button
                onClick={() => setBulkRenameFor(openFolder)}
                disabled={items.length === 0}
                variant="primary" size="sm" className="!py-1.5 !px-3 !text-xs disabled:opacity-40 disabled:pointer-events-none"
                title="Rename every file in this folder at once"
              >
                ✏️ Rename All
              </Button>
              <label className="flex items-center gap-1.5 text-[0.7rem] text-ivory-500 cursor-pointer select-none">
                Reorder
                <button
                  onClick={() => setReorder((r) => !r)}
                  className={`relative w-9 h-5 rounded-full transition ${reorder ? 'bg-gold-400' : 'bg-black/10'}`}
                  aria-label="Toggle reorder"
                >
                  <span
                    className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${reorder ? 'left-[1.15rem]' : 'left-0.5'}`}
                  />
                </button>
              </label>
            </div>
          </div>

          {items.length === 0 && (
            <p className="chess-empty">This folder is empty. Upload a PGN or FEN file using the bulk upload button.</p>
          )}

          <div className="flex flex-col gap-1.5 min-h-[45vh]">
            {pageItems.map((it, i) => {
              const active = selectedItemId === it.id;
              return (
                <div
                  key={it.id}
                  className={`group relative flex items-center gap-2 rounded-lg border px-3 py-2.5 transition ${
                    active ? 'bg-gold-500/10 border-sky-400/40' : 'border-ivory-700/50 bg-black/[0.02] hover:bg-black/[0.05]'
                  }`}
                >
                  {reorder && (
                    <div className="flex flex-col items-center gap-0.5">
                      <button
                        onClick={() => reorderItem(it.id, -1)}
                        disabled={i === 0}
                        className={`text-[0.6rem] leading-none px-1 rounded ${i === 0 ? 'text-ivory-800' : 'text-ivory-500 hover:text-ivory-300'}`}
                      >
                        ▲
                      </button>
                      <button
                        onClick={() => reorderItem(it.id, 1)}
                        disabled={i === pageItems.length - 1}
                        className={`text-[0.6rem] leading-none px-1 rounded ${i === pageItems.length - 1 ? 'text-ivory-800' : 'text-ivory-500 hover:text-ivory-300'}`}
                      >
                        ▼
                      </button>
                    </div>
                  )}

                  <button onClick={() => { setSelectedItemId(it.id); setMoveIndex(0); }} className="flex-1 text-left min-w-0">
                    <span className={`block text-sm font-semibold truncate ${active ? 'text-gold-500' : 'text-ivory-500'}`}>
                      {it.title}
                    </span>
                    <span className="block text-[0.65rem] text-ivory-500">
                      {it.type === 'pgn' ? '♟ PGN' : '♜ FEN'} · {it.notation.length > 34 ? `${it.notation.slice(0, 34)}…` : it.notation}
                    </span>
                  </button>

                  <button
                    onClick={() => setMenuFor(menuFor === it.id ? null : it.id)}
                    className="shrink-0 w-7 h-7 grid place-items-center rounded-md text-ivory-500 hover:text-ivory-300 hover:bg-black/[0.06] text-sm"
                    aria-label={`Actions for ${it.title}`}
                  >
                    ⋮
                  </button>

                  {menuFor === it.id && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setMenuFor(null)} />
                      <div className="absolute right-2 top-10 z-20 w-44 rounded-xl border border-ivory-700/50 bg-ink-800 shadow-2xl p-1.5 flex flex-col">
                        {[
                          { label: 'Rename', fn: () => setItemModal({ editing: it }) },
                          { label: 'Delete', fn: () => deleteItem(it.id), danger: true },
                          { label: 'Move', fn: () => setMoveModal({ itemId: it.id }) },
                          { label: 'Export', fn: () => exportItem(it) },
                        ].map((a) => (
                          <button
                            key={a.label}
                            onClick={a.fn}
                            className={`text-left px-3 py-2 rounded-lg text-xs font-medium transition ${
                              a.danger ? 'text-red-600 hover:bg-red-500/10' : 'text-ivory-500 hover:bg-black/[0.06]'
                            }`}
                          >
                            {a.label}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {/* pagination */}
          {!reorder && totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-4 text-sm">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="w-8 h-8 grid place-items-center rounded-lg border border-ivory-700/50 bg-black/[0.03] text-ivory-300 disabled:opacity-30 hover:bg-black/[0.08]"
              >
                ‹
              </button>
              <span className="px-2 text-xs font-semibold text-ivory-300">{page}</span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="w-8 h-8 grid place-items-center rounded-lg border border-ivory-700/50 bg-black/[0.03] text-ivory-300 disabled:opacity-30 hover:bg-black/[0.08]"
              >
                ›
              </button>
            </div>
          )}
        </Card>

        {/* ── RIGHT: board + moves ── */}
        <div className="space-y-4 min-w-0">
          {!selectedItem ? (
            <Card title="No entry selected">
              <p className="chess-empty">Pick an entry on the left to load its position and moves.</p>
            </Card>
          ) : (
            <>
              <div className="rounded-2xl border border-ivory-700/50 bg-ink-900/40 p-4">
                <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
                  <h3 className="font-bold text-ivory-300 text-sm truncate">{selectedItem.title}</h3>
                  <Chip tone={selectedItem.type === 'pgn' ? 'gold' : ''}>
                    {selectedItem.type === 'pgn' ? `${view?.moves.length || 0} plies · PGN` : 'FEN position'}
                  </Chip>
                </div>

                <div ref={listRef} className="flex justify-center">
                  <ChessBoard
                    game={view?.game}
                    interactive={false}
                    draggableColor={null}
                    showLegalMoves={false}
                    clickToMove={false}
                    orientation="white"
                    boardWidth={fitBoardToViewport(boardWidth, typeof document !== 'undefined' ? document.documentElement.clientWidth : 0)}
                    lastMove={view?.lastMove}
                  />
                </div>

                {/* navigation */}
                <div className="flex items-center justify-center gap-2 mt-4">
                  <button
                    onClick={() => setMoveIndex(0)}
                    disabled={!view?.moves.length}
                    className="w-11 h-11 rounded-xl border border-ivory-700/50 bg-black/[0.03] text-xl disabled:opacity-30 hover:bg-black/[0.08] transition"
                    title="First"
                  >
                    ⏮️
                  </button>
                  <button
                    onClick={() => setMoveIndex((m) => Math.max(0, m - 1))}
                    disabled={moveIndex === 0 || !view?.moves.length}
                    className="w-11 h-11 rounded-xl border border-ivory-700/50 bg-black/[0.03] text-xl disabled:opacity-30 hover:bg-black/[0.08] transition"
                    title="Previous"
                  >
                    ◀️
                  </button>
                  <span className="px-3 text-xs font-semibold text-ivory-400 tabular-nums">
                    {view?.moves.length ? `${moveIndex} / ${view.moves.length}` : 'Position only'}
                  </span>
                  <button
                    onClick={() => setMoveIndex((m) => Math.min(view.moves.length, m + 1))}
                    disabled={!view?.moves.length || moveIndex >= view.moves.length}
                    className="w-11 h-11 rounded-xl border border-ivory-700/50 bg-black/[0.03] text-xl disabled:opacity-30 hover:bg-black/[0.08] transition"
                    title="Next"
                  >
                    ▶️
                  </button>
                  <button
                    onClick={() => setMoveIndex(view.moves.length)}
                    disabled={!view?.moves.length || moveIndex >= view.moves.length}
                    className="w-11 h-11 rounded-xl border border-ivory-700/50 bg-black/[0.03] text-xl disabled:opacity-30 hover:bg-black/[0.08] transition"
                    title="Last"
                  >
                    ⏭️
                  </button>
                </div>
              </div>

              {/* moves list */}
              <div className="rounded-2xl border border-ivory-700/50 bg-ink-900/40 p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-bold text-ivory-300 text-sm">Moves</h3>
                  <span className="text-[0.65rem] text-ivory-500">Click a move to jump the board</span>
                </div>

                {view?.moves.length ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-[0.65rem] uppercase tracking-widest text-ivory-500">
                          <th className="w-10 text-left pb-2">#</th>
                          <th className="text-left pb-2">White</th>
                          <th className="text-left pb-2">Black</th>
                        </tr>
                      </thead>
                      <tbody>
                        {moveRows.map((row) => {
                          const whiteActive = moveIndex - 1 === row.whiteIdx;
                          const blackActive = row.black && moveIndex - 1 === row.blackIdx;
                          return (
                            <tr key={`${row.number}-${row.whiteIdx}`} className="border-t border-ivory-700/40">
                              <td className="py-1.5 text-ivory-500 font-mono">
                                {row.white ? `${row.number}.` : `${row.number}...`}
                              </td>
                              <td className="py-1.5">
                                {row.white ? (
                                  <button
                                    onClick={() => setMoveIndex(row.whiteIdx + 1)}
                                    className={`font-mono px-2 py-0.5 rounded-md transition ${
                                      whiteActive ? 'bg-gold-500/20 text-gold-500' : 'text-ivory-300 hover:bg-black/[0.05]'
                                    }`}
                                  >
                                    {row.white.san}
                                  </button>
                                ) : (
                                  <span className="font-mono px-2 py-0.5 text-ivory-800 select-none">—</span>
                                )}
                              </td>
                              <td className="py-1.5">
                                {row.black && (
                                  <button
                                    onClick={() => setMoveIndex(row.blackIdx + 1)}
                                    className={`font-mono px-2 py-0.5 rounded-md transition ${
                                      blackActive ? 'bg-gold-500/20 text-gold-500' : 'text-ivory-300 hover:bg-black/[0.05]'
                                    }`}
                                  >
                                    {row.black.san}
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-xs text-ivory-500">
                    This is a FEN position — no move list. Add a PGN entry (or “+ Add New”) to replay moves here.
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </div>
      )}

      {/* modals */}
      {folderModal && (
        <FolderModal
          folders={data.folders}
          initialParentId={folderModal.parentId}
          onClose={() => setFolderModal(null)}
          onSubmit={(fields) => {
            createFolder(fields);
            setFolderModal(null);
          }}
        />
      )}

      {bulkRenameFor && (
        <BulkRenameModal folder={bulkRenameFor} onClose={() => setBulkRenameFor(null)} onApply={bulkRenameAll} />
      )}

      {renameFolderState && (
        <RenameFolderModal
          folder={renameFolderState}
          folders={data.folders}
          onSave={(name) => {
            renameFolder(renameFolderState.id, name);
            setRenameFolderState(null);
          }}
          onClose={() => setRenameFolderState(null)}
        />
      )}

      {deleteFolderState && (
        <DeleteFolderModal
          folder={deleteFolderState.folder}
          subfolderCount={deleteFolderState.subfolderCount}
          count={deleteFolderState.count}
          onConfirm={confirmDeleteFolder}
          onClose={() => setDeleteFolderState(null)}
        />
      )}

      {moveFolderState && (
        <MoveFolderModal
          current={moveFolderState.id}
          folders={data.folders}
          onClose={() => setMoveFolderState(null)}
          onPick={(dest) => {
            const err = moveFolder(moveFolderState.id, dest);
            if (err) showToast(err, { tone: 'error', title: 'Cannot move' });
            setMoveFolderState(null);
          }}
        />
      )}

      {itemModal && (
        <ItemModal
          folder={openFolder}
          editing={itemModal.editing}
          onClose={() => setItemModal(null)}
          onSave={(fields) => {
            if (itemModal.editing) {
              renameItem(itemModal.editing.id, fields.title);
            } else {
              addItem(fields);
            }
            setItemModal(null);
          }}
        />
      )}

      {moveModal && (
        <MoveModal
          current={openFolder.id}
          folders={data.folders}
          item={items.find((i) => i.id === moveModal.itemId)}
          onClose={() => setMoveModal(null)}
          onPick={(dest) => moveItem(moveModal.itemId, dest)}
        />
      )}

      {uploadFiles && (
        <UploadModal
          folders={data.folders}
          files={uploadFiles}
          onClose={() => setUploadFiles(null)}
          onUpload={performUpload}
          progress={uploadProgress}
        />
      )}

    </Page>
  );
}