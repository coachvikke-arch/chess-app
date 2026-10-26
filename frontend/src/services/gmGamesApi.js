import api from './api';

/* GM game library — imported games live in the backend (gm_games table) while
   the seeded classics ship in the static bundle (frontend/src/games/*.json). */

export function listGmGames() {
  return api.get('/gm-games', { cache: false });
}

export function getGmGame(id) {
  return api.get(`/gm-games/${id}`, { cache: false });
}

export function getGmPlayers() {
  return api.get('/gm-games/players', { cache: false });
}

export function importGmPlayerGames(player, { autoAnnotate = true } = {}) {
  return api.post('/gm-games/import/player', { player, autoAnnotate }, { timeout: 300000 });
}

export function importGmGames({ pgn, autoAnnotate = true }) {
  return api.post('/gm-games/import', { pgn, autoAnnotate });
}

export function importGmGameFiles(files, { autoAnnotate = true }) {
  const formData = new FormData();
  files.forEach((file) => formData.append('files', file, file.name));
  formData.append('autoAnnotate', String(autoAnnotate));
  return api.post('/gm-games/import/files', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120000,
  });
}

export function deleteGmGame(id) {
  return api.delete(`/gm-games/${id}`);
}

/* Undo a player pack import — removes every imported game for that player.
   The player name travels in the BODY (not the path) so it needs no encoding
   and cannot be confused with a game id. */
export function removeGmPlayerGames(player) {
  return api.delete('/gm-games/import/player', { data: { player } });
}