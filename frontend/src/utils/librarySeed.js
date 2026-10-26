/*
 * Sample "Chess PGN/FEN Library" dataset. Loaded once into localStorage on
 * first visit; every mutation (folders, items, reordering) is persisted there,
 * so the JSON shape stays exactly the one the rest of the app expects.
 */

const START_DATE = '2026-09-07';

function pgn(body, fen = null) {
  const head = [
    '[Event "Practice"]',
    '[Site "Library"]',
    `[Date "${START_DATE}"]`,
    '[Round "1"]',
    '[White "White"]',
    '[Black "Black"]',
  ];
  if (fen) head.push('[SetUp "1"]', `[FEN "${fen}"]`);
  return `${head.join('\n')}\n\n${body}`;
}

export function buildSampleLibrary() {
  const motifPgn = (body, fen) => pgn(body, fen);

  return {
    folders: [
      {
        id: 'root-motifs',
        name: 'Mating Motifs 1',
        parentId: null,
        type: 'mixed',
        description: 'Classic mating patterns — back-rank, queen mates and more.',
        createdAt: START_DATE,
        items: [
          { id: 1, title: 'Mating Motifs 1 - 1', type: 'pgn', notation: motifPgn('1. Ra8#', '6k1/5ppp/8/8/8/8/8/R6K w - - 0 1') },
          { id: 2, title: 'Mating Motifs 1 - 2', type: 'pgn', notation: motifPgn('1. f3 e5 2. g4 Qh4#') },
          { id: 3, title: 'Mating Motifs 1 - 3', type: 'pgn', notation: motifPgn('1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7#') },
          { id: 4, title: 'Mating Motifs 1 - 4', type: 'fen', notation: '6k1/5ppp/8/8/8/8/8/R6K w - - 0 1' },
          { id: 5, title: 'Mating Motifs 1 - 5', type: 'fen', notation: '6k1/5ppp/8/8/8/8/8/1R5K w - - 0 1' },
          { id: 6, title: 'Mating Motifs 1 - 6', type: 'fen', notation: '8/8/5k2/8/8/8/8/3QK3 w - - 0 1' },
          { id: 7, title: 'Mating Motifs 1 - 7', type: 'fen', notation: 'rnb1kbnr/pppp1ppp/8/4P3/6q1/8/PPPP1PPP/RNBQKBNR w KQkq - 1 3' },
          { id: 8, title: 'Mating Motifs 1 - 8', type: 'fen', notation: 'r1b1kb1r/pppp1ppp/5q2/4p3/4P3/8/PPPPQPPP/RNB1KBNR w KQkq - 2 4' },
          { id: 9, title: 'Mating Motifs 1 - 9', type: 'fen', notation: '6k1/8/8/8/8/8/5BK1/8 w - - 0 1' },
          { id: 10, title: 'Mating Motifs 1 - 10', type: 'fen', notation: '1k6/8/8/8/8/8/1K3Q2/8 w - - 0 1' },
          { id: 11, title: 'Mating Motifs 1 - 11', type: 'fen', notation: '7k/8/8/4K3/8/8/8/6Q1 w - - 0 1' },
          { id: 12, title: 'Mating Motifs 1 - 12', type: 'fen', notation: '4k3/8/8/8/8/8/8/3K2Q1 w - - 0 1' },
        ],
      },
      {
        id: 'sample-endgames',
        name: 'Simple Endgames',
        parentId: null,
        type: 'pgn',
        description: 'K+R and K+Q mates against a lone king.',
        createdAt: START_DATE,
        items: [],
      },
    ],
  };
}