/* E2E: spectate — computer-session broadcast + online PvP spectate payload */
const io = require('C:/Users/MANIVEL M/Downloads/Files/chess-academy/frontend/node_modules/socket.io-client');

const API = 'http://localhost:5000';
const results = [];
function check(name, cond, extra) {
  results.push({ name, ok: !!cond, extra: extra || '' });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  :: ' + extra : ''}`);
}

async function api(method, path, token, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

async function login(email, password) {
  const r = await api('POST', '/api/auth/login', null, { email, password });
  if (!r.data || !r.data.token) throw new Error(`login failed ${email}: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}

function connect(token) {
  return new Promise((resolve, reject) => {
    const s = io(API, { path: '/socket.io', transports: ['websocket'], auth: { token } });
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
    setTimeout(() => reject(new Error('socket connect timeout')), 5000);
  });
}
const emitAck = (s, ev, payload) => new Promise((resolve) => s.emit(ev, payload, (a) => resolve(a)));
const once = (s, ev) => new Promise((resolve) => s.once(ev, resolve));
const timeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

(async () => {
  const admin = await login('liveadmin@test.com', 'Test123!');
  const student = await login('arrowstudent@test.com', 'Test123!');
  console.log('admin id', admin.user?.id, '| student id', student.user?.id);

  /* 1. computer session: register (student socket) → visible in list → join (admin socket) → update → end */
  const sStudent = await connect(student.token);
  const specKey = 'C-' + (student.user.id || 33) + '-' + Date.now();
  const regAck = await emitAck(sStudent, 'spec:register', {
    key: specKey,
    whiteId: student.user.id,
    blackId: null,
    whiteName: student.user.name,
    blackName: 'Computer',
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    pgn: '',
    whiteMs: 300000, blackMs: 300000, turn: 'white',
    status: 'active', level: 'Level 5 · Beginner 800-1000',
    baseMinutes: 5, incrementSeconds: 0,
  });
  check('spec:register ack ok', regAck && regAck.ok, JSON.stringify(regAck));

  const live1 = await api('GET', '/api/online/live', admin.token);
  const inList1 = live1.data.some((s) => s.key === specKey);
  check('GET /api/online/live lists computer session', inList1, `count=${live1.data.length}`);
  const listed = live1.data.find((s) => s.key === specKey);
  if (listed) {
    check('session whiteId blackId', listed.whiteId === student.user.id && listed.blackId === null);
    check('session names', listed.whiteName === student.user.name && listed.blackName === 'Computer');
  }

  const sAdmin = await connect(admin.token);
  const joinAck = await emitAck(sAdmin, 'join-spec', specKey);
  check('join-spec ack ok + matches', joinAck && joinAck.ok && joinAck.session && joinAck.session.key === specKey, JSON.stringify(joinAck));

  const updPromise = timeout(once(sAdmin, 'spec-update'), 4000);
  const updAck = await emitAck(sStudent, 'spec:update', {
    key: specKey, fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 3',
    pgn: '1. e4 e5 2. Nf3 Nc6', whiteMs: 290500, blackMs: 272000, turn: 'white', status: 'active',
  });
  check('spec:update ack ok', updAck && updAck.ok);
  const updEvent = await updPromise;
  check('admin receives spec-update broadcast', updEvent.key === specKey && updEvent.session.whiteMs === 290500, `whiteMs=${updEvent.session?.whiteMs}`);

  const endPromise = timeout(once(sAdmin, 'spec-end'), 4000);
  const endAck = await emitAck(sStudent, 'spec:end', specKey);
  check('spec:end ack ok', endAck && endAck.ok);
  const endEvent = await endPromise;
  check('admin receives spec-end broadcast', endEvent.key === specKey);

  const live2 = await api('GET', '/api/online/live', admin.token);
  check('computer session removed after end', !live2.data.some((s) => s.key === specKey));

  /* 2. online PvP spectate: create pending → spectate blocked → accept → spectate ok + broadcast forSpectator */
  const g = await api('POST', '/api/online/games', admin.token, {
    studentId: student.user.id, adminColor: 'white', timeControl: { baseMinutes: 5, incrementSeconds: 2 },
  });
  check('create p2p game (pending)', g.status === 201, `id=${g.data?.id}`);
  const gameId = g.data.id;

  const spBlocked = await api('GET', `/api/online/games/${gameId}/spectate`, admin.token);
  check('spectate pending game blocked (400)', spBlocked.status === 400);

  const acc = await api('POST', `/api/online/games/${gameId}/accept`, student.token);
  check('opponent accepts → active', acc.data?.status === 'active');

  const sp = await api('GET', `/api/online/games/${gameId}/spectate`, admin.token);
  check('spectate active game ok', sp.status === 200 && sp.data.gameId === gameId);
  check('neutral payload white/black', sp.data.whiteId === admin.user.id && sp.data.blackId === student.user.id && sp.data.whiteName !== '' && sp.data.blackName !== '');
  check('neutral payload live fields', !!sp.data.clock && typeof sp.data.serverNow === 'number');

  const live3 = await api('GET', '/api/online/live', admin.token);
  check('live list includes active p2p game', live3.data.some((s) => s.type === 'online' && s.gameId === gameId));

  /* socket game-update carries forSpectator — register listener on admin BEFORE move */
  const specUpdate2 = timeout(once(sAdmin, 'game-update'), 4000);
  sStudent.emit('join-game', gameId);
  const mv = await api('POST', `/api/online/games/${gameId}/move`, admin.token, { from: 'e2', to: 'e4' });
  check('white move applied', mv.status === 200);
  const gu = await specUpdate2;
  check('game-update includes forSpectator with move', gu.forSpectator && gu.forSpectator.gameId === gameId && gu.forSpectator.pgn.includes('e4'), `pgn=${gu.forSpectator?.pgn}`);

  /* cleanup the p2p game */
  await api('POST', `/api/online/games/${gameId}/resign`, student.token);
  await api('POST', `/api/online/games/${gameId}/end`, student.token);

  sStudent.close(); sAdmin.close();

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('E2E ERROR:', e.message); process.exit(1); });