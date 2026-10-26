const http = require('http');
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { Pool } = require('pg');

function httpRequest(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, body: parsed, raw: data });
        } catch (e) {
          resolve({ status: res.statusCode, body: data, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function baseOpts(method, path, token = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return {
    hostname: 'localhost',
    port: 5000,
    path,
    method,
    headers,
  };
}

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'Oracle',
  database: process.env.DB_NAME || 'chess',
});

async function registerOrLogin(name, email, role, password = 'Test123!') {
  let r = await httpRequest(
    baseOpts('POST', '/api/auth/register'),
    { name, email, password, role }
  );
  if (r.status === 201) return { token: r.body.token, user: r.body.user };
  if (r.status === 409) {
    r = await httpRequest(
      baseOpts('POST', '/api/auth/login'),
      { email, password }
    );
    if (r.status === 200) return { token: r.body.token, user: r.body.user };
  }
  throw new Error(`Cannot auth ${email}: ${r.status} ${JSON.stringify(r.body)}`);
}

async function curlHealth() {
  const r = await httpRequest(baseOpts('GET', '/api/health'));
  console.log('TEST /api/health:', r.status, JSON.stringify(r.body));
  return r.status === 200;
}

async function curlCreateClassIntegrated(adminToken, opts = {}) {
  const today = new Date().toISOString().split('T')[0];
  const body = {
    title: opts.title || 'Test Integrated Class',
    description: 'Created by test script',
    topic: opts.topic || 'Openings',
    classDate: opts.classDate || today,
    startTime: opts.startTime || '10:00:00',
    endTime: opts.endTime || '11:00:00',
    groupId: opts.groupId ?? null,
    classType: 'integrated',
    studentInteractionEnabled: opts.studentInteractionEnabled ?? false,
    studentIds: opts.studentIds || [],
  };
  const r = await httpRequest(baseOpts('POST', '/api/classes', adminToken), body);
  console.log(`\nTEST POST /api/classes (integrated):`);
  console.log('  STATUS:', r.status);
  console.log('  BODY:', JSON.stringify(r.body).slice(0, 500));
  if (r.status === 201) {
    console.log('  ASSERT: class_type =', r.body.class_type, '(expect integrated) |', r.body.class_type === 'integrated' ? 'PASS' : 'FAIL');
    console.log('  ASSERT: is_online =', r.body.is_online, '(expect true) |', r.body.is_online === true ? 'PASS' : 'FAIL');
    console.log('  ASSERT: status =', r.body.status, '(expect scheduled) |', r.body.status === 'scheduled' ? 'PASS' : 'FAIL');
    console.log('  ASSERT: student_interaction_enabled =', r.body.student_interaction_enabled, '|', r.body.student_interaction_enabled === (opts.studentInteractionEnabled ?? false) ? 'PASS' : 'FAIL');
  }
  return r;
}

async function curlStartClass(adminToken, classId) {
  const r = await httpRequest(baseOpts('POST', `/api/classes/${classId}/start`, adminToken));
  console.log(`\nTEST POST /api/classes/${classId}/start:`);
  console.log('  STATUS:', r.status);
  console.log('  BODY:', JSON.stringify(r.body).slice(0, 500));
  if (r.status === 200) {
    console.log('  ASSERT: status =', r.body.status, '(expect live) |', r.body.status === 'live' ? 'PASS' : 'FAIL');
    console.log('  ASSERT: started_at non-null =', !!r.body.started_at, '|', !!r.body.started_at ? 'PASS' : 'FAIL');

    const gs = await pool.query('SELECT * FROM chess_game_states WHERE live_class_id = $1', [classId]);
    const rowExists = gs.rows.length > 0;
    const startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const correctFen = rowExists && gs.rows[0].fen === startFen;
    console.log('  ASSERT: chess_game_states row exists =', rowExists, '|', rowExists ? 'PASS' : 'FAIL');
    console.log('  ASSERT: FEN =', rowExists ? gs.rows[0].fen?.slice(0, 40) + '...' : 'n/a', '| matches start position?', correctFen ? 'PASS' : 'FAIL');
    console.log('  ASSERT: current_turn =', rowExists ? gs.rows[0].current_turn : 'n/a', '(expect w) |', (rowExists && gs.rows[0].current_turn === 'w') ? 'PASS' : 'FAIL');
  }
  return r;
}

async function curlGetJoinToken(token, classId, roleLabel) {
  const r = await httpRequest(baseOpts('GET', `/api/classes/${classId}/join-token`, token));
  console.log(`\nTEST GET /api/classes/${classId}/join-token (${roleLabel}):`);
  console.log('  STATUS:', r.status);

  if (r.status === 200) {
    console.log('  BODY (abbreviated):');
    console.log('    ok =', r.body.ok);
    console.log('    isInstructor =', r.body.isInstructor);
    console.log('    classMeta.status =', r.body.classMeta?.status);
    console.log('    has livekitUrl =', !!r.body.video?.livekitUrl);
    console.log('    has token (non-empty) =', typeof r.body.video?.token === 'string' && r.body.video.token.length > 20);
    console.log('    fen first 30 =', r.body.chessState?.fen?.slice(0, 30));
    console.log('    moves array present =', Array.isArray(r.body.chessState?.moves));
    console.log('    participants is array =', Array.isArray(r.body.participants));
    console.log('    chatMessages is array =', Array.isArray(r.body.chatMessages));
    console.log('    permissions.canModerate =', r.body.permissions?.canModerate);
  } else if (r.status === 400 || r.status === 403) {
    console.log('  EXPECTED ERROR STATUS:', r.status);
    console.log('  MESSAGE:', r.body.message || JSON.stringify(r.body));
  } else {
    console.log('  BODY:', JSON.stringify(r.body).slice(0, 600));
  }
  return r;
}

async function runAll() {
  console.log('=========== LIVE CLASSES BACKEND CURL TESTS ===========\n');

  try {
    const healthOk = await curlHealth();
    if (!healthOk) {
      console.log('Health failed, aborting.');
      return;
    }

    console.log('\n--- Creating test users ---');
    const admin = await registerOrLogin('LiveAdmin', 'liveadmin@test.com', 'admin');
    console.log('Admin user OK:', admin.user.id, admin.user.role);

    const memberStudent = await registerOrLogin('MemberStudent', 'member@test.com', 'student');
    console.log('Member student OK:', memberStudent.user.id, memberStudent.user.role);

    const outsiderStudent = await registerOrLogin('OutsiderStudent', 'outsider@test.com', 'student');
    console.log('Outsider student OK:', outsiderStudent.user.id, outsiderStudent.user.role);

    const outsiderStudentIdRes = await pool.query('SELECT id FROM students WHERE user_id = $1', [outsiderStudent.user.id]);
    const outsiderStudentDbId = outsiderStudentIdRes.rows[0]?.id;
    console.log('Outsider student DB (students.id):', outsiderStudentDbId);

    const memberStudentIdRes = await pool.query('SELECT id FROM students WHERE user_id = $1', [memberStudent.user.id]);
    const memberStudentDbId = memberStudentIdRes.rows[0]?.id;
    console.log('Member student DB (students.id):', memberStudentDbId);

    console.log('\n=== TEST TR-4.1: Create Integrated Class (with explicit members, NOT including outsider) ===');
    const createResp = await curlCreateClassIntegrated(admin.token, {
      title: 'TR-4.1 Integrated Class - Explicit Members',
      topic: 'Tactics',
      studentIds: memberStudentDbId ? [memberStudentDbId] : [],
      studentInteractionEnabled: true,
    });
    const classId = createResp.body?.id;
    if (!classId) {
      console.log('NO CLASS ID - ABORTING');
      return;
    }

    console.log('\n=== TEST TR-4.2: Start Class + verify chess_game_states row ===');
    await curlStartClass(admin.token, classId);

    console.log('\n=== TEST TR-4.3: join-token as NON-MEMBER (Outsider) student ===');
    console.log('EXPECT: 403 Forbidden');
    const outsiderResp = await curlGetJoinToken(outsiderStudent.token, classId, 'OUTSIDER student (expect 403)');
    console.log('ASSERT status 403:', outsiderResp.status === 403 ? 'PASS' : `FAIL (got ${outsiderResp.status})`);

    console.log('\n=== TEST join-token as MEMBER student (should auth pass) ===');
    const memberResp = await curlGetJoinToken(memberStudent.token, classId, 'MEMBER student');
    if (memberResp.status === 200) {
      console.log('ASSERT isInstructor = false:', memberResp.body.isInstructor === false ? 'PASS' : 'FAIL');
    } else if (memberResp.status === 500 && memberResp.body.error?.includes('LiveKit credentials')) {
      console.log('NOTE: Authorization passed, LiveKit credentials missing in .env (this is OK for test env)');
      console.log('  Error confirms auth check passed before token minting attempt.');
    } else {
      console.log('UNEXPECTED:', memberResp.status, memberResp.body);
    }

    console.log('\n=== TEST join-token as ADMIN (instructor) ===');
    const adminJoinResp = await curlGetJoinToken(admin.token, classId, 'ADMIN');
    if (adminJoinResp.status === 200) {
      console.log('ASSERT isInstructor = true:', adminJoinResp.body.isInstructor === true ? 'PASS' : 'FAIL');
      console.log('ASSERT permissions.canModerate = true:', adminJoinResp.body.permissions?.canModerate === true ? 'PASS' : 'FAIL');
    } else if (adminJoinResp.status === 500 && adminJoinResp.body.error?.includes('LiveKit credentials')) {
      console.log('NOTE: Auth check passed, LiveKit missing in .env (expected in test env).');
    } else {
      console.log('UNEXPECTED:', adminJoinResp.status, adminJoinResp.body);
    }

    console.log('\n=== Extra: verify participants and chat endpoints ===');
    const parts = await httpRequest(baseOpts('GET', `/api/classes/${classId}/participants`, admin.token));
    console.log('GET participants status:', parts.status, '| count:', Array.isArray(parts.body) ? parts.body.length : 'n/a');

    const chat = await httpRequest(baseOpts('GET', `/api/classes/${classId}/chat`, admin.token));
    console.log('GET chat status:', chat.status, '| count:', Array.isArray(chat.body) ? chat.body.length : 'n/a');

    const clearChat = await httpRequest(baseOpts('POST', `/api/classes/${classId}/chat/clear`, admin.token));
    console.log('POST chat/clear status:', clearChat.status, JSON.stringify(clearChat.body));

    console.log('\n=== TR-4.6: End Class ===');
    const endResp = await httpRequest(baseOpts('POST', `/api/classes/${classId}/end`, admin.token));
    console.log('POST /end status:', endResp.status);
    if (endResp.status === 200) {
      console.log('  ended_at non-null:', !!endResp.body.ended_at);
      console.log('  status =', endResp.body.status);
    }

    console.log('\n=========== TESTS FINISHED ===========');
  } catch (e) {
    console.error('TEST ERROR:', e);
  } finally {
    await pool.end();
  }
}

runAll();
