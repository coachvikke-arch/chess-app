import api from '../services/api';

/* Admin Puzzle Generator API.
 *
 * Job polling MUST bypass the GET cache in services/api.js — a 30 s cached
 * status would freeze the progress bar. Every read here passes cache:false.
 */

export function fetchTopics() {
  return api.get('/admin/puzzle-generator/topics')
    .then((r) => r.data?.topics || []);
}

export function startGeneration(body) {
  return api.post('/admin/puzzle-generator/start', body, { cache: false })
    .then((r) => r.data);
}

export function getJob(jobId) {
  return api.get(`/admin/puzzle-generator/${jobId}`, { cache: false })
    .then((r) => r.data);
}

export function cancelGeneration(jobId) {
  return api.post(`/admin/puzzle-generator/${jobId}/cancel`, {}, { cache: false })
    .then((r) => r.data);
}

export function savePuzzles(body) {
  return api.post('/admin/puzzle-generator/save', body, { cache: false })
    .then((r) => r.data);
}

export function fetchPgnFolders() {
  return api.get('/admin/pgn-library/folders', { cache: false })
    .then((r) => r.data?.tree || []);
}

export function createPgnFolder(body) {
  return api.post('/admin/pgn-library/folders', body, { cache: false })
    .then((r) => r.data);
}
