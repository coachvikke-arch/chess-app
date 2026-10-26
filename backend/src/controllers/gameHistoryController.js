const db = require('../config/database');
/* Canonical "who is White / who is the opponent" resolution, shared with any
   other surface that has to name the other player in an online game. */
const { resolveParticipants } = require('../utils/gameParticipants');
/* Background Stockfish analysis, queued the moment the game is stored. */
const analysisHooks = require('../services/analysis/enqueueHooks');
/* The one place that decides whose games/members a signed-in user may see. */
const visibility = require('../services/reviewVisibilityService');
/* Tournament rating settlement state (and the rating-history link). */
const tournamentRating = require('../services/tournamentRatingService');

/* ──────────────── Game History (student + admin) ────────────────
   Dedicated section surfaced separately from the puzzle library /
   assignments. It reads three sources:
     · online_games           the raw finished/past coach-vs-student matches
                              (raw rows are auto-deleted by gameHistoryCleanup
                              after GAME_HISTORY_RETENTION_DAYS).
     · computer_games         games played by student against the Stockfish
                              computer engine — stored permanently.
     · student_game_analysis  the permanent per-student day rollups written by
                              the same cleanup job BEFORE old rows are removed,
                              so every student keeps a long-lived record. */

// Save a completed computer game to the database
exports.saveComputerGame = async (req, res) => {
  try {
    const {
      playerColor,
      computerLevel,
      fen,
      pgn,
      result,
      resultReason,
      movesCount,
      timeBaseMinutes,
      timeIncrementSeconds,
      analysisData,
    } = req.body;

    if (!playerColor || !fen) {
      return res.status(400).json({ message: 'playerColor and fen are required' });
    }

    const resultRow = await db.query(
      `INSERT INTO computer_games (
        student_user_id, player_color, computer_level, fen, pgn,
        status, result, result_reason, moves_count,
        time_base_minutes, time_increment_seconds, analysis_data,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, 'finished', $6, $7, $8, $9, $10, $11, NOW(), NOW())
      RETURNING id, created_at`,
      [
        req.user.id,
        playerColor,
        Number(computerLevel) || 10,
        fen,
        pgn || '',
        result || null,
        resultReason || null,
        Number(movesCount) || 0,
        Number(timeBaseMinutes) || 5,
        Number(timeIncrementSeconds) || 0,
        analysisData ? JSON.stringify(analysisData) : '{}',
      ]
    );

    /* The game is durable at this point, so queue the analysis. Not awaited and
         failure-tolerant on purpose: the student's save must succeed whether or
         not the queue is up. The review page falls back to in-browser analysis. */
      analysisHooks.computerGameSaved({
        ...resultRow.rows[0],
        student_user_id: req.user.id,
        pgn: pgn || '',
        moves_count: Number(movesCount) || 0,
      });

      res.status(201).json({
      message: 'Computer game saved',
      id: resultRow.rows[0].id,
      createdAt: resultRow.rows[0].created_at,
    });
  } catch (err) {
    console.error('saveComputerGame error:', err);
    res.status(500).json({ message: 'Failed to save computer game', error: err.message });
  }
};

/* Internal game history (online + computer + analysis rollups + tournaments) for any user. */
async function historyForUser(userId) {
  /* The tournament rating columns are created lazily by the settlement service.
     A failure here must not hide the online/computer history, so it is
     best-effort. */
  try { await tournamentRating.ensureSchema(); } catch (_) { /* tournament history optional */ }

  const [onlineRes, computerRes, analysisRes, tournamentRes] = await Promise.all([
      db.query(
        `SELECT g.id, g.status, g.result, g.result_reason, g.admin_color, g.pgn,
                g.created_at, g.updated_at,
                g.admin_id, g.student_id,
                au.name AS admin_name, su.name AS student_name
         FROM online_games g
         JOIN users au ON au.id = g.admin_id
         JOIN users su ON su.id = g.student_id
         WHERE (g.admin_id = $1 OR g.student_id = $1)
         ORDER BY g.updated_at DESC
         LIMIT 200`,
        [userId]
      ),
      db.query(
        `SELECT cg.id, cg.player_color, cg.computer_level, cg.fen, cg.pgn, cg.status,
                cg.result, cg.result_reason, cg.moves_count,
                cg.time_base_minutes, cg.time_increment_seconds,
                cg.created_at, cg.updated_at, cg.analysis_data,
                u.name AS student_name
         FROM computer_games cg
         JOIN users u ON u.id = cg.student_user_id
         WHERE cg.student_user_id = $1
         ORDER BY cg.created_at DESC
         LIMIT 200`,
        [userId]
      ),
      db.query(
        `SELECT sa.period_start, sa.period_end, sa.games, sa.wins, sa.losses,
                sa.draws, sa.abandoned, sa.avg_moves
         FROM student_game_analysis sa
         WHERE sa.student_user_id = $1
         ORDER BY sa.period_start DESC
         LIMIT 120`,
        [userId]
      ),
      /* Tournament boards. A finished game belongs to the history whether or
         not it was rated: an Armageddon tiebreak or an abandoned board is still
         a game that was played. The rating sub-selects are LATERAL-free scalar
         subqueries so a missing settlement simply yields NULLs. */
      db.query(
        `SELECT tg.id, tg.tournament_id, tg.pairing_id, tg.white_player, tg.black_player,
                tg.result, tg.reason, tg.pgn, tg.fen, tg.moves_count, tg.armageddon,
                tg.finished_at, tg.updated_at, tg.created_at,
                t.name AS tournament_name, t.format AS tournament_format,
                p.round_no, p.board_no,
                wu.name AS white_name, bu.name AS black_name,
                COALESCE(sw.current_rating, 1000)::int AS white_rating,
                COALESCE(sb.current_rating, 1000)::int AS black_rating,
                (SELECT rh.rating_before FROM rating_history rh
                  WHERE rh.tournament_game_id = tg.id AND rh.student_id = me.id
                  ORDER BY rh.id DESC LIMIT 1) AS rating_before,
                (SELECT rh.rating_after FROM rating_history rh
                  WHERE rh.tournament_game_id = tg.id AND rh.student_id = me.id
                  ORDER BY rh.id DESC LIMIT 1) AS rating_after,
                (SELECT rh.rating_change FROM rating_history rh
                  WHERE rh.tournament_game_id = tg.id AND rh.student_id = me.id
                  ORDER BY rh.id DESC LIMIT 1) AS rating_change,
                (SELECT th.rating_before FROM time_control_rating_history th
                  WHERE th.tournament_game_id = tg.id AND th.student_id = me.id
                  ORDER BY th.id DESC LIMIT 1) AS time_rating_before,
                (SELECT th.rating_after FROM time_control_rating_history th
                  WHERE th.tournament_game_id = tg.id AND th.student_id = me.id
                  ORDER BY th.id DESC LIMIT 1) AS time_rating_after,
                (SELECT th.rating_change FROM time_control_rating_history th
                  WHERE th.tournament_game_id = tg.id AND th.student_id = me.id
                  ORDER BY th.id DESC LIMIT 1) AS time_rating_change,
                (SELECT rh.rating_before FROM rating_history rh
                  WHERE rh.tournament_game_id = tg.id
                    AND rh.student_id = CASE WHEN tg.white_player = $1 THEN sb.id ELSE sw.id END
                  ORDER BY rh.id DESC LIMIT 1) AS opponent_rating_before
           FROM tournament_games tg
           JOIN tournaments t ON t.id = tg.tournament_id
           LEFT JOIN tournament_pairings p ON p.id = tg.pairing_id
           LEFT JOIN users wu ON wu.id = tg.white_player
           LEFT JOIN users bu ON bu.id = tg.black_player
           LEFT JOIN students sw ON sw.user_id = tg.white_player
           LEFT JOIN students sb ON sb.user_id = tg.black_player
           LEFT JOIN students me ON me.user_id = $1
          WHERE tg.status = 'finished'
            AND (tg.white_player = $1 OR tg.black_player = $1)
          ORDER BY COALESCE(tg.finished_at, tg.updated_at, tg.created_at) DESC
          LIMIT 200`,
        [userId]
      ).catch((err) => {
        if (/does not exist/i.test(err.message)) return { rows: [] };
        throw err;
      }),
    ]);

    const onlineGames = onlineRes.rows.map((g) => {
      /* Identity is resolved from the participant IDs by the shared helper, not
         here. This mapper used to inline `g.admin_id === userId` against a query
         that never returned `g.admin_id`, so the test was always false and the
         opponent was always the admin — which is the viewer themselves whenever
         the viewer is the admin. See utils/gameParticipants.js. */
      const p = resolveParticipants(g, userId);
      const myColor = p.myColor || 'white';
      const mineWon =
        g.status === 'finished' && g.result !== 'abandoned' && g.result !== 'aborted'
          ? g.result === myColor
          : null;
      let resultLabel;
      /* A short, human reason suffix so the list shows WHY a game ended
         (Win (Mate), Loss (Time), Draw (Stalemate)…). Ordered prefixes are
         preserved — the charts' gameOutcome() keys off ^win/^loss/^draw. */
      const reasonShort = {
        checkmate: 'Mate',
        resignation: 'Resign',
        timeout: 'Time',
        stalemate: 'Stalemate',
        repetition: 'Repetition',
        'fifty-move': '50-move',
        insufficient: 'Material',
        agreement: 'Agreement',
      }[g.result_reason] || '';
      if (g.status !== 'finished') {
        resultLabel = g.status === 'aborted' ? 'Aborted' : g.status.charAt(0).toUpperCase() + g.status.slice(1);
      } else if (g.result === 'abandoned') {
        resultLabel = 'Abandoned';
      } else if (g.result === 'draw') {
        resultLabel = reasonShort ? `Draw (${reasonShort})` : 'Draw';
      } else if (mineWon) {
        resultLabel = reasonShort ? `Win (${reasonShort})` : 'Win';
      } else {
        resultLabel = reasonShort ? `Loss (${reasonShort})` : 'Loss';
      }
      return {
        id: `online_${g.id}`,
        type: 'online',
        status: g.status,
        result: g.result,
        resultLabel,
        resultReason: g.result_reason || null,
        date: g.updated_at || g.created_at,
        myColor,
        /* The OTHER participant. Null (rendered as "—") when the game genuinely
           has no resolvable opponent; never the viewer's own name. */
        opponentId: p.opponentId,
        opponentName: p.opponentName,
        myId: userId,
        /* Absolute (viewer-independent) side names and ids, for a score-sheet
           header: an admin reviewing a student's game must still see the same
           two names over the same two columns. */
        whiteId: p.whiteId,
        blackId: p.blackId,
        whiteName: p.whiteName,
        blackName: p.blackName,
        opponentType: 'player',
        mineWon,
        pgn: g.pgn,
      };
    });

    const computerGames = computerRes.rows.map((g) => {
      const myColor = g.player_color;
      let mineWon = null;
      let resultLabel = 'Finished';
      if (g.result === 'draw') {
        resultLabel = 'Draw';
        mineWon = null;
      } else if (g.result === myColor) {
        resultLabel = 'Win';
        mineWon = true;
      } else if (g.result) {
        resultLabel = 'Loss';
        mineWon = false;
      }
      if (g.result_reason === 'timeout' && g.result !== myColor) {
        resultLabel = 'Loss (Time)';
      } else if (g.result_reason === 'resignation' && g.result !== myColor) {
        resultLabel = 'Loss (Resign)';
      } else if (g.result_reason === 'resignation' && g.result === myColor) {
        resultLabel = 'Win (Resign)';
      } else if (g.result_reason === 'timeout' && g.result === myColor) {
        resultLabel = 'Win (Time)';
      } else if (g.result_reason === 'checkmate' && g.result === myColor) {
        resultLabel = 'Win (Mate)';
      } else if (g.result_reason === 'checkmate' && g.result !== myColor) {
        resultLabel = 'Loss (Mate)';
      }
      return {
        id: `computer_${g.id}`,
        type: 'computer',
        status: g.status,
        result: g.result,
        resultLabel,
        resultReason: g.result_reason,
        date: g.created_at,
        myColor,
        opponentName: `Computer Lv${g.computer_level}`,
        /* Same viewer-independent pair as above. computer_games stores only the
           student's id, so the student's name needs the join in this query -
           hard-coding "You" here would put the wrong word over the White column
           whenever an admin opens a student's review. */
        whiteName: myColor === 'white' ? g.student_name : `Computer Lv${g.computer_level}`,
        blackName: myColor === 'white' ? `Computer Lv${g.computer_level}` : g.student_name,
        opponentType: 'computer',
        computerLevel: g.computer_level,
        mineWon,
        pgn: g.pgn,
        movesCount: g.moves_count,
        analysisData: g.analysis_data,
      };
    });

    const tournamentGames = tournamentRes.rows.map((g) => {
      const myColor = Number(g.white_player) === Number(userId) ? 'white' : 'black';
      /* Same ordered prefixes as the online mapper: the charts key off
         ^win/^loss/^draw, so a suffix may be added but never prepended. */
      const reasonShort = {
        checkmate: 'Mate',
        resign: 'Resign',
        timeout: 'Time',
        stalemate: 'Stalemate',
        repetition: 'Repetition',
        fifty_move: '50-move',
        insufficient_material: 'Material',
        timeout_vs_insufficient: 'Time vs Material',
        agreement: 'Agreement',
        forfeit_no_show: 'No-show',
        forfeit: 'Forfeit',
        admin: 'Admin',
        armageddon: 'Armageddon',
      }[g.reason] || '';
      const abandoned = g.result === 'abandon';
      let resultLabel;
      if (abandoned) {
        resultLabel = 'Abandoned';
      } else if (g.result === 'draw') {
        resultLabel = reasonShort ? `Draw (${reasonShort})` : 'Draw';
      } else if (g.result === myColor) {
        resultLabel = reasonShort ? `Win (${reasonShort})` : 'Win';
      } else {
        resultLabel = reasonShort ? `Loss (${reasonShort})` : 'Loss';
      }
      const mineWon = abandoned || g.result === 'draw' ? null : g.result === myColor;
      const opponentIsBlack = myColor === 'white';
      const opponentId = opponentIsBlack ? g.black_player : g.white_player;
      const opponentName = opponentIsBlack ? g.black_name : g.white_name;
      /* Prefer the opponent's PRE-GAME rating from their own history row; fall
         back to today's number when the game was not rated. */
      const opponentRating = g.opponent_rating_before != null
        ? Number(g.opponent_rating_before)
        : Number(opponentIsBlack ? g.black_rating : g.white_rating);
      return {
        id: `tournament_${g.id}`,
        type: 'tournament',
        status: 'finished',
        result: g.result,
        resultLabel,
        resultReason: g.reason || null,
        date: g.finished_at || g.updated_at || g.created_at,
        myColor,
        opponentId: opponentId == null ? null : Number(opponentId),
        opponentName,
        opponentRating: Number.isFinite(opponentRating) ? opponentRating : null,
        myId: userId,
        whiteId: g.white_player == null ? null : Number(g.white_player),
        blackId: g.black_player == null ? null : Number(g.black_player),
        whiteName: g.white_name,
        blackName: g.black_name,
        opponentType: 'player',
        mineWon,
        pgn: g.pgn,
        fen: g.fen,
        movesCount: g.moves_count,
        tournamentId: Number(g.tournament_id),
        tournamentName: g.tournament_name,
        tournamentFormat: g.tournament_format,
        roundNo: g.round_no == null ? null : Number(g.round_no),
        boardNo: g.board_no == null ? null : Number(g.board_no),
        isArmageddon: !!g.armageddon,
        rated: g.rating_before != null,
        ratingBefore: g.rating_before == null ? null : Number(g.rating_before),
        ratingChange: g.rating_change == null ? null : Number(g.rating_change),
        ratingAfter: g.rating_after == null ? null : Number(g.rating_after),
        timeRatingBefore: g.time_rating_before == null ? null : Number(g.time_rating_before),
        timeRatingChange: g.time_rating_change == null ? null : Number(g.time_rating_change),
        timeRatingAfter: g.time_rating_after == null ? null : Number(g.time_rating_after),
      };
    });

    /* One list, newest first. `id` carries its source prefix, so the same game
       fetched twice (refresh, re-open, both players) can never appear twice. */
    const seenIds = new Set();
    const allGames = [...onlineGames, ...computerGames, ...tournamentGames]
      .filter((g) => {
        if (seenIds.has(g.id)) return false;
        seenIds.add(g.id);
        return true;
      })
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    const summaryFromAnalysis = analysisRes.rows.reduce(
      (acc, r) => {
        acc.games += Number(r.games) || 0;
        acc.wins += Number(r.wins) || 0;
        acc.losses += Number(r.losses) || 0;
        acc.draws += Number(r.draws) || 0;
        acc.abandoned += Number(r.abandoned) || 0;
        return acc;
      },
      { games: 0, wins: 0, losses: 0, draws: 0, abandoned: 0 }
    );

    const summaryFromLive = allGames.reduce(
      (acc, g) => {
        if (g.resultLabel === 'Win' || g.resultLabel.startsWith('Win ')) {
          acc.wins += 1;
          acc.games += 1;
        } else if (g.resultLabel === 'Loss' || g.resultLabel.startsWith('Loss ')) {
          acc.losses += 1;
          acc.games += 1;
        } else if (g.resultLabel === 'Draw') {
          acc.draws += 1;
          acc.games += 1;
        } else if (g.resultLabel === 'Abandoned') {
          acc.abandoned += 1;
          acc.games += 1;
        } else if (g.status === 'finished') {
          acc.games += 1;
        }
        return acc;
      },
      { games: 0, wins: 0, losses: 0, draws: 0, abandoned: 0 }
    );

    const summary = summaryFromAnalysis.games >= summaryFromLive.games
      ? { ...summaryFromAnalysis }
      : summaryFromLive;

    /* The analysis rollup predates tournaments and only covers the other game
       sources, so a tournament result would otherwise be missing from the
       headline cards. The live summary already includes them (it is built from
       `allGames`), so only the analysis branch needs topping up. */
    if (summary !== summaryFromLive) {
      for (const g of tournamentGames) {
        const label = g.resultLabel || '';
        summary.games += 1;
        if (label === 'Win' || label.startsWith('Win ')) summary.wins += 1;
        else if (label === 'Loss' || label.startsWith('Loss ')) summary.losses += 1;
        else if (label === 'Draw' || label.startsWith('Draw ')) summary.draws += 1;
        else if (g.result === 'abandon') summary.abandoned += 1;
      }
    }
    summary.winRate = summary.games > 0 ? Math.round((summary.wins / summary.games) * 100) : 0;

    return { games: allGames, summary, periods: analysisRes.rows };
}

// Student: their own history (online + computer games) + analysis rollups.
exports.studentHistory = async (req, res) => {
  try {
    res.json(await historyForUser(req.user.id));
  } catch (err) {
    console.error('studentHistory error:', err);
    res.status(500).json({ message: 'Failed to load game history', error: err.message });
  }
};

exports.historyForUser = historyForUser;

// Members table + per-member expansion, scoped to what the caller may see.
//
// SCOPE, decided server-side from the JWT and nothing else:
//   superadmin -> every member (academy oversight)
//   admin      -> ONLY the students assigned to that coach
//   (students) -> only themselves
//
// The member list and the per-member ?userId= expansion are filtered by the SAME
// set, so a coach cannot read a colleague's member list and then also expand a
// student who is not theirs. The set is re-read per request, so reassigning a
// student takes effect immediately for the old coach.
exports.adminHistory = async (req, res) => {
  try {
    const visibleIds = await visibility.getVisibleUserIds(req.user);
    const visible = visibility.visibleIdArray(visibleIds);
    /* Told to the client so the UI can say WHY the list is short ("no students
       assigned to you yet") instead of a generic empty table. */
    const scope = req.user.role === 'superadmin' ? 'all' : 'assigned';

    const userId = req.query.userId ? Number(req.query.userId) : null;
    if (userId) {
      /* Expanding a member is a read of that member's private game list, so the
         target must be in the caller's own set. Checked before any query runs. */
      if (!visibility.canSeeUser(visibleIds, userId)) {
        return res.status(403).json({
          message: 'That member is not one of your students.',
        });
      }
      const [periodsRes, full] = await Promise.all([
        db.query(
          `SELECT sa.period_start, sa.period_end, sa.games, sa.wins, sa.losses,
                  sa.draws, sa.abandoned, sa.avg_moves
           FROM student_game_analysis sa
           WHERE sa.student_user_id = $1
           ORDER BY sa.period_start DESC
           LIMIT 120`,
          [userId]
        ),
        historyForUser(userId),
      ]);
      return res.json({ userId, periods: periodsRes.rows, games: full.games, summary: full.summary });
    }

    /* Both branches of member_rows are filtered by the visible set:
         - students joined to users          the roster
         - anyone with recorded games        members who are not in `students`
       Filtering only the first would leave every coach who has ever played a
       game visible as a row, which is both a leak and confusing next to a table
       that is supposed to list a coach's own students. */
    /* Tournament players must be visible even when they have no online or
       computer games, and their tournament games must count in the row stats.
       The table is created by the tournament subsystem; if it is absent (an old
       install) the CTE/join are omitted instead of failing the whole page. */
    const hasTournamentGames = !!(await db.query(
      "SELECT to_regclass('public.tournament_games') AS t",
    )).rows[0].t;

    const tournamentMemberClause = hasTournamentGames
      ? `OR EXISTS (SELECT 1 FROM tournament_games tg
                     WHERE tg.white_player = u.id OR tg.black_player = u.id)`
      : '';
    const tournamentCte = hasTournamentGames
      ? `, tour AS (
           SELECT user_id,
                  SUM(games)::int AS games,
                  SUM(wins)::int AS wins,
                  SUM(losses)::int AS losses,
                  SUM(draws)::int AS draws,
                  SUM(abandoned)::int AS abandoned,
                  SUM(moves)::int AS moves
           FROM (
             SELECT tg.white_player AS user_id,
                    COUNT(*)::int AS games,
                    COUNT(*) FILTER (WHERE tg.result = 'white')::int AS wins,
                    COUNT(*) FILTER (WHERE tg.result = 'black')::int AS losses,
                    COUNT(*) FILTER (WHERE tg.result = 'draw')::int AS draws,
                    COUNT(*) FILTER (WHERE tg.result = 'abandon')::int AS abandoned,
                    COALESCE(SUM(tg.moves_count), 0)::int AS moves
             FROM tournament_games tg
             WHERE tg.status = 'finished' AND tg.white_player = ANY($1::int[])
             GROUP BY tg.white_player
             UNION ALL
             SELECT tg.black_player,
                    COUNT(*)::int,
                    COUNT(*) FILTER (WHERE tg.result = 'black')::int,
                    COUNT(*) FILTER (WHERE tg.result = 'white')::int,
                    COUNT(*) FILTER (WHERE tg.result = 'draw')::int,
                    COUNT(*) FILTER (WHERE tg.result = 'abandon')::int,
                    COALESCE(SUM(tg.moves_count), 0)::int
             FROM tournament_games tg
             WHERE tg.status = 'finished' AND tg.black_player = ANY($1::int[])
             GROUP BY tg.black_player
           ) x
           GROUP BY user_id
         )`
      : '';
    const tournamentJoin = hasTournamentGames
      ? 'LEFT JOIN tour tg ON tg.user_id = m.user_id'
      : '';
    const tcol = (col) => (hasTournamentGames ? `COALESCE(tg.${col},0)` : '0');

    const result = await db.query(
      `WITH member_rows AS (
         SELECT s.id AS student_id, s.user_id, u.name
         FROM students s
         JOIN users u ON u.id = s.user_id
         WHERE s.user_id = ANY($1::int[])
         UNION
         SELECT NULL::int AS student_id, u.id AS user_id, u.name
         FROM users u
         WHERE u.id = ANY($1::int[])
           AND (
             u.id IN (SELECT DISTINCT student_user_id FROM student_game_analysis)
             OR u.id IN (SELECT DISTINCT student_user_id FROM computer_games)
             OR u.id IN (SELECT DISTINCT student_id FROM online_games)
             ${tournamentMemberClause}
           )
       ),
       members AS (
         SELECT user_id, MIN(student_id) AS student_id, MIN(name) AS name
         FROM member_rows GROUP BY user_id
       ),
       agg AS (
         /* Stats come only from the rollup table, and the rollup is grouped here
            and joined on user_id, so they are already restricted to the members
            the CTE above let through. No second filter needed, and no way for a
            coach's totals to quietly include someone else's. */
         SELECT sa.student_user_id,
                COALESCE(SUM(sa.games),0)::int AS games,
                COALESCE(SUM(sa.wins),0)::int AS wins,
                COALESCE(SUM(sa.losses),0)::int AS losses,
                COALESCE(SUM(sa.draws),0)::int AS draws,
                COALESCE(SUM(sa.abandoned),0)::int AS abandoned,
                CASE WHEN SUM(sa.games) > 0
                     THEN ROUND((SUM(sa.avg_moves * sa.games) / NULLIF(SUM(sa.games),0))::numeric, 1)
                     ELSE 0 END AS avg_moves
         FROM student_game_analysis sa
         WHERE sa.student_user_id = ANY($1::int[])
         GROUP BY sa.student_user_id
       )
       ${tournamentCte}
       SELECT m.user_id, m.name, m.student_id,
              (COALESCE(a.games,0) + ${tcol('games')})::int AS games,
              (COALESCE(a.wins,0) + ${tcol('wins')})::int AS wins,
              (COALESCE(a.losses,0) + ${tcol('losses')})::int AS losses,
              (COALESCE(a.draws,0) + ${tcol('draws')})::int AS draws,
              (COALESCE(a.abandoned,0) + ${tcol('abandoned')})::int AS abandoned,
              CASE WHEN COALESCE(a.games,0) + ${tcol('games')} > 0
                   THEN ROUND((COALESCE(a.avg_moves,0) * COALESCE(a.games,0) + ${tcol('moves')})
                              / (COALESCE(a.games,0) + ${tcol('games')}), 1)
                   ELSE 0 END AS avg_moves
       FROM members m
       LEFT JOIN agg a ON a.student_user_id = m.user_id
       ${tournamentJoin}
       ORDER BY games DESC NULLS LAST, m.name ASC
       LIMIT 500`,
      [visible]
    );
    /* An object, not a bare array, so the client can tell "scoped, and you have
       no students" apart from "scoped, and none of them have games yet" without
       having to re-derive the role rule in the browser. */
    res.json({
      members: result.rows,
      scope,
      visibleCount: visible.length,
    });
  } catch (err) {
    console.error('adminHistory error:', err);
    res.status(500).json({ message: 'Failed to load game history', error: err.message });
  }
};