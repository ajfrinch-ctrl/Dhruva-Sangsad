/* Approvals inbox + shared staff/account management + Backup & Restore.
   The settings hub itself moved to pages/settings.js; the member profile moved
   to pages/member-panel.js. Activity Log lives ONLY under Settings. */
import {
  el, esc, toast, taka, money, num, fmtDate, fmtDateTime, fmtTime, todayISO,
  confirmBox, alertBox, downloadBlob, deviceId, typeLabel, methodLabel, isValidMobile,
  isValidEmail, debounce, t,
} from '../util.js';
import { icon } from '../icons.js';
import { page, card, tableWrap, statusTag, banner, btn, kv, statCard, embedPage, segChips, emptyState } from '../ui.js';
import { attachSwipe } from '../gestures.js';
import {
  allMembers, allDeposits, allWithdrawals, allUsers, allLogs, settings, setMemberStatus,
  setDepositStatus, setWithdrawalStatus, memberSummary, summariesFor, orgTotals, createStaffUser, setUserActive,
  resetUserPassword, deleteUser, logActivity, invalidate, getMember, withdrawalTypeLabel,
  logUserName, summaryOpts,
} from '../store.js';
import { exportAll, importAll, queueAll, dbClear, STORES } from '../db.js';
import { firebase } from '../firebase.js';
import { can } from '../auth.js';
import { passwordIssues } from '../crypto.js';
import { App } from '../app.js';
import { formModal } from './account.js';
import { rejectReason, viewMember } from './members.js';
import { downloadExcel } from '../pdf.js';

/* ==================== Backup & Restore (Admin) ==================== */
export async function pageBackup(session) {
  const wrap = page('ব্যাকআপ ও পুনরুদ্ধার', 'Backup & Restore', 'backup');
  if (!can(session, 'backup:manage')) { wrap.appendChild(banner('err', esc(t('এই পেজটি শুধুমাত্র অ্যাডমিন ব্যবহার করতে পারবেন।', 'Admin only.')))); return wrap; }

  const [members, deposits, users, logs, queue] = await Promise.all([allMembers(), allDeposits(), allUsers(), allLogs(), queueAll()]);
  const stats = el('div', { class: 'stats' });
  stats.append(
    statCard({ label: t('সদস্য', 'Members'), value: String(members.length), sub: 'IndexedDB', ic: 'members', tone: 'blue' }),
    statCard({ label: t('জমা', 'Deposits'), value: String(deposits.length), sub: t('সব স্ট্যাটাস', 'all statuses'), ic: 'deposit' }),
    statCard({ label: t('ব্যবহারকারী', 'Users'), value: String(users.length), sub: 'admin + maker + member', ic: 'admin', tone: 'gray' }),
    statCard({ label: t('কার্যক্রম লগ', 'Activity Logs'), value: String(logs.length), sub: t(`${queue.length}টি সিঙ্ক বাকি`, `${queue.length} sync pending`), ic: 'log', tone: queue.length ? 'amber' : 'gray' }),
  );
  wrap.appendChild(stats);

  /* -------- local backup -------- */
  const bBody = el('div');
  bBody.appendChild(banner('info', esc(t('ব্যাকআপ ফাইলে সমস্ত সদস্য, জমা, ব্যবহারকারী (হ্যাশকৃত পাসওয়ার্ডসহ), বিজ্ঞপ্তি, লগ ও সেটিংস সংরক্ষিত থাকে। ফাইলটি নিরাপদ স্থানে রাখুন।', 'The backup file contains every member, deposit, user (with hashed passwords), notification, log and setting. Keep the file somewhere safe.'))));
  const bRow = el('div', { class: 'btn-stack' });
  bRow.appendChild(btn(t('ব্যাকআপ ডাউনলোড (JSON)', 'Download backup (JSON)'), 'download', 'primary', async () => {
    const payload = await exportAll();
    const name = `Dhruvo_Sangsad_Backup_${todayISO()}_${String(Date.now()).slice(-6)}.json`;
    downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), name);
    await logActivity('BACKUP', `Backup downloaded (${name})`, session);
    toast(t('ব্যাকআপ ডাউনলোড হয়েছে', 'Backup downloaded'), 'success');
  }, { block: true }));
  bRow.appendChild(btn('Excel Export', 'excel', 'soft', async () => {
    const cfg = await settings();
    const sums = await summariesFor(members, deposits, cfg);
    const mRows = [['Member ID', 'Name (Bangla)', 'Name (English)', 'Mobile', 'WhatsApp', 'Email', 'NID', 'DOB', 'Profession', 'Address', 'Installment', 'Join Date', 'Status', 'Total Deposit', 'Total Due', 'Total Advance']];
    sums.forEach(s => {
      const m = s.member;
      mRows.push([m.memberId, m.nameBn, m.nameEn, m.mobile, m.whatsapp, m.email || '', m.nid || '', fmtDate(m.dob), m.profession || '', m.address || '', num(m.installment), fmtDate(m.joinDate), m.status, s.totalDeposit, s.due, s.advance]);
    });
    const dRows = [['Txn ID', 'Deposit ID', 'Date', 'Member ID', 'Member Name', 'Type', 'Method', 'Amount', 'Description', 'Comment', 'Status', 'Submitted At', 'Approved At']];
    deposits.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .forEach(d => dRows.push([d.txnId || '', d.id, fmtDate(d.date), d.memberId, d.memberName, typeLabel(d.type).en, methodLabel(d.method).en, num(d.amount), d.description || '', d.comment || '', d.status, fmtDateTime(d.submittedAt), d.approvedAt ? fmtDateTime(d.approvedAt) : '']));
    const lRows = [['Date', 'Time', 'User', 'Role', 'Action', 'Details']];
    logs.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .forEach(l => lRows.push([fmtDate(l.createdAt), fmtTime(l.createdAt), logUserName(l), l.role || '', l.action, l.details || '']));
    downloadExcel([
      { name: 'Members', rows: mRows }, { name: 'Deposits', rows: dRows }, { name: 'Activity Log', rows: lRows },
    ], `Dhruvo_Sangsad_Data_${todayISO()}.xlsx`);
    await logActivity('BACKUP', 'Excel export downloaded', session);
    toast(t('এক্সেল ডাউনলোড হয়েছে', 'Excel downloaded'), 'success');
  }, { block: true }));
  const bc = card('ব্যাকআপ', 'Backup', bBody);
  bc.body.appendChild(bRow);
  wrap.appendChild(bc);

  /* -------- restore -------- */
  const rBody = el('div');
  rBody.appendChild(banner('warn',
    t('<b>সতর্কতা:</b> পুনরুদ্ধার করলে বর্তমান স্থানীয় ডাটা মুছে গিয়ে ব্যাকআপ ফাইলের ডাটা বসবে। কাজটি ফেরানো যাবে না।',
      '<b>Warning:</b> restoring erases the current local data and writes the backup file instead. This cannot be undone.')));
  const file = el('input', { type: 'file', accept: '.json,application/json' });
  const ff = el('div', { class: 'field', style: 'margin-top:8px' });
  ff.appendChild(el('label', { text: t('ব্যাকআপ ফাইল (.json)', 'Backup file (.json)') }));
  ff.appendChild(file);
  rBody.appendChild(ff);
  const rRow = el('div', { class: 'btn-stack' });
  const modeSeg = segChips('mode', [
    { value: 'wipe', bn: 'সব মুছে প্রতিস্থাপন', en: 'Replace all' },
    { value: 'merge', bn: 'আগের ডেটার সাথে মেশান', en: 'Merge into existing' },
  ], 'wipe');
  const mf = el('div', { class: 'field' });
  mf.appendChild(el('label', { text: t('পুনরুদ্ধার পদ্ধতি', 'Restore method') })); mf.appendChild(modeSeg.root);
  rBody.appendChild(mf);
  rRow.appendChild(btn(t('পুনরুদ্ধার করুন', 'Restore'), 'restore', 'danger', async () => {
    const f = file.files && file.files[0];
    if (!f) { toast(t('প্রথমে একটি ব্যাকআপ ফাইল নির্বাচন করুন', 'Choose a backup file first'), 'warn'); return; }
    let payload;
    try { payload = JSON.parse(await f.text()); }
    catch { toast(t('ফাইলটি পড়া যায়নি', 'The file could not be read'), 'error'); return; }
    if (!payload || !payload.data) { toast(t('এটি বৈধ ব্যাকআপ ফাইল নয়', 'This is not a valid backup file'), 'error'); return; }
    const counts = Object.entries(payload.data).map(([k, v]) => `${k}: ${(v || []).length}`).join(' · ');
    const ok = await confirmBox(
      t(`ব্যাকআপ তারিখ: ${fmtDateTime(payload.exportedAt)}\n${counts}\n\n${modeSeg.value === 'wipe' ? 'বর্তমান সব ডাটা মুছে যাবে।' : 'বিদ্যমান ডাটার সাথে একত্রিত হবে।'} আপনি কি নিশ্চিত?`,
        `Backup date: ${fmtDateTime(payload.exportedAt)}\n${counts}\n\n${modeSeg.value === 'wipe' ? 'All current data will be erased.' : 'Data will be merged into the existing records.'} Are you sure?`),
      { title: t('পুনরুদ্ধার নিশ্চিত করুন', 'Confirm restore'), okLabel: t('পুনরুদ্ধার করুন', 'Restore'), danger: true });
    if (!ok) return;
    try {
      const names = await importAll(payload, { wipe: modeSeg.value === 'wipe' });
      invalidate();
      await logActivity('RESTORE', `Restored from backup (${names.join(', ')})`, session);
      await alertBox(t('পুনরুদ্ধার সফল হয়েছে। অ্যাপ পুনরায় লোড হবে।', 'Restore complete. The app will reload now.'), t('সফল', 'Success'));
      location.reload();
    } catch (err) { toast(t('পুনরুদ্ধার ব্যর্থ', 'Restore failed') + ': ' + err.message, 'error'); }
  }, { block: true }));
  const rc = card('পুনরুদ্ধার', 'Restore', rBody);
  rc.classList.add('danger-zone');
  rc.body.appendChild(rRow);
  wrap.appendChild(rc);
  return wrap;
}

/* ==================== shared approval queues ==================== */
async function pendingMemberItems(session, deposits, cfg) {
  const members = await allMembers();
  return members.filter(m => m.status === 'pending')
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
    .map(m => ({
      kind: 'member',
      ic: 'members',
      title: m.nameBn,
      sub: `${m.memberId} · ${m.mobile}`,
      name: m.nameBn || m.nameEn || '',
      memberId: m.memberId,
      extra: m.mobile || '',
      dateLabel: fmtDate(m.createdAt || m.joinDate),
      dateCaption: t('আবেদনের তারিখ', 'Applied on'),
      meta: `${t('মাসিক কিস্তি', 'Monthly installment')} ${money(m.installment)} · ${m.mobile || ''}`,
      amount: null,
      sort: String(m.createdAt || m.joinDate || ''),
      actions: [
        { label: t('দেখুন', 'View'), ic: 'eye', kind: 'ghost', run: () => viewMember(session, m, memberSummary(m, deposits, summaryOpts(cfg))) },
        {
          label: t('অনুমোদন', 'Approve'), ic: 'approve', kind: 'soft', run: async () => {
            if (!(await confirmBox(t(`${m.nameBn} (${m.memberId}) — সদস্যপদ অনুমোদন করবেন?`, `Approve membership for ${m.nameBn} (${m.memberId})?`), { okLabel: t('অনুমোদন', 'Approve') }))) return;
            await setMemberStatus(m.id, 'active', session); toast(t('সদস্য অনুমোদিত', 'Member approved'), 'success'); App.refresh();
          },
        },
        {
          label: t('বাতিল', 'Reject'), ic: 'reject', kind: 'softred', run: async () => {
            const r = await rejectReason();
            if (r === null) return;
            await setMemberStatus(m.id, 'rejected', session, r); toast(t('সদস্য প্রত্যাখ্যাত', 'Member rejected'), 'warn'); App.refresh();
          },
        },
        { label: t('সম্পাদনা', 'Edit'), ic: 'edit', kind: 'ghost', run: () => App.go('members', { section: 'edit', docId: m.id }) },
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
      name: d.memberName || '',
      memberId: d.memberId,
      dateLabel: fmtDate(d.date),
      dateCaption: t('জমার তারিখ', 'Deposit date'),
      meta: `${typeLabel(d.type).bn} · ${methodLabel(d.method).bn}${descOf(d) ? ' · ' + descOf(d) : ''}`,
      amount: num(d.amount),
      sort: String(d.submittedAt || ''),
      actions: [
        {
          label: t('অনুমোদন', 'Approve'), ic: 'approve', kind: 'soft', run: async () => {
            if (!(await confirmBox(t(`${d.memberName} — ${taka(d.amount)} (${fmtDate(d.date)}) অনুমোদন করবেন?`, `Approve ${taka(d.amount)} from ${d.memberName} (${fmtDate(d.date)})?`), { okLabel: t('অনুমোদন', 'Approve') }))) return;
            await setDepositStatus(d.id, 'approved', session); toast(t('জমা অনুমোদিত', 'Deposit approved'), 'success'); App.refresh();
          },
        },
        {
          label: t('বাতিল', 'Reject'), ic: 'reject', kind: 'softred', run: async () => {
            const r = await rejectReason(t('জমা প্রত্যাখ্যানের কারণ', 'Deposit rejection reason'));
            if (r === null) return;
            await setDepositStatus(d.id, 'rejected', session, r); toast(t('জমা প্রত্যাখ্যাত', 'Deposit rejected'), 'warn'); App.refresh();
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
      name: w.memberName || '',
      memberId: w.memberId,
      dateLabel: fmtDate(w.date),
      dateCaption: t('উত্তোলনের তারিখ', 'Withdrawal date'),
      meta: `${withdrawalTypeLabel(w.type).bn} · ${methodLabel(w.method).bn}${descOf(w) ? ' · ' + descOf(w) : ''}`,
      amount: num(w.amount),
      sort: String(w.submittedAt || ''),
      actions: [
        {
          label: t('অনুমোদন', 'Approve'), ic: 'approve', kind: 'soft', run: async () => {
            if (!(await confirmBox(t(`${w.memberName} — ${taka(w.amount)} (${fmtDate(w.date)}) উত্তোলন অনুমোদন করবেন?`, `Approve withdrawal of ${taka(w.amount)} for ${w.memberName} (${fmtDate(w.date)})?`), { okLabel: t('অনুমোদন', 'Approve') }))) return;
            await setWithdrawalStatus(w.id, 'approved', session); toast(t('উত্তোলন অনুমোদিত', 'Withdrawal approved'), 'success'); App.refresh();
          },
        },
        {
          label: t('বাতিল', 'Reject'), ic: 'reject', kind: 'softred', run: async () => {
            const r = await rejectReason(t('উত্তোলন প্রত্যাখ্যানের কারণ', 'Withdrawal rejection reason'));
            if (r === null) return;
            await setWithdrawalStatus(w.id, 'rejected', session, r); toast(t('উত্তোলন প্রত্যাখ্যাত', 'Withdrawal rejected'), 'warn'); App.refresh();
          },
        },
      ],
    }));
}

/* ONE pending-request card: who applied, which member ID, when, and the two
   decisions (অনুমোদন / প্রত্যাখ্যান). Anything secondary (View, Edit) is a small
   ghost button, so the card never looks dense. */
function approvalRow(item) {
  const KIND = { member: t('সদস্য', 'Member'), deposit: t('জমা', 'Deposit'), withdrawal: t('উত্তোলন', 'Withdrawal') };
  const row = el('div', { class: `appr acard ${item.kind}` });

  const head = el('div', { class: 'ac-head' });
  head.innerHTML = `<span class="ac-ic">${icon(item.ic)}</span>
    <span class="ac-tt">
      <b class="ac-name">${esc(item.name || item.title || '')}</b>
      <span class="ac-sub"><span class="ac-mid">${esc(item.memberId || '')}</span>${item.extra ? `<span class="ac-extra">${esc(item.extra)}</span>` : ''}</span>
    </span>
    <span class="ac-kind">${esc(KIND[item.kind] || item.kind)}</span>`;
  row.appendChild(head);

  const meta = el('div', { class: 'ac-meta' });
  meta.innerHTML = `<span class="ac-line"><span class="ac-cap">${esc(item.dateCaption || t('তারিখ', 'Date'))}</span> ${esc(item.dateLabel || '')}</span>
    ${item.meta ? `<span class="ac-line">${esc(item.meta)}</span>` : ''}`;
  row.appendChild(meta);

  if (item.amount !== null && item.amount !== undefined) {
    row.appendChild(el('div', { class: 'ac-amt', text: money(item.amount) }));
  }

  const decisions = item.actions.filter(a => a.ic === 'approve' || a.ic === 'reject');
  const secondary = item.actions.filter(a => a.ic !== 'approve' && a.ic !== 'reject');
  const primary = el('div', { class: 'ac-acts' });
  decisions.forEach(a => primary.appendChild(btn(a.label, a.ic, a.kind, a.run, { size: 'xs' })));
  const rest = el('div', { class: 'ac-acts secondary' });
  secondary.forEach(a => rest.appendChild(btn(a.label, a.ic, a.kind, a.run, { size: 'xs' })));
  row.append(primary);
  if (rest.children.length) row.append(rest);

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
  const wrap = page(t('অপেক্ষমাণ অনুরোধ', 'Pending Requests'), 'Pending Requests', 'pending');
  const canApproveMember = can(session, 'member:approve');
  const canApproveDeposit = can(session, 'deposit:approve');
  if (!canApproveMember && !canApproveDeposit) {
    wrap.appendChild(banner('err', esc(t('এই পেজে আপনার প্রবেশাধিকার নেই।', 'You are not authorized to view pending requests.'))));
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
    statCard({ label: t('সদস্য', 'Members'), value: String(count('member')), sub: t('সদস্যপদ অনুমোদের অপেক্ষায়', 'awaiting membership approval'), ic: 'members', tone: 'blue' }),
    statCard({ label: t('জমা', 'Deposits'), value: String(count('deposit')), sub: sum('deposit') ? t(`মোট ${taka(sum('deposit'))}`, `${taka(sum('deposit'))} total`) : t('কোনো জমা নেই', 'nothing pending'), ic: 'deposit', tone: 'amber' }),
    statCard({ label: t('উত্তোলন', 'Withdrawals'), value: String(count('withdrawal')), sub: sum('withdrawal') ? t(`মোট ${taka(sum('withdrawal'))}`, `${taka(sum('withdrawal'))} total`) : t('কোনো উত্তোলন নেই', 'nothing pending'), ic: 'withdraw', tone: 'amber' }),
    statCard({ label: t('সর্বমোট', 'Total'), value: String(items.length), sub: t('এক জায়গায় সব অনুমোদন', 'every approval in one place'), ic: 'pending' }),
  );
  wrap.appendChild(stats);

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
      ? t(`${shown.length}টি অনুরোধ${total ? ` · মোট ${money(total)}` : ''}`,
          `${shown.length} request(s)${total ? ` · ${money(total)} total` : ''}`)
      : '';
    listBox.replaceChildren();
    if (!shown.length) {
      const msg = items.length
        ? t('এই ধরনের কোনো অনুরোধ নেই', 'Nothing pending in this category')
        : t('অনুমোদনের অপেক্ষায় কিছু নেই — সব শেষ!', 'Nothing waiting for approval — all clear!');
      listBox.appendChild(el('div', { class: 'empty', html: `${icon(items.length ? 'filter' : 'check')}<span>${esc(msg)}</span>` }));
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

/* ==================== Staff & member-account managers (used by Settings) ============ */
const staffRoleTag = u => `<span class="tag ${u.role === 'admin' ? 'info' : 'approved'}">${esc(u.role === 'admin' ? t('অ্যাডমিন', 'Admin') : 'Maker')}</span>`;
const staffStatusTag = u => `<span class="tag ${u.active === false ? 'rejected' : 'approved'}">${u.active === false ? esc(t('নিষ্ক্রিয়', 'Inactive')) : esc(t('সক্রিয়', 'Active'))}</span>${u.mustChangePassword ? ` <span class="tag pending">${esc(t('পাসওয়ার্ড বদলান', 'Change password'))}</span>` : ''}`;
const loginStatusTag = u => !u ? `<span class="tag gray">${esc(t('অ্যাকাউন্ট নেই', 'No account'))}</span>`
  : `<span class="tag ${u.active === false ? 'rejected' : 'approved'}">${u.active === false ? esc(t('বন্ধ', 'Disabled')) : esc(t('চালু', 'Enabled'))}</span>`;

function staffCard(u, acts) {
  const d = el('div', { class: 'user-card' });
  d.innerHTML = `<div class="ul-1"><b>${esc(u.displayName || u.username)}</b> ${staffRoleTag(u)}</div>
    <div class="ul-2">${esc(u.username)}${u.mobile ? ' · ' + esc(u.mobile) : ''}</div>
    <div class="ul-3">${staffStatusTag(u)}</div>`;
  const ar = el('div', { class: 'ul-act' });
  ar.appendChild(acts);
  d.appendChild(ar);
  return d;
}

function accountCard(m, u, acts) {
  const d = el('div', { class: 'user-card' });
  d.innerHTML = `<div class="ul-1"><b>${esc(m.nameBn)}</b> <span class="faint fs8">${esc(m.memberId)}</span> ${statusTag(m.status)}</div>
    <div class="ul-2">${esc(u ? u.username : '—')}</div>
    <div class="ul-3">${loginStatusTag(u)}</div>`;
  const ar = el('div', { class: 'ul-act' });
  ar.appendChild(acts);
  d.appendChild(ar);
  return d;
}

export const isNarrowList = () => !!(window.matchMedia && window.matchMedia('(max-width: 767px)').matches);
export function onBreakpoint(host, render) {
  if (!window.matchMedia) return;
  const mq = window.matchMedia('(max-width: 767px)');
  const onBp = () => {
    if (!host.isConnected) { if (mq.removeEventListener) mq.removeEventListener('change', onBp); return; }
    render();
  };
  if (mq.addEventListener) mq.addEventListener('change', onBp);
}

export async function staffManager(session, host) {
  const users = await allUsers();
  const staff = users.filter(u => u.role === 'maker' || u.role === 'admin')
    .sort((a, b) => (a.role === b.role ? (a.username || '').localeCompare(b.username || '') : a.role === 'admin' ? -1 : 1));

  const c = card(t('স্টাফ অ্যাকাউন্ট', 'Staff Accounts'), 'Staff Accounts', el('div'), [
    btn(t('নতুন মেকার', 'New Maker'), 'plus', 'primary', () => newStaff(session), { size: 'xs' }),
  ]);

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
  bar.appendChild(btn(t('মুছুন', 'Clear'), 'clear', 'ghost', () => { q.value = ''; role.sel.value = ''; stat.sel.value = ''; render(); }, { size: 'xs' }));
  host.appendChild(bar);
  host.appendChild(c);

  const actsOf = u => {
    const acts = el('div', { class: 'btn-row' });
    acts.appendChild(btn(t('পাসওয়ার্ড', 'Password'), 'key', 'ghost', () => resetPw(session, u), { size: 'xs' }));
    if (u.role !== 'admin') {
      acts.appendChild(btn(u.active === false ? t('চালু', 'Activate') : t('বন্ধ', 'Deactivate'), u.active === false ? 'approve' : 'lock', u.active === false ? 'soft' : 'softred', async () => {
        await setUserActive(u.id, u.active === false, session);
        toast(u.active === false ? t('অ্যাকাউন্ট সক্রিয়', 'Activated') : t('অ্যাকাউন্ট নিষ্ক্রিয়', 'Deactivated'), 'success');
        App.refresh();
      }, { size: 'xs' }));
      acts.appendChild(btn(t('মুছুন', 'Delete'), 'trash', 'softred', async () => {
        if (!(await confirmBox(t(`${u.username} অ্যাকাউন্টটি স্থায়ীভাবে মুছে ফেলবেন?`, `Permanently delete the account ${u.username}?`), { okLabel: t('মুছুন', 'Delete'), danger: true }))) return;
        try { await deleteUser(u.id, session); toast(t('অ্যাকাউন্ট মুছে ফেলা হয়েছে', 'Account deleted'), 'warn'); App.refresh(); }
        catch (err) { toast(err.message, 'error'); }
      }, { size: 'xs' }));
    }
    return acts;
  };
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
    if (isNarrowList()) {
      if (!rows.length) {
        c.body.appendChild(emptyState({ ic: 'maker', title: t('কোনো স্টাফ অ্যাকাউন্ট নেই', 'No staff accounts'), compact: true }));
        return;
      }
      rows.forEach(u => c.body.appendChild(staffCard(u, actsOf(u))));
      return;
    }
    c.body.appendChild(tableWrap(
      [{ label: t('ইউজারনেম', 'Username') }, { label: t('নাম', 'Name') }, { label: t('রোল', 'Role') }, { label: t('মোবাইল', 'Mobile') }, { label: t('স্ট্যাটাস', 'Status') }, { label: t('তৈরি', 'Created') }, { label: t('অ্যাকশন', 'Action'), cls: 'nowrap' }],
      rows.map(u => [
        `<b>${esc(u.username)}</b>`, esc(u.displayName || ''),
        { html: staffRoleTag(u) },
        esc(u.mobile || '—'),
        { html: staffStatusTag(u) },
        esc(fmtDate(u.createdAt)),
        { node: actsOf(u), cls: 'nowrap' },
      ]),
      { empty: t('কোনো স্টাফ অ্যাকাউন্ট নেই', 'No staff accounts'), emptyIcon: 'maker' },
    ));
  };
  q.addEventListener('input', debounce(render, 180));
  role.sel.addEventListener('change', render);
  stat.sel.addEventListener('change', render);
  onBreakpoint(c, render);
  render();
  host.appendChild(banner('info', t(
    'Maker সদস্য অনুমোদন, জমা এন্ট্রি ও অনুমোদন, প্রতিবেদন ও WhatsApp রিমাইন্ডার ব্যবহার করতে পারেন। Maker কেবল <b>আজকের তারিখের</b> জমা সম্পাদনা বা মুছতে পারবেন এবং Member ID পরিবর্তন করতে পারবেন না।',
    'A Maker can approve members, enter and approve deposits, and use reports and WhatsApp reminders. A Maker may only edit or delete deposits dated <b>today</b> and cannot change a Member ID.')));
}

function newStaff(session) {
  return formModal({
    title: t('নতুন মেকার অ্যাকাউন্ট', 'New Maker account'),
    width: 460, okLabel: t('তৈরি করুন', 'Create'), dismissible: true,
    html: `<div class="grid g2">
        <div class="field"><label>${t('ইউজারনেম', 'Username')} <span class="req">*</span></label><input name="username" required autocomplete="off"></div>
        <div class="field"><label>${t('নাম', 'Name')} <span class="req">*</span></label><input name="displayName" required></div>
        <div class="field"><label>${t('মোবাইল', 'Mobile')}</label><input name="mobile" inputmode="numeric" maxlength="11"></div>
        <div class="field"><label>${t('ইমেইল', 'Email')}</label><input name="email" type="email"></div>
        <div class="field"><label>${t('পাসওয়ার্ড', 'Password')} <span class="req">*</span></label><input name="pw1" type="password" required autocomplete="new-password"></div>
        <div class="field"><label>${t('পাসওয়ার্ড (আবার)', 'Password (again)')} <span class="req">*</span></label><input name="pw2" type="password" required autocomplete="new-password"></div>
      </div>
      <div class="hint">${t('প্রথম লগইনে মেকারকে পাসওয়ার্ড পরিবর্তন করতে হবে।', 'A Maker must change the password on first login.')}</div>`,
    onSubmit: async (v, fail) => {
      if (!String(v.username || '').trim()) return fail(t('ইউজারনেম আবশ্যক', 'Username is required'));
      if (!String(v.displayName || '').trim()) return fail(t('নাম আবশ্যক', 'Name is required'));
      if (v.mobile && !isValidMobile(v.mobile)) return fail(t('সঠিক মোবাইল নম্বর দিন', 'Enter a valid mobile number'));
      if (v.email && !isValidEmail(v.email)) return fail(t('সঠিক ইমেইল দিন', 'Enter a valid email'));
      const issues = passwordIssues(v.pw1);
      if (issues.length) return fail(issues[0]);
      if (v.pw1 !== v.pw2) return fail(t('দুইটি পাসওয়ার্ড এক নয়', 'The two passwords do not match'));
      await createStaffUser({ username: v.username, displayName: v.displayName, password: v.pw1, role: 'maker', mobile: v.mobile, email: v.email }, session);
      toast(t('মেকার অ্যাকাউন্ট তৈরি হয়েছে', 'Maker account created'), 'success');
      App.refresh();
      return true;
    },
  });
}

function resetPw(session, u) {
  return formModal({
    title: t(`পাসওয়ার্ড রিসেট — ${u.username}`, `Reset password — ${u.username}`),
    width: 420, okLabel: t('রিসেট করুন', 'Reset'), dismissible: true,
    html: `<div class="banner warn">${icon('warn')}<span>${t('নতুন পাসওয়ার্ড ব্যবহারকারীকে নিরাপদে জানিয়ে দিন। পুরাতন পাসওয়ার্ড আর কাজ করবে না।', 'Share the new password with the user securely. The old password will no longer work.')}</span></div>
      <div class="grid g2">
        <div class="field"><label>${t('পাসওয়ার্ড', 'Password')} <span class="req">*</span></label><input name="pw1" type="password" required autocomplete="new-password"></div>
        <div class="field"><label>${t('পাসওয়ার্ড (আবার)', 'Password (again)')} <span class="req">*</span></label><input name="pw2" type="password" required autocomplete="new-password"></div>
      </div>
      <label class="check"><input type="checkbox" name="mustChange" checked> ${t('পরবর্তী লগইনে পাসওয়ার্ড পরিবর্তন বাধ্যতামূলক', 'Force a password change on next login')}</label>`,
    onSubmit: async (v, fail) => {
      const issues = passwordIssues(v.pw1);
      if (issues.length) return fail(issues[0]);
      if (v.pw1 !== v.pw2) return fail(t('দুইটি পাসওয়ার্ড এক নয়', 'The two passwords do not match'));
      await resetUserPassword(u.id, v.pw1, session, { mustChange: !!v.mustChange });
      toast(t('পাসওয়ার্ড রিসেট হয়েছে', 'Password reset'), 'success');
      App.refresh();
      return true;
    },
  });
}

export async function accountManager(session, host) {
  const [members, users] = await Promise.all([allMembers(), allUsers()]);
  const rows = members.slice().sort((a, b) => a.memberId.localeCompare(b.memberId)).map(m => ({ m, u: users.find(u => u.memberDocId === m.id) }));

  host.appendChild(banner('info', t('সদস্যের লগইন ইউজারনেম = তার মোবাইল নম্বর। পাসওয়ার্ড কখনো সংরক্ষিত বা প্রদর্শিত হয় না — প্রয়োজনে রিসেট করুন।', 'A member signs in with their mobile number as the username. Passwords are never stored in readable form or displayed — reset one when needed.')));

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
  bar.appendChild(btn(t('মুছুন', 'Clear'), 'clear', 'ghost', () => { q.value = ''; login.sel.value = ''; mstat.sel.value = ''; render(); }, { size: 'xs' }));
  host.appendChild(bar);

  const c = card('সদস্য লগইন অ্যাকাউন্ট', 'Member Login Accounts', el('div'));
  host.appendChild(c);

  const actsOf = (m, u) => {
    const acts = el('div', { class: 'btn-row' });
    if (u) {
      acts.appendChild(btn(t('পাসওয়ার্ড', 'Password'), 'key', 'ghost', () => resetPw(session, u), { size: 'xs' }));
      acts.appendChild(btn(u.active === false ? t('চালু', 'Enable') : t('বন্ধ', 'Disable'), u.active === false ? 'approve' : 'lock', u.active === false ? 'soft' : 'softred', async () => {
        await setUserActive(u.id, u.active === false, session);
        toast(t('লগইন স্ট্যাটাস হালনাগাদ', 'Login status updated'), 'success'); App.refresh();
      }, { size: 'xs' }));
    }
    acts.appendChild(btn(t('সম্পাদনা', 'Edit'), 'edit', 'ghost', () => App.go('members', { section: 'update', memberDocId: m.id }), { size: 'xs' }));
    return acts;
  };
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
    if (isNarrowList()) {
      if (!shown.length) {
        c.body.appendChild(emptyState({ ic: 'members', title: t('এই ফিল্টারে কোনো সদস্য নেই', 'No members match this filter'), compact: true }));
        return;
      }
      shown.forEach(({ m, u }) => c.body.appendChild(accountCard(m, u, actsOf(m, u))));
      return;
    }
    c.body.appendChild(tableWrap(
      [{ label: t('সদস্য আইডি', 'Member ID') }, { label: t('নাম', 'Name') }, { label: t('ইউজারনেম', 'Username') }, { label: t('সদস্য স্ট্যাটাস', 'Member status') }, { label: t('লগইন স্ট্যাটাস', 'Login status') }, { label: t('অ্যাকশন', 'Action'), cls: 'nowrap' }],
      shown.map(({ m, u }) => [
        `<b>${esc(m.memberId)}</b>`, esc(m.nameBn), esc(u ? u.username : '—'),
        { html: statusTag(m.status) },
        { html: loginStatusTag(u) },
        { node: actsOf(m, u), cls: 'nowrap' },
      ]),
      { empty: t('এই ফিল্টারে কোনো সদস্য নেই', 'No members match this filter'), emptyIcon: 'members' },
    ));
  };
  q.addEventListener('input', debounce(render, 180));
  login.sel.addEventListener('change', render);
  mstat.sel.addEventListener('change', render);
  onBreakpoint(c, render);
  render();
}
