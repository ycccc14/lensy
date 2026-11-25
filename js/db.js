// IndexedDB storage. Everything stays on this phone; backups are JSON files the user exports.
import { STORES, cleanBackup, mergeSettings, exportSettings } from './backup.js';

const NAME = 'lensy';
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

// The backup file. This phone's push id + secret stay out of it (they would let anyone with the file
// read this phone's reminders from the push server).
export async function dump() {
  const out = { app: 'lensy', version: 1, exportedAt: new Date().toISOString() };
  for (const s of STORES) out[s] = await all(s);
  out.kv = out.kv.map((r) => (r.id === 'settings' ? { ...r, value: exportSettings(r.value) } : r));
  return out;
}

// mode 'replace' wipes first; 'merge' keeps existing records and overwrites same ids.
// The file is checked completely first (js/backup.js); a bad file throws before anything is written.
// Everything happens in one transaction: if any write fails, nothing is cleared or changed.
export async function restore(data, mode) {
  const clean = cleanBackup(data);
  const local = await get('kv', 'settings');
  const settings = mergeSettings(local && local.value, clean, mode);
  const db = await open();
  const tx = db.transaction(STORES, 'readwrite');
  const result = new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(clean.counts);
    tx.onerror = () => reject(tx.error || new Error('导入失败，原来的资料没有改动'));
    tx.onabort = () => reject(tx.error || new Error('导入失败，原来的资料没有改动'));
  });
  try {
    for (const s of STORES) {
      const st = tx.objectStore(s);
      if (mode === 'replace') st.clear();
      if (s === 'kv') st.put({ id: 'settings', value: settings });
      else for (const v of clean[s]) st.put(v);
    }
  } catch (e) {
    try { tx.abort(); } catch (err) { /* already finished */ }
    result.catch(() => {});
    throw e;
  }
  return result;
}

export async function wipe() {
  const db = await open();
  const tx = db.transaction(STORES, 'readwrite');
  for (const s of STORES) tx.objectStore(s).clear();
  return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
}
