const db = require('../config/database');
const {
  isValidDifficulty,
  isValidResult,
  recordGame,
  getSnapshot,
  getSummary,
  BOT_DIFFICULTIES,
} = require('../lib/botProgressService');
const { userIsMemberOfClass } = require('../services/liveClassAccess');

/* The catalogue is a client bundle, so the server cannot import it. This
 * roster is a mirror of the `id` + `difficulty` pairs in
 * frontend/src/data/bots.ts, and `scripts/bot-progress-api.test.mjs` reads that
 * file to assert the two agree — so a renamed or re-tiered bot fails a test
 * rather than silently 404ing or mis-crediting a result. */
const BOT_ROSTER = {
  pip: 'Beginner', mia: 'Beginner', leo: 'Beginner', nova: 'Beginner', toby: 'Beginner',
  aria: 'Casual', finn: 'Casual', luna: 'Casual', kai: 'Casual', milo: 'Casual',
  zara: 'Intermediate', orion: 'Intermediate', theo: 'Intermediate', maya: 'Intermediate', atlas: 'Intermediate',
  raven: 'Advanced', viktor: 'Advanced', iris: 'Advanced', magnuson: 'Advanced', serena: 'Advanced',
  cipher: 'Expert', phoenix: 'Expert', titan: 'Expert', akira: 'Expert', draco: 'Expert',
  shadow: 'Master', aurora: 'Master', nexus: 'Master', zenith: 'Master', omega: 'Master',
};

const KNOWN_BOT_IDS = new Set(Object.keys(BOT_ROSTER));

/* A client may claim any difficulty for a known id, which would let it pay
 * Expert-rate coins for a Beginner bot. The server uses ITS OWN tier for the id
 * and ignores the claimed one. */
function resolveDifficulty(botId, claimed) {
  const actual = BOT_ROSTER[botId];
  if (!actual) return null;
  return actual;
}

/** GET /bots/progress — authoritative snapshot, merged client-side. */
async function getProgress(req, res) {
  try {
    const snapshot = await getSnapshot(req.user.id, [...KNOWN_BOT_IDS]);
    res.json(snapshot);
  } catch (err) {
    console.error('[bots] progress snapshot failed:', err.message);
    res.status(500).json({ message: 'Could not load bot progress' });
  }
}

/** GET /bots/summary — read-only rollup for dashboards. */
async function summary(req, res) {
  try {
    res.json(await getSummary(req.user.id));
  } catch (err) {
    console.error('[bots] summary failed:', err.message);
    res.status(500).json({ message: 'Could not load bot summary' });
  }
}

/**
 * POST /bots/result — report a finished game.
 *
 * The award is derived here from the SERVER's tier for the bot id plus the
 * result; a client-sent difficulty or coin amount cannot raise the payout.
 * `gameId` makes a replay a no-op.
 */
async function submitResult(req, res) {
  const { botId, difficulty, result, gameId, accuracy, plies, classId } = req.body || {};

  if (!botId || typeof botId !== 'string') {
    return res.status(400).json({ message: 'botId is required' });
  }
  if (!KNOWN_BOT_IDS.has(botId)) {
    return res.status(404).json({ message: 'Unknown bot' });
  }
  if (!isValidResult(result)) {
    return res.status(400).json({ message: 'Unknown result' });
  }
  if (!gameId || typeof gameId !== 'string') {
    /* Without an id there is nothing to de-duplicate on, so a client that
     * cannot supply one is rejected rather than silently double-paying. */
    return res.status(400).json({ message: 'gameId is required' });
  }

  /* The claimed difficulty is only used to reject an obviously bogus value; the
     award itself always uses the server's tier for this id. */
  if (difficulty != null && !isValidDifficulty(difficulty)) {
    return res.status(400).json({ message: 'Unknown difficulty' });
  }
  const authoritativeDifficulty = resolveDifficulty(botId, difficulty);

  /* Optional classroom attribution for the classroom leaderboard.
   *
   * Never trusted: a client could otherwise post coins into any class board by
   * inventing an id. It is verified against real membership, and an id the user
   * cannot join degrades to NULL (game still scores normally in the arena)
   * rather than failing - losing a leaderboard line must never cost a student
   * the coins they actually earned. */
  let verifiedClassId = null;
  if (classId != null && classId !== '') {
    const parsedClassId = parseInt(classId, 10);
    if (Number.isFinite(parsedClassId)) {
      try {
        const classRes = await db.query('SELECT * FROM classes WHERE id = $1', [parsedClassId]);
        if (classRes.rows.length > 0) {
          const access = await userIsMemberOfClass(
            { userId: req.user.id, userRole: req.user.role },
            classRes.rows[0],
          );
          if (access.authorized) verifiedClassId = parsedClassId;
        }
      } catch (e) {
        console.warn('[submitResult] class membership check failed:', e.message);
      }
    }
  }

  try {
    const outcome = await recordGame(req.user.id, {
      botId,
      difficulty: authoritativeDifficulty,
      result,
      gameId: gameId.slice(0, 64),
      accuracy,
      plies,
      classId: verifiedClassId,
    });

    /* Only the played bot is needed in the per-game response. Re-sending the
       whole roster on every result would make the common case (a ~40-entry
       snapshot) larger than the payload it is reacting to. The full snapshot is
       still available from GET /bots/progress. */
    const snapshot = await getSnapshot(req.user.id, [botId]);
    res.json({
      ...outcome,
      rewards: snapshot.rewards,
      progress: snapshot.progress,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error('[bots] record result failed:', err.message);
    res.status(500).json({ message: 'Could not record bot result' });
  }
}

/** GET /bots/:botId — validate an id against the roster before playing. */
async function verifyBot(req, res) {
  const { botId } = req.params;
  if (!KNOWN_BOT_IDS.has(botId)) {
    return res.status(404).json({ message: 'Unknown bot' });
  }
  try {
    const snapshot = await getSnapshot(req.user.id, [botId]);
    res.json({ bot: { id: botId, ...snapshot.progress[botId] }, rewards: snapshot.rewards });
  } catch (err) {
    console.error('[bots] verify failed:', err.message);
    res.status(500).json({ message: 'Could not verify bot' });
  }
}

module.exports = {
  BOT_ROSTER,
  KNOWN_BOT_IDS,
  resolveDifficulty,
  BOT_DIFFICULTIES,
  getProgress,
  summary,
  submitResult,
  verifyBot,
};