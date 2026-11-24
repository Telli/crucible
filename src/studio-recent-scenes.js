// The scenes Studio reopens from File > Open recent. A page cannot reopen a path, so each entry is kept the way the browser
// allows, and the entry says which: a file handle (where the File System Access API gave one, kept in IndexedDB and asked
// for permission again when needed), or a bounded copy of the recipe text (everywhere else). A host that owns the file
// system (a desktop shell) supplies its own list through `host`, and nothing is kept here.
//
// `host` is { list(): Promise<[{ id, name }]>, open(id): Promise<{ text, fileName, filePath? }>, remember?({ name, filePath }),
// remove?(id), clear?() }.

export const RECENT_SCENE_LIMIT = 8;
// The copies of all entries together stay under this many characters of recipe text, so the recent list never fills the
// few megabytes a page may store. One scene over the cap is not remembered; it is opened, not listed.
export const RECENT_COPY_CHARACTER_LIMIT = 1_000_000;
export const RECENT_INDEX_KEY = 'crucible.studio.recent';
const COPY_KEY_PREFIX = 'crucible.studio.recent.copy.';
const HANDLE_DATABASE_NAME = 'crucible-studio';
const HANDLE_STORE_NAME = 'recent-handles';

/** Thrown when an entry cannot be opened any more. The entry is already removed when this reaches the caller. */
export class RecentSceneUnavailable extends Error {
  constructor(name, reason) {
    super(`${name} can no longer be opened (${reason}), so it was removed from the recent list.`);
    this.name = 'RecentSceneUnavailable';
  }
}

function readIndex(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem(RECENT_INDEX_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(entry => entry && typeof entry.id === 'string' && typeof entry.name === 'string' && (entry.kind === 'handle' || entry.kind === 'copy'))
      .slice(0, RECENT_SCENE_LIMIT);
  } catch {
    return [];
  }
}

function writeIndex(storage, entries) {
  try {
    storage?.setItem(RECENT_INDEX_KEY, JSON.stringify(entries));
    return true;
  } catch {
    return false;
  }
}

function copyLength(storage, entry) {
  try {
    return storage?.getItem(COPY_KEY_PREFIX + entry.id)?.length ?? 0;
  } catch {
    return 0;
  }
}

/** The handles live in IndexedDB because a handle cannot be written as text. Returns null where IndexedDB is missing. */
export function createIndexedDbHandleStore(indexedDatabaseFactory = globalThis.indexedDB) {
  if (!indexedDatabaseFactory) return null;
  const openDatabase = () => new Promise((resolve, reject) => {
    const request = indexedDatabaseFactory.open(HANDLE_DATABASE_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(HANDLE_STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const run = async (mode, action) => {
    const database = await openDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction(HANDLE_STORE_NAME, mode);
        const request = action(transaction.objectStore(HANDLE_STORE_NAME));
        transaction.oncomplete = () => resolve(request?.result);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
  };
  return {
    put: (id, handle) => run('readwrite', store => store.put(handle, id)),
    get: id => run('readonly', store => store.get(id)),
    delete: id => run('readwrite', store => store.delete(id)),
    clear: () => run('readwrite', store => store.clear()),
  };
}

/**
 * The recent list. `storage` is the page's key-value storage (the one Studio keeps its preferences in), `handleStore` is
 * { put, get, delete, clear } over file handles or null, and `host` replaces both when a shell supplies the list.
 */
export function createRecentScenes({ storage, handleStore = null, host = null, createId = () => globalThis.crypto.randomUUID() } = {}) {
  async function dropEntry(entry) {
    try {
      storage?.removeItem(COPY_KEY_PREFIX + entry.id);
    } catch {
      // A copy that cannot be removed is unreachable once the index stops naming it.
    }
    if (entry.kind === 'handle') await handleStore?.delete(entry.id).catch(() => {});
  }

  async function sameFile(entry, handle) {
    if (entry.kind !== 'handle' || !handleStore) return false;
    try {
      const stored = await handleStore.get(entry.id);
      if (stored && typeof stored.isSameEntry === 'function') return await stored.isSameEntry(handle);
    } catch {
      // Fall through to the name.
    }
    return entry.name === handle.name;
  }

  async function findDuplicate(entries, { name, handle }) {
    for (const entry of entries) {
      const isDuplicate = handle ? await sameFile(entry, handle) : entry.kind === 'copy' && entry.name === name;
      if (isDuplicate) return entry;
    }
    return null;
  }

  // Oldest copies go first until the copies together fit; a handle costs no storage, so it is never dropped for size.
  async function trimCopies(entries) {
    const kept = [...entries];
    let total = kept.reduce((sum, entry) => sum + copyLength(storage, entry), 0);
    for (let index = kept.length - 1; index >= 0 && total > RECENT_COPY_CHARACTER_LIMIT; index -= 1) {
      if (kept[index].kind !== 'copy') continue;
      total -= copyLength(storage, kept[index]);
      await dropEntry(kept[index]);
      kept.splice(index, 1);
    }
    return kept;
  }

  const local = {
    async list() {
      return readIndex(storage).map(({ id, name, kind }) => ({ id, name, kind }));
    },

    /** Puts a scene first. Give `handle` (a file handle) or `text` (the recipe JSON). Returns 'remembered' or the reason it was not. */
    async remember({ name, handle = null, text = null }) {
      if (handle && !handleStore) return 'no-handle-store';
      if (!handle && (typeof text !== 'string' || text.length > RECENT_COPY_CHARACTER_LIMIT)) return 'too-large';
      const existing = readIndex(storage);
      const duplicate = await findDuplicate(existing, { name, handle });
      const entry = { id: duplicate?.id ?? createId(), name, kind: handle ? 'handle' : 'copy' };
      try {
        if (handle) await handleStore.put(entry.id, handle);
        else storage.setItem(COPY_KEY_PREFIX + entry.id, text);
      } catch {
        return 'storage-refused';
      }
      const others = existing.filter(item => item.id !== entry.id);
      for (const dropped of others.slice(RECENT_SCENE_LIMIT - 1)) await dropEntry(dropped);
      const trimmed = await trimCopies([entry, ...others.slice(0, RECENT_SCENE_LIMIT - 1)]);
      writeIndex(storage, trimmed);
      return 'remembered';
    },

    /** Resolves to { text, fileName, handle? }. An entry that cannot be read is removed and the error names it. */
    async open(id) {
      const entry = readIndex(storage).find(item => item.id === id);
      if (!entry) throw new RecentSceneUnavailable('This scene', 'it is not in the list');
      try {
        if (entry.kind === 'copy') {
          const text = storage.getItem(COPY_KEY_PREFIX + entry.id);
          if (typeof text !== 'string') throw new Error('the saved copy is gone');
          return { text, fileName: entry.name };
        }
        const handle = await handleStore.get(entry.id);
        if (!handle) throw new Error('the browser forgot the file');
        const granted = (await handle.queryPermission?.({ mode: 'read' })) === 'granted'
          || (await handle.requestPermission?.({ mode: 'read' })) === 'granted';
        if (!granted) throw new Error('permission was not given');
        const file = await handle.getFile();
        return { text: await file.text(), fileName: file.name, handle };
      } catch (error) {
        await local.remove(id);
        throw new RecentSceneUnavailable(entry.name, error.message);
      }
    },

    async remove(id) {
      const index = readIndex(storage);
      const entry = index.find(item => item.id === id);
      if (entry) await dropEntry(entry);
      writeIndex(storage, index.filter(item => item.id !== id));
    },

    async clear() {
      for (const entry of readIndex(storage)) await dropEntry(entry);
      writeIndex(storage, []);
    },
  };

  if (!host) return local;
  return {
    async list() {
      return (await host.list()).slice(0, RECENT_SCENE_LIMIT).map(({ id, name }) => ({ id: String(id), name, kind: 'host' }));
    },
    async remember({ name, filePath = null }) {
      await host.remember?.({ name, filePath });
      return 'remembered';
    },
    async open(id) {
      const name = (await host.list()).find(item => String(item.id) === id)?.name ?? 'This scene';
      try {
        const opened = await host.open(id);
        return { text: opened.text, fileName: opened.fileName ?? name, filePath: opened.filePath ?? null };
      } catch (error) {
        await host.remove?.(id);
        throw new RecentSceneUnavailable(name, error.message);
      }
    },
    remove: id => host.remove?.(id),
    clear: () => host.clear?.(),
  };
}
