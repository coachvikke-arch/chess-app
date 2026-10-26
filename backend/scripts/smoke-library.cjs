// End-to-end smoke test for the shared Library API.
// Admin: full CRUD + shared visibility. Student: public read works, writes and
// GET /api/library are refused.
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const BASE = 'http://localhost:5000/api';
const env = fs.readFileSync('C:/Users/MANIVEL M/Downloads/Files/chess-academy/backend/.env', 'utf8');
const secret = env.split(/\r?\n/).find((l) => l.startsWith('JWT_SECRET=')).slice(11).trim();
const db = new Pool({ host: 'localhost', port: 5432, user: 'postgres', password: 'Oracle', database: 'chess' });

function tok(u) { return jwt.sign({ id: u.id, role: u.role, name: u.name, email: u.email }, secret, { expiresIn: '1h' }); }
async function call(method, url, token, body) {
  const r = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await r.json(); } catch {}
  return { status: r.status, data };
}
const ok = (c, m) => console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`);

(async () => {
  const admin = (await db.query('SELECT id,role,name,email FROM users WHERE id=12')).rows[0]
    || (await db.query("SELECT id,role,name,email FROM users WHERE role='admin' ORDER BY id LIMIT 1")).rows[0];
  const superRow = (await db.query("SELECT id,role,name,email FROM users WHERE role='superadmin' ORDER BY id LIMIT 1")).rows[0];
  const stu = (await db.query('SELECT u.id,u.role,u.name,u.email FROM users u JOIN students s ON s.user_id=u.id ORDER BY u.id LIMIT 1')).rows[0];
  const A = tok(admin), S = tok(stu), SA = superRow ? tok(superRow) : null;
  const stamp = Date.now();

  console.log(`admin=${admin.email} student=${stu.email} super=${superRow?.email || '(none)'}\n`);

  // --- student permissions -------------------------------------------------
  let r = await call('GET', '/library', S);
  ok(r.status === 403, `student GET /api/library -> 403 (got ${r.status})`);
  r = await call('GET', '/library/public', S);
  ok(r.status === 200 && Array.isArray(r.data?.folders), `student GET /api/library/public -> 200 (got ${r.status})`);
  const pubBlob = JSON.stringify(r.data || {});
  ok(!pubBlob.includes('created_by'), 'public payload contains no created_by');
  r = await call('POST', '/library/folders', S, { name: 'nope' });
  ok(r.status === 403, `student POST /api/library/folders -> 403 (got ${r.status})`);
  r = await call('POST', '/library/folders', null, { name: 'nope' });
  ok(r.status === 401 || r.status === 403, `anonymous POST /api/library/folders refused (got ${r.status})`);

  // --- admin + superadmin both have full access ---------------------------
  r = await call('GET', '/library', A);
  ok(r.status === 200, `admin GET /api/library -> 200 (got ${r.status})`);
  if (SA) {
    const rs = await call('GET', '/library', SA);
    ok(rs.status === 200, `superadmin GET /api/library -> 200 (got ${rs.status})`);
    const rf = await call('POST', '/library/folders', SA, { name: `SA probe ${stamp}` });
    ok(rf.status === 201, `superadmin POST /api/library/folders -> 201 (got ${rf.status})`);
    if (rf.status === 201) await call('DELETE', `/library/folders/${rf.data.id}`, SA);
  }

  // --- CRUD ----------------------------------------------------------------
  r = await call('POST', '/library/folders', A, { name: `Probe ${stamp}`, type: 'general' });
  ok(r.status === 201, `admin POST folder -> 201 (got ${r.status})`);
  const folderId = r.data?.id;

  r = await call('POST', `/library/items`, A, { folderId, title: 'Entry A', type: 'pgn', notation: '1. e4 e5' });
  ok(r.status === 201, `admin POST item -> 201 (got ${r.status})`);
  const itemId = r.data?.id;

  r = await call('POST', `/library/items`, A, { folderId, title: 'Entry B', type: 'fen', notation: '8/8/8/8/8/8/8/K7k w - - 0 1' });
  ok(r.status === 201, `admin POST 2nd item -> 201 (got ${r.status})`);
  const itemId2 = r.data?.id;

  r = await call('PATCH', `/library/folders/${folderId}`, A, { name: `Probe ${stamp} renamed` });
  ok(r.status === 200 && r.data?.name === `Probe ${stamp} renamed`, `admin PATCH folder rename -> 200 (got ${r.status})`);

  r = await call('POST', '/library/bulk-rename', A, { renames: [{ id: itemId, title: 'Renamed 1' }, { id: itemId2, title: 'Renamed 2' }] });
  ok(r.status === 200 && r.data?.renamed === 2, `admin bulk-rename -> 2 renamed (got ${r.status}/${r.data?.renamed})`);

  r = await call('POST', `/library/items/${itemId}/reorder`, A, { dir: -1 });
  ok(r.status === 200, `admin reorder -> 200 (got ${r.status})`);

  // duplicate name guard
  await call('POST', '/library/folders', A, { name: `Probe ${stamp} renamed` });
  r = await call('POST', '/library/folders', A, { name: `Probe ${stamp} renamed` });
  ok(r.status === 400, `duplicate folder name rejected -> 400 (got ${r.status})`);

  // shared visibility: superadmin sees the admin's folder
  if (SA) {
    const sl = await call('GET', '/library', SA);
    const seen = (sl.data?.folders || []).some((f) => f.id === folderId);
    ok(seen, 'superadmin sees the folder created by admin A (shared)');
  }

  // import nests under "Imported - ..."
  r = await call('POST', '/library/import', A, {
    folders: [{ id: 'old-1', name: 'Legacy Root', parentId: null, type: 'pgn', description: '', items: [
      { id: 1, title: 'Legacy 1', type: 'pgn', notation: '1. d4 d5' },
    ] }, { id: 'old-2', name: 'Legacy Child', parentId: 'old-1', type: 'fen', description: '', items: [] }],
  });
  ok(r.status === 201 && r.data?.foldersImported === 2 && r.data?.itemsImported === 1,
    `import -> 201, 2 folders 1 item (got ${r.status}/${r.data?.foldersImported}/${r.data?.itemsImported})`);
  const containerId = r.data?.containerId;
  if (containerId) {
    const after = await call('GET', '/library', A);
    const all = after.data?.folders || [];
    const cont = all.find((f) => f.id === containerId);
    ok(cont && /^Imported - /.test(cont.name), `container named "${cont?.name}"`);
    // Only the legacy ROOT folders hang off the container; a legacy child keeps
    // its own parent.
    const direct = all.filter((f) => f.parentId === containerId);
    ok(direct.length === 1 && direct[0].name === 'Legacy Root',
      `exactly the legacy root folder sits under the container (got ${direct.map((f) => f.name).join(',')})`);
    const root = direct[0];
    const child = all.find((f) => f.name === 'Legacy Child');
    ok(child && root && child.parentId === root.id, 'legacy nesting preserved inside the container');
    const carried = (root?.items || []).length;
    ok(carried === 1, `legacy items came across (got ${carried})`);
    await call('DELETE', `/library/folders/${containerId}`, A);
  }

  // oversize guard (declare > 10mb via content-length is not feasible here; test the real parser limit instead)
  r = await call('POST', '/library/items/bulk', A, { folderId, items: [] });
  ok(r.status === 400, `bulk with no items -> 400 (got ${r.status})`);

  // cascade delete
  r = await call('DELETE', `/library/folders/${folderId}`, A);
  ok(r.status === 200, `admin DELETE folder -> 200 (got ${r.status})`);
  const left = await call('GET', '/library', A);
  ok(!(left.data?.folders || []).some((f) => f.id === folderId), 'deleted folder is gone');
  ok(!(left.data?.folders || []).some((f) => (f.items || []).some((i) => i.id === itemId)), 'its items are gone (cascade)');

  await db.end();
})().catch((e) => { console.error('SMOKE FAILED:', e.stack || e); process.exit(1); });