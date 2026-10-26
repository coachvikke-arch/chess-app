/* Re-analyze the games whose Brilliant rows were filed by the OLD classifier.
 *
 * WHY THIS EXISTS
 * ---------------
 * The Brilliant Moves list is built by scripts/backfill_sigma_moves.js, which
 * reads the STORED verdicts in imported_game_analysis.data.verdicts and trusts
 * the verdict string it finds there. Those verdicts were produced by the browser
 * before the classifier gained gates G (free-positive filter) and H (the
 * sacrifice must achieve something), so re-running the backfill alone would
 * faithfully re-file the same wrong rows forever.
 *
 * The verdicts have to be REGENERATED. This script re-runs the same review the
 * browser runs — reviewGame() from frontend/src/utils/gameReview.js, driven by
 * the same bundled NNUE engine — and rewrites the stored verdicts, then the
 * backfill rebuilds sigma_moves from them.
 *
 * The payload shape is a deliberate copy of the production writer,
 * frontend/src/pages/ChessProfile.jsx (the res.moves mapping in its review
 * completion handler). Every field the board overlay and the analysis board read
 * — uci, bestUci, lines, cpl, loss, acc, and player in 'white'/'black' form — is
 * carried through, because dropping any of them silently strips the board
 * annotation. If ChessProfile's mapping changes, change it here too.
 *
 * USAGE
 *   node reanalyze_sigma.js                 dry run: report only, writes nothing
 *   node reanalyze_sigma.js --write         rewrite the stored verdicts
 *   node reanalyze_sigma.js --all           dry run over EVERY stored analysis
 *   node reanalyze_sigma.js --all --write   rewrite them all
 *
 *   --all is the one to reach for after the CLASSIFIER changes. Verdicts already in
 *   the store were produced by whatever rules were live when they were written, so
 *   a gate fix leaves them stale exactly as it leaves sigma_moves stale. Without
 *   --all the tool only revisits games that still carry a filed row, which finds
 *   nothing at all once the list has been cleared.
 */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const db = require('./src/config/database').pool;
const {
  analyseGame, movesFromPgn, loadReviewModules, getEngine, shutdownEngine,
} = require('./src/services/analysis/analysisRunner');
const { loadGame } = require('./src/services/analysis/gameLoader');
const { runBackfill } = (() => {
  try { return require('./backfill_sigma_moves.js'); } catch { return {}; }
})();

const WRITE = process.argv.includes('--write');
const ALL = process.argv.includes('--all');
const isSigmaVerdict = (v) => v === 'sigma' || v === 'brilliant';

/* The stored verdict shape — see ChessProfile.jsx. */
function toStoredVerdicts(moves) {
  return moves.map((m, i) => ({
    index: i,
    san: m.san,
    verdict: m.verdict,
    uci: m.uci || null,
    bestUci: m.bestUci || null,
    lines: Array.isArray(m.lines) ? m.lines : [],
    player: m.player === 'w' ? 'white' : 'black',
    cpl: m.cpl,
    loss: m.loss,
    acc: m.acc,
  }));
}

(async () => {
  const { gameReview } = await loadReviewModules();
  const engine = await getEngine();

  const { rows: games } = ALL
    ? await db.query(
      `SELECT DISTINCT game_id, 'chess_profile'::text AS game_source
         FROM imported_game_analysis ORDER BY game_id`,
    )
    : await db.query(
      `SELECT DISTINCT game_id, game_source FROM sigma_moves ORDER BY game_id`,
    );
  console.log(`${WRITE ? 'WRITING' : 'DRY RUN'} - ${games.length} games`
    + `${ALL ? ' (every stored analysis)' : ' carrying a filed row'}\n`);

  let changed = 0;

  for (const g of games) {
    process.stdout.write(`game ${g.game_id} (${g.game_source}) ... `);

    const loaded = await loadGame(g.game_source, g.game_id);
    if (!loaded.ok) { console.log(`LOAD FAILED: ${loaded.reason}`); continue; }

    let res;
    try {
      const parsed = await movesFromPgn(loaded.game.pgn, loaded.game.initialFen);
      res = await gameReview.reviewGame(parsed.initialFen, parsed.moves, { engine });
    } catch (err) {
      console.log(`REVIEW FAILED: ${err.message}`);
      continue;
    }
    if (!res || !Array.isArray(res.moves) || !res.moves.length) {
      console.log('NO VERDICTS'); continue;
    }

    const verdicts = toStoredVerdicts(res.moves);
    const counts = { white: res.white?.counts || null, black: res.black?.counts || null };
    const accuracy = { white: res.white?.accuracy ?? null, black: res.black?.accuracy ?? null };

    /* What is stored right now, for an honest before/after. */
    const { rows: stored } = await db.query(
      `SELECT (data->'verdicts') AS verdicts FROM imported_game_analysis
        WHERE game_id = $1 LIMIT 1`,
      [g.game_id],
    );
    const oldVerdicts = stored.length && Array.isArray(stored[0].verdicts) ? stored[0].verdicts : [];
    const oldBright = oldVerdicts.filter((v) => v && isSigmaVerdict(v.verdict));
    const newBright = verdicts.filter((v) => isSigmaVerdict(v.verdict));

    console.log(`stored ${oldVerdicts.length} plies -> now ${verdicts.length} plies`);
    console.log(`  brilliant before: ${oldBright.map((v) => `${v.san}@${v.index}`).join(', ') || '(none)'}`);
    console.log(`  brilliant after : ${newBright.map((v) => `${v.san}@${v.index}`).join(', ') || '(none)'}`);

    /* Report any move whose verdict actually moved, not just the brilliant ones. */
    const moved = [];
    for (const nv of verdicts) {
      const ov = oldVerdicts[nv.index];
      if (ov && ov.verdict !== nv.verdict) moved.push(`${nv.san}@${nv.index}: ${ov.verdict} -> ${nv.verdict}`);
    }
    if (moved.length) console.log(`  changed: ${moved.join(' | ')}`);

    if (WRITE) {
      /* Replace only the three derived keys; anything else in the document (and the
         row itself) is left alone. */
      await db.query(
        `UPDATE imported_game_analysis
            SET data = data || jsonb_build_object('verdicts', $2::jsonb,
                                                 'counts',  $3::jsonb,
                                                 'accuracy',$4::jsonb),
                created_at = NOW()
          WHERE game_id = $1`,
        [g.game_id, JSON.stringify(verdicts), JSON.stringify(counts), JSON.stringify(accuracy)],
      );
      changed += 1;
    }
    console.log();
  }

  if (WRITE) {
    console.log(`rewrote ${changed} stored analyses\n`);
    if (typeof runBackfill === 'function') {
      await runBackfill();
    } else {
      console.log('(backfill is a standalone script - run: npm run backfill:sigma)');
    }
  }

  await shutdownEngine().catch(() => {});
  await db.end();
})().catch(async (e) => { console.error(e); process.exit(1); });