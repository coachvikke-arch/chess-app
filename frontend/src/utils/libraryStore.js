// ─────────────────────────────────────────────────────────────────────────────
// LEGACY — the per-browser localStorage library store.
//
// NO LONGER USED by the app. The Library is server-backed and shared by every
// admin and the superadmin; see utils/libraryApi.js for the API client. This
// file is kept only so the OLD 'chess-library-v1' payload can still be read
// once, for the one-time import prompt (utils/libraryApi.js reads the key
// directly and deletes it only after a successful upload).
//
// Nothing imports loadLibrary/saveLibrary/createFolder/addItemToFolder any
// more — if you need library access, use utils/libraryApi.js.
//
// Original shape, kept here as documentation of what gets imported:
//   { folders: [ { id, name, parentId, type, description, createdAt,
//                  items: [ { id, title, type: 'pgn'|'fen', notation } ] } ] }
// ─────────────────────────────────────────────────────────────────────────────

import { buildSampleLibrary } from './librarySeed';

const STORAGE_KEY = 'chess-library-v1';

/** Read the library from localStorage, reseeding a sample on first visit. */
export function loadLibrary() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.folders)) return parsed;
    }
  } catch {
    /* fall through to seed */
  }
  return buildSampleLibrary();
}

/** Persist the whole library (folders + items) back to localStorage. */
export function saveLibrary(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* storage full / private mode — ignore */
  }
}

export function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const INVALID_NAME = /[\/\\:*?"<>|]/;

/** Same rules as the Library page — empty, illegal chars, duplicate (per parent). */
export function validateFolderName(name, parentId, folders) {
  const value = String(name || '').trim();
  if (!value) return 'Folder name cannot be empty.';
  if (INVALID_NAME.test(value)) return 'Folder name cannot contain / \\ : * ? " < > |';
  const dupe = folders.some((f) => f.parentId === parentId && f.name.toLowerCase() === value.toLowerCase());
  if (dupe) return `A folder named "${value}" already exists in this location.`;
  return '';
}

/** Folders with no parent — the cards shown on the Library home / save view. */
export function getRootFolders(folders) {
  return folders.filter((f) => f.parentId === null);
}

/** Next numeric item id for a folder (items use small ints for ordering). */
export function nextItemId(items) {
  return items.reduce((m, i) => Math.max(m, i.id), 0) + 1;
}

/** Create a folder and persist. Returns the new folder object. */
export function createFolder(folders, fields) {
  const folder = {
    id: uid(),
    items: [],
    createdAt: new Date().toISOString().slice(0, 10),
    ...fields,
  };
  const next = [...folders, folder];
  saveLibrary({ folders: next });
  return { nextFolders: next, folder };
}

/** Append an item (e.g. a saved board position) to a folder and persist. */
export function addItemToFolder(folders, folderId, fields) {
  const next = folders.map((f) =>
    f.id === folderId ? { ...f, items: [...f.items, { id: nextItemId(f.items), ...fields }] } : f
  );
  saveLibrary({ folders: next });
  return next;
}