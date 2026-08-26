/* Domain layer: members, deposits, approvals, calculations, logs, notifications */
import {
  dbAll, dbGet, saveRecord, removeRecord, getSetting, setSetting, dbPutRaw, enqueue,
} from './db.js';
import {
  uid, nowISO, todayISO, num, normalizeMobile, memberIdFromMobile, monthsBetweenInclusive, monthKey,
} from './util.js';
import { hashPassword } from './crypto.js';

/* ---------------- cache ---------------- */
const cache = { members: null, deposits: null, withdrawals: null, users: null, logs: null, notifs: null };
export function invalidate(what) {
  if (!what) { Object.keys(cache).forEach(k => cache[k] = null); return; }
  cache[what] = null;
}
window.addEventListener('ds:data-changed', e => {
  const s = e.detail && e.detail.store;
  if (!s || s === '*') invalidate();
  else if (s === 'members') invalidate('members');
  else if (s === 'deposits') invalidate('deposits');
  else if (s === 'withdrawals') invalidate('withdrawals');
  else if (s === 'users') invalidate('users');
  else if (s === 'activityLogs') invalidate('logs');
  else if (s === 'notifications') invalidate('notifs');
});

export async function allMembers() { if (!cache.members) cache.members = await dbAll('members'); return cache.members; }
export async function allDeposits() { if (!cache.deposits) cache.deposits = await dbAll('deposits'); return cache.deposits; }
export async function allWithdrawals() { if (!cache.withdrawals) cache.withdrawals = await dbAll('withdrawals'); return cache.withdrawals; }
export async function allUsers() { if (!cache.users) cache.users = await dbAll('users'); return cache.users; }
export async function allLogs() { if (!cache.logs) cache.logs = await dbAll('activityLogs'); return cache.logs; }
export async function allNotifications() { if (!cache.notifs) cache.notifs = await dbAll('notifications'); return cache.notifs; }

export const getMember = id => dbGet('members', id);
export const getUser = id => dbGet('users', id);

/* Default password automatically assigned when staff (Admin/Maker) create a member. */
export const DEFAULT_MEMBER_PASSWORD = '1234567890';

/* ---------------- settings ---------------- */
export const DEFAULT_SETTINGS = {
  orgNameBn: 'ধ্রুব সংসদ',
  orgNameEn: 'Dhruvo Sangsad',
  orgAddress: '',
  orgPhone: '',
  defaultInstallment: 1000,
  monthlyTarget: 0,
  countSpecialTowardsInstallment: false,
  currency: '৳',
  dueDay: 12,
  waTemplate: 'প্রিয় [Member Name],\nআসসালামু আলাইকুম।\nআপনার মাসিক জমা বকেয়া রয়েছে। অনুগ্রহ করে দ্রুত সময়ের মধ্যে বকেয়া পরিশোধ করার জন্য বিনীতভাবে অনুরোধ করা হলো।\nধন্যবাদ।\nধ্রুব সংসদ',
};
export async function settings() {
  const out = { ...DEFAULT_SETTINGS };
  for (const k of Object.keys(DEFAULT_SETTINGS)) {
    const v = await getSetting(k, undefined);
    if (v !== undefined && v !== null) out[k] = v;
  }
  return out;
}
export async function saveSettings(patch) {
  for (const [k, v] of Object.entries(patch)) await setSetting(k, v);
  return settings();
}

/* ---------------- activity log ---------------- */
export async function logActivity(action, details = '', actor = null) {
  const a = actor || (window.DS_SESSION || null);
  const rec = {
    id: uid('log'),
    action,
    details,
    userId: a ? a.id : 'system',
    userName: a ? (a.displayName || a.username || a.memberId || 'user') : 'system',
    role: a ? a.role : 'system',
    createdAt: nowISO(),
  };
  await saveRecord('activityLogs', rec, { queue: true });
  return rec;
}

/* ---------------- notifications ---------------- */
export async function notify({ title, body, audience = 'staff', memberId = null, kind = 'info', action = null, sticky = false, id = null }) {
  const rec = {
    id: id || uid('ntf'), title, body, audience, memberId, kind, action, sticky,
    createdAt: nowISO(), readBy: {},
  };
  const existing = id ? await dbGet('notifications', id) : null;
  if (existing) rec.createdAt = existing.createdAt;
  await saveRecord('notifications', rec, { queue: true });
  return rec;
}
export async function markNotificationRead(id, userId) {
  const n = await dbGet('notifications', id);
  if (!n) return;
  n.readBy = { ...(n.readBy || {}), [userId]: nowISO() };
  await saveRecord('notifications', n, { queue: true });
}
export async function visibleNotifications(session) {
  const all = await allNotifications();
  const myId = String(session.memberId || '');
  return all.filter(n => {
    const owner = n.memberId != null && n.memberId !== '' ? String(n.memberId) : '';
    if (session.role === 'member') {
      if (!myId) return false;
      if (n.audience === 'staff') return false;
      return owner === myId;
    }
    if (n.audience === 'member' || n.kind === 'due') return false;
    return n.audience === 'staff' || n.audience === 'all';
  }).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

/* ---------------- uniqueness ---------------- */
export async function checkUnique({ memberId, mobile, whatsapp, email }, excludeId = null) {
  const members = await allMembers();
  const errs = [];
  const mob = normalizeMobile(mobile), wa = normalizeMobile(whatsapp), em = (email || '').trim().toLowerCase();
  for (const m of members) {
    if (excludeId && m.id === excludeId) continue;
    if (memberId && m.memberId === memberId) errs.push({ field: 'memberId', msg: 'এই Member ID ইতোমধ্যে ব্যবহৃত হয়েছে। / This Member ID already exists.' });
    if (mob && normalizeMobile(m.mobile) === mob) errs.push({ field: 'mobile', msg: 'এই মোবাইল নম্বর ইতোমধ্যে একজন সদস্যের জন্য ব্যবহৃত হয়েছে।' });
    if (wa && normalizeMobile(m.whatsapp) === wa) errs.push({ field: 'whatsapp', msg: 'এই WhatsApp নম্বর ইতোমধ্যে একজন সদস্যের জন্য ব্যবহৃত হয়েছে।' });
    if (em && (m.email || '').trim().toLowerCase() === em) errs.push({ field: 'email', msg: 'এই Email ID ইতোমধ্যে একজন সদস্যের জন্য ব্যবহৃত হয়েছে।' });
  }
  // de-dup by field
  const seen = new Set();
  return errs.filter(e => (seen.has(e.field) ? false : (seen.add(e.field), true)));
}

/* ---------------- member registration ---------------- */
export async function registerMember(form, opts = {}) {
  const mobile = normalizeMobile(form.mobile);
  const mid = memberIdFromMobile(mobile);
  if (!mid) throw new Error('সঠিক মোবাইল নম্বর দিন / Enter a valid mobile number');

  const errs = await checkUnique({ memberId: mid, mobile, whatsapp: form.whatsapp, email: form.email });
  if (errs.length) { const e = new Error(errs[0].msg); e.fieldErrors = errs; throw e; }

  // Staff-created members get the default password and must change it on first login.
  const useDefaultPassword = !!opts.defaultPassword;
  const rawPassword = useDefaultPassword ? DEFAULT_MEMBER_PASSWORD : form.password;
  const pw = await hashPassword(rawPassword);
  const memberDocId = 'M' + mid;
  const member = {
    id: memberDocId,
    memberId: mid,
    nameBn: form.nameBn.trim(),
    nameEn: form.nameEn.trim(),
    fatherBn: (form.fatherBn || '').trim(),
    fatherEn: (form.fatherEn || '').trim(),
    motherBn: (form.motherBn || '').trim(),
    motherEn: (form.motherEn || '').trim(),
    mobile,
    whatsapp: normalizeMobile(form.whatsapp),
    email: (form.email || '').trim(),
    nid: (form.nid || '').trim(),
    dob: form.dob || '',
    profession: (form.profession || '').trim(),
    address: (form.address || '').trim(),
    installment: num(form.installment),
    status: 'pending',
    joinDate: todayISO(),
    approvedAt: null, approvedBy: null, rejectedAt: null, rejectReason: '',
  };
  await saveRecord('members', member, { queue: true });

  const user = {
    id: 'U' + memberDocId,
    username: mobile,
    role: 'member',
    memberId: mid,
    memberDocId,
    displayName: member.nameBn || member.nameEn,
    password: pw,
    active: true,
    mustChangePassword: useDefaultPassword,
    createdAt: nowISO(),
  };
  await saveRecord('users', user, { queue: true });

  await logActivity('REGISTRATION', `New member registration: ${mid} — ${member.nameBn}`, { id: user.id, role: 'member', displayName: member.nameBn });
  await notify({ title: 'নতুন সদস্য নিবন্ধন / New Member Registration', body: `${member.nameBn} (${mid}) — অনুমোদনের অপেক্ষায়`, audience: 'staff', kind: 'register' });
  invalidate();
  return member;
}

export async function updateMember(memberDocId, patch, actor) {
  const m = await dbGet('members', memberDocId);
  if (!m) throw new Error('Member not found');
  const next = { ...m };
  const fields = ['nameBn', 'nameEn', 'fatherBn', 'fatherEn', 'motherBn', 'motherEn', 'mobile', 'whatsapp', 'email', 'nid', 'dob', 'profession', 'address', 'installment'];
  for (const f of fields) if (f in patch) next[f] = f === 'installment' ? num(patch[f]) : (typeof patch[f] === 'string' ? patch[f].trim() : patch[f]);
  if ('joinDate' in patch && actor && actor.role === 'admin') {
    const jd = String(patch.joinDate || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(jd)) throw new Error('সঠিক যোগদানের তারিখ দিন / Enter a valid join date');
    next.joinDate = jd;
  }
  next.mobile = normalizeMobile(next.mobile);
  next.whatsapp = normalizeMobile(next.whatsapp);
  next.memberId = m.memberId; // never changes

  const errs = await checkUnique({ mobile: next.mobile, whatsapp: next.whatsapp, email: next.email }, memberDocId);
  if (errs.length) { const e = new Error(errs[0].msg); e.fieldErrors = errs; throw e; }

  await saveRecord('members', next, { queue: true, actorId: actor && actor.id });
  await logActivity('MEMBER_UPDATE', `Member ${m.memberId} updated${next.joinDate !== m.joinDate ? ` (join date ${m.joinDate} → ${next.joinDate})` : ''}`, actor);
  invalidate('members');
  if (next.joinDate !== m.joinDate) {
    try { await syncDueNotifications(); } catch {}
  }
  return next;
}

export async function setMemberStatus(memberDocId, status, actor, reason = '') {
  const m = await dbGet('members', memberDocId);
  if (!m) throw new Error('Member not found');
  const next = { ...m, status };
  if (status === 'active') { next.approvedAt = nowISO(); next.approvedBy = actor && actor.id; next.rejectedAt = null; next.rejectReason = ''; }
  if (status === 'rejected') { next.rejectedAt = nowISO(); next.rejectReason = reason; }
  await saveRecord('members', next, { queue: true, actorId: actor && actor.id });
  await logActivity(status === 'active' ? 'MEMBER_APPROVAL' : status === 'rejected' ? 'MEMBER_REJECTION' : 'MEMBER_STATUS', `Member ${m.memberId} → ${status}${reason ? ' (' + reason + ')' : ''}`, actor);
  await notify({
    title: status === 'active' ? 'সদস্য অনুমোদিত / Member Approved' : status === 'rejected' ? 'সদস্য বাতিল / Member Rejected' : 'সদস্য স্ট্যাটাস',
    body: `${m.nameBn} (${m.memberId}) — ${status}`, audience: 'member', memberId: m.memberId,
    kind: status === 'active' ? 'approve' : 'reject',
  });
  invalidate('members');
  return next;
}

/* ---------------- deposits ---------------- */
export async function submitDeposit(form, actor) {
  const member = await dbGet('members', form.memberDocId);
  if (!member) throw new Error('Member not found');
  if (member.status !== 'active') {
    throw new Error(member.status === 'pending'
      ? 'সদস্যপদ অনুমোদনের পূর্বে জমা দাখিল করা যাবে না। / Deposits are not allowed until the membership is approved.'
      : 'বাতিলকৃত সদস্যের জন্য জমা দাখিল করা যাবে না। / Deposits are not allowed for a rejected member.');
  }
  const amount = num(form.amount);
  if (!(amount > 0)) throw new Error('জমার পরিমাণ দিন / Enter deposit amount');
  if (!form.date) throw new Error('তারিখ দিন / Enter deposit date');
  if ((form.type === 'special' || form.type === 'other') && !String(form.description || '').trim()) {
    throw new Error('এই জমার ধরনের জন্য বিবরণ আবশ্যক / Description is required for this deposit type');
  }
  const byStaff = actor && (actor.role === 'admin' || actor.role === 'maker');
  const rec = {
    id: uid('dep'),
    memberDocId: member.id,
    memberId: member.memberId,
    memberName: member.nameBn || member.nameEn,
    date: form.date,
    type: form.type,
    description: String(form.description || '').trim(),
    amount,
    method: form.method,
    comment: String(form.comment || '').trim(),
    status: byStaff ? 'approved' : 'pending',
    submittedAt: nowISO(),
    submittedBy: actor ? actor.id : 'self',
    submittedByRole: actor ? actor.role : 'member',
    approvedAt: byStaff ? nowISO() : null,
    approvedBy: byStaff ? actor.id : null,
    rejectedAt: null, rejectReason: '',
  };
  await saveRecord('deposits', rec, { queue: true, actorId: actor && actor.id });
  await logActivity('DEPOSIT_SUBMISSION', `Deposit ${amount} for ${member.memberId} (${rec.status})`, actor);
  if (rec.status === 'pending') {
    await notify({ title: 'নতুন জমা / New Deposit', body: `${member.nameBn} (${member.memberId}) — ৳${amount}`, audience: 'staff', kind: 'deposit' });
  } else {
    await notify({ title: 'জমা যুক্ত হয়েছে / Deposit Recorded', body: `${member.nameBn} (${member.memberId}) — ৳${amount}`, audience: 'member', memberId: member.memberId, kind: 'approve' });
  }
  invalidate('deposits');
  try { await syncDueNotifications(); } catch {}
  return rec;
}

export async function setDepositStatus(depositId, status, actor, reason = '') {
  const d = await dbGet('deposits', depositId);
  if (!d) throw new Error('Deposit not found');
  const next = { ...d, status };
  if (status === 'approved') { next.approvedAt = nowISO(); next.approvedBy = actor && actor.id; next.rejectedAt = null; next.rejectReason = ''; }
  if (status === 'rejected') { next.rejectedAt = nowISO(); next.rejectReason = reason; next.approvedAt = null; next.approvedBy = null; }
  await saveRecord('deposits', next, { queue: true, actorId: actor && actor.id });
  await logActivity(status === 'approved' ? 'DEPOSIT_APPROVAL' : 'DEPOSIT_REJECTION', `Deposit ${d.id} (${d.memberId}, ৳${d.amount}) → ${status}`, actor);
  try { await syncDueNotifications(); } catch {}
  await notify({
    title: status === 'approved' ? 'জমা অনুমোদিত / Deposit Approved' : 'জমা বাতিল / Deposit Rejected',
    body: `${d.memberName} (${d.memberId}) — ৳${d.amount}${reason ? ' — ' + reason : ''}`,
    audience: 'member', memberId: d.memberId, kind: status === 'approved' ? 'approve' : 'reject',
  });
  invalidate('deposits');
  return next;
}

export function canModifyDeposit(deposit, session) {
  if (!session) return { ok: false, msg: 'Not signed in' };
  if (session.role === 'admin') return { ok: true };
  if (session.role === 'maker') {
    if (String(deposit.date).slice(0, 10) !== todayISO()) {
      return { ok: false, msg: 'Maker শুধুমাত্র আজকের তারিখের জমা Edit/Delete করতে পারবেন। / Maker can edit or delete only today\'s deposits.' };
    }
    return { ok: true };
  }
  return { ok: false, msg: 'অনুমোদিত জমা পরিবর্তন করার অনুমতি নেই। / You are not allowed to modify this record.' };
}

export async function updateDeposit(depositId, patch, actor) {
  const d = await dbGet('deposits', depositId);
  if (!d) throw new Error('Deposit not found');
  const perm = canModifyDeposit(d, actor);
  if (!perm.ok) throw new Error(perm.msg);
  const next = { ...d };
  for (const f of ['date', 'type', 'description', 'amount', 'method', 'comment']) if (f in patch) next[f] = f === 'amount' ? num(patch[f]) : patch[f];
  if (!(next.amount > 0)) throw new Error('জমার পরিমাণ দিন / Enter deposit amount');
  if ((next.type === 'special' || next.type === 'other') && !String(next.description || '').trim()) throw new Error('বিবরণ আবশ্যক / Description required');
  if (actor.role === 'maker' && String(next.date).slice(0, 10) !== todayISO()) throw new Error('Maker শুধুমাত্র আজকের তারিখ ব্যবহার করতে পারবেন। / Maker may only use today\'s date.');
  await saveRecord('deposits', next, { queue: true, actorId: actor.id });
  await logActivity('DEPOSIT_EDIT', `Deposit ${depositId} edited (${next.memberId}, ৳${next.amount})`, actor);
  invalidate('deposits');
  return next;
}

export async function deleteDeposit(depositId, actor) {
  const d = await dbGet('deposits', depositId);
  if (!d) throw new Error('Deposit not found');
  const perm = canModifyDeposit(d, actor);
  if (!perm.ok) throw new Error(perm.msg);
  await removeRecord('deposits', depositId, { queue: true });
  await logActivity('DEPOSIT_DELETE', `Deposit ${depositId} deleted (${d.memberId}, ৳${d.amount})`, actor);
  invalidate('deposits');
}

/* ---------------- withdrawals ---------------- */
export const WITHDRAWAL_TYPES = [
  { id: 'savings', bn: 'সঞ্চয় উত্তোলন', en: 'Savings Withdrawal' },
  { id: 'advance_refund', bn: 'অগ্রিম ফেরত', en: 'Advance Refund' },
  { id: 'other', bn: 'অন্যান্য', en: 'Other' },
];
export const withdrawalTypeLabel = id => (WITHDRAWAL_TYPES.find(t => t.id === id) || { bn: id, en: id });

/** Net withdrawable balance for a member = approved deposits − approved withdrawals. */
export function withdrawalBalance(member, deposits, withdrawals) {
  const dep = approvedOf(deposits).filter(d => d.memberDocId === member.id || d.memberId === member.memberId)
    .reduce((s, d) => s + num(d.amount), 0);
  const wit = (withdrawals || []).filter(w => (w.memberDocId === member.id || w.memberId === member.memberId) && w.status === 'approved')
    .reduce((s, w) => s + num(w.amount), 0);
  return { totalDeposit: dep, totalWithdrawal: wit, available: Math.max(0, dep - wit) };
}

export async function submitWithdrawal(form, actor) {
  const member = await dbGet('members', form.memberDocId);
  if (!member) throw new Error('Member not found');
  if (member.status !== 'active') {
    throw new Error(member.status === 'pending'
      ? 'সদস্যপদ অনুমোদনের পূর্বে উত্তোলন করা যাবে না। / Withdrawals are not allowed until the membership is approved.'
      : 'বাতিলকৃত সদস্যের জন্য উত্তোলন করা যাবে না। / Withdrawals are not allowed for a rejected member.');
  }
  const amount = num(form.amount);
  if (!(amount > 0)) throw new Error('উত্তোলনের পরিমাণ দিন / Enter withdrawal amount');
  if (!form.date) throw new Error('তারিখ দিন / Enter withdrawal date');

  const withdrawals = await allWithdrawals();
  const deposits = await allDeposits();
  const bal = withdrawalBalance(member, deposits, withdrawals);
  if (amount > bal.available) {
    throw new Error(`পর্যাপ্ত ব্যালান্স নেই / Insufficient balance — available ৳${Math.round(bal.available)}`);
  }

  const byStaff = actor && (actor.role === 'admin' || actor.role === 'maker');
  const rec = {
    id: uid('wit'),
    memberDocId: member.id,
    memberId: member.memberId,
    memberName: member.nameBn || member.nameEn,
    date: form.date,
    type: form.type || 'savings',
    description: String(form.description || '').trim(),
    amount,
    method: form.method,
    comment: String(form.comment || '').trim(),
    status: byStaff ? 'approved' : 'pending',
    submittedAt: nowISO(),
    submittedBy: actor ? actor.id : 'self',
    submittedByRole: actor ? actor.role : 'member',
    approvedAt: byStaff ? nowISO() : null,
    approvedBy: byStaff ? actor.id : null,
    rejectedAt: null, rejectReason: '',
  };
  await saveRecord('withdrawals', rec, { queue: true, actorId: actor && actor.id });
  await logActivity('WITHDRAWAL_SUBMISSION', `Withdrawal ৳${amount} for ${member.memberId} (${rec.status})`, actor);
  if (rec.status === 'pending') {
    await notify({ title: 'নতুন উত্তোলন / New Withdrawal', body: `${member.nameBn} (${member.memberId}) — ৳${amount}`, audience: 'staff', kind: 'withdraw' });
  } else {
    await notify({ title: 'উত্তোলন সম্পন্ন / Withdrawal Recorded', body: `${member.nameBn} (${member.memberId}) — ৳${amount}`, audience: 'member', memberId: member.memberId, kind: 'withdraw' });
  }
  invalidate('withdrawals');
  return rec;
}

export async function setWithdrawalStatus(withdrawalId, status, actor, reason = '') {
  const w = await dbGet('withdrawals', withdrawalId);
  if (!w) throw new Error('Withdrawal not found');
  const next = { ...w, status };
  if (status === 'approved') { next.approvedAt = nowISO(); next.approvedBy = actor && actor.id; next.rejectedAt = null; next.rejectReason = ''; }
  if (status === 'rejected') { next.rejectedAt = nowISO(); next.rejectReason = reason; next.approvedAt = null; next.approvedBy = null; }
  await saveRecord('withdrawals', next, { queue: true, actorId: actor && actor.id });
  await logActivity(status === 'approved' ? 'WITHDRAWAL_APPROVAL' : 'WITHDRAWAL_REJECTION', `Withdrawal ${w.id} (${w.memberId}, ৳${w.amount}) → ${status}`, actor);
  await notify({
    title: status === 'approved' ? 'উত্তোলন অনুমোদিত / Withdrawal Approved' : 'উত্তোলন বাতিল / Withdrawal Rejected',
    body: `${w.memberName} (${w.memberId}) — ৳${w.amount}${reason ? ' — ' + reason : ''}`,
    audience: 'member', memberId: w.memberId, kind: status === 'approved' ? 'approve' : 'reject',
  });
  invalidate('withdrawals');
  return next;
}

export function canModifyWithdrawal(w, session) {
  if (!session) return { ok: false, msg: 'Not signed in' };
  if (session.role === 'admin') return { ok: true };
  if (session.role === 'maker') {
    if (String(w.date).slice(0, 10) !== todayISO()) {
      return { ok: false, msg: 'Maker শুধুমাত্র আজকের তারিখের উত্তোলন Edit/Delete করতে পারবেন।' };
    }
    return { ok: true };
  }
  return { ok: false, msg: 'উত্তোলন পরিবর্তনের অনুমতি নেই।' };
}

/* ---------------- calculations (APPROVED data only) ---------------- */
export function approvedOf(deposits) { return deposits.filter(d => d.status === 'approved'); }

/** Months whose installment deadline (default the 12th) has already passed. */
export function chargeableMonths(joinISO, asOfISO, dueDay = 12) {
  if (!joinISO || !asOfISO) return 0;
  const asOf = String(asOfISO).slice(0, 10);
  const day = Number(asOf.slice(8, 10));
  let endKey = asOf.slice(0, 7);
  if (day <= Number(dueDay || 12)) {
    const [y, m] = endKey.split('-').map(Number);
    const prev = new Date(y, m - 2, 1);
    endKey = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
  }
  const startKey = String(joinISO).slice(0, 7);
  if (endKey < startKey) return 0;
  return monthsBetweenInclusive(`${startKey}-01`, `${endKey}-01`);
}

/**
 * Member financial summary — only approved deposits/withdrawals count.
 * required = installment × months from join month to current month (inclusive)
 * due = max(0, required − installmentPaid);  advance = max(0, installmentPaid − required)
 * balance = totalDeposit − totalWithdrawal (net available savings)
 */
export function memberSummary(member, deposits, opts = {}) {
  const asOf = opts.asOf || todayISO();
  const countSpecial = !!opts.countSpecialTowardsInstallment;
  const mine = approvedOf(deposits).filter(d => d.memberDocId === member.id || d.memberId === member.memberId);
  const totalDeposit = mine.reduce((s, d) => s + num(d.amount), 0);
  const towards = mine.filter(d => countSpecial ? true : (d.type === 'monthly' || d.type === 'advance'));
  const installmentPaid = towards.reduce((s, d) => s + num(d.amount), 0);
  const inst = num(member.installment);
  const activeFrom = member.joinDate || (member.createdAt || '').slice(0, 10) || asOf;
  const dueDay = opts.dueDay != null ? opts.dueDay : 12;
  const months = member.status === 'rejected' ? 0 : chargeableMonths(activeFrom, asOf, dueDay);
  const required = inst * months;
  const due = Math.max(0, required - installmentPaid);
  const advance = Math.max(0, installmentPaid - required);
  const byType = {};
  for (const d of mine) byType[d.type] = (byType[d.type] || 0) + num(d.amount);
  const byMethod = {};
  for (const d of mine) byMethod[d.method] = (byMethod[d.method] || 0) + num(d.amount);

  // withdrawals (approved only)
  const mineW = (opts.withdrawals || []).filter(w => (w.memberDocId === member.id || w.memberId === member.memberId) && w.status === 'approved');
  const totalWithdrawal = mineW.reduce((s, w) => s + num(w.amount), 0);
  const balance = totalDeposit - totalWithdrawal;

  return { member, months, required, totalDeposit, totalWithdrawal, balance, installmentPaid, due, advance, count: mine.length, withdrawals: mineW, deposits: mine, byType, byMethod };
}

export async function summariesFor(members, deposits, cfg) {
  const s = cfg || await settings();
  const withdrawals = await allWithdrawals();
  return members.map(m => memberSummary(m, deposits, {
    countSpecialTowardsInstallment: s.countSpecialTowardsInstallment,
    withdrawals,
    dueDay: s.dueDay != null ? s.dueDay : 12,
  }));
}

export async function syncDueNotifications() {
  const [members, deposits, cfg, notifs] = await Promise.all([allMembers(), allDeposits(), settings(), allNotifications()]);
  const dueDay = cfg.dueDay != null ? cfg.dueDay : 12;
  let changed = 0;
  for (const m of members) {
    if (m.status !== 'active') continue;
    const s = memberSummary(m, deposits, { countSpecialTowardsInstallment: cfg.countSpecialTowardsInstallment, dueDay });
    const nid = `ntf_due_${m.memberId}`;
    const existing = notifs.find(n => n.id === nid);
    if (s.due > 0) {
      const title = 'মাসিক জমা বকেয়া';
      const body = `প্রিয় ${m.nameBn || m.nameEn}, আপনার মাসিক জমা বকেয়া রয়েছে (৳${Math.round(s.due)})। ${dueDay} তারিখের মধ্যে জমা না দিলে বকেয়া দেখায়। যেকোনো দিন জমা দিতে এখানে ট্যাপ করুন।`;
      if (!existing || existing.body !== body) {
        await notify({
          id: nid, title, body, audience: 'member', memberId: m.memberId,
          kind: 'due', action: 'deposit', sticky: true,
        });
        changed++;
      }
    } else if (existing) {
      await removeRecord('notifications', nid, { queue: true });
      changed++;
    }
  }
  if (changed) invalidate('notifs');
  return changed;
}

export function statementRows(summary) {
  const rows = summary.deposits.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.submittedAt).localeCompare(String(b.submittedAt)));
  let cum = 0;
  return rows.map((d, i) => { cum += num(d.amount); return { sl: i + 1, deposit: d, cumulative: cum }; });
}

export function orgTotals(summaries) {
  return summaries.reduce((acc, s) => {
    acc.totalDeposit += s.totalDeposit; acc.totalWithdrawal += s.totalWithdrawal;
    acc.totalDue += s.due; acc.totalAdvance += s.advance;
    acc.balance = acc.totalDeposit - acc.totalWithdrawal;
    acc.required += s.required; return acc;
  }, { totalDeposit: 0, totalWithdrawal: 0, totalDue: 0, totalAdvance: 0, balance: 0, required: 0 });
}

export function dailyBreakdown(deposits, dateISO) {
  const rows = approvedOf(deposits).filter(d => String(d.date).slice(0, 10) === dateISO);
  const out = { date: dateISO, total: 0, cash: 0, mobile: 0, bank: 0, count: rows.length, rows };
  for (const d of rows) { out.total += num(d.amount); out[d.method] = (out[d.method] || 0) + num(d.amount); }
  return out;
}

export function monthlyBreakdown(deposits, mKey) {
  const rows = approvedOf(deposits).filter(d => monthKey(d.date) === mKey);
  const out = { month: mKey, total: 0, monthly: 0, advance: 0, special: 0, other: 0, cash: 0, mobile: 0, bank: 0, count: rows.length, rows };
  for (const d of rows) { out.total += num(d.amount); out[d.type] = (out[d.type] || 0) + num(d.amount); out[d.method] = (out[d.method] || 0) + num(d.amount); }
  return out;
}

export function rangeBreakdown(deposits, fromISO, toISO_) {
  const rows = approvedOf(deposits).filter(d => {
    const x = String(d.date).slice(0, 10);
    return (!fromISO || x >= fromISO) && (!toISO_ || x <= toISO_);
  });
  const out = { from: fromISO, to: toISO_, total: 0, monthly: 0, advance: 0, special: 0, other: 0, cash: 0, mobile: 0, bank: 0, count: rows.length, rows };
  for (const d of rows) { out.total += num(d.amount); out[d.type] = (out[d.type] || 0) + num(d.amount); out[d.method] = (out[d.method] || 0) + num(d.amount); }
  return out;
}

/* ---------------- maker accounts ---------------- */
export async function createStaffUser({ username, displayName, password, role = 'maker', mobile = '', email = '' }, actor) {
  const uname = String(username || '').trim().toLowerCase();
  if (!uname) throw new Error('Username আবশ্যক / Username required');
  const users = await allUsers();
  if (users.some(u => (u.username || '').toLowerCase() === uname)) throw new Error('এই Username ইতোমধ্যে ব্যবহৃত হয়েছে। / Username already exists.');
  const pw = await hashPassword(password);
  const user = {
    id: uid('usr'), username: uname, role, displayName: displayName || uname,
    mobile: normalizeMobile(mobile), email: (email || '').trim(),
    password: pw, active: true, mustChangePassword: true, createdAt: nowISO(),
  };
  await saveRecord('users', user, { queue: true, actorId: actor && actor.id });
  await logActivity('STAFF_CREATE', `${role} account created: ${uname}`, actor);
  invalidate('users');
  return user;
}

export async function setUserActive(userId, active, actor) {
  const u = await dbGet('users', userId);
  if (!u) throw new Error('User not found');
  const next = { ...u, active: !!active };
  await saveRecord('users', next, { queue: true, actorId: actor && actor.id });
  await logActivity('STAFF_STATUS', `${u.username} → ${active ? 'active' : 'inactive'}`, actor);
  invalidate('users');
  return next;
}

export async function resetUserPassword(userId, newPassword, actor, { mustChange = true } = {}) {
  const u = await dbGet('users', userId);
  if (!u) throw new Error('User not found');
  const pw = await hashPassword(newPassword);
  const next = { ...u, password: pw, mustChangePassword: mustChange, isBootstrap: false };
  await saveRecord('users', next, { queue: true, actorId: actor && actor.id });
  await logActivity('PASSWORD_RESET', `Password reset for ${u.username}`, actor);
  invalidate('users');
  return next;
}

export async function deleteUser(userId, actor) {
  const u = await dbGet('users', userId);
  if (!u) return;
  if (u.role === 'admin') throw new Error('Admin অ্যাকাউন্ট মুছে ফেলা যাবে না। / Admin account cannot be deleted.');
  await removeRecord('users', userId, { queue: true });
  await logActivity('STAFF_DELETE', `Account deleted: ${u.username}`, actor);
  invalidate('users');
}
