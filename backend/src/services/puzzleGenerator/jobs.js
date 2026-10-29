/* In-memory job registry for puzzle generation.
 *
 * Generation is CPU-bound (Stockfish) and must never run inside the API
 * process, so each job is a forked child. This module only tracks state,
 * forwards progress over IPC, and can kill the child on cancel.
 *
 * Jobs are deliberately ephemeral: the admin polls for a couple of minutes,
 * then the record is dropped. Nothing here is meant to survive a restart.
 */

const crypto = require('crypto');
const path = require('path');
const { fork } = require('child_process');

const jobs = new Map();
const JOB_TTL_MS = 30 * 60 * 1000;
const MAX_JOBS = 40;

function prune() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    const finished = job.status === 'done' || job.status === 'failed' || job.status === 'cancelled';
    if (finished && now - job.updatedAt > JOB_TTL_MS) {
      jobs.delete(id);
    }
  }
  if (jobs.size > MAX_JOBS) {
    const oldest = [...jobs.entries()]
      .filter(([, j]) => j.status === 'done' || j.status === 'failed' || j.status === 'cancelled')
      .sort((a, b) => a[1].updatedAt - b[1].updatedAt);
    while (jobs.size > MAX_JOBS && oldest.length) {
      const [id, job] = oldest.shift();
      jobs.delete(id);
      void job;
    }
  }
}

function snapshot(job) {
  return {
    id: job.id,
    status: job.status,
    step: job.step,
    progress: job.progress,
    counts: job.counts,
    puzzles: job.puzzles,
    warnings: job.warnings,
    error: job.error,
    topic: job.params.topic,
    requested: job.params.count,
    source: job.params.source,
    difficulty: job.params.difficulty,
    createdAt: job.createdAt,
  };
}

function startJob(params) {
  prune();
  const id = crypto.randomUUID();
  const job = {
    id,
    params,
    status: 'queued',
    step: 'Queued',
    progress: 0,
    counts: { lichess: 0, engine: 0 },
    puzzles: [],
    warnings: [],
    error: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    child: null,
  };
  jobs.set(id, job);

  const runner = path.join(__dirname, 'runner.js');
  const child = fork(runner, [JSON.stringify(params)], {
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    env: process.env,
  });
  job.child = child;
  job.status = 'running';
  job.step = 'Starting';

  child.on('message', (msg) => {
    if (!msg || typeof msg !== 'object') return;
    job.updatedAt = Date.now();
    if (msg.type === 'progress') {
      if (typeof msg.step === 'string') job.step = msg.step;
      if (typeof msg.progress === 'number') job.progress = Math.max(0, Math.min(100, msg.progress));
      if (msg.counts) job.counts = msg.counts;
    } else if (msg.type === 'done') {
      job.status = 'done';
      job.progress = 100;
      job.step = 'Done';
      job.puzzles = Array.isArray(msg.puzzles) ? msg.puzzles : [];
      job.counts = msg.counts || job.counts;
      job.warnings = Array.isArray(msg.warnings) ? msg.warnings : [];
    } else if (msg.type === 'failed') {
      job.status = 'failed';
      job.error = msg.error || 'Generation failed';
      job.warnings = Array.isArray(msg.warnings) ? msg.warnings : job.warnings;
    }
  });

  child.on('exit', (code) => {
    job.updatedAt = Date.now();
    if (job.status === 'running' || job.status === 'queued') {
      job.status = 'failed';
      job.error = code === 0
        ? 'The generator stopped before returning puzzles.'
        : `The generator stopped unexpectedly (exit code ${code}).`;
    }
    job.child = null;
  });

  child.on('error', (err) => {
    job.status = 'failed';
    job.error = err.message;
    job.updatedAt = Date.now();
  });

  return id;
}

function getJob(id) {
  const job = jobs.get(id);
  return job ? snapshot(job) : null;
}

function cancelJob(id) {
  const job = jobs.get(id);
  if (!job) return null;
  if (job.status === 'done' || job.status === 'failed' || job.status === 'cancelled') {
    return snapshot(job);
  }
  job.status = 'cancelled';
  job.step = 'Cancelled';
  job.updatedAt = Date.now();
  if (job.child) {
    try { job.child.kill(); } catch { /* already gone */ }
    job.child = null;
  }
  return snapshot(job);
}

function shutdownAll() {
  for (const job of jobs.values()) {
    if (job.child) {
      try { job.child.kill(); } catch { /* ignore */ }
    }
  }
  jobs.clear();
}

module.exports = { startJob, getJob, cancelJob, shutdownAll };
