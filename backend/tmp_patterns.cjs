'use strict';

require('dotenv').config();
const { Client } = require('pg');
const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

const patterns = [
  {
    label: 'customFenOrSetUp',
    sql: `
      select id, pgn from chess_games where pgn <> ''
        and (pgn ilike '%[SetUp%' or pgn ilike '%[FEN%')
      order by random() limit 8
    `,
  },
  {
    label: 'commentsVariations',
    sql: `
      select id, pgn from chess_games where pgn <> ''
        and (pgn ilike '%[{%' or pgn ilike '%{%')
      order by random() limit 8
    `,
  },
  {
    label: 'noResultHeader',
    sql: `
      select id, pgn from chess_games where pgn <> ''
        and position('[Result' in pgn) = 0
      order by random() limit 8
    `,
  },
  {
    label: 'headerlessMovetext',
    sql: `
      select id, pgn from chess_games where pgn <> ''
        and position('[Event' in pgn) = 0
        and position('1. ' in pgn) > 0
      order by random() limit 8
    `,
  },
  {
    label: 'multiWordHeader',
    sql: `
      select id, pgn from chess_games where pgn <> ''
        and position('[Opening' in pgn) > 0
        and pgn like '%Game:%'
      order by random() limit 8
    `,
  },
];

let row = 1;
for (const p of patterns) {
  console.log('\n===== ' + p.label + ' =====');
  const res = await db.query(p.sql);
  for (const r of res.rows) {
    console.log('--- id ' + r.id + ' ---');
    console.log(r.pgn.substring(0, 400));
  }
}
await db.end();
