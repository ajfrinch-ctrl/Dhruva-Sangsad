/* Authentication & session — offline-first local credential vault, optionally mirrored to Firebase Auth. */
import { dbAll, dbGet, saveRecord, getSetting, setSetting, applyRemote, dbDeleteRaw } from './db.js';
import { hashPassword, verifyPassword, passwordIssues } from './crypto.js';
import { nowISO, normalizeMobile, uid } from './util.js';
import { logActivity, invalidate, DEFAULT_MEMBER_PASSWORD } from './store.js';
import { firebase } from './firebase.js';

const SESSION_KEY = 'ds_session';
export const ROLES = { ADMIN: 'admin', MAKER: 'maker', MEMBER: 'member' };
export const BOOTSTRAP_ADMIN_ID = 'U_admin_bootstrap';
/* The default admin is stamped with the oldest possible timestamp so any real
   record arriving from the cloud always wins last-write-wins conflict checks. */
const BOOTSTRAP_EPOCH = '1970-01-01T00:00:00.000Z';

const MSG_ADMIN_EXISTS = 'অ্যাডমিন আগেই সেটআপ করা হয়েছে — ডিফল্ট admin/admin আর ব্যবহার করা যাবে না। সেটআপে দেওয়া Username ও Password দিয়ে লগইন করুন। / An admin has already been set up — the default admin/admin login is disabled. Sign in with the username and password chosen during setup.';
const MSG_NEED_ONLINE = 'প্রথমবার অ্যাডমিন সেটআপের জন্য ইন্টারনেট সংযোগ প্রয়োজন (ক্লাউডে আগে থেকে অ্যাডমিন আছে কিনা যাচাই করা হয়)। সংযোগ দিয়ে আবার চেষ্টা করুন। / First-time admin setup needs an internet connection to confirm no admin exists in the cloud. Connect and try again.';

/**
 * Guard for the default admin/admin account. Allowed only when the install is
 * local-only (no Firebase) or the cloud confirms no real admin exists yet.
 * When the cloud already has an admin its records are applied locally and the
 * default account is removed from this device.
 */
async function assertBootstrapAllowed() {
  let res;
  try { res = await firebase.cloudAdminState(); }
  catch (e) { res = { state: 'unknown', error: e.message }; }
  if (res.state === 'local' || res.state === 'none') return;
  if (res.state === 'exists') {
    for (const a of res.admins || []) { try { await applyRemote('users', a); } catch {} }
    const local = await dbGet('users', BOOTSTRAP_ADMIN_ID);
    if (local && local.isBootstrap) await dbDeleteRaw('users', BOOTSTRAP_ADMIN_ID);
    invalidate('users');
    clearSession();
    throw new Error(MSG_ADMIN_EXISTS);
  }
  throw new Error(MSG_NEED_ONLINE);
}

/** Re-validate a restored admin/admin session (e.g. from sessionStorage) before
 *  showing the setup wizard. Throws with a user-facing message if not allowed. */
export async function checkBootstrapSession(session) {
  const u = session && await dbGet('users', session.id);
  if (!u || !u.isBootstrap) { clearSession(); throw new Error(MSG_ADMIN_EXISTS); }
  await assertBootstrapAllowed();
}

/** Ensure the bootstrap admin (admin/admin) exists on a fresh install. */
export async function ensureBootstrapAdmin() {
  const users = await dbAll('users');
  if (users.some(u => u.role === 'admin')) return null;
  const pw = await hashPassword('admin');
  const admin = {
    id: BOOTSTRAP_ADMIN_ID,
    username: 'admin',
    role: 'admin',
    displayName: 'Administrator',
    password: pw,
    active: true,
    isBootstrap: true,          // default password still in use
    mustChangePassword: true,
    profileComplete: false,
    createdAt: BOOTSTRAP_EPOCH,
    updatedAt: BOOTSTRAP_EPOCH,
  };
  await saveRecord('users', admin, { queue: false, touch: false });
  invalidate('users');
  return admin;
}

function publicUser(u) {
  return {
    id: u.id, username: u.username, role: u.role, displayName: u.displayName || u.username,
    memberId: u.memberId || null, memberDocId: u.memberDocId || null,
    mustChangePassword: !!u.mustChangePassword, isBootstrap: !!u.isBootstrap,
    profileComplete: u.profileComplete !== false, active: u.active !== false,
    loginAt: nowISO(),
  };
}

export function getSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    return s && s.id ? s : null;
  } catch { return null; }
}
export function setSession(s, remember = false) {
  const raw = JSON.stringify(s);
  sessionStorage.setItem(SESSION_KEY, raw);
  if (remember) localStorage.setItem(SESSION_KEY, raw); else localStorage.removeItem(SESSION_KEY);
  window.DS_SESSION = s;
  window.dispatchEvent(new CustomEvent('ds:session', { detail: s }));
}
export function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(SESSION_KEY);
  window.DS_SESSION = null;
  window.dispatchEvent(new CustomEvent('ds:session', { detail: null }));
}

async function findUser(identifier) {
  const raw = String(identifier || '').trim();
  const lower = raw.toLowerCase();
  const mob = normalizeMobile(raw);
  const users = await dbAll('users');
  return users.find(u => (u.username || '').toLowerCase() === lower)
    || users.find(u => u.role === 'member' && normalizeMobile(u.username) === mob && mob)
    || users.find(u => u.memberId && u.memberId === raw)
    || null;
}

export async function login(identifier, password, { remember = false } = {}) {
  await ensureBootstrapAdmin();
  const u = await findUser(identifier);
  if (!u) throw new Error('ইউজার আইডি বা পাসওয়ার্ড ভুল');
  if (u.active === false) throw new Error('আপনার অ্যাকাউন্ট নিষ্ক্রিয় করা হয়েছে।');
  const ok = await verifyPassword(password, u.password);
  if (!ok) throw new Error('ইউজার আইডি বা পাসওয়ার্ড ভুল');
  // The default admin/admin only works while no real admin exists in the cloud.
  if (u.isBootstrap) await assertBootstrapAllowed();

  let member = null;
  if (u.role === ROLES.MEMBER && u.memberDocId) {
    member = await dbGet('members', u.memberDocId);
    if (member && member.status === 'rejected') {
      throw new Error('আপনার Registration বাতিল হয়েছে। অনুগ্রহ করে কর্তৃপক্ষের সাথে যোগাযোগ করুন।');
    }
  }
  const session = publicUser(u);
  if (member) { session.memberStatus = member.status; session.displayName = member.nameBn || member.nameEn; }
  setSession(session, remember);

  // Best-effort mirror to Firebase Auth when configured & online
  firebase.signIn(u, password).catch(() => {});

  if (u.role === ROLES.ADMIN && !u.isBootstrap) firebase.markAdminReady().catch(() => {});

  await logActivity('LOGIN', `${u.username} লগইন করেছেন`, session);
  return session;
}

/** Clear session immediately so the UI can switch to the login screen without
 *  waiting on IndexedDB activity log or Firebase Auth. Logging is best-effort. */
export async function logout() {
  const s = getSession();
  clearSession();
  firebase.signOut().catch(() => {});
  if (s) {
    logActivity('LOGOUT', `${s.username} লগআউট করেছেন`, s).catch(() => {});
  }
}

export async function changeOwnPassword(currentPassword, newPassword) {
  const s = getSession();
  if (!s) throw new Error('Not signed in');
  const u = await dbGet('users', s.id);
  if (!u) throw new Error('User not found');
  const ok = await verifyPassword(currentPassword, u.password);
  if (!ok) throw new Error('বর্তমান Password সঠিক নয় / Current password is incorrect');
  const issues = passwordIssues(newPassword);
  if (issues.length) throw new Error(issues[0]);
  if (u.isBootstrap && String(newPassword) === 'admin') throw new Error('Default password পুনরায় ব্যবহার করা যাবে না। / The default password cannot be reused.');
  if (String(newPassword) === DEFAULT_MEMBER_PASSWORD) throw new Error('ডিফল্ট পাসওয়ার্ড ব্যবহার করা যাবে না / The default password cannot be used.');
  const pw = await hashPassword(newPassword);
  const next = { ...u, password: pw, isBootstrap: false, mustChangePassword: false, passwordChangedAt: nowISO() };
  await saveRecord('users', next, { queue: true, actorId: u.id });
  invalidate('users');
  const ns = { ...s, mustChangePassword: false, isBootstrap: false };
  setSession(ns, !!localStorage.getItem(SESSION_KEY));
  await logActivity('PASSWORD_CHANGE', `${u.username} পাসওয়ার্ড পরিবর্তন করেছেন`, ns);
  firebase.updatePassword(newPassword).catch(() => {});
  return ns;
}

/** Complete first-time admin setup: profile + mandatory password change. */
export async function completeAdminSetup({ displayName, username, mobile, email, address, newPassword }) {
  const s = getSession();
  if (!s || s.role !== ROLES.ADMIN) throw new Error('Admin only');
  const u = await dbGet('users', s.id);
  if (!u) { clearSession(); throw new Error(MSG_ADMIN_EXISTS); }
  // Re-check right before publishing: never let a default account overwrite a
  // real admin that appeared in the cloud meanwhile.
  if (u.isBootstrap) await assertBootstrapAllowed();
  const issues = passwordIssues(newPassword);
  if (issues.length) throw new Error(issues[0]);
  if (String(newPassword) === 'admin') throw new Error('Default password “admin” আর ব্যবহার করা যাবে না। / The default password can no longer be used.');
  const uname = String(username || u.username).trim().toLowerCase();
  const users = await dbAll('users');
  if (users.some(x => x.id !== u.id && (x.username || '').toLowerCase() === uname)) throw new Error('এই Username ইতোমধ্যে ব্যবহৃত হয়েছে। / Username already exists.');
  const pw = await hashPassword(newPassword);
  const next = {
    ...u, username: uname, displayName: displayName || u.displayName,
    mobile: normalizeMobile(mobile), email: (email || '').trim(), address: (address || '').trim(),
    password: pw, isBootstrap: false, mustChangePassword: false, profileComplete: true, passwordChangedAt: nowISO(),
  };
  await saveRecord('users', next, { queue: true, actorId: u.id });
  invalidate('users');
  const ns = { ...publicUser(next) };
  setSession(ns, false);
  await logActivity('ADMIN_SETUP', 'First-time admin setup completed', ns);
  firebase.markAdminReady().catch(() => {});
  return ns;
}

/** Step 1 of password recovery: search by mobile and return public member info. */
export async function findMemberForRecovery(mobile) {
  const mob = normalizeMobile(mobile);
  if (!mob || mob.length < 11) return null;
  const u = await findUser(mob);
  if (!u || u.role !== ROLES.MEMBER || u.active === false) return null;
  const m = await dbGet('members', u.memberDocId);
  if (!m) return null;
  return {
    identifier: u.username || m.mobile,
    memberId: m.memberId,
    nameBn: m.nameBn || '',
    nameEn: m.nameEn || '',
    mobile: m.mobile,
    status: m.status || '',
  };
}

export async function memberAccountExists(identifier) {
  const u = await findUser(identifier);
  return !!(u && u.role === ROLES.MEMBER && u.active !== false);
}

const RECOVERY_FIELDS = ['mobile', 'whatsapp', 'email', 'nid', 'dob'];

function dobMatches(stored, v) {
  if (!stored || !v) return false;
  const s = String(stored).slice(0, 10);
  const t = String(v).trim();
  if (!t) return false;
  if (s === t) return true;
  const parts = t.split('-');
  if (parts.length === 3 && `${parts[2]}-${parts[1]}-${parts[0]}` === s) return true;
  return false;
}

/** Exact match of a single stored member profile field against the entered value. */
function fieldMatches(member, field, value) {
  const v = String(value == null ? '' : value).trim();
  if (!v) return false;
  const stored = member[field];
  if (stored === undefined || stored === null || stored === '') return false;
  switch (field) {
    case 'mobile': case 'whatsapp': return normalizeMobile(stored) === normalizeMobile(v) && !!normalizeMobile(v);
    case 'email': return String(stored).trim().toLowerCase() === v.toLowerCase();
    case 'nid': return String(stored).trim() === v;
    case 'dob': return dobMatches(stored, v);
    default: return false;
  }
}

export async function verifyRecoveryDob(identifier, dobDay, dobMonth) {
  const u = await findUser(identifier);
  if (!u || u.role !== ROLES.MEMBER) throw new Error('এই মোবাইলে কোনো সদস্য পাওয়া যায়নি / No member found');
  const m = await dbGet('members', u.memberDocId);
  if (!m) throw new Error('সদস্য রেকর্ড পাওয়া যায়নি / Member record not found');
  const stored = String(m.dob || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(stored)) {
    throw new Error('যাচাই ব্যর্থ হয়েছে। প্রদত্ত তথ্য মেলেনি। / Verification failed.');
  }
  const d = String(Number(dobDay)).padStart(2, '0');
  const mo = String(Number(dobMonth)).padStart(2, '0');
  if (stored.slice(8, 10) !== d || stored.slice(5, 7) !== mo) {
    throw new Error('যাচাই ব্যর্থ হয়েছে। জন্ম তারিখ ও মাস মেলেনি। / Date and month of birth do not match.');
  }
  return true;
}

export async function recoverPassword({ identifier, dobDay, dobMonth, field1, value1, field2, value2, newPassword }) {
  const u = await findUser(identifier);
  if (!u) throw new Error('এই User ID খুঁজে পাওয়া যায়নি / User ID not found');
  if (u.role !== ROLES.MEMBER) {
    throw new Error('Admin/Maker Password রিসেট করতে Admin-এর সাথে যোগাযোগ করুন। / Contact the Admin to reset a staff password.');
  }
  const m = await dbGet('members', u.memberDocId);
  if (!m) throw new Error('সদস্য রেকর্ড পাওয়া যায়নি / Member record not found');
  if (dobDay != null && dobMonth != null && String(dobDay) !== '' && String(dobMonth) !== '') {
    await verifyRecoveryDob(identifier, dobDay, dobMonth);
  } else {
    if (!RECOVERY_FIELDS.includes(field1) || !RECOVERY_FIELDS.includes(field2) || field1 === field2) {
      throw new Error('জন্ম তারিখ ও মাস দিন / Enter date and month of birth');
    }
    const ok1 = fieldMatches(m, field1, value1);
    const ok2 = fieldMatches(m, field2, value2);
    if (!(ok1 && ok2)) {
      throw new Error('যাচাই ব্যর্থ হয়েছে। প্রদত্ত তথ্য মেলেনি। / Verification failed. Please check your information.');
    }
  }
  const issues = passwordIssues(newPassword);
  if (issues.length) throw new Error(issues[0]);
  if (String(newPassword) === DEFAULT_MEMBER_PASSWORD) throw new Error('ডিফল্ট পাসওয়ার্ড ব্যবহার করা যাবে না / The default password cannot be used.');
  const pw = await hashPassword(newPassword);
  await saveRecord('users', { ...u, password: pw, mustChangePassword: false, passwordChangedAt: nowISO() }, { queue: true });
  invalidate('users');
  await logActivity('PASSWORD_RECOVERY', `${u.username} — পাসওয়ার্ড পুনরুদ্ধার`, { id: u.id, role: u.role, displayName: u.displayName });
  return true;
}

/* ---------------- Authorization matrix ---------------- */
export const PERMISSIONS = {
  admin: new Set([
    'home', 'members', 'deposit', 'authorization', 'reports', 'settings', 'member-panel',
    'member:view-all', 'member:edit', 'member:approve', 'member:delete',
    'deposit:create-any', 'deposit:approve', 'deposit:edit-any', 'deposit:delete-any',
    'staff:manage', 'report:all', 'export:all', 'whatsapp', 'backup:manage', 'settings:manage',
  ]),
  maker: new Set([
    'home', 'members', 'deposit', 'authorization', 'reports', 'settings',
    'member:view-all', 'member:edit', 'member:approve',
    'deposit:create-any', 'deposit:approve', 'deposit:edit-today', 'deposit:delete-today',
    'report:all', 'export:all', 'whatsapp',
  ]),
  member: new Set([
    'home', 'deposit', 'reports', 'settings', 'member-panel',
    'member:view-own', 'deposit:create-own', 'report:own', 'export:own',
  ]),
};
export function can(session, perm) {
  if (!session) return false;
  const set = PERMISSIONS[session.role];
  return !!set && set.has(perm);
}
export function requireRole(session, ...roles) {
  return !!session && roles.includes(session.role);
}
