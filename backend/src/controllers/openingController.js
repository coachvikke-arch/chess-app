const db = require('../config/database');
const { Chess } = require('chess.js');
const { isAdminRole } = require('../middleware/roleMiddleware');
const { APP_NAME } = require('../config/brand');

const DIFFICULTIES = ['Easy', 'Medium', 'Hard'];
const STYLE_TAGS = ['Positional', 'Tactical', 'Defensive', 'Aggressive'];
const ECO_RANGES = [
  { label: 'A (Flank games)', from: 'A', to: 'E' },
  { label: 'B (Semi-open)', from: 'B', to: 'B' },
  { label: 'C (Open games)', from: 'C', to: 'C' },
  { label: 'D (Closed d4)', from: 'D', to: 'D' },
  { label: 'E (Indian)', from: 'E', to: 'E' },
];
const LEARN_TARGET = 1; // correct solves needed to mark a line learned

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80) || 'course';
}

async function uniqueSlug(base) {
  let candidate = base;
  let n = 2;
  for (;;) {
    const r = await db.query('SELECT 1 FROM opening_courses WHERE slug = $1', [candidate]);
    if (r.rows.length === 0) return candidate;
    candidate = `${base}-${n++}`;
  }
}

/* Validate and normalise a line's SAN moves with chess.js. Throws on illegal/missing */
function normalizeMoves(movesRaw) {
  const list = (Array.isArray(movesRaw) ? movesRaw : String(movesRaw || '').trim().split(/\s+/))
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.length < 2) return null;
  const game = new Chess();
  const out = [];
  for (const san of list) {
    try {
      const m = game.move(san);
      if (!m) throw new Error(`illegal {${san}}`);
      out.push(m.san);
    } catch {
      throw new Error(`Invalid move '${san}'`);
    }
  }
  return out;
}

function normalizeExplanations(raw, plyCount) {
  const arr = Array.isArray(raw) ? raw : [];
  return arr
    .filter((e) => e && Number.isInteger(Number(e.moveIndex)))
    .map((e) => ({ moveIndex: Number(e.moveIndex), text: String(e.text || '').trim().slice(0, 500) }))
    .filter((e) => e.text && e.moveIndex >= 0 && e.moveIndex < plyCount);
}

function coverageOf(moves) {
  return Math.floor(moves.length / 2);
}

exports.getOptions = (_req, res) => {
  res.json({ difficulties: DIFFICULTIES, tags: STYLE_TAGS, ecoranges: ECO_RANGES });
};

/* Overall progress counter ("lines learned X/Y") across every published course. */
exports.progressSummary = async (req, res) => {
  try {
    const r = await db.query(
      `SELECT COUNT(l.id)::int AS total,
              COUNT(pr.line_id) FILTER (WHERE pr.learned)::int AS learned
       FROM opening_lines l
       JOIN opening_courses c ON c.id = l.course_id AND c.published = true
       LEFT JOIN opening_progress pr ON pr.line_id = l.id AND pr.user_id = $1`,
      [req.user.id]
    );
    res.json({ totalLines: r.rows[0].total, learnedLines: r.rows[0].learned });
  } catch (err) {
    res.status(500).json({ message: 'Failed to load progress summary', error: err.message });
  }
};

/* ────────────────────────── list courses ────────────────────────── */
exports.listCourses = async (req, res) => {
  try {
    const tab = req.query.tab === 'community' ? 'community' : 'official';
    const side = String(req.query.side || '').toLowerCase();
    const tag = String(req.query.tag || '');
    const difficulty = String(req.query.difficulty || '');
    const eco = String(req.query.eco || '').toUpperCase();
    const sort = String(req.query.sort || 'last');
    const userId = req.user?.id || null;

    const clauses = ['c.is_official = $1', 'c.published = true'];
    const params = [tab === 'official'];
    if (side === 'white' || side === 'black') {
      params.push(side);
      clauses.push(`c.side = $${params.length}`);
    }
    if (tag && STYLE_TAGS.includes(tag)) {
      params.push(tag);
      clauses.push(`$${params.length} = ANY(c.tags)`);
    }
    if (difficulty && DIFFICULTIES.includes(difficulty)) {
      params.push(difficulty);
      clauses.push(`c.difficulty = $${params.length}`);
    }
    if (/^[A-E]$/.test(eco)) {
      params.push(eco);
      clauses.push(`c.eco_code LIKE $${params.length} || '%'`);
    }

    const orderBy =
      sort === 'az'
        ? 'LOWER(c.title) ASC'
        : sort === 'popular'
          ? 'c.likes DESC, c.created_at ASC'
          : sort === 'last'
            ? `MAX(pr.last_played_at) DESC NULLS LAST, c.created_at DESC`
            : 'c.created_at DESC';

    const sql = `SELECT
      c.id, c.slug, c.title, c.side, c.description, c.tags, c.difficulty, c.eco_code,
      c.is_official, c.likes, c.reports, c.created_at, c.updated_at,
      u.name AS author_name, u.id AS author_user_id,
      COUNT(l.id)::int AS total_lines,
      COALESCE(SUM(GREATEST(array_length(l.moves, 1)::int / 2, 0)), 0)::int AS coverage,
      COUNT(DISTINCT pr.line_id) FILTER (WHERE pr.learned)::int AS learned_lines,
      MAX(pr.last_played_at) AS last_played_at,
      (SELECT l4.moves FROM opening_lines l4
        WHERE l4.course_id = c.id AND l4.is_main_line = true
        ORDER BY l4.order_index, l4.id LIMIT 1) AS main_line_moves
    FROM opening_courses c
    LEFT JOIN users u ON u.id = c.author_id
    LEFT JOIN opening_lines l ON l.course_id = c.id
    LEFT JOIN opening_progress pr ON pr.line_id = l.id AND pr.user_id = $${params.length + 1}
    WHERE ${clauses.join(' AND ')}
    GROUP BY c.id, u.name, u.id
    ORDER BY ${orderBy}`;

    const result = await db.query(sql, [...params, userId]);

    res.json({
      courses: result.rows.map((c) => ({
        id: c.id,
        slug: c.slug,
        title: c.title,
        side: c.side,
        description: c.description,
        tags: c.tags || [],
        difficulty: c.difficulty,
        ecoCode: c.eco_code,
        isOfficial: c.is_official,
        authorName: c.is_official ? null : c.author_name,
        likes: c.likes,
        reports: c.reports,
        createdAt: c.created_at,
        updatedAt: c.updated_at,
        coverage: c.coverage,
        totalLines: c.total_lines,
        learnedLines: c.learned_lines || 0,
        lastPlayedAt: c.last_played_at,
        mainLineMoves: c.main_line_moves || [],
      })),
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to list opening courses', error: err.message });
  }
};

/* ────────────────────────── single course ────────────────────────── */
exports.getCourse = async (req, res) => {
  try {
    const userId = req.user?.id || null;
    const params = [req.params.slug];
    let authClause = 'c.published = true';
    if (userId) {
      params.push(userId);
      authClause = `(c.published = true OR c.author_id = $2)`;
    }

    const cRes = await db.query(
      `SELECT c.*, u.name AS author_name,
         (SELECT COUNT(*) FROM opening_lines l2 WHERE l2.course_id = c.id)::int AS total_lines,
         COALESCE((SELECT SUM(GREATEST(array_length(l3.moves,1)::int/2,0)) FROM opening_lines l3 WHERE l3.course_id = c.id),0)::int AS coverage
       FROM opening_courses c
       LEFT JOIN users u ON u.id = c.author_id
       WHERE c.slug = $1 AND ${authClause}`,
      params
    );
    if (cRes.rows.length === 0) return res.status(404).json({ message: 'Course not found' });
    const c = cRes.rows[0];

    const lRes = await db.query(
      `SELECT l.id, l.moves, l.explanations, l.is_main_line, l.parent_line_id, l.order_index, l.name,
         pr.learned, pr.times_correct
       FROM opening_lines l
       LEFT JOIN opening_progress pr ON pr.line_id = l.id AND pr.user_id = $2
       WHERE l.course_id = $1
       ORDER BY l.is_main_line DESC, l.order_index ASC, l.id ASC`,
      [c.id, userId]
    );

    const liked = userId
      ? !!(await db.query('SELECT 1 FROM opening_likes WHERE course_id = $1 AND user_id = $2', [c.id, userId])).rows.length
      : false;

    const lineIds = lRes.rows.map((l) => l.id);
    const childrenRes = lineIds.length
      ? await db.query('SELECT id, parent_line_id FROM opening_lines WHERE course_id = $1', [c.id])
      : { rows: [] };
    const childrenByParent = {};
    for (const ch of childrenRes.rows) {
      if (ch.parent_line_id) (childrenByParent[ch.parent_line_id] = childrenByParent[ch.parent_line_id] || []).push(ch.id);
    }

    const learnedLines = lRes.rows.filter((l) => l.learned).length;

    res.json({
      course: {
        id: c.id,
        slug: c.slug,
        title: c.title,
        side: c.side,
        description: c.description,
        tags: c.tags || [],
        difficulty: c.difficulty,
        ecoCode: c.eco_code,
        guide: c.guide || '',
        isOfficial: c.is_official,
        authorName: c.author_name,
        isAuthor: userId ? c.author_id === userId : false,
        liked,
        likes: c.likes,
        reports: c.reports,
        createdAt: c.created_at,
        totalLines: c.total_lines,
        coverage: c.coverage,
        learnedLines,
      },
      lines: lRes.rows.map((l) => ({
        id: l.id,
        moves: l.moves,
        name: l.name || null,
        explanations: l.explanations || [],
        isMainLine: l.is_main_line,
        parentLineId: l.parent_line_id,
        childIds: childrenByParent[l.id] || [],
        learned: !!l.learned,
        timesCorrect: l.times_correct || 0,
      })),
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to load course', error: err.message });
  }
};

/* ─────────────────────── create course (community) ─────────────────────── */
exports.createCourse = async (req, res) => {
  try {
    const title = String(req.body.title || '').trim();
    const side = ['white', 'black'].includes(req.body.side) ? req.body.side : 'white';
    const description = String(req.body.description || '').trim();
    const tags = (Array.isArray(req.body.tags) ? req.body.tags : []).filter((t) => STYLE_TAGS.includes(t));
    const difficulty = DIFFICULTIES.includes(req.body.difficulty) ? req.body.difficulty : 'Easy';
    const ecoCode = String(req.body.ecoCode || '').trim().toUpperCase().slice(0, 3);
    const guide = String(req.body.guide || '').trim();
    const published = req.body.published === true;
    const rawLines = Array.isArray(req.body.lines) ? req.body.lines : [];

    if (!title) return res.status(400).json({ message: 'Course title is required' });
    if (rawLines.length === 0) return res.status(400).json({ message: 'Add at least one line' });

    const parsedLines = [];
    for (const l of rawLines) {
      let moves;
      try {
        moves = normalizeMoves(l.moves);
      } catch (e) {
        return res.status(400).json({ message: `${title} — ${e.message}` });
      }
      if (!moves) continue;
      parsedLines.push({ moves, explanations: normalizeExplanations(l.explanations, moves.length), main: l.isMainLine });
    }
    if (parsedLines.length === 0) return res.status(400).json({ message: 'No valid lines provided' });

    const hasMain = parsedLines.some((l) => l.main);
    const slug = await uniqueSlug(slugify(title));

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const cRes = await client.query(
        `INSERT INTO opening_courses
           (slug, title, side, description, tags, difficulty, eco_code, guide, is_official, author_id, published)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,false,$9,$10)
         RETURNING id, slug`,
        [slug, title, side, description, tags, difficulty, ecoCode || null, guide, req.user.id, published]
      );
      const courseId = cRes.rows[0].id;
      let idx = 0;
      for (const line of parsedLines) {
        await client.query(
          `INSERT INTO opening_lines (course_id, moves, explanations, is_main_line, order_index)
           VALUES ($1,$2,$3,$4,$5)`,
          [courseId, line.moves, JSON.stringify(line.explanations), line.main || (!hasMain && idx === 0), idx++]
        );
      }
      await client.query('COMMIT');
      res.status(201).json({ message: published ? 'Course published' : 'Draft saved', course: { id: courseId, slug: cRes.rows[0].slug } });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    res.status(500).json({ message: 'Failed to create course', error: err.message });
  }
};

/* ─────────────────────── update / publish course ─────────────────────── */
exports.updateCourse = async (req, res) => {
  try {
    const cRes = await db.query('SELECT * FROM opening_courses WHERE slug = $1', [req.params.slug]);
    if (cRes.rows.length === 0) return res.status(404).json({ message: 'Course not found' });
    const course = cRes.rows[0];
    const isAuthor = course.author_id === req.user.id;
    if (!isAuthor && !isAdminRole(req.user.role) && !course.is_official) {
      return res.status(403).json({ message: 'Only the author can edit this course' });
    }
    if (course.is_official && !isAdminRole(req.user.role)) {
      return res.status(403).json({ message: 'Official courses are managed by the academy' });
    }

    const changes = {};
    if (req.body.title !== undefined) changes.title = String(req.body.title).trim().slice(0, 200);
    if (req.body.side !== undefined) changes.side = ['white', 'black'].includes(req.body.side) ? req.body.side : course.side;
    if (req.body.description !== undefined) changes.description = String(req.body.description).trim();
    if (req.body.tags !== undefined) changes.tags = (Array.isArray(req.body.tags) ? req.body.tags : []).filter((t) => STYLE_TAGS.includes(t));
    if (req.body.difficulty !== undefined) changes.difficulty = DIFFICULTIES.includes(req.body.difficulty) ? req.body.difficulty : course.difficulty;
    if (req.body.ecoCode !== undefined) changes.eco_code = String(req.body.ecoCode).trim().toUpperCase().slice(0, 3) || null;
    if (req.body.guide !== undefined) changes.guide = String(req.body.guide).trim();
    if (req.body.published !== undefined) changes.published = req.body.published === true;

    const keys = Object.keys(changes);
    if (keys.length > 0) {
      keys.push('updated_at');
      const set = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
      await db.query(`UPDATE opening_courses SET ${set} WHERE id = $1`, [course.id, ...keys.map((k) => changes[k]), 'NOW()']);
    }

    /* Optional: replace lines wholesale when line moves/notes are sent */
    if (Array.isArray(req.body.lines)) {
      const parsed = [];
      for (const l of req.body.lines) {
        if (!l.id) {
          let moves;
          try {
            moves = normalizeMoves(l.moves);
          } catch {
            continue;
          }
          if (!moves) continue;
          parsed.push({ moves, explanations: normalizeExplanations(l.explanations, moves.length), main: l.isMainLine });
        } else {
          parsed.push({ id: l.id });
        }
      }
      const client = await db.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM opening_lines WHERE course_id = $1', [course.id]);
        let idx = 0;
        for (const p of parsed) {
          await client.query(
            `INSERT INTO opening_lines (course_id, moves, explanations, is_main_line, order_index)
             VALUES ($1,$2,$3,$4,$5)`,
            [course.id, p.moves, JSON.stringify(p.explanations), p.main || idx === 0, idx++]
          );
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    }

    res.json({ message: 'Course updated', course: { ...course, ...changes, updated_at: new Date() } });
  } catch (err) {
    res.status(500).json({ message: 'Failed to update course', error: err.message });
  }
};

/* ─────────────────────── record progress ─────────────────────── */
exports.recordProgress = async (req, res) => {
  try {
    const { lineId, correct } = req.body;
    const lid = parseInt(lineId, 10);
    if (!Number.isInteger(lid)) return res.status(400).json({ message: 'lineId is required' });

    const lineRes = await db.query(
      `SELECT l.id FROM opening_lines l JOIN opening_courses c ON c.id = l.course_id
       WHERE l.id = $1 AND c.slug = $2`,
      [lid, req.params.slug]
    );
    if (lineRes.rows.length === 0) return res.status(404).json({ message: 'Line not found in this course' });

    const prev = await db.query('SELECT times_correct FROM opening_progress WHERE user_id = $1 AND line_id = $2', [req.user.id, lid]);

    let timesCorrect = (prev.rows[0]?.times_correct || 0) + (correct ? 1 : 0);
    if (!correct) timesCorrect = prev.rows[0]?.times_correct || 0;
    const learned = correct && timesCorrect >= LEARN_TARGET;

    await db.query(
      `INSERT INTO opening_progress (user_id, line_id, learned, times_correct, last_played_at)
       VALUES ($1,$2,$3,$4,NOW())
       ON CONFLICT (user_id, line_id) DO UPDATE SET
         learned = EXCLUDED.learned OR opening_progress.learned,
         times_correct = EXCLUDED.times_correct,
         last_played_at = NOW()`,
      [req.user.id, lid, learned, timesCorrect]
    );

    res.json({ learned, timesCorrect, lineId: lid, isNew: !correct });
  } catch (err) {
    res.status(500).json({ message: 'Failed to record progress', error: err.message });
  }
};

/* ─────────────────────── like toggle ─────────────────────── */
exports.toggleLike = async (req, res) => {
  try {
    const cRes = await db.query('SELECT id FROM opening_courses WHERE slug = $1', [req.params.slug]);
    if (cRes.rows.length === 0) return res.status(404).json({ message: 'Course not found' });
    const courseId = cRes.rows[0].id;

    const ins = await db.query(
      'INSERT INTO opening_likes (course_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [courseId, req.user.id]
    );
    if (ins.rowCount) {
      await db.query('UPDATE opening_courses SET likes = likes + 1 WHERE id = $1', [courseId]);
      return res.json({ liked: true, likes: (await db.query('SELECT likes FROM opening_courses WHERE id = $1', [courseId])).rows[0].likes });
    }
    await db.query('DELETE FROM opening_likes WHERE course_id = $1 AND user_id = $2', [courseId, req.user.id]);
    await db.query('UPDATE opening_courses SET likes = GREATEST(likes - 1, 0) WHERE id = $1', [courseId]);
    res.json({ liked: false, likes: (await db.query('SELECT likes FROM opening_courses WHERE id = $1', [courseId])).rows[0].likes });
  } catch (err) {
    res.status(500).json({ message: 'Failed to toggle like', error: err.message });
  }
};

/* ─────────────────────── report course ─────────────────────── */
exports.reportCourse = async (req, res) => {
  try {
    const cRes = await db.query('SELECT id FROM opening_courses WHERE slug = $1', [req.params.slug]);
    if (cRes.rows.length === 0) return res.status(404).json({ message: 'Course not found' });
    const courseId = cRes.rows[0].id;

    const ins = await db.query(
      `INSERT INTO opening_reports (course_id, user_id, reason)
       VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [courseId, req.user.id, String(req.body.reason || '').slice(0, 500) || null]
    );
    if (ins.rowCount) {
      await db.query('UPDATE opening_courses SET reports = reports + 1 WHERE id = $1', [courseId]);
    }
    res.json({ reported: ins.rowCount > 0, message: ins.rowCount ? 'Report submitted' : 'You already reported this course' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to report course', error: err.message });
  }
};

/* ─────────────────────── poll ─────────────────────── */
exports.getPoll = async (_req, res) => {
  try {
    const result = await db.query(
      'SELECT id, name, eco_code, side, blurb, votes FROM opening_poll_options ORDER BY votes DESC, id ASC'
    );
    res.json({ options: result.rows.map((o) => ({ id: o.id, name: o.name, ecoCode: o.eco_code, side: o.side, blurb: o.blurb, votes: o.votes })) });
  } catch (err) {
    res.status(500).json({ message: 'Failed to load poll', error: err.message });
  }
};

exports.votePoll = async (req, res) => {
  try {
    const sessionId = String(req.body.sessionId || '').slice(0, 100);
    const ids = (Array.isArray(req.body.optionIds) ? req.body.optionIds : [])
      .map((n) => parseInt(n, 10))
      .filter((n) => Number.isInteger(n));
    if (!sessionId) return res.status(400).json({ message: 'sessionId is required' });
    if (ids.length === 0) return res.status(400).json({ message: 'Pick at least one opening' });

    await db.query(`DELETE FROM opening_poll_votes WHERE session_id = $1`, [sessionId]);
    for (const oid of ids) {
      await db.query(
        `INSERT INTO opening_poll_votes (option_id, session_id) VALUES ($1,$2)
         ON CONFLICT (option_id, session_id) DO NOTHING`,
        [oid, sessionId]
      );
    }
    await db.query(
      `UPDATE opening_poll_options o SET votes = (SELECT COUNT(*) FROM opening_poll_votes v WHERE v.option_id = o.id)`
    );
    res.json({ voted: ids.length, message: `Thanks — ${ids.length} vote${ids.length === 1 ? '' : 's'} recorded!` });
  } catch (err) {
    res.status(500).json({ message: 'Failed to record votes', error: err.message });
  }
};

exports.suggestOpening = async (req, res) => {
  try {
    const text = String(req.body.text || '').trim().slice(0, 300);
    const sessionId = String(req.body.sessionId || '').slice(0, 100) || null;
    if (!text) return res.status(400).json({ message: 'Suggestion text is required' });
    await db.query('INSERT INTO opening_suggestions (text, session_id) VALUES ($1,$2)', [text, sessionId]);
    res.json({ message: 'Suggestion submitted — thanks!' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to submit suggestion', error: err.message });
  }
};

/* ────────────────────────────────────────────────────────────────────────
   Lichess Opening Explorer proxy.

   As of 2026 explorer.lichess.ovh REQUIRES authentication on every request
   (it returns 401 for bare browser/curl calls). A browser fetch cannot add
   the User-Agent + Authorization headers Lichess now demands, so the Game
   Review "Book" lookup 401'd on every position. This endpoint forwards to
   Lichess from the server, which CAN identify us — and honours an optional
   LICHESS_API_TOKEN env var when the deployment has one.

   When NO token is configured, Lichess rejects every call with 401 — so we
   don't forward punishment to the review pipeline (and don't 401-spam the
   browser console): we answer with an EMPTY explorer result instead, which
   makes the pipeline fall back to its offline curated book exactly as it
   does for any other "not in the DB" position. Adding LICHESS_API_TOKEN to
   the env (restart the backend) re-enables live lookups with no frontend
   change.
   ──────────────────────────────────────────────────────────────────────── */
exports.explorerProxy = async (req, res) => {
  try {
    const fen = String(req.query.fen || '').slice(0, 200);
    if (!fen) return res.status(400).json({ message: 'Missing fen' });

    if (!process.env.LICHESS_API_TOKEN) {
      return res
        .status(200)
        .set('Cache-Control', 'public, max-age=3600')
        .set('Content-Type', 'application/json')
        .json({ white: 0, draws: 0, black: 0, moves: [], configured: false });
    }

    const upstream = 'https://explorer.lichess.ovh/masters';
    const headers = {
      Accept: 'application/json',
      'User-Agent':
        process.env.LICHESS_USER_AGENT ||
        `mate-zone-chess-academy-review/1.0 (${APP_NAME} game review; opening book lookup)`,
      Authorization: `Bearer ${process.env.LICHESS_API_TOKEN}`,
    };

    const upstreamRes = await fetch(`${upstream}?fen=${encodeURIComponent(fen)}`, {
      headers,
      signal: AbortSignal.timeout(10000),
    });

    res.status(upstreamRes.status);
    res.set('Content-Type', upstreamRes.headers.get('content-type') || 'application/json');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(await upstreamRes.text());
  } catch (err) {
    res.status(502).json({ message: 'Explorer proxy error', error: err.message });
  }
};