const http = require('http');

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

function baseOpts(method, path, token = null, contentType = 'application/json') {
  const headers = { 'Content-Type': contentType };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return {
    hostname: 'localhost',
    port: 5000,
    path,
    method,
    headers,
  };
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runTests() {
  console.log('=== Live Classes Backend Tests ===\n');

  let adminToken, studentToken, adminUser, studentUser;
  try {
    const reg1 = await httpRequest(
      baseOpts('POST', '/api/auth/register'),
      { name: 'LiveAdmin', email: 'liveadmin@test.com', phone: null, password: 'Test123!', role: 'admin' }
    );
    console.log('[1] Register admin:', reg1.status, JSON.stringify(reg1.body).slice(0, 200));
    if (reg1.status === 201) {
      adminToken = reg1.body.token;
      adminUser = reg1.body.user;
    } else if (reg1.status === 409) {
      const login = await httpRequest(
        baseOpts('POST', '/api/auth/login'),
        { email: 'liveadmin@test.com', password: 'Test123!' }
      );
      console.log('[1b] Login admin:', login.status, JSON.stringify(login.body).slice(0, 200));
      adminToken = login.body.token;
      adminUser = login.body.user;
    }
  } catch (e) {
    console.error('[1] Error:', e.message);
  }

  if (!adminToken) {
    console.log('Cannot proceed without admin token');
    return;
  }

  try {
    const reg2 = await httpRequest(
      baseOpts('POST', '/api/auth/register'),
      { name: 'OutsiderStudent', email: 'outsider@test.com', phone: null, password: 'Test123!', role: 'student' }
    );
    console.log('\n[2] Register non-member student:', reg2.status, JSON.stringify(reg2.body).slice(0, 200));
    if (reg2.status === 201) {
      studentToken = reg2.body.token;
      studentUser = reg2.body.user;
    } else if (reg2.status === 409) {
      const login = await httpRequest(
        baseOpts('POST', '/api/auth/login'),
        { email: 'outsider@test.com', password: 'Test123!' }
      );
      console.log('[2b] Login non-member student:', login.status, JSON.stringify(login.body).slice(0, 200));
      studentToken = login.body.token;
      studentUser = login.body.user;
    }
  } catch (e) {
    console.error('[2] Error:', e.message);
  }

  let classId;
  try {
    const today = new Date().toISOString().split('T')[0];
    const create = await httpRequest(
      baseOpts('POST', '/api/classes', adminToken),
      {
        title: 'Test Integrated Live Class',
        description: 'A class created by the test script',
        topic: 'Chess Openings',
        classDate: today,
        startTime: '10:00:00',
        endTime: '11:00:00',
        groupId: null,
        classType: 'integrated',
        status: 'scheduled',
        thumbnail: null,
        studentInteractionEnabled: true,
        studentIds: [],
      }
    );
    console.log('\n[3] POST /api/classes (integrated type):', create.status, JSON.stringify(create.body).slice(0, 400));
    if (create.status === 201) {
      classId = create.body.id;
      console.log('   class_type =', create.body.class_type, '| status =', create.body.status, '| is_online =', create.body.is_online);
    }
  } catch (e) {
    console.error('[3] Error:', e.message);
  }

  if (!classId) {
    console.log('\nCannot proceed without class id');
    return;
  }

  try {
    const start = await httpRequest(
      baseOpts('POST', `/api/classes/${classId}/start`, adminToken)
    );
    console.log('\n[4] POST /api/classes/:id/start:', start.status, JSON.stringify(start.body).slice(0, 400));

    const { Pool } = require('pg');
    const pool = new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'Oracle',
      database: process.env.DB_NAME || 'chess',
    });
    const gs = await pool.query('SELECT * FROM chess_game_states WHERE live_class_id = $1', [classId]);
    console.log('   chess_game_states row exists:', gs.rows.length > 0);
    if (gs.rows.length > 0) {
      console.log('   FEN:', gs.rows[0].fen);
      console.log('   current_turn:', gs.rows[0].current_turn);
    }
    await pool.end();
  } catch (e) {
    console.error('[4] Error:', e.message);
  }

  try {
    const adminJoin = await httpRequest(
      baseOpts('GET', `/api/classes/${classId}/join-token`, adminToken)
    );
    console.log('\n[5] GET /api/classes/:id/join-token (ADMIN):', adminJoin.status);
    if (adminJoin.status === 200) {
      console.log('   ok =', adminJoin.body.ok);
      console.log('   isInstructor =', adminJoin.body.isInstructor);
      console.log('   has token =', !!adminJoin.body.video?.token);
      console.log('   livekitUrl =', adminJoin.body.video?.livekitUrl);
      console.log('   fen =', adminJoin.body.chessState?.fen?.slice(0, 40) + '...');
      console.log('   moves.length =', adminJoin.body.chessState?.moves?.length);
      console.log('   participants.length =', adminJoin.body.participants?.length);
      console.log('   chatMessages.length =', adminJoin.body.chatMessages?.length);
      console.log('   permissions.canModerate =', adminJoin.body.permissions?.canModerate);
    } else {
      console.log('   body:', JSON.stringify(adminJoin.body).slice(0, 300));
    }
  } catch (e) {
    console.error('[5] Error:', e.message);
  }

  if (studentToken) {
    try {
      const studentJoin = await httpRequest(
        baseOpts('GET', `/api/classes/${classId}/join-token`, studentToken)
      );
      console.log('\n[6] GET /api/classes/:id/join-token (NON-MEMBER STUDENT, should be 403):', studentJoin.status);
      console.log('   body:', JSON.stringify(studentJoin.body).slice(0, 300));
    } catch (e) {
      console.error('[6] Error:', e.message);
    }
  }

  try {
    const participants = await httpRequest(
      baseOpts('GET', `/api/classes/${classId}/participants`, adminToken)
    );
    console.log('\n[7] GET /api/classes/:id/participants (ADMIN):', participants.status, '| count =', Array.isArray(participants.body) ? participants.body.length : 'n/a');

    const chat = await httpRequest(
      baseOpts('GET', `/api/classes/${classId}/chat`, adminToken)
    );
    console.log('[8] GET /api/classes/:id/chat (ADMIN):', chat.status, '| count =', Array.isArray(chat.body) ? chat.body.length : 'n/a');
  } catch (e) {
    console.error('[7/8] Error:', e.message);
  }

  console.log('\n=== Tests Complete ===');
}

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
runTests().catch((e) => console.error('FATAL:', e));
