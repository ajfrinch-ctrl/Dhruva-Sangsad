/* IndexedDB offline-first store for ধ্রুব সংসদ */
import { uid, nowISO, deviceId } from './util.js';

const DB_NAME = 'dhruvo_sangsad';
const DB_VERSION = 2;

export const STORES = {
  users: { keyPath: 'id', indexes: [['username', 'username', { unique: false }], ['memberId', 'memberId'], ['role', 'role']] },
  members: { keyPath: 'id', indexes: [['mobile', 'mobile'], ['whatsapp', 'whatsapp'], ['email', 'email'], ['status', 'status']] },
  deposits: { keyPath: 'id', indexes: [['memberId', 'memberId'], ['status', 'status'], ['date', 'date']] },
  withdrawals: { keyPath: 'id', indexes: [['memberId', 'memberId'], ['memberDocId', 'memberDocId'], ['status', 'status'], ['date', 'date']] },
  notifications: { keyPath: 'id', indexes: [['createdAt', 'createdAt'], ['audience', 'audience']] },
  activityLogs: { keyPath: 'id', indexes: [['createdAt', 'createdAt'], ['userId', 'userId']] },
  settings: { keyPath: 'key' },
  syncQueue: { keyPath: 'id', indexes: [['createdAt', 'createdAt']] },
  meta: { keyPath: 'key' },
};

let _db = null;

export function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = ev => {
      const db = req.result;
      for (const [name, cfg] of Object.entries(STORES)) {
        let os;
        if (!db.objectStoreNames.contains(name)) os = db.createObjectStore(name, { keyPath: cfg.keyPath });
        else os = req.transaction.objectStore(name);
        for (const [idxName, keyPath, opts] of (cfg.indexes || [])) {
          if (!os.indexNames.contains(idxName)) os.createIndex(idxName, keyPath, opts || {});
        }
      }
    };
    req.onsuccess = () => { _db = req.result; _db.onversionchange = () => { _db.close(); _db = null; }; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function tx(store, mode = 'readonly') {
  return openDB().then(db => db.transaction(store, mode).objectStore(store));
}
const wrap = req => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

export const dbGet = (store, key) => tx(store).then(os => wrap(os.get(key)));
export const dbAll = (store) => tx(store).then(os => wrap(os.getAll()));
export const dbPutRaw = (store, value) => tx(store, 'readwrite').then(os => wrap(os.put(value)));
export const dbDeleteRaw = (store, key) => tx(store, 'readwrite').then(os => wrap(os.delete(key)));
export const dbClear = (store) => tx(store, 'readwrite').then(os => wrap(os.clear()));
export const dbCount = (store) => tx(store).then(os => wrap(os.count()));
export async function dbByIndex(store, index, value) {
  const os = await tx(store);
  return wrap(os.index(index).getAll(value));
}
export async function dbBulkPut(store, rows) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const t = db.transaction(store, 'readwrite');
    const os = t.objectStore(store);
    rows.forEach(r => os.put(r));
    t.oncomplete = () => res(rows.length);
    t.onerror = () => rej(t.error);
  });
}

/* --------- settings helpers --------- */
export async function getSetting(key, dflt = null) {
  const r = await dbGet('settings', key);
  return r === undefined || r === null ? dflt : r.value;
}
export async function setSetting(key, value, { queue = true } = {}) {
  const rec = { key, value, updatedAt: nowISO(), updatedBy: deviceId() };
  if (queue && key !== 'firebaseConfig') {
    const fb = await getBridge();
    if (fb && fb.canWrite()) {
      try {
        const committed = await fb.commit('put', 'settings', rec);
        const local = committed || rec;
        await dbPutRaw('settings', local);
        return local;
      } catch (e) {
        if (!(e && e.code === 'offline')) throw e;
      }
    }
  }
  await dbPutRaw('settings', rec);
  if (queue && key !== 'firebaseConfig') await enqueue('settings', key, 'put', rec);
  return rec;
}

/* --------- sync queue --------- */
export async function enqueue(store, recordId, op, payload) {
  const item = { id: uid('q'), store, recordId, op, payload, createdAt: nowISO(), tries: 0, deviceId: deviceId() };
  await dbPutRaw('syncQueue', item);
  window.dispatchEvent(new CustomEvent('ds:queue-changed'));
  return item;
}
export const queueAll = () => dbAll('syncQueue');
export const queueRemove = id => dbDeleteRaw('syncQueue', id).then(r => { window.dispatchEvent(new CustomEvent('ds:queue-changed')); return r; });

/* --------- record write with sync metadata --------- */
export async function saveRecord(store, record, { queue = true, actorId = null, touch = true } = {}) {
  const existing = record.id ? await dbGet(store, record.id) : null;
  const rec = {
    ...existing, ...record,
    id: record.id || uid(store.slice(0, 3)),
    createdAt: (existing && existing.createdAt) || record.createdAt || nowISO(),
    updatedAt: touch ? nowISO() : (record.updatedAt || nowISO()),
    updatedBy: actorId || record.updatedBy || null,
    deviceId: deviceId(),
    syncStatus: navigator.onLine ? 'pending' : 'local',
  };

  if (queue) {
    const fb = await getBridge();
    if (fb && fb.canWrite()) {
      try {
        const committed = await fb.commit('put', store, rec);
        const local = { ...normalizeRecord(committed || rec), syncStatus: 'synced' };
        await dbPutRaw(store, local);
        window.dispatchEvent(new CustomEvent('ds:data-changed', { detail: { store, id: local.id, remote: false } }));
        return local;
      } catch (e) {
        if (e && e.code === 'offline') {
          /* fall through to local queue */
        } else {
          throw e;
        }
      }
    }
  }

  await dbPutRaw(store, rec);
  if (queue) await enqueue(store, rec.id, 'put', rec);
  window.dispatchEvent(new CustomEvent('ds:data-changed', { detail: { store, id: rec.id } }));
  return rec;
}

export async function removeRecord(store, id, { queue = true } = {}) {
  const existing = await dbGet(store, id);
  if (queue) {
    const fb = await getBridge();
    if (fb && fb.canWrite()) {
      try {
        await fb.commit('delete', store, existing || { id });
        await dbDeleteRaw(store, id);
        window.dispatchEvent(new CustomEvent('ds:data-changed', { detail: { store, id, deleted: true } }));
        return;
      } catch (e) {
        if (!(e && e.code === 'offline')) throw e;
      }
    }
  }
  await dbDeleteRaw(store, id);
  if (queue) await enqueue(store, id, 'delete', { id });
  window.dispatchEvent(new CustomEvent('ds:data-changed', { detail: { store, id, deleted: true } }));
}

/** Apply a record that arrived from the central database.
    Server is the source of truth unless a local unsynced write is newer. */
export async function applyRemote(store, record) {
  if (!record || !record.id) return null;
  const incoming = normalizeRecord(record);
  const local = await dbGet(store, incoming.id);
  if (local && (local.syncStatus === 'pending' || local.syncStatus === 'local')) {
    const lu = toMillis(local.updatedAt);
    const ru = toMillis(incoming.updatedAt || incoming.serverTime);
    if (lu > ru) {
      await dbPutRaw('meta', { key: `conflict_${store}_${incoming.id}_${ru}`, value: incoming, at: nowISO() });
      return local;
    }
  }
  const rec = { ...incoming, syncStatus: 'synced' };
  await dbPutRaw(store, rec);
  window.dispatchEvent(new CustomEvent('ds:data-changed', { detail: { store, id: rec.id, remote: true } }));
  return rec;
}

export async function markSynced(store, id) {
  const r = await dbGet(store, id);
  if (r) { r.syncStatus = 'synced'; await dbPutRaw(store, r); }
}

export async function exportAll() {
  const out = { app: 'Dhruvo Sangsad', version: DB_VERSION, exportedAt: nowISO(), data: {} };
  for (const name of Object.keys(STORES)) out.data[name] = await dbAll(name);
  return out;
}

export async function importAll(payload, { wipe = true } = {}) {
  if (!payload || !payload.data) throw new Error('Invalid backup file');
  const names = Object.keys(STORES).filter(n => payload.data[n]);
  for (const n of names) {
    if (wipe) await dbClear(n);
    await dbBulkPut(n, payload.data[n]);
  }
  window.dispatchEvent(new CustomEvent('ds:data-changed', { detail: { store: '*', restore: true } }));
  return names;
}
