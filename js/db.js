// IndexedDB storage. Everything stays on this phone; backups are JSON files the user exports.
const NAME = 'lensy';
const STORES = ['lenses', 'care', 'wish', 'wears', 'learned', 'kv'];
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

const done = (req) => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });

export async function all(store) {
  const db = await open();
  return done(db.transaction(store).objectStore(store).getAll());
}
export async function get(store, id) {
  const db = await open();
  return done(db.transaction(store).objectStore(store).get(id));
}
export async function put(store, value) {
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(value);
  return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(value); tx.onerror = () => reject(tx.error); });
}
export async function del(store, id) {
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(id);
  return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
}

export async function dump() {
  const out = { app: 'lensy', version: 1, exportedAt: new Date().toISOString() };
  for (const s of STORES) out[s] = await all(s);
  return out;
}

// mode 'replace' wipes first; 'merge' keeps existing records and overwrites same ids.
export async function restore(data, mode) {
  if (!data || data.app !== 'lensy') throw new Error('这不是 Lensy 的备份文件');
  const db = await open();
  const tx = db.transaction(STORES, 'readwrite');
  for (const s of STORES) {
    const st = tx.objectStore(s);
    if (mode === 'replace') st.clear();
    for (const v of data[s] || []) st.put(v);
  }
  return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
}

export async function wipe() {
  const db = await open();
  const tx = db.transaction(STORES, 'readwrite');
  for (const s of STORES) tx.objectStore(s).clear();
  return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
}
