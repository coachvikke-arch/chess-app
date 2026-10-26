/*
 * Unified Chess Profile service — the adapter that normalises Chess.com and
 * Lichess data into one internal format and persists it to the database.
 *
 * Everything stored is public, non-password data from the official APIs.
 * Deduplication: chess_games has UNIQUE (account_id, platform_game_id).
 */

const db = require('../config/database');
const chessCom = require('./chessComService');
const lichess = require('./lichessService');
/* Queues background Stockfish analysis per imported game. Failure-tolerant by
   construction, so an enqueue problem cannot abort an import — see
   services/analysis/enqueueHooks.js. */
const analysisHooks = require('./analysis/enqueueHooks');

const PLATFORMS = { 'chess.com': chessCom, lichess };

function svc(platform) {
  return PLATFORMS[platform] || null;
}

function normalizeUsername(platform, value) {
  const s = svc(platform);
  if (!s) throw Object.assign(new Error(`Unsupported platform: ${platform}`), { status: 400 });
  return s.normalizeUsername(value || '');
}

/* ── validation (no persistence) ─────────────────────────────────────────── */

async function validate(platform, value) {
  const username = normalizeUsername(platform, value);
  if (!username) throw Object.assign(new Error('Enter a username or profile URL.'), { status: 400 });
  const summary = await svc(platform).describeUser(username);
  return { platform, username: summary.username, summary };
}

/* ── connect / disconnect ────────────────────────────────────────────────── */

async function upsertAccount(userId, summary) {
  const res = await db.query(
    `INSERT INTO connected_chess_accounts (
       user_id, platform, username, profile_url, avatar, title, country_code,
       joined_date, last_activity_at, is_verified, is_streamer, followers, data
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)
     ON CONFLICT (user_id, platform) DO UPDATE SET
       username = EXCLUDED.username,
       profile_url = EXCLUDED.profile_url,
       avatar = EXCLUDED.avatar,
       title = EXCLUDED.title,
       country_code = EXCLUDED.country_code,
       joined_date = EXCLUDED.joined_date,
       last_activity_at = EXCLUDED.last_activity_at,
       is_verified = EXCLUDED.is_verified,
       is_streamer = EXCLUDED.is_streamer,
       followers = EXCLUDED.followers,
       data = EXCLUDED.data,
       status = 'connected',
       last_error = NULL,
       updated_at = NOW()
     RETURNING id`,
    [
      userId,
      summary.platform,
      summary.username,
      summary.profileUrl || null,
      summary.avatar || null,
      summary.title || null,
      summary.countryCode || null,
      summary.joined || null,
      summary.lastActivity || null,
      !!summary.isVerified,
      !!summary.isStreamer,
      summary.followers != null ? summary.followers : null,
      JSON.stringify(summary),
    ]
  );
  return res.rows[0].id;
}

async function connect(userId, platform, value) {
  const { username, summary } = await validate(platform, value);
  const accountId = await upsertAccount(userId, summary);
  const result = await syncAccount(userId, accountId);
  return { accountId, platform: summary.platform, username: summary.username, ...result };
}

async function disconnect(userId, accountId) {
  const owned = await db.query(
    'SELECT id FROM connected_chess_accounts WHERE id = $1 AND user_id = $2',
    [accountId, userId]
  );
  if (!owned.rows.length) throw Object.assign(new Error('Account not found.'), { status: 404 });
  await db.query('DELETE FROM connected_chess_accounts WHERE id = $1', [accountId]);
  return { ok: true };
}

/* ── sync ────────────────────────────────────────────────────────────────── */

/* "Recent games" scope for Chess.com — the last N monthly archives.
   Full-sync depth is configurable: PROFILE_GAMES_MONTHS (Chess.com archives,
   up to the whole career) and PROFILE_GAMES_MAX (per-provider ceiling — Lichess
   caps at 500 per the API, so a larger value still lands at 500 there). */
const GAMES_MONTHS = Number(process.env.PROFILE_GAMES_MONTHS) || 24; // last N full months (Chess.com)
const GAMES_MAX = Number(process.env.PROFILE_GAMES_MAX) || 1000;     // game cap per full sync
const RECENT_MAX = Number(process.env.PROFILE_RECENT_MAX) || 250;    // game cap per incremental poll

/* Minimum gap between /stats requests for one account. The page checks every
   two minutes, but a manual Sync can land right behind a poll; this keeps the
   pair from spending two upstream calls on the same ratings. */
const RATINGS_MIN_INTERVAL_MS = 60 * 1000;

/* ── ratings ─────────────────────────────────────────────────────────────────
 *
 * Current + best ratings come from Chess.com's /stats endpoint (the source of
 * truth). History comes from the games we have stored: the rating the owner
 * carried INTO each game is not in the payload, but the rating AFTER it is
 * `white_rating`/`black_rating` on the owner's side — so one point per day per
 * time class, taken from the LAST game of that day, is both accurate and
 * idempotent. The (account_id, category, point_date) UNIQUE constraint makes a
 * repeated sync update the same row instead of appending duplicates.
 */

/** Fetch stats and persist current/best ratings. Never throws: a stats outage
    must not break a game sync or wipe the values already on screen. */
async function refreshRatingsFromStats(account, { force = false } = {}) {
  if (!account || account.platform !== 'chess.com') {
    return { skipped: true, reason: 'not chess.com' };
  }
  const last = account.ratings_updated_at ? new Date(account.ratings_updated_at).getTime() : 0;
  if (!force && last && Date.now() - last < RATINGS_MIN_INTERVAL_MS) {
    return { skipped: true, reason: 'throttled', ratingsUpdatedAt: new Date(last).toISOString() };
  }
  try {
    const stats = await chessCom.fetchStats(account.username, { fresh: force });
    const ratings = chessCom.ratingsFromStats(stats);
    await persistRatings(account.id, ratings);
    await db.query(
      'UPDATE connected_chess_accounts SET ratings_updated_at = NOW(), updated_at = NOW() WHERE id = $1',
      [account.id],
    );
    return { ratings, ratingsUpdatedAt: new Date().toISOString() };
  } catch (err) {
    /* Keep whatever is stored and retry on the next check. A 429 is expected
       here sometimes; turning it into a failed game sync would be worse. */
    console.warn(`[chess-profile] ratings refresh failed for ${account.username}: ${(err && err.message) || err}`);
    return { error: (err && err.message) || 'Ratings refresh failed.' };
  }
}

/**
 * Derive daily rating points from stored games.
 *
 * `dates` limits the work to days touched by this sync. When the account has no
 * history yet (first connect, or an account imported before history existed)
 * the WHOLE stored game list is backfilled instead, so the chart is not born
 * empty on an established account.
 */
async function upsertRatingHistoryFromGames(accountId, { dates = null } = {}) {
  const existing = await db.query(
    'SELECT 1 FROM chess_rating_history WHERE account_id = $1 LIMIT 1',
    [accountId],
  );
  const backfillAll = existing.rows.length === 0;

  let dateFilter = '';
  const params = [accountId];
  if (!backfillAll) {
    const clean = [...new Set((dates || []).filter(Boolean))];
    if (!clean.length) return { points: 0, backfilled: false };
    params.push(clean);
    dateFilter = `AND g.game_date = ANY($2::date[])`;
  }

  /* One row per (category, day): the latest game of that day wins because its
     post-game rating is the value the day ends on. */
  const res = await db.query(
    `INSERT INTO chess_rating_history (account_id, category, point_date, rating)
     SELECT account_id, category, point_date, rating
       FROM (
         SELECT DISTINCT ON (g.time_class, g.game_date)
                $1::int AS account_id,
                g.time_class AS category,
                g.game_date AS point_date,
                CASE WHEN g.my_color = 'white' THEN g.white_rating
                     WHEN g.my_color = 'black' THEN g.black_rating
                     ELSE COALESCE(g.white_rating, g.black_rating)
                END AS rating
           FROM chess_games g
          WHERE g.account_id = $1
            AND g.time_class IN ('bullet','blitz','rapid','classical','correspondence')
            AND g.game_date IS NOT NULL
            ${dateFilter}
          ORDER BY g.time_class, g.game_date, g.end_time_ms DESC NULLS LAST, g.id DESC
       ) s
      WHERE s.rating IS NOT NULL AND s.rating > 0
     ON CONFLICT (account_id, category, point_date)
     DO UPDATE SET rating = EXCLUDED.rating`,
    params,
  );
  return { points: res.rowCount || 0, backfilled: backfillAll };
}

/** YYYY-MM-DD for each day represented in a batch of normalized games. */
function gameDates(games = []) {
  return games
    .filter((g) => g && g.endTimeMs)
    .map((g) => new Date(g.endTimeMs).toISOString().slice(0, 10));
}

/* Newest game already stored for an account — the sync watermark.
   Everything at or below this is already in the DB, so a poll only has to
   consider what came after it. */
async function newestStoredGame(accountId) {
  const r = await db.query(
    'SELECT MAX(end_time_ms) AS newest FROM chess_games WHERE account_id = $1 AND end_time_ms IS NOT NULL',
    [accountId],
  );
  const v = r.rows && r.rows[0] ? r.rows[0].newest : null;
  return v == null ? null : Number(v);
}

/**
 * Incremental sync — the path every page load and poll takes.
 *
 * Deliberately does NOT call fetchGamesDetailed: that treats the monthly archive
 * INDEX as the authority on which month is current, so any month Chess.com has
 * not published there yet is skipped silently. fetchLatestGames computes the
 * month from the clock and asks for it directly.
 *
 * NEVER deletes and never loses stored games:
 *   - a hard upstream failure is re-thrown after logging, leaving data intact;
 *   - a partial failure still persists what DID load, but records the reason;
 *   - neither path overwrites last_synced_at with a lie about freshness.
 */
async function syncLatest(userId, accountId, { maxGames = RECENT_MAX } = {}) {
  const acct = await db.query(
    'SELECT * FROM connected_chess_accounts WHERE id = $1 AND user_id = $2',
    [accountId, userId],
  );
  if (!acct.rows.length) throw Object.assign(new Error('Account not found.'), { status: 404 });
  const account = acct.rows[0];

  if (account.platform !== 'chess.com') {
    /* Lichess's feed is already incremental and current; reuse the same shape so
       callers need not branch. Still wrapped so a failure here records the reason
       and leaves the stored games alone, exactly like the Chess.com path. */
    try {
      const games = await lichess.fetchGamesNormalized(account.username, { max: Math.min(maxGames, 50) });
const { newGames, total } = await persistGames(accountId, games, userId);
      await db.query(
        `UPDATE connected_chess_accounts
            SET last_synced_at = NOW(), last_error = NULL, updated_at = NOW()
          WHERE id = $1`,
        [accountId],
      );
      await db.query(
        `INSERT INTO sync_history (user_id, account_id, status, new_games, message)
         VALUES ($1,$2,'ok',$3,$4)`,
        [userId, accountId, newGames, 'Incremental sync.'],
      ).catch(() => {});
      return {
        newGames,
        total,
        platform: account.platform,
        newestEndTimeMs: await newestStoredGame(accountId),
        partial: false,
        note: '',
        syncedAt: new Date().toISOString(),
      };
    } catch (err) {
      const msg = (err && err.message) || 'Sync failed.';
      await db.query(
        'UPDATE connected_chess_accounts SET last_error = $2, updated_at = NOW() WHERE id = $1',
        [accountId, String(msg).slice(0, 500)],
      ).catch(() => {});
      await db.query(
        `INSERT INTO sync_history (user_id, account_id, status, new_games, message)
         VALUES ($1,$2,'error',0,$3)`,
        [userId, accountId, String(msg).slice(0, 500)],
      ).catch(() => {});
      throw err;
    }
  }

  const watermark = await newestStoredGame(accountId);

  let result;
  try {
    result = await chessCom.fetchLatestGames(account.username, { maxGames, fresh: true });
  } catch (err) {
    // A transient failure must not look like "no new games". Record the exact
    // reason and leave the data untouched.
    const msg = (err && err.message) || 'Sync failed.';
    await db.query(
      `UPDATE connected_chess_accounts SET last_error = $2, updated_at = NOW() WHERE id = $1`,
      [accountId, String(msg).slice(0, 500)],
    ).catch(() => {});
    await db.query(
      `INSERT INTO sync_history (user_id, account_id, status, new_games, message)
       VALUES ($1,$2,'error',0,$3)`,
      [userId, accountId, String(msg).slice(0, 500)],
    ).catch(() => {});
    throw err;
  }

  const { games, newestEndTimeMs, note, failed = 0 } = result;

  /* A partial failure still persists whatever loaded — that data is real and
     discarding it would be its own loss — but it must NOT be recorded as a
     clean sync. last_synced_at is deliberately left alone here: the newest game
     we hold was not confirmed against every month we tried to read, so
     stamping "synced now" would overstate how current the data actually is. */
  if (failed > 0) {
    await db.query(
      `UPDATE connected_chess_accounts SET last_error = $2, updated_at = NOW() WHERE id = $1`,
      [accountId, String(note).slice(0, 500)],
    ).catch(() => {});
    await db.query(
      `INSERT INTO sync_history (user_id, account_id, status, new_games, message)
       VALUES ($1,$2,'partial',0,$3)`,
      [userId, accountId, String(note).slice(0, 500)],
    ).catch(() => {});
  }

  // Advance-by-watermark: rows at or below the newest stored game are already
  // present. Still passed to persistGames (whose UNIQUE constraint is the real
  // guarantee) — this just keeps a poll from upserting the same month of games
  // over and over, and makes the "newest known" figure explicit.
  const fresh = watermark == null ? games : games.filter((g) => (g.endTimeMs || 0) > watermark);
  const { newGames, total } = await persistGames(accountId, fresh, userId);

  /* Ratings ride the same check as the games: /stats is the authority for the
     current + best values, and the just-stored games supply the chart points.
     Both steps are failure-isolated — a rate-limited stats call must leave the
     game sync (and the previous ratings) intact. */
  const ratingsResult = await refreshRatingsFromStats(account);
  const historyResult = await upsertRatingHistoryFromGames(accountId, { dates: gameDates(fresh) });

  if (!failed) {
    // A clean poll clears the error and stamps the time, even when it found
    // nothing — "checked 2 min ago, nothing new" is the useful message.
    await db.query(
      `UPDATE connected_chess_accounts
          SET last_synced_at = NOW(), last_error = NULL, updated_at = NOW()
        WHERE id = $1`,
      [accountId],
    );
    await db.query(
      `INSERT INTO sync_history (user_id, account_id, status, new_games, message)
       VALUES ($1,$2,'ok',$3,$4)`,
      [userId, accountId, newGames, 'Incremental Chess.com sync.'],
    ).catch(() => {});
  }

  return {
    newGames,
    total,
    platform: account.platform,
    checkedMonths: result.months,
    newestEndTimeMs: newestEndTimeMs != null ? newestEndTimeMs : watermark,
    advancedPastWatermark: Boolean(watermark != null && newestEndTimeMs != null && newestEndTimeMs > watermark),
    partial: failed > 0,
    note: note || '',
    syncedAt: failed > 0 ? null : new Date().toISOString(),
    ratings: ratingsResult.ratings || null,
    ratingsUpdatedAt: ratingsResult.ratingsUpdatedAt || null,
    ratingsHistoryPoints: historyResult.points,
  };
}

async function syncAccount(userId, accountId, { recent = false } = {}) {
  const acct = await db.query(
    'SELECT * FROM connected_chess_accounts WHERE id = $1 AND user_id = $2',
    [accountId, userId]
  );
  if (!acct.rows.length) throw Object.assign(new Error('Account not found.'), { status: 404 });
  const account = acct.rows[0];
  const s = svc(account.platform);

  /* A "recent" refresh is the page-load / poll path, and it must NOT pay for
     the full import. It goes straight to syncLatest, which asks for the CURRENT
     month directly instead of letting the monthly archive index decide which
     month is current — that index is generated on Chess.com's own schedule, so
     any month it has not published yet is skipped silently. It also skips
     describeUser/rating-history so a poll costs two month requests instead of a
     dozen. */
  if (recent) return syncLatest(userId, accountId, { maxGames: RECENT_MAX });

  try {
    /* A manual Sync must show a rating that changed seconds ago, so Chess.com's
       /stats response is re-read rather than served from the 5-minute cache. */
    const summary = await s.describeUser(account.username, { fresh: account.platform === 'chess.com' });
    await upsertAccount(userId, summary);

    await persistRatings(accountId, summary.ratings || []);
    if (account.platform === 'chess.com') {
      /* Same source-of-truth path as the poll: current + best come from stats. */
      await db.query(
        'UPDATE connected_chess_accounts SET ratings_updated_at = NOW(), updated_at = NOW() WHERE id = $1',
        [accountId],
      );
    } else {
      /* Lichess exposes a purpose-built history endpoint; keep using it. */
      await persistRatingHistory(accountId, account.platform, account.username);
    }

    // games — bounded import. Chess.com: the last GAMES_MONTHS monthly archives
    // (archives list → parallel month fetches, see fetchGamesDetailed). Lichess:
    // recent games feed (API caps any request at 500 games).
    let games, note = '';
    if (account.platform === 'chess.com') {
      const res = await s.fetchGamesDetailed(account.username, { months: GAMES_MONTHS, maxGames: GAMES_MAX });
      games = res.games;
      note = res.note || '';

      /* The manual "Sync" button must ALSO see a game finished today. The
         archive-driven backfill above only knows about months Chess.com has
         published in its index, so on its own a manual sync could still report
         nothing new right after a game ended. Merge the direct current-month
         fetch in; the UNIQUE constraint makes the overlap free. */
      try {
        const live = await chessCom.fetchLatestGames(account.username, { maxGames: RECENT_MAX, fresh: true });
        const known = new Set(games.map((g) => g.platformGameId));
        const merged = live.games.filter((g) => !known.has(g.platformGameId));
        if (merged.length) {
          games = merged.concat(games).slice(0, GAMES_MAX);
          if (live.note) note = [note, live.note].filter(Boolean).join(' ');
        }
      } catch (err) {
        /* The backfill already succeeded, so a failed live fetch must not fail
           the whole sync — but the reason must be recorded, not hidden. */
        note = [note, `current-month check failed: ${(err && err.message) || 'unknown error'}`].filter(Boolean).join(' ');
      }
    } else {
      games = await s.fetchGamesNormalized(account.username, { max: GAMES_MAX });
    }
    const { newGames, total } = await persistGames(accountId, games, userId);

    /* Chess.com history is derived from the games just stored (see the ratings
       block above). Skipped on a failure? No: backfilling history from games
       already in the DB is independent of this run's upstream status. */
    if (account.platform === 'chess.com') {
      await upsertRatingHistoryFromGames(accountId, { dates: gameDates(games) });
    }

    // Zero games at all (new/inactive account, private/pruned archives, or the
    // API returning an empty month) → record a friendly 'partial' sync history
    // instead of a misleading "Synced. 0 new games".
    let statusRow = 'ok';
    let msg = `Synced. ${newGames} new game(s) (${total} total).`;
    if (games.length === 0) {
      statusRow = 'partial';
      msg = note || `No public games found for the last ${GAMES_MONTHS} month(s). If this account is new or inactive, games will appear once you play.`;
    }

    await db.query('UPDATE connected_chess_accounts SET last_synced_at = NOW(), status = $2, last_error = NULL, updated_at = NOW() WHERE id = $1',
      [accountId, 'connected']);

    await db.query(
      'INSERT INTO sync_history (user_id, account_id, status, new_games, message) VALUES ($1,$2,$3,$4,$5)',
      [userId, accountId, statusRow, newGames, msg]
    );

    return { newGames, total, syncedAt: new Date().toISOString(), note: games.length === 0 ? msg : '' };
  } catch (err) {
    // Persist the underlying failure so the account card can show why the sync
    // failed (rate-limited, profile not public, network, etc.).
    const msg = (err && err.message) || 'Sync failed.';
    await db.query(
      'UPDATE connected_chess_accounts SET status = $2, last_error = $3, updated_at = NOW() WHERE id = $1',
      [accountId, 'error', String(msg).slice(0, 500)]
    ).catch(() => {});
    throw err;
  }
}

async function persistRatings(accountId, ratings) {
  for (const r of ratings || []) {
    if (r.rating == null) continue;
    await db.query(
      `INSERT INTO chess_ratings (account_id, category, rating, best, last_updated_at)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (account_id, category) DO UPDATE SET
         rating = EXCLUDED.rating,
         best = COALESCE(EXCLUDED.best, chess_ratings.best),
         last_updated_at = EXCLUDED.last_updated_at`,
      [accountId, r.category, Math.round(r.rating), r.best != null ? Math.round(r.best) : null, r.lastUpdated || null]
    );
  }
}

async function persistRatingHistory(accountId, platform, username) {
  const rows = platform === 'chess.com'
    ? await chessCom.fetchRatingHistory(username, { months: 12, maxGames: GAMES_MAX })
    : await lichess.fetchGamesRatingHistory(username);

  for (const { category, points } of rows || []) {
    for (const p of points || []) {
      if (!p.point_date || p.rating == null) continue;
      await db.query(
        `INSERT INTO chess_rating_history (account_id, category, point_date, rating)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (account_id, category, point_date) DO UPDATE SET rating = EXCLUDED.rating`,
        [accountId, category, p.point_date, Math.round(p.rating)]
      );
    }
  }
}

/* Stable fallback id for a game that arrived without one.
   Chess.com games always carry a URL, but the column is nullable and Lichess
   occasionally omits an id, so a fallback is needed.

   It MUST be derived from the game's own data. The previous fallback was
   `${endTimeMs}-${Math.random()}` — a NEW value on every sync, which defeated
   the UNIQUE(account_id, platform_game_id) constraint entirely: re-syncing the
   same account inserted the identical game again as a fresh row, so the Games
   list filled with duplicates and every sync reported N "new" games. */
function stableGameKey(g) {
  const parts = [
    g.endTimeMs || '',
    g.whiteName || '',
    g.blackName || '',
    g.timeControl || '',
    g.movesCount || '',
    g.result || '',
  ].map((p) => String(p).toLowerCase());
  return `derived:${parts.join('|')}`;
}

/* `ownerUserId` is the account's owner, needed to queue Stockfish analysis for
   each imported game. It is passed in rather than looked up because all three
   callers already hold it, and a fourth query per sync would be wasteful. */
async function persistGames(accountId, games = [], ownerUserId = null) {
  let newCount = 0;
  for (const g of games) {
    const date = g.endTimeMs ? new Date(g.endTimeMs).toISOString().slice(0, 10) : null;
    try {
      const res = await db.query(
        `INSERT INTO chess_games (
           account_id, platform_game_id, game_date, end_time_ms, white_name, black_name,
           white_rating, black_rating, result, my_color, time_control, time_class, opening, eco,
           pgn, game_url, game_event, moves_count, is_rated
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
         ON CONFLICT (account_id, platform_game_id) DO UPDATE SET
           opening = CASE WHEN chess_games.opening = '' OR chess_games.opening IS NULL THEN EXCLUDED.opening ELSE chess_games.opening END,
           eco     = CASE WHEN chess_games.eco = '' OR chess_games.eco IS NULL THEN EXCLUDED.eco ELSE chess_games.eco END,
           -- A game first seen without a PGN (Chess.com sometimes omits it) is
           -- stored with empty pgn/moves_count. Fill both in once a later
           -- response carries them, otherwise the game-review engine could never
           -- load it. Never overwrite a PGN we already have with an empty one.
           pgn = CASE WHEN (chess_games.pgn = '' OR chess_games.pgn IS NULL) AND EXCLUDED.pgn <> '' THEN EXCLUDED.pgn ELSE chess_games.pgn END,
           moves_count = CASE WHEN COALESCE(chess_games.moves_count, 0) = 0 AND EXCLUDED.moves_count > 0 THEN EXCLUDED.moves_count ELSE chess_games.moves_count END,
           -- Fill any other column this sync happens to know better.
           game_event = CASE WHEN chess_games.game_event = '' OR chess_games.game_event IS NULL THEN EXCLUDED.game_event ELSE chess_games.game_event END
         WHERE chess_games.opening = '' OR chess_games.opening IS NULL
            OR chess_games.eco = '' OR chess_games.eco IS NULL
            OR chess_games.pgn = '' OR chess_games.pgn IS NULL
            OR COALESCE(chess_games.moves_count, 0) = 0
            OR chess_games.game_event = '' OR chess_games.game_event IS NULL
         -- xmax = 0 on INSERT, non-zero on UPDATE. Without this the counter below
         -- counted re-upserts of games we already had, so every poll reported N
         -- phantom "new games" and the UI announced changes that never happened.
         RETURNING (xmax = 0) AS inserted, id AS game_id`,
        [
          accountId,
          g.platformGameId || stableGameKey(g),
          date,
          g.endTimeMs || null,
          g.whiteName || '',
          g.blackName || '',
          g.whiteRating != null ? g.whiteRating : null,
          g.blackRating != null ? g.blackRating : null,
          g.result || 'draw',
          g.myColor || null,
          (g.timeControl || '').slice(0, 20),
          g.timeClass || '',
          (g.opening || '').slice(0, 255),
          (g.eco || '').slice(0, 10),
          g.pgn || '',
          (g.gameUrl || '').slice(0, 400),
          (g.gameEvent || '').slice(0, 120),
          g.movesCount || 0,
          !!g.isRated,
        ]
      );
      /* Count only genuine inserts (see the RETURNING clause). An update means
         we already had this game and merely backfilled a field. */
      if (res.rows && res.rows.length && res.rows[0].inserted) newCount++;

      /* Queue background Stockfish analysis. Deliberately run for UPDATES too,
         not just inserts: a game first stored with no PGN (Chess.com sometimes
         omits it) only becomes analysable once a later sync supplies one, and
         that is exactly the row the up-and-forget above just repaired. Re-running
         it for an already-analysed game is free — enqueueGame is an ON CONFLICT
         DO NOTHING upsert and leaves a finished game untouched — and the store
         caps how many profile_import jobs may be in flight so a 200-game backfill
         cannot bury the student's newest game. */
      if (res.rows && res.rows.length && res.rows[0].game_id) {
        await analysisHooks.profileGameImported(
          { id: res.rows[0].game_id, pgn: g.pgn || '', moves_count: g.movesCount || 0 },
          ownerUserId,
        );
      }
    } catch (err) {
      // a single corrupt game must never abort the whole import
      console.warn(`[chess-profile] skip game ${g.platformGameId}: ${err.message}`);
    }
  }
  const total = await db.query('SELECT COUNT(*) AS n FROM chess_games WHERE account_id = $1', [accountId]);
  return { newGames: newCount, total: Number(total.rows[0].n) };
}

/* ── reads ───────────────────────────────────────────────────────────────── */

async function accountsForUser(userId) {
  const res = await db.query(
    `SELECT
       a.id, a.platform, a.username, a.profile_url, a.avatar, a.title, a.country_code,
       a.joined_date, a.last_activity_at, a.is_verified, a.is_streamer, a.followers,
       a.last_synced_at, a.ratings_updated_at, a.status, a.last_error,
       (SELECT COUNT(*) FROM chess_games g WHERE g.account_id = a.id) AS games,
       /* newest game we hold, so the UI can say "up to date through <this game>"
          instead of only "synced at <some time>" */
       (SELECT MAX(g.end_time_ms) FROM chess_games g WHERE g.account_id = a.id) AS newest_game_ms,
       (SELECT COUNT(*) FROM chess_games g WHERE g.account_id = a.id AND
           (CASE WHEN g.white_name ILIKE ('%' || a.username || '%') THEN
              g.result = 'white' ELSE g.result = 'black' END)) AS wins,
COALESCE((SELECT json_agg(json_build_object(
            'category', r.category, 'rating', r.rating, 'best', r.best) ORDER BY r.category)
          FROM chess_ratings r WHERE r.account_id = a.id), '[]'::json) AS ratings
     FROM connected_chess_accounts a
     WHERE a.user_id = $1
     ORDER BY a.created_at ASC`,
    [userId]
  );
  return res.rows;
}

async function ratingsForAccount(accountId, userId) {
  const own = await isOwner(accountId, userId);
  if (!own) throw Object.assign(new Error('Account not found.'), { status: 404 });
  const [ratings, history, stamp] = await Promise.all([
    db.query('SELECT category, rating, best, last_updated_at FROM chess_ratings WHERE account_id = $1 ORDER BY category', [accountId]),
    /* to_char keeps the day a calendar string: a DATE handed to the client as an
       instant shifts by the server's timezone and can label the point "24 Jan"
       for a game played on the 25th. */
    db.query(
      `SELECT category, to_char(point_date, 'YYYY-MM-DD') AS point_date, rating
         FROM chess_rating_history WHERE account_id = $1 ORDER BY point_date ASC`,
      [accountId],
    ),
    db.query('SELECT ratings_updated_at FROM connected_chess_accounts WHERE id = $1', [accountId]),
  ]);
  const byCategory = {};
  for (const h of history.rows) {
    (byCategory[h.category] = byCategory[h.category] || []).push({ date: h.point_date, rating: h.rating });
  }
  return {
    ratings: ratings.rows,
    history: Object.entries(byCategory).map(([category, points]) => ({ category, points })),
    ratingsUpdatedAt: stamp.rows[0]?.ratings_updated_at || null,
  };
}

async function isOwner(accountId, userId) {
  const res = await db.query('SELECT 1 FROM connected_chess_accounts WHERE id = $1 AND user_id = $2', [accountId, userId]);
  return res.rows.length > 0;
}

/* ── games ───────────────────────────────────────────────────────────────── */

/* `game_date` is cast to text deliberately.

   `chess_games.game_date` is a Postgres DATE, and node-postgres parses DATE into
   a JS Date at LOCAL midnight. On this server (Asia/Calcutta, UTC+5:30) a stored
   date of 2026-10-01 therefore became 2026-10-01T00:00:00+05:30, which
   serialises as "2026-09-30T18:30:00.000Z". The client then rendered the leading
   10 chars and showed "Sep 30" for a game that was stored — and played — on
   Oct 1. Every game was shifted back exactly one day.

   Selecting `to_char(..., 'YYYY-MM-DD')` hands the client a plain calendar
   string with no instant attached, so there is nothing left for a timezone to
   reinterpret. The stored value and the date-range filters below still use the
   raw column, so filtering is unaffected. */
const GAME_FIELDS = `g.id, g.platform_game_id,
  to_char(g.game_date, 'YYYY-MM-DD') AS game_date,
  g.white_name, g.black_name,
  g.white_rating, g.black_rating, g.result, g.time_control, g.time_class,
  g.opening, g.eco, g.game_url, g.game_event, g.moves_count, g.is_rated, g.my_color,
  g.account_id, a.platform, a.username AS account_username`;

async function listGames(userId, {
  platform, result, timeClass, q, from, to, opponent,
  page = 1, pageSize = 25, sort = 'desc',
} = {}) {
  const params = [userId];
  const conds = ['a.user_id = $1'];

  const addParam = (v) => { params.push(v); return `$${params.length}`; };

  if (platform) conds.push(`a.platform = ${addParam(platform)}`);
  if (result && result !== 'all') conds.push(`g.result = ${addParam(result)}`);
  if (timeClass && timeClass !== 'all') conds.push(`g.time_class = ${addParam(timeClass)}`);
  if (from) conds.push(`g.game_date >= ${addParam(from)}`);
  if (to) conds.push(`g.game_date <= ${addParam(to)}`);
  if (opponent) {
    const p1 = addParam(`%${opponent}%`);
    const p2 = addParam(`%${opponent}%`);
    conds.push(`(g.white_name ILIKE ${p1} OR g.black_name ILIKE ${p2})`);
  }
  if (q) {
    const p1 = addParam(`%${q}%`);
    const p2 = addParam(`%${q}%`);
    const p3 = addParam(`%${q}%`);
    conds.push(`(g.opening ILIKE ${p1} OR g.white_name ILIKE ${p2} OR g.black_name ILIKE ${p3})`);
  }

  const whereSql = `WHERE ${conds.join(' AND ')}`;
  const total = await db.query(
    `SELECT COUNT(*) AS n FROM chess_games g
       JOIN connected_chess_accounts a ON a.id = g.account_id
       ${whereSql}`,
    params
  );
  const limit = Math.min(Math.max(Number(pageSize) || 25, 1), 100);
  const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;
  const orderDir = sort === 'asc' ? 'ASC' : 'DESC';
  const rows = await db.query(
    `SELECT ${GAME_FIELDS} FROM chess_games g
       JOIN connected_chess_accounts a ON a.id = g.account_id
       ${whereSql}
     ORDER BY g.end_time_ms ${orderDir} NULLS LAST, g.game_date ${orderDir}, g.id ${orderDir}
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );
  return { total: Number(total.rows[0].n), page: Number(page) || 1, pageSize: limit, games: rows.rows };
}

/* Owner check for a single game, against a SET of permitted users.
 *
 * `permittedUserIds` is the caller's visibility set from
 * reviewVisibilityService - for a self-owned read that is just [userId], and
 * for a coach reading a student's imported game it is the student's plus any
 * other student they coach. Using one query with `= ANY(...)` rather than
 * N lookups keeps the single-game path as cheap as the single-owner one.
 *
 * Returns the row, or throws 404. 404 rather than 403 because a game that is not
 * visible to you should be indistinguishable from one that does not exist. */
async function getGameForUsers(permittedUserIds, gameId) {
  const ids = (permittedUserIds || []).map(Number).filter((n) => n > 0);
  /* No visible users means no game can match; short-circuit so an empty ANY()
     is never even sent. */
  if (ids.length === 0) throw Object.assign(new Error('Game not found.'), { status: 404 });
  const res = await db.query(
    `SELECT ${GAME_FIELDS}, g.pgn FROM chess_games g
       JOIN connected_chess_accounts a ON a.id = g.account_id
     WHERE g.id = $1 AND a.user_id = ANY($2::int[])`,
    [Number(gameId), ids]
  );
  if (!res.rows.length) throw Object.assign(new Error('Game not found.'), { status: 404 });
  return res.rows[0];
}

async function getGame(userId, gameId) {
  return getGameForUsers([userId], gameId);
}

/* The payload that may be STORED.
 *
 * Only a COMPLETE, valid analysis is stored: the client validates the shape
 * before it saves, and the server checks again, so a partial, cancelled or
 * corrupt review can never be served back later as a finished one.
 *
 * `created_at` describes the ROW, not the analysis, so it is never written
 * into the payload — that keeps a re-save byte-identical to the first save.
 */
function storableAnalysis(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const analysis = data.analysis;
  if (!analysis || typeof analysis !== 'object') return null;
  if (!Array.isArray(analysis.moves) || analysis.moves.length === 0) return null;
  if (!data.analysisVersion) return null;
  const { created_at: _rowMetadata, ...envelope } = data;
  return envelope;
}

async function saveAnalysis(userId, gameId, data) {
  /* Own-games-only: the stored row is keyed by (game_id, user_id), so this
     writes the VIEWER's notes about their own copy of the game. A coach saving
     feedback on a student's game goes through saveAnalysisForUsers below and
     gets their own row, leaving the student's notes untouched. */
  await getGame(userId, gameId);
  const payload = storableAnalysis(data);
  if (!payload) {
    throw Object.assign(new Error('The analysis is incomplete and was not saved.'), { status: 400 });
  }
  await db.query(
    `INSERT INTO imported_game_analysis (game_id, user_id, data)
     VALUES ($1,$2,$3::jsonb)
     ON CONFLICT (game_id, user_id) DO UPDATE SET data = EXCLUDED.data, created_at = NOW()`,
    [Number(gameId), userId, JSON.stringify(payload)]
  );
  return { ok: true };
}

/** As saveAnalysis, but the game may belong to any user in `permittedUserIds`.
 *  The saved analysis is still keyed by `userId`, so a coach's review never
 *  overwrites the student's own saved analysis of the same game. */
async function saveAnalysisForUsers(permittedUserIds, userId, gameId, data) {
  await getGameForUsers(permittedUserIds, gameId);
  const payload = storableAnalysis(data);
  if (!payload) {
    throw Object.assign(new Error('The analysis is incomplete and was not saved.'), { status: 400 });
  }
  await db.query(
    `INSERT INTO imported_game_analysis (game_id, user_id, data)
     VALUES ($1,$2,$3::jsonb)
     ON CONFLICT (game_id, user_id) DO UPDATE SET data = EXCLUDED.data, created_at = NOW()`,
    [Number(gameId), userId, JSON.stringify(payload)]
  );
  return { ok: true };
}

/**
 * The saved analysis for ONE (game, user) pair.
 *
 * The stored `data` column IS the canonical envelope: the game's identity, the
 * analysis version, the schema version and the complete move-by-move review.
 * It is returned AS-IS, with `created_at` riding along as metadata.
 *
 * WHY IT MATTERS: the client validates exactly this shape
 * (canonicalAnalysis.isValidCanonicalAnalysis). When this endpoint wrapped the
 * envelope in `{ data }`, every persistent lookup looked like a MISS — the
 * client saw an object with no `analysisVersion` — so the engine re-ran the
 * whole review on every single open even though a complete analysis was
 * sitting in the database. The row was keyed correctly all along; only the
 * RESPONSE SHAPE was wrong.
 *
 * `created_at` is deliberately not part of the envelope: it describes the row,
 * not the analysis, and must never be written back into the stored payload.
 */
async function getAnalysis(userId, gameId) {
  const res = await db.query(
    'SELECT data, created_at FROM imported_game_analysis WHERE game_id = $1 AND user_id = $2',
    [Number(gameId), userId]
  );
  if (!res.rows.length) return null;
  const row = res.rows[0];
  const envelope = row.data && typeof row.data === 'object' && !Array.isArray(row.data) ? row.data : {};
  return { ...envelope, created_at: row.created_at };
}

async function deleteGame(userId, gameId) {
  const g = await getGame(userId, gameId);
  await db.query('DELETE FROM chess_games WHERE id = $1', [g.id]);
  return { ok: true };
}

module.exports = {
  normalizeUsername,
  validate,
  connect,
  disconnect,
  syncAccount,
  syncLatest,
  newestStoredGame,
  accountsForUser,
  ratingsForAccount,
  listGames,
  getGame,
  getGameForUsers,
  saveAnalysis,
  saveAnalysisForUsers,
  getAnalysis,
  deleteGame,
};