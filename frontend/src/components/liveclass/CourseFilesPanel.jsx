import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Button from '../Button';
import { useUrlView } from '../../hooks/useUrlView';
import { Folder, House } from 'lucide-react';
import ChessBoard from '../ChessBoard';
import { fetchLibraryPublic } from '../../utils/libraryApi';
import useArrowKeys from '../../hooks/useArrowKeys';
import { buildReplay, pairRows } from '../../pages/Library';
import { useLiveClass } from '../../context/LiveClassContext';
import { emit } from '../../services/socket';

/* In-classroom course files browser, styled like the chat panel and rendered in
   the same side column. Reads the instructor's local Chess Library. */

function folderPath(folders, id) {
  const path = [];
  let cur = folders.find((f) => String(f.id) === String(id));
  while (cur) {
    path.unshift(cur);
    cur = folders.find((f) => String(f.id) === String(cur.parentId));
  }
  return path;
}

/* Total files in a folder INCLUDING everything nested in its subfolders, so a
   course-folder row shows the real game count even when the files live one
   or more levels deep (matches the Library's own recursive folder). */
function countFolderFiles(folders, folder) {
  const direct = (folder?.items || []).length;
  const nested = folders
    .filter((f) => f.parentId === folder.id)
    .reduce((n, f) => n + countFolderFiles(folders, f), 0);
  return direct + nested;
}

/* The library now lives on the server and is SHARED by every admin, so this
   panel fetches it (once per mount) instead of reading this browser's old
   per-machine copy. It reads through the READ-ONLY public route so the same
   call works wherever the panel is mounted, independent of the admin-only
   endpoint. The brief in-flight promise is reused so a quick close / reopen
   cannot fire two requests. */
let libraryPromise = null;
function fetchLibraryOnce() {
  if (!libraryPromise) {
    libraryPromise = fetchLibraryPublic()
      .catch(() => ({ folders: [] }))
      .finally(() => { libraryPromise = null; });
  }
  return libraryPromise;
}

/* How many cards to mount at a time. Each card mounts a full board, so the list
   grows in batches rather than rendering 50 boards the moment a folder opens -
   but it is now a BATCH SIZE, not a page the reader has to click through: the
   sentinel below grows the list automatically as it is scrolled into view, so
   reaching the 50th puzzle takes no clicks at all. */
const CARD_PAGE = 12;

/* Measured width of the cards column, so each mini board is sized to the
   card it lives in (not a fixed 180 that leaves gaps or overflows). One
   observer for the whole list — never one per card.

   Uses a CALLBACK ref, not useRef + useEffect([]): the grid only exists once a
   folder is opened, so an effect with [] deps that ran at panel mount would
   find ref.current === null and never attach. A callback ref fires the moment
   the node appears (and disappears), which is exactly when the observer must
   attach/detach. */
function useCardsWidth() {
  const [w, setW] = useState(0);
  const roRef = useRef(null);
  const elRef = useRef(null);
  const detach = useCallback(() => {
    if (roRef.current) { roRef.current.disconnect(); roRef.current = null; }
    elRef.current = null;
  }, []);
  const ref = useCallback((el) => {
    detach();
    elRef.current = el;
    if (!el) return;
    const measure = () => setW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    roRef.current = ro;
  }, [detach]);
  useEffect(() => detach, [detach]);
  /* The node ref is returned too: `ref` is a callback, so `ref.current` is
     undefined — callers that need to query INSIDE the measured element (the
     card boards) need the node itself, not just its width. */
  return [ref, w, elRef];
}
/* Puzzle-card style preview for a single course file (mini board + move nav +
   chips), matching the Puzzle Library listing look. Memoized with stable
   props so a context change elsewhere (chat, quiz modal, moves) bails out
   here instead of re-rendering every mounted board. `onSelect` is a single
   stable callback that takes the id — never an inline arrow per card, which
   would defeat the memo on every parent render. */
const CourseItemCard = memo(function CourseItemCard({ item, active, boardWidth, onSelect, onLoad, onAsk }) {
  const [index, setIndex] = useState(0);
  const view = useMemo(() => buildReplay(item, index), [item, index]);
  const moves = view?.moves || [];
  const fen = view?.game?.fen();
  const navBtn =
    'h-6 min-w-6 grid place-items-center rounded-md border border-ivory-700/50 bg-black/[0.04] text-[0.7rem] ' +
    'hover:bg-black/5 disabled:opacity-30 disabled:cursor-not-allowed transition';
  const fire = (fn) => (e) => {
    e.stopPropagation();
    fn();
  };

  /* The puzzle this card would quiz: the position shown on the mini board plus
     the remaining solution moves (UCI), so "Ask quiz" starts a drill straight
     from this course file. */
  const quizPuzzle = useMemo(() => {
    if (!view?.game) return null;
    const remaining = (view.moves || []).slice(index);
    return {
      title: item.title,
      fen: view.game.fen(),
      solution: remaining.map((m) => m.from + m.to + (m.promotion || '')),
    };
  }, [view, index, item.title]);

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={() => onSelect(item.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(item.id);
        }
      }}
      className={`rounded-xl border p-2 flex flex-col gap-1.5 cursor-pointer transition select-none ${
        active
          ? 'border-gold-400/70 bg-gold-500/10 shadow-[0_0_16px_rgba(59,130,246,0.14)]'
          : 'border-ivory-700/50 bg-black/[0.03] hover:border-sky-400/40 hover:bg-black/[0.05]'
      }`}
      title={`Open ${item.title}`}
    >
      <h3 className="text-[0.68rem] font-semibold text-ivory-300 px-0.5 truncate" title={item.title}>
        {active && <span className="mr-0.5 text-gold-500">✓</span>}
        {item.title}
      </h3>

      <div className="live-course-mini-board" style={{ maxWidth: boardWidth }}>
        <ChessBoard
          game={view?.game}
          interactive={false}
          showLegalMoves={false}
          orientation="white"
          boardWidth={boardWidth}
          frameless
        />
      </div>

      {/* Per-card nav. Deliberately NOT bound to ← / →, while the viewer's
          identical nav below is: this component is rendered once per item in
          the list, so a global listener here would fire on every mounted card
          and step whichever one happened to register first. Arrow keys are a
          single-target shortcut and belong on the viewer only. */}
      <div className="flex items-center justify-center gap-1 select-none" onClick={(e) => e.stopPropagation()}>
        <button type="button" title="First" className={navBtn} disabled={index === 0} onClick={fire(() => setIndex(0))}>⏮️</button>
        <button type="button" title="Previous" className={navBtn} disabled={index === 0} onClick={fire(() => setIndex((i) => Math.max(0, i - 1)))}>◀️</button>
        <span className="min-w-[2.6rem] text-center text-[0.62rem] text-ivory-500 font-mono">
          {moves.length ? `${index}/${moves.length}` : '—'}
        </span>
        <button type="button" title="Next" className={navBtn} disabled={index >= moves.length} onClick={fire(() => setIndex((i) => Math.min(moves.length, i + 1)))}>▶️</button>
        <button type="button" title="Last" className={navBtn} disabled={index >= moves.length} onClick={fire(() => setIndex(moves.length))}>⏭️</button>
      </div>

      <div className="flex items-center gap-1 px-0.5">
        <span className="rounded-md border border-gold-500/40 bg-gold-700/15 px-1.5 py-0.5 text-[0.58rem] font-semibold uppercase tracking-wide text-gold-400">
          {item.type === 'pgn' ? 'PGN' : 'FEN'}
        </span>
        <span className="rounded-md border border-ivory-700/50 bg-black/[0.04] px-1.5 py-0.5 text-[0.58rem] text-ivory-400">
          {moves.length ? `${moves.length} move${moves.length === 1 ? '' : 's'}` : 'Position'}
        </span>
      </div>

      {(onLoad || onAsk) && fen && (
        <div className="flex items-center gap-1.5 px-0.5" onClick={(e) => e.stopPropagation()}>
          <Button variant="primary" size="sm" className="flex-1"
            type="button"
            onClick={() => onLoad?.(fen)}
            title="Load this puzzle onto the main classroom board"
          >
            ⤓ Load
          </Button>
          <Button variant="secondary" size="sm" className="flex-1"
            type="button"
            onClick={() => onAsk?.(quizPuzzle)}
            title="Ask this puzzle as a quiz to the class"
          >
            🎯 Ask quiz
          </Button>
        </div>
      )}
    </article>
  );
});

export default function CourseFilesPanel({ asMobilePanel = false, onBackToChat, hideHeader = false }) {
  const { classMeta, permissions, openQuizAsk } = useLiveClass();
  /* The shared library is fetched, not read from storage any more, so this
     panel needs its own loading tick before the folder list exists. */
  const [folders, setFolders] = useState([]);
  const [libraryLoading, setLibraryLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchLibraryOnce().then((data) => {
      if (cancelled) return;
      setFolders(data?.folders || []);
      setLibraryLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const [openFolderId, setOpenFolderId] = useUrlView('folder');
  const [selectedItemId, setSelectedItemId] = useState(null);
  const [moveIndex, setMoveIndex] = useState(0);
  const [visibleCount, setVisibleCount] = useState(CARD_PAGE);
  const [toast, setToast] = useState('');
  /* Library search. Filters across every folder, not just the open one. */
  const [search, setSearch] = useState('');
  const toastTimerRef = useRef(null);

  useEffect(() => () => clearTimeout(toastTimerRef.current), []);

  /* A new folder starts paginated again — never stranded on "showing 48 of 6". */
  useEffect(() => {
    setVisibleCount(CARD_PAGE);
  }, [openFolderId]);

  /* Stable across every context re-render, so the memoized cards keep bailing out. */
  const selectItem = useCallback((id) => setSelectedItemId(id), []);

  /* Marks the end of the mounted cards; the observer effect that uses it lives
     just below `items`, because `items` is derived from `openFolder` further down
     and referencing it above its declaration is a temporal-dead-zone crash. */
  const moreRef = useRef(null);

  const flash = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(''), 2600);
  }, []);

  /* Load this puzzle's current position onto the shared main board. */
  const loadFen = useCallback((fen) => {
    emit('chess_control', { classId: classMeta.id, action: 'load_fen', payload: { fen } }, (res) => {
      if (res?.ok === false) flash(res.error || 'Could not load position');
      else flash('Loaded to the main board');
    });
  }, [classMeta.id, flash]);

  const openFolder = folders.find((f) => f.id === openFolderId) || null;
  const path = folderPath(folders, openFolderId);
  const visibleFolders = folders.filter((f) => String(f.parentId) === String(openFolderId));
  const items = openFolder?.items || [];
  const selectedItem = items.find((i) => i.id === selectedItemId) || null;

  /* ── The list grows as you reach the end, not when you click ──────────────
   * `moreRef` marks the end of the mounted cards. When it scrolls into view the
   * next batch is appended, and because it stays at the end of the list it
   * scrolls into view again on the next scroll - so a 50-puzzle folder unfolds
   * under the reader's thumb with zero clicks, and a folder is still never more
   * than one batch ahead of where they actually are.
   *
   * Why an observer and not a scroll listener: IntersectionObserver fires only
   * on crossing, on the compositor thread, so it costs nothing while idle and
   * needs no throttling. A `scroll` handler here would run on every frame of
   * every scroll in the classroom panel.
   *
   * Reconnects whenever the batch count changes because the guard is the node's
   * presence, and the node is only rendered while there IS another batch. */
  const hasMore = visibleCount < items.length;
  useEffect(() => {
    const node = moreRef.current;
    /* No sentinel when everything is mounted, and no observer in environments
     * without IntersectionObserver - the list simply stops at the last batch
     * rather than crashing. */
    if (!node || !hasMore || typeof IntersectionObserver === 'undefined') return undefined;
    const total = items.length;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisibleCount((n) => (n < total ? n + CARD_PAGE : n));
        }
      },
      /* rootMargin pre-loads well before the sentinel is reached, so the next
       * batch is normally already mounted by the time the reader arrives and
       * never sees the list stop. `root: null` is right here: the list scrolls
       * with the page in the mobile sheet and inside its own container on the
       * desktop rail, and a viewport-relative root serves both. */
      { root: null, rootMargin: '600px 0px', threshold: 0 }
    );
    io.observe(node);
    return () => io.disconnect();
  }, [hasMore, items.length]);

  /* Search over FOLDERS only — an admin is locating a folder mid-lesson, so
     individual puzzles are deliberately not listed. It still spans the WHOLE
     library, not just the folder on screen: you usually know a folder's name,
     not where it was filed. Case-insensitive. */
  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    return folders
      .filter((f) => String(f.name || '').toLowerCase().includes(q))
      .map((folder) => ({ folder }));
  }, [search, folders]);

  useEffect(() => {
    setSelectedItemId((prev) => (items.some((i) => i.id === prev) ? prev : items[0]?.id ?? null));
  }, [items]);

  useEffect(() => {
    if (openFolderId && !openFolder) { setOpenFolderId(null, { replace: true }); }
  }, [openFolderId, openFolder]);

  useEffect(() => {
    setMoveIndex(0);
  }, [selectedItemId]);

  const view = useMemo(() => buildReplay(selectedItem, moveIndex), [selectedItem, moveIndex]);
  const moveRows = useMemo(() => (view?.moves ? pairRows(view.moves, view.startSide) : []), [view]);

  /* What the OPEN puzzle would quiz, built exactly as the cards build theirs:
     the position currently on the viewer board plus the moves still to come, in
     UCI. Stepping the viewer with ← / → therefore changes what "Ask quiz" asks
     from - quiz from here, not from the start.
     The viewer had no actions of its own, so the only way to act on the puzzle
     you had actually opened was to find its small card again and use the
     buttons there. Identical buttons, same permission gate, same payload. */
  const viewerQuizPuzzle = useMemo(() => {
    if (!view?.game) return null;
    const remaining = (view.moves || []).slice(moveIndex);
    return {
      title: selectedItem?.title,
      fen: view.game.fen(),
      solution: remaining.map((m) => m.from + m.to + (m.promotion || '')),
    };
  }, [view, moveIndex, selectedItem?.title]);
  const canControl = Boolean(permissions?.canControlBoard);
  const viewerFen = view?.game?.fen();
  const [cardsRef, cardsWidth, cardsEl] = useCardsWidth();
  /* The card's own padding (p-2) is the only inset. The board is deliberately
     smaller than the card's content width — 65% of it (a 35% reduction) — so the
     puzzle reads as a compact thumbnail. The card wrapper is capped to the same
     value (see the card markup) so it shrinks with the board and leaves no gap,
     and the selected-puzzle viewer, which is measured from the card board,
     shrinks by the same 35%. */
  const cardContentWidth = cardsWidth > 0 ? Math.max(120, Math.min(460, cardsWidth - 16)) : 180;
  const miniWidth = Math.round(cardContentWidth * 0.65);

  /* The selected puzzle's board is sized from the REAL rendered card board
     rather than a recomputed width: the item cards and the detail card sit at
     different nesting depths, so no formula here reproduces the card's exact
     content width. Reading the first card board and mirroring it is what makes
     the two genuinely the same size instead of merely close.
     Measured after layout (rAF) as well as synchronously, and re-measured
     whenever the list changes, so it is never left at 0. */
  const [cardBoardWidth, setCardBoardWidth] = useState(0);
  useEffect(() => {
    const grid = cardsEl.current;
    if (!grid) return undefined;
    let raf = 0;
    const measure = () => {
      const board = grid.querySelector('.live-course-mini-board > div');
      const w = board ? board.clientWidth : 0;
      setCardBoardWidth((prev) => (Math.abs(prev - w) >= 1 ? w : prev));
    };
    const schedule = () => {
      measure();
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    schedule();
    const ro = new ResizeObserver(schedule);
    ro.observe(grid);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [cardsEl, openFolderId, visibleCount, folders]);
  /* The selected puzzle's board is deliberately 30% smaller than the item
     cards' boards. Only the board's own size changes (the same value feeds both
     the square wrapper's max-width and the board's width/height prop), so there
     is no transform and no leftover box — the layout simply reflows to it. */
  const detailBoardWidth = Math.round((cardBoardWidth > 0 ? cardBoardWidth : miniWidth) * 0.7);

  /* ← / → move navigation.

     These are the exact functions the Previous/Next buttons call, lifted out so
     both paths share one implementation - a click and an arrow key cannot drift
     apart. They are functional updates, so a held arrow advances one ply per
     repeat, and the Math.max/Math.min clamps mean the boundaries do nothing
     rather than wrapping or going negative. */
  const stepBack = useCallback(() => {
    setMoveIndex((m) => Math.max(0, m - 1));
  }, []);
  const stepForward = useCallback(() => {
    setMoveIndex((m) => Math.min(view?.moves?.length ?? 0, m + 1));
  }, [view?.moves?.length]);

  useArrowKeys(stepBack, stepForward);

  const jumpButtons = [
    { label: '⏮️', title: 'First', fn: () => setMoveIndex(0), disabled: !view?.moves.length },
    { label: '◀️', title: 'Previous', fn: stepBack, disabled: moveIndex === 0 || !view?.moves.length },
    { label: '▶️', title: 'Next', fn: stepForward, disabled: !view?.moves.length || moveIndex >= (view?.moves.length ?? 0) },
    { label: '⏭️', title: 'Last', fn: () => setMoveIndex(view?.moves.length ?? 0), disabled: !view?.moves.length || moveIndex >= (view?.moves.length ?? 0) },
  ];

  return (
    <div className={`live-chat-panel live-course-panel${asMobilePanel ? ' live-chat-mobile-panel' : ''}`}>
      {!hideHeader && (
        <div className="live-chat-head">
          <span className="live-chat-title">📚 Course files</span>
          <div className="live-chat-modes">
            <button type="button" className="live-chip" onClick={onBackToChat} title="Back to live chat">
              💬 Chat
            </button>
          </div>
        </div>
      )}

      <div className="live-course-files-scroll">
        {/* Search. Present in both the panel header and the rail (which hides
            its own header), so it always sits directly above the results. */}
        <div className="live-course-search">
          <span className="live-course-search-icon" aria-hidden="true">🔍</span>
          <input
            type="search"
            className="live-course-search-input"
            placeholder="Search folders…"
            aria-label="Search course folders"
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

        {/* Search results replace the normal list while a query is active, and
            live under the folder on screen so results are visible immediately. */}
        {searchResults && (
          searchResults.length === 0 ? (
            <p className="live-chat-empty">
              No folders match &quot;{search.trim()}&quot;.
            </p>
          ) : (
            <div className="live-course-results" aria-label="Folder search results">
              <p className="live-course-results-count">
                {searchResults.length} folder{searchResults.length === 1 ? '' : 's'} found
              </p>
              {searchResults.slice(0, 40).map((r) => (
                <button
                  key={r.folder.id}
                  type="button"
                  className="live-course-row"
                  onClick={() => { setOpenFolderId(String(r.folder.id)); setSearch(''); }}
                  title={`Open ${r.folder.name}`}
                >
                  <Folder className="h-4 w-4 shrink-0 text-gold-400" fill="currentColor" strokeWidth={0.6} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ivory-300">{r.folder.name}</span>
                    <span className="block text-[0.65rem] text-ivory-500">
                      {countFolderFiles(folders, r.folder)} game{countFolderFiles(folders, r.folder) === 1 ? '' : 's'}
                    </span>
                  </span>
                </button>
              ))}
              {searchResults.length > 40 && (
                <p className="live-course-results-count">
                  Showing the first 40 — refine your search to narrow it down.
                </p>
              )}
            </div>
          )
        )}

        {libraryLoading && (
          <div className="live-course-skeleton" aria-busy="true" aria-label="Loading course files">
            <span className="live-course-skeleton-row" />
            <span className="live-course-skeleton-row" />
            <span className="live-course-skeleton-row" />
          </div>
        )}
        {!libraryLoading && folders.length === 0 && (
          <p className="live-chat-empty">No folders in the shared library yet — create them in the Chess Library page.</p>
        )}
        {/* The breadcrumb and the normal folder/item list step aside while a
          search is active — the results block above already occupies the body,
          so showing both would duplicate every row. */}
        <div hidden={!!searchResults}>
        {/* breadcrumb */}
        <nav className="live-course-panel-crumbs" aria-label="Breadcrumb">
        <button
          type="button"
          onClick={() => setOpenFolderId(null)}
          className={`live-course-crumb ${openFolder ? '' : 'live-course-crumb-on'}`}
        >
          <House className="h-3.5 w-3.5" />
          <span>{openFolder ? 'All' : 'All folders'}</span>
        </button>
        {path.map((f, i) => (
          <div key={f.id} className="flex items-center gap-0.5 min-w-0">
            <span className="live-course-crumb-sep">›</span>
            {i === path.length - 1 ? (
              <span className="live-course-crumb-on truncate">{f.name}</span>
            ) : (
              <button type="button" onClick={() => setOpenFolderId(f.id)} className="live-course-crumb truncate">
                {f.name}
              </button>
            )}
          </div>
        ))}
      </nav>

      {/* scroll body: folders / items */}
      <div className="live-chat-list">
        {!openFolder ? (
          folders.length === 0 ? (
            <p className="live-chat-empty">No folders in your library yet — create them in the Chess Library page.</p>
          ) : (
            visibleFolders.map((cf) => (
              <button
                key={cf.id}
                type="button"
                onClick={() => setOpenFolderId(cf.id)}
                className="live-course-row"
                title={`Open ${cf.name}`}
              >
                <Folder className="h-4 w-4 shrink-0 text-gold-400" fill="currentColor" strokeWidth={0.6} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ivory-300">{cf.name}</span>
                  <span className="block text-[0.65rem] text-ivory-500">
                    {countFolderFiles(folders, cf)} game{countFolderFiles(folders, cf) === 1 ? '' : 's'}
                  </span>
                </span>
              </button>
            ))
          )
        ) : visibleFolders.length === 0 && items.length === 0 ? (
          <p className="live-chat-empty">This folder is empty.</p>
        ) : (
          <div className="grid grid-cols-1 gap-2">
            {visibleFolders.map((cf) => (
              <button
                key={cf.id}
                type="button"
                onClick={() => setOpenFolderId(cf.id)}
                className="live-course-row"
                title={`Open ${cf.name}`}
              >
                <Folder className="h-4 w-4 shrink-0 text-gold-400" fill="currentColor" strokeWidth={0.6} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ivory-300">{cf.name}</span>
                  <span className="block text-[0.65rem] text-ivory-500">
                    {countFolderFiles(folders, cf)} game{countFolderFiles(folders, cf) === 1 ? '' : 's'}
                  </span>
                </span>
              </button>
            ))}
            {items.length > 0 && (
              <div ref={cardsRef} className="grid grid-cols-1 gap-2">
                {items.slice(0, visibleCount).map((it) => (
                  <CourseItemCard
                    key={it.id}
                    item={it}
                    active={selectedItemId === it.id}
                    boardWidth={miniWidth}
                    onSelect={selectItem}
                    onLoad={permissions.canControlBoard ? loadFen : null}
                    onAsk={permissions.canControlBoard ? openQuizAsk : null}
                  />
                ))}
                {hasMore && (
                  /* The sentinel. It carries the count for screen readers (so
                     the list still announces how much is left) but is not a
                     button: reaching the end grows the list on its own. Kept
                     at a real height so the observer has something to measure,
                     rather than a 0px node that could report intersecting
                     before the cards above it have laid out. */
                  <div
                    ref={moreRef}
                    className="flex items-center justify-center gap-2 py-3 text-[0.68rem] text-ivory-500"
                    aria-live="polite"
                  >
                    <span className="h-3 w-3 rounded-full border-2 border-ivory-600 border-t-transparent animate-spin" />
                    Loading more… ({items.length - visibleCount} left)
                  </div>
                )}
                {!hasMore && (
                  <p className="py-3 text-center text-[0.68rem] text-ivory-600">
                    All {items.length} puzzles loaded.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* board + playback */}
      {selectedItem && (
        <div className="live-course-board">
          <div className="live-course-board-head">
            <span className="truncate font-bold text-ivory-300 text-xs">{selectedItem.title}</span>
            <span className="live-course-chip">{selectedItem.type === 'pgn' ? 'PGN' : 'FEN'}</span>
          </div>

          {/* The selected puzzle gets the SAME card treatment as the items in the list
              above: identical `p-2` + border chrome, the same plain
              (frameless) board, and the same width rule — the board takes the
              card's content width. Because the wrapper and padding match the
              item cards exactly, the two boards land on the same size instead
              of the selected one looking bigger. */}
          <div className="rounded-xl border border-ivory-700/50 bg-black/[0.03] p-2">
            <div className="live-course-mini-board" style={{ maxWidth: detailBoardWidth }}>
              <ChessBoard
                game={view?.game}
                interactive={false}
                showLegalMoves={false}
                orientation="white"
                boardWidth={detailBoardWidth}
                lastMove={view?.lastMove}
                frameless
              />
            </div>
          </div>

          <div className="flex items-center justify-center gap-1.5 pb-2">
            {jumpButtons.map((b) => (
              <button
                key={b.title}
                type="button"
                onClick={b.fn}
                disabled={b.disabled}
                className="live-course-nav-btn"
                title={b.title}
              >
                {b.label}
              </button>
            ))}
            <span className="px-1 text-[0.7rem] font-semibold text-ivory-400 tabular-nums">
              {view?.moves?.length ? `${moveIndex} / ${view.moves.length}` : 'Position only'}
            </span>
          </div>

          {view?.moves.length > 0 && (
            <div className="px-3 pb-3 max-h-[26vh] overflow-y-auto live-course-scroll">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[0.6rem] uppercase tracking-widest text-ivory-500">
                    <th className="w-8 text-left pb-1">#</th>
                    <th className="text-left pb-1">White</th>
                    <th className="text-left pb-1">Black</th>
                  </tr>
                </thead>
                <tbody>
                  {moveRows.map((row) => {
                    const whiteActive = moveIndex - 1 === row.whiteIdx;
                    const blackActive = row.black && moveIndex - 1 === row.blackIdx;
                    return (
                      <tr key={`${row.number}-${row.whiteIdx}`} className="border-t border-ivory-700/40">
                        <td className="py-0.5 text-ivory-500 font-mono">{row.white ? `${row.number}.` : `${row.number}...`}</td>
                        <td className="py-0.5">
                          {row.white ? (
                            <button
                              type="button"
                              onClick={() => setMoveIndex(row.whiteIdx + 1)}
                              className={`font-mono px-1.5 py-0.5 rounded-md transition ${
                                whiteActive ? 'bg-gold-500/20 text-gold-500' : 'text-ivory-300 hover:bg-black/[0.05]'
                              }`}
                            >
                              {row.white.san}
                            </button>
                          ) : (
                            <span className="font-mono px-1.5 py-0.5 text-ivory-800 select-none">—</span>
                          )}
                        </td>
                        <td className="py-0.5">
                          {row.black && (
                            <button
                              type="button"
                              onClick={() => setMoveIndex(row.blackIdx + 1)}
                              className={`font-mono px-1.5 py-0.5 rounded-md transition ${
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
          )}

          {/* Same two actions the cards carry, on the puzzle you actually have
              open. Hidden for the same reason the cards hide them: only a coach
              who controls the board can load a position or start a drill. */}
          {canControl && viewerFen && (
            <div className="flex items-center gap-1.5 border-t border-ivory-700/40 px-3 py-3">
              <Button variant="primary" size="sm" className="flex-1"
                type="button"
                onClick={() => loadFen(viewerFen)}
                title="Load this position onto the main classroom board"
              >
                ⤓ Load
              </Button>
              <Button variant="secondary" size="sm" className="flex-1"
                type="button"
                onClick={() => openQuizAsk?.(viewerQuizPuzzle)}
                title="Ask this puzzle as a quiz to the class"
              >
                🎯 Ask quiz
              </Button>
            </div>
          )}
</div>
          )}
        </div>
        </div>
      {toast && <div className="live-course-toast">{toast}</div>}
      </div>
  );
}