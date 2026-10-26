const fs = require('fs');
const path = require('path');
const { Chess } = require('chess.js');
const root = process.argv[2];
if (!root) throw new Error('Pass extracted PGN Mentor root');
const out = path.resolve(__dirname, '../../frontend/src/games');
fs.mkdirSync(out, { recursive: true });

// id, archive, white, black, date, round, year, event, site, result, pause moves
const S = [
['kasparov-topalov-1999','Kasparov','Kasparov, Gary','Topalov, Veselin','1999.01.20','4',1999,'Hoogovens','Wijk aan Zee','1-0',[6,20,24,29,44]],
['anand-topalov-1998','Anand','Anand, Viswanathan','Topalov, Veselin','1998.01.21','5',1998,'Hoogovens','Wijk aan Zee','1-0',[6,18,25,28,29]],
['alekhine-euwe-1935-g3','Alekhine','Alekhine, Alexander','Euwe, Max','1935.??.??','3',1935,'World Championship 16th','Netherlands','1-0',[5,12,18,24,32]],
['tal-botvinnik-1960-g1','Tal','Tal, Mihail','Botvinnik, Mikhail','1960.??.??','1',1960,'World Championship 23rd','Moscow','1-0',[7,17,23,28,31]],
['keres-botvinnik-1948-g5','Keres','Keres, Paul','Botvinnik, Mikhail','1948.??.??','5',1948,'World Championship 18th','Netherlands / USSR','0-1',[6,14,23,31,39]],
['fischer-spassky-1972-g6','Fischer','Fischer, Robert James','Spassky, Boris V','1972.??.??','6',1972,'World Championship 28th','Reykjavik','1-0',[11,17,24,30,37]],
['capablanca-marshall-1909-g12','Capablanca','Capablanca, Jose Raul','Marshall, Frank James','1909.??.??','12',1909,'US Championship Match','New York','1-0',[5,11,18,26,35]],
['capablanca-tartakower-1924','Capablanca','Capablanca, Jose Raul','Tartakower, Saviely','1924.??.??','?',1924,'New York','New York','1-0',[10,16,22,28,34]],
['carlsen-karjakin-2016-g10','Carlsen','Carlsen,M','Karjakin,Sergey','2016.11.24','10',2016,'World Championship 2016','New York','1-0',[6,14,22,31,38]],
['carlsen-nepomniachtchi-2021-g6','Carlsen','Carlsen,M','Nepomniachtchi,I','2021.12.03','6',2021,'World Championship 2021','Dubai','1-0',[5,14,22,30,36]],
['fischer-petrosian-1959-g2','Fischer','Fischer, Robert James','Petrosian, Tigran V','1959.??.??','2',1959,'Candidates Tournament','Bled / Zagreb / Belgrade','0-1',[5,12,20,29,38]],
['capablanca-alekhine-1927-g1','Capablanca','Capablanca, Jose Raul','Alekhine, Alexander','1927.??.??','1',1927,'World Championship 13th','Buenos Aires','0-1',[4,10,17,25,34]],
['capablanca-alekhine-1927-g3','Capablanca','Capablanca, Jose Raul','Alekhine, Alexander','1927.??.??','3',1927,'World Championship 13th','Buenos Aires','1-0',[8,14,20,27,35]],
['kasparov-karpov-1985-g1','Kasparov','Kasparov, Gary','Karpov, Anatoly','1985.??.??','1',1985,'World Championship 32nd','Moscow','1-0',[5,10,16,22,27]],
['morphy-opera-1858','Morphy','Morphy, Paul','Duke Karl Count Isouard','1858.??.??','?',1858,'Paris Opera','Paris','1-0',[6,9,15,16,17]],
];

function headers(text) {
  return Object.fromEntries([...text.matchAll(/^\[([A-Za-z]+) "([^"]*)"/gm)].map(m => [m[1], m[2].trim()]));
}
function movesOnly(text) {
  return text.replace(/\[[^\n]*\]/g, '').replace(/\{[^]*?\}/gs, '').replace(/;[^\n]*/g, '').replace(/\$\d+/g, '').trim();
}
function displayName(raw) {
  const known = {
    'Kasparov, Gary': 'Garry Kasparov', 'Topalov, Veselin': 'Veselin Topalov',
    'Anand, Viswanathan': 'Viswanathan Anand', 'Alekhine, Alexander': 'Alexander Alekhine',
    'Euwe, Max': 'Max Euwe', 'Tal, Mihail': 'Mikhail Tal', 'Botvinnik, Mikhail': 'Mikhail Botvinnik',
    'Keres, Paul': 'Paul Keres', 'Fischer, Robert James': 'Robert James Fischer',
    'Spassky, Boris V': 'Boris Spassky', 'Capablanca, Jose Raul': 'José Raúl Capablanca',
    'Marshall, Frank James': 'Frank James Marshall', 'Tartakower, Saviely': 'Saviely Tartakower',
    'Carlsen,M': 'Magnus Carlsen', 'Karjakin,Sergey': 'Sergey Karjakin',
    'Nepomniachtchi,I': 'Ian Nepomniachtchi', 'Petrosian, Tigran V': 'Tigran Petrosian',
    'Karpov, Anatoly': 'Anatoly Karpov', 'Morphy, Paul': 'Paul Morphy',
    'Duke Karl Count Isouard': 'Duke Karl / Count Isouard',
  };
  return known[raw] || raw.replace(/^\s*(\S+),\s*(.+)$/, '$2 $1');
}
for (const row of S) {
  const [id, archive, whiteRaw, blackRaw, date, round, year, event, site, result, pauseMoves] = row;
  const file = path.join(root, archive, `${archive}.pgn`);
  const corpus = fs.readFileSync(file, 'utf8');
  const candidates = corpus.split(/\n(?=\[Event )/).filter(g => {
    const h = headers(g);
    return h.Date === date && h.Round === round && h.White === whiteRaw && h.Black === blackRaw && h.Result === result;
  }).map(movesOnly);
  if (candidates.length !== 1) throw new Error(`${id}: expected one source game, found ${candidates.length}`);
  const sourcePgn = candidates[0];
  const chess = new Chess();
  chess.loadPgn(sourcePgn);
  const history = chess.history({ verbose: true });
  const maxMove = Math.ceil(history.length / 2);
  const annotations = pauseMoves.filter(n => n <= maxMove).map(n => {
    const move = history[(n - 1) * 2];
    return { moveNumber: n, comment: `Study this decision: ${move.color === 'w' ? 'White plays' : 'Black plays'} ${move.san}. Pause and compare piece activity, king safety, and available plans before continuing.` };
  });
  const game = {
    id, white: displayName(whiteRaw), black: displayName(blackRaw), event, year, result,
    pgn: movesOnly(sourcePgn), annotations,
    source: `https://www.pgnmentor.com/players/${archive}.zip`,
  };
  fs.writeFileSync(path.join(out, `${id}.json`), `${JSON.stringify(game, null, 2)}\n`);
  console.log(`${id}: ${history.length} plies, ${annotations.length} annotations`);
}
console.log(`Seeded ${S.length} verified games in ${out}`);

