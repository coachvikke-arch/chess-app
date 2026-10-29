/* Tactic topic catalogue shared by the admin Puzzle Generator.
 *
 *   id       — stable slug used by the API and the UI (never the label)
 *   label    — what the admin sees
 *   lichess  — Lichess puzzle-database theme tags; a puzzle matches if it has
 *              ANY of them. Empty array = Lichess has no usable tag.
 *   engine   — the rule-based Stockfish detector that can prove this theme
 *              from a mined line, or null when there is no reliable detector.
 *
 * A topic with `engine: null` is Lichess-only; the UI says so instead of
 * silently returning nothing from the engine half.
 */

const TOPICS = [
  { id: 'fork', label: 'Fork', lichess: ['fork'], engine: 'fork' },
  { id: 'pin', label: 'Pin', lichess: ['pin'], engine: 'pin' },
  { id: 'skewer', label: 'Skewer', lichess: ['skewer'], engine: 'skewer' },
  { id: 'discovered-attack', label: 'Discovered Attack', lichess: ['discoveredAttack'], engine: 'discoveredAttack' },
  { id: 'discovered-check', label: 'Discovered Check', lichess: ['discoveredAttack'], engine: 'discoveredCheck' },
  { id: 'double-check', label: 'Double Check', lichess: ['doubleCheck'], engine: 'doubleCheck' },
  { id: 'deflection', label: 'Deflection', lichess: ['deflection'], engine: null },
  { id: 'decoy', label: 'Decoy/Attraction', lichess: ['attraction'], engine: null },
  { id: 'interference', label: 'Interference', lichess: ['interference'], engine: null },
  { id: 'clearance', label: 'Clearance', lichess: ['clearance'], engine: null },
  { id: 'removing-defender', label: 'Removing the Defender', lichess: ['capturingDefender'], engine: null },
  { id: 'overloading', label: 'Overloading', lichess: ['capturingDefender'], engine: null },
  { id: 'zwischenzug', label: 'Zwischenzug', lichess: ['intermezzo'], engine: null },
  { id: 'x-ray', label: 'X-Ray', lichess: ['xRayAttack'], engine: null },
  { id: 'trapped-piece', label: 'Trapped Piece', lichess: ['trappedPiece'], engine: null },
  { id: 'hanging-piece', label: 'Hanging Piece', lichess: ['hangingPiece'], engine: 'hangingPiece' },
  { id: 'sacrifice', label: 'Sacrifice', lichess: ['sacrifice'], engine: null },
  { id: 'quiet-move', label: 'Quiet Move', lichess: ['quietMove'], engine: null },
  { id: 'zugzwang', label: 'Zugzwang', lichess: ['zugzwang'], engine: null },
  { id: 'back-rank-mate', label: 'Back Rank Mate', lichess: ['backRankMate'], engine: 'backRankMate' },
  { id: 'smothered-mate', label: 'Smothered Mate', lichess: ['smotheredMate'], engine: 'smotheredMate' },
  { id: 'arabian-mate', label: "Arabian Mate", lichess: ['arabianMate'], engine: 'arabianMate' },
  { id: 'anastasia-mate', label: "Anastasia's Mate", lichess: ['anastasiaMate'], engine: 'anastasiaMate' },
  { id: 'hook-mate', label: 'Hook Mate', lichess: ['hookMate'], engine: null },
  { id: 'boden-mate', label: "Boden's Mate", lichess: ['bodenMate'], engine: null },
  { id: 'mate-in-1', label: 'Mate in 1', lichess: ['mateIn1'], engine: 'mateIn1' },
  { id: 'mate-in-2', label: 'Mate in 2', lichess: ['mateIn2'], engine: 'mateIn2' },
  { id: 'mate-in-3', label: 'Mate in 3', lichess: ['mateIn3'], engine: 'mateIn3' },
  { id: 'promotion', label: 'Promotion/Underpromotion', lichess: ['promotion', 'underPromotion'], engine: 'promotion' },
  { id: 'endgame', label: 'Endgame Tactics', lichess: ['endgame'], engine: null },
  { id: 'perpetual-check', label: 'Perpetual Check', lichess: ['perpetualCheck'], engine: null },
  { id: 'stalemate-trick', label: 'Stalemate Trick', lichess: ['stalemate'], engine: null },
  { id: 'exposed-king', label: 'Exposed King', lichess: ['exposedKing'], engine: null },
];

const BY_ID = new Map(TOPICS.map((t) => [t.id, t]));

function getTopic(id) {
  return BY_ID.get(String(id || '').trim()) || null;
}

function hasEngineDetector(topic) {
  return Boolean(topic && topic.engine);
}

module.exports = { TOPICS, getTopic, hasEngineDetector };
