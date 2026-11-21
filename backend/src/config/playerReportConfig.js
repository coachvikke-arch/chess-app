/*
 * Tunable constants for the Player Report.
 *
 * This file is intentionally new and self-contained: no existing config is
 * changed. The numbers below are deliberately conservative estimates and are
 * labelled as such everywhere they are shown in the UI.
 */

module.exports = {
  window: {
    days: 90,
    maxGames: 200,
    minGamesForAccurateReport: 20,
    minInAppMoves: 10,
  },

  /* Weight applied to a game when computing skill scores and FIDE readiness.
     Computer games are real practice, but they are not human competition. */
  weights: {
    human: 1,
    computer: 0.5,
  },

  /* Offsets from the site's stored Rapid/Classical rating to a rough FIDE
     equivalent. Tune here later when real calibration data is available. */
  ratingOffsets: {
    chesscom: { rapid: -100, blitz: -120, classical: -110 },
    lichess: { rapid: -175, blitz: -195, classical: -165 },
    matezone: { rapid: 0, blitz: 0, classical: 0 },
  },

  fide: {
    defaultFieldRating: 1400,
    tournamentCount: 5000,
    fieldSize: 20,
    rounds: 9,
    topTenPlaces: 10,
    /* Accuracy trend / consistency adjustments, in FIDE points. */
    trendPointsPerAccuracyPoint: 0.6,
    maxTrendAdjustment: 45,
    consistencyPenaltyMax: 35,
    consistencyStdDevFullPenalty: 18,
  },

  phases: {
    openingLastMove: 10,
    endgameFirstMove: 40,
    simpleEndingPieces: 12,
  },

  timeManagement: {
    quickBlunderMoveThreshold: 30,
    fastMoveSeconds: 15,
    timeTroubleSecondsLeft: 30,
  },

  /* Skill blend. Each input is already normalised to 0..100. */
  skillMix: {
    tactics: { tacticalMiss: 0.35, brilliantGreat: 0.35, blunderPenalty: 0.3 },
    endgame: { lateAccuracy: 0.7, simpleEndingAccuracy: 0.3 },
    timeManagement: { noTimeout: 0.7, fastBlunderPenalty: 0.3 },
    consistency: { accuracyStdDev: 0.6, ratingSwing: 0.4 },
  },

  blunderThemes: [
    'missed tactic',
    'hanging piece',
    'back rank',
    'endgame error',
    'time trouble',
  ],

  cache: {
    ttlMs: 5 * 60 * 1000,
    maxEntries: 200,
  },
};
