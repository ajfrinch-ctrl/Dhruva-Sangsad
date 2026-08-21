/* Firebase Realtime Database + Auth integration with an offline sync queue.
   The app is fully functional without Firebase; when a config is saved in
   Settings → Firebase, records sync in both directions in real time. */
import { queueAll, queueRemove, applyRemote, dbGet, dbPutRaw, getSetting, setSetting } from './db.js';
import { nowISO, deviceId } from './util.js';

/* Primary cloud backend — ধ্রুব সংসদ Firebase project.
   When no custom config has been saved (Settings → Firebase), the app connects
   to this project automatically so every device shares the same data. */
export const DEFAULT_FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBig1Ajmtb4wBSQI3B0Ie16DoSODeIZiDs',
  authDomain: 'dhruvo-sangsad.firebaseapp.com',
  databaseURL: 'https://dhruvo-sangsad-default-rtdb.firebaseio.com',
  projectId: 'dhruvo-sangsad',
  storageBucket: 'dhruvo-sangsad.firebasestorage.app',
  messagingSenderId: '262988571932',
  appId: '1:262988571932:web:9481147725a42ff71986d9',
};

const SYNCED_STORES = ['users', 'members', 'deposits', 'notifications', 'activityLogs', 'settings'];
const PATHS = {
  users: 'users', members: 'members', deposits: 'deposits',
  notifications: 'notifications', activityLogs: 'activityLogs', settings: 'settings',
};
/* Derived mirrors kept in sync alongside `deposits/` so that other devices can
   watch the approval workflow cheaply, plus the per-device sync heartbeat. */
const PENDING_PATH = 'pendingDeposits';
const APPROVALS_PATH = 'approvals';
const SYNCMETA_PATH = 'syncMetadata';
/* Maps a Firebase Auth uid → app account (localId + role) so security rules can
   enforce admin/maker/member separation without storing plaintext credentials. */
const AUTH_INDEX_PATH = 'authIndex';

class FirebaseBridge extends EventTarget {
  constructor() {
    super();
    this.app = null; this.auth = null; this.db = null;
    this.config = null; this.status = 'offline'; this.listeners = [];
    this.ready = false; this.lastError = null; this.syncing = false;
  }

  get configured() { return !!this.config && !!this.config.databaseURL; }

  setStatus(s, err = null) {
    this.status = s; this.lastError = err;
    this.dispatchEvent(new CustomEvent('status', { detail: { status: s, error: err } }));
    window.dispatchEvent(new CustomEvent('ds:sync-status', { detail: { status: s, error: err } }));
  }

  async loadConfig() {
    const saved = await getSetting('firebaseConfig', null);
    // An explicit "Disconnect" is stored as a marker so we don't silently re-attach.
    if (saved && saved.__disabled) { this.config = null; return null; }
    const cfg = (saved && saved.databaseURL) ? saved : DEFAULT_FIREBASE_CONFIG;
    this.config = cfg && cfg.databaseURL ? cfg : null;
    return this.config;
  }

  async saveConfig(cfg) {
    if (cfg && cfg.databaseURL) await setSetting('firebaseConfig', cfg, { queue: false });
    else await setSetting('firebaseConfig', { __disabled: true }, { queue: false });
    this.config = cfg && cfg.databaseURL ? cfg : null;
    await this.teardown();
    if (this.config) await this.init();
    else this.setStatus(navigator.onLine ? 'online' : 'offline');
    return this.config;
  }

  async teardown() {
    this.listeners.forEach(off => { try { off(); } catch {} });
    this.listeners = [];
    if (this.app) { try { await this.app.delete(); } catch {} }
    this.app = null; this.auth = null; this.db = null; this.ready = false;
  }

  async init() {
    await this.loadConfig();
    if (!this.config) { this.setStatus(navigator.onLine ? 'online' : 'offline'); return false; }
    if (typeof window.firebase === 'undefined') { this.setStatus('sync-error', 'Firebase SDK not loaded'); return false; }
    try {
      this.app = window.firebase.initializeApp(this.config, 'ds-' + Date.now());
      this.auth = this.app.auth();
      this.db = this.app.database();
      this.ready = true;
      this.watchConnection();
      this.attachListeners();
      this.setStatus(navigator.onLine ? 'online' : 'offline');
      this.flush();
      return true;
    } catch (e) {
      this.setStatus('sync-error', e.message);
      return false;
    }
  }

  watchConnection() {
    if (!this.db) return;
    const ref = this.db.ref('.info/connected');
    const cb = ref.on('value', snap => {
      const connected = snap.val() === true;
      this.setStatus(connected ? 'online' : 'offline');
      if (connected) this.flush();
    });
    this.listeners.push(() => ref.off('value', cb));
  }

  attachListeners() {
    if (!this.db) return;
    for (const store of SYNCED_STORES) {
      const ref = this.db.ref(PATHS[store]);
      const onChild = async snap => {
        const val = snap.val();
        if (!val) return;
        if (store === 'settings') {
          if (val.key && val.key !== 'firebaseConfig') await dbPutRaw('settings', val);
        } else {
          if (val.deviceId === deviceId() && val.syncStatus === 'synced') return;
          await applyRemote(store, val);
        }
      };
      const a = ref.on('child_added', onChild);
      const c = ref.on('child_changed', onChild);
      const d = ref.on('child_removed', async snap => {
        const id = snap.key;
        const local = await dbGet(store, id);
        if (local) {
          const db = await import('./db.js');
          await db.dbDeleteRaw(store, id);
          window.dispatchEvent(new CustomEvent('ds:data-changed', { detail: { store, id, deleted: true, remote: true } }));
        }
      });
      this.listeners.push(() => { ref.off('child_added', a); ref.off('child_changed', c); ref.off('child_removed', d); });
    }
  }

  /** Push all queued local operations up to Firebase. */
  async flush() {
    if (this.syncing) return 0;
    if (!this.ready || !navigator.onLine) return 0;
    const items = await queueAll();
    if (!items.length) { this.setStatus('synced'); return 0; }
    this.syncing = true;
    this.setStatus('syncing');
    let failed = 0, done = 0;
    for (const it of items.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))) {
      if (!SYNCED_STORES.includes(it.store)) { await queueRemove(it.id); continue; }
      if (it.store === 'settings' && it.recordId === 'firebaseConfig') { await queueRemove(it.id); continue; }
      try {
        const path = `${PATHS[it.store]}/${it.recordId}`;
        if (it.op === 'delete') await this.db.ref(path).remove();
        else {
          const payload = { ...it.payload, syncStatus: 'synced', syncedAt: nowISO() };
          const remoteSnap = await this.db.ref(path).get();
          const remote = remoteSnap.exists() ? remoteSnap.val() : null;
          if (remote && Date.parse(remote.updatedAt || 0) > Date.parse(payload.updatedAt || 0)) {
            await applyRemote(it.store, remote);   // server wins, do not clobber
          } else {
            await this.db.ref(path).set(payload);
            const { markSynced } = await import('./db.js');
            await markSynced(it.store, it.recordId);
          }
        }
        if (it.store === 'deposits') await this.mirrorDeposit(it.recordId, it.op === 'delete' ? null : it.payload);
        await queueRemove(it.id);
        done++;
      } catch (e) {
        failed++;
        this.lastError = e.message;
      }
    }
    this.syncing = false;
    if (done && !failed) await this.stampSyncMetadata(done);
    this.setStatus(failed ? 'sync-error' : 'synced', failed ? this.lastError : null);
    return done;
  }

  /** Keep `pendingDeposits/` and `approvals/` consistent with a deposit write. */
  async mirrorDeposit(id, rec) {
    if (!this.ready || !this.db) return;
    try {
      if (!rec || rec.status !== 'pending') await this.db.ref(`${PENDING_PATH}/${id}`).remove();
      else {
        await this.db.ref(`${PENDING_PATH}/${id}`).set({
          id, memberId: rec.memberId || '', memberDocId: rec.memberDocId || '',
          memberName: rec.memberName || '', amount: Number(rec.amount) || 0,
          type: rec.type || '', method: rec.method || '', date: rec.date || '',
          submittedBy: rec.submittedBy || '', submittedAt: rec.submittedAt || rec.createdAt || nowISO(),
        });
      }
      if (rec && (rec.status === 'approved' || rec.status === 'rejected')) {
        await this.db.ref(`${APPROVALS_PATH}/${id}`).set({
          id, depositId: id, memberId: rec.memberId || '', amount: Number(rec.amount) || 0,
          status: rec.status, decidedBy: rec.reviewedBy || rec.updatedBy || '',
          decidedAt: rec.reviewedAt || rec.updatedAt || nowISO(),
          reason: rec.rejectReason || '',
        });
      }
    } catch (e) { this.lastError = e.message; }
  }

  /** Per-device heartbeat so conflict resolution has a server-visible sync clock. */
  async stampSyncMetadata(count = 0) {
    if (!this.ready || !this.db) return;
    try {
      const id = deviceId();
      await this.db.ref(`${SYNCMETA_PATH}/${id}`).set({
        deviceId: id, lastSyncAt: nowISO(), lastPushCount: count,
        userAgent: String(navigator.userAgent || '').slice(0, 120),
      });
    } catch (e) { this.lastError = e.message; }
  }

  async signIn(user, password) {
    if (!this.ready || !this.auth) return null;
    const email = user.email && /@/.test(user.email) ? user.email : `${user.username}@dhruvo-sangsad.local`;
    let cred;
    try { cred = await this.auth.signInWithEmailAndPassword(email, password); }
    catch (e) {
      if (e && (e.code === 'auth/user-not-found' || e.code === 'auth/invalid-credential')) {
        try { cred = await this.auth.createUserWithEmailAndPassword(email, password); } catch { return null; }
      } else { return null; }
    }
    // Publish a uid → role index so security rules can resolve the app account.
    if (cred && cred.user && this.db) {
      try {
        await this.db.ref(`${AUTH_INDEX_PATH}/${cred.user.uid}`).set({
          localId: user.id || user.username || email,
          role: user.role || 'member',
          username: user.username || '',
          updatedAt: nowISO(),
        });
        this.flush(); // now that rules can resolve the role, push any queued writes
      } catch { /* non-fatal — rules may still be in test mode */ }
    }
    return cred;
  }
  async signOut() { if (this.auth) { try { await this.auth.signOut(); } catch {} } }
  async updatePassword(pw) {
    if (this.auth && this.auth.currentUser) { try { await this.auth.currentUser.updatePassword(pw); } catch {} }
  }

  async pullAll() {
    if (!this.ready) throw new Error('Firebase is not configured');
    let n = 0;
    for (const store of SYNCED_STORES) {
      const snap = await this.db.ref(PATHS[store]).get();
      if (!snap.exists()) continue;
      const val = snap.val();
      for (const rec of Object.values(val)) {
        if (store === 'settings') { if (rec.key && rec.key !== 'firebaseConfig') await dbPutRaw('settings', rec); }
        else await applyRemote(store, rec);
        n++;
      }
    }
    window.dispatchEvent(new CustomEvent('ds:data-changed', { detail: { store: '*' } }));
    return n;
  }

  async pushAll() {
    if (!this.ready) throw new Error('Firebase is not configured');
    const { dbAll } = await import('./db.js');
    let n = 0;
    for (const store of SYNCED_STORES) {
      const rows = await dbAll(store);
      for (const r of rows) {
        const key = store === 'settings' ? r.key : r.id;
        if (store === 'settings' && key === 'firebaseConfig') continue;
        await this.db.ref(`${PATHS[store]}/${key}`).set({ ...r, syncStatus: 'synced', syncedAt: nowISO() });
        if (store === 'deposits') await this.mirrorDeposit(key, r);
        n++;
      }
    }
    await this.stampSyncMetadata(n);
    return n;
  }
}

export const firebase = new FirebaseBridge();

/* connectivity + periodic flush */
window.addEventListener('online', () => { firebase.setStatus('online'); firebase.flush(); });
window.addEventListener('offline', () => firebase.setStatus('offline'));
window.addEventListener('ds:queue-changed', () => { if (navigator.onLine) firebase.flush(); });
setInterval(() => { if (navigator.onLine && firebase.ready) firebase.flush(); }, 30000);
