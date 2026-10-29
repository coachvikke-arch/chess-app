const { TOPICS, getTopic } = require('../services/puzzleGenerator/topics');
const jobs = require('../services/puzzleGenerator/jobs');
const { savePuzzles } = require('../services/savePuzzleService');

const DIFFICULTIES = ['any', 'easy', 'medium', 'hard'];
const SOURCES = ['lichess+engine', 'lichess', 'engine'];

/** The topic catalogue, so the dropdown can never drift from the backend. */
exports.listTopics = (req, res) => {
  res.json({
    topics: TOPICS.map((t) => ({
      id: t.id,
      label: t.label,
      engine: Boolean(t.engine),
      lichess: t.lichess.length > 0,
    })),
  });
};

exports.start = (req, res) => {
  const topic = getTopic(req.body?.topic);
  if (!topic) return res.status(400).json({ message: 'Pick a tactic topic.' });

  const count = Number(req.body?.count);
  if (!Number.isInteger(count) || count < 1 || count > 100) {
    return res.status(400).json({ message: 'Enter a number from 1 to 100' });
  }

  const difficulty = String(req.body?.difficulty || 'any').toLowerCase();
  if (!DIFFICULTIES.includes(difficulty)) {
    return res.status(400).json({ message: 'Difficulty must be any, easy, medium or hard.' });
  }

  const source = String(req.body?.source || 'lichess+engine').toLowerCase();
  if (!SOURCES.includes(source)) return res.status(400).json({ message: 'Unknown puzzle source.' });

  if (source === 'engine' && !topic.engine) {
    return res.status(400).json({
      message: `No engine theme detector for ${topic.label} yet. Switch the source to Lichess only or Lichess + Engine.`,
    });
  }

  const jobId = jobs.startJob({
    topic: topic.id,
    topicLabel: topic.label,
    count,
    difficulty,
    source,
    userId: req.user?.id ?? null,
  });
  return res.status(202).json({ jobId });
};

exports.status = (req, res) => {
  const job = jobs.getJob(req.params.jobId);
  if (!job) return res.status(404).json({ message: 'That generation job is no longer available. Generate again.' });
  return res.json(job);
};

exports.cancel = (req, res) => {
  const job = jobs.cancelJob(req.params.jobId);
  if (!job) return res.status(404).json({ message: 'That generation job is no longer available.' });
  return res.json(job);
};

exports.save = async (req, res) => {
  const folderId = Number(req.body?.folderId);
  if (!Number.isInteger(folderId) || folderId <= 0) {
    return res.status(400).json({ message: 'Pick a folder to save into, or create one.' });
  }
  const puzzles = Array.isArray(req.body?.puzzles) ? req.body.puzzles : [];
  if (!puzzles.length) {
    return res.status(400).json({ message: 'Select at least one puzzle with Include' });
  }
  try {
    const result = await savePuzzles({ puzzles, folderId, userId: req.user?.id });
    if (!result.saved) {
      return res.status(409).json({
        message: 'Every selected puzzle is already in the library — nothing new to save.',
        ...result,
      });
    }
    return res.json(result);
  } catch (err) {
    return res.status(err.status || 500).json({ message: err.message || 'Could not save the puzzles.' });
  }
};
