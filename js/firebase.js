/* Central Firebase Realtime Database — single production source of truth.
   IndexedDB is only a cache / offline buffer. Native RTDB listeners keep
   every authorized device in sync; there is no setInterval polling. */
import { queueAll, queueRemove, applyRemote, dbGet, dbPutRaw, getSetting, setSetting } from './db.js';
import { deviceId, normalizeRecord, toMillis, normalizeMobile } from './util.js';

/* Primary cloud backend — ধ্রুব সংসদ production Firebase project.
   Every device must use this project. Other URLs are rejected. */
export const DEFAULT_FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBig1Ajmtb4wBSQI3B0Ie16DoSODeIZiDs',
  authDomain: 'dhruvo-sangsad.firebaseapp.com',
  databaseURL: 'https://dhruvo-sangsad-default-rtdb.firebaseio.com',
  projectId: 'dhruvo-sangsad',
  storageBucket: 'dhruvo-sangsad.firebasestorage.app',
  messagingSenderId: '262988571932',
  appId: '1:262988571932:web:9481147725a42ff71986d9',
  measurementId: 'G-V1ZFDHKEPY',
};

export const PRODUCTION_DATABASE_URL = DEFAULT_FIREBASE_CONFIG.databaseURL;
export const PRODUCTION_PROJECT_ID = DEFAULT_FIREBASE_CONFIG.projectId;

export function isProductionConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') return false;
  const url = String(cfg.databaseURL || '').replace(/\/+$/, '');
  const pid = String(cfg.projectId || '');
  return url === PRODUCTION_DATABASE_URL && pid === PRODUCTION_PROJECT_ID;
}

/** Always return the production project. Wrong / stale / disabled configs are ignored. */
export function resolveFirebaseConfig(saved) {
  const base = { ...DEFAULT_FIREBASE_CONFIG };
  if (saved && saved.__disabled) return { ...base };
  if (saved && saved.databaseURL && isProductionConfig(saved)) {
    return { ...base, ...saved, databaseURL: PRODUCTION_DATABASE_URL, projectId: PRODUCTION_PROJECT_ID };
  }
  return base;
}

const SYNCED_STORES = ['users', 'members', 'deposits', 'withdrawals', 'notifications', 'activityLogs', 'settings'];
const PATHS = {
  users: 'users', members: 'members', deposits: 'deposits', withdrawals: 'withdrawals',
  notifications: 'notifications', activityLogs: 'activityLogs', settings: 'settings',
};
const PENDING_PATH = 'pendingDeposits';
const APPROVALS_PATH = 'approvals';
const SYNCMETA_PATH = 'syncMetadata';
const AUTH_INDEX_PATH = 'authIndex';
const LOGIN_INDEX_PATH = 'loginIndex';
const UNIQUES_PATH = 'uniques';
const BALANCES_PATH = 'balances';
const METADATA_PATH = 'metadata';

function svTimestamp() {
  try { return window.firebase.database.ServerValue.TIMESTAMP; } catch { return Date.now(); }
}

function stripUndefined(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    if (v && typeof v === 'object' && !Array.isArray(v) && Object.prototype.toString.call(v) === '[object Object]' && !v['.sv']) {
      out[k] = stripUndefined(v);
    } else out[k] = v;
  }
  return out;
}

function uniqueKey(value) {
  return String(value || '').trim().toLowerCase().replace(/[.#$\[\]\/]/g, '_');
}

function loginKeysFor(identifier, user) {
  const keys = new Set();
  const add = v => { const k = uniqueKey(v); if (k) keys.add(k); };
  add(identifier);
  add(normalizeMobile(identifier));
  if (user) {
    add(user.username);
    add(normalizeMobile(user.username));
    add(user.memberId);
    if (user.email) add(String(user.email).trim().toLowerCase());
  }
  return [...keys];
}

function authEmailsFor(identifier, user) {
  const out = [];
  const seen = new Set();
  const push = email => {
    const e = String(email || '').trim().toLowerCase();
    if (e && /@/.test(e) && !seen.has(e)) { seen.add(e); out.push(e); }
  };
  const raw = String(identifier || '').trim();
  if (/@/.test(raw)) push(raw);
  const uname = uniqueKey(raw);
  if (uname) push(`${uname}@dhruvo-sangsad.local`);
  const mob = normalizeMobile(raw);
  if (mob) push(`${mob}@dhruvo-sangsad.local`);
  if (user) {
    if (user.email) push(user.email);
    if (user.username) push(`${uniqueKey(user.username)}@dhruvo-sangsad.local`);
  }
  return out;
}

class FirebaseBridge extends EventTarget {
  constructor() {
    super();
    this.app = null; this.auth = null; this.db = null;
    this.config = null; this.status = 'offline'; this.listeners = [];
    this.ready = false; this.lastError = null; this.syncing = false;
    this.connected = false; this.hydrated = false; this.session = null;
    this._hydrating = false;
  }

  get configured() { return !!this.config && !!this.config.databaseURL; }

  canWrite() { return !!(this.ready && this.db && this.connected && navigator.onLine); }

  isReadyOnline() { return this.canWrite(); }

  setStatus(s, err = null) {
    /* Collapse internal states onto the three user-facing connection states
       plus a short-lived synchronizing flag used by the chip. */
    let next = s;
    if (s === 'online' || s === 'synced') next = this.syncing || this._hydrating ? 'synchronizing' : 'connected';
    if (s === 'syncing') next = 'synchronizing';
    if (s === 'sync-error') next = this.connected ? 'connected' : 'offline';
    this.status = next;
    this.lastError = err;
    this.dispatchEvent(new CustomEvent('status', { detail: { status: next, error: err, raw: s } }));
    window.dispatchEvent(new CustomEvent('ds:sync-status', { detail: { status: next, error: err, raw: s } }));
  }

  async loadConfig() {
    const saved = await getSetting('firebaseConfig', null);
    this.config = resolveFirebaseConfig(saved);
    return this.config;
  }

  async saveConfig(cfg) {
    if (cfg && cfg.databaseURL) {
      const next = resolveFirebaseConfig(cfg);
      if (cfg.databaseURL.replace(/\/+$/, '') !== PRODUCTION_DATABASE_URL || cfg.projectId !== PRODUCTION_PROJECT_ID) {
        throw new Error('শুধুমাত্র production Firebase project (dhruvo-sangsad) ব্যবহার করা যাবে। / Only the production Firebase project is allowed.');
      }
      await setSetting('firebaseConfig', next, { queue: false });
      this.config = next;
    } else {
      /* Disconnect is not allowed to leave the app without a central DB.
         Re-attach the production project. */
      await setSetting('firebaseConfig', { ...DEFAULT_FIREBASE_CONFIG }, { queue: false });
      this.config = { ...DEFAULT_FIREBASE_CONFIG };
    }
    await this.teardown();
    await this.init();
    return this.config;
  }

  async teardown() {
    this.detachListeners();
    if (this.app) { try { await this.app.delete(); } catch {} }
    this.app = null; this.auth = null; this.db = null; this.ready = false;
    this.connected = false; this.hydrated = false;
  }

  detachListeners() {
    this.listeners.forEach(off => { try { off(); } catch {} });
    this.listeners = [];
  }

  async init() {
    await this.loadConfig();
    if (!this.config) { this.setStatus('offline'); return false; }
    if (typeof window.firebase === 'undefined') { this.setStatus('offline', 'Firebase SDK not loaded'); return false; }
    try {
      this.app = window.firebase.initializeApp(this.config, 'ds-' + Date.now());
      this.auth = this.app.auth();
      this.db = this.app.database();
      this.ready = true;
      this.watchConnection();
      await this.waitForConnection(5000);
      if (this.connected) this.setStatus('connected');
      else this.setStatus(navigator.onLine ? 'synchronizing' : 'offline');
      return true;
    } catch (e) {
      this.setStatus('offline', e.message);
      return false;
    }
  }

  waitForConnection(ms = 4000) {
    if (this.connected) return Promise.resolve(true);
    return new Promise(resolve => {
      const t = setTimeout(() => resolve(this.connected), ms);
      const on = () => {
        if (this.connected) { clearTimeout(t); this.removeEventListener('status', on); resolve(true); }
      };
      this.addEventListener('status', on);
    });
  }

  watchConnection() {
    if (!this.db) return;
    const ref = this.db.ref('.info/connected');
    const cb = ref.on('value', snap => {
      const connected = snap.val() === true;
      this.connected = connected;
      if (connected) {
        try { this.db.goOnline(); } catch {}
        this.setStatus(this.syncing || this._hydrating ? 'synchronizing' : 'connected');
        this.flush();
      } else {
        this.setStatus('offline');
      }
    });
    this.listeners.push(() => ref.off('value', cb));
  }

  /* ---------- listeners (native RTDB, not polling) ---------- */

  attachListeners(session) {
    if (!this.db) return;
    this.detachListeners();
    this.watchConnection();
    this.session = session || this.session;
    const s = this.session;
    const staff = s && (s.role === 'admin' || s.role === 'maker');

    if (staff) {
      for (const store of SYNCED_STORES) this.listenStore(store, this.db.ref(PATHS[store]));
      this.listenStore('pendingDeposits', this.db.ref(PENDING_PATH), { cache: false });
      this.listenStore('approvals', this.db.ref(APPROVALS_PATH), { cache: false });
      this.listenStore('balances', this.db.ref(BALANCES_PATH), { cache: false });
    } else if (s && s.role === 'member') {
      const mid = s.memberId || '';
      const doc = s.memberDocId || '';
      if (mid) {
        this.listenStore('members', this.db.ref('members').orderByChild('memberId').equalTo(mid));
        this.listenStore('deposits', this.db.ref('deposits').orderByChild('memberId').equalTo(mid));
        this.listenStore('withdrawals', this.db.ref('withdrawals').orderByChild('memberId').equalTo(mid));
        this.listenStore('notifications', this.db.ref('notifications').orderByChild('memberId').equalTo(mid));
      }
      if (s.id) this.listenValue('users', this.db.ref(`users/${s.id}`));
      if (doc) this.listenValue('balances', this.db.ref(`${BALANCES_PATH}/${doc}`), { cache: false });
      this.listenStore('settings', this.db.ref('settings'));
      if (s.id) this.listenStore('activityLogs', this.db.ref('activityLogs').orderByChild('userId').equalTo(s.id));
    }
  }

  listenStore(store, ref, { cache = true } = {}) {
    const apply = async snap => {
      const val = snap.val();
      if (!val) return;
      const rec = normalizeRecord(val);
      if (!cache) return;
      if (store === 'settings') {
        if (rec.key && rec.key !== 'firebaseConfig') {
          await dbPutRaw('settings', rec);
          window.dispatchEvent(new CustomEvent('ds:data-changed', { detail: { store: 'settings', id: rec.key, remote: true } }));
        }
      } else if (rec.id) {
        await applyRemote(store, rec);
      }
    };
    /* Initial snapshot — load current central state once. */
    const once = snap => {
      if (!cache) return;
      if (!snap.exists()) return;
      const val = snap.val();
      Promise.resolve().then(async () => {
        if (val && typeof val === 'object' && !val.id && !val.key) {
          for (const rec of Object.values(val)) {
            if (!rec) continue;
            const n = normalizeRecord(rec);
            if (store === 'settings') {
              if (n.key && n.key !== 'firebaseConfig') await dbPutRaw('settings', n);
            } else if (n.id) await applyRemote(store, n);
          }
        } else {
          await apply({ val: () => val });
        }
      }).catch(() => {});
    };
    ref.once('value', once);
    const a = ref.on('child_added', apply);
    const c = ref.on('child_changed', apply);
    const d = ref.on('child_removed', async snap => {
      if (!cache) return;
      const id = snap.key;
      if (store === 'settings') {
        /* never drop local firebaseConfig */
        if (id && id !== 'firebaseConfig') {
          try { const { dbDeleteRaw } = await import('./db.js'); await dbDeleteRaw('settings', id); } catch {}
        }
        return;
      }
      const local = await dbGet(store, id);
      if (local && local.syncStatus !== 'pending' && local.syncStatus !== 'local') {
        const db = await import('./db.js');
        await db.dbDeleteRaw(store, id);
        window.dispatchEvent(new CustomEvent('ds:data-changed', { detail: { store, id, deleted: true, remote: true } }));
      }
    });
    this.listeners.push(() => {
      try { ref.off('child_added', a); } catch {}
      try { ref.off('child_changed', c); } catch {}
      try { ref.off('child_removed', d); } catch {}
    });
  }

  listenValue(store, ref, { cache = true } = {}) {
    const cb = ref.on('value', async snap => {
      if (!cache) return;
      if (!snap.exists()) return;
      const rec = normalizeRecord(snap.val());
      if (store === 'settings') {
        if (rec.key && rec.key !== 'firebaseConfig') await dbPutRaw('settings', rec);
      } else if (rec && rec.id) {
        await applyRemote(store, rec);
      }
    });
    this.listeners.push(() => { try { ref.off('value', cb); } catch {} });
  }

  /* ---------- hydrate after login ---------- */

  async hydrate(session) {
    if (!this.ready || !this.db) throw new Error('Firebase is not configured');
    if (this.hydrated && this.session && session && this.session.id === session.id && this.connected && this.listeners.length) {
      this.session = session;
      return true;
    }
    this.session = session;
    this._hydrating = true;
    this.setStatus('synchronizing');
    try {
      if (!this.connected) await this.waitForConnection(6000);
      if (this.auth && this.auth.currentUser && session) {
        await this.publishAuthIndex(sessionUserFromSession(session));
      }
      if (session && (session.role === 'admin' || session.role === 'maker')) {
        await this.pullAll();
        try { await this.rebuildAllBalances(); } catch (e) { this.lastError = e.message; }
        try { await this.backfillIndexes(); } catch (e) { this.lastError = e.message; }
      } else if (session && session.role === 'member') {
        await this.pullMemberScope(session);
        if (session.memberDocId) {
          try { await this.rebuildBalance(session.memberDocId); } catch (e) { this.lastError = e.message; }
        }
      }
      this.attachListeners(session);
      this.hydrated = true;
      await this.flush();
      try {
        await this.db.ref(`${METADATA_PATH}/app`).update({
          source: 'firebase-rtdb',
          projectId: PRODUCTION_PROJECT_ID,
          databaseURL: PRODUCTION_DATABASE_URL,
          updatedAt: svTimestamp(),
        });
      } catch {}
    } finally {
      this._hydrating = false;
      this.setStatus(this.connected ? 'connected' : 'offline');
    }
    return true;
  }

  async pullMemberScope(session) {
    if (!this.ready) return 0;
    let n = 0;
    const mid = session.memberId;
    const applyList = async (store, snap) => {
      if (!snap || !snap.exists()) return;
      const val = snap.val();
      for (const rec of Object.values(val)) {
        if (rec && rec.id) { await applyRemote(store, normalizeRecord(rec)); n++; }
      }
    };
    if (mid) {
      await applyList('members', await this.db.ref('members').orderByChild('memberId').equalTo(mid).get());
      await applyList('deposits', await this.db.ref('deposits').orderByChild('memberId').equalTo(mid).get());
      await applyList('withdrawals', await this.db.ref('withdrawals').orderByChild('memberId').equalTo(mid).get());
      await applyList('notifications', await this.db.ref('notifications').orderByChild('memberId').equalTo(mid).get());
    }
    if (session.id) {
      const u = await this.db.ref(`users/${session.id}`).get();
      if (u.exists()) { await applyRemote('users', normalizeRecord(u.val())); n++; }
    }
    const setSnap = await this.db.ref('settings').get();
    if (setSnap.exists()) {
      for (const rec of Object.values(setSnap.val())) {
        if (rec && rec.key && rec.key !== 'firebaseConfig') { await dbPutRaw('settings', rec); n++; }
      }
    }
    window.dispatchEvent(new CustomEvent('ds:data-changed', { detail: { store: '*', remote: true } }));
    return n;
  }

  /* ---------- central writes (source of truth) ---------- */

  async commit(op, store, record) {
    if (!this.canWrite()) {
      const err = new Error('Central database is offline');
      err.code = 'offline';
      throw err;
    }
    this.syncing = true;
    this.setStatus('synchronizing');
    try {
      if (op === 'delete') return await this.commitDelete(store, record);
      return await this.commitPut(store, record);
    } finally {
      this.syncing = false;
      this.setStatus(this.connected ? 'connected' : 'offline');
    }
  }

  recordKey(store, rec) { return store === 'settings' ? rec.key : rec.id; }

  async commitPut(store, record) {
    if (!SYNCED_STORES.includes(store)) return record;
    if (store === 'settings' && record.key === 'firebaseConfig') return record;
    if (store === 'users' && record.isBootstrap) {
      /* Never publish the default admin/admin bootstrap account. */
      return record;
    }
    const key = this.recordKey(store, record);
    if (!key) throw new Error('Record id missing');
    const path = `${PATHS[store]}/${key}`;
    const ref = this.db.ref(path);
    let previous = null;
    try { const prevSnap = await ref.get(); if (prevSnap.exists()) previous = prevSnap.val(); } catch {}
    const SV = svTimestamp();
    const incoming = stripUndefined({
      ...record,
      updatedAt: SV,
      serverTime: SV,
      syncStatus: 'synced',
      deviceId: deviceId(),
    });
    if (incoming.createdAt == null || incoming.createdAt === '') incoming.createdAt = SV;

    if (store === 'members') await this.claimMemberUniques(incoming);

    const result = await ref.transaction(current => {
      if (store === 'activityLogs' && current) return current; /* append-only */
      if (current) {
        return stripUndefined({
          ...current,
          ...incoming,
          createdAt: current.createdAt || incoming.createdAt,
          id: current.id || incoming.id,
        });
      }
      return incoming;
    });
    if (!result.committed) {
      throw new Error('ডাটা কনফ্লিক্ট হয়েছে, আবার চেষ্টা করুন / Data conflict — please retry');
    }
    const saved = normalizeRecord(result.snapshot.val() || incoming);
    if (store === 'deposits') {
      await this.mirrorDeposit(key, saved);
      await this.reconcileDepositBalance(previous, saved);
    }
    if (store === 'withdrawals') await this.reconcileWithdrawalBalance(previous, saved);
    if (store === 'members' || store === 'users') await this.writeIndexes(store, saved);
    await this.stampSyncMetadata(1);
    return saved;
  }

  async commitDelete(store, record) {
    const key = typeof record === 'string' ? record : this.recordKey(store, record);
    if (!key) return record;
    const existing = typeof record === 'object' ? record : await dbGet(store, key);
    await this.db.ref(`${PATHS[store]}/${key}`).remove();
    if (store === 'deposits') {
      await this.mirrorDeposit(key, null);
      if (existing && existing.status === 'approved') {
        await this.applyBalanceDelta(existing.memberDocId, { depositDelta: -(Number(existing.amount) || 0), opId: `del_${key}` });
      }
    }
    if (store === 'withdrawals' && existing && existing.status === 'approved') {
      await this.applyBalanceDelta(existing.memberDocId, { withdrawalDelta: -(Number(existing.amount) || 0), opId: `delw_${key}` });
    }
    if (store === 'members' && existing) await this.releaseMemberUniques(existing);
    await this.stampSyncMetadata(1);
    return { id: key, deleted: true };
  }

  /* ---------- uniqueness ---------- */

  async checkUniques({ memberId, mobile, whatsapp, email }, excludeId = null) {
    if (!this.canWrite()) return [];
    const errs = [];
    const check = async (field, value, msg) => {
      if (!value) return;
      const snap = await this.db.ref(`${UNIQUES_PATH}/${field}/${uniqueKey(value)}`).get();
      if (snap.exists() && snap.val() && snap.val().id && snap.val().id !== excludeId) errs.push({ field, msg });
    };
    await check('memberId', memberId, 'এই Member ID ইতোমধ্যে ব্যবহৃত হয়েছে। / This Member ID already exists.');
    await check('mobile', normalizeMobile(mobile), 'এই মোবাইল নম্বর ইতোমধ্যে একজন সদস্যের জন্য ব্যবহৃত হয়েছে।');
    await check('whatsapp', normalizeMobile(whatsapp), 'এই WhatsApp নম্বর ইতোমধ্যে একজন সদস্যের জন্য ব্যবহৃত হয়েছে।');
    await check('email', String(email || '').trim().toLowerCase(), 'এই Email ID ইতোমধ্যে একজন সদস্যের জন্য ব্যবহৃত হয়েছে।');
    return errs;
  }

  async claimMemberUniques(member) {
    const prev = member.id ? (await this.db.ref(`members/${member.id}`).get()).val() : null;
    const pairs = [
      ['memberId', member.memberId],
      ['mobile', normalizeMobile(member.mobile)],
      ['whatsapp', normalizeMobile(member.whatsapp)],
      ['email', String(member.email || '').trim().toLowerCase()],
    ];
    if (prev) {
      const oldPairs = [
        ['memberId', prev.memberId],
        ['mobile', normalizeMobile(prev.mobile)],
        ['whatsapp', normalizeMobile(prev.whatsapp)],
        ['email', String(prev.email || '').trim().toLowerCase()],
      ];
      for (const [field, oldVal] of oldPairs) {
        const next = (pairs.find(p => p[0] === field) || [])[1];
        if (oldVal && uniqueKey(oldVal) !== uniqueKey(next)) {
          try { await this.db.ref(`${UNIQUES_PATH}/${field}/${uniqueKey(oldVal)}`).remove(); } catch {}
        }
      }
    }
    for (const [field, value] of pairs) {
      if (!value) continue;
      const result = await this.db.ref(`${UNIQUES_PATH}/${field}/${uniqueKey(value)}`).transaction(cur => {
        if (cur && cur.id && cur.id !== member.id) return; /* abort — taken */
        return { id: member.id, field, value: String(value), updatedAt: svTimestamp() };
      });
      if (!result.committed) {
        throw new Error(field === 'email'
          ? 'এই Email ID ইতোমধ্যে একজন সদস্যের জন্য ব্যবহৃত হয়েছে।'
          : field === 'whatsapp'
            ? 'এই WhatsApp নম্বর ইতোমধ্যে একজন সদস্যের জন্য ব্যবহৃত হয়েছে।'
            : field === 'memberId'
              ? 'এই Member ID ইতোমধ্যে ব্যবহৃত হয়েছে। / This Member ID already exists.'
              : 'এই মোবাইল নম্বর ইতোমধ্যে একজন সদস্যের জন্য ব্যবহৃত হয়েছে।');
      }
    }
  }

  async releaseMemberUniques(member) {
    const pairs = [
      ['memberId', member.memberId],
      ['mobile', normalizeMobile(member.mobile)],
      ['whatsapp', normalizeMobile(member.whatsapp)],
      ['email', String(member.email || '').trim().toLowerCase()],
    ];
    for (const [field, value] of pairs) {
      if (!value) continue;
      try {
        const ref = this.db.ref(`${UNIQUES_PATH}/${field}/${uniqueKey(value)}`);
        const snap = await ref.get();
        if (snap.exists() && snap.val() && snap.val().id === member.id) await ref.remove();
      } catch {}
    }
  }

  async writeIndexes(store, rec) {
    if (!this.db || !rec) return;
    if (store === 'users') {
      for (const k of loginKeysFor(rec.username, rec)) {
        try {
          await this.db.ref(`${LOGIN_INDEX_PATH}/${k}`).set({
            localId: rec.id, role: rec.role || 'member',
            memberDocId: rec.memberDocId || null, memberId: rec.memberId || null,
            username: rec.username || '', updatedAt: svTimestamp(),
          });
        } catch {}
      }
    }
  }

  async backfillIndexes() {
    if (!this.canWrite()) return;
    const { dbAll } = await import('./db.js');
    const users = await dbAll('users');
    const members = await dbAll('members');
    for (const u of users) {
      if (u.isBootstrap) continue;
      await this.writeIndexes('users', u);
    }
    for (const m of members) {
      try { await this.claimMemberUniques(m); } catch {}
    }
  }

  /* ---------- balances (derived + transactional) ---------- */

  async applyBalanceDelta(memberDocId, { depositDelta = 0, withdrawalDelta = 0, opId }) {
    if (!this.db || !memberDocId) return null;
    const result = await this.db.ref(`${BALANCES_PATH}/${memberDocId}`).transaction(cur => {
      const bal = cur || { memberDocId, totalDeposit: 0, totalWithdrawal: 0, available: 0, ops: {} };
      if (opId && bal.ops && bal.ops[opId]) return bal; /* idempotent */
      const nextDep = (Number(bal.totalDeposit) || 0) + depositDelta;
      const nextWit = (Number(bal.totalWithdrawal) || 0) + withdrawalDelta;
      if (nextDep < -0.0001 || nextWit < -0.0001) return; /* abort */
      const available = nextDep - nextWit;
      if (withdrawalDelta > 0 && available < -0.0001) return; /* overdraft */
      const ops = { ...(bal.ops || {}) };
      if (opId) ops[opId] = { depositDelta, withdrawalDelta, at: Date.now() };
      return {
        memberDocId,
        totalDeposit: nextDep,
        totalWithdrawal: nextWit,
        available: Math.max(0, available),
        updatedAt: svTimestamp(),
        ops,
      };
    });
    if (!result.committed) {
      throw new Error('পর্যাপ্ত ব্যালান্স নেই অথবা কনফ্লিক্ট / Insufficient balance or conflict');
    }
    return result.snapshot.val();
  }

  async reconcileDepositBalance(prev, next) {
    const was = prev && prev.status === 'approved' ? Number(prev.amount) || 0 : 0;
    const now = next && next.status === 'approved' ? Number(next.amount) || 0 : 0;
    const delta = now - was;
    if (!delta || !(next || prev)) return;
    const memberDocId = (next && next.memberDocId) || (prev && prev.memberDocId);
    const id = (next && next.id) || (prev && prev.id);
    try { await this.applyBalanceDelta(memberDocId, { depositDelta: delta, opId: `depadj_${id}_${was}_${now}` }); }
    catch (e) { this.lastError = e.message; }
  }

  async reconcileWithdrawalBalance(prev, next) {
    const was = prev && prev.status === 'approved' ? Number(prev.amount) || 0 : 0;
    const now = next && next.status === 'approved' ? Number(next.amount) || 0 : 0;
    const delta = now - was;
    if (!delta || !(next || prev)) return;
    const memberDocId = (next && next.memberDocId) || (prev && prev.memberDocId);
    const id = (next && next.id) || (prev && prev.id);
    await this.applyBalanceDelta(memberDocId, { withdrawalDelta: delta, opId: `witadj_${id}_${was}_${now}` });
  }

  async rebuildBalance(memberDocId) {
    if (!this.db || !memberDocId) return null;
    const [depSnap, witSnap] = await Promise.all([
      this.db.ref('deposits').orderByChild('memberDocId').equalTo(memberDocId).get(),
      this.db.ref('withdrawals').orderByChild('memberDocId').equalTo(memberDocId).get(),
    ]);
    let totalDeposit = 0, totalWithdrawal = 0;
    if (depSnap.exists()) {
      for (const d of Object.values(depSnap.val())) if (d && d.status === 'approved') totalDeposit += Number(d.amount) || 0;
    }
    if (witSnap.exists()) {
      for (const w of Object.values(witSnap.val())) if (w && w.status === 'approved') totalWithdrawal += Number(w.amount) || 0;
    }
    const available = Math.max(0, totalDeposit - totalWithdrawal);
    await this.db.ref(`${BALANCES_PATH}/${memberDocId}`).update({
      memberDocId, totalDeposit, totalWithdrawal, available,
      updatedAt: svTimestamp(), rebuiltAt: svTimestamp(),
    });
    return { memberDocId, totalDeposit, totalWithdrawal, available };
  }

  async rebuildAllBalances() {
    const { dbAll } = await import('./db.js');
    const members = await dbAll('members');
    for (const m of members) {
      try { await this.rebuildBalance(m.id); } catch (e) { this.lastError = e.message; }
    }
  }

  /* ---------- queue flush (offline catch-up only) ---------- */

  async flush() {
    if (this.syncing) return 0;
    if (!this.ready || !this.connected || !navigator.onLine) return 0;
    const items = await queueAll();
    if (!items.length) { this.setStatus('connected'); return 0; }
    this.syncing = true;
    this.setStatus('synchronizing');
    let failed = 0, done = 0;
    for (const it of items.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))) {
      if (!SYNCED_STORES.includes(it.store)) { await queueRemove(it.id); continue; }
      if (it.store === 'settings' && it.recordId === 'firebaseConfig') { await queueRemove(it.id); continue; }
      if (it.store === 'users' && it.payload && it.payload.isBootstrap) { await queueRemove(it.id); continue; }
      try {
        if (it.op === 'delete') await this.commitDelete(it.store, it.payload || it.recordId);
        else {
          const remoteSnap = await this.db.ref(`${PATHS[it.store]}/${it.recordId}`).get();
          const remote = remoteSnap.exists() ? remoteSnap.val() : null;
          if (remote && toMillis(remote.updatedAt || remote.serverTime) > toMillis(it.payload && it.payload.updatedAt)) {
            await applyRemote(it.store, normalizeRecord(remote));
          } else {
            await this.commitPut(it.store, it.payload);
            const { markSynced } = await import('./db.js');
            await markSynced(it.store, it.recordId);
          }
        }
        await queueRemove(it.id);
        done++;
      } catch (e) {
        failed++;
        this.lastError = e.message;
      }
    }
    this.syncing = false;
    this.setStatus(this.connected ? 'connected' : 'offline', failed ? this.lastError : null);
    return done;
  }

  async mirrorDeposit(id, rec) {
    if (!this.ready || !this.db) return;
    try {
      if (!rec || rec.status !== 'pending') await this.db.ref(`${PENDING_PATH}/${id}`).remove();
      else {
        await this.db.ref(`${PENDING_PATH}/${id}`).set({
          id, memberId: rec.memberId || '', memberDocId: rec.memberDocId || '',
          memberName: rec.memberName || '', amount: Number(rec.amount) || 0,
          type: rec.type || '', method: rec.method || '', date: rec.date || '',
          submittedBy: rec.submittedBy || '', submittedAt: rec.submittedAt || rec.createdAt || svTimestamp(),
        });
      }
      if (rec && (rec.status === 'approved' || rec.status === 'rejected')) {
        await this.db.ref(`${APPROVALS_PATH}/${id}`).set({
          id, depositId: id, memberId: rec.memberId || '', amount: Number(rec.amount) || 0,
          status: rec.status, decidedBy: rec.reviewedBy || rec.updatedBy || rec.approvedBy || '',
          decidedAt: rec.reviewedAt || rec.approvedAt || rec.updatedAt || svTimestamp(),
          reason: rec.rejectReason || '',
        });
      }
    } catch (e) { this.lastError = e.message; }
  }

  async stampSyncMetadata(count = 0) {
    if (!this.ready || !this.db) return;
    try {
      const id = deviceId();
      await this.db.ref(`${SYNCMETA_PATH}/${id}`).set({
        deviceId: id, lastSyncAt: svTimestamp(), lastPushCount: count,
        userAgent: String(navigator.userAgent || '').slice(0, 120),
      });
    } catch (e) { this.lastError = e.message; }
  }

  /* ---------- auth ---------- */

  publishPayload(user) {
    return {
      localId: user.id || user.localId || user.username || '',
      role: user.role || 'member',
      username: user.username || '',
      memberId: user.memberId || null,
      memberDocId: user.memberDocId || null,
      updatedAt: svTimestamp(),
    };
  }

  async publishAuthIndex(user) {
    if (!this.db || !this.auth || !this.auth.currentUser || !user) return;
    const uid = this.auth.currentUser.uid;
    try {
      await this.db.ref(`${AUTH_INDEX_PATH}/${uid}`).set(this.publishPayload(user));
      await this.writeIndexes('users', user);
    } catch (e) { this.lastError = e.message; }
  }

  async signIn(user, password) {
    if (!this.ready || !this.auth) return null;
    const emails = authEmailsFor(user.username || user.email, user);
    let cred = null;
    for (const email of emails) {
      try { cred = await this.auth.signInWithEmailAndPassword(email, password); break; }
      catch (e) {
        if (e && (e.code === 'auth/user-not-found')) {
          try { cred = await this.auth.createUserWithEmailAndPassword(email, password); break; } catch {}
        }
      }
    }
    if (!cred) {
      const email = emails[0] || `${(user.username || 'user')}@dhruvo-sangsad.local`;
      try { cred = await this.auth.createUserWithEmailAndPassword(email, password); }
      catch { return null; }
    }
    if (cred && cred.user) await this.publishAuthIndex(user);
    return cred;
  }

  /**
   * Sign in against the central project and load the matching `users/` record.
   * Returns { user } on success, { denied: Error } when credentials are wrong
   * for an existing central account, or null when the account is unknown.
   */
  async signInIdentifier(identifier, password) {
    if (!this.ready || !this.auth) return null;
    const emails = authEmailsFor(identifier);
    let cred = null;
    let existed = false;
    for (const email of emails) {
      try {
        cred = await this.auth.signInWithEmailAndPassword(email, password);
        break;
      } catch (e) {
        if (!e) continue;
        if (e.code === 'auth/user-not-found') continue;
        if (e.code === 'auth/invalid-credential' || e.code === 'auth/wrong-password' || e.code === 'auth/invalid-email') {
          existed = existed || e.code === 'auth/wrong-password';
          continue;
        }
        if (e.code === 'auth/too-many-requests') {
          const err = new Error('অনেকবার ভুল চেষ্টা হয়েছে। পরে আবার চেষ্টা করুন। / Too many attempts. Try again later.');
          err.fatal = true;
          return { denied: err };
        }
      }
    }
    if (!cred) {
      const email = emails[0];
      if (email) {
        try { cred = await this.auth.createUserWithEmailAndPassword(email, password); }
        catch (e) {
          if (e && e.code === 'auth/email-already-in-use') {
            const err = new Error('ভুল User ID অথবা Password / Invalid user ID or password');
            err.fatal = true;
            return { denied: err };
          }
        }
      }
    }
    if (!cred || !cred.user) return existed ? { denied: new Error('ভুল User ID অথবা Password / Invalid user ID or password') } : null;

    const uid = cred.user.uid;
    let idx = null;
    try { idx = (await this.db.ref(`${AUTH_INDEX_PATH}/${uid}`).get()).val(); } catch {}
    if (!idx) {
      for (const k of loginKeysFor(identifier)) {
        try {
          const li = (await this.db.ref(`${LOGIN_INDEX_PATH}/${k}`).get()).val();
          if (li && li.localId) { idx = li; break; }
        } catch {}
      }
    }
    if (!idx || !idx.localId) {
      /* Newly created Auth user with no matching central record — drop it. */
      try { await cred.user.delete(); } catch {}
      return null;
    }
    let user = null;
    try { user = (await this.db.ref(`users/${idx.localId}`).get()).val(); } catch {}
    if (!user) {
      try { await cred.user.delete(); } catch {}
      return null;
    }
    user = normalizeRecord(user);
    await this.publishAuthIndex(user);
    try { await applyRemote('users', user); } catch {}
    return { user };
  }

  async emailInUse(email) {
    if (!this.auth || !email) return false;
    try {
      const methods = await this.auth.fetchSignInMethodsForEmail(email);
      if (methods && methods.length) return true;
    } catch {}
    try {
      await this.auth.createUserWithEmailAndPassword(email, `x${Date.now()}_${Math.random().toString(36).slice(2)}A1`);
      if (this.auth.currentUser) { try { await this.auth.currentUser.delete(); } catch {} }
      return false;
    } catch (e) {
      return !!(e && e.code === 'auth/email-already-in-use');
    }
  }

  async signOut() {
    this.detachListeners();
    this.session = null;
    this.hydrated = false;
    if (this.auth) { try { await this.auth.signOut(); } catch {} }
  }

  async updatePassword(pw) {
    if (this.auth && this.auth.currentUser) { try { await this.auth.currentUser.updatePassword(pw); } catch {} }
  }

  async pullAll() {
    if (!this.ready) throw new Error('Firebase is not configured');
    let n = 0;
    for (const store of SYNCED_STORES) {
      try {
        const snap = await this.db.ref(PATHS[store]).get();
        if (!snap.exists()) continue;
        const val = snap.val();
        for (const rec of Object.values(val)) {
          if (store === 'settings') { if (rec.key && rec.key !== 'firebaseConfig') await dbPutRaw('settings', rec); }
          else await applyRemote(store, normalizeRecord(rec));
          n++;
        }
      } catch (e) { this.lastError = e.message; }
    }
    window.dispatchEvent(new CustomEvent('ds:data-changed', { detail: { store: '*', remote: true } }));
    return n;
  }

  async pushAll() {
    if (!this.ready) throw new Error('Firebase is not configured');
    const { dbAll } = await import('./db.js');
    let n = 0;
    this.syncing = true;
    this.setStatus('synchronizing');
    try {
      for (const store of SYNCED_STORES) {
        const rows = await dbAll(store);
        for (const r of rows) {
          const key = store === 'settings' ? r.key : r.id;
          if (store === 'settings' && key === 'firebaseConfig') continue;
          if (store === 'users' && r.isBootstrap) continue;
          await this.commitPut(store, r);
          n++;
        }
      }
      await this.stampSyncMetadata(n);
    } finally {
      this.syncing = false;
      this.setStatus(this.connected ? 'connected' : 'offline');
    }
    return n;
  }

  verifyConfig() {
    const c = this.config || DEFAULT_FIREBASE_CONFIG;
    return {
      ok: isProductionConfig(c),
      apiKey: !!c.apiKey && c.apiKey === DEFAULT_FIREBASE_CONFIG.apiKey,
      authDomain: c.authDomain === DEFAULT_FIREBASE_CONFIG.authDomain,
      databaseURL: c.databaseURL === PRODUCTION_DATABASE_URL,
      projectId: c.projectId === PRODUCTION_PROJECT_ID,
      storageBucket: c.storageBucket === DEFAULT_FIREBASE_CONFIG.storageBucket,
      messagingSenderId: c.messagingSenderId === DEFAULT_FIREBASE_CONFIG.messagingSenderId,
      appId: c.appId === DEFAULT_FIREBASE_CONFIG.appId,
      connected: this.connected,
      ready: this.ready,
    };
  }
}

function sessionUserFromSession(s) {
  if (!s) return null;
  return {
    id: s.id, username: s.username, role: s.role,
    memberId: s.memberId, memberDocId: s.memberDocId, email: s.email,
  };
}

export const firebase = new FirebaseBridge();

/* connectivity — no polling. Flush only on reconnect / queued writes. */
window.addEventListener('online', () => {
  try { if (firebase.db) firebase.db.goOnline(); } catch {}
  firebase.setStatus(firebase.connected ? 'connected' : 'synchronizing');
  firebase.flush();
});
window.addEventListener('offline', () => firebase.setStatus('offline'));
window.addEventListener('ds:queue-changed', () => { if (firebase.canWrite()) firebase.flush(); });
