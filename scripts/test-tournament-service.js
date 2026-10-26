/* Tournament service unit tests.
   Testing the pure functions added to tournamentService.js
   These tests cover the Phase 1 requirements for tournament pairing and standings logic.
*/

/* Imports */
const tournamentService = require('../backend/src/services/tournamentService');

/* Test data */
const SAMPLE_GAMES = [
  { whiteId: 'player1', blackId: 'player2', result: 1 },   // player1 wins
  { whiteId: 'player1', blackId: 'player3', result: 0.5 }, // draw
  { whiteId: 'player2', blackId: 'player3', result: 0 },   // player3 wins
];

const PLAYERS_WITH_POINTS = [
  { id: 'player1', name: 'Alice', points: 1.5, gamesPlayed: 2 },
  { id: 'player2', name: 'Bob', points: 1, gamesPlayed: 2 },
  { id: 'player3', name: 'Charlie', points: 0.5, gamesPlayed: 2 },
  { id: 'player4', name: 'Diana', points: 0, gamesPlayed: 1 },
];

const FIRST_ROUND_PLAYERS = [
  { id: 'p1', name: 'Alice' },
  { id: 'p2', name: 'Bob' },
  { id: 'p3', name: 'Charlie' }, // Odd number - gets bye
];

const EXISTING_PAIRINGS = [
  { whiteId: 'player1', blackId: 'player2' },
  { whiteId: 'player3', blackId: 'player4' },
];

/* computeStandings tests */
describe('computeStandings', () => {
  test('computes correct standings from game results', () => {
    const result = tournamentService.computeStandings(SAMPLE_GAMES);
    
    expect(result.get('player1')).toEqual({ points: 1.5, gamesPlayed: 2 });
    expect(result.get('player2')).toEqual({ points: 0, gamesPlayed: 2 });
    expect(result.get('player3')).toEqual({ points: 1, gamesPlayed: 2 });
  });

  test('handles empty games array', () => {
    const result = tournamentService.computeStandings([]);
    expect(result.size).toBe(0);
  });

  test('handles single game', () => {
    const result = tournamentService.computeStandings([
      { whiteId: 'a', blackId: 'b', result: 1 }
    ]);
    expect(result.get('a')).toEqual({ points: 1, gamesPlayed: 1 });
    expect(result.get('b')).toEqual({ points: 0, gamesPlayed: 1 });
  });
});

/* generateSwissPairings tests */
describe('generateSwissPairings', () => {
  test('generates pairings for even number of players with same points', () => {
    const players = [
      { id: 'p1', points: 3, name: 'Alice' },
      { id: 'p2', points: 3, name: 'Bob' },
      { id: 'p3', points: 2, name: 'Charlie' },
      { id: 'p4', points: 2, name: 'Diana' },
    ];
    const result = tournamentService.generateSwissPairings(players);
    expect(result.pairings.length).toBe(2);
  });

  test('gives bye to lowest-scoring player when odd number', () => {
    const players = [
      { id: 'p1', points: 3, name: 'Alice' },
      { id: 'p2', points: 2, name: 'Bob' },
      { id: 'p3', points: 1, name: 'Charlie' },
    ];
    const result = tournamentService.generateSwissPairings(players);
    expect(result.byes.length).toBe(1);
    expect(result.byes[0]).toBe('p3'); // Lowest scoring gets bye
    expect(result.pairings.length).toBe(1);
  });
});

/* generateFirstRoundPairings tests */
describe('generateFirstRoundPairings', () => {
  test('pairs players deterministically by name', () => {
    const result = tournamentService.generateFirstRoundPairings(FIRST_ROUND_PLAYERS);
    expect(result.pairings.length).toBe(1); // (p1, p2) and p3 gets bye
    expect(result.byes.length).toBe(1);
    expect(result.byes[0]).toBe('p3');
  });

  test('handles even number of players', () => {
    const evenPlayers = [
      { id: 'p1', name: 'Alice' },
      { id: 'p2', name: 'Bob' },
      { id: 'p3', name: 'Charlie' },
      { id: 'p4', name: 'Diana' },
    ];
    const result = tournamentService.generateFirstRoundPairings(evenPlayers);
    expect(result.pairings.length).toBe(2);
    expect(result.byes.length).toBe(0);
  });
});

/* hasHadByePlayer tests */
describe('hasHadByePlayer', () => {
  test('returns true for player who had a bye', () => {
    const byesHistory = [
      { playerId: 'p1' },
      { playerId: 'p2' },
    ];
    expect(tournamentService.hasHadByePlayer('p1', byesHistory)).toBe(true);
  });

  test('returns false for player who hasn't had a bye', () => {
    const byesHistory = [
      { playerId: 'p1' },
    ];
    expect(tournamentService.hasHadByePlayer('p3', byesHistory)).toBe(false);
  });
});

/* wouldBeRematch tests */
describe('wouldBeRematch', () => {
  test('returns true for existing pairing', () => {
    expect(tournamentService.wouldBeRematch(EXISTING_PAIRINGS, 'player1', 'player2')).toBe(true);
    expect(tournamentService.wouldBeRematch(EXISTING_PAIRINGS, 'player2', 'player1')).toBe(true);
  });

  test('returns false for new pairing', () => {
    expect(tournamentService.wouldBeRematch(EXISTING_PAIRINGS, 'player1', 'player3')).toBe(false);
  });
});

/* recomputeStandings tests */
describe('recomputeStandings', () => {
  test('recomputes standings correctly with new games', () => {
    const oldStandings = new Map([
      ['player1', { points: 1, gamesPlayed: 1 }],
      ['player2', { points: 0, gamesPlayed: 1 }],
    ]);
    
    const newGames = [
      { whiteId: 'player1', blackId: 'player2', result: 0.5 }, // Draw
    ];
    
    const result = tournamentService.recomputeStandings(oldStandings, newGames);
    expect(result.get('player1')).toEqual({ points: 1.5, gamesPlayed: 2 });
    expect(result.get('player2')).toEqual({ points: 0.5, gamesPlayed: 2 });
  });

  test('handles empty new games', () => {
    const oldStandings = new Map([
      ['player1', { points: 1, gamesPlayed: 1 }],
    ]);
    const result = tournamentService.recomputeStandings(oldStandings, []);
    expect(result.get('player1')).toEqual({ points: 1, gamesPlayed: 1 });
  });
});