require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { pathToFileURL } = require('url');
const path = require('path');
const { Chess } = require('chess.js');

/* Paths resolved from __dirname, not '.', because this script lives in scripts/
   and is run from the repo root as `npm run backfill:sigma`. */
const BACKEND = path.join(__dirname, '..');
const db = require(path.join(BACKEND, 'src', 'config', 'database.js'));

/* The Sigma classifier is imported from the FRONTEND, not reimplemented here.
   Two copies of the sacrifice rules would drift, and the type shown on a
   backfilled card would quietly disagree with the type shown on a freshly
   reviewed one — the same move could be labelled differently depending on when
   it was analysed. The module is plain ESM with no browser dependencies, so
   Node can load it directly. */
const FRONTEND_SIGMA = path.join(BACKEND, '..', 'frontend', 'src', 'utils', 'sigmaType.js');

/**
 * Backfill Σ Sigma moves for games analysed BEFORE the screen existed.
 *
 * WHY THIS IS NEEDED
 * Sigmas are recorded when a review finishes and the game has a database row.
 * Every review done before that existed stored its verdicts in
 * imported_game_analysis but recorded no Sigma at all, so those games — including
 * ones with brilliant moves already correctly detected — would show an empty
 * screen forever. This reads the stored analysis and files the Sigmas it finds.
 *
 * WHAT IT CAN AND CANNOT RECOVER
 * The stored rows carry san, uci, index (the ply) and player, but NOT the
 * position. So the game's PGN is replayed to rebuild the FEN before each move,
 * and the type is then classified from real geometry rather than guessed from
 * the move number. A game whose PGN will not replay is SKIPPED, not guessed:
 * a card drawn from the wrong position is worse than a missing card.
 *
 * A review with no brilliant move contributes nothing — there is no row to
 * write, and nothing to clear.
 *
 * Safe to re-run: writes are an upsert on (game_source, game_id, ply), and a
 * game that no longer has any brilliant move has its rows deleted so a retracted
 * Sigma does not linger.
 */

(async () => {
  let classifySigmaFromPly;
  let isSigmaVerdict;
  try {
    ({ classifySigmaFromPly, isSigmaVerdict } = await import(pathToFileURL(FRONTEND_SIGMA).href));
  } catch (err) {
    console.error('BACKFILL FAILED: cannot load the Sigma classifier:', err.message);
    process.exit(1);
    return;
  }

  const DRY = process.argv.includes('--dry-run');
  let inserted = 0;
  let skipped = 0;
  let cleared = 0;
  let games = 0;

  try {
    const rows = await db.query(
      `SELECT a.id AS analysis_id, a.user_id, a.data,
              g.id AS game_id, g.pgn, g.game_date, g.end_time_ms,
              g.my_color, g.white_name, g.black_name,
              g.white_rating, g.black_rating
         FROM imported_game_analysis a
         JOIN chess_games g ON g.id = a.game_id
        ORDER BY a.id`
    );
    console.log(`stored analyses to scan: ${rows.rows.length}\n`);

    for (const row of rows.rows) {
      games += 1;
      const label = `game ${row.game_id} (user ${row.user_id})`;
      /* TWO stored shapes have to be read:
         - the CURRENT one: the canonical envelope, whose rows are the complete
           review under `data.analysis.moves` (each row carries `ply`);
         - the LEGACY one: `data.verdicts` (each row carries `index`).
         The backfill only understood the legacy shape, so it skipped EVERY
         stored analysis and could never file a missing Sigma - the tab stayed
         empty for a game whose review plainly had a brilliant move in it. */
      const canonical = row.data && row.data.analysis && Array.isArray(row.data.analysis.moves)
        ? row.data.analysis.moves
        : null;
      const legacy = row.data && Array.isArray(row.data.verdicts) ? row.data.verdicts : null;
      const verdicts = canonical || legacy;
      if (!verdicts) {
        console.log(`  skip  ${label}: no verdicts array`);
        skipped += 1;
        continue;
      }
      /* The ply is `ply` in the canonical rows and `index` in the legacy ones. */
      const plyOf = (v) => (v && Number.isInteger(Number(v.ply)) ? Number(v.ply) : Number(v && v.index));

      /* Where the game starts. A [FEN] tag wins; without one the game began in
         the normal opening position. */
      const fenTag = row.pgn ? (row.pgn.match(/\[FEN\s+"([^"]+)"/) || [])[1] : null;
      const start = fenTag && fenTag !== 'start' ? fenTag : null;

      /* The position BEFORE every ply, in ONE pass.
         The stored rows carry no FEN, so the only way to know what position a
         Sigma was played in is to replay the game. Doing that per Sigma would be
         O(moves²); walking once and recording each step is linear and gives an
         array indexed by ply. */
      let fens = null;
      try {
        const reader = new Chess();
        if (row.pgn) reader.loadPgn(row.pgn, { strict: false });
        const sans = reader.history();
        const walker = new Chess(start || undefined);
        fens = [walker.fen()];
        for (const san of sans) {
          if (!walker.move(san, { strict: false })) {
            /* The move list stops making sense at this point. Everything before
               it is still trustworthy, so keep what we have and carry on — the
               ply guard below rejects any Sigma past this point anyway. */
            break;
          }
          fens.push(walker.fen());
        }
      } catch {
        fens = null;
      }

      /* Either spelling of the Sigma verdict. Matching the one legacy id alone
         would skip every review stored under the canonical 'sigma' id — the rows
         exist, they are simply not found, and the game looks like it never had a
         brilliant move. isSigmaVerdict is the shared rule, not a second copy. */
      const brilliant = verdicts.filter((v) => v && isSigmaVerdict(v.verdict));
      if (!brilliant.length) {
        /* No brilliant move in this review. If Sigmas were ever filed for the
           game they are stale, so clear them — otherwise a retracted Sigma
           would sit on the screen for ever. */
        if (!DRY) {
          const del = await db.query(
            `DELETE FROM sigma_moves
              WHERE owner_user_id = $1 AND game_source = 'chess_profile' AND game_id = $2`,
            [row.user_id, row.game_id]
          );
          if (del.rowCount > 0) {
            cleared += del.rowCount;
            console.log(`  clear ${label}: ${del.rowCount} stale Sigma(s) removed`);
          }
        }
        continue;
      }

      if (!fens || fens.length < 2) {
        console.log(`  skip  ${label}: PGN will not replay, cannot rebuild the position`);
        skipped += 1;
        continue;
      }

      /* When the GAME was played — the date filters bucket by this, so using
         the analysis date would file a two-year-old game in today's window.
         `game_date` is a DATE column, which node-postgres hands back as a Date
         object at LOCAL midnight; the row's timezone offset would then shift it
         a day, so the calendar date is read off the object directly rather than
         round-tripped through an ISO string. */
      let playedAt = null;
      if (row.game_date instanceof Date && !Number.isNaN(row.game_date.getTime())) {
        const y = row.game_date.getFullYear();
        const m = String(row.game_date.getMonth() + 1).padStart(2, '0');
        const d = String(row.game_date.getDate()).padStart(2, '0');
        playedAt = `${y}-${m}-${d}T00:00:00.000Z`;
      } else if (typeof row.game_date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(row.game_date)) {
        playedAt = `${row.game_date.slice(0, 10)}T00:00:00.000Z`;
      } else if (row.end_time_ms) {
        const t = new Date(Number(row.end_time_ms));
        if (!Number.isNaN(t.getTime())) playedAt = t.toISOString();
      }

      const out = [];
      for (const v of brilliant) {
        const ply = plyOf(v);
        if (!Number.isInteger(ply) || ply < 0) {
          console.log(`  skip  ${label}: brilliant row has no usable ply (${v.ply ?? v.index})`);
          continue;
        }
        const fenBefore = fens[ply];
        if (!fenBefore) {
          console.log(`  skip  ${label} ply ${ply}: position past the end of the game`);
          continue;
        }
        /* Classify from real geometry. isSigma is true because the stored review
           already decided this is brilliant; this only names the kind. */
        const classified = classifySigmaFromPly({
          fenBefore,
          moveSan: v.san,
          isSigma: true,
        });
        if (!classified) {
          /* A genuine Sigma whose type cannot be determined. The column is NOT
             NULL with a CHECK, so storing a guess would mislabel the card
             permanently. It is left out, and reported so the gap is visible. */
          console.log(`  note  ${label} ply ${ply} (${v.san}): brilliant but type undetectable — not filed`);
          continue;
        }
        out.push({
          ply,
          sigmaType: classified.type,
          moveSan: v.san,
          fromSquare: classified.fromSquare,
          toSquare: classified.toSquare,
          fenBefore,
          playedAt,
          whiteName: row.white_name,
          blackName: row.black_name,
          whiteRating: row.white_rating,
          blackRating: row.black_rating,
        });
      }

      if (!out.length) {
        console.log(`  skip  ${label}: ${brilliant.length} brilliant move(s), none with a type`);
        skipped += 1;
        continue;
      }

      if (DRY) {
        console.log(`  would file ${out.length} Sigma(s) for ${label}: `
          + out.map((m) => `${m.sigmaType} ${m.moveSan}@${m.ply}`).join(', '));
        inserted += out.length;
        continue;
      }

      const client = await db.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `DELETE FROM sigma_moves
            WHERE owner_user_id = $1 AND game_source = 'chess_profile' AND game_id = $2`,
          [row.user_id, row.game_id]
        );
        for (const m of out) {
          await client.query(
            `INSERT INTO sigma_moves (
               owner_user_id, game_source, game_id, ply, sigma_type,
               move_san, from_square, to_square, fen_before, played_at,
               white_name, black_name, white_rating, black_rating
             ) VALUES ($1,'chess_profile',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
             ON CONFLICT (game_source, game_id, ply) DO UPDATE SET
               owner_user_id = EXCLUDED.owner_user_id,
               sigma_type    = EXCLUDED.sigma_type,
               move_san      = EXCLUDED.move_san,
               from_square   = EXCLUDED.from_square,
               to_square     = EXCLUDED.to_square,
               fen_before    = EXCLUDED.fen_before,
               played_at     = EXCLUDED.played_at,
               white_name    = EXCLUDED.white_name,
               black_name    = EXCLUDED.black_name,
               white_rating  = EXCLUDED.white_rating,
               black_rating  = EXCLUDED.black_rating,
               updated_at    = NOW()`,
            [row.user_id, row.game_id, m.ply, m.sigmaType, m.moveSan,
              m.fromSquare, m.toSquare, m.fenBefore, m.playedAt,
              m.whiteName, m.blackName, m.whiteRating, m.blackRating]
          );
        }
        await client.query('COMMIT');
        inserted += out.length;
        console.log(`  filed ${out.length} Sigma(s) for ${label}: `
          + out.map((m) => `${m.sigmaType} ${m.moveSan}@${m.ply}`).join(', '));
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    const verify = await db.query('SELECT COUNT(*)::int AS n FROM sigma_moves');
    console.log(`\n${DRY ? 'DRY RUN — nothing written' : 'BACKFILL DONE'}`);
    console.log(`  games scanned:  ${games}`);
    console.log(`  Sigmas filed:   ${inserted}`);
    console.log(`  stale cleared:  ${cleared}`);
    console.log(`  games skipped:  ${skipped}`);
    console.log(`  rows in table:  ${verify.rows[0].n}`);
    process.exit(0);
  } catch (error) {
    console.error('\nBACKFILL FAILED:', error.message);
    process.exit(1);
  } finally {
    await db.pool.end();
  }
})();