/* Authentication & session — local credential cache, signed in against the central Firebase project. */
import { dbAll, dbGet, saveRecord, getSetting, setSetting } from './db.js';
import { hashPassword, verifyPassword, passwordIssues } from './crypto.js';
import { nowISO, normalizeMobile, uid } from './util.js';
import { logActivity, invalidate, DEFAULT_MEMBER_PASSWORD } from './store.js';
import { firebase } from './firebase.js';

const SESSION_KEY = 'ds_session';
export const ROLES = { ADMIN: 'admin', MAKER: 'maker', MEMBER: 'member' };

/** Ensure the bootstrap admin (admin/admin) exists on a fresh install.
    Never treat this local seed as production data — it is not queued to Firebase. */
export async function ensureBootstrapAdmin() {
  const users = await dbAll('users');
  if (users.some(u => u.role === 'admin')) return null;
  const pw = await hashPassword('admin');
  const admin = {
    id: 'U_admin_bootstrap',
    username: 'admin',
    role: 'admin',
    displayName: 'Administrator',
    password: pw,
    active: true,
    isBootstrap: true,          // default password still in use
    mustChangePassword: true,
    profileComplete: false,
    createdAt: nowISO(),
  };
  await saveRecord('users', admin, { queue: false });
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

async function findUsers(identifier) {
  const raw = String(identifier || '').trim();
  const lower = raw.toLowerCase();
  const mob = normalizeMobile(raw);
  const users = await dbAll('users');
  return users.filter(u =>
    (u.username || '').toLowerCase() === lower
    || (u.role === 'member' && mob && normalizeMobile(u.username) === mob)
    || (u.memberId && u.memberId === raw)
  );
}

async function findUser(identifier) {
  const list = await findUsers(identifier);
  return list.find(u => !u.isBootstrap) || list[0] || null;
}

async function finishLogin(u, { remember = false } = {}) {
  if (u.active === false) throw new Error('আপনার অ্যাকাউন্ট নিষ্ক্রিয় করা হয়েছে। / Your account has been deactivated.');
  let member = null;
  if (u.role === ROLES.MEMBER && u.memberDocId) {
    member = await dbGet('members', u.memberDocId);
    if (member && member.status === 'rejected') {
      throw new Error('আপনার Registration বাতিল হয়েছে। অনুগ্রহ করে কর্তৃপক্ষের সাথে যোগাযোগ করুন। / Your registration was rejected.');
    }
  }
  const session = publicUser(u);
  if (member) { session.memberStatus = member.status; session.displayName = member.nameBn || member.nameEn; }
  setSession(session, remember);
  return session;
}

export async function login(identifier, password, { remember = false } = {}) {
  try { await firebase.init(); } catch {}

  /* 1. Central Firebase Auth is the authority whenever we are online. */
  if (firebase.ready && navigator.onLine) {
    try {
      const central = await firebase.signInIdentifier(identifier, password);
      if (central && central.denied) throw central.denied;
      if (central && central.user) {
        const cu = central.user;
        if (cu.role === 'member' && cu.memberDocId && firebase.db) {
          try {
            const ms = await firebase.db.ref(`members/${cu.memberDocId}`).get();
            if (ms.exists()) {
              const { applyRemote } = await import('./db.js');
              await applyRemote('members', ms.val());
            }
          } catch {}
        }
        const session = await finishLogin(cu, { remember });
        try { await firebase.hydrate(session); } catch {}
        await logActivity('LOGIN', `${session.role} ${session.username} signed in`, session);
        return session;
      }
    } catch (e) {
      if (e && e.fatal) throw e;
      if (e && /Invalid user ID or password|ভুল User ID|নিষ্ক্রিয়|বাতিল/.test(e.message || '')) throw e;
    }
  }

  /* 2. Local cache / first-run bootstrap (offline or empty central project). */
  await ensureBootstrapAdmin();
  const matches = await findUsers(identifier);
  let u = null;
  for (const cand of matches) {
    if (await verifyPassword(password, cand.password)) { u = cand; break; }
  }
  if (!u) throw new Error('ভুল User ID অথবা Password / Invalid user ID or password');

  if (u.isBootstrap && navigator.onLine && firebase.ready) {
    const email = `${(u.username || 'admin')}@dhruvo-sangsad.local`;
    try {
      if (await firebase.emailInUse(email)) {
        throw new Error('ডিফল্ট admin/admin এই প্রজেক্টে নিষ্ক্রিয়। আপনার সংগঠনের অ্যাকাউন্ট ব্যবহার করুন। / Default bootstrap login is disabled. Use your organisation account.');
      }
    } catch (e) {
      if (/bootstrap|নিষ্ক্রিয়/.test(e.message || '')) throw e;
    }
  }

  const session = await finishLogin(u, { remember });
  try { await firebase.signIn(u, password); } catch {}
  await logActivity('LOGIN', `${u.role} ${u.username} signed in`, session);
  return session;
}

export async function logout() {
  const s = getSession();
  if (s) await logActivity('LOGOUT', `${s.role} ${s.username} signed out`, s);
  firebase.signOut().catch(() => {});
  clearSession();
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
  await logActivity('PASSWORD_CHANGE', `${u.username} changed password`, ns);
  firebase.updatePassword(newPassword).catch(() => {});
  return ns;
}

/** Complete first-time admin setup: profile + mandatory password change. */
export async function completeAdminSetup({ displayName, username, mobile, email, address, newPassword }) {
  const s = getSession();
  if (!s || s.role !== ROLES.ADMIN) throw new Error('Admin only');
  const u = await dbGet('users', s.id);
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
  try {
    if (firebase.auth && firebase.auth.currentUser) await firebase.updatePassword(newPassword);
    else await firebase.signIn({ ...next, isBootstrap: false }, newPassword);
  } catch {}
  await saveRecord('users', next, { queue: true, actorId: u.id });
  invalidate('users');
  const ns = { ...publicUser(next) };
  setSession(ns, false);
  try { await firebase.publishAuthIndex(next); } catch {}
  await logActivity('ADMIN_SETUP', 'First-time admin setup completed', ns);
  return ns;
}

/** Step 1 of password recovery: does a valid registered member exist for this identifier? */
export async function memberAccountExists(identifier) {
  const u = await findUser(identifier);
  if (u && u.role === ROLES.MEMBER && u.active !== false) return true;
  if (firebase.ready && firebase.auth) {
    const raw = String(identifier || '').trim();
    const emails = [];
    if (/@/.test(raw)) emails.push(raw);
    emails.push(`${raw.toLowerCase()}@dhruvo-sangsad.local`);
    const mob = normalizeMobile(raw);
    if (mob) emails.push(`${mob}@dhruvo-sangsad.local`);
    for (const email of emails) {
      try {
        const methods = await firebase.auth.fetchSignInMethodsForEmail(email);
        if (methods && methods.length) return true;
      } catch {}
    }
  }
  return false;
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

/**
 * Password recovery (members only) — two unique profile fields must BOTH match
 * exactly before a reset is allowed. Failures are reported generically and never
 * reveal which specific field was wrong.
 */
export async function recoverPassword({ identifier, field1, value1, field2, value2, newPassword }) {
  const u = await findUser(identifier);
  if (!u) throw new Error('এই User ID খুঁজে পাওয়া যায়নি / User ID not found');
  if (u.role !== ROLES.MEMBER) {
    throw new Error('Admin/Maker Password রিসেট করতে Admin-এর সাথে যোগাযোগ করুন। / Contact the Admin to reset a staff password.');
  }
  const m = await dbGet('members', u.memberDocId);
  if (!m) throw new Error('Member record not found');
  if (!RECOVERY_FIELDS.includes(field1) || !RECOVERY_FIELDS.includes(field2) || field1 === field2) {
    throw new Error('দুটি ভিন্ন যাচাই তথ্য নির্বাচন করুন / Choose two different verification fields');
  }
  const ok1 = fieldMatches(m, field1, value1);
  const ok2 = fieldMatches(m, field2, value2);
  if (!(ok1 && ok2)) {
    throw new Error('যাচাই ব্যর্থ হয়েছে। প্রদত্ত তথ্য মেলেনি। / Verification failed. Please check your information.');
  }
  const issues = passwordIssues(newPassword);
  if (issues.length) throw new Error(issues[0]);
  if (String(newPassword) === DEFAULT_MEMBER_PASSWORD) throw new Error('ডিফল্ট পাসওয়ার্ড ব্যবহার করা যাবে না / The default password cannot be used.');
  const pw = await hashPassword(newPassword);
  await saveRecord('users', { ...u, password: pw, mustChangePassword: false, passwordChangedAt: nowISO() }, { queue: true });
  invalidate('users');
  await logActivity('PASSWORD_RECOVERY', `Password recovered for ${u.username}`, { id: u.id, role: u.role, displayName: u.displayName });
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
