/**
 * Browser persistence for the app. Everything lives in localStorage, so it
 * survives refreshes and closed tabs.
 *
 *   prefs    – tool, brush colour, setbacks, layer toggles, panel size, basemap.
 *              Kept indefinitely, EXCEPT the basemap: it falls back to the
 *              default if the app hasn't been used for BASEMAP_TTL_MS.
 *   session  – the active piece of work (selection, edits, undo stack, map view).
 *              Restored as-is while it is younger than SESSION_TTL_MS. When it
 *              is older it is moved to History instead of being restored.
 *   history  – archived sessions (expired ones, or ones replaced by a new
 *              selection). The user can bring any of them back.
 */

const PREFS_KEY = "bla:prefs:v1";
const SESSION_KEY = "bla:session:v1";
const HISTORY_KEY = "bla:history:v1";

export const BASEMAP_TTL_MS = 24 * 60 * 60 * 1000;        // 24 hours
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;    // 7 days
export const HISTORY_MAX = 20;

function read(key) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.warn("Could not save to localStorage:", e);
    return false;
  }
}

function remove(key) {
  try { window.localStorage.removeItem(key); } catch { /* ignore */ }
}

/* ───────────── prefs ───────────── */

export function loadPrefs(now = Date.now()) {
  const prefs = read(PREFS_KEY) || {};
  if (prefs.basemap && (!prefs.lastActive || now - prefs.lastActive > BASEMAP_TTL_MS)) {
    delete prefs.basemap; // stale -> back to the default basemap
  }
  return prefs;
}

export function patchPrefs(patch) {
  write(PREFS_KEY, { ...(read(PREFS_KEY) || {}), ...patch, lastActive: Date.now() });
}

/* ───────────── session ───────────── */

export function readSession() {
  return read(SESSION_KEY);
}

/** Load the active session; if it has expired, archive it and return null. */
export function loadSession(now = Date.now()) {
  const session = read(SESSION_KEY);
  if (!session) return null;
  if (now - (session.savedAt || 0) > SESSION_TTL_MS) {
    archiveSession(session, "expired");
    remove(SESSION_KEY);
    return null;
  }
  return session;
}

/** Merge a slice into the active session (and refresh its timestamp). */
export function saveSession(patch) {
  write(SESSION_KEY, { ...(read(SESSION_KEY) || {}), ...patch, savedAt: Date.now() });
}

/** Replace the active session outright (drops slices from the previous one). */
export function replaceSession(session) {
  write(SESSION_KEY, { ...session, savedAt: Date.now() });
}

export function clearSession() {
  remove(SESSION_KEY);
}

/* ───────────── history ───────────── */

export function loadHistory() {
  const list = read(HISTORY_KEY);
  return Array.isArray(list) ? list : [];
}

export function archiveSession(session, reason = "replaced") {
  if (!session?.selection) return; // nothing worth keeping
  const id = `h-${session.savedAt || Date.now()}`;
  const list = loadHistory();
  if (list.some((e) => e.id === id)) return; // already archived

  const entry = {
    id,
    reason,
    savedAt: session.savedAt || Date.now(),
    archivedAt: Date.now(),
    summary: session.summary || null,
    // The undo stack isn't worth the storage space in an archive.
    session: { ...session, history: null },
  };

  let next = [entry, ...list].slice(0, HISTORY_MAX);
  // localStorage is small; if it's full, drop the oldest entries until it fits.
  while (next.length && !write(HISTORY_KEY, next)) next = next.slice(0, -1);
}

export function removeHistoryEntry(id) {
  write(HISTORY_KEY, loadHistory().filter((e) => e.id !== id));
}

export function clearHistory() {
  remove(HISTORY_KEY);
}