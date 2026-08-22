/* Backup & Restore, Authorization Pending, Member Panel, Settings hub */
import {
  el, esc, toast, taka, money, num, fmtDate, fmtDateTime, fmtTime, todayISO,
  confirmBox, alertBox, downloadBlob, deviceId, typeLabel, methodLabel, isValidMobile,
  isValidEmail, APP_NAME_BN, APP_NAME_EN,
} from '../util.js';
import { icon } from '../icons.js';
import { page, card, tableWrap, statusTag, banner, btn, kv, statCard, tabs, embedPage } from '../ui.js';
import { pageActivity } from './misc.js';
import {
  allMembers, allDeposits, allWithdrawals, allUsers, allLogs, settings, saveSettings, setMemberStatus,
  setDepositStatus, setWithdrawalStatus, memberSummary, summariesFor, orgTotals, createStaffUser, setUserActive,
  resetUserPassword, deleteUser, logActivity, invalidate, getMember, statementRows, withdrawalTypeLabel,
} from '../store.js';
import { exportAll, importAll, queueAll, getSetting, dbClear, STORES } from '../db.js';
import { firebase, DEFAULT_FIREBASE_CONFIG } from '../firebase.js';
import { can } from '../auth.js';
import { passwordIssues } from '../crypto.js';
import { App } from '../app.js';
import { formModal, changePasswordDialog } from './account.js';
import { rejectReason, viewMember } from './members.js';
import { downloadExcel } from '../pdf.js';
import { pageFiles, filesSection } from '../storage.js';

/* ==================== Backup & Restore ==================== */
export async function pageBackup(session) {
  const wrap = page('ব্যাকআপ ও পুনরুদ্ধার', 'Backup & Restore', 'backup');
  if (!can(session, 'backup:manage')) { wrap.appendChild(banner('err', 'এই পেজটি শুধুমাত্র Admin ব্যবহার করতে পারবেন। / Admin only.')); return wrap; }

  const [members, deposits, users, logs, queue] = await Promise.all([allMembers(), allDeposits(), allUsers(), allLogs(), queueAll()]);
  const stats = el('div', { class: 'stats' });
  stats.append(
    statCard({ label: 'সদস্য / Members', value: String(members.length), sub: 'IndexedDB', ic: 'members', tone: 'blue' }),
    statCard({ label: 'জমা / Deposits', value: String(deposits.length), sub: 'সব স্ট্যাটাস', ic: 'deposit' }),
    statCard({ label: 'ব্যবহারকারী / Users', value: String(users.length), sub: 'admin + maker + member', ic: 'admin', tone: 'gray' }),
    statCard({ label: 'লগ / Activity Logs', value: String(logs.length), sub: `${queue.length} sync pending`, ic: 'log', tone: queue.length ? 'amber' : 'gray' }),
  );
  wrap.appendChild(stats);

  /* -------- local backup -------- */
  const bBody = el('div');
  bBody.appendChild(banner('info', 'ব্যাকআপ ফাইলে সমস্ত সদস্য, জমা, ব্যবহারকারী (হ্যাশকৃত পাসওয়ার্ডসহ), বিজ্ঞপ্তি, লগ ও সেটিংস সংরক্ষিত থাকে। ফাইলটি নিরাপদ স্থানে রাখুন।'));
  const bRow = el('div', { class: 'btn-row', style: 'margin-top:8px' });
  bRow.appendChild(btn('JSON ব্যাকআপ ডাউনলোড / Download Backup', 'download', 'primary', async () => {
    const payload = await exportAll();
    const name = `Dhruvo_Sangsad_Backup_${todayISO()}_${String(Date.now()).slice(-6)}.json`;
    downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), name);
    await logActivity('BACKUP', `Backup downloaded (${name})`, session);
    toast('ব্যাকআপ ডাউনলোড হয়েছে / Backup downloaded', 'success');
  }));
  bRow.appendChild(btn('Excel ব্যাকআপ / Excel Export', 'excel', 'soft', async () => {
    const cfg = await settings();
    const sums = await summariesFor(members, deposits, cfg);
    const mRows = [['Member ID', 'Name (Bangla)', 'Name (English)', 'Mobile', 'WhatsApp', 'Email', 'NID', 'DOB', 'Profession', 'Address', 'Installment', 'Join Date', 'Status', 'Total Deposit', 'Total Due', 'Total Advance']];
    sums.forEach(s => {
      const m = s.member;
      mRows.push([m.memberId, m.nameBn, m.nameEn, m.mobile, m.whatsapp, m.email || '', m.nid || '', fmtDate(m.dob), m.profession || '', m.address || '', num(m.installment), fmtDate(m.joinDate), m.status, s.totalDeposit, s.due, s.advance]);
    });
    const dRows = [['Deposit ID', 'Date', 'Member ID', 'Member Name', 'Type', 'Method', 'Amount', 'Description', 'Comment', 'Status', 'Submitted At', 'Approved At']];
    deposits.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .forEach(d => dRows.push([d.id, fmtDate(d.date), d.memberId, d.memberName, typeLabel(d.type).en, methodLabel(d.method).en, num(d.amount), d.description || '', d.comment || '', d.status, fmtDateTime(d.submittedAt), d.approvedAt ? fmtDateTime(d.approvedAt) : '']));
    const lRows = [['Date', 'Time', 'User', 'Role', 'Action', 'Details']];
    logs.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .forEach(l => lRows.push([fmtDate(l.createdAt), fmtTime(l.createdAt), l.displayName || '', l.role || '', l.action, l.details || '']));
    downloadExcel([
      { name: 'Members', rows: mRows }, { name: 'Deposits', rows: dRows }, { name: 'Activity Log', rows: lRows },
    ], `Dhruvo_Sangsad_Data_${todayISO()}.xlsx`);
    await logActivity('BACKUP', 'Excel export downloaded', session);
    toast('Excel ডাউনলোড হয়েছে / Excel downloaded', 'success');
  }));
  const bc = card('ব্যাকআপ', 'Backup', bBody);
  bc.body.appendChild(bRow);
  wrap.appendChild(bc);

  /* -------- restore -------- */
  const rBody = el('div');
  rBody.appendChild(banner('warn', '<b>সতর্কতা:</b> পুনরুদ্ধার করলে বর্তমান স্থানীয় ডাটা মুছে গিয়ে ব্যাকআপ ফাইলের ডাটা বসবে। কাজটি ফেরানো যাবে না।'));
  const file = el('input', { type: 'file', accept: '.json,application/json' });
  const ff = el('div', { class: 'field', style: 'margin-top:8px' });
  ff.appendChild(el('label', { text: 'ব্যাকআপ ফাইল নির্বাচন / Select backup file (.json)' }));
  ff.appendChild(file);
  rBody.appendChild(ff);
  const rRow = el('div', { class: 'btn-row', style: 'margin-top:8px' });
  const modeSel = el('select', { style: 'max-width:220px' });
  [['wipe', 'সম্পূর্ণ প্রতিস্থাপন / Replace all'], ['merge', 'একত্রীকরণ / Merge into existing']].forEach(([v, l]) => modeSel.appendChild(el('option', { value: v }, [l])));
  const mf = el('div', { class: 'field', style: 'max-width:240px' });
  mf.appendChild(el('label', { text: 'পুনরুদ্ধার পদ্ধতি / Restore mode' })); mf.appendChild(modeSel);
  rBody.appendChild(mf);
  rRow.appendChild(btn('পুনরুদ্ধার / Restore', 'restore', 'danger', async () => {
    const f = file.files && file.files[0];
    if (!f) { toast('প্রথমে একটি ব্যাকআপ ফাইল নির্বাচন করুন / Select a backup file first', 'warn'); return; }
    let payload;
    try { payload = JSON.parse(await f.text()); }
    catch { toast('ফাইলটি পড়া যায়নি / Invalid JSON file', 'error'); return; }
    if (!payload || !payload.data) { toast('এটি বৈধ ব্যাকআপ ফাইল নয় / Not a valid backup file', 'error'); return; }
    const counts = Object.entries(payload.data).map(([k, v]) => `${k}: ${(v || []).length}`).join(' · ');
    const ok = await confirmBox(
      `ব্যাকআপ তারিখ: ${fmtDateTime(payload.exportedAt)}\n${counts}\n\n${modeSel.value === 'wipe' ? 'বর্তমান সব ডাটা মুছে যাবে।' : 'বিদ্যমান ডাটার সাথে একত্রিত হবে।'} আপনি কি নিশ্চিত?`,
      { title: 'পুনরুদ্ধার নিশ্চিত করুন / Confirm Restore', okLabel: 'Restore', danger: true });
    if (!ok) return;
    try {
      const names = await importAll(payload, { wipe: modeSel.value === 'wipe' });
      invalidate();
      await logActivity('RESTORE', `Restored from backup (${names.join(', ')})`, session);
      await alertBox('পুনরুদ্ধার সফল হয়েছে। অ্যাপ পুনরায় লোড হবে। / Restore successful — the app will reload.', 'সফল / Success');
      location.reload();
    } catch (err) { toast('পুনরুদ্ধার ব্যর্থ: ' + err.message, 'error'); }
  }));
  const rc = card('পুনরুদ্ধার', 'Restore', rBody);
  rc.body.appendChild(rRow);
  wrap.appendChild(rc);

  /* -------- cloud sync -------- */
  const cBody = el('div');
  const cfg = await settings();
  cBody.appendChild(kv([
    ['Firebase', firebase.configured ? '<span class="tag approved">CONFIGURED</span>' : '<span class="tag gray">NOT CONFIGURED</span>'],
    ['Status', `<span class="tag ${firebase.status === 'synced' ? 'approved' : firebase.status === 'offline' ? 'gray' : 'info'}">${esc((firebase.status || 'offline').toUpperCase())}</span>`],
    ['Device ID', esc(deviceId())],
    ['Pending sync items', String(queue.length)],
  ]));
  const cRow = el('div', { class: 'btn-row', style: 'margin-top:8px' });
  cRow.appendChild(btn('Firebase কনফিগার / Configure', 'settings', 'ghost', () => App.go('settings', { tab: 'firebase' })));
  cRow.appendChild(btn('এখনই সিঙ্ক / Sync now', 'sync', 'soft', async () => {
    if (!firebase.configured) { toast('প্রথমে Firebase কনফিগার করুন / Configure Firebase first', 'warn'); return; }
    try { const n = await firebase.flush(); toast(`${n} item(s) synced`, 'success'); App.refresh(); }
    catch (err) { toast(err.message, 'error'); }
  }));
  cRow.appendChild(btn('Cloud → Local (Pull)', 'download', 'ghost', async () => {
    if (!firebase.configured) { toast('প্রথমে Firebase কনফিগার করুন', 'warn'); return; }
    if (!(await confirmBox('Firebase থেকে সব ডাটা টেনে এনে স্থানীয় ডাটার সাথে মিলানো হবে। চালিয়ে যাবেন?', { okLabel: 'Pull' }))) return;
    try { const n = await firebase.pullAll(); invalidate(); toast(`${n} record(s) pulled`, 'success'); App.refresh(); }
    catch (err) { toast(err.message, 'error'); }
  }));
  cRow.appendChild(btn('Local → Cloud (Push)', 'upload', 'ghost', async () => {
    if (!firebase.configured) { toast('প্রথমে Firebase কনফিগার করুন', 'warn'); return; }
    if (!(await confirmBox('স্থানীয় সব ডাটা Firebase-এ পাঠানো হবে এবং সার্ভারের একই রেকর্ড প্রতিস্থাপিত হবে। চালিয়ে যাবেন?', { okLabel: 'Push', danger: true }))) return;
    try { const n = await firebase.pushAll(); toast(`${n} record(s) pushed`, 'success'); }
    catch (err) { toast(err.message, 'error'); }
  }));
  const cc = card('ক্লাউড সিঙ্ক', 'Cloud Sync (Firebase)', cBody);
  cc.body.appendChild(cRow);
  wrap.appendChild(cc);
  return wrap;
}

/* ==================== shared approval queues ==================== */
async function memberQueue(session, host) {
  const [members, deposits, cfg] = await Promise.all([allMembers(), allDeposits(), settings()]);
  const pending = members.filter(m => m.status === 'pending')
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  const c = card('সদস্য অনুমোদন', `Pending Member Approvals (${pending.length})`, el('div'));
  c.body.appendChild(tableWrap(
    [{ label: 'ID' }, { label: 'নাম / Name' }, { label: 'Mobile' }, { label: 'কিস্তি', cls: 'num' }, { label: 'নিবন্ধন / Registered' }, { label: 'Action', cls: 'nowrap' }],
    pending.map(m => {
      const acts = el('div', { class: 'btn-row' });
      acts.appendChild(btn('View', 'eye', 'ghost', () => viewMember(session, m, memberSummary(m, deposits, { countSpecialTowardsInstallment: cfg.countSpecialTowardsInstallment })), { size: 'xs' }));
      acts.appendChild(btn('Approve', 'approve', 'soft', async () => {
        if (!(await confirmBox(`${m.nameBn} (${m.memberId}) — সদস্যপদ অনুমোদন করবেন?`, { okLabel: 'Approve' }))) return;
        await setMemberStatus(m.id, 'active', session); toast('সদস্য অনুমোদিত / Member approved', 'success'); App.refresh();
      }, { size: 'xs' }));
      acts.appendChild(btn('Reject', 'reject', 'softred', async () => {
        const r = await rejectReason();
        if (r === null) return;
        await setMemberStatus(m.id, 'rejected', session, r); toast('সদস্য বাতিল / Member rejected', 'warn'); App.refresh();
      }, { size: 'xs' }));
      acts.appendChild(btn('Edit', 'edit', 'ghost', () => App.go('members', { tab: 'update', memberDocId: m.id }), { size: 'xs' }));
      return [
        `<b>${esc(m.memberId)}</b>`,
        `${esc(m.nameBn)}<br><span class="faint fs8">${esc(m.nameEn)}</span>`,
        esc(m.mobile), { text: money(m.installment), cls: 'num' },
        esc(fmtDate(m.createdAt || m.joinDate)),
        { node: acts, cls: 'nowrap' },
      ];
    }),
    { empty: 'অনুমোদনের অপেক্ষায় কোনো সদস্য নেই / No pending members', emptyIcon: 'approve' },
  ));
  host.appendChild(c);
}

async function depositQueue(session, host) {
  const deposits = await allDeposits();
  const pending = deposits.filter(d => d.status === 'pending')
    .sort((a, b) => String(a.submittedAt || '').localeCompare(String(b.submittedAt || '')));
  const total = pending.reduce((s, d) => s + num(d.amount), 0);
  const c = card('জমা অনুমোদন', `Pending Deposit Approvals (${pending.length})`, el('div'));
  c.body.appendChild(tableWrap(
    [{ label: 'Date' }, { label: 'Member' }, { label: 'ধরন / Type' }, { label: 'পদ্ধতি / Method' }, { label: 'পরিমাণ', cls: 'num' }, { label: 'বিবরণ' }, { label: 'Action', cls: 'nowrap' }],
    pending.map(d => {
      const acts = el('div', { class: 'btn-row' });
      acts.appendChild(btn('Approve', 'approve', 'soft', async () => {
        if (!(await confirmBox(`${d.memberName} — ${taka(d.amount)} (${fmtDate(d.date)}) অনুমোদন করবেন?`, { okLabel: 'Approve' }))) return;
        await setDepositStatus(d.id, 'approved', session); toast('জমা অনুমোদিত / Deposit approved', 'success'); App.refresh();
      }, { size: 'xs' }));
      acts.appendChild(btn('Reject', 'reject', 'softred', async () => {
        const r = await rejectReason('জমা বাতিলের কারণ / Deposit Rejection Reason');
        if (r === null) return;
        await setDepositStatus(d.id, 'rejected', session, r); toast('জমা বাতিল / Deposit rejected', 'warn'); App.refresh();
      }, { size: 'xs' }));
      return [
        esc(fmtDate(d.date)),
        `${esc(d.memberName)}<br><span class="faint fs8">${esc(d.memberId)}</span>`,
        esc(typeLabel(d.type).bn), esc(methodLabel(d.method).bn),
        { text: money(d.amount), cls: 'num' },
        esc(d.description || d.comment || '—'),
        { node: acts, cls: 'nowrap' },
      ];
    }),
    {
      empty: 'অনুমোদনের অপেক্ষায় কোনো জমা নেই / No pending deposits', emptyIcon: 'deposit',
      footer: pending.length ? [{ html: '' }, { html: '<b>সর্বমোট / Total</b>' }, { html: '' }, { html: '' }, { html: `<b>${money(total)}</b>`, cls: 'num' }, { html: '' }, { html: '' }] : null,
    },
  ));
  host.appendChild(c);
}

/* ==================== Authorization Pending ==================== */
export async function pageAuthorization(session) {
  const wrap = page('অনুমোদন অপেক্ষমাণ', 'Authorization Pending', 'approve');
  const canApproveMember = can(session, 'member:approve');
  const canApproveDeposit = can(session, 'deposit:approve');
  if (!canApproveMember && !canApproveDeposit) {
    wrap.appendChild(banner('err', 'এই পেজে প্রবেশাধিকার নেই / You are not authorized to view pending authorizations.'));
    return wrap;
  }

  const [members, deposits, withdrawals] = await Promise.all([allMembers(), allDeposits(), allWithdrawals()]);
  const pm = members.filter(m => m.status === 'pending').length;
  const pd = deposits.filter(d => d.status === 'pending').length;
  const pw = withdrawals.filter(w => w.status === 'pending').length;

  const stats = el('div', { class: 'stats' });
  stats.append(
    statCard({ label: 'সদস্য অনুমোদন / Pending Members', value: String(pm), sub: 'সদস্যপদ অনুমোদনের অপেক্ষায়', ic: 'members', tone: 'amber' }),
    statCard({ label: 'জমা অনুমোদন / Pending Deposits', value: String(pd), sub: 'জমা অনুমোদনের অপেক্ষায়', ic: 'deposit', tone: 'amber' }),
    statCard({ label: 'উত্তোলন অনুমোদন / Pending Withdrawals', value: String(pw), sub: 'উত্তোলন অনুমোদনের অপেক্ষায়', ic: 'withdraw', tone: 'amber' }),
    statCard({ label: 'সর্বমোট / Total', value: String(pm + pd + pw), sub: 'সব অনুমোদন এখানে কেন্দ্রীভূত', ic: 'pending' }),
  );
  wrap.appendChild(stats);

  if (canApproveMember) await memberQueue(session, wrap);
  if (canApproveDeposit) await depositQueue(session, wrap);
  if (canApproveDeposit) await withdrawalQueue(session, wrap);
  return wrap;
}

async function withdrawalQueue(session, host) {
  const withdrawals = await allWithdrawals();
  const pending = withdrawals.filter(w => w.status === 'pending')
    .sort((a, b) => String(a.submittedAt || '').localeCompare(String(b.submittedAt || '')));
  const total = pending.reduce((s, w) => s + num(w.amount), 0);
  const c = card('উত্তোলন অনুমোদন', `Pending Withdrawal Approvals (${pending.length})`, el('div'));
  c.body.appendChild(tableWrap(
    [{ label: 'Date' }, { label: 'Member' }, { label: 'ধরন / Type' }, { label: 'পদ্ধতি / Method' }, { label: 'পরিমাণ', cls: 'num' }, { label: 'বিবরণ' }, { label: 'Action', cls: 'nowrap' }],
    pending.map(w => {
      const acts = el('div', { class: 'btn-row' });
      acts.appendChild(btn('Approve', 'approve', 'soft', async () => {
        if (!(await confirmBox(`${w.memberName} — ${taka(w.amount)} (${fmtDate(w.date)}) উত্তোলন অনুমোদন করবেন?`, { okLabel: 'Approve' }))) return;
        await setWithdrawalStatus(w.id, 'approved', session); toast('উত্তোলন অনুমোদিত / Withdrawal approved', 'success'); App.refresh();
      }, { size: 'xs' }));
      acts.appendChild(btn('Reject', 'reject', 'softred', async () => {
        const r = await rejectReason('উত্তোলন বাতিলের কারণ / Withdrawal Rejection Reason');
        if (r === null) return;
        await setWithdrawalStatus(w.id, 'rejected', session, r); toast('উত্তোলন বাতিল / Withdrawal rejected', 'warn'); App.refresh();
      }, { size: 'xs' }));
      return [
        esc(fmtDate(w.date)),
        `${esc(w.memberName)}<br><span class="faint fs8">${esc(w.memberId)}</span>`,
        esc(withdrawalTypeLabel(w.type).bn), esc(methodLabel(w.method).bn),
        { text: money(w.amount), cls: 'num' },
        esc(w.description || w.comment || '—'),
        { node: acts, cls: 'nowrap' },
      ];
    }),
    {
      empty: 'অনুমোদনের অপেক্ষায় কোনো উত্তোলন নেই / No pending withdrawals', emptyIcon: 'withdraw',
      footer: pending.length ? [{ html: '' }, { html: '<b>সর্বমোট / Total</b>' }, { html: '' }, { html: '' }, { html: `<b>${money(total)}</b>`, cls: 'num' }, { html: '' }, { html: '' }] : null,
    },
  ));
  host.appendChild(c);
}

async function staffManager(session, host) {
  const users = await allUsers();
  const staff = users.filter(u => u.role === 'maker' || u.role === 'admin')
    .sort((a, b) => (a.role === b.role ? (a.username || '').localeCompare(b.username || '') : a.role === 'admin' ? -1 : 1));

  const c = card('Maker / Admin অ্যাকাউন্ট', 'Staff Accounts', el('div'), [
    btn('নতুন Maker / New Maker', 'plus', 'primary', () => newStaff(session), { size: 'xs' }),
  ]);
  c.body.appendChild(tableWrap(
    [{ label: 'Username' }, { label: 'নাম / Name' }, { label: 'Role' }, { label: 'Mobile' }, { label: 'Status' }, { label: 'তৈরি / Created' }, { label: 'Action', cls: 'nowrap' }],
    staff.map(u => {
      const acts = el('div', { class: 'btn-row' });
      acts.appendChild(btn('Reset PW', 'key', 'ghost', () => resetPw(session, u), { size: 'xs' }));
      if (u.role !== 'admin') {
        acts.appendChild(btn(u.active === false ? 'Activate' : 'Deactivate', u.active === false ? 'approve' : 'lock', u.active === false ? 'soft' : 'softred', async () => {
          await setUserActive(u.id, u.active === false, session);
          toast(u.active === false ? 'অ্যাকাউন্ট সক্রিয় / Activated' : 'অ্যাকাউন্ট নিষ্ক্রিয় / Deactivated', 'success');
          App.refresh();
        }, { size: 'xs' }));
        acts.appendChild(btn('Delete', 'trash', 'softred', async () => {
          if (!(await confirmBox(`${u.username} অ্যাকাউন্টটি স্থায়ীভাবে মুছে ফেলবেন?`, { okLabel: 'Delete', danger: true }))) return;
          try { await deleteUser(u.id, session); toast('অ্যাকাউন্ট মুছে ফেলা হয়েছে / Account deleted', 'warn'); App.refresh(); }
          catch (err) { toast(err.message, 'error'); }
        }, { size: 'xs' }));
      }
      return [
        `<b>${esc(u.username)}</b>`, esc(u.displayName || ''),
        `<span class="tag ${u.role === 'admin' ? 'info' : 'approved'}">${esc(u.role.toUpperCase())}</span>`,
        esc(u.mobile || '—'),
        `<span class="tag ${u.active === false ? 'rejected' : 'approved'}">${u.active === false ? 'INACTIVE' : 'ACTIVE'}</span>${u.mustChangePassword ? ' <span class="tag pending">PW CHANGE</span>' : ''}`,
        esc(fmtDate(u.createdAt)),
        { node: acts, cls: 'nowrap' },
      ];
    }),
    { empty: 'কোনো স্টাফ অ্যাকাউন্ট নেই / No staff accounts', emptyIcon: 'maker' },
  ));
  host.appendChild(c);
  host.appendChild(banner('info', 'Maker সদস্য অনুমোদন, জমা এন্ট্রি ও অনুমোদন, প্রতিবেদন ও WhatsApp রিমাইন্ডার ব্যবহার করতে পারেন। Maker কেবল <b>আজকের তারিখের</b> জমা সম্পাদনা বা মুছতে পারবেন এবং Member ID পরিবর্তন করতে পারবেন না।'));
}

function newStaff(session) {
  return formModal({
    title: 'নতুন Maker অ্যাকাউন্ট / New Maker Account',
    width: 460, okLabel: 'Create', dismissible: true,
    html: `<div class="grid g2">
        <div class="field"><label>Username <span class="req">*</span></label><input name="username" required autocomplete="off"></div>
        <div class="field"><label>নাম / Display Name <span class="req">*</span></label><input name="displayName" required></div>
        <div class="field"><label>Mobile</label><input name="mobile" inputmode="numeric" maxlength="11"></div>
        <div class="field"><label>Email</label><input name="email" type="email"></div>
        <div class="field"><label>Password <span class="req">*</span></label><input name="pw1" type="password" required autocomplete="new-password"></div>
        <div class="field"><label>Confirm Password <span class="req">*</span></label><input name="pw2" type="password" required autocomplete="new-password"></div>
      </div>
      <div class="hint">প্রথম লগইনে Maker-কে পাসওয়ার্ড পরিবর্তন করতে হবে।</div>`,
    onSubmit: async (v, fail) => {
      if (!String(v.username || '').trim()) return fail('Username আবশ্যক');
      if (!String(v.displayName || '').trim()) return fail('নাম আবশ্যক');
      if (v.mobile && !isValidMobile(v.mobile)) return fail('সঠিক মোবাইল নম্বর দিন');
      if (v.email && !isValidEmail(v.email)) return fail('সঠিক Email দিন');
      const issues = passwordIssues(v.pw1);
      if (issues.length) return fail(issues[0]);
      if (v.pw1 !== v.pw2) return fail('দুইটি Password এক নয় / Passwords do not match');
      await createStaffUser({ username: v.username, displayName: v.displayName, password: v.pw1, role: 'maker', mobile: v.mobile, email: v.email }, session);
      toast('Maker অ্যাকাউন্ট তৈরি হয়েছে / Maker account created', 'success');
      App.refresh();
      return true;
    },
  });
}

function resetPw(session, u) {
  return formModal({
    title: `পাসওয়ার্ড রিসেট / Reset Password — ${u.username}`,
    width: 420, okLabel: 'Reset', dismissible: true,
    html: `<div class="banner warn">${icon('warn')}<span>নতুন পাসওয়ার্ড ব্যবহারকারীকে নিরাপদে জানিয়ে দিন। পুরাতন পাসওয়ার্ড আর কাজ করবে না।</span></div>
      <div class="grid g2">
        <div class="field"><label>New Password <span class="req">*</span></label><input name="pw1" type="password" required autocomplete="new-password"></div>
        <div class="field"><label>Confirm Password <span class="req">*</span></label><input name="pw2" type="password" required autocomplete="new-password"></div>
      </div>
      <label class="check"><input type="checkbox" name="mustChange" checked> পরবর্তী লগইনে পাসওয়ার্ড পরিবর্তন বাধ্যতামূলক</label>`,
    onSubmit: async (v, fail) => {
      const issues = passwordIssues(v.pw1);
      if (issues.length) return fail(issues[0]);
      if (v.pw1 !== v.pw2) return fail('দুইটি Password এক নয় / Passwords do not match');
      await resetUserPassword(u.id, v.pw1, session, { mustChange: !!v.mustChange });
      toast('পাসওয়ার্ড রিসেট হয়েছে / Password reset', 'success');
      App.refresh();
      return true;
    },
  });
}

async function accountManager(session, host) {
  const [members, users] = await Promise.all([allMembers(), allUsers()]);
  const rows = members.slice().sort((a, b) => a.memberId.localeCompare(b.memberId)).map(m => ({ m, u: users.find(u => u.memberDocId === m.id) }));
  const c = card('সদস্য লগইন অ্যাকাউন্ট', 'Member Login Accounts', el('div'));
  c.body.appendChild(banner('info', 'সদস্যের লগইন Username = তার মোবাইল নম্বর। পাসওয়ার্ড কখনো সংরক্ষিত বা প্রদর্শিত হয় না — প্রয়োজনে রিসেট করুন।'));
  c.body.appendChild(tableWrap(
    [{ label: 'Member ID' }, { label: 'নাম / Name' }, { label: 'Username (Mobile)' }, { label: 'সদস্য স্ট্যাটাস' }, { label: 'লগইন স্ট্যাটাস' }, { label: 'Action', cls: 'nowrap' }],
    rows.map(({ m, u }) => {
      const acts = el('div', { class: 'btn-row' });
      if (u) {
        acts.appendChild(btn('Reset PW', 'key', 'ghost', () => resetPw(session, u), { size: 'xs' }));
        acts.appendChild(btn(u.active === false ? 'Enable' : 'Disable', u.active === false ? 'approve' : 'lock', u.active === false ? 'soft' : 'softred', async () => {
          await setUserActive(u.id, u.active === false, session);
          toast('লগইন স্ট্যাটাস হালনাগাদ / Login status updated', 'success'); App.refresh();
        }, { size: 'xs' }));
      }
      acts.appendChild(btn('Edit', 'edit', 'ghost', () => App.go('members', { tab: 'update', memberDocId: m.id }), { size: 'xs' }));
      return [
        `<b>${esc(m.memberId)}</b>`, esc(m.nameBn), esc(u ? u.username : '—'),
        { html: statusTag(m.status) },
        u ? `<span class="tag ${u.active === false ? 'rejected' : 'approved'}">${u.active === false ? 'DISABLED' : 'ENABLED'}</span>` : '<span class="tag gray">NO ACCOUNT</span>',
        { node: acts, cls: 'nowrap' },
      ];
    }),
    { empty: 'কোনো সদস্য নেই / No members', emptyIcon: 'members' },
  ));
  host.appendChild(c);
}

/* ==================== Member Panel ==================== */
export async function pageMemberPanel(session) {
  const wrap = page('সদস্য প্যানেল', 'Member Panel', 'member');
  if (session.role !== 'member') { wrap.appendChild(banner('err', 'এই পেজটি শুধুমাত্র সদস্যদের জন্য। / Members only.')); return wrap; }
  const [deposits, cfg] = await Promise.all([allDeposits(), settings()]);
  const m = await getMember(session.memberDocId);
  if (!m) { wrap.appendChild(banner('err', 'সদস্য প্রোফাইল পাওয়া যায়নি / Member profile not found')); return wrap; }
  const s = memberSummary(m, deposits, { countSpecialTowardsInstallment: cfg.countSpecialTowardsInstallment });

  if (m.status === 'pending') wrap.appendChild(banner('warn', 'আপনার সদস্যপদ এখনো অনুমোদনের অপেক্ষায়। অনুমোদনের পূর্বে জমা দাখিল করা যাবে না।'));
  if (m.status === 'rejected') wrap.appendChild(banner('err', `আপনার সদস্যপদ বাতিল করা হয়েছে।${m.rejectReason ? ' কারণ: ' + esc(m.rejectReason) : ''}`));

  const stats = el('div', { class: 'stats' });
  stats.append(
    statCard({ label: 'মাসিক কিস্তি / Installment', value: taka(m.installment), sub: `${s.months} মাস হিসাবযোগ্য`, ic: 'money' }),
    statCard({ label: 'মোট জমা / Total Deposit', value: taka(s.totalDeposit), sub: `${s.count} approved`, ic: 'deposit' }),
    statCard({ label: 'বকেয়া / Total Due', value: taka(s.due), sub: `প্রয়োজন ${taka(s.required)}`, ic: 'due', tone: s.due > 0 ? 'red' : '' }),
    statCard({ label: 'অগ্রিম / Total Advance', value: taka(s.advance), sub: s.advance > 0 ? 'অতিরিক্ত জমা' : '—', ic: 'advance', tone: 'blue' }),
  );
  wrap.appendChild(stats);

  /* profile (read-only for approved fields) */
  const prof = el('div');
  prof.appendChild(kv([
    ['Member ID', `<b style="color:var(--green-dark)">${esc(m.memberId)}</b>`],
    ['নাম (বাংলা)', esc(m.nameBn)], ['Name (English)', esc(m.nameEn)],
    ['পিতার নাম', esc(m.fatherBn || m.fatherEn || '')], ['মাতার নাম', esc(m.motherBn || m.motherEn || '')],
    ['Mobile', esc(m.mobile)], ['WhatsApp', esc(m.whatsapp)],
    ['Email', esc(m.email || '')], ['NID', esc(m.nid || '')],
    ['Date of Birth', esc(fmtDate(m.dob))], ['পেশা / Profession', esc(m.profession || '')],
    ['ঠিকানা / Address', esc(m.address || '')],
    ['যোগদানের তারিখ / Join Date', esc(fmtDate(m.joinDate))],
    ['স্ট্যাটাস / Status', statusTag(m.status)],
  ]));
  const pRow = el('div', { class: 'btn-row', style: 'margin-top:9px' });
  pRow.append(
    btn('পাসওয়ার্ড পরিবর্তন / Change Password', 'lock', 'ghost', () => changePasswordDialog()),
    btn('স্টেটমেন্ট / Statement', 'report', 'ghost', () => App.go('reports', { report: 'statement' })),
    btn('লেনদেন / Transactions', 'history', 'ghost', () => App.go('deposit', { tab: 'transactions' })),
  );
  if (m.status === 'active') pRow.appendChild(btn('জমা দাখিল / Submit Deposit', 'deposit', 'primary', () => App.go('deposit')));
  const pc = card('আমার প্রোফাইল', 'My Profile', prof);
  pc.body.appendChild(pRow);
  pc.body.appendChild(el('div', { class: 'fs8 muted', style: 'margin-top:6px', text: 'প্রোফাইল সংশোধনের প্রয়োজন হলে Maker/Admin-এর সাথে যোগাযোগ করুন।' }));
  wrap.appendChild(pc);
  wrap.appendChild(filesSection(session, {
    memberId: m.memberId, memberDocId: m.id,
    titleBn: 'আমার ফাইল', titleEn: 'My Files',
  }));

  /* my deposits */
  const rows = statementRows(s).reverse();
  wrap.appendChild(card('আমার জমা', 'My Approved Deposits', tableWrap(
    [{ label: 'SL', cls: 'num' }, { label: 'Date' }, { label: 'ধরন / Type' }, { label: 'পদ্ধতি / Method' }, { label: 'পরিমাণ', cls: 'num' }, { label: 'ক্রমপুঞ্জিত', cls: 'num' }],
    rows.map(r => [
      { text: String(r.sl), cls: 'num' }, esc(fmtDate(r.deposit.date)),
      esc(typeLabel(r.deposit.type).bn), esc(methodLabel(r.deposit.method).bn),
      { text: money(r.deposit.amount), cls: 'num' }, { text: money(r.cumulative), cls: 'num' }],
    ),
    {
      empty: 'কোনো অনুমোদিত জমা নেই / No approved deposit yet', emptyIcon: 'deposit',
      footer: rows.length ? [{ html: '' }, { html: '<b>সর্বমোট / Total</b>' }, { html: '' }, { html: '' }, { html: `<b>${money(s.totalDeposit)}</b>`, cls: 'num' }, { html: '' }] : null,
    },
  )));

  const pend = deposits.filter(d => (d.memberDocId === m.id || d.memberId === m.memberId) && d.status !== 'approved')
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  if (pend.length) {
    wrap.appendChild(card('অপেক্ষমাণ ও বাতিল জমা', 'Pending & Rejected Deposits', tableWrap(
      [{ label: 'Date' }, { label: 'ধরন / Type' }, { label: 'পদ্ধতি / Method' }, { label: 'পরিমাণ', cls: 'num' }, { label: 'Status' }, { label: 'মন্তব্য / Note' }],
      pend.map(d => [esc(fmtDate(d.date)), esc(typeLabel(d.type).bn), esc(methodLabel(d.method).bn),
        { text: money(d.amount), cls: 'num' }, { html: statusTag(d.status) }, esc(d.rejectReason || d.description || '—')]),
    )));
  }
  return wrap;
}

/* ==================== Settings (tabbed hub) ==================== */
export async function pageSettings(session, params = {}) {
  const wrap = page('সেটিংস', 'Settings', 'settings');

  const TABS = [
    { id: 'account', label: 'আমার অ্যাকাউন্ট / Account' },
    { id: 'files', label: 'ফাইল / Files' },
    { id: 'activity', label: 'কার্যক্রম লগ / Activity Log' },
  ];
  if (can(session, 'settings:manage')) {
    TABS.push({ id: 'organisation', label: 'সংগঠন সেটিংস / Organisation' });
    TABS.push({ id: 'firebase', label: 'ক্লাউড সিঙ্ক / Firebase' });
  }
  if (session.role === 'admin') {
    TABS.push({ id: 'staff', label: 'স্টাফ / Staff' });
    TABS.push({ id: 'accounts', label: 'সদস্য অ্যাকাউন্ট / Accounts' });
  }
  if (can(session, 'backup:manage')) {
    TABS.push({ id: 'backup', label: 'ব্যাকআপ / Backup & Restore' });
  }

  let active = params.tab && TABS.some(t => t.id === params.tab) ? params.tab : 'account';
  const host = el('div');
  const tabBar = tabs(TABS, active, id => {
    active = id;
    App.params = { ...(App.params || {}), tab: id };
    paint();
    tabBar.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', TABS[i].id === id));
  });
  wrap.append(tabBar, host);

  async function paint() {
    host.replaceChildren();
    if (active === 'account') accountSection(session, host);
    else if (active === 'files') await embedPage(host, pageFiles, session);
    else if (active === 'activity') await embedPage(host, pageActivity, session);
    else if (active === 'organisation') await organisationSection(session, host);
    else if (active === 'firebase') await firebaseSection(session, host);
    else if (active === 'staff') await staffManager(session, host);
    else if (active === 'accounts') await accountManager(session, host);
    else if (active === 'backup') await embedPage(host, pageBackup, session);
  }
  await paint();
  return wrap;
}

function accountSection(session, host) {
  const acc = el('div');
  acc.appendChild(kv([
    ['ব্যবহারকারী / User', esc(session.displayName || session.username)],
    ['Username', esc(session.username)],
    ['রোল / Role', `<span class="tag ${session.role === 'admin' ? 'info' : session.role === 'maker' ? 'approved' : 'gray'}">${esc(session.role.toUpperCase())}</span>`],
    ...(session.memberId ? [['Member ID', esc(session.memberId)]] : []),
    ['লগইন সময় / Login at', esc(fmtDateTime(session.loginAt))],
    ['Device ID', esc(deviceId())],
  ]));
  const accRow = el('div', { class: 'btn-row', style: 'margin-top:9px' });
  accRow.appendChild(btn('পাসওয়ার্ড পরিবর্তন / Change Password', 'lock', 'primary', () => changePasswordDialog()));
  const accCard = card('আমার অ্যাকাউন্ট', 'My Account', acc);
  accCard.body.appendChild(accRow);
  host.appendChild(accCard);

  if (session.role === 'member') {
    accRow.appendChild(btn('আমার প্রোফাইল / My Profile', 'member', 'ghost', () => App.go('member-panel')));
  }

  const about = kv([
    ['অ্যাপ / Application', `${esc(APP_NAME_BN)} — ${esc(APP_NAME_EN)}`],
    ['সংস্করণ / Version', '1.0.0'],
    ['ধরন / Type', 'Offline-first PWA · IndexedDB + Firebase Realtime Database + Storage'],
    ['সংযোগ / Connection', navigator.onLine ? '<span class="tag approved">ONLINE</span>' : '<span class="tag gray">OFFLINE</span>'],
    ['ব্যাকআপ / Data safety', 'Admin → Settings → Backup & Restore'],
  ]);
  host.appendChild(card('অ্যাপ সম্পর্কে', 'About', about));
}

async function organisationSection(session, host) {
  const cfg = await settings();
  const f = el('form', { class: 'grid', novalidate: true });
  f.innerHTML = `
    <div class="grid g2">
      <div class="field"><label>সংগঠনের নাম (বাংলা) <span class="req">*</span></label><input name="orgNameBn" value="${esc(cfg.orgNameBn)}" required></div>
      <div class="field"><label>Organisation Name (English) <span class="req">*</span></label><input name="orgNameEn" value="${esc(cfg.orgNameEn)}" required></div>
      <div class="field"><label>ঠিকানা / Address</label><input name="orgAddress" value="${esc(cfg.orgAddress || '')}"></div>
      <div class="field"><label>ফোন / Phone</label><input name="orgPhone" value="${esc(cfg.orgPhone || '')}"></div>
      <div class="field"><label>ডিফল্ট মাসিক কিস্তি (৳)</label><input name="defaultInstallment" type="number" min="0" value="${esc(cfg.defaultInstallment)}"></div>
      <div class="field"><label>মাসিক আদায় লক্ষ্যমাত্রা (৳)</label><input name="monthlyTarget" type="number" min="0" value="${esc(cfg.monthlyTarget)}"><div class="hint">০ দিলে সক্রিয় সদস্যদের কিস্তির যোগফল লক্ষ্য ধরা হবে।</div></div>
    </div>
    <label class="check"><input type="checkbox" name="countSpecialTowardsInstallment" ${cfg.countSpecialTowardsInstallment ? 'checked' : ''}> বিশেষ চাঁদা ও অন্যান্য জমাকেও কিস্তি হিসেবে গণনা করুন</label>
    <div class="field" style="margin-top:8px"><label>WhatsApp বকেয়া রিমাইন্ডার টেমপ্লেট</label>
      <textarea name="waTemplate" rows="7">${esc(cfg.waTemplate)}</textarea>
      <div class="hint"><b>[Member Name]</b> অংশটি স্বয়ংক্রিয়ভাবে সদস্যের নাম দিয়ে প্রতিস্থাপিত হবে। বার্তায় কোনো টাকার অঙ্ক থাকবে না।</div></div>
    <div class="form-actions">
      <button class="btn btn-primary" type="submit">${icon('save')}<span>Save / সংরক্ষণ</span></button>
      <button class="btn btn-ghost" type="reset">${icon('clear')}<span>Reset</span></button>
    </div>`;
  f.addEventListener('submit', async e => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(f).entries());
    if (!String(v.orgNameBn || '').trim() || !String(v.orgNameEn || '').trim()) { toast('সংগঠনের নাম আবশ্যক / Organisation name required', 'error'); return; }
    if (!String(v.waTemplate || '').includes('[Member Name]')) { toast('টেমপ্লেটে [Member Name] অবশ্যই থাকতে হবে', 'error'); return; }
    await saveSettings({
      orgNameBn: v.orgNameBn.trim(), orgNameEn: v.orgNameEn.trim(),
      orgAddress: (v.orgAddress || '').trim(), orgPhone: (v.orgPhone || '').trim(),
      defaultInstallment: num(v.defaultInstallment), monthlyTarget: num(v.monthlyTarget),
      countSpecialTowardsInstallment: !!v.countSpecialTowardsInstallment,
      waTemplate: v.waTemplate,
    });
    await logActivity('SETTINGS_UPDATE', 'Organisation settings updated', session);
    toast('সেটিংস সংরক্ষিত হয়েছে / Settings saved', 'success');
    App.refresh();
  });
  host.appendChild(card('সংগঠন ও হিসাব সেটিংস', 'Organisation & Accounting Settings', f));

  /* --- danger zone --- */
  const dz = el('div');
  dz.appendChild(banner('warn', 'নিচের কাজগুলো স্থায়ী। কাজ করার আগে অবশ্যই ব্যাকআপ নিন।'));
  const dRow = el('div', { class: 'btn-row', style: 'margin-top:8px' });
  dRow.appendChild(btn('ব্যাকআপ ও রিস্টোর / Backup & Restore', 'backup', 'ghost', () => App.go('settings', { tab: 'backup' })));
  dRow.appendChild(btn('স্থানীয় ডাটা মুছুন / Clear local data', 'trash', 'danger', async () => {
    if (!(await confirmBox('এই ডিভাইসের সমস্ত স্থানীয় ডাটা (সদস্য, জমা, লগ, ব্যবহারকারী) মুছে যাবে। Firebase-এ ডাটা থাকলে পুনরায় Pull করা যাবে। নিশ্চিত?', { okLabel: 'Erase', danger: true }))) return;
    if (!(await confirmBox('শেষ সতর্কতা — সত্যিই মুছে ফেলবেন?', { okLabel: 'Yes, erase', danger: true }))) return;
    for (const st of Object.keys(STORES)) await dbClear(st);
    invalidate();
    toast('স্থানীয় ডাটা মুছে ফেলা হয়েছে / Local data cleared', 'warn');
    setTimeout(() => location.reload(), 700);
  }));
  const dc = card('বিপদজনক অঞ্চল', 'Danger Zone', dz);
  dc.body.appendChild(dRow);
  host.appendChild(dc);
}

async function firebaseSection(session, host) {
  const fbCfg = await getSetting('firebaseConfig', null);
  // Show the active config: a saved override, otherwise the built-in project default.
  const shown = (fbCfg && fbCfg.databaseURL) ? fbCfg : DEFAULT_FIREBASE_CONFIG;
  const fb = el('form', { class: 'grid', novalidate: true });
  const g = (k, ph) => `<div class="field"><label>${k}</label><input name="${k}" value="${esc((shown && shown[k]) || '')}" placeholder="${esc(ph)}" autocomplete="off"></div>`;
  fb.innerHTML = `
    <div class="banner info">${icon('info')}<span>Firebase কনফিগার করলে সব ডিভাইসের ডাটা রিয়েল-টাইমে সিঙ্ক হবে। কনফিগার না করলেও অ্যাপটি সম্পূর্ণ অফলাইনে (IndexedDB) কাজ করবে।</span></div>
    <div class="grid g2">
      ${g('apiKey', 'AIza…')}${g('authDomain', 'project.firebaseapp.com')}
      ${g('databaseURL', 'https://dhruvo-sangsad-default-rtdb.firebaseio.com')}${g('projectId', 'project-id')}
      ${g('storageBucket', 'project.appspot.com')}${g('messagingSenderId', '1234567890')}
      ${g('appId', '1:123:web:abc')}
    </div>
    <div class="form-actions">
      <button class="btn btn-primary" type="submit">${icon('save')}<span>Save & Connect</span></button>
      <button class="btn btn-ghost" type="button" id="fbClear">${icon('clear')}<span>Disconnect</span></button>
      <button class="btn btn-soft" type="button" id="fbSync">${icon('sync')}<span>Sync now</span></button>
    </div>
    <div class="fs8 muted" id="fbStat"></div>`;
  const stat = fb.querySelector('#fbStat');
  const paintStat = () => { stat.textContent = `Status: ${firebase.status}${firebase.lastError ? ' — ' + firebase.lastError : ''}`; };
  paintStat();
  window.addEventListener('ds:sync-status', paintStat);
  fb.addEventListener('submit', async e => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(fb).entries());
    if (!v.apiKey || !v.databaseURL) { toast('apiKey ও databaseURL আবশ্যক / apiKey and databaseURL are required', 'error'); return; }
    try {
      await firebase.saveConfig(v);
      await logActivity('SETTINGS_UPDATE', 'Firebase configuration updated', session);
      toast(firebase.ready ? 'Firebase সংযুক্ত হয়েছে / Firebase connected' : 'সংরক্ষিত হয়েছে / Saved', firebase.ready ? 'success' : 'info');
      paintStat();
    } catch (err) { toast(err.message, 'error'); }
  });
  fb.querySelector('#fbClear').addEventListener('click', async () => {
    if (!(await confirmBox('Firebase সংযোগ বিচ্ছিন্ন করবেন? অ্যাপটি শুধুমাত্র অফলাইনে চলবে।', { okLabel: 'Disconnect', danger: true }))) return;
    await firebase.saveConfig(null);
    toast('সংযোগ বিচ্ছিন্ন / Disconnected', 'warn');
    App.refresh();
  });
  fb.querySelector('#fbSync').addEventListener('click', async () => {
    if (!firebase.configured) { toast('প্রথমে Firebase কনফিগার করুন', 'warn'); return; }
    try { const n = await firebase.flush(); toast(`${n} item(s) synced`, 'success'); } catch (err) { toast(err.message, 'error'); }
  });
  host.appendChild(card('ক্লাউড সিঙ্ক', 'Firebase Realtime Database', fb));
}
