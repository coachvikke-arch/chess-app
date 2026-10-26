import { useEffect, useMemo, useRef, useState } from 'react';
import GameReplay from '../components/GameReplay';
import { Page } from '../components/ui';
import { gmGames } from '../lib/dailyGames';
import GmQuoteStrip from '../components/GmQuoteStrip';
import { useToast } from '../components/Toast';
import { useUrlTab } from '../hooks/useUrlTab';
import { useUrlView } from '../hooks/useUrlView';
import Button from '../components/Button';
import {
  deleteGmGame,
  getGmPlayers,
  importGmGameFiles,
  importGmGames,
  importGmPlayerGames,
  listGmGames,
  removeGmPlayerGames,
} from '../services/gmGamesApi';

const MAX_FILES = 50;
const PAGE_SIZE = 40;

export default function AdminGmGames({ readOnly = false }) {
  const [query, setQuery] = useState('');
  const [year, setYear] = useState('all');
  const [view, setView] = useUrlTab('view', 'all');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useUrlView('game');
  /* The last game the user WATCHED, which is deliberately SEPARATE from
     `selected` (the game currently open in the replay modal).

     They used to be the same state, which made the active-game highlight
     impossible to ever see: clicking a card set `selected` AND opened the
     modal, whose overlay covers the list — so while the green was "on", it was
     hidden; and closing the modal set `selected = null`, switching it off again.
     The net effect was that the highlighted game was never visible. Splitting
     them means the card stays marked after the viewer is closed, which is the
     point of the highlight ("which game was I looking at?"). */
  const [lastViewed, setLastViewed] = useState(null);
  const [imported, setImported] = useState([]);
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showImport, setShowImport] = useState(false);
  const [showPlayers, setShowPlayers] = useState(false);
  const [importText, setImportText] = useState('');
  const [autoAnnotate, setAutoAnnotate] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [chosenFiles, setChosenFiles] = useState([]);
  const [playerQuery, setPlayerQuery] = useState('');
  const [playerBusy, setPlayerBusy] = useState(null);
  const [playerReport, setPlayerReport] = useState(null);
  const fileInputRef = useRef(null);
  const { showToast } = useToast();

  const refresh = () => {
    setLoading(true);
    Promise.allSettled([listGmGames(), getGmPlayers()]).then(([gamesRes, playersRes]) => {
      setImported(gamesRes.status === 'fulfilled' ? gamesRes.value.data || [] : []);
      setPlayers(playersRes.status === 'fulfilled' ? playersRes.value.data?.players || [] : []);
    }).finally(() => setLoading(false));
  };

  useEffect(refresh, []);

  const catalog = useMemo(() => {
    const bundledIds = new Set(gmGames.map((game) => game.id));
    const importedGames = imported
      .filter((game) => !bundledIds.has(game.id))
      .map((game) => ({ ...game, isImported: true }));
    return [...gmGames, ...importedGames];
  }, [imported]);

  const years = useMemo(() => [...new Set(catalog.map((game) => game.year).filter(Boolean))].sort((a, b) => b - a), [catalog]);

  const games = useMemo(() => catalog.filter((game) => {
    const text = `${game.white} ${game.black} ${game.event} ${game.player || ''}`.toLowerCase();
    return text.includes(query.trim().toLowerCase()) && (year === 'all' || game.year === Number(year));
  }), [catalog, query, year]);

  useEffect(() => { setPage(1); }, [query, year, view]);

  const totalPages = Math.max(1, Math.ceil(games.length / PAGE_SIZE));
  const pageGames = useMemo(() => games.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [games, page]);
  const pageNumbers = useMemo(() => {
    const nums = [];
    for (let i = 1; i <= totalPages; i++) {
      if (i === 1 || i === totalPages || Math.abs(i - page) <= 2) {
        if (nums[nums.length - 1] !== i - 1 && nums.length > 0) nums.push('…');
        nums.push(i);
      }
    }
    return nums;
  }, [totalPages, page]);

  const pageControls = (compact) => (
    <div className={`gm-pagination${compact ? ' gm-pagination-top' : ''}`}>
      <button type="button" className="gm-page-btn" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹ Prev</button>
      {compact
        ? <span className="gm-page-info">{page} / {totalPages}</span>
        : pageNumbers.map((n, i) => (
          n === '…'
            ? <span key={`gap-${i}`} className="gm-page-gap">…</span>
            : <button key={n} type="button" className={`gm-page-num${n === page ? ' on' : ''}`} onClick={() => setPage(n)}>{n}</button>
        ))}
      <button type="button" className="gm-page-btn" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next ›</button>
      {!compact && <span className="gm-page-info">{page} / {totalPages} · {games.length} games</span>}
    </div>
  );

  const groupedGames = useMemo(() => {
    const groups = new Map();
    for (const game of games) {
      const key = game.player || '';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(game);
    }
    return [...groups.entries()].sort((a, b) => {
      if (!a[0]) return 1;
      if (!b[0]) return -1;
      return a[0].toLowerCase().localeCompare(b[0].toLowerCase());
    });
  }, [games]);

  const selectedGame = useMemo(() => catalog.find((game) => String(game.id) === String(selected)) || null, [catalog, selected]);

  const playerPacksDone = players.filter((player) => player.count > 0).length;
  const filteredPlayers = useMemo(() => {
    const q = playerQuery.trim().toLowerCase();
    return players
      .filter((player) => player.name.toLowerCase().includes(q))
      .sort((a, b) => {
        const ai = a.count > 0 ? 0 : 1;
        const bi = b.count > 0 ? 0 : 1;
        return ai - bi || a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      });
  }, [players, playerQuery]);

  const gameCard = (game) => (
    <button
      key={game.id}
      type="button"
      onClick={() => { setSelected(String(game.id)); setLastViewed(game.id); }}
      className={`gm-game-list-card gm-glass-card !text-left w-full ${lastViewed === game.id ? 'selected' : ''}`}
    >
      <span className="gm-list-year">{game.year}</span>
      <span>
        <strong>{game.white} vs {game.black}{game.isImported && <em className="gm-imported-badge">imported</em>}</strong>
        <small>
          {game.event} · {game.result} ·{' '}
          {/* Its own span so it can be highlighted independently of the rest of
              the meta line: when this game is the one open in the viewer
              (`.selected`), the key-moment count turns green so you can see at a
              glance WHICH game the board is currently showing. */}
          <span className="gm-key-moments">{(game.annotations || []).length} key moments</span>
          {game.player ? ` · ${game.player}` : ''}
        </small>
      </span>
      {game.isImported && !readOnly
        ? <span className="gm-list-actions" onClick={(event) => { event.stopPropagation(); removeGame(game.id); }}>🗑</span>
        : <span>▶</span>}
    </button>
  );

  const summarizeImport = (data) => {
    const parts = [];
    if (data?.imported?.length) parts.push(`${data.imported.length} imported`);
    if (data?.noMoves?.length) parts.push(`${data.noMoves.length} had no moves`);
    if (data?.skipped?.length) parts.push(`${data.skipped.length} duplicates`);
    if (data?.failed?.length) parts.push(`${data.failed.length} failed`);
    return parts.join(' · ') || 'Nothing new to import';
  };

  const runImport = async () => {
    if (!importText.trim()) return;
    setBusy(true);
    setError('');
    try {
      const res = await importGmGames({ pgn: importText, autoAnnotate });
      setResult(res.data);
      setImportText('');
      showToast(summarizeImport(res.data), { tone: res.data.imported.length > 0 ? 'success' : 'info', title: 'Import complete' });
      refresh();
    } catch (err) {
      const msg = err.response?.data?.message || 'Import failed. Check the pasted PGN and try again.';
      setError(msg);
      showToast(msg, { tone: 'error', title: 'Import failed' });
    } finally {
      setBusy(false);
    }
  };

  const pickFiles = (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    const good = files.filter((file) => /\.(pgn|txt)$/i.test(file.name));
    const bad = files.length - good.length;
    setChosenFiles((prev) => {
      const merged = [...prev, ...good];
      const seen = new Set();
      return merged.filter((file) => {
        const key = `${file.name}:${file.size}:${file.lastModified}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).slice(0, MAX_FILES);
    });
    if (bad > 0) setError(`Ignored ${bad} non-PGN file${bad > 1 ? 's' : ''}. Only .pgn / .txt are supported.`);
    else setError('');
  };

  const dropFile = (event) => {
    event.preventDefault();
    pickFiles(event.dataTransfer?.files);
  };

  const clearFiles = () => {
    setChosenFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const runFileImport = async () => {
    if (chosenFiles.length === 0) return;
    setBusy(true);
    setError('');
    try {
      const res = await importGmGameFiles(chosenFiles, { autoAnnotate });
      setResult(res.data);
      clearFiles();
      refresh();
      showToast(summarizeImport(res.data), { tone: res.data.imported.length > 0 ? 'success' : 'info', title: 'File import complete' });
    } catch (err) {
      const msg = err.response?.data?.message || 'File import failed. Check the files and try again.';
      setError(msg);
      showToast(msg, { tone: 'error', title: 'Import failed' });
    } finally {
      setBusy(false);
    }
  };

  const removeGame = async (id) => {
    if (!window.confirm('Delete this imported game? The bundled GM classics are unaffected.')) return;
    try {
      await deleteGmGame(id);
      if (String(selected) === String(id)) setSelected(null);
      /* Don't leave the highlight pointing at a game that no longer exists. */
      setLastViewed((current) => (String(current) === String(id) ? null : current));
      refresh();
    } catch {
      window.alert('Could not delete that game.');
    }
  };

  /* ── Undo a player pack import ──
     Removes every imported game for that player in one call, so the pack can be
     re-imported cleanly (e.g. after a partial/failed import). Only rows tagged
     with that `player` are deleted — the bundled classics and any hand-pasted
     import (which carries no player tag) are untouched. The confirm names the
     exact game count because this removes thousands of rows at once and is not
     individually undoable. */
  const runPlayerRemove = async (playerName, count) => {
    if (playerBusy) return;
    const ok = window.confirm(
      `Remove ${count} imported ${count === 1 ? 'game' : 'games'} for ${playerName}?\n\n`
      + 'This deletes the whole pack from the database. The bundled GM classics are unaffected, '
      + 'and you can re-import the player at any time.'
    );
    if (!ok) return;
    setPlayerBusy(playerName);
    setPlayerReport(null);
    try {
      const res = await removeGmPlayerGames(playerName);
      const removed = res.data?.deleted || 0;
      /* A game open in the viewer may have just been deleted. */
      setSelected((current) => {
        if (!current) return null;
        return (res.data?.ids || []).includes(current) ? null : current;
      });
      /* Same for the highlight — it must not survive the game it points at. */
      setLastViewed((current) => {
        if (!current) return null;
        return (res.data?.ids || []).includes(current) ? null : current;
      });
      refresh();
      showToast(
        removed > 0
          ? `Removed ${removed} ${removed === 1 ? 'game' : 'games'} for ${playerName}.`
          : `Nothing to remove for ${playerName}.`,
        { tone: removed > 0 ? 'success' : 'info', title: `${playerName} — import undone` },
      );
    } catch (err) {
      const msg = err.response?.data?.message || `Could not remove ${playerName}'s games.`;
      setPlayerReport({ player: playerName, error: msg });
      showToast(msg, { tone: 'error', title: 'Undo import failed' });
    } finally {
      setPlayerBusy(null);
    }
  };

  const runPlayerImport = async (playerName) => {
    if (playerBusy) return;
    setPlayerBusy(playerName);
    setPlayerReport(null);
    try {
      const res = await importGmPlayerGames(playerName, { autoAnnotate });
      setPlayerReport({ player: playerName, ...res.data });
      showToast(summarizeImport(res.data), {
        tone: res.data.imported.length > 0 ? 'success' : 'info',
        title: `${playerName} — pack ready`,
      });
      refresh();
    } catch (err) {
      const msg = err.response?.data?.message || `Could not import ${playerName}'s games.`;
      setPlayerReport({ player: playerName, error: msg });
      showToast(msg, { tone: 'error', title: `${playerName} import failed` });
    } finally {
      setPlayerBusy(null);
    }
  };

  const importAllPlayers = async () => {
    if (playerBusy) return;
    setPlayerBusy('__all__');
    setPlayerReport(null);
    const totals = { imported: 0, skipped: 0, noMoves: 0, failed: 0 };
    try {
      for (const player of players) {
        const res = await importGmPlayerGames(player.name, { autoAnnotate });
        const data = res.data || {};
        totals.imported += data.imported?.length || 0;
        totals.skipped += data.skipped?.length || 0;
        totals.noMoves += data.noMoves?.length || 0;
        totals.failed += data.failed?.length || 0;
      }
      setPlayerReport({ all: true, ...totals });
      refresh();
      showToast(`${totals.imported} imported · ${totals.skipped} duplicates · ${totals.failed} failed`, {
        tone: totals.imported > 0 ? 'success' : 'info',
        title: 'All packs complete',
      });
    } catch (err) {
      const msg = err.response?.data?.message || 'Import all stopped part-way through.';
      setPlayerReport({ error: msg });
      showToast(msg, { tone: 'error', title: 'Import all failed' });
    } finally {
      setPlayerBusy(null);
    }
  };

  const importCount = imported.length;

  const anyModalOpen = Boolean(selected || showPlayers || showImport);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('chess-modal-panel', { detail: { open: anyModalOpen } }));
  }, [anyModalOpen]);

  return (
    <div className="gm-admin-games-page">
      <Page title="GM Games" piece="♞" sub={`${gmGames.length} sourced historical masterpieces for study, coaching and classroom analysis.`}>
      <GmQuoteStrip />
      <div className="gm-player-toolbar">
        <label>⌕<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search player, event or pack…" /></label>
        <div className="flex items-center gap-2 flex-wrap">
          {importCount > 0 && <span className="gm-import-count">{importCount} imported</span>}
          <div className="gm-view-toggle" role="tablist" aria-label="Display mode">
            <button type="button" className={view === 'all' ? 'active' : ''} onClick={() => setView('all')} role="tab" aria-selected={view === 'all'}>📚 All</button>
            <button type="button" className={view === 'players' ? 'active' : ''} onClick={() => setView('players')} role="tab" aria-selected={view === 'players'}>♟ By player</button>
          </div>
          <select value={year} onChange={(event) => setYear(event.target.value)} className="rounded-xl border border-ivory-700/30 bg-white px-3 py-2 text-sm text-slate-700 outline-none">
            <option value="all">All years</option>
            {years.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <span className="text-xs text-ivory-500">{games.length} games{view === 'players' ? ` · ${groupedGames.length} groups` : ''}</span>
          {view !== 'players' && games.length > PAGE_SIZE && pageControls(true)}
          {!readOnly && (
            <Button type="button" variant="secondary" size="sm" onClick={() => setShowPlayers(true)}>
              ⬇ PgnMentor {playerPacksDone > 0 && <em className="gm-import-count">{playerPacksDone}/{players.length}</em>}
            </Button>
          )}
          {!readOnly && (
            <Button type="button" variant="primary" size="sm" onClick={() => setShowImport(true)}>⬆ Import PGNs</Button>
          )}
        </div>
      </div>

      {view === 'players' ? (
        <div className="gm-catalog-scroll">
          {groupedGames.length === 0
            ? <div className="chess-card p-6 text-center text-ivory-500">No GM games match this filter.</div>
            : groupedGames.map(([playerName, list]) => (
              <section key={playerName || '__other__'} className="gm-player-group">
                <h3 className="gm-player-group-head">
                  {playerName || 'Other classics'}
                  <span>{list.length} game{list.length > 1 ? 's' : ''}</span>
                </h3>
                <div className="gm-player-game-list">{list.map(gameCard)}</div>
              </section>
            ))}
        </div>
      ) : (
        <div className="gm-catalog-scroll">
          <div className="gm-admin-game-catalog gm-player-game-list">
            {pageGames.map(gameCard)}
            {games.length === 0 && <div className="chess-card p-6 text-center text-ivory-500">No GM games match this filter.</div>}
          </div>
        </div>
      )}

      {view !== 'players' && games.length > PAGE_SIZE && pageControls(false)}

      {selected && (
        <div className="gm-admin-game-modal-overlay" role="dialog" aria-modal="true" aria-label="GM game replay" onClick={() => setSelected(null)}>
          <div className="gm-admin-game-modal gm-glass-card" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="gm-admin-game-close" aria-label="Close game" onClick={() => setSelected(null)}>✕</button>
            <header className="gm-admin-viewer-head">
              <div className="gm-admin-viewer-titles">
                <span className="gm-eyebrow">{selectedGame?.isImported ? 'Imported GM study replay' : 'GM study replay'}</span>
                <h2>
                  <span className="is-white">{selectedGame?.white}</span>
                  <span className="gm-head-vs">vs</span>
                  <span className="is-black">{selectedGame?.black}</span>
                </h2>
              </div>
              <div className="gm-admin-viewer-meta">
                {selectedGame?.player && <span className="gm-meta-chip">{selectedGame.player}</span>}
                <span className="gm-meta-chip">{selectedGame?.event}</span>
                <span className="gm-meta-chip">{selectedGame?.year}</span>
                <span className="gm-meta-chip gm-meta-chip--result">{selectedGame?.result}</span>
                <span className="gm-admin-viewer-label">{selectedGame?.isImported ? '↗ Imported game' : '↗ Historical game'}</span>
              </div>
            </header>
            <GameReplay gameId={selected} compact />
          </div>
        </div>
      )}

      {showPlayers && (
        <div className="gm-import-overlay" role="dialog" aria-modal="true" aria-label="Import by player" onClick={() => { if (!playerBusy) setShowPlayers(false); }}>
          <div className="gm-import-modal gm-pgn-modal gm-glass-card" onClick={(event) => event.stopPropagation()}>
            <div className="gm-import-head">
              <div>
                <span className="gm-eyebrow">pgnmentor.com packs</span>
                <h2>⬇ Import by player</h2>
                <p>Download a player&apos;s complete game collection from <code>pgnmentor.com</code>, import every game and study it player-wise.</p>
              </div>
              <button type="button" className="gm-admin-game-close" aria-label="Close players" onClick={() => setShowPlayers(false)}>✕</button>
            </div>

            <div className="gm-pgn-actions">
              <label>⌕<input value={playerQuery} onChange={(event) => setPlayerQuery(event.target.value)} placeholder="Filter players…" /></label>
              <Button type="button" variant="primary" size="sm" onClick={importAllPlayers} disabled={!!playerBusy || players.length === 0}>
                {playerBusy === '__all__' ? 'Importing all…' : `Import all (${players.length})`}
              </Button>
            </div>

            <div className="gm-pgn-list">
              {filteredPlayers.map((player) => (
                <div key={player.name} className={`gm-player-pack${player.count > 0 ? ' ready' : ''}`}>
                  <span className="gm-player-pack-name">{player.name}</span>
                  <span className={`gm-player-pack-count ${player.count > 0 ? 'ready' : ''}`}>{player.count > 0 ? `✓ ${player.count} games` : 'Not imported'}</span>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => runPlayerImport(player.name)}
                    disabled={!!playerBusy}
                  >
                    {playerBusy === player.name
                      ? 'Importing…'
                      : player.count > 0 ? 'Re-import' : 'Import'}
                  </Button>
                  {/* Undo import — SYMBOL ONLY ("↩"), a compact square.
                      It used to be a full "↩ Undo import" button, but every
                      item in this row except the name is `flex-shrink: 0`, so a
                      second wide button squeezed the player's NAME down to zero
                      width and the rows read as blank. The icon keeps its
                      accessible name via aria-label + title, and the exact game
                      count is stated in the confirm dialog on click. */}
                  {player.count > 0 && (
                    <button
                      type="button"
                      className="gm-player-pack-undo"
                      onClick={() => runPlayerRemove(player.name, player.count)}
                      disabled={!!playerBusy}
                      aria-label={`Undo import — remove ${player.count} imported ${player.count === 1 ? 'game' : 'games'} for ${player.name}`}
                      title={`Undo import — remove ${player.count} imported ${player.count === 1 ? 'game' : 'games'} for ${player.name}`}
                    >
                      {playerBusy === player.name
                        ? <span className="gm-spinner" />
                        : '↩'}
                    </button>
                  )}
                </div>
              ))}
              {filteredPlayers.length === 0 && <p className="gm-pgn-empty">No player matches “{playerQuery}”.</p>}
            </div>

            {playerReport && (
              <div className="gm-import-result">
                {playerReport.error
                  ? <p className="gm-imp-fail">✕ {playerReport.player ? `${playerReport.player}: ` : ''}{playerReport.error}</p>
                  : (
                    <>
                      <p>
                        <strong className="gm-imp-ok">{playerReport.imported} imported</strong>
                        {playerReport.noMoves > 0 && <strong className="gm-imp-nomoves"> · {playerReport.noMoves} had no moves</strong>}
                        <span> · {playerReport.skipped} duplicates · {playerReport.failed} failed</span>
                        {playerReport.all && <span> across all packs</span>}
                      </p>
                      {playerReport.player && playerReport.files?.length > 0
                        && <p>📄 {playerReport.files.join(', ')}</p>}
                    </>
                  )}
              </div>
            )}
          </div>
        </div>
      )}

      {showImport && (
        <div className="gm-import-overlay" role="dialog" aria-modal="true" aria-label="Import GM games" onClick={() => { if (!busy) setShowImport(false); }}>
          <div className="gm-import-modal gm-glass-card" onClick={(event) => event.stopPropagation()}>
            <div className="gm-import-head">
              <div>
                <span className="gm-eyebrow">Bulk import</span>
                <h2>⬆ Import GM games</h2>
                <p>Paste one or more PGN games — each <code>[Event</code> header starts a new game.</p>
              </div>
              <button type="button" className="gm-admin-game-close" aria-label="Close import" onClick={() => setShowImport(false)}>✕</button>
            </div>

            <textarea
              className="gm-import-area"
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
              placeholder={'[Event "World Championship"]\n[Site "Moscow"]\n[Date "1986.??.??"]\n[White "Karpov, Anatoly"]\n[Black "Kasparov, Garry"]\n[Result "1-0"]\n\n1.e4 c5 2.Nf3 d6 ...'}
              spellCheck="false"
            />

            <div className="gm-import-divider">
              <span>or</span>
            </div>

            <div
              className="gm-dropzone"
              role="button"
              tabIndex={0}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') fileInputRef.current?.click(); }}
              onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }}
              onDrop={dropFile}
            >
              <p className="gm-dropzone-main">📄 Drop .pgn files here</p>
              <p className="gm-dropzone-sub">or click to browse — select multiple files at once (up to {MAX_FILES})</p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pgn,.txt,text/plain"
              multiple
              className="hidden"
              onChange={(event) => { pickFiles(event.target.files); event.target.value = ''; }}
            />

            {chosenFiles.length > 0 && (
              <div className="gm-file-chips">
                {chosenFiles.map((file, index) => (
                  <span key={`${file.name}:${file.size}`} className="gm-file-chip">
                    📄 {file.name}
                    <button type="button" aria-label={`Remove ${file.name}`} onClick={() => setChosenFiles((prev) => prev.filter((_, i) => i !== index))}>✕</button>
                  </span>
                ))}
                <Button type="button" variant="ghost" size="sm" onClick={clearFiles}>Clear all</Button>
              </div>
            )}

            <label className="gm-import-options">
              <input type="checkbox" checked={autoAnnotate} onChange={(event) => setAutoAnnotate(event.target.checked)} />
              <span>Auto-generate key-moment annotations (5 per game)</span>
            </label>

            <div className="gm-import-foot">
              {error && <span className="gm-import-error">{error}</span>}
              <Button type="button" variant="secondary" size="md" onClick={() => setShowImport(false)} disabled={busy}>Cancel</Button>
              {chosenFiles.length > 0 ? (
                <Button type="button" variant="primary" size="md" loading={busy} onClick={runFileImport} disabled={chosenFiles.length === 0}>{`Import ${chosenFiles.length} file${chosenFiles.length > 1 ? 's' : ''}`}</Button>
              ) : (
                <Button type="button" variant="primary" size="md" loading={busy} onClick={runImport} disabled={!importText.trim()}>Import games</Button>
              )}
            </div>

            {result && (
              <div className="gm-import-result">
                <p>
                  <strong className="gm-imp-ok">{result.imported.length} imported</strong>
                  {result.noMoves?.length > 0 && <strong className="gm-imp-nomoves"> · {result.noMoves.length} had no moves</strong>}
                  <span> · {result.skipped.length} duplicates · {result.failed.length} failed</span>
                </p>
                {result.files?.length > 0 && <p>📄 Read from {result.files.length} file{result.files.length > 1 ? 's' : ''}: {result.files.slice(0, 5).join(', ')}{result.files.length > 5 ? ` +${result.files.length - 5} more` : ''}</p>}
                {result.noMoves?.length > 0 && <ul>{result.noMoves.map((item, i) => <li key={i} className="gm-imp-no">◦ {item.title} — {item.reason}</li>)}</ul>}
                {result.skipped.length > 0 && <ul>{result.skipped.map((item, i) => <li key={i} className="gm-imp-skip">• {item.title} — {item.reason}</li>)}</ul>}
                {result.failed.length > 0 && <ul>{result.failed.map((item, i) => <li key={i} className="gm-imp-fail">✕ {item.title} — {item.reason}</li>)}</ul>}
                {result.imported.map((item) => <p key={item.id} className="gm-imp-ok">✓ {item.id}</p>)}
              </div>
            )}
          </div>
        </div>
      )}
    </Page>
    </div>
  );
}