import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

/* listClasses is exercised against a stubbed pg client, so the SQL text and the
 * parameter numbering are checked without touching any database. */
const require = createRequire(import.meta.url);

const DB_PATH = require.resolve('../src/config/database');
const CONTROLLER = '../src/controllers/classController';
const COUNT_RE = /SELECT COUNT\(\*\)::int AS total/;

function withStubs(fn) {
  const queries = [];
  require.cache[DB_PATH] = {
    id: DB_PATH,
    filename: DB_PATH,
    loaded: true,
    exports: {
      query: async (sql, params = []) => {
        queries.push({ sql: sql.replace(/\s+/g, ' '), params });
        if (COUNT_RE.test(sql)) return { rows: [{ total: 7 }] };
        return { rows: [] };
      },
    },
  };

  const resolved = require.resolve(CONTROLLER);
  delete require.cache[resolved];
  const mod = require(CONTROLLER);

  try {
    return fn({ mod, queries });
  } finally {
    delete require.cache[DB_PATH];
    delete require.cache[resolved];
  }
}

function res() {
  const out = { statusCode: 200, body: null };
  out.status = (code) => { out.statusCode = code; return out; };
  out.json = (payload) => { out.body = payload; return out; };
  return out;
}

async function list(query, role = 'admin') {
  return withStubs(async ({ mod, queries }) => {
    const r = res();
    await mod.listClasses({ user: { id: 3, role }, query }, r);
    return { body: r.body, statusCode: r.statusCode, queries };
  });
}

test('the Classes tab asks the server to leave completed out', async () => {
  const { queries, statusCode } = await list({ page: '1', limit: '10', exclude_status: 'completed' });
  const [count, page] = queries;

  assert.equal(statusCode, 200);
  assert.equal(queries.length, 2);
  assert.match(count.sql, /cl\.status <> \$1/);
  assert.match(page.sql, /cl\.status <> \$1/);
  assert.deepEqual(count.params, ['completed']);
  assert.deepEqual(page.params, ['completed', 10, 0]);
});

test('a caller that sends nothing gets the list it always got', async () => {
  const { queries } = await list({ page: '1', limit: '10' });

  for (const { sql, params } of queries) {
    assert.doesNotMatch(sql, /cl\.status <>/);
    assert.ok(!params.includes('completed'));
  }
});

test('blank and junk exclude values are dropped, not bound', async () => {
  const { queries } = await list({ page: '1', limit: '10', exclude_status: '   ' });

  assert.equal(queries.length, 2);
  assert.doesNotMatch(queries[0].sql, /cl\.status <>/);
  assert.deepEqual(queries[1].params, [10, 0]);
});

test('status and exclude_status are both bound, in their own slots', async () => {
  const { queries } = await list({ page: '1', limit: '10', status: 'completed', exclude_status: 'cancelled' });
  const [, page] = queries;

  assert.match(page.sql, /cl\.status = \$1/);
  assert.match(page.sql, /cl\.status <> \$2/);
  assert.deepEqual(page.params, ['completed', 'cancelled', 10, 0]);
});

test('the student scope stays ahead of the filter in the parameter order', async () => {
  const { queries } = await list({ page: '1', limit: '10', exclude_status: 'completed' }, 'student');
  const [count, page] = queries;

  assert.match(count.sql, /JOIN students st ON st\.user_id = \$1/);
  assert.match(page.sql, /cl\.status <> \$2/);
  assert.deepEqual(count.params, [3, 'completed']);
  assert.deepEqual(page.params, [3, 'completed', 10, 0]);
});
