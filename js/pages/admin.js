/* Backup & Restore, Authorization Pending, Member Panel, Settings hub */
import {
  el, esc, toast, taka, money, num, fmtDate, fmtDateTime, fmtTime, todayISO,
  confirmBox, alertBox, downloadBlob, deviceId, typeLabel, methodLabel, isValidMobile,
  isValidEmail, APP_NAME_BN, APP_NAME_EN, debounce,
} from '../util.js';
import { icon } from '../icons.js';
import { page, card, tableWrap, statusTag, banner, btn, kv, statCard, embedPage } from '../ui.js';
import { attachSwipe } from '../gestures.js';
import { pageActivity } from './misc.js';
import {
  allMembers, allDeposits, allWithdrawals, allUsers, allLogs, settings, saveSettings, setMemberStatus,
  setDepositStatus, setWithdrawalStatus, memberSummary, summariesFor, orgTotals, createStaffUser, setUserActive,
  resetUserPassword, deleteUser, logActivity, invalidate, getMember, statementRows, withdrawalTypeLabel,
  logUserName, summaryOpts,
} from '../store.js';
import { exportAll, importAll, queueAll, getSetting, dbClear, STORES } from '../db.js';
import { firebase, DEFAULT_FIREBASE_CONFIG } from '../firebase.js';
import { getLang, setLang, t } from '../i18n.js';
import { APP_VERSION, logoSrc } from '../brand.js';
import { can } from '../auth.js';
import { passwordIssues } from '../crypto.js';
import { App } from '../app.js';
import { formModal, changePasswordDialog } from './account.js';
import { rejectReason, viewMember } from './members.js';
import { downloadExcel } from '../pdf.js';

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
      .forEach(l => lRows.push([fmtDate(l.createdAt), fmtTime(l.createdAt), logUserName(l), l.role || '', l.action, l.details || '']));
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

/* ==================== shared approval queues ====================
   Everything waiting for a decision is normalised into one list of "items",
   so the approval page is a single filterable inbox instead of three stacked
   tables. Every action from the old tables is preserved. */

async function pendingMemberItems(session, deposits, cfg) {
  const members = await allMembers();
  return members.filter(m => m.status === 'pending')
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
    .map(m => ({
      kind: 'member',
      ic: 'members',
      title: m.nameBn,
      sub: `${m.memberId} · ${m.mobile}`,
      meta: `নিবন্ধন ${fmtDate(m.createdAt || m.joinDate)} · মাসিক কিস্তি ${money(m.installment)}`,
      amount: null,
      sort: String(m.createdAt || m.joinDate || ''),
      actions: [
        { label: t('দেখুন', 'View'), ic: 'eye', kind: 'ghost', run: () => viewMember(session, m, memberSummary(m, deposits, summaryOpts(cfg))) },
        {
          label: t('অনুমোদন', 'Approve'), ic: 'approve', kind: 'soft', run: async () => {
            if (!(await confirmBox(`${m.nameBn} (${m.memberId}) — সদস্যপদ অনুমোদন করবেন?`, { okLabel: 'Approve' }))) return;
            await setMemberStatus(m.id, 'active', session); toast('সদস্য অনুমোদিত / Member approved', 'success'); App.refresh();
          },
        },
        {
          label: t('বাতিল', 'Reject'), ic: 'reject', kind: 'softred', run: async () => {
            const r = await rejectReason();
            if (r === null) return;
            await setMemberStatus(m.id, 'rejected', session, r); toast('সদস্য বাতিল / Member rejected', 'warn'); App.refresh();
          },
        },
        { label: t('সম্পাদনা', 'Edit'), ic: 'edit', kind: 'ghost', run: () => App.go('members', { tab: 'update', memberDocId: m.id }) },
      ],
    }));
}

const descOf = r => (r.description || r.comment || '').trim();

async function pendingDepositItems(session) {
  const deposits = await allDeposits();
  return deposits.filter(d => d.status === 'pending')
    .sort((a, b) => String(a.submittedAt || '').localeCompare(String(b.submittedAt || '')))
    .map(d => ({
      kind: 'deposit',
      ic: 'deposit',
      title: d.memberName,
      sub: `${d.memberId} · ${fmtDate(d.date)}`,
      meta: `${typeLabel(d.type).bn} · ${methodLabel(d.method).bn}${descOf(d) ? ' · ' + descOf(d) : ''}`,
      amount: num(d.amount),
      sort: String(d.submittedAt || ''),
      actions: [
        {
          label: t('অনুমোদন', 'Approve'), ic: 'approve', kind: 'soft', run: async () => {
            if (!(await confirmBox(`${d.memberName} — ${taka(d.amount)} (${fmtDate(d.date)}) অনুমোদন করবেন?`, { okLabel: 'Approve' }))) return;
            await setDepositStatus(d.id, 'approved', session); toast('জমা অনুমোদিত / Deposit approved', 'success'); App.refresh();
          },
        },
        {
          label: t('বাতিল', 'Reject'), ic: 'reject', kind: 'softred', run: async () => {
            const r = await rejectReason('জমা বাতিলের কারণ / Deposit Rejection Reason');
            if (r === null) return;
            await setDepositStatus(d.id, 'rejected', session, r); toast('জমা বাতিল / Deposit rejected', 'warn'); App.refresh();
          },
        },
      ],
    }));
}

async function pendingWithdrawalItems(session) {
  const withdrawals = await allWithdrawals();
  return withdrawals.filter(w => w.status === 'pending')
    .sort((a, b) => String(a.submittedAt || '').localeCompare(String(b.submittedAt || '')))
    .map(w => ({
      kind: 'withdrawal',
      ic: 'withdraw',
      title: w.memberName,
      sub: `${w.memberId} · ${fmtDate(w.date)}`,
      meta: `${withdrawalTypeLabel(w.type).bn} · ${methodLabel(w.method).bn}${descOf(w) ? ' · ' + descOf(w) : ''}`,
      amount: num(w.amount),
      sort: String(w.submittedAt || ''),
      actions: [
        {
          label: t('অনুমোদন', 'Approve'), ic: 'approve', kind: 'soft', run: async () => {
            if (!(await confirmBox(`${w.memberName} — ${taka(w.amount)} (${fmtDate(w.date)}) উত্তোলন অনুমোদন করবেন?`, { okLabel: 'Approve' }))) return;
            await setWithdrawalStatus(w.id, 'approved', session); toast('উত্তোলন অনুমোদিত / Withdrawal approved', 'success'); App.refresh();
          },
        },
        {
          label: t('বাতিল', 'Reject'), ic: 'reject', kind: 'softred', run: async () => {
            const r = await rejectReason('উত্তোলন বাতিলের কারণ / Withdrawal Rejection Reason');
            if (r === null) return;
            await setWithdrawalStatus(w.id, 'rejected', session, r); toast('উত্তোলন বাতিল / Withdrawal rejected', 'warn'); App.refresh();
          },
        },
      ],
    }));
}

/** One pending request, rendered as a row with its actions on the right. */
function approvalRow(item) {
  const KIND = { member: t('সদস্য', 'Member'), deposit: t('জমা', 'Deposit'), withdrawal: t('উত্তোলন', 'Withdrawal') };
  const row = el('div', { class: `appr ${item.kind}` });
  row.innerHTML = `<div class="ic">${icon(item.ic)}</div>
    <div class="bd">
      <div class="t">${esc(item.title)}<span class="kind">${esc(KIND[item.kind] || item.kind)}</span></div>
      <div class="s">${esc(item.sub)}</div>
      <div class="m">${esc(item.meta)}</div>
    </div>`;
  if (item.amount !== null && item.amount !== undefined) {
    row.appendChild(el('div', { class: 'amt', text: money(item.amount) }));
  }
  const acts = el('div', { class: 'acts' });
  item.actions.forEach(a => acts.appendChild(btn(a.label, a.ic, a.kind, a.run, { size: 'xs' })));
  row.appendChild(acts);
  /* Step-8 polish: swipe right → approve, swipe left → reject.
     Both fire the same dialog-gated handlers as the buttons above. */
  const approve = item.actions.find(a => a.ic === 'approve');
  const reject = item.actions.find(a => a.ic === 'reject');
  attachSwipe(row, {
    leading: approve ? { ic: 'approve', label: approve.label, run: approve.run } : null,
    trailing: reject ? { ic: 'reject', label: reject.label, run: reject.run } : null,
  });
  return row;
}

/* ==================== Authorization Pending ==================== */
export async function pageAuthorization(session) {
  const wrap = page('অনুমোদন', 'Approvals', 'approve');
  const canApproveMember = can(session, 'member:approve');
  const canApproveDeposit = can(session, 'deposit:approve');
  if (!canApproveMember && !canApproveDeposit) {
    wrap.appendChild(banner('err', 'এই পেজে প্রবেশাধিকার নেই / You are not authorized to view pending authorizations.'));
    return wrap;
  }

  const [deposits, cfg] = await Promise.all([allDeposits(), settings()]);
  const items = [
    ...(canApproveMember ? await pendingMemberItems(session, deposits, cfg) : []),
    ...(canApproveDeposit ? await pendingDepositItems(session) : []),
    ...(canApproveDeposit ? await pendingWithdrawalItems(session) : []),
  ].sort((a, b) => a.sort.localeCompare(b.sort));

  const count = kind => items.filter(i => i.kind === kind).length;
  const sum = kind => items.filter(i => i.kind === kind).reduce((s, i) => s + (i.amount || 0), 0);

  const stats = el('div', { class: 'stats' });
  stats.append(
    statCard({ label: 'সদস্য / Members', value: String(count('member')), sub: 'সদস্যপদ অনুমোদের অপেক্ষায়', ic: 'members', tone: 'blue' }),
    statCard({ label: 'জমা / Deposits', value: String(count('deposit')), sub: sum('deposit') ? `মোট ${taka(sum('deposit'))}` : 'কোনো জমা নেই', ic: 'deposit', tone: 'amber' }),
    statCard({ label: 'উত্তোলন / Withdrawals', value: String(count('withdrawal')), sub: sum('withdrawal') ? `মোট ${taka(sum('withdrawal'))}` : 'কোনো উত্তোলন নেই', ic: 'withdraw', tone: 'amber' }),
    statCard({ label: 'সর্বমোট / Total', value: String(items.length), sub: 'এক জায়গায় সব অনুমোদন', ic: 'pending' }),
  );
  wrap.appendChild(stats);

  /* --- filter chips --- */
  const FILTERS = [
    { id: 'all', label: t('সব', 'All') },
    { id: 'member', label: t('সদস্য', 'Members') },
    { id: 'deposit', label: t('জমা', 'Deposits') },
    { id: 'withdrawal', label: t('উত্তোলন', 'Withdrawals') },
  ];
  let filter = 'all';
  const chips = el('div', { class: 'chips' });
  const listBox = el('div', { class: 'appr-list' });
  const countLine = el('div', { class: 'count-line' });

  const render = () => {
    chips.querySelectorAll('.chip-btn').forEach(b => b.classList.toggle('on', b.dataset.f === filter));
    const shown = filter === 'all' ? items : items.filter(i => i.kind === filter);
    const total = shown.reduce((s, i) => s + (i.amount || 0), 0);
    countLine.textContent = shown.length
      ? `${shown.length}টি অনুরোধ${total ? ` · মোট ${money(total)}` : ''}`
      : '';
    listBox.replaceChildren();
    if (!shown.length) {
      const msg = items.length
        ? t('এই ধরনের কোনো অনুরোধ নেই', 'Nothing pending in this category')
        : t('অনুমোদনের অপেক্ষায় কিছু নেই — সব শেষ!', 'Nothing waiting for approval — all clear!');
      listBox.appendChild(el('div', { class: 'empty', html: `${icon(items.length ? 'filter' : 'check')}${esc(msg)}` }));
      return;
    }
    shown.forEach(i => listBox.appendChild(approvalRow(i)));
  };

  FILTERS.forEach(f => {
    const n = f.id === 'all' ? items.length : count(f.id);
    const b = el('button', {
      type: 'button', class: 'chip-btn' + (f.id === filter ? ' on' : ''), dataset: { f: f.id },
      html: `${esc(f.label)}<span class="n">${n}</span>`,
      onclick: () => { filter = f.id; render(); },
    });
    chips.appendChild(b);
  });

  const listCard = card('অপেক্ষমাণ অনুরোধ', 'Pending Requests', el('div'));
  listCard.body.replaceChildren(chips, countLine, listBox);
  wrap.appendChild(listCard);
  render();
  return wrap;
}

async function staffManager(session, host) {
  const users = await allUsers();
  const staff = users.filter(u => u.role === 'maker' || u.role === 'admin')
    .sort((a, b) => (a.role === b.role ? (a.username || '').localeCompare(b.username || '') : a.role === 'admin' ? -1 : 1));

  const c = card('স্টাফ অ্যাকাউন্ট', 'Staff Accounts', el('div'), [
    btn('নতুন Maker', 'plus', 'primary', () => newStaff(session), { size: 'xs' }),
  ]);

  /* --- search + filter --- */
  const bar = el('div', { class: 'toolbar' });
  const searchBox = el('div', { class: 'search-box', html: icon('search') });
  const q = el('input', { placeholder: t('Username / নাম / মোবাইল', 'Username / name / mobile'), autocomplete: 'off' });
  searchBox.appendChild(q);
  const mkSel = (label, opts, w = '150px') => {
    const sel = el('select');
    opts.forEach(([v, l]) => sel.appendChild(el('option', { value: v }, [l])));
    const f = el('div', { class: 'field', style: `flex:0 1 ${w}` });
    f.appendChild(el('label', { text: label })); f.appendChild(sel);
    return { f, sel };
  };
  const role = mkSel(t('রোল', 'Role'), [['', t('সব', 'All')], ['admin', 'Admin'], ['maker', 'Maker']], '130px');
  const stat = mkSel(t('স্ট্যাটাস', 'Status'), [['', t('সব', 'All')], ['active', t('সক্রিয়', 'Active')], ['inactive', t('নিষ্ক্রিয়', 'Inactive')]], '130px');
  bar.append(searchBox, role.f, stat.f);
  bar.appendChild(btn('Clear', 'clear', 'ghost', () => { q.value = ''; role.sel.value = ''; stat.sel.value = ''; render(); }, { size: 'xs' }));
  host.appendChild(bar);
  host.appendChild(c);

  const render = () => {
    const term = q.value.trim().toLowerCase();
    const rows = staff.filter(u => {
      if (role.sel.value && u.role !== role.sel.value) return false;
      if (stat.sel.value === 'active' && u.active === false) return false;
      if (stat.sel.value === 'inactive' && u.active !== false) return false;
      if (!term) return true;
      return [u.username, u.displayName, u.mobile, u.email].some(x => String(x || '').toLowerCase().includes(term));
    });
    c.body.replaceChildren();
    if (staff.length > rows.length || term) {
      c.body.appendChild(el('div', { class: 'count-line', text: `${rows.length} / ${staff.length} জন` }));
    }
    c.body.appendChild(tableWrap(
      [{ label: 'Username' }, { label: 'নাম / Name' }, { label: 'Role' }, { label: 'Mobile' }, { label: 'Status' }, { label: 'তৈরি / Created' }, { label: 'Action', cls: 'nowrap' }],
      rows.map(u => {
      const acts = el('div', { class: 'btn-row' });
      acts.appendChild(btn(t('পাসওয়ার্ড', 'Password'), 'key', 'ghost', () => resetPw(session, u), { size: 'xs' }));
      if (u.role !== 'admin') {
        acts.appendChild(btn(u.active === false ? t('চালু', 'Activate') : t('বন্ধ', 'Deactivate'), u.active === false ? 'approve' : 'lock', u.active === false ? 'soft' : 'softred', async () => {
          await setUserActive(u.id, u.active === false, session);
          toast(u.active === false ? 'অ্যাকাউন্ট সক্রিয় / Activated' : 'অ্যাকাউন্ট নিষ্ক্রিয় / Deactivated', 'success');
          App.refresh();
        }, { size: 'xs' }));
        acts.appendChild(btn(t('মুছুন', 'Delete'), 'trash', 'softred', async () => {
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
      { empty: t('কোনো স্টাফ অ্যাকাউন্ট নেই', 'No staff accounts'), emptyIcon: 'maker' },
    ));
  };
  q.addEventListener('input', debounce(render, 180));
  role.sel.addEventListener('change', render);
  stat.sel.addEventListener('change', render);
  render();
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

  host.appendChild(banner('info', 'সদস্যের লগইন Username = তার মোবাইল নম্বর। পাসওয়ার্ড কখনো সংরক্ষিত বা প্রদর্শিত হয় না — প্রয়োজনে রিসেট করুন।'));

  /* --- search + filter --- */
  const bar = el('div', { class: 'toolbar' });
  const searchBox = el('div', { class: 'search-box', html: icon('search') });
  const q = el('input', { placeholder: t('Member ID / নাম / মোবাইল', 'Member ID / name / mobile'), autocomplete: 'off' });
  searchBox.appendChild(q);
  const mkSel = (label, opts, w = '150px') => {
    const sel = el('select');
    opts.forEach(([v, l]) => sel.appendChild(el('option', { value: v }, [l])));
    const f = el('div', { class: 'field', style: `flex:0 1 ${w}` });
    f.appendChild(el('label', { text: label })); f.appendChild(sel);
    return { f, sel };
  };
  const login = mkSel(t('লগইন', 'Login'), [
    ['', t('সব', 'All')], ['on', t('চালু', 'Enabled')], ['off', t('বন্ধ', 'Disabled')], ['none', t('অ্যাকাউন্ট নেই', 'No account')],
  ], '160px');
  const mstat = mkSel(t('সদস্য', 'Member'), [
    ['', t('সব', 'All')], ['active', t('সক্রিয়', 'Active')], ['pending', t('অপেক্ষমাণ', 'Pending')], ['rejected', t('বাতিল', 'Rejected')],
  ], '150px');
  bar.append(searchBox, login.f, mstat.f);
  bar.appendChild(btn('Clear', 'clear', 'ghost', () => { q.value = ''; login.sel.value = ''; mstat.sel.value = ''; render(); }, { size: 'xs' }));
  host.appendChild(bar);

  const c = card('সদস্য লগইন অ্যাকাউন্ট', 'Member Login Accounts', el('div'));
  host.appendChild(c);

  const render = () => {
    const term = q.value.trim().toLowerCase();
    const shown = rows.filter(({ m, u }) => {
      if (login.sel.value === 'on' && !(u && u.active !== false)) return false;
      if (login.sel.value === 'off' && !(u && u.active === false)) return false;
      if (login.sel.value === 'none' && u) return false;
      if (mstat.sel.value && m.status !== mstat.sel.value) return false;
      if (!term) return true;
      return [m.memberId, m.nameBn, m.nameEn, m.mobile, u && u.username].some(x => String(x || '').toLowerCase().includes(term));
    });
    c.body.replaceChildren();
    c.body.appendChild(el('div', { class: 'count-line', text: `${shown.length} / ${rows.length} সদস্য` }));
    c.body.appendChild(tableWrap(
      [{ label: 'Member ID' }, { label: 'নাম / Name' }, { label: 'Username (Mobile)' }, { label: 'সদস্য স্ট্যাটাস' }, { label: 'লগইন স্ট্যাটাস' }, { label: 'Action', cls: 'nowrap' }],
      shown.map(({ m, u }) => {
        const acts = el('div', { class: 'btn-row' });
        if (u) {
          acts.appendChild(btn(t('পাসওয়ার্ড', 'Password'), 'key', 'ghost', () => resetPw(session, u), { size: 'xs' }));
          acts.appendChild(btn(u.active === false ? t('চালু', 'Enable') : t('বন্ধ', 'Disable'), u.active === false ? 'approve' : 'lock', u.active === false ? 'soft' : 'softred', async () => {
            await setUserActive(u.id, u.active === false, session);
            toast('লগইন স্ট্যাটাস হালনাগাদ / Login status updated', 'success'); App.refresh();
          }, { size: 'xs' }));
        }
        acts.appendChild(btn(t('সম্পাদনা', 'Edit'), 'edit', 'ghost', () => App.go('members', { tab: 'update', memberDocId: m.id }), { size: 'xs' }));
        return [
          `<b>${esc(m.memberId)}</b>`, esc(m.nameBn), esc(u ? u.username : '—'),
          { html: statusTag(m.status) },
          u ? `<span class="tag ${u.active === false ? 'rejected' : 'approved'}">${u.active === false ? 'DISABLED' : 'ENABLED'}</span>` : '<span class="tag gray">NO ACCOUNT</span>',
          { node: acts, cls: 'nowrap' },
        ];
      }),
      { empty: t('এই ফিল্টারে কোনো সদস্য নেই', 'No members match this filter'), emptyIcon: 'members' },
    ));
  };
  q.addEventListener('input', debounce(render, 180));
  login.sel.addEventListener('change', render);
  mstat.sel.addEventListener('change', render);
  render();
}

/* ==================== Member Panel ==================== */
export async function pageMemberPanel(session) {
  const wrap = page('সদস্য প্যানেল', 'Member Panel', 'member');
  if (session.role !== 'member') { wrap.appendChild(banner('err', 'এই পেজটি শুধুমাত্র সদস্যদের জন্য। / Members only.')); return wrap; }
  const [deposits, cfg] = await Promise.all([allDeposits(), settings()]);
  const m = await getMember(session.memberDocId);
  if (!m) { wrap.appendChild(banner('err', 'সদস্য প্রোফাইল পাওয়া যায়নি / Member profile not found')); return wrap; }
  const s = memberSummary(m, deposits, summaryOpts(cfg));

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

/* ==================== Admin hub (tile home) ==================== */

/** One big tile on the admin home screen. */
function hubTile(sec, onPick) {
  const b = el('button', { type: 'button', class: `hub-tile${sec.tone ? ' ' + sec.tone : ''}`, onclick: onPick });
  b.innerHTML = `<span class="tic">${icon(sec.ic)}</span>
    <span class="tb">
      <span class="tt">${esc(t(sec.bn, sec.en))}${sec.badge ? `<span class="badge${sec.badge.n ? '' : ' zero'}">${esc(sec.badge.n)}</span>` : ''}</span>
      <span class="ts">${esc(t(sec.descBn, sec.descEn))}</span>
    </span>
    <span class="go">${icon('chevron')}</span>`;
  return b;
}

const HUB_GROUPS = [
  { id: 'me', bn: 'আমার', en: 'Mine' },
  { id: 'approve', bn: 'অনুমোদন', en: 'Approvals' },
  { id: 'manage', bn: 'ব্যবস্থাপনা', en: 'Management' },
  { id: 'org', bn: 'সংগঠন', en: 'Organisation' },
  { id: 'data', bn: 'ডেটা', en: 'Data' },
  { id: 'system', bn: 'সিস্টেম', en: 'System' },
];

export async function pageSettings(session, params = {}) {
  const staff = session.role === 'admin' || session.role === 'maker';
  const wrap = page(staff ? 'অ্যাডমিন' : 'সেটিংস', staff ? 'Admin' : 'Settings', staff ? 'admin' : 'settings');

  const [members, deposits, withdrawals, users, queue] = await Promise.all([
    allMembers(), allDeposits(), allWithdrawals(), allUsers(), queueAll(),
  ]);
  const pending = members.filter(m => m.status === 'pending').length
    + deposits.filter(d => d.status === 'pending').length
    + withdrawals.filter(w => w.status === 'pending').length;
  const makers = users.filter(u => u.role === 'maker').length;

  const SECTIONS = [
    { id: 'account', group: 'me', ic: 'admin', bn: 'আমার অ্যাকাউন্ট', en: 'My Account', descBn: 'প্রোফাইল ও পাসওয়ার্ড', descEn: 'Profile and password' },
    { id: 'language', group: 'me', ic: 'globe', bn: 'ভাষা', en: 'Language', descBn: 'বাংলা / English', descEn: 'Bangla / English' },
    { id: 'about', group: 'me', ic: 'info', bn: 'অ্যাপ তথ্য', en: 'About', descBn: 'সংস্করণ, ডিভাইস, সংযোগ', descEn: 'Version, device, connection' },
  ];
  if (can(session, 'member:approve') || can(session, 'deposit:approve')) {
    SECTIONS.push({
      id: 'approvals', group: 'approve', ic: 'approve', bn: 'অনুমোদন', en: 'Approvals',
      descBn: pending ? `${pending}টি অনুরোধ অপেক্ষায়` : 'সব অনুমোদন সম্পন্ন',
      descEn: pending ? `${pending} request(s) waiting` : 'All approvals done',
      route: 'authorization', badge: { n: pending }, tone: pending ? 'warn' : '',
    });
  }
  if (session.role === 'admin') {
    SECTIONS.push({
      id: 'staff', group: 'manage', ic: 'maker', bn: 'স্টাফ', en: 'Staff',
      descBn: `${makers} জন Maker`, descEn: `${makers} maker(s)`, badge: { n: makers },
    });
    SECTIONS.push({
      id: 'accounts', group: 'manage', ic: 'members', bn: 'সদস্য লগইন', en: 'Member Logins',
      descBn: 'চালু/বন্ধ, পাসওয়ার্ড রিসেট', descEn: 'Enable, disable, reset password',
    });
  }
  if (can(session, 'settings:manage')) {
    SECTIONS.push({
      id: 'organisation', group: 'org', ic: 'building', bn: 'সংগঠন', en: 'Organisation',
      descBn: 'নাম, লোগো, কিস্তি, টেমপ্লেট', descEn: 'Name, logo, installment, template',
    });
    SECTIONS.push({
      id: 'firebase', group: 'data', ic: 'sync', bn: 'ক্লাউড সিঙ্ক', en: 'Cloud Sync',
      descBn: queue.length ? `${queue.length}টি সিঙ্ক বাকি` : 'Firebase সংযোগ',
      descEn: queue.length ? `${queue.length} item(s) pending` : 'Firebase connection',
      badge: { n: queue.length },
    });
  }
  if (can(session, 'backup:manage')) {
    SECTIONS.push({
      id: 'backup', group: 'data', ic: 'backup', bn: 'ব্যাকআপ', en: 'Backup',
      descBn: 'সংরক্ষণ ও পুনরুদ্ধার', descEn: 'Save and restore',
    });
  }
  SECTIONS.push({
    id: 'activity', group: 'system', ic: 'log', bn: 'কার্যকলাপ লগ', en: 'Activity Log',
    descBn: 'কে, কখন, কী করেছে', descEn: 'Who did what, and when',
  });

  const host = el('div');
  wrap.appendChild(host);
  let active = params.tab && SECTIONS.some(s => s.id === params.tab && !s.route) ? params.tab : '';

  const setTab = id => { App.params = { ...(App.params || {}), tab: id }; };

  function renderHome() {
    host.replaceChildren();
    HUB_GROUPS.forEach(g => {
      const items = SECTIONS.filter(s => s.group === g.id);
      if (!items.length) return;
      host.appendChild(el('div', { class: 'hub-group-title', text: t(g.bn, g.en) }));
      const grid = el('div', { class: 'hub-grid' });
      items.forEach(s => grid.appendChild(hubTile(s, () => (s.route ? App.go(s.route) : open(s.id)))));
      host.appendChild(grid);
    });
  }

  async function paint() {
    host.replaceChildren();
    if (!active) return renderHome();
    const sec = SECTIONS.find(s => s.id === active);
    if (!sec) return renderHome();

    const bar = el('div', { class: 'hub-bar' });
    bar.appendChild(btn(t('অ্যাডমিন হোম', 'Admin home'), 'back', 'ghost', home, { size: 'xs' }));
    const head = el('div', { class: 'hub-sec' });
    head.innerHTML = `<div class="ic">${icon(sec.ic)}</div><div><h2>${esc(t(sec.bn, sec.en))}</h2><div class="s">${esc(t(sec.descBn, sec.descEn))}</div></div>`;
    const pane = el('div');
    host.append(bar, head, pane);

    if (active === 'account') accountSection(session, pane);
    else if (active === 'language') languageSection(pane);
    else if (active === 'about') aboutSection(pane);
    else if (active === 'organisation') await organisationSection(session, pane);
    else if (active === 'firebase') await firebaseSection(session, pane);
    else if (active === 'staff') await staffManager(session, pane);
    else if (active === 'accounts') await accountManager(session, pane);
    else if (active === 'activity') await embedPage(pane, pageActivity, session);
    else if (active === 'backup') await embedPage(pane, pageBackup, session);
  }

  async function open(id) {
    active = id;
    setTab(id);
    await paint();
    window.scrollTo(0, 0);
  }
  async function home() {
    active = '';
    setTab('');
    await paint();
    window.scrollTo(0, 0);
  }

  /* Esc returns to the tile home; auto-detaches once this page is replaced. */
  const onKey = ev => {
    if (!host.isConnected) { window.removeEventListener('keydown', onKey); return; }
    if (ev.key === 'Escape' && active) home();
  };
  window.addEventListener('keydown', onKey);

  await paint();
  return wrap;
}

function languageSection(host) {
  const cur = getLang();
  const wrap = el('div');
  wrap.appendChild(el('p', { class: 'muted', style: 'margin:0 0 12px', text: t(
    'অ্যাপের ভাষা বেছে নিন। বাংলা নির্বাচন করলে সবকিছু বাংলায় দেখাবে, ইংরেজি নির্বাচন করলে সবকিছু ইংরেজিতে।',
    'Choose the app language. Bangla shows the whole interface in Bangla; English shows it in English.',
  ) }));
  const row = el('div', { class: 'lang-pick' });
  [
    { id: 'bn', title: 'বাংলা', sub: 'Bangla' },
    { id: 'en', title: 'English', sub: 'ইংরেজি' },
  ].forEach(opt => {
    const b = el('button', {
      type: 'button',
      class: `lang-opt${cur === opt.id ? ' on' : ''}`,
      onclick: () => { setLang(opt.id); },
    });
    b.innerHTML = `<strong>${esc(opt.title)}</strong><span>${esc(opt.sub)}</span>`;
    row.appendChild(b);
  });
  wrap.appendChild(row);
  host.appendChild(card('ভাষা', 'Language', wrap));
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
    accRow.appendChild(btn(t('আমার প্রোফাইল', 'My Profile'), 'member', 'ghost', () => App.go('member-panel')));
  }
}

function aboutSection(host) {
  host.appendChild(card('অ্যাপ সম্পর্কে', 'About', kv([
    ['অ্যাপ / Application', `${esc(APP_NAME_BN)} — ${esc(APP_NAME_EN)}`],
    ['সংস্করণ / Version', APP_VERSION],
    ['ধরন / Type', 'Offline-first PWA · IndexedDB + Firebase Realtime Database'],
    ['সংযোগ / Connection', navigator.onLine ? '<span class="tag approved">ONLINE</span>' : '<span class="tag gray">OFFLINE</span>'],
    ['ডিভাইস / Device ID', esc(deviceId())],
    ['ব্যাকআপ / Data safety', t('অ্যাডমিন হোম → ব্যাকআপ', 'Admin home → Backup')],
  ])));
}

function resizeLogoFile(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) return reject(new Error('ছবি ফাইল দিন / Choose an image file'));
    if (file.size > 4 * 1024 * 1024) return reject(new Error('ফাইল খুব বড় (সর্বোচ্চ ৪ MB)'));
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const max = 512;
      // SVG may report no intrinsic size — fall back to the resize ceiling.
      let w = img.naturalWidth || img.width || 512, h = img.naturalHeight || img.height || 512;
      if (w > max || h > max) {
        const s = Math.min(max / w, max / h);
        w = Math.round(w * s); h = Math.round(h * s);
      }
      const c = document.createElement('canvas');
      c.width = Math.max(1, w); c.height = Math.max(1, h);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('ছবি খোলা যায়নি')); };
    img.src = url;
  });
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
    <div class="field" style="margin-top:8px">
      <label>প্রতিষ্ঠান / অ্যাপ লোগো</label>
      <div class="logo-edit">
        <img class="logo-preview" id="logoPreview" src="${esc(cfg.orgLogo || 'icons/logo.png')}" alt="logo">
        <div>
          <input type="file" id="logoFile" accept="image/png,image/jpeg,image/webp,image/svg+xml">
          <div class="hint">PNG / JPG — মোবাইল স্ক্রিনে অটোফিট হবে। সর্বোচ্চ ~৫১২px।</div>
          <button class="btn btn-ghost btn-xs" type="button" id="logoReset">ডিফল্ট লোগো</button>
        </div>
      </div>
    </div>
    <div class="field" style="margin-top:8px"><label>WhatsApp বকেয়া রিমাইন্ডার টেমপ্লেট</label>
      <textarea name="waTemplate" rows="7">${esc(cfg.waTemplate)}</textarea>
      <div class="hint"><b>[Member Name]</b> অংশটি স্বয়ংক্রিয়ভাবে সদস্যের নাম দিয়ে প্রতিস্থাপিত হবে। বার্তায় কোনো টাকার অঙ্ক থাকবে না।</div></div>
    <div class="form-actions">
      <button class="btn btn-primary" type="submit">${icon('save')}<span>Save / সংরক্ষণ</span></button>
      <button class="btn btn-ghost" type="reset">${icon('clear')}<span>Reset</span></button>
    </div>`;
  /* --- logo picker: preview immediately, persist on Save --- */
  const preview = f.querySelector('#logoPreview');
  const fileInput = f.querySelector('#logoFile');
  let pendingLogo = cfg.orgLogo || '';   // '' means “use the default logo”
  const paintPreview = () => { preview.src = logoSrc({ orgLogo: pendingLogo }); };
  paintPreview();
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    try {
      pendingLogo = await resizeLogoFile(file);
      paintPreview();
      toast('লোগো নির্বাচন করা হয়েছে — Save করুন / Logo selected — press Save', 'info');
    } catch (err) {
      toast(err.message || 'লোগো লোড করা যায়নি', 'error');
      fileInput.value = '';
    }
  });
  f.querySelector('#logoReset').addEventListener('click', () => {
    pendingLogo = '';
    fileInput.value = '';
    paintPreview();
  });
  f.addEventListener('reset', () => setTimeout(() => {
    pendingLogo = cfg.orgLogo || '';
    fileInput.value = '';
    paintPreview();
  }, 0));

  f.addEventListener('submit', async e => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(f).entries());
    if (!String(v.orgNameBn || '').trim() || !String(v.orgNameEn || '').trim()) { toast('সংগঠনের নাম আবশ্যক / Organisation name required', 'error'); return; }
    if (!String(v.waTemplate || '').includes('[Member Name]')) { toast('টেমপ্লেটে [Member Name] অবশ্যই থাকতে হবে', 'error'); return; }
    const b = f.querySelector('button[type=submit]'); b.disabled = true;
    try {
      await saveSettings({
        orgNameBn: v.orgNameBn.trim(), orgNameEn: v.orgNameEn.trim(),
        orgAddress: (v.orgAddress || '').trim(), orgPhone: (v.orgPhone || '').trim(),
        defaultInstallment: num(v.defaultInstallment), monthlyTarget: num(v.monthlyTarget),
        countSpecialTowardsInstallment: !!v.countSpecialTowardsInstallment,
        waTemplate: v.waTemplate,
        orgLogo: pendingLogo,
      });
    } catch (err) {
      b.disabled = false;
      toast('সেটিংস সংরক্ষণ ব্যর্থ: ' + err.message, 'error');
      return;
    }
    b.disabled = false;
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
    <div class="grid g2">
      ${g('apiKey', 'AIza…')}${g('authDomain', 'your-project.firebaseapp.com')}
      ${g('databaseURL', 'https://your-project-default-rtdb.firebaseio.com')}${g('projectId', 'your-project-id')}
      ${g('storageBucket', 'your-project.appspot.com')}${g('messagingSenderId', '1234567890')}
      ${g('appId', '1:123:web:abc')}
    </div>
    <div class="form-actions">
      <button class="btn btn-primary" type="submit">${icon('save')}<span>Save & Connect</span></button>
      <button class="btn btn-ghost" type="button" id="fbClear">${icon('clear')}<span>Disconnect</span></button>
      <button class="btn btn-soft" type="button" id="fbSync">${icon('sync')}<span>Sync now</span></button>
    </div>
    <div class="fs8 muted" id="fbStat"></div>`;
  const stat = fb.querySelector('#fbStat');
  const paintStat = () => {
    // Auto-detach once the tab is re-rendered — otherwise every visit to this
    // tab leaks another listener.
    if (!stat.isConnected) { window.removeEventListener('ds:sync-status', paintStat); return; }
    stat.textContent = `Status: ${firebase.status}${firebase.lastError ? ' — ' + firebase.lastError : ''}`;
  };
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
