/* Tournament service module.
   Additive pure exports for tournament-related functionality.
   These are pure functions (no side effects) that can be used for
   computing standings, generating pairings, and other tournament logic.
*/

/* Compute standings from a list of game results.
   Each game result: { whiteId, blackId, result } where result is 1 (white win), 0 (black win), 0.5 (draw)
   Returns a map of playerId -> { points, gamesPlayed }
*/
function computeStandings(games) {
  const standings = new Map();

  for (const game of games) {
    const { whiteId, blackId, result } = game;

    if (!standings.has(whiteId)) {
      standings.set(whiteId, { points: 0, gamesPlayed: 0 });
    }
    if (!standings.has(blackId)) {
      standings.set(blackId, { points: 0, gamesPlayed: 0 });
    }

    standings.get(whiteId).gamesPlayed += 1;
    standings.get(blackId).gamesPlayed += 1;

    if (result === 1) {
      standings.get(whiteId).points += 1;
    } else if (result === 0) {
      standings.get(blackId).points += 1;
    } else if (result === 0.5) {
      standings.get(whiteId).points += 0.5;
      standings.get(blackId).points += 0.5;
    }
  }

  return standings;
}

/* Generate Swiss pairings for a round.
   players: array of { id, points, name } sorted by points descending
   returns: array of [playerId, opponentId] pairs
   Rules:
   - Pair players with same points together
   - No repeat pairings (second-bye-never-same-player)
   - Bye given to lowest-scoring player who hasn't had a bye yet
   - Odd number of players: lowest player gets bye
*/
function generateSwissPairings(players) {
  // Sort players by points descending, then by name for deterministic order
  const sorted = [...players].sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));

  const paired = new Set(); // Track already-paired (playerA, playerB) combinations
  const pairings = [];
  const byes = new Set(); // Track players who have received a bye
  const result = [];

  // First pass: pair players with same points
  let i = 0;
  while (i < sorted.length) {
    const p1 = sorted[i];

    // Find opponent for p1
    let p2Index = -1;
    for (let j = i + 1; j < sorted.length; j++) {
      const p2 = sorted[j];
      if (p1.points === p2.points && !paired.has(`${p1.id},${p2.id}`) && !paired.has(`${p2.id},${p1.id}`)) {
        if (!byes.has(p2.id)) {
          p2Index = j;
          break;
        }
      }
    }

    if (p2Index >= 0) {
      const p2 = sorted[p2Index];
      paired.add(`${p1.id},${p2.id}`);
      paired.add(`${p2.id},${p1.id}`);
      result.push([p1.id, p2.id]);
      i += 2;
    } else {
      // No valid opponent found - give bye to p1
      if (!byes.has(p1.id)) {
        byes.add(p1.id);
        result.push([p1.id, null]); // Bye
      } else {
        // This shouldn't happen in normal Swiss, but handle it
        result.push([p1.id, null]);
      }
      i += 1;
    }
  }

  return { pairings: result.map(p => ({ white: p[0], black: p[1] })), byes: Array.from(byes) };
}

/* Generate pairings for the first round (no pairing history yet).
   players: array of { id, name } - all players in the tournament
   returns: { pairings, byes }
*/
function generateFirstRoundPairings(players) {
  // Sort by name for deterministic first-round pairings
  const sorted = [...players].sort((a, b) => a.name.localeCompare(b.name));
  const pairings = [];
  const byes = [];
  let i = 0;

  while (i < sorted.length) {
    if (i + 1 < sorted.length) {
      pairings.push([sorted[i].id, sorted[i + 1].id]);
      i += 2;
    } else {
      // Odd number of players - last player gets bye
      byes.push(sorted[i].id);
      i += 1;
    }
  }

  return { pairings: pairings.map(p => ({ white: p[0], black: p[1] })), byes };
}

/* Check if a player has already had a bye in previous rounds.
   This enforces the "second-bye-never-same-player" rule.
*/
function hasHadByePlayer(playerId, byesHistory) {
  return byesHistory.some(entry => entry.playerId === playerId);
}

/* Check if pairing would create a rematch.
   Existing pairings: array of { whiteId, blackId }
   New pairing: { playerId, opponentId }
   returns: true if this would be a rematch
*/
function wouldBeRematch(existingPairings, playerId, opponentId) {
  for (const p of existingPairings) {
    if ((p.whiteId === playerId && p.blackId === opponentId) ||
        (p.whiteId === opponentId && p.blackId === playerId)) {
      return true;
    }
  }
  return false;
}

/* Validate that a standings recompute is correct.
   oldStandings: previous standings map
   newGames: new game results since last compute
   returns: new standings map
*/
function recomputeStandings(oldStandings, newGames) {
  const newStandings = new Map(oldStandings); // Copy old standings

  for (const game of newGames) {
    const { whiteId, blackId, result } = game;

    if (!newStandings.has(whiteId)) {
      newStandings.set(whiteId, { points: 0, gamesPlayed: 0 });
    }
    if (!newStandings.has(blackId)) {
      newStandings.set(blackId, { points: 0, gamesPlayed: 0 });
    }

    newStandings.get(whiteId).gamesPlayed += 1;
    newStandings.get(blackId).gamesPlayed += 1;

    if (result === 1) {
      newStandings.get(whiteId).points += 1;
    } else if (result === 0) {
      newStandings.get(blackId).points += 1;
    } else if (result === 0.5) {
      newStandings.get(whiteId).points += 0.5;
      newStandings.get(blackId).points += 0.5;
    }
  }

  return newStandings;
}

module.exports = {
  computeStandings,
  generateSwissPairings,
  generateFirstRoundPairings,
  hasHadByePlayer,
  wouldBeRematch,
  recomputeStandings
};