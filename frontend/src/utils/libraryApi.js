// ─────────────────────────────────────────────────────────────────────────────
// Shared Chess Library — API client.
//
// The PGN/FEN library used to live in each browser's localStorage under
// 'chess-library-v1', which meant every admin had a private copy. It is now
// server-backed and shared by EVERY admin and the superadmin.
//
// There is exactly one library for all of them: the backend stores
// `created_by` for information only and never filters on it, so a folder one
// coach adds shows up for all the others immediately.
//
// Every function here throws on a failed request; callers surface the message
// (the Library page shows it in a toast). After any mutation the caller
// refetches `fetchLibrary()` rather than patching state locally, so the page
// always renders exactly what the server now holds.
// ─────────────────────────────────────────────────────────────────────────────

import api from '../services/api';

const BASE = '/library';

function msg(err, fallback) {
  return err?.response?.data?.message || err?.message || fallback;
}
/** The whole library: { folders: [ { id, name, parentId, type, description,
 *  createdAt, items: [ { id, title, type, notation, fen?, pgn?, createdAt } ] } ] }
 *
 * Admin + superadmin only. Use `fetchLibraryPublic` where a student may be
 * looking (the live classroom's Course tab). */
export async function fetchLibrary() {
  const res = await api.get(BASE, { cache: false });
  return res.data;
}

/**
 * Read-only library for any signed-in user, students included.
 *
 * The live classroom's Course tab is shown to students mid-lesson, and the
 * admin-only GET /library is not available to them, so the classroom reads
 * through this route instead. Same shape; `created_by` is not part of it.
 */
export async function fetchLibraryPublic() {
  const res = await api.get(`${BASE}/public`, { cache: false });
  return res.data;
}

export async function createFolder(fields) {
  try {
    const res = await api.post(`${BASE}/folders`, fields);
    return res.data;
  } catch (err) {
    throw new Error(msg(err, 'Could not create the folder.'));
  }
}

/** `fields` may carry name, type, description and/or parentId (a move). */
export async function updateFolder(id, fields) {
  try {
    const res = await api.patch(`${BASE}/folders/${id}`, fields);
    return res.data;
  } catch (err) {
    throw new Error(msg(err, 'Could not update the folder.'));
  }
}

/** Deletes the folder AND its subfolders (cascade lives in the schema). */
export async function deleteFolder(id) {
  try {
    const res = await api.delete(`${BASE}/folders/${id}`);
    return res.data;
  } catch (err) {
    throw new Error(msg(err, 'Could not delete the folder.'));
  }
}

export async function createItem(fields) {
  try {
    const res = await api.post(`${BASE}/items`, fields);
    return res.data;
  } catch (err) {
    throw new Error(msg(err, 'Could not add the entry.'));
  }
}

/** Add many entries to a folder at once (PGN / FEN upload). */
export async function createItems(folderId, items) {
  try {
    const res = await api.post(`${BASE}/items/bulk`, { folderId, items });
    return res.data;
  } catch (err) {
    throw new Error(msg(err, 'Could not add the entries.'));
  }
}

/** `fields` may carry title, notation, fen, pgn and/or folderId (a move). */
export async function updateItem(id, fields) {
  try {
    const res = await api.patch(`${BASE}/items/${id}`, fields);
    return res.data;
  } catch (err) {
    throw new Error(msg(err, 'Could not update the entry.'));
  }
}

export async function deleteItem(id) {
  try {
    const res = await api.delete(`${BASE}/items/${id}`);
    return res.data;
  } catch (err) {
    throw new Error(msg(err, 'Could not delete the entry.'));
  }
}

/** dir = -1 moves the entry up, +1 moves it down. */
export async function reorderItem(id, dir) {
  try {
    const res = await api.post(`${BASE}/items/${id}/reorder`, { dir });
    return res.data;
  } catch (err) {
    throw new Error(msg(err, 'Could not reorder the entry.'));
  }
}

/** Rename many entries in one server-side transaction: all succeed or none do. */
export async function bulkRenameItems(renames) {
  try {
    const res = await api.post(`${BASE}/bulk-rename`, { renames });
    return res.data;
  } catch (err) {
    throw new Error(msg(err, 'Could not rename the entries.'));
  }
}

/**
 * Upload a browser's old localStorage library. The server nests everything
 * under a fresh "Imported - <admin>" folder, in one transaction, so it can
 * never collide with the folders other admins already have. May be run at any
 * time by any admin.
 */
export async function importLibrary(folders) {
  const res = await api.post(`${BASE}/import`, { folders });
  return res.data;
}

/* ── shared pure helpers (unchanged from the old localStorage store) ─────── */

const INVALID_NAME = /[/\\:*?"<>|]/;

/** Same rules as before — empty, illegal chars, duplicate (per parent). */
export function validateFolderName(name, parentId, folders) {
  const value = String(name || '').trim();
  if (!value) return 'Folder name cannot be empty.';
  if (INVALID_NAME.test(value)) return 'Folder name cannot contain / \\ : * ? " < > |';
  const dupe = (folders || []).some(
    (f) => f.parentId === parentId && String(f.name).toLowerCase() === value.toLowerCase()
  );
  if (dupe) return `A folder named "${value}" already exists in this location.`;
  return '';
}

/** Folders with no parent — the ones offered in the "save to folder" picker. */
export function getRootFolders(folders) {
  return (folders || []).filter((f) => f.parentId === null || f.parentId === undefined);
}

/* ── localStorage helpers, used ONLY for the one-time import ────────────── */

export const LEGACY_STORAGE_KEY = 'chess-library-v1';

/** The old per-browser library, or null when this browser never had one. */
export function readLegacyLibrary() {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.folders) && parsed.folders.length > 0) return parsed;
  } catch {
    /* unreadable / corrupt — treat as absent */
  }
  return null;
}

/** Remove the old copy. Only called AFTER a successful upload. */
export function clearLegacyLibrary() {
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}