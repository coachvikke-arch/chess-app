require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/authRoutes');
const studentRoutes = require('./routes/studentRoutes');
const ratingRoutes = require('./routes/ratingRoutes');
const courseRoutes = require('./routes/courseRoutes');
const libraryRoutes = require('./routes/libraryRoutes');
const lessonRoutes = require('./routes/lessonRoutes');
const classRoutes = require('./routes/classRoutes');
const assignmentRoutes = require('./routes/assignmentRoutes');
const gameHistoryRoutes = require('./routes/gameHistoryRoutes');
const puzzleRoutes = require('./routes/puzzleRoutes');
const puzzleGeneratorRoutes = require('./routes/puzzleGeneratorRoutes');
const pgnLibraryRoutes = require('./routes/pgnLibraryRoutes');
const quizRoutes = require('./routes/quizRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const miscRoutes = require('./routes/miscRoutes');
const onlineRoutes = require('./routes/onlineRoutes');
const chatRoutes = require('./routes/chatRoutes');
  const chatRequestRoutes = require('./routes/chatRequestRoutes');
const documentRoutes = require('./routes/documentRoutes');
const folderRoutes = require('./routes/folderRoutes');
const tournamentRoutes = require('./routes/tournamentRoutes');
const tournamentGameRoutes = require('./routes/tournamentGameRoutes');
const openingRoutes = require('./routes/openingRoutes');
const academyRoutes = require('./routes/academyRoutes');
const chessProfileRoutes = require('./routes/chessProfileRoutes');
const adminRoutes = require('./routes/adminRoutes');
const gmGameRoutes = require('./routes/gmGameRoutes');
const botRoutes = require('./routes/botRoutes');
const permissionRoutes = require('./routes/permissionRoutes');
const sidebarRoutes = require('./routes/sidebarRoutes');
const certificateRoutes = require('./routes/certificateRoutes');
const boardVisionRoutes = require('./routes/boardVisionRoutes');
const sigmaRoutes = require('./routes/sigmaRoutes');
const analysisRoutes = require('./routes/analysisRoutes');
const topPerformanceRoutes = require('./routes/topPerformanceRoutes');
const { studentRouter: homeworkStudentRoutes, adminRouter: homeworkAdminRoutes } = require('./routes/homeworkRoutes');

const app = express();

/* CLIENT_URL accepts a comma-separated list so a Vercel preview and the
   production domain can both talk to the same API. */
const clientOrigins = (process.env.CLIENT_URL || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

/* Railway/Vercel sit in front of the app, so every request carries
   X-Forwarded-For. One hop only: trusting it lets express-rate-limit key on the
   real client IP instead of the proxy's, and stops its validation from throwing
   (an unhandled rejection that took the process down on the first API call). */
app.set('trust proxy', 1);

app.use(helmet());
app.use(cors({ origin: clientOrigins, credentials: true }));
app.use(express.json({ limit: '25mb' }));
app.use(morgan('dev'));

/*
 * Lightweight response-time watch: flags any /api request slower than
 * SLOW_MS so regressions surface in the same log stream as morgan.
 * Baseline (healthy, warm DB): /api/puzzles/sets/:code 200 ≈ 2–10ms,
 * 304 revalidation ≈ 0–2ms; anything >100ms for that endpoint is worth a look.
 */
const SLOW_MS = Number(process.env.SLOW_API_MS) || 100;
app.use('/api', (req, res, next) => {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    if (ms > SLOW_MS) {
      console.warn(`[slow] ${req.method} ${req.originalUrl} ${res.statusCode} ${ms.toFixed(1)}ms`);
    }
  });
  next();
});

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000,
  skip: (req) => req.path.startsWith('/auth/'), // never throttle login/register/session checks
});
app.use('/api', limiter);

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', authRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/students/ratings', ratingRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/lessons', lessonRoutes);
/* Shared Chess Library (PGN/FEN folders) — one library for all admins. */
app.use('/api/library', libraryRoutes);
app.use('/api/classes', classRoutes);
app.use('/api/assignments', assignmentRoutes);
app.use('/api/game-history', gameHistoryRoutes);
app.use('/api/puzzles', puzzleRoutes);
/* Admin Puzzle Generator (Courses → Create Puzzles). Mounted before the bare
   `/api` catch-all below so the prefix resolves to this router. */
app.use('/api/admin/puzzle-generator', puzzleGeneratorRoutes);
app.use('/api/admin/pgn-library', pgnLibraryRoutes);
app.use('/api/quizzes', quizRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/folders', folderRoutes);
app.use('/api/online', onlineRoutes);
app.use('/api/chat', chatRoutes);
  app.use('/api/chat-requests', chatRequestRoutes);
app.use('/api/chat-requests', chatRequestRoutes);
/* Tournaments. Live-board routes (/games/...) are mounted first so they can never
   be captured by the /:id routes. Both sit before the bare `/api` catch-all. */
app.use('/api/tournaments', tournamentGameRoutes);
app.use('/api/tournaments', tournamentRoutes);
 app.use('/api/openings', openingRoutes);
app.use('/api/openings', openingRoutes);
app.use('/api/academy', academyRoutes);
app.use('/api/chess-profiles', chessProfileRoutes);
app.use('/api/admins', adminRoutes);
app.use('/api/gm-games', gmGameRoutes);
app.use('/api/bots', botRoutes);
app.use('/api/permissions', permissionRoutes);
app.use('/api/sidebar', sidebarRoutes);
app.use('/api/certificates', certificateRoutes);
/* Board Vision training progress — per-user JSON document (cross-device). */
app.use('/api/board-vision', boardVisionRoutes);
/* Σ Sigma Moves — mounted before the `/api` catch-all below. */
app.use('/api/sigma', sigmaRoutes);
/* Automatic background Stockfish analysis. Mounted BEFORE the bare `/api`
   catch-all below for the same reason as sigma: the prefix must
   match this router rather than falling through to miscRoutes and then the 404
   handler. (miscRoutes owns /game-analysis, which is the unrelated
   coach-feedback feature — the two must never be confused.) */
app.use('/api/analysis', analysisRoutes);
/* Top Performances showcase. Mounted BEFORE the bare `/api` catch-all below
   for the same reason as sigma. */
app.use('/api/performances', topPerformanceRoutes);
/* Homework — a view over the existing puzzle-assignment model. Both prefixes
   are exact and mounted before the bare `/api` router below. */
app.use('/api/student/homework', homeworkStudentRoutes);
app.use('/api/homework', homeworkAdminRoutes);
app.use('/api', miscRoutes); // groups, announcements, notifications, achievements, game-analysis

/* static file serving for uploads */
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// 404
app.use((req, res) => res.status(404).json({ message: 'Route not found' }));

// Global error handler
app.use((err, req, res, next) => {
  // body-parser rejects an oversized body with a raw, hard-to-read message.
  // Turn it into something the user can act on.
  if (err?.type === 'entity.too.large' || err?.status === 413) {
    return res.status(413).json({
      message: `That request is too large (limit ${err.limit || '25mb'}). Split the file into smaller pieces and upload them one at a time.`,
    });
  }
  console.error(err);
  res.status(err.status || 500).json({ message: err.message || 'Internal server error' });
});

module.exports = app;
