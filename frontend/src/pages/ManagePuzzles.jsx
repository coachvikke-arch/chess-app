import { useEffect, useState, useCallback } from 'react';
import api from '../services/api';
import PuzzlePlayer from '../components/PuzzlePlayer';
import CsvImportSetWizard from '../components/CsvImportSetWizard';
import { Page, Chip } from '../components/ui';
import Button from '../components/Button';

const THEME_CATEGORIES = [
  { key: 'Recommended', icon: '★', themes: ['fork', 'pin', 'skewer', 'sacrifice', 'discoveredAttack', 'hangingPiece', 'trappedPiece', 'deflection', 'attraction', 'backRankMate', 'mateIn1', 'mateIn2', 'mateIn3'] },
  { key: 'Phases', icon: '♟', themes: ['opening', 'middlegame', 'endgame', 'rookEndgame', 'bishopEndgame', 'pawnEndgame', 'knightEndgame', 'queenEndgame'] },
  { key: 'Motifs', icon: '⚔', themes: ['fork', 'pin', 'skewer', 'sacrifice', 'discoveredAttack', 'doubleCheck', 'trappedPiece', 'deflection', 'attraction', 'intermezzo', 'xrayAttack', 'zugzwang', 'hangingPiece', 'capturedDefender', 'clearance', 'quietMove', 'exposedKing', 'kingsideAttack', 'queensideAttack', 'advancedPawn', 'attackingF2F7'] },
  { key: 'Mates', icon: '♛', themes: ['mateIn1', 'mateIn2', 'mateIn3', 'mateIn4', 'mateIn5', 'backRankMate', 'smotheredMate', 'operaMate', 'hookMate', 'dovetailMate', 'arabianMate', 'anastasMate', 'bodenMate'] },
  { key: 'Goals', icon: '🎯', themes: ['advantage', 'crushing', 'equality'] },
  { key: 'Length', icon: '📐', themes: ['oneMove', 'short', 'long', 'veryLong'] },
];

const THEME_LABELS = {
  fork: 'Fork', pin: 'Pin', skewer: 'Skewer', sacrifice: 'Sacrifice',
  discoveredAttack: 'Discovered Attack', doubleCheck: 'Double Check',
  trappedPiece: 'Trapped Piece', deflection: 'Deflection',
  attraction: 'Attraction', intermezzo: 'Intermezzo',
  xrayAttack: 'X-Ray Attack', zugzwang: 'Zugzwang',
  hangingPiece: 'Hanging Piece', capturedDefender: 'Capture Defender',
  clearance: 'Clearance', quietMove: 'Quiet Move',
  backRankMate: 'Back-Rank Mate', exposedKing: 'Exposed King',
  kingsideAttack: 'Kingside Attack', queensideAttack: 'Queenside Attack',
  advancedPawn: 'Advanced Pawn', attackingF2F7: 'Attacking f2/f7',
  mateIn1: 'Mate in 1', mateIn2: 'Mate in 2', mateIn3: 'Mate in 3',
  mateIn4: 'Mate in 4', mateIn5: 'Mate in 5+',
  smotheredMate: 'Smothered Mate', operaMate: 'Opera Mate',
  hookMate: 'Hook Mate', dovetailMate: 'Dovetail Mate',
  arabianMate: 'Arabian Mate', anastasMate: "Anastasia's Mate",
  bodenMate: "Boden's Mate",
  rookEndgame: 'Rook Endgame', bishopEndgame: 'Bishop Endgame',
  pawnEndgame: 'Pawn Endgame', knightEndgame: 'Knight Endgame',
  queenEndgame: 'Queen Endgame',
  opening: 'Opening', middlegame: 'Middlegame', endgame: 'Endgame',
  advantage: 'Advantage', crushing: 'Crushing', equality: 'Equality',
  oneMove: 'One-Move', short: 'Short (2 moves)', shortPuzzle: 'Short (2 moves)', long: 'Long (3 moves)', longPuzzle: 'Long (3 moves)', veryLong: 'Very Long (4+)',
};

const SOLUTION_SUGGESTIONS = [
  { label: 'Simple fork', value: 'Nc7+ Ka8' },
  { label: 'Back rank mate', value: 'Re8#' },
  { label: 'Skewer', value: 'Bg4+' },
];

export default function ManagePuzzles() {
  const [puzzles, setPuzzles] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [activeTheme, setActiveTheme] = useState(null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('id');
  const [loading, setLoading] = useState(false);
  const [themeCounts, setThemeCounts] = useState({});

  const [playing, setPlaying] = useState(null);
  const [showCsvSetWizard, setShowCsvSetWizard] = useState(false);

  const loadPuzzles = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: 50, sort };
      if (activeTheme) params.theme = activeTheme;
      if (search) params.search = search;
      const res = await api.get('/puzzles', { params });
      setPuzzles(res.data.puzzles || []);
      setTotal(res.data.total || 0);
    } catch { /* ignore */ }
    setLoading(false);
  }, [page, activeTheme, search, sort]);

  const loadThemes = useCallback(async () => {
    try {
      const res = await api.get('/puzzles/themes');
      const counts = {};
      const cats = res.data.categories || {};
      for (const cat of Object.values(cats)) {
        for (const it of cat.items || []) counts[it.id] = it.count;
      }
      setThemeCounts(counts);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadPuzzles(); }, [loadPuzzles]);
  useEffect(() => { loadThemes(); }, [loadThemes]);

  // Reference to refresh theme counts after import
  const refreshThemes = () => loadThemes();

  function selectTheme(themeId) {
    setActiveTheme(activeTheme === themeId ? null : themeId);
    setPage(1);
  }

  async function removePuzzle(id) {
    if (!confirm('Delete this puzzle?')) return;
    await api.delete(`/puzzles/${id}`);
    loadPuzzles();
    refreshThemes();
  }

  const totalPages = Math.ceil(total / 50);

  return (
    <div className="max-w-[90rem] mx-auto flex gap-4 px-4 py-6">
      {/* ── Theme sidebar ── */}
      <aside className="w-64 shrink-0 hidden lg:block">
        <div className="sticky top-20 rounded-2xl border border-ivory-700/50 bg-black/[0.03] backdrop-blur-xl px-3 py-4 max-h-[calc(100vh-90px)] overflow-y-auto scrollbar-thin">
          <p className="text-[0.65rem] uppercase tracking-[0.18em] text-ivory-500 font-semibold px-3 mb-3">
            ♞ Puzzle Themes
          </p>
          <button
            onClick={() => selectTheme(null)}
            className={`w-full text-left px-3 py-2 rounded-xl text-sm font-medium transition mb-1 ${
              !activeTheme ? 'bg-gold-700/15 text-gold-400' : 'text-ivory-500 hover:text-ivory-300 hover:bg-black/5'
            }`}
          >
            All Puzzles
          </button>
          {THEME_CATEGORIES.map((cat) => {
            const present = cat.themes.filter((t) => themeCounts[t]);
            const catTotal = present.reduce((s, t) => s + themeCounts[t], 0);
            if (catTotal === 0) return null; // hide empty sections
            return (
              <details key={cat.key} open className="group">
                <summary className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium text-ivory-300 cursor-pointer hover:bg-black/5 transition list-none">
                  <span>{cat.icon}</span>
                  <span>{cat.key}</span>
                  <span className="ml-auto text-[0.6rem] text-gold-500/80">{catTotal.toLocaleString()}</span>
                </summary>
                <div className="ml-3 border-l border-ivory-700/40 pl-2">
                  {present.map((t) => (
                    <button
                      key={t}
                      onClick={() => selectTheme(t)}
                      className={`w-full text-left px-3 py-1.5 rounded-lg text-xs transition flex items-center ${
                        activeTheme === t
                          ? 'bg-gold-700/15 text-gold-400 font-medium'
                          : 'text-ivory-500 hover:text-ivory-300 hover:bg-black/5'
                      }`}
                    >
                      <span className="truncate">{THEME_LABELS[t] || t}</span>
                      <span className="ml-auto text-[0.6rem] text-ivory-500 tabular-nums">
                        {themeCounts[t].toLocaleString()}
                      </span>
                    </button>
                  ))}
                </div>
              </details>
            );
          })}
        </div>
      </aside>

      {/* ── Main content ── */}
      <main className="flex-1 min-w-0">
        {/* Header row */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div>
            <h1 className="font-display text-3xl font-bold text-ivory-100">Puzzle Laboratory</h1>
            <p className="text-ivory-500 text-sm mt-1">
              {total} puzzles {activeTheme ? `· ${THEME_LABELS[activeTheme] || activeTheme}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => setShowCsvSetWizard(true)}
              variant="primary" size="md" className="!px-4 !py-2 text-sm"
              title="Import a CSV file as one puzzle set, in order, with per-puzzle titles"
            >
              📦 Import CSV → Set
            </Button>
            <input
              placeholder="Search…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="chess-input w-44 !text-xs"
            />
            <select value={sort} onChange={(e) => setSort(e.target.value)} className="chess-input w-32 !text-xs">
              <option value="id">Newest</option>
              <option value="nb_plays">Most played</option>
              <option value="popularity">Popular</option>
            </select>
          </div>
        </div>

        {/* Mobile theme chips */}
        <div className="lg:hidden flex gap-1.5 overflow-x-auto pb-3 mb-4 -mx-1 px-1">
          <button
            onClick={() => selectTheme(null)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition whitespace-nowrap ${
              !activeTheme ? 'border-gold-500/50 bg-gold-700/15 text-gold-400' : 'border-ivory-700/50 bg-black/[0.03] text-ivory-500'
            }`}
          >
            All
          </button>
          {(() => {
            const seen = new Set();
            return THEME_CATEGORIES.flatMap((cat) =>
              cat.themes.slice(0, 6).filter((t) => {
                if (seen.has(t)) return false;
                seen.add(t);
                return true;
              }).map((t) => (
                <button
                  key={t}
                  onClick={() => selectTheme(t)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition whitespace-nowrap ${
                    activeTheme === t ? 'border-gold-500/50 bg-gold-700/15 text-gold-400' : 'border-ivory-700/50 bg-black/[0.03] text-ivory-500'
                  }`}
                >
                  {THEME_LABELS[t] || t}
                </button>
              ))
            );
          })()}
        </div>

        {/* Puzzle grid */}
        {loading ? (
          <div className="chess-card"><p className="chess-empty">Loading puzzles…</p></div>
        ) : puzzles.length === 0 ? (
          <div className="chess-card text-center py-12">
            <span className="block text-5xl mb-3 piece-glyph-spin text-gold-500/40">♟</span>
            <p className="chess-empty">
              {activeTheme ? `No puzzles found for "${THEME_LABELS[activeTheme] || activeTheme}".` : 'No puzzles yet.'}
            </p>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
            {puzzles.map((p) => (
              <div key={p.id} className="chess-card chess-card-hover relative group/card">
                <button
                  onClick={() => setPlaying(p)}
                  className="absolute inset-0 z-10 cursor-pointer rounded-2xl"
                  aria-label={`Play puzzle ${p.id}`}
                />
                <div className="relative flex items-start justify-between gap-2 mb-2">
                  <p className="font-medium text-ivory-100 flex items-center gap-2 text-sm">
                    <span className="text-gold-400">♞</span>
                    {p.theme}
                  </p>
                  <div className="flex items-center gap-1">
                    <span className="text-[0.6rem] px-2 py-0.5 rounded-full bg-gold-700/15 text-gold-400 z-20">▶</span>
                    <button
                      onClick={() => removePuzzle(p.id)}
                      className="opacity-0 group-hover/card:opacity-100 text-xs text-red-600 hover:text-red-600 transition px-1 z-20"
                      title="Delete"
                    >
                      ✕
                    </button>
                  </div>
                </div>
                <div className="relative flex flex-wrap gap-1 mb-2">
                  <Chip tone="gold">{p.difficulty}</Chip>
                  {p.nb_plays > 0 && <Chip tone="green">{(p.nb_plays).toLocaleString()} plays</Chip>}
                </div>
                {p.themes && p.themes.length > 1 && (
                  <div className="flex flex-wrap gap-1 mb-2">
                    {p.themes.slice(0, 4).map((t) => (
                      <span key={t} className="text-[0.6rem] px-1.5 py-0.5 rounded bg-black/5 text-ivory-500">
                        {THEME_LABELS[t] || t}
                      </span>
                    ))}
                    {p.themes.length > 4 && (
                      <span className="text-[0.6rem] px-1.5 py-0.5 rounded bg-black/5 text-ivory-500">
                        +{p.themes.length - 4}
                      </span>
                    )}
                  </div>
                )}
                {p.game_url && (
                  <a href={p.game_url} target="_blank" rel="noopener noreferrer"
                    className="text-[0.6rem] text-gold-500 hover:text-gold-400 transition mt-1 inline-block z-20">
                    View on Lichess →
                  </a>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-6">
            <Button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}
              variant="secondary" size="sm" className="!px-3 !py-1.5 text-xs disabled:opacity-30">
              ← Prev
            </Button>
            <span className="text-xs text-ivory-500">
              Page {page} of {totalPages}
            </span>
            <Button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}
              variant="secondary" size="sm" className="!px-3 !py-1.5 text-xs disabled:opacity-30">
              Next →
            </Button>
          </div>
        )}
      </main>

      {/* ── On-site puzzle player modal ── */}
      {playing && (
        <div className="fixed inset-0 z-[var(--z-modal-backdrop)] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={() => setPlaying(null)}>
          <div
            className="chess-card max-w-2xl w-full p-6 relative"
            onClick={(e) => e.stopPropagation()}
            style={{ animation: 'board-pop .3s both' }}
          >
            <button
              onClick={() => setPlaying(null)}
              className="absolute top-3 right-3 text-ivory-500 hover:text-ivory-300 text-xl leading-none z-20"
              title="Close"
            >
              ✕
            </button>
            <div className="flex flex-wrap gap-2 mb-4 pr-8">
              <Chip tone="gold">{THEME_LABELS[playing.theme] || playing.theme}</Chip>
              <Chip>{playing.difficulty}</Chip>
              {playing.explanation && <Chip>💡 {playing.explanation}</Chip>}
            </div>
            <PuzzlePlayer
              key={playing.id}
              fen={playing.fen}
              solution={playing.solution || []}
              onSolved={() => {}}
              onFailed={() => {}}
            />
            <p className="text-center text-[0.65rem] text-ivory-500 mt-3">
              Play your move — the opponent reply is shown automatically.
            </p>
          </div>
        </div>
      )}

      {showCsvSetWizard && (
        <CsvImportSetWizard
          onClose={() => setShowCsvSetWizard(false)}
          onImported={() => { loadPuzzles(); refreshThemes(); }}
        />
      )}
      </div>
  );
}