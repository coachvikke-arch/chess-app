import { useEffect, useMemo, useState } from 'react';
import { Chess } from 'chess.js';
import ChessBoard from '../ChessBoard';
import api from '../../services/api';
import { fetchLibrary } from '../../utils/libraryApi';

function makePgnFromLine(line) {
  const game = new Chess();
  try { (line || []).forEach((move) => game.move(move)); return game.pgn(); } catch { return ''; }
}

export default function ClassroomV2PgnLibrary({ onLoadPgn, onAsk }) {
  const [source, setSource] = useState('My PGN Library');
  const [query, setQuery] = useState('');
  const [folders, setFolders] = useState([]);
  const [masterLines, setMasterLines] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [ply, setPly] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    Promise.allSettled([fetchLibrary(), api.get('/admins/openings/library', { cache: false })])
      .then(([libraryResult, masterResult]) => {
        if (!active) return;
        if (libraryResult.status === 'fulfilled') setFolders(libraryResult.value?.folders || []);
        else setError(libraryResult.reason?.message || 'Could not load your PGN library.');
        const master = masterResult.status === 'fulfilled' ? masterResult.value : null;
        const courses = Array.isArray(master?.data) ? master.data : master?.data?.courses || [];
        const lines = courses.flatMap((course) => {
          if (Array.isArray(course.lines)) return course.lines.map((line) => ({
            id: `master-${line.id}`, title: `${course.title || 'Opening'} · ${line.name || 'Line'}`,
            pgn: makePgnFromLine(line.moves), notation: makePgnFromLine(line.moves), type: 'pgn',
          }));
          return [{ id: `master-${course.id}`, title: course.name || course.title || `Opening line ${course.id}`,
            pgn: makePgnFromLine(course.moves), notation: makePgnFromLine(course.moves), type: 'pgn' }];
        });
        setMasterLines(lines);
      })
      .catch((err) => { if (active) setError(err?.response?.data?.message || 'Could not load the PGN library.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const games = useMemo(() => {
    if (source === 'Master Database') return masterLines;
    return folders.flatMap((folder) => (folder.items || []).map((item) => ({ ...item, title: item.title || folder.name, folderName: folder.name })));
  }, [source, folders, masterLines]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return games.filter((game) => !q || `${game.title} ${game.folderName || ''}`.toLowerCase().includes(q));
  }, [games, query]);
  const selected = filtered.find((game) => String(game.id) === String(selectedId)) || filtered[0] || null;
  const selectedIndex = selected ? filtered.findIndex((game) => String(game.id) === String(selected.id)) : -1;
  const preview = useMemo(() => {
    if (!selected) return null;
    try {
      const notation = selected.pgn || selected.notation || selected.fen || '';
      const full = new Chess();
      if (selected.type === 'fen' || selected.fen) full.load(selected.fen || notation);
      else full.loadPgn(notation);
      const moves = full.history({ verbose: true });
      const startFen = (selected.type === 'fen' || selected.fen) ? (selected.fen || notation) : (full.header().FEN || new Chess().fen());
      const shown = new Chess(startFen);
      moves.slice(0, ply).forEach((move) => shown.move(move));
      return { game: shown, moves, fen: shown.fen(), pgn: selected.pgn || selected.notation || '', solution: moves.slice(ply).map((m) => `${m.from}${m.to}${m.promotion || ''}`) };
    } catch { return null; }
  }, [selected, ply]);
  useEffect(() => { setPly(0); }, [selectedId, source]);
  const load = () => { if (!selected) return; if (selected.pgn || selected.notation) onLoadPgn?.(selected.pgn || selected.notation); else if (selected.fen) onLoadPgn?.({ fen: selected.fen }); };
  const ask = () => preview && onAsk?.({ title: selected.title, fen: preview.fen, solution: preview.solution });
  return <div className="cv2-pgn">
    <div className="cv2-tabs">{['My PGN Library', 'Master Database'].map((s) => <button type="button" className={source === s ? 'active' : ''} onClick={() => { setSource(s); setSelectedId(''); }} key={s}>{s}</button>)}</div>
    <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search games and folders" aria-label="Search PGN library" />
    {error && <p role="alert" className="cv2-muted">{error}</p>}
    {loading && <p className="cv2-muted">Loading library…</p>}
    {!loading && !filtered.length && <p className="cv2-muted">No games found.</p>}
    {!!filtered.length && <select aria-label="Select game" value={selected ? String(selected.id) : ''} onChange={(e) => { setSelectedId(e.target.value); setPly(0); }}>
      {filtered.map((game) => <option key={game.id} value={game.id}>{game.folderName ? `${game.folderName} / ` : ''}{game.title}</option>)}
    </select>}
    {!!filtered.length && <div className="cv2-pgn-nav"><button type="button" disabled={selectedIndex <= 0} onClick={() => { setSelectedId(String(filtered[selectedIndex - 1]?.id)); setPly(0); }}>Previous Game</button><button type="button" disabled={selectedIndex < 0 || selectedIndex >= filtered.length - 1} onClick={() => { setSelectedId(String(filtered[selectedIndex + 1]?.id)); setPly(0); }}>Next Game</button></div>}
    {selected && preview && <>
      <strong>{selected.title}</strong>
      <div className="cv2-pgn-preview"><ChessBoard game={preview.game} fen={preview.fen} interactive={false} showLegalMoves={false} showNotation boardWidth={208} frameless /></div>
      <div className="cv2-pgn-nav"><button type="button" onClick={() => setPly(0)} disabled={!ply}>First</button><button type="button" onClick={() => setPly((n) => Math.max(0, n - 1))} disabled={!ply}>Prev</button><span>{ply}/{preview.moves.length}</span><button type="button" onClick={() => setPly((n) => Math.min(preview.moves.length, n + 1))} disabled={ply >= preview.moves.length}>Next</button><button type="button" onClick={() => setPly(preview.moves.length)} disabled={ply >= preview.moves.length}>Last</button></div>
      <div className="cv2-inline-actions"><button type="button" onClick={load}>Load</button><button type="button" onClick={ask}>Ask</button></div>
    </>}
  </div>;
}
