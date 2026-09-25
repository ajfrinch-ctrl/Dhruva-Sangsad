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
let _opening = null;

/** Create any missing store/index. Idempotent — safe to run on every upgrade,
 *  including upgrades to a schema version this build does not know about. */
function applySchema(db, transaction) {
  for (const [name, cfg] of Object.entries(STORES)) {
    let os;
    if (!db.objectStoreNames.contains(name)) os = db.createObjectStore(name, { keyPath: cfg.keyPath });
    else os = transaction.objectStore(name);
    for (const [idxName, keyPath, opts] of (cfg.indexes || [])) {
      if (os.indexNames.contains(idxName)) continue;
      try { os.createIndex(idxName, keyPath, opts || {}); }
      catch (e) { console.warn(`[db] could not create index ${name}.${idxName}`, e); }
    }
  }
}

/** Open (or create) the database at `version`. `version == null` opens whatever
 *  version is already on disk (creating v1 when the database does not exist). */
function openConnection(version) {
  return new Promise((resolve, reject) => {
    let req, settled = false;
    const settle = (fn, value) => { if (settled) return; settled = true; fn(value); };
    try {
      req = version == null ? indexedDB.open(DB_NAME) : indexedDB.open(DB_NAME, version);
    } catch (e) { settle(reject, e); return; }
    req.onupgradeneeded = () => applySchema(req.result, req.transaction);
    req.onsuccess = () => {
      /* If we already gave up (blocked upgrade), do not leak this connection. */
      if (settled) { try { req.result.close(); } catch (_) {} return; }
      settle(resolve, req.result);
    };
    req.onerror = () => settle(reject, req.error || new Error('IndexedDB open failed'));
    /* Another tab is holding an older version open: say so instead of hanging
       forever waiting for an upgrade that will never run. */
    req.onblocked = () => settle(reject, new DOMException(
      `IndexedDB "${DB_NAME}" upgrade is blocked — close other ধ্রুব সংসদ tabs and reload.`,
      'InvalidStateError',
    ));
  });
}

/** Version of the database that is actually on disk right now (0 if unknown). */
async function existingVersion() {
  if (typeof indexedDB.databases === 'function') {
    try {
      const hit = (await indexedDB.databases() || []).find(d => d.name === DB_NAME);
      if (hit && typeof hit.version === 'number') return hit.version;
    } catch (_) { /* not supported everywhere (Safari) — fall through */ }
  }
  try {
    const db = await openConnection(null);
    const v = db.version;
    db.close();
    return v;
  } catch (_) { return 0; }
}

/** Stores/indexes this build needs that are not on disk. */
function missingSchema(db) {
  const stores = [], indexes = [];
  for (const [name, cfg] of Object.entries(STORES)) {
    if (!db.objectStoreNames.contains(name)) { stores.push(name); continue; }
    try {
      const os = db.transaction(name, 'readonly').objectStore(name);
      for (const [idxName] of (cfg.indexes || [])) if (!os.indexNames.contains(idxName)) indexes.push(`${name}.${idxName}`);
    } catch (_) { indexes.push(`${name}.*`); }
  }
  return { stores, indexes };
}

async function connect() {
  let db;
  try {
    db = await openConnection(DB_VERSION);
  } catch (err) {
    if (!err || err.name !== 'VersionError') throw err;
    /* Another build of this app (a newer deploy, a preview URL, a rolled-back
       branch…) already upgraded this database on this origin. IndexedDB refuses
       to open a database at a lower version than the one on disk, so instead of
       failing we re-open at the higher version — the schema applier above is
       additive, so the older build keeps working on the newer database. */
    const onDisk = await existingVersion();
    const target = Math.max(onDisk || 0, DB_VERSION);
    console.warn(`[db] "${DB_NAME}" is at version ${onDisk} but this build ships schema ${DB_VERSION} — re-opening at ${target}.`);
    db = await openConnection(target);
  }

  /* Opening at the version already on disk runs no upgrade transaction, so if
     that version was created by a different build some stores/indexes may still
     be missing. Bump once — our schema applier only ever adds, never drops. */
  const missing = missingSchema(db);
  if (missing.stores.length || missing.indexes.length) {
    console.warn(`[db] "${DB_NAME}" v${db.version} missing stores [${missing.stores.join(', ')}] indexes [${missing.indexes.join(', ')}] — repairing at v${db.version + 1}.`);
    const target = db.version + 1;
    try { db.close(); } catch (_) {}
    try { db = await openConnection(target); } catch (e) {
      console.warn('[db] repair blocked, continuing on the existing schema', e);
      db = await openConnection(null);
    }
  }

  db.onversionchange = () => {
    /* Another tab wants a newer schema: let go of the connection immediately. */
    try { db.close(); } catch (_) {}
    if (_db === db) { _db = null; _opening = null; }
  };
  db.onclose = () => { if (_db === db) { _db = null; _opening = null; } };
  return db;
}

export function openDB() {
  if (_db) return Promise.resolve(_db);
  if (!_opening) {
    _opening = connect().then(
      db => { _db = db; _opening = null; return db; },
      err => { _opening = null; throw err; },
    );
  }
  return _opening;
}

/** Version of the open database (or the version this build ships, if not open yet). */
export function dbVersion() {
  return _db ? _db.version : DB_VERSION;
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
  await dbPutRaw('settings', rec);
  if (queue) await enqueue('settings', key, 'put', rec);
  return rec;
}

/* --------- sync queue --------- */
export async function enqueue(store, recordId, op, payload) {
  const item = { id: uid('q'), store, recordId, op, payload, createdAt: nowISO(), tries: 0, deviceId: deviceId() };
  await dbPutRaw('syncQueue', item);
  window.dispatchEvent(new CustomEvent('ds:queue-changed', { detail: { reason: 'add' } }));
  return item;
}
export const queueAll = () => dbAll('syncQueue');
export const queueRemove = id => dbDeleteRaw('syncQueue', id).then(r => { window.dispatchEvent(new CustomEvent('ds:queue-changed', { detail: { reason: 'remove' } })); return r; });

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
  await dbPutRaw(store, rec);
  if (queue) await enqueue(store, rec.id, 'put', rec);
  window.dispatchEvent(new CustomEvent('ds:data-changed', { detail: { store, id: rec.id } }));
  return rec;
}

export async function removeRecord(store, id, { queue = true } = {}) {
  await dbDeleteRaw(store, id);
  if (queue) await enqueue(store, id, 'delete', { id });
  window.dispatchEvent(new CustomEvent('ds:data-changed', { detail: { store, id, deleted: true } }));
}

/** Apply a record that arrived from the server. Last-write-wins by updatedAt, never blind overwrite. */
export async function applyRemote(store, record) {
  if (!record || !record.id) return null;
  const local = await dbGet(store, record.id);
  // The untouched default admin (admin/admin) never wins against a record from
  // the server — otherwise a fresh device could keep admin/admin alive and then
  // overwrite the real admin in the cloud.
  const bootstrapLoses = store === 'users' && local && local.isBootstrap && !record.isBootstrap;
  if (local && !bootstrapLoses) {
    const lu = Date.parse(local.updatedAt || 0) || 0;
    const ru = Date.parse(record.updatedAt || 0) || 0;
    if (lu > ru) {
      // local is newer — keep local, keep a conflict copy for audit
      await dbPutRaw('meta', { key: `conflict_${store}_${record.id}_${ru}`, value: record, at: nowISO() });
      return local;
    }
  }
  const rec = { ...record, syncStatus: 'synced' };
  await dbPutRaw(store, rec);
  window.dispatchEvent(new CustomEvent('ds:data-changed', { detail: { store, id: rec.id, remote: true } }));
  return rec;
}

export async function markSynced(store, id) {
  const r = await dbGet(store, id);
  if (r) { r.syncStatus = 'synced'; await dbPutRaw(store, r); }
}

export async function exportAll() {
  const out = { app: 'Dhruvo Sangsad', version: dbVersion(), exportedAt: nowISO(), data: {} };
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
