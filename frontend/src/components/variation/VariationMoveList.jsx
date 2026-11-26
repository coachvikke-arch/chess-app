import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { ROOT_ID } from '../../utils/variationTree';
import { reviewMetaFor } from '../../utils/gameReview';
import { RankBadge } from '../RankBadges';
import './variation.css';

/* ──────────────────────────────────────────────────────────────────────────
 * ONE move list for the whole app's analysis boards.
 *
 * The original game is drawn as the ordinary numbered grid, exactly as before.
 * Any move the user tried that is not the game's move lives in a collapsible,
 * coloured block under the move it was branched from — and because it is a
 * block, not a replacement, the game line can never be lost or overwritten.
 *
 * The list is a pure view of useVariationTree(): every click is a pointer move,
 * so nothing here can delete a move except the explicit Delete button (which
 * asks first) and Reset (which asks first).
 * ────────────────────────────────────────────────────────────────────────── */

/* The absolute ply number of the tree root, so the grid keeps the real move
 * numbers for a game that starts from a custom FEN (e.g. a set-up position). */
function startPlyOf(rootFen) {
  const parts = String(rootFen || '').split(' ');
  const turn = parts[1] === 'b' ? 1 : 0;
  const full = Number(parts[5]) || 1;
  return (full - 1) * 2 + turn;
}

const DEPTH_COLORS = ['#2563eb', '#7c3aed', '#0891b2', '#db2777', '#059669', '#d97706'];
const depthColor = (depth) => DEPTH_COLORS[(depth - 1) % DEPTH_COLORS.length];

/* A variation block shows its continuation as one line: the node itself and
 * then each first child. Other children of those nodes are nested variations. */
function chainOf(nodes, startId) {
  const out = [];
  let cur = nodes[startId];
  while (cur) {
    out.push(cur);
    cur = cur.children.length ? nodes[cur.children[0]] : null;
  }
  return out;
}

function VariationBlock({
  startId, depth, tree, readOnly, collapsedSet, onToggleCollapse, onGo, startPly, rowOf, showSigma,
}) {
  const nodes = tree.nodes;
  const head = nodes[startId];
  if (!head) return null;
  const collapsed = collapsedSet.has(startId);
  const chain = chainOf(nodes, startId);
  const promoted = tree.promotedId === startId;
  const rowFor = (n) => n.row || (rowOf ? rowOf(n) : null);
  /* Only the ROOT of a variation owns the actions; a nested block gets its own
   * because it is its own deletable branch. */
  const label = `Variation ${chain.length > 1 ? `· ${chain.length} moves` : ''}`.trim();

  const onDelete = () => {
    if (!window.confirm('Delete this variation and every move after it? The original game line is not touched.')) return;
    tree.deleteVariation(startId);
  };

  return (
    <div
      className={`var-block${promoted ? ' is-promoted' : ''}`}
      style={{ '--var-depth': depth, '--var-accent': depthColor(depth) }}
      data-variation={startId}
    >
      <div className="var-block-bar">
        <button
          type="button"
          className="var-block-toggle"
          aria-expanded={!collapsed}
          onClick={() => onToggleCollapse(startId)}
          title={collapsed ? 'Show this variation' : 'Hide this variation'}
        >{collapsed ? '▸' : '▾'}</button>
        <span className="var-block-label">{label || 'Variation'}</span>
        {!readOnly && (
          <span className="var-block-actions">
            <button
              type="button"
              className="var-block-act"
              onClick={() => tree.promoteVariation(startId)}
              title={promoted
                ? 'Stop showing this line as the main view — the original game returns'
                : 'Show this line as the main view (display only — the original game is kept)'}
              aria-pressed={promoted}
            >{promoted ? 'Show original' : 'Promote'}</button>
            <button
              type="button"
              className="var-block-act var-block-del"
              onClick={onDelete}
              title="Delete this variation"
            >✕</button>
          </span>
        )}
      </div>
      {!collapsed && (
        <div className="var-line">
          {chain.map((n) => {
            const abs = startPly + n.ply;
            const row = rowFor(n);
            const meta = row ? reviewMetaFor(row.verdict) : null;
            const active = n.id === tree.pointer;
            return (
              <button
                key={n.id}
                type="button"
                className={`var-mv${active ? ' is-active' : ''}`}
                data-var-active={active ? 'true' : undefined}
                onClick={() => onGo(n.id)}
                title={meta ? meta.label : (n.isMainline ? 'Original game move' : 'Variation move')}
              >
                {abs % 2 === 1 && <span className="var-mv-num">{Math.ceil(abs / 2)}.</span>}
                {meta && <RankBadge verdict={row.verdict} size={16} showLabel={false} className="var-mv-badge" />}
                {n.san}
                {showSigma && row && row.sigma && (
                  <span className="var-mv-sigma" aria-label={row.sigma.label}>σ</span>
                )}
              </button>
            );
          })}
          {/* Deeper branches sit INSIDE the line that created them. The first
              child is the line's own continuation (already a button above), so
              only the side children become nested blocks — otherwise every
              later move of the chain would also render as its own block. */}
          {chain.map((n) => n.children
            .map((cid) => nodes[cid])
            .filter((c) => c && !c.isMainline && c.id !== n.children[0])
            .map((c) => (
              <VariationBlock
                key={`${n.id}:${c.id}`}
                startId={c.id}
                depth={depth + 1}
                tree={tree}
                readOnly={readOnly}
                collapsedSet={collapsedSet}
                onToggleCollapse={onToggleCollapse}
                onGo={onGo}
                startPly={startPly}
                rowOf={rowOf}
                showSigma={showSigma}
              />
            )))}
        </div>
      )}
    </div>
  );
}

export default function VariationMoveList({
  tree,
  title = 'Moves',
  whiteName = 'White',
  blackName = 'Black',
  readOnly = false,
  canReset = true,
  className = '',
  emptyText = 'No moves — open a game to review it.',
  headless = false,
  rowOf = null,
  scrollHost = null,
  /* Surfaces whose tree is owned elsewhere (the live classroom's shared tree)
     supply the reset themselves — the confirm belongs to whatever actually
     deletes the branches, and Reset stays reachable even in a read-only list. */
  onReset = null,
  /* The classroom has ONE room-wide undo and no display-only promote, so its
     list keeps per-branch actions hidden even for the coach. */
  branchActions = true,
  /* Game Review marks a Brilliant that also names its type (Queen Sacrifice…)
     with a small σ beside the move; the other surfaces do not carry sigmas. */
  showSigma = false,
}) {
  const scrollRef = useRef(null);
  const [collapsedSet, setCollapsedSet] = useState(() => new Set());
  const rowFor = (n) => (n ? n.row || (rowOf ? rowOf(n) : null) : null);

  const startPly = useMemo(() => startPlyOf(tree.root?.fen), [tree.root?.fen]);
  const displayIds = tree.displayIds;
  const displaySet = useMemo(() => new Set(displayIds), [displayIds]);
  const rootBranches = useMemo(() => (tree.root?.children || [])
    .map((id) => tree.nodes[id])
    .filter((n) => n && !n.isMainline && !displaySet.has(n.id)),
  [tree.root, tree.nodes, displaySet]);

  /* The grid: the original game line normally, the promoted path after
   * "Promote". Cells carry the real move number, so a game that starts from a
   * set-up FEN still reads correctly. */
  const rows = useMemo(() => {
    const out = [];
    displayIds.forEach((id) => {
      if (id === ROOT_ID) return;
      const n = tree.nodes[id];
      if (!n) return;
      const abs = startPly + n.ply;
      /* `abs` counts the plies played to REACH this node, so White's first move
         is ply 1 (odd) and Black's first reply is ply 2 (even). */
      const side = abs % 2 === 1 ? 'white' : 'black';
      const num = Math.ceil(abs / 2);
      const last = out[out.length - 1];
      if (side === 'white' || !last || last.num !== num || last.black) {
        out.push({ num, white: side === 'white' ? n : null, black: side === 'black' ? n : null });
      } else {
        last.black = n;
      }
    });
    return out;
  }, [displayIds, tree.nodes, startPly]);

  const toggleCollapse = (id) => {
    setCollapsedSet((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  /* Follow the active move inside whichever box actually scrolls: the list
     itself by default, or an explicit host panel (`scrollHost`) such as the
     viewer's score sheet. The ancestor walk never goes past that host — on a
     phone the next scrollable ancestor is the whole viewer body, and scrolling
     it would push the board off the top of the screen just to show a move the
     list already shows. scrollIntoView would walk every ancestor and could
     nudge the whole page, so the offset is applied by hand. */
  useEffect(() => {
    const list = scrollRef.current;
    if (!list) return;
    const el = list.querySelector('[data-var-active="true"]');
    if (!el) return;
    let host = scrollHost ? list.closest(scrollHost) : list;
    if (!scrollHost) {
      while (host && host !== document.body) {
        const oy = window.getComputedStyle(host).overflowY;
        if ((oy === 'auto' || oy === 'scroll') && host.scrollHeight > host.clientHeight + 1) break;
        host = host.parentElement;
      }
    }
    if (!host || host === document.body) return;
    if (host.scrollHeight <= host.clientHeight + 1) return;
    const lr = host.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    if (er.top < lr.top + 4) host.scrollTop -= (lr.top + 4 - er.top);
    else if (er.bottom > lr.bottom - 4) host.scrollTop += (er.bottom - lr.bottom + 4);
  }, [tree.pointer, scrollHost]);

  const reset = onReset || (() => {
    if (!window.confirm('Reset to the original game line? This removes every variation and any promoted view.')) return;
    tree.resetVariations();
  });

  const onCell = (n) => {
    /* Clicking any move of the game returns to that game position, which is
     * also the way out of a variation without the Back button. */
    tree.goTo(n.id, 'score-sheet');
  };

  const variationCell = (n) => n && n.children
    .map((cid) => tree.nodes[cid])
    .filter((c) => c && c.id !== ROOT_ID && !displaySet.has(c.id) && !c.isMainline);

  const renderCell = (n) => {
    if (!n) return <span className="var-mvslot" />;
    const row = rowFor(n);
    const meta = row ? reviewMetaFor(row.verdict) : null;
    const active = n.id === tree.pointer;
    return (
      <button
        type="button"
        className={`var-mv${active ? ' is-active' : ''}${n.isMainline ? '' : ' is-promoted-move'}`}
        data-var-active={active ? 'true' : undefined}
        onClick={() => onCell(n)}
        title={meta
          ? meta.label
          : (n.isMainline ? 'Original game move' : 'Promoted variation move — display only')}
      >
        {meta && <RankBadge verdict={row.verdict} size={17} showLabel={false} className="var-mv-badge" />}
        {n.san}
        {showSigma && row && row.sigma && (
          <span className="var-mv-sigma" aria-label={row.sigma.label}>σ</span>
        )}
      </button>
    );
  };

  return (
    <div className={`var-moves-card${headless ? ' is-headless' : ''}${className ? ` ${className}` : ''}`}>
      {!headless && (
        <div className="var-moves-head">
          <span className="var-moves-title">
            ♘ {title}
            {tree.hasVariations && <span className="var-moves-count">{tree.variationCount}</span>}
          </span>
          <span className="var-moves-actions">
            {canReset && (onReset || !readOnly) && tree.hasVariations && (
              <button type="button" className="var-moves-reset" onClick={reset} title="Remove every variation and restore the original game">
                Reset to original
              </button>
            )}
          </span>
        </div>
      )}

      {!tree.isOnMainline && (
        <div className="var-notice">
          <span className="var-notice-text">
            <span className="var-notice-dot" aria-hidden="true" />
            Analysing a variation
          </span>
          <button type="button" className="var-back-btn" onClick={() => tree.returnToMainline()}>
            ← Back to Original Line
          </button>
        </div>
      )}

      {tree.promotedId && (
        <div className="var-notice var-notice--promoted">
          <span className="var-notice-text">Promoted view — the original line is still saved</span>
          <span className="var-notice-actions">
            {/* The promoted block is no longer in the grid, so its own toggle
                cannot be reached; this is the non-destructive way back. */}
            <button
              type="button"
              className="var-back-btn"
              onClick={() => tree.promoteVariation(tree.promotedId)}
            >Show original</button>
            {canReset && (onReset || !readOnly) && (
              <button type="button" className="var-back-btn" onClick={reset}>Reset to original</button>
            )}
          </span>
        </div>
      )}

      <div className="var-moves-scroll" ref={scrollRef}>
        {rows.length === 0 ? (
          <p className="var-moves-empty">{emptyText}</p>
        ) : (
          <>
            <div className="var-mvhead" role="row">
              <span>#</span>
              <span className="is-white" title={`White — ${whiteName}`}>{whiteName}</span>
              <span className="is-black" title={`Black — ${blackName}`}>{blackName}</span>
            </div>
            {/* A deviation from the STARTING position has no move row above it,
                so its block is anchored at the top of the list instead. */}
            {rootBranches.length > 0 && (
              <div className="var-branches">
                {rootBranches.map((b) => (
                  <VariationBlock
                    key={b.id}
                    startId={b.id}
                    depth={1}
                    tree={tree}
                    readOnly={readOnly || !branchActions}
                    collapsedSet={collapsedSet}
                    onToggleCollapse={toggleCollapse}
                    onGo={(id) => tree.goTo(id, 'score-sheet')}
                    startPly={startPly}
                    rowOf={rowOf}
                    showSigma={showSigma}
                  />
                ))}
              </div>
            )}
            {rows.map((row) => {
              const branches = [
                ...(variationCell(row.white) || []),
                ...(variationCell(row.black) || []),
              ];
              return (
                <Fragment key={`${row.num}-${row.white?.id || ''}`}>
                  <div className="var-mvpair" role="row">
                    <span className="var-mvnum">{row.num}.</span>
                    {renderCell(row.white)}
                    {renderCell(row.black)}
                  </div>
                  {branches.length > 0 && (
                    <div className="var-branches">
                      {branches.map((b) => (
                        <VariationBlock
                          key={b.id}
                          startId={b.id}
                          depth={1}
                          tree={tree}
                          readOnly={readOnly || !branchActions}
                          collapsedSet={collapsedSet}
                          onToggleCollapse={toggleCollapse}
                          onGo={(id) => tree.goTo(id, 'score-sheet')}
                          startPly={startPly}
                          rowOf={rowOf}
                          showSigma={showSigma}
                        />
                      ))}
                    </div>
                  )}
                </Fragment>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
