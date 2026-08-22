/* Firebase Storage file upload, metadata sync and reusable file UI.
   Binary files live in Storage; only metadata is cached in IndexedDB / RTDB. */
import { el, esc, toast, fmtDateTime, confirmBox, modal, downloadBlob, uid, nowISO } from './util.js';
import { icon } from './icons.js';
import { page, card, tableWrap, banner, btn, kv } from './ui.js';
import { firebase } from './firebase.js';
import { dbGet, saveRecord, removeRecord, getSetting } from './db.js';
import { allFiles, allMembers, logActivity, invalidate } from './store.js';

export const DEFAULT_ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
export const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024;
export const FILES_PATH = 'filesData';

const TYPE_LABEL = {
  'image/jpeg': 'JPEG Image',
  'image/png': 'PNG Image',
  'image/webp': 'WebP Image',
  'application/pdf': 'PDF Document',
};

/* ---------------- settings-backed limits (Admin Settings can override later) ---------------- */
export async function getAllowedTypes() {
  const v = await getSetting('allowedFileTypes', null);
  if (Array.isArray(v) && v.length) return v.map(s => String(s).trim()).filter(Boolean);
  if (typeof v === 'string' && v.trim()) return v.split(',').map(s => s.trim()).filter(Boolean);
  return DEFAULT_ALLOWED_TYPES.slice();
}
export async function getMaxFileSize() {
  const n = Number(await getSetting('maxFileSizeBytes', null));
  return n > 0 ? n : DEFAULT_MAX_FILE_SIZE;
}

/* ---------------- pure helpers ---------------- */
export function formatSize(n) {
  const v = Number(n) || 0;
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(v < 10 * 1024 ? 1 : 0)} KB`;
  return `${(v / (1024 * 1024)).toFixed(2)} MB`;
}
export function fileTypeLabel(ct) { return TYPE_LABEL[ct] || ct || 'Unknown'; }

export function sanitizeFileName(name) {
  const raw = String(name == null ? '' : name);
  const base = raw.replace(/\\/g, '/').split('/').pop() || 'file';
  let cleaned = base.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/g, '').replace(/\.{2,}/g, '.');
  if (!cleaned || cleaned === '.' || cleaned === '_') cleaned = 'file';
  if (cleaned.length > 80) {
    const dot = cleaned.lastIndexOf('.');
    const ext = dot > 0 ? cleaned.slice(dot, dot + 10) : '';
    cleaned = cleaned.slice(0, Math.max(1, 80 - ext.length)) + ext;
  }
  return cleaned;
}

export function uniqueFileId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return uid('f').replace(/^f_/, '');
}

export function buildStoragePath(uidStr, fileId, safeName) {
  const safeUid = String(uidStr || '').replace(/[^A-Za-z0-9_-]/g, '');
  const safeId = String(fileId || '').replace(/[^A-Za-z0-9._-]/g, '');
  const safe = sanitizeFileName(safeName);
  if (!safeUid || !safeId) throw new Error('Invalid storage path');
  return `uploads/${safeUid}/${safeId}_${safe}`;
}

export function canViewFile(file, session) {
  if (!file || !session) return false;
  if (session.role === 'admin' || session.role === 'maker') return true;
  if (file.uploadedBy && file.uploadedBy === session.id) return true;
  if (session.memberId && file.memberId && file.memberId === session.memberId) return true;
  if (session.memberDocId && file.memberDocId && file.memberDocId === session.memberDocId) return true;
  return false;
}
export function canDeleteFile(file, session) {
  if (!file || !session) return false;
  if (session.role === 'admin' || session.role === 'maker') return true;
  return !!(file.uploadedBy && file.uploadedBy === session.id);
}

export async function validateFile(file) {
  if (!file) return { ok: false, error: 'ফাইল নির্বাচন করুন / Please select a file' };
  const max = await getMaxFileSize();
  const types = await getAllowedTypes();
  if (file.size > max) {
    return { ok: false, error: `ফাইলের আকার ${formatSize(max)}-এর বেশি / File too large (max ${formatSize(max)})` };
  }
  if (!types.includes(file.type)) {
    return { ok: false, error: `অসমর্থিত ফাইল টাইপ / Invalid file type. Allowed: JPEG, PNG, WebP, PDF` };
  }
  return { ok: true };
}

/* ---------------- error mapping ---------------- */
export function friendlyStorageError(err) {
  const code = String((err && (err.code || err.message)) || err || '');
  const server = String((err && err.serverResponse) || '');
  const blob = `${code} ${server}`;
  if (!navigator.onLine || /network-request-failed|offline|failed to fetch|network error/i.test(blob)) {
    return 'ইন্টারনেট সংযোগ প্রয়োজন / Internet connection required';
  }
  if (/storage\/unauthenticated|auth\/id-token|auth\/user-token|authentication expired|not signed in/i.test(blob)) {
    return 'লগইন মেয়াদ শেষ হয়েছে / Authentication expired — please log in again';
  }
  if (/storage\/unauthorized|permission-denied|PERMISSION_DENIED|permission denied/i.test(blob)) {
    return 'অনুমতি নেই / Permission denied';
  }
  if (/storage\/canceled|storage\/cancelled|canceled|cancelled/i.test(blob)) {
    return 'আপলোড বাতিল হয়েছে / Upload cancelled';
  }
  if (/storage\/object-not-found|object-not-found/i.test(blob)) {
    return 'ফাইল পাওয়া যায়নি / File not found';
  }
  if (/storage\/retry-limit|bucket not found|404|not been (set up|enabled)|storage is not enabled|invalid-default-bucket/i.test(blob)) {
    return 'Firebase Storage is not enabled. Please enable Storage in Firebase Console.';
  }
  if (/too large|invalid-argument.*size|file too large/i.test(blob)) {
    return 'ফাইলের আকার ১০ MB-এর বেশি / File too large (max 10 MB)';
  }
  if (/invalid.*type|content-type|unsupported/i.test(blob)) {
    return 'অসমর্থিত ফাইল টাইপ / Invalid file type';
  }
  if (/download.?url|getDownloadURL/i.test(blob)) {
    return 'ডাউনলোড লিংক পাওয়া যায়নি / Download URL unavailable';
  }
  if (/database|PERMISSION_DENIED|write failed/i.test(blob) && /filesData|metadata/i.test(blob)) {
    return 'ডাটাবেসে তথ্য সংরক্ষণ ব্যর্থ / Database write failed';
  }
  return (err && err.message) ? String(err.message) : 'আপলোড ব্যর্থ / Upload failed';
}

export async function waitForAuthUid(ms = 8000) {
  const existing = firebase.getAuthUid();
  if (existing) return existing;
  if (!firebase.auth) return null;
  return new Promise(resolve => {
    let done = false;
    const finish = uidVal => { if (done) return; done = true; resolve(uidVal || null); };
    const timer = setTimeout(() => finish(firebase.getAuthUid()), ms);
    let unsub = null;
    try {
      unsub = firebase.auth.onAuthStateChanged(user => {
        if (user && user.uid) {
          clearTimeout(timer);
          try { if (typeof unsub === 'function') unsub(); } catch {}
          finish(user.uid);
        }
      });
    } catch {
      clearTimeout(timer);
      finish(firebase.getAuthUid());
    }
  });
}

async function requireOnlineAuth() {
  if (!navigator.onLine) {
    const e = new Error('ইন্টারনেট সংযোগ প্রয়োজন / Internet connection required');
    e.code = 'offline';
    throw e;
  }
  if (!firebase.ready || !firebase.configured) {
    const e = new Error('Firebase সংযুক্ত নয় / Firebase is not connected');
    e.code = 'not-configured';
    throw e;
  }
  const session = window.DS_SESSION;
  if (!session) {
    const e = new Error('আপলোড করতে লগইন প্রয়োজন / Login required to upload');
    e.code = 'unauthenticated';
    throw e;
  }
  const uidVal = firebase.getAuthUid() || await waitForAuthUid(8000);
  if (!uidVal) {
    const e = new Error('লগইন মেয়াদ শেষ হয়েছে / Authentication expired — please log in again');
    e.code = 'unauthenticated';
    throw e;
  }
  const storage = firebase.getStorage();
  if (!storage) {
    const e = new Error('Firebase Storage is not enabled. Please enable Storage in Firebase Console.');
    e.code = 'storage-unavailable';
    throw e;
  }
  return { uid: uidVal, storage, session };
}

/* ---------------- upload / list / delete ---------------- */
export async function uploadFile(file, {
  session = null, memberId = '', memberDocId = '', onProgress = null, taskRef = null,
} = {}) {
  const actor = session || window.DS_SESSION;
  const { uid: authUid, storage } = await requireOnlineAuth();
  const check = await validateFile(file);
  if (!check.ok) {
    const e = new Error(check.error);
    e.code = 'validation';
    throw e;
  }

  const fileId = uniqueFileId();
  const safeName = sanitizeFileName(file.name);
  const storagePath = buildStoragePath(authUid, fileId, safeName);
  const storageRef = storage.ref(storagePath);
  const metadata = {
    contentType: file.type,
    customMetadata: {
      uploadedBy: actor ? String(actor.id || '') : '',
      originalName: String(file.name || safeName).slice(0, 120),
    },
  };

  const task = storageRef.put(file, metadata);
  if (taskRef) taskRef.current = task;

  await new Promise((resolve, reject) => {
    task.on('state_changed', snap => {
      if (typeof onProgress === 'function' && snap.totalBytes) {
        onProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100), snap);
      }
    }, reject, resolve);
  });

  let downloadURL = '';
  try {
    downloadURL = await task.snapshot.ref.getDownloadURL();
  } catch (err) {
    const e = new Error('ডাউনলোড লিংক পাওয়া যায়নি / Download URL unavailable');
    e.code = 'download-url';
    e.cause = err;
    throw e;
  }
  if (!downloadURL) {
    const e = new Error('ডাউনলোড লিংক পাওয়া যায়নি / Download URL unavailable');
    e.code = 'download-url';
    throw e;
  }

  const rec = {
    id: fileId,
    path: storagePath,
    url: downloadURL,
    downloadURL,
    fileName: safeName,
    originalName: file.name || safeName,
    contentType: file.type,
    size: file.size,
    uploadedBy: actor ? actor.id : '',
    uploadedByUid: authUid,
    uploadedByName: actor ? (actor.displayName || actor.username || actor.memberId || '') : '',
    uploadedAt: nowISO(),
    memberId: memberId || (actor && actor.role === 'member' ? (actor.memberId || '') : '') || '',
    memberDocId: memberDocId || (actor && actor.memberDocId) || '',
    status: 'active',
  };

  try {
    await saveRecord(FILES_PATH, rec, { queue: true, actorId: actor && actor.id });
    invalidate('files');
  } catch (err) {
    console.error('filesData write failed', err);
    try { await storageRef.delete(); } catch {}
    const e = new Error('ডাটাবেসে তথ্য সংরক্ষণ ব্যর্থ / Database write failed');
    e.code = 'db-write';
    e.cause = err;
    throw e;
  }

  try {
    await logActivity('FILE_UPLOAD', `Uploaded ${rec.fileName} (${formatSize(rec.size)})`, actor);
  } catch {}
  return rec;
}

export async function listAuthorizedFiles(session, { memberId = '' } = {}) {
  const all = await allFiles();
  return all
    .filter(f => f && f.status !== 'deleted' && canViewFile(f, session))
    .filter(f => !memberId || f.memberId === memberId)
    .sort((a, b) => String(b.uploadedAt || b.createdAt || '').localeCompare(String(a.uploadedAt || a.createdAt || '')));
}

export async function deleteFile(fileId, session) {
  const actor = session || window.DS_SESSION;
  if (!actor) throw new Error('আপলোড করতে লগইন প্রয়োজন / Login required');
  if (!navigator.onLine) throw new Error('ইন্টারনেট সংযোগ প্রয়োজন / Internet connection required');
  const rec = await dbGet(FILES_PATH, fileId);
  if (!rec) throw new Error('ফাইল পাওয়া যায়নি / File not found');
  if (!canDeleteFile(rec, actor)) throw new Error('অনুমতি নেই / Permission denied');

  const { storage } = await requireOnlineAuth();
  if (rec.path) {
    try {
      await storage.ref(rec.path).delete();
    } catch (err) {
      const code = String((err && err.code) || '');
      if (!/object-not-found/i.test(code)) {
        console.error('Storage delete failed', err);
        const e = new Error('স্টোরেজ থেকে ফাইল মুছা যায়নি / Storage delete failed — ' + friendlyStorageError(err));
        e.code = 'storage-delete';
        e.cause = err;
        throw e;
      }
    }
  }

  try {
    await removeRecord(FILES_PATH, rec.id, { queue: true });
    invalidate('files');
  } catch (err) {
    console.error('filesData delete failed', err);
    const e = new Error('ডাটাবেস রেকর্ড মুছা যায়নি / Database write failed');
    e.code = 'db-write';
    throw e;
  }
  try {
    await logActivity('FILE_DELETE', `Deleted ${rec.fileName} (${rec.id})`, actor);
  } catch {}
  return rec;
}

export async function viewFile(file, session) {
  const actor = session || window.DS_SESSION;
  const url = file && (file.url || file.downloadURL);
  if (!url) throw new Error('ডাউনলোড লিংক পাওয়া যায়নি / Download URL unavailable');
  try { await logActivity('FILE_VIEW', `Viewed file ${file.fileName} (${file.id})`, actor); } catch {}
  if ((file.contentType || '').startsWith('image/')) {
    const body = el('div');
    body.appendChild(el('img', {
      src: url, alt: file.fileName || 'image',
      style: 'max-width:100%;height:auto;border-radius:8px;display:block;margin:0 auto',
    }));
    const choice = await modal({
      title: file.fileName || 'Preview', body, width: 640,
      actions: [
        { label: 'Download', value: 'dl', kind: 'soft' },
        { label: 'Close', value: true, kind: 'ghost' },
      ],
    });
    if (choice === 'dl') await downloadFile(file, actor);
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

export async function downloadFile(file, session) {
  const url = file && (file.url || file.downloadURL);
  if (!url) throw new Error('ডাউনলোড লিংক পাওয়া যায়নি / Download URL unavailable');
  const name = file.fileName || file.originalName || 'download';
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('fetch failed');
    downloadBlob(await res.blob(), name);
  } catch {
    const a = el('a', { href: url, download: name, target: '_blank', rel: 'noopener' });
    document.body.appendChild(a); a.click(); a.remove();
  }
}

/* ---------------- reusable UI ---------------- */
export function renderUploader(session, { memberId = '', memberDocId = '', showMemberPick = false, onUploaded = null } = {}) {
  const box = el('div', { class: 'uploader' });
  const drop = el('label', { class: 'uploader-drop' });
  const input = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,application/pdf' });
  drop.append(
    el('div', { class: 'uploader-ico', html: icon('upload') }),
    el('div', { class: 'uploader-title', text: 'ফাইল নির্বাচন করুন / Select File' }),
    el('div', { class: 'uploader-hint', text: 'JPEG, PNG, WebP, PDF · সর্বোচ্চ ১০ MB' }),
    input,
  );
  const meta = el('div', { class: 'uploader-meta hidden' });
  const errBox = el('div', { class: 'uploader-err hidden' });
  const okBox = el('div', { class: 'banner ok hidden', html: `${icon('check')}<span>আপলোড সফল হয়েছে / Uploaded Successfully</span>` });
  const progWrap = el('div', { class: 'uploader-progress hidden' });
  const progBar = el('div', { class: 'progress' });
  const progFill = el('i');
  progBar.appendChild(progFill);
  const progLbl = el('div', { class: 'uploader-prog-lbl', text: '0%' });
  progWrap.append(progBar, progLbl);

  const taskRef = { current: null };
  let picked = null;
  let memberSel = null;

  const actions = el('div', { class: 'btn-row' });
  const uploadBtn = btn('আপলোড / Upload', 'upload', 'primary', () => startUpload());
  const cancelBtn = btn('বাতিল / Cancel', 'x', 'ghost', () => {
    if (taskRef.current && typeof taskRef.current.cancel === 'function') taskRef.current.cancel();
  });
  cancelBtn.classList.add('hidden');
  actions.append(uploadBtn, cancelBtn);

  function setErr(msg) {
    if (!msg) { errBox.classList.add('hidden'); errBox.textContent = ''; return; }
    errBox.classList.remove('hidden');
    errBox.innerHTML = `${icon('warn')}<span>${esc(msg)}</span>`;
  }
  function showMeta(file) {
    okBox.classList.add('hidden');
    meta.classList.remove('hidden');
    meta.replaceChildren(kv([
      ['ফাইলের নাম / File Name', esc(file.name)],
      ['আকার / File Size', esc(formatSize(file.size))],
      ['ধরন / File Type', esc(fileTypeLabel(file.type) + (file.type ? ` (${file.type})` : ''))],
    ]));
  }
  function resetPick() {
    picked = null;
    input.value = '';
    meta.classList.add('hidden');
    progWrap.classList.add('hidden');
    cancelBtn.classList.add('hidden');
    uploadBtn.disabled = false;
    drop.classList.remove('hidden');
  }

  async function startUpload() {
    setErr('');
    okBox.classList.add('hidden');
    if (!navigator.onLine) {
      setErr('ইন্টারনেট সংযোগ প্রয়োজন / Internet connection required');
      toast('ইন্টারনেট সংযোগ প্রয়োজন / Internet connection required', 'error');
      return;
    }
    if (!session) {
      setErr('আপলোড করতে লগইন প্রয়োজন / Login required to upload');
      return;
    }
    if (!picked) { setErr('ফাইল নির্বাচন করুন / Please select a file'); return; }
    const check = await validateFile(picked);
    if (!check.ok) { setErr(check.error); toast(check.error, 'error'); return; }

    const mid = (memberSel && memberSel.value) || memberId || (session.role === 'member' ? session.memberId : '') || '';
    const mdoc = memberDocId || (session.memberDocId || '');
    uploadBtn.disabled = true;
    cancelBtn.classList.remove('hidden');
    progWrap.classList.remove('hidden');
    progFill.style.width = '0%';
    progLbl.textContent = '0%';
    try {
      const rec = await uploadFile(picked, {
        session, memberId: mid, memberDocId: mdoc, taskRef,
        onProgress: pct => { progFill.style.width = pct + '%'; progLbl.textContent = pct + '%'; },
      });
      progFill.style.width = '100%';
      progLbl.textContent = '100%';
      okBox.classList.remove('hidden');
      toast('আপলোড সফল হয়েছে / Uploaded Successfully', 'success');
      resetPick();
      if (typeof onUploaded === 'function') onUploaded(rec);
    } catch (err) {
      console.error(err);
      const msg = friendlyStorageError(err);
      setErr('আপলোড ব্যর্থ / Upload failed — ' + msg);
      toast('আপলোড ব্যর্থ / Upload failed — ' + msg, 'error');
    } finally {
      uploadBtn.disabled = false;
      cancelBtn.classList.add('hidden');
      taskRef.current = null;
    }
  }

  input.addEventListener('change', async () => {
    setErr('');
    okBox.classList.add('hidden');
    const file = input.files && input.files[0];
    if (!file) { resetPick(); return; }
    const check = await validateFile(file);
    if (!check.ok) {
      picked = null;
      meta.classList.add('hidden');
      setErr(check.error);
      toast(check.error, 'error');
      input.value = '';
      return;
    }
    picked = file;
    showMeta(file);
  });

  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => {
    e.preventDefault(); e.stopPropagation(); drop.classList.add('drag');
  }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => {
    e.preventDefault(); e.stopPropagation(); drop.classList.remove('drag');
  }));
  drop.addEventListener('drop', e => {
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file) return;
    try {
      const list = new DataTransfer();
      list.items.add(file);
      input.files = list.files;
    } catch { /* some browsers block assigning input.files */ }
    input.dispatchEvent(new Event('change'));
  });

  box.append(drop, meta, errBox, progWrap, okBox);

  if (showMemberPick && session && (session.role === 'admin' || session.role === 'maker')) {
    const wrap = el('div', { class: 'field', style: 'margin-top:4px' });
    wrap.appendChild(el('label', { text: 'সদস্যের সাথে যুক্ত করুন / Attach to member (optional)' }));
    memberSel = el('select');
    memberSel.appendChild(el('option', { value: '' }, ['— নেই / None —']));
    wrap.appendChild(memberSel);
    box.appendChild(wrap);
    allMembers().then(list => {
      list.slice().sort((a, b) => String(a.memberId).localeCompare(String(b.memberId))).forEach(m => {
        memberSel.appendChild(el('option', {
          value: m.memberId,
          ...(memberId && memberId === m.memberId ? { selected: true } : {}),
        }, [`${m.memberId} — ${m.nameBn || m.nameEn}`]));
      });
    }).catch(() => {});
  }

  box.appendChild(actions);
  return box;
}

export function renderFileList(session, { memberId = '', onChanged = null } = {}) {
  const box = el('div', { class: 'file-list-host' });

  async function refresh() {
    if (!box.isConnected && box.childNodes.length) {
      window.removeEventListener('ds:data-changed', onChange);
      return;
    }
    let rows = [];
    try { rows = await listAuthorizedFiles(session, { memberId }); }
    catch (err) { console.error(err); }
    box.replaceChildren();
    if (!rows.length) {
      box.appendChild(el('div', { class: 'empty', html: `${icon('file')}কোনো ফাইল নেই / No files` }));
      return;
    }
    box.appendChild(tableWrap(
      [
        { label: 'ফাইল / File Name' }, { label: 'ধরন / Type' }, { label: 'আকার / Size', cls: 'num' },
        { label: 'তারিখ / Upload Date' }, { label: 'আপলোডকারী / Uploaded By' },
        { label: 'Action', cls: 'nowrap' },
      ],
      rows.map(f => {
        const acts = el('div', { class: 'btn-row file-actions' });
        acts.appendChild(btn('View', 'eye', 'ghost', async () => {
          try { await viewFile(f, session); }
          catch (err) { toast(friendlyStorageError(err), 'error'); }
        }, { size: 'xs' }));
        acts.appendChild(btn('Download', 'download', 'ghost', async () => {
          try { await downloadFile(f, session); }
          catch (err) { toast(friendlyStorageError(err), 'error'); }
        }, { size: 'xs' }));
        if (canDeleteFile(f, session)) {
          acts.appendChild(btn('Delete', 'trash', 'softred', async () => {
            if (!navigator.onLine) {
              toast('ইন্টারনেট সংযোগ প্রয়োজন / Internet connection required', 'error');
              return;
            }
            if (!(await confirmBox(`${f.fileName} মুছে ফেলবেন? / Delete this file?`, { title: 'ফাইল মুছুন / Delete File', okLabel: 'Delete', danger: true }))) return;
            try {
              await deleteFile(f.id, session);
              toast('ফাইল মুছে ফেলা হয়েছে / File deleted', 'warn');
              if (typeof onChanged === 'function') onChanged();
              refresh();
            } catch (err) {
              toast(friendlyStorageError(err), 'error');
            }
          }, { size: 'xs' }));
        }
        const thumb = (f.contentType || '').startsWith('image/') && (f.url || f.downloadURL)
          ? `<img class="file-thumb" src="${esc(f.url || f.downloadURL)}" alt=""> `
          : `${icon((f.contentType || '') === 'application/pdf' ? 'pdf' : 'file')} `;
        return [
          `${thumb}<b>${esc(f.fileName || f.originalName || f.id)}</b>`,
          esc(fileTypeLabel(f.contentType)),
          { text: formatSize(f.size), cls: 'num' },
          esc(fmtDateTime(f.uploadedAt || f.createdAt)),
          esc(f.uploadedByName || f.uploadedBy || '—'),
          { node: acts, cls: 'nowrap' },
        ];
      }),
      { empty: 'কোনো ফাইল নেই / No files', emptyIcon: 'file' },
    ));
  }

  function onChange(e) {
    if (!box.isConnected) { window.removeEventListener('ds:data-changed', onChange); return; }
    const st = e.detail && e.detail.store;
    if (st === 'filesData' || st === '*') refresh();
  }
  window.addEventListener('ds:data-changed', onChange);
  box.refresh = refresh;
  refresh();
  return box;
}

export async function pageFiles(session) {
  const wrap = page('ফাইল', 'Files', 'file');
  wrap.appendChild(banner('info',
    'JPEG, PNG, WebP ও PDF আপলোড করা যাবে (সর্বোচ্চ ১০ MB)। ফাইল Firebase Storage-এ থাকে এবং মেটাডেটা সব ডিভাইসে রিয়েল-টাইমে সিঙ্ক হয়।'));

  if (!navigator.onLine) {
    wrap.appendChild(banner('warn', 'ইন্টারনেট সংযোগ প্রয়োজন / Internet connection required — অফলাইনে ফাইল আপলোড করা যাবে না।'));
  }

  const listHost = renderFileList(session, {
    onChanged: () => { /* list self-refreshes */ },
  });
  const uploader = renderUploader(session, {
    showMemberPick: session.role === 'admin' || session.role === 'maker',
    memberId: session.role === 'member' ? (session.memberId || '') : '',
    memberDocId: session.memberDocId || '',
    onUploaded: () => { if (listHost.refresh) listHost.refresh(); },
  });
  wrap.appendChild(card('ফাইল আপলোড', 'Upload a file', uploader));
  wrap.appendChild(card('ফাইল তালিকা', 'Authorized files', listHost));
  return wrap;
}

export function filesSection(session, { memberId = '', memberDocId = '', titleBn = 'ফাইল', titleEn = 'Files' } = {}) {
  const host = el('div');
  const listHost = renderFileList(session, { memberId });
  const uploader = renderUploader(session, {
    memberId, memberDocId,
    onUploaded: () => { if (listHost.refresh) listHost.refresh(); },
  });
  host.appendChild(card(titleBn, titleEn, el('div', {}, [uploader, el('div', { style: 'margin-top:12px' }, [listHost])])));
  return host;
}
