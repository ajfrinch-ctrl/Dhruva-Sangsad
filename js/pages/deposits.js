/* Deposits — Submit Deposit · My Deposits · My Approved Deposits · Deposit
   History · Withdrawal. Icon-tile hub (2 columns, odd card never stretched),
   option grids for জমার ধরন / পরিশোধ পদ্ধতি, fixed monthly amount, unique
   transaction ids (YYYYMMDDNNN) stamped from the actual payment date. */
import {
  el, esc, toast, taka, money, num, fmtDate, fmtDateTime, todayISO, modal, confirmBox,
  DEPOSIT_TYPES, PAY_METHODS, typeLabel, methodLabel, debounce, t,
} from '../util.js';
import { icon } from '../icons.js';
import { page, card, tableWrap, statusTag, banner, btn, kv, statCard, embedPage, emptyState, segChips, filterSheet, optionGrid, tileMenu, sectionBar, txnIdChip, bindCopyIds } from '../ui.js';
import { memberPicker } from '../picker.js';
import {
  allMembers, allDeposits, allWithdrawals, settings, submitDeposit, memberSummary, setDepositStatus,
  canModifyDeposit, updateDeposit, deleteDeposit, getMember, submitWithdrawal, setWithdrawalStatus, summaryOpts,
  withdrawalBalance, WITHDRAWAL_TYPES, withdrawalTypeLabel,
} from '../store.js';
import { can } from '../auth.js';
import { App } from '../app.js';
import { rejectReason } from './members.js';

/* ---- icon vocabulary for the option grids ---- */
const TYPE_ICON = { monthly: 'wallet', advance: 'advance', special: 'star', other: 'plus' };
const METHOD_ICON = { cash: 'money', mobile: 'phone', bank: 'building' };
const WTYPE_ICON = { savings: 'deposit', advance_refund: 'restore', other: 'withdraw' };

const TYPE_OPTS = DEPOSIT_TYPES.map(d => ({ value: d.id, bn: d.bn, en: d.en, ic: TYPE_ICON[d.id] || 'plus' }));
const METHOD_OPTS = PAY_METHODS.map(p => ({ value: p.id, bn: p.bn, en: p.en, ic: METHOD_ICON[p.id] || 'wallet' }));
const WTYPE_OPTS = WITHDRAWAL_TYPES.map(w => ({ value: w.id, bn: w.bn, en: w.en, ic: WTYPE_ICON[w.id] || 'withdraw' }));

/* Short chip labels for filters (grids are for the form itself). */
const TYPE_SHORT = [
  { value: 'monthly', bn: 'মাসিক', en: 'Monthly' },
  { value: 'advance', bn: 'অগ্রিম', en: 'Advance' },
  { value: 'special', bn: 'বিশেষ', en: 'Special' },
  { value: 'other', bn: 'অন্যান্য', en: 'Other' },
];
const METHOD_SHORT = [
  { value: 'cash', bn: 'নগদ', en: 'Cash' },
  { value: 'mobile', bn: 'মোবাইল ব্যাংকিং', en: 'Mobile banking' },
  { value: 'bank', bn: 'ব্যাংক', en: 'Bank' },
];

/* ==================== Deposits hub (icon menu + sections) ==================== */
export async function pageDepositsHub(session, params = {}) {
  const staff = session.role === 'admin' || session.role === 'maker';
  const [deposits, withdrawals] = await Promise.all([allDeposits(), allWithdrawals()]);
  const mineDeposits = staff ? deposits : deposits.filter(d => d.memberDocId === session.memberDocId || d.memberId === session.memberId);

  const SECTIONS = staff ? [
    { id: 'entry', ic: 'plus', bn: 'জমা এন্ট্রি', en: 'Submit Deposit', sub: 'নতুন জমা যোগ করুন / record a new deposit', tone: '' },
    { id: 'history', ic: 'receipt', bn: 'জমার ইতিহাস', en: 'Deposit History', sub: 'সব রেকর্ড ও ফিল্টার / every record', tone: 'info' },
    { id: 'withdrawal', ic: 'withdraw', bn: 'উত্তোলন', en: 'Withdrawal', sub: 'উত্তোলন এন্ট্রি ও ইতিহাস', tone: 'danger' },
  ] : [
    { id: 'entry', ic: 'plus', bn: 'জমা দাখিল', en: 'Submit Deposit', sub: 'নতুন জমা পাঠান / send a new deposit', tone: '' },
    { id: 'mine', ic: 'receipt', bn: 'আমার জমা', en: 'My Deposits', sub: `সব অবস্থা · ${mineDeposits.length}টি`, tone: 'info' },
    { id: 'approved', ic: 'approve', bn: 'অনুমোদিত জমা', en: 'My Approved Deposits', sub: `শুধু অনুমোদিত · ${mineDeposits.filter(d => d.status === 'approved').length}টি`, tone: '' },
    { id: 'history', ic: 'history', bn: 'জমার ইতিহাস', en: 'Deposit History', sub: 'সময়কাল অনুযায়ী খুঁজুন', tone: 'gray' },
    { id: 'withdrawal', ic: 'withdraw', bn: 'উত্তোলন', en: 'Withdrawal', sub: 'আবেদন ও ইতিহাস', tone: 'danger' },
  ];

  const valid = SECTIONS.some(x => x.id === (params.section || params.tab));
  const active = valid ? (params.section || params.tab) : '';

  if (!active) {
    /* ---- icon menu (this is the ONLY place deposit submission is offered) ---- */
    const wrap = page('জমা', 'Deposits', 'deposit');
    wrap.appendChild(tileMenu(SECTIONS, id => App.go('deposits', { section: id }), { ariaLabel: t('জমা বিভাগ', 'Deposit sections') }));
    return wrap;
  }

  const sec = SECTIONS.find(x => x.id === active);
  const host = el('div');
  const wrap = el('div');
  wrap.appendChild(sectionBar(sec.bn, sec.en, sec.ic, () => App.go('deposits', {}), t('জমা মেনু', 'Deposits menu')));
  wrap.appendChild(host);
  const fn = active === 'entry' ? (staff ? pageDepositEntry : pageDepositEntry)
    : active === 'withdrawal' ? pageWithdrawal
    : active === 'approved' ? () => pageMyDeposits(session, { status: 'approved' })
    : active === 'mine' ? () => pageMyDeposits(session, {})
    : pageDepositHistory;
  await embedPage(host, fn, session, active === 'approved' || active === 'mine' ? { status: active === 'approved' ? 'approved' : '' } : {});
  bindCopyIds(host);
  return wrap;
}

/* ==================== Deposit entry (staff & member) ==================== */
export async function pageDepositEntry(session, params = {}) {
  const [members, deposits, cfg] = await Promise.all([allMembers(), allDeposits(), settings()]);
  const staff = session.role === 'admin' || session.role === 'maker';
  const wrap = page('জমা এন্ট্রি', 'Deposit Entry', 'plus');

  /* ---- member context ---- */
  let member = null;
  if (!staff) {
    member = members.find(m => m.id === session.memberDocId) || null;
    if (!member) { wrap.appendChild(banner('err', 'সদস্য প্রোফাইল পাওয়া যায়নি / Member profile not found.')); return wrap; }
    if (member.status !== 'active') {
      wrap.appendChild(banner('warn', `আপনার সদস্যপদ এখনো ${statusTag(member.status)}। অনুমোদনের পূর্বে জমা দাখিল করা যাবে না।`));
      return wrap;
    }
  }

  const activeMembers = members.filter(m => m.status === 'active');
  if (staff && !activeMembers.length) {
    wrap.appendChild(banner('warn', 'কোনো Active সদস্য নেই। প্রথমে সদস্য অনুমোদন করুন। / No active member yet — approve a member first.'));
    return wrap;
  }

  const infoHost = el('div');
  const form = el('form', { class: 'grid mform', novalidate: true });
  let picker = null;

  const memberField = staff ? '<div class="field js-pickhost"><label>সদস্য <span class="req">*</span></label></div>'
    : `<div class="field"><label>সদস্য</label><input value="${esc(member.memberId)} — ${esc(member.nameBn)}" readonly>
        <input type="hidden" name="memberDocId" value="${esc(member.id)}"></div>`;

  form.innerHTML = `
    <div class="grid g2">
      ${memberField}
      <div class="field"><label>তারিখ (পেমেন্টের দিন) <span class="req">*</span></label>
        <input name="date" type="date" required value="${todayISO()}" ${session.role === 'maker' ? `max="${todayISO()}" min="${todayISO()}"` : ''}>
        ${session.role === 'maker' ? '<div class="hint">Maker শুধুমাত্র আজকের তারিখে এন্ট্রি করতে পারবেন।</div>' : ''}
        <div class="err" data-err="date"></div></div>
    </div>
    <div class="field"><label>জমার ধরন <span class="req">*</span></label><div class="js-type"></div></div>
    <div class="field"><label>পরিশোধ পদ্ধতি <span class="req">*</span></label><div class="js-method"></div></div>
    <div class="grid g2">
      <div class="field js-amount"><label>পরিমাণ (৳) <span class="req">*</span></label>
        <input name="amount" type="number" min="1" step="0.01" required inputmode="decimal" placeholder="0">
        <div class="hint">যেকোনো পরিমাণ গ্রহণযোগ্য</div>
        <div class="err" data-err="amount"></div></div>
      <div class="field js-fixed" hidden><label>মাসিক চাঁদা <span class="req">*</span></label>
        <div class="fixed-amt"><b class="num">৳0</b><span>${esc(t('নির্ধারিত — পরিবর্তনযোগ্য নয়', 'fixed — cannot be changed'))}</span></div>
        <div class="hint">${esc(t('তারিখ অনুযায়ী স্বয়ংক্রিয়', 'applied automatically'))}</div></div>
      <div class="field js-desc" hidden><label>বিবরণ <span class="req">*</span></label>
        <input name="description" placeholder="বিশেষ চাঁদা / অন্যান্য জমার বিবরণ"><div class="err" data-err="description"></div></div>
    </div>
    <div class="field"><label>মন্তব্য (ঐচ্ছিক)</label><textarea name="comment" rows="2" placeholder="ঐচ্ছিক"></textarea></div>
    <div class="form-sticky">
      <button class="btn btn-ghost" type="reset">${icon('clear')}<span>${t('মুছুন', 'Clear')}</span></button>
      <button class="btn btn-primary" type="submit">${icon('save')}<span>${staff ? t('জমা যোগ করুন', 'Add deposit') : t('জমা দাখিল করুন', 'Submit deposit')}</span></button>
    </div>`;
  const typeSeg = optionGrid('type', TYPE_OPTS, 'monthly', { onChange: syncForm });
  const methodSeg = optionGrid('method', METHOD_OPTS, 'cash');
  form.querySelector('.js-type').appendChild(typeSeg.root);
  form.querySelector('.js-method').appendChild(methodSeg.root);

  /* ---- fixed monthly amount + conditional description ---- */
  const amountField = form.querySelector('.js-amount');
  const fixedField = form.querySelector('.js-fixed');
  const fixedVal = fixedField.querySelector('b');
  const amountInp = form.elements.amount;
  const descField = form.querySelector('.js-desc');
  let currentInstallment = num(staff ? (cfg.defaultInstallment || 0) : member?.installment);

  function syncForm() {
    const monthly = form.elements.type.value === 'monthly';
    fixedField.hidden = !monthly;
    amountField.hidden = monthly;
    if (monthly) {
      const fixed = currentInstallment > 0 ? currentInstallment : 0;
      fixedVal.textContent = taka(fixed);
      amountInp.value = fixed || '';
      amountInp.readOnly = true;
      amountInp.required = false;
      amountInp.closest('.field').querySelector('.hint').textContent = t('মাসিক চাঁদার হার স্থির', 'Monthly rate is fixed');
    } else {
      amountInp.readOnly = false;
      amountInp.required = true;
      amountInp.closest('.field').querySelector('.hint').textContent = t('যেকোনো পরিমাণ গ্রহণযোগ্য', 'Any amount accepted');
    }
    const need = form.elements.type.value === 'special' || form.elements.type.value === 'other';
    descField.hidden = !need;
    if (!need) form.elements.description.value = '';
  }

  const paintInfo = async () => {
    infoHost.replaceChildren();
    const id = form.elements.memberDocId ? form.elements.memberDocId.value : (picker ? picker.value : '');
    if (!id) return;
    const m = await getMember(id);
    if (!m) return;
    currentInstallment = num(m.installment);
    const s = memberSummary(m, deposits, summaryOpts(cfg));
    const stats = el('div', { class: 'stats' });
    stats.append(
      statCard({ label: 'মাসিক কিস্তি', value: taka(m.installment), sub: `${s.months} মাস হিসাবযোগ্য`, ic: 'wallet' }),
      statCard({ label: 'মোট জমা', value: taka(s.totalDeposit), sub: `${s.count}টি অনুমোদিত`, ic: 'deposit' }),
      statCard({ label: 'বকেয়া', value: taka(s.due), sub: `প্রয়োজন ${taka(s.required)}`, ic: 'due', tone: s.due > 0 ? 'red' : '' }),
      statCard({ label: 'অগ্রিম', value: taka(s.advance), sub: s.advance > 0 ? 'অতিরিক্ত জমা' : '—', ic: 'advance', tone: 'blue' }),
    );
    infoHost.appendChild(card(staff ? 'সদস্য সারসংক্ষেপ' : 'আমার সারাংশ', staff ? `Member Summary — ${m.memberId}` : 'My Summary', stats));
    syncForm();
  };
  if (staff) {
    picker = memberPicker({ members: activeMembers, value: params.memberDocId || '', onPick: () => paintInfo() });
    const host = form.querySelector('.js-pickhost');
    host.appendChild(picker.root);
    host.insertAdjacentHTML('beforeend', '<div class="err" data-err="memberDocId"></div>');
    if (params.memberDocId) await paintInfo();
  }
  typeSeg.hidden.addEventListener('change', syncForm);
  syncForm();

  /* native date input renders in the device locale — mirror DD-MM-YYYY below */
  const dateInp = form.elements.date;
  const dateFmt = el('div', { class: 'dfmt', text: dateInp.value ? fmtDate(dateInp.value) : '' });
  dateInp.insertAdjacentElement('afterend', dateFmt);
  dateInp.addEventListener('input', () => { dateFmt.textContent = dateInp.value ? fmtDate(dateInp.value) : ''; });

  wrap.appendChild(infoHost);
  const entryCard = card(staff ? 'জমা এন্ট্রি' : 'জমা দাখিল', staff ? 'Deposit Entry' : 'Submit Deposit', form);
  if (staff) entryCard.classList.add('overflow-visible');
  wrap.appendChild(entryCard);
  if (!staff) await paintInfo();

  form.addEventListener('reset', () => setTimeout(() => {
    if (picker) picker.set(params.memberDocId || '');
    typeSeg.reset(); methodSeg.reset();
    form.elements.date.value = todayISO();
    dateFmt.textContent = fmtDate(todayISO());
    syncForm(); paintInfo();
  }, 0));

  form.addEventListener('submit', async e => {
    e.preventDefault();
    form.querySelectorAll('.err').forEach(x => x.textContent = '');
    form.querySelectorAll('.field').forEach(x => x.classList.remove('bad'));
    const setErr = (n, msg) => { const b = form.querySelector(`[data-err="${n}"]`); if (b) { b.textContent = msg; b.closest('.field').classList.add('bad'); } };
    const v = Object.fromEntries(new FormData(form).entries());
    const monthly = v.type === 'monthly';
    let bad = false;
    if (!v.memberDocId) { setErr('memberDocId', 'সদস্য নির্বাচন করুন'); bad = true; }
    if (!v.date) { setErr('date', 'তারিখ দিন'); bad = true; }
    if (!monthly && !(num(v.amount) > 0)) { setErr('amount', 'জমার পরিমাণ দিন'); bad = true; }
    if (monthly && !(currentInstallment > 0)) { setErr('amount', t('সদস্যের মাসিক কিস্তি নির্ধারিত নেই', 'Member installment not configured')); bad = true; }
    if ((v.type === 'special' || v.type === 'other') && !String(v.description || '').trim()) { setErr('description', 'বিবরণ আবশ্যক'); bad = true; }
    if (session.role === 'maker' && v.date !== todayISO()) { setErr('date', 'Maker শুধুমাত্র আজকের তারিখ ব্যবহার করতে পারবেন'); bad = true; }
    if (bad) { toast('ফর্মে ত্রুটি রয়েছে', 'error'); return; }

    const b = form.querySelector('button[type=submit]'); b.disabled = true;
    try {
      const rec = await submitDeposit({ ...v, amount: monthly ? currentInstallment : v.amount }, session);
      await depositSuccess(rec);
      form.reset();
      form.elements.date.value = todayISO();
      syncForm();
      App.refresh();
    } catch (err) { toast(err.message, 'error'); }
    finally { b.disabled = false; }
  });
  return wrap;
}

function depositSuccess(rec) {
  return modal({
    title: t('জমা সফল', 'Deposit Successful'), width: 380,
    body: `<div class="success-pop"><div class="tick">${icon('check')}</div></div>
      <div class="kv">
        <div>${esc(t('Transaction ID', 'Transaction ID'))}</div><div><b class="txn-id-static">${esc(rec.txnId || '')}</b></div>
        <div>সদস্য</div><div><b>${esc(rec.memberName)}</b> (${esc(rec.memberId)})</div>
        <div>তারিখ</div><div>${esc(fmtDate(rec.date))}</div>
        <div>ধরন</div><div>${esc(typeLabel(rec.type).bn)}</div>
        <div>পদ্ধতি</div><div>${esc(methodLabel(rec.method).bn)}</div>
        <div>পরিমাণ</div><div><b style="color:var(--green-dark)">${taka(rec.amount)}</b></div>
        <div>স্ট্যাটাস</div><div>${statusTag(rec.status)}</div>
      </div>
      <div class="banner ${rec.status === 'approved' ? 'ok' : 'info'}" style="margin-top:9px">${icon('info')}<span>${
        rec.status === 'approved'
          ? 'জমা সফলভাবে সংরক্ষিত ও অনুমোদিত হয়েছে।'
          : 'আপনার জমা সফলভাবে দাখিল হয়েছে। Maker/Admin অনুমোদনের পর এটি হিসাবে যুক্ত হবে এবং নোটিশ পাবেন।'}</span></div>`,
    actions: [{ label: t('ঠিক আছে', 'OK'), value: true, kind: 'primary' }],
  });
}

/* Compact transaction card (mobile lists): unique ID first, then meta rows. */
export function txnCard(d, { staff, typeBn, actions = null, idLabel = true }) {
  const c = el('div', { class: 'tcard' });
  c.dataset.id = d.txnId || '';
  const top = el('div', { class: 'tc-top' });
  top.innerHTML = `<span class="tc-ic">${icon(d.amount >= 0 && (d.type === 'monthly' || d.type === 'advance' || d.type === 'special' || d.type === 'other') ? 'deposit' : 'withdraw')}</span>
    <span class="tc-id">${idLabel ? txnIdChip(d.txnId) : `<b>${esc(d.memberName || '')}</b>`}</span>
    <span class="tag-wrap">${statusTag(d.status)}</span>`;
  c.appendChild(top);
  const title = el('div', { class: 'tc-title' });
  title.innerHTML = `<b>${esc(typeBn)}</b><span>${taka(d.amount)}</span>`;
  c.appendChild(title);
  c.appendChild(el('div', { class: 'tc-meta', html: `${esc(fmtDate(d.date))} · ${esc(methodLabel(d.method).bn)}${staff ? ` · <b>${esc(d.memberName)}</b> (${esc(d.memberId)})` : ''}` }));
  if (d.description || d.rejectReason) c.appendChild(el('div', { class: 'tc-desc', text: d.rejectReason || d.description }));
  if (actions && actions.children.length) {
    const a = el('div', { class: 'pc-acts' });
    a.appendChild(actions);
    c.appendChild(a);
  }
  return c;
}

/* Row actions for one deposit — management lives ONLY here and in Approvals. */
function depositActions(session, d, staff) {
  const acts = el('div', { class: 'btn-row' });
  if (d.status === 'pending' && can(session, 'deposit:approve')) {
    acts.appendChild(btn(t('অনুমোদন', 'Approve'), 'approve', 'soft', async () => {
      if (!(await confirmBox(`${d.memberName} — ${taka(d.amount)} জমাটি অনুমোদন করবেন?`, { okLabel: t('অনুমোদন', 'Approve') }))) return;
      await setDepositStatus(d.id, 'approved', session); toast('জমা অনুমোদিত / Deposit approved', 'success'); App.refresh();
    }, { size: 'xs' }));
    acts.appendChild(btn(t('বাতিল', 'Reject'), 'reject', 'softred', async () => {
      const r = await rejectReason('জমা বাতিলের কারণ / Deposit Rejection Reason');
      if (r === null) return;
      await setDepositStatus(d.id, 'rejected', session, r); toast('জমা বাতিল / Deposit rejected', 'warn'); App.refresh();
    }, { size: 'xs' }));
  }
  const perm = canModifyDeposit(d, session);
  if (staff && perm.ok) {
    acts.appendChild(btn(t('সম্পাদনা', 'Edit'), 'edit', 'ghost', () => editDeposit(session, d), { size: 'xs' }));
    acts.appendChild(btn(t('মুছুন', 'Delete'), 'trash', 'softred', async () => {
      if (!(await confirmBox(`${d.memberName} — ${taka(d.amount)} (${fmtDate(d.date)}) জমাটি মুছে ফেলবেন? এটি ফেরানো যাবে না।`, { okLabel: t('মুছুন', 'Delete'), danger: true }))) return;
      try { await deleteDeposit(d.id, session); toast('জমা মুছে ফেলা হয়েছে / Deposit deleted', 'warn'); App.refresh(); }
      catch (err) { toast(err.message, 'error'); }
    }, { size: 'xs' }));
  }
  acts.appendChild(btn(t('বিস্তারিত', 'Details'), 'eye', 'ghost', () => viewDeposit(d), { size: 'xs' }));
  return acts;
}

/* ==================== My deposits / My approved deposits (member) ==================== */
export async function pageMyDeposits(session, params = {}) {
  const onlyApproved = params.status === 'approved';
  const [deposits, cfg] = await Promise.all([allDeposits(), settings()]);
  const wrap = page(onlyApproved ? 'আমার অনুমোদিত জমা' : 'আমার জমা', onlyApproved ? 'My Approved Deposits' : 'My Deposits', onlyApproved ? 'approve' : 'receipt');
  const m = await getMember(session.memberDocId);
  if (!m) { wrap.appendChild(banner('err', 'সদস্য প্রোফাইল পাওয়া যায়নি')); return wrap; }
  const s = memberSummary(m, deposits, summaryOpts(cfg));
  let rows = (onlyApproved ? s.deposits : deposits.filter(d => d.memberDocId === m.id || d.memberId === m.memberId))
    .slice().sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.submittedAt).localeCompare(String(a.submittedAt)));

  const total = rows.reduce((x, d) => x + num(d.amount), 0);
  const stats = el('div', { class: 'stats' });
  stats.append(
    statCard({ label: onlyApproved ? 'অনুমোদিত জমা' : 'সব জমা', value: taka(total), sub: `${rows.length}টি রেকর্ড`, ic: 'money' }),
    statCard({ label: 'মোট বকেয়া / Due', value: taka(s.due), sub: `প্রয়োজন ${taka(s.required)}`, ic: 'due', tone: s.due > 0 ? 'red' : '' }),
  );
  wrap.appendChild(stats);

  const list = el('div', { class: 'person-list' });
  if (!rows.length) {
    list.appendChild(emptyState({
      ic: 'receipt',
      title: onlyApproved ? t('এখনো কোনো অনুমোদিত জমা নেই', 'No approved deposits yet') : t('এখনো কোনো জমা নেই', 'No deposits yet'),
      hint: onlyApproved ? t('অনুমোদনের পর নোটিশ পাবেন', 'You will be notified when it is approved') : '',
    }));
  } else {
    rows.forEach(d => list.appendChild(txnCard(d, { staff: false, typeBn: typeLabel(d.type).bn, actions: onlyApproved ? null : depositActions(session, d, false) })));
  }
  wrap.appendChild(list);
  bindCopyIds(list);
  return wrap;
}

/* ==================== Deposit history (search + filters) ==================== */
export async function pageDepositHistory(session, params = {}) {
  const [members, deposits] = await Promise.all([allMembers(), allDeposits()]);
  const staff = session.role === 'admin' || session.role === 'maker';
  const wrap = page('জমার ইতিহাস', 'Deposit History', 'history');

  const mine = staff ? deposits : deposits.filter(d => d.memberDocId === session.memberDocId || d.memberId === session.memberId);

  let st = params.status || '', tp = '', mt = '', from = '', to = '';

  const head = el('div', { class: 'txn-head' });
  const searchBox = el('div', { class: 'search-box', html: icon('search') });
  const q = el('input', {
    placeholder: t('Txn ID / সদস্য / বিবরণ / টাকা…', 'Txn ID / member / note / amount…'),
    autocomplete: 'off', 'aria-label': t('লেনদেন খুঁজুন', 'Search transactions'),
  });
  searchBox.appendChild(q);
  const filterBtn = el('button', { type: 'button', class: 'btn btn-ghost filter-btn', 'aria-label': t('ফিল্টার', 'Filter') });
  const paintBadge = () => {
    const n = [st, tp, mt, from, to].filter(Boolean).length;
    filterBtn.innerHTML = `${icon('filter')}<span>${esc(t('ফিল্টার', 'Filter'))}</span>${n ? `<span class="fbadge">${n}</span>` : ''}`;
  };
  paintBadge();
  filterBtn.addEventListener('click', () => filterSheet({
    state: { st, tp, mt, from, to },
    sections: [
      { key: 'st', label: t('স্ট্যাটাস', 'Status'), options: [{ value: '', bn: 'সব', en: 'All' }, { value: 'pending', bn: 'অপেক্ষমাণ', en: 'Pending' }, { value: 'approved', bn: 'অনুমোদিত', en: 'Approved' }, { value: 'rejected', bn: 'বাতিল', en: 'Rejected' }] },
      { key: 'tp', label: t('ধরন', 'Type'), options: [{ value: '', bn: 'সব', en: 'All' }, ...TYPE_SHORT] },
      { key: 'mt', label: t('পদ্ধতি', 'Method'), options: [{ value: '', bn: 'সব', en: 'All' }, ...METHOD_SHORT] },
    ],
    dates: { fromLabel: t('তারিখ: শুরু', 'Date: from'), toLabel: t('শেষ', 'to') },
    onApply: x => { ({ st, tp, mt, from, to } = x); paintBadge(); render(); },
    onClear: () => { st = tp = mt = from = to = ''; paintBadge(); render(); },
  }));
  head.append(searchBox, filterBtn);
  wrap.appendChild(head);

  const sumHost = el('div');
  wrap.appendChild(sumHost);
  const listHost = el('div', { class: 'person-list' });
  wrap.appendChild(listHost);

  let current = [];
  const filtered = () => {
    const query = q.value.trim().toLowerCase();
    return mine.filter(d => {
      if (st && d.status !== st) return false;
      if (tp && d.type !== tp) return false;
      if (mt && d.method !== mt) return false;
      const dt = String(d.date).slice(0, 10);
      if (from && dt < from) return false;
      if (to && dt > to) return false;
      if (query && ![d.txnId, d.memberId, d.memberName, d.description, d.comment, String(d.amount)].some(x => String(x || '').toLowerCase().includes(query))) return false;
      return true;
    }).sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.submittedAt).localeCompare(String(a.submittedAt)));
  };

  const render = () => {
    current = filtered();
    const appr = current.filter(d => d.status === 'approved');
    const pend = current.filter(d => d.status === 'pending');
    const stats = el('div', { class: 'stats' });
    stats.append(
      statCard({ label: 'রেকর্ড', value: String(current.length), sub: 'ফিল্টার অনুযায়ী', ic: 'log', tone: 'gray' }),
      statCard({ label: 'অনুমোদিত জমা', value: taka(appr.reduce((x, d) => x + num(d.amount), 0)), sub: `${appr.length}টি এন্ট্রি`, ic: 'approve' }),
      statCard({ label: 'অপেক্ষমাণ', value: taka(pend.reduce((x, d) => x + num(d.amount), 0)), sub: `${pend.length}টি এন্ট্রি`, ic: 'pending', tone: 'amber' }),
    );
    sumHost.replaceChildren(card('সারসংক্ষেপ', 'Summary', stats));

    listHost.replaceChildren();
    if (!current.length) {
      const filteredOut = q.value.trim() || st || tp || mt || from || to;
      listHost.appendChild(emptyState({
        ic: 'receipt',
        title: t('কোনো জমা পাওয়া যায়নি', 'No deposit records found'),
        hint: filteredOut ? t('খোঁজ বা ফিল্টার বদলে আবার দেখুন', 'Try a different search or filter') : '',
      }));
      return;
    }
    if (window.matchMedia && matchMedia('(max-width: 767px)').matches) {
      current.forEach(d => listHost.appendChild(txnCard(d, {
        staff, typeBn: typeLabel(d.type).bn, actions: depositActions(session, d, staff),
      })));
    } else {
      listHost.appendChild(tableWrap(
        [{ label: 'Txn ID' }, { label: 'তারিখ' }, ...(staff ? [{ label: 'সদস্য' }] : []),
         { label: 'ধরন' }, { label: 'পদ্ধতি' }, { label: 'পরিমাণ', cls: 'num' },
         { label: 'বিবরণ' }, { label: 'স্ট্যাটাস' }, { label: 'অ্যাকশন', cls: 'nowrap' }],
        current.map(d => [
          { html: txnIdChip(d.txnId) },
          esc(fmtDate(d.date)),
          ...(staff ? [`<b>${esc(d.memberName)}</b><br><span class="faint fs8">${esc(d.memberId)}</span>`] : []),
          esc(typeLabel(d.type).bn),
          esc(methodLabel(d.method).bn),
          { text: money(d.amount), cls: 'num' },
          esc(d.description || '—'),
          { html: statusTag(d.status) },
          { node: depositActions(session, d, staff), cls: 'nowrap' },
        ]),
        {
          empty: t('কোনো জমা পাওয়া যায়নি', 'No deposit records found'),
          emptyIcon: 'receipt',
          footer: [
            { html: '' }, { html: 'সর্বমোট' }, ...(staff ? [{ html: '' }] : []), { html: '' }, { html: '' },
            { html: `<b>${money(current.reduce((x, d) => x + num(d.amount), 0))}</b>`, cls: 'num' }, { html: '' }, { html: '' }, { html: '' },
          ],
        },
      ));
    }
  };

  if (window.matchMedia) {
    const mq = matchMedia('(max-width: 767px)');
    const onBp = () => {
      if (!listHost.isConnected) { if (mq.removeEventListener) mq.removeEventListener('change', onBp); return; }
      render();
    };
    if (mq.addEventListener) mq.addEventListener('change', onBp);
  }

  q.addEventListener('input', debounce(render, 180));
  render();
  bindCopyIds(listHost);
  return wrap;
}

function viewDeposit(d) {
  return modal({
    title: `জমার বিবরণ / Deposit — ${d.memberId}`, width: 420,
    body: kv([
      [t('Transaction ID', 'Transaction ID'), `<b class="txn-id-static">${esc(d.txnId || '—')}</b>`],
      ['সদস্য', `<b>${esc(d.memberName)}</b> (${esc(d.memberId)})`],
      [t('পেমেন্ট তারিখ', 'Payment date'), esc(fmtDate(d.date))],
      ['ধরন', esc(typeLabel(d.type).bn)],
      ['পদ্ধতি', esc(methodLabel(d.method).bn)],
      ['পরিমাণ', `<b>${taka(d.amount)}</b>`],
      ['বিবরণ', esc(d.description || '')],
      ['মন্তব্য', esc(d.comment || '')],
      ['স্ট্যাটাস', statusTag(d.status)],
      ['দাখিল', `${esc(fmtDateTime(d.submittedAt))} <span class="faint">(${esc(d.submittedByRole || '')})</span>`],
      ['অনুমোদন', d.approvedAt ? esc(fmtDateTime(d.approvedAt)) : ''],
      ['বাতিলের কারণ', esc(d.rejectReason || '')],
      ['Sync', esc(d.syncStatus || 'local')],
    ]),
    actions: [{ label: t('বন্ধ করুন', 'Close'), value: true, kind: 'ghost' }],
  });
}

function editDeposit(session, d) {
  const body = el('div');
  body.innerHTML = `
    <form class="grid mform js-f" novalidate>
      <div class="grid g2">
        <div class="field"><label>সদস্য</label><input value="${esc(d.memberId)} — ${esc(d.memberName)}" readonly></div>
        <div class="field"><label>তারিখ <span class="req">*</span></label>
          <input name="date" type="date" value="${esc(String(d.date).slice(0, 10))}" ${session.role === 'maker' ? `min="${todayISO()}" max="${todayISO()}"` : ''}>
          <div class="hint">${esc(t('তারিখ বদলালে নতুন Transaction ID তৈরি হবে', 'changing the date re-stamps the transaction id'))}</div></div>
        <div class="field"><label>ধরন <span class="req">*</span></label>
          <select name="type">${DEPOSIT_TYPES.map(x => `<option value="${x.id}"${x.id === d.type ? ' selected' : ''}>${esc(x.bn)}</option>`).join('')}</select></div>
        <div class="field"><label>পদ্ধতি <span class="req">*</span></label>
          <select name="method">${PAY_METHODS.map(x => `<option value="${x.id}"${x.id === d.method ? ' selected' : ''}>${esc(x.bn)}</option>`).join('')}</select></div>
        <div class="field"><label>পরিমাণ (৳) <span class="req">*</span></label><input name="amount" type="number" min="1" step="0.01" value="${esc(d.amount)}"${d.type === 'monthly' ? ' readonly title="মাসিক চাঁদার হার স্থির"' : ''}></div>
        <div class="field"><label>বিবরণ</label><input name="description" value="${esc(d.description || '')}"></div>
      </div>
      <div class="field"><label>মন্তব্য (ঐচ্ছিক)</label><textarea name="comment" rows="2">${esc(d.comment || '')}</textarea></div>
      <div class="err js-err"></div>
    </form>`;
  const f = body.querySelector('.js-f');
  const errBox = body.querySelector('.js-err');
  return modal({
    title: 'জমা সম্পাদনা / Edit Deposit', body, width: 480,
    actions: [
      { label: t('ফিরে যান', 'Cancel'), value: null, kind: 'ghost' },
      {
        label: t('পরিবর্তন সংরক্ষণ', 'Save changes'), kind: 'primary', value: true,
        onClick: () => {
          const v = Object.fromEntries(new FormData(f).entries());
          errBox.textContent = '';
          if (!(num(v.amount) > 0)) { errBox.textContent = 'সঠিক পরিমাণ দিন'; return false; }
          if ((v.type === 'special' || v.type === 'other') && !String(v.description || '').trim()) { errBox.textContent = 'বিবরণ আবশ্যক'; return false; }
          updateDeposit(d.id, v, session)
            .then(() => { toast('জমা সংরক্ষণ হয়েছে / Deposit updated', 'success'); App.refresh(); })
            .catch(err => toast(err.message, 'error'));
          return true;
        },
      },
    ],
  });
}

/* ==================== Withdrawal entry + history ==================== */
export async function pageWithdrawal(session) {
  const [members, deposits, withdrawals, cfg] = await Promise.all([allMembers(), allDeposits(), allWithdrawals(), settings()]);
  const staff = session.role === 'admin' || session.role === 'maker';
  const wrap = page('উত্তোলন', 'Withdrawal', 'withdraw');

  let member = null;
  if (!staff) {
    member = members.find(m => m.id === session.memberDocId) || null;
    if (!member) { wrap.appendChild(banner('err', 'সদস্য প্রোফাইল পাওয়া যায়নি।')); return wrap; }
    if (member.status !== 'active') { wrap.appendChild(banner('warn', 'আপনার সদস্যপদ এখনো সক্রিয় নয়। উত্তোলনের জন্য সদস্যপদ সক্রিয় থাকতে হবে।')); return wrap; }
  }
  const activeMembers = members.filter(m => m.status === 'active');
  if (staff && !activeMembers.length) { wrap.appendChild(banner('warn', 'কোনো Active সদস্য নেই। / No active member yet.')); return wrap; }

  const infoHost = el('div');
  const form = el('form', { class: 'grid mform', novalidate: true });
  let picker = null;
  const memberField = staff ? '<div class="field js-pickhost"><label>সদস্য <span class="req">*</span></label></div>'
    : `<div class="field"><label>সদস্য</label><input value="${esc(member.memberId)} — ${esc(member.nameBn)}" readonly>
        <input type="hidden" name="memberDocId" value="${esc(member.id)}"></div>`;

  form.innerHTML = `
    <div class="grid g2">
      ${memberField}
      <div class="field"><label>তারিখ <span class="req">*</span></label>
        <input name="date" type="date" required value="${todayISO()}" ${session.role === 'maker' ? `max="${todayISO()}" min="${todayISO()}"` : ''}>
        <div class="err" data-err="date"></div></div>
    </div>
    <div class="field"><label>উত্তোলনের ধরন <span class="req">*</span></label><div class="js-type"></div></div>
    <div class="field"><label>পরিশোধ পদ্ধতি <span class="req">*</span></label><div class="js-method"></div></div>
    <div class="grid g2">
      <div class="field"><label>পরিমাণ (৳) <span class="req">*</span></label>
        <input name="amount" type="number" min="1" step="0.01" required inputmode="decimal" placeholder="0">
        <div class="hint">উপলব্ধ ব্যালান্সের বেশি উত্তোলন করা যাবে না</div>
        <div class="err" data-err="amount"></div></div>
      <div class="field"><label>বিবরণ (ঐচ্ছিক)</label><input name="description" placeholder="ঐচ্ছিক"></div>
    </div>
    <div class="field"><label>মন্তব্য (ঐচ্ছিক)</label><textarea name="comment" rows="2" placeholder="ঐচ্ছিক"></textarea></div>
    <div class="form-sticky">
      <button class="btn btn-ghost" type="reset">${icon('clear')}<span>${t('মুছুন', 'Clear')}</span></button>
      <button class="btn btn-danger" type="submit">${icon('upload')}<span>${staff ? t('উত্তোলন সংরক্ষণ', 'Save withdrawal') : t('উত্তোলনের আবেদন', 'Request withdrawal')}</span></button>
    </div>`;
  const typeSeg = optionGrid('type', WTYPE_OPTS, 'savings');
  const methodSeg = optionGrid('method', METHOD_OPTS, 'cash');
  form.querySelector('.js-type').appendChild(typeSeg.root);
  form.querySelector('.js-method').appendChild(methodSeg.root);

  const dateInp = form.elements.date;
  const dateFmt = el('div', { class: 'dfmt', text: dateInp.value ? fmtDate(dateInp.value) : '' });
  dateInp.insertAdjacentElement('afterend', dateFmt);
  dateInp.addEventListener('input', () => { dateFmt.textContent = dateInp.value ? fmtDate(dateInp.value) : ''; });

  const paintInfo = async () => {
    infoHost.replaceChildren();
    const id = form.elements.memberDocId ? form.elements.memberDocId.value : (picker ? picker.value : '');
    if (!id) return;
    const m = await getMember(id);
    if (!m) return;
    const bal = withdrawalBalance(m, deposits, withdrawals);
    const stats = el('div', { class: 'stats' });
    stats.append(
      statCard({ label: 'মোট জমা / Total Deposit', value: taka(bal.totalDeposit), sub: 'অনুমোদিত জমা', ic: 'deposit' }),
      statCard({ label: 'মোট উত্তোলন / Total Withdrawal', value: taka(bal.totalWithdrawal), sub: 'অনুমোদিত উত্তোলন', ic: 'upload', tone: 'red' }),
      statCard({ label: 'উপলব্ধ ব্যালান্স / Available', value: taka(bal.available), sub: 'উত্তোলনযোগ্য', ic: 'money', tone: 'blue' }),
    );
    infoHost.appendChild(card(staff ? 'ব্যালান্স' : 'আমার ব্যালান্স', staff ? `Balance — ${m.memberId}` : 'My Balance', stats));
  };
  if (staff) {
    picker = memberPicker({ members: activeMembers, onPick: () => paintInfo() });
    const host = form.querySelector('.js-pickhost');
    host.appendChild(picker.root);
    host.insertAdjacentHTML('beforeend', '<div class="err" data-err="memberDocId"></div>');
  }
  form.addEventListener('reset', () => setTimeout(() => {
    if (picker) picker.set('');
    typeSeg.reset(); methodSeg.reset();
    form.elements.date.value = todayISO();
    dateFmt.textContent = fmtDate(todayISO());
    paintInfo();
  }, 0));

  wrap.appendChild(infoHost);
  const entryCard = card(staff ? 'উত্তোলন এন্ট্রি' : 'উত্তোলনের আবেদন', staff ? 'Withdrawal Entry' : 'Withdrawal Request', form);
  if (staff) entryCard.classList.add('overflow-visible');
  wrap.appendChild(entryCard);
  await paintInfo();

  form.addEventListener('submit', async e => {
    e.preventDefault();
    form.querySelectorAll('.err').forEach(x => x.textContent = '');
    form.querySelectorAll('.field').forEach(x => x.classList.remove('bad'));
    const setErr = (n, msg) => { const b = form.querySelector(`[data-err="${n}"]`); if (b) { b.textContent = msg; b.closest('.field').classList.add('bad'); } };
    const v = Object.fromEntries(new FormData(form).entries());
    let bad = false;
    if (!v.memberDocId) { setErr('memberDocId', 'সদস্য নির্বাচন করুন'); bad = true; }
    if (!v.date) { setErr('date', 'তারিখ দিন'); bad = true; }
    if (!(num(v.amount) > 0)) { setErr('amount', 'উত্তোলনের পরিমাণ দিন'); bad = true; }
    if (bad) { toast('ফর্মে ত্রুটি রয়েছে', 'error'); return; }
    const b = form.querySelector('button[type=submit]'); b.disabled = true;
    try {
      const rec = await submitWithdrawal(v, session);
      await modal({
        title: t('উত্তোলন সফল', 'Withdrawal Successful'), width: 380,
        body: `<div class="success-pop"><div class="tick">${icon('check')}</div></div>
          <div class="kv">
            <div>Transaction ID</div><div><b class="txn-id-static">${esc(rec.txnId || '')}</b></div>
            <div>সদস্য</div><div><b>${esc(rec.memberName)}</b> (${esc(rec.memberId)})</div>
            <div>পরিমাণ</div><div><b style="color:var(--red-dark)">${taka(rec.amount)}</b></div>
            <div>স্ট্যাটাস</div><div>${statusTag(rec.status)}</div>
          </div>
          <div class="banner ${rec.status === 'approved' ? 'ok' : 'info'}" style="margin-top:9px">${icon('info')}<span>${
            rec.status === 'approved' ? 'উত্তোলন সফলভাবে সংরক্ষিত হয়েছে।' : 'আবেদন দাখিল হয়েছে। Maker/Admin অনুমোদনের পর ব্যালান্স থেকে বাদ যাবে।'}</span></div>`,
        actions: [{ label: t('ঠিক আছে', 'OK'), value: true, kind: 'primary' }],
      });
      form.reset();
      App.refresh();
    } catch (err) { toast(err.message, 'error'); }
    finally { b.disabled = false; }
  });

  /* --- history list --- */
  const mine = staff ? withdrawals : withdrawals.filter(w => w.memberDocId === session.memberDocId || w.memberId === session.memberId);
  const rows = mine.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.submittedAt).localeCompare(String(a.submittedAt)));
  const wActions = w => {
    const acts = el('div', { class: 'btn-row' });
    if (w.status === 'pending' && staff) {
      acts.appendChild(btn(t('অনুমোদন', 'Approve'), 'approve', 'soft', async () => {
        if (!(await confirmBox(`${w.memberName} — ${taka(w.amount)} উত্তোলন অনুমোদন করবেন?`, { okLabel: t('অনুমোদন', 'Approve') }))) return;
        await setWithdrawalStatus(w.id, 'approved', session); toast('উত্তোলন অনুমোদিত / Withdrawal approved', 'success'); App.refresh();
      }, { size: 'xs' }));
      acts.appendChild(btn(t('বাতিল', 'Reject'), 'reject', 'softred', async () => {
        const r = await rejectReason('উত্তোলন বাতিলের কারণ / Withdrawal Rejection Reason');
        if (r === null) return;
        await setWithdrawalStatus(w.id, 'rejected', session, r); toast('উত্তোলন বাতিল / Withdrawal rejected', 'warn'); App.refresh();
      }, { size: 'xs' }));
    }
    return acts;
  };
  const histHost = el('div', { class: 'person-list' });
  const paintHist = () => {
    histHost.replaceChildren();
    if (!rows.length) {
      histHost.appendChild(emptyState({ ic: 'withdraw', title: t('কোনো উত্তোলন নেই', 'No withdrawals') }));
      return;
    }
    if (window.matchMedia && matchMedia('(max-width: 767px)').matches) {
      rows.forEach(w => histHost.appendChild(txnCard(w, {
        staff, typeBn: withdrawalTypeLabel(w.type).bn, actions: wActions(w),
      })));
    } else {
      histHost.appendChild(tableWrap(
        [{ label: 'Txn ID' }, { label: 'তারিখ' }, ...(staff ? [{ label: 'সদস্য' }] : []), { label: 'ধরন' }, { label: 'পদ্ধতি' },
         { label: 'পরিমাণ', cls: 'num' }, { label: 'বিবরণ' }, { label: 'স্ট্যাটাস' }, { label: 'অ্যাকশন', cls: 'nowrap' }],
        rows.map(w => [
          { html: txnIdChip(w.txnId) },
          esc(fmtDate(w.date)),
          ...(staff ? [`<b>${esc(w.memberName)}</b><br><span class="faint fs8">${esc(w.memberId)}</span>`] : []),
          esc(withdrawalTypeLabel(w.type).bn), esc(methodLabel(w.method).bn),
          { text: money(w.amount), cls: 'num' }, esc(w.description || '—'),
          { html: statusTag(w.status) }, { node: wActions(w), cls: 'nowrap' },
        ]),
        { empty: t('কোনো উত্তোলন নেই', 'No withdrawals'), emptyIcon: 'withdraw' },
      ));
    }
    bindCopyIds(histHost);
  };
  if (window.matchMedia) {
    const mq = matchMedia('(max-width: 767px)');
    const onBp = () => {
      if (!histHost.isConnected) { if (mq.removeEventListener) mq.removeEventListener('change', onBp); return; }
      paintHist();
    };
    if (mq.addEventListener) mq.addEventListener('change', onBp);
  }
  wrap.appendChild(card('উত্তোলনের ইতিহাস', 'Withdrawal History', histHost));
  paintHist();
  return wrap;
}
