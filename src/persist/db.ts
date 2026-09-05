import type { WorldSave } from './../sim/world.ts';

const DB_NAME = 'tiny-civilization';
const DB_VERSION = 1;
const STORE = 'worlds';
const INDEX = 'index';

export interface WorldMeta {
  id: string;
  name: string;
  seed: number;
  tick: number;
  savedAt: number;
  pop: number;
  polities: number;
  settlements: number;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(INDEX)) db.createObjectStore(INDEX, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    // A browser with storage blocked is not an error worth stopping for; the
    // world just lives in memory until the tab closes.
    req.onerror = () => resolve(null);
  });
  return dbPromise;
}

function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T | null> {
  return open().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) {
          resolve(null);
          return;
        }
        try {
          const tx = db.transaction(store, mode);
          const req = fn(tx.objectStore(store));
          req.onsuccess = () => resolve(req.result as T);
          req.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}

export async function listWorlds(): Promise<WorldMeta[]> {
  const all = await run<WorldMeta[]>(INDEX, 'readonly', (s) => s.getAll());
  return (all ?? []).sort((a, b) => b.savedAt - a.savedAt);
}

export async function saveWorld(save: WorldSave, meta: WorldMeta): Promise<boolean> {
  const a = await run<IDBValidKey>(STORE, 'readwrite', (s) => s.put(save));
  const b = await run<IDBValidKey>(INDEX, 'readwrite', (s) => s.put(meta));
  return a !== null && b !== null;
}

export async function loadWorld(id: string): Promise<WorldSave | null> {
  return run<WorldSave>(STORE, 'readonly', (s) => s.get(id));
}

export async function deleteWorld(id: string): Promise<void> {
  await run(STORE, 'readwrite', (s) => s.delete(id));
  await run(INDEX, 'readwrite', (s) => s.delete(id));
}
