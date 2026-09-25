/* Deposits — ONE unified section for the whole deposit workflow.
 *
 *   #deposits            → summary + full-width actions + ONE records list
 *                          (every status: pending / approved / rejected)
 *   #deposits/new        → submit a deposit (the only place deposits are created)
 *   #deposits/withdraw   → withdrawal request/entry + its own list
 *
 * There is deliberately no separate “My Deposits”, “Approved Deposits” and
 * “Deposit History” screen any more: they were three views of the same data,
 * so the status filter inside the single list replaced all of them.
 *
 * All major actions are full-width — never a 2-column grid, never a FAB.
 */
import {
  el, esc, toast, taka, money, num, fmtDate, fmtDateTime, todayISO, modal, confirmBox,
  DEPOSIT_TYPES, PAY_METHODS, typeLabel, methodLabel, debounce, t, tx,
} from '../util.js';
import { icon } from '../icons.js';
import {
  page, card, tableWrap, statusTag, banner, btn, kv, statCard, emptyState, segChips,
  filterSheet, optionGrid, actionCard, sectionHead, txnIdChip, bindCopyIds,
} from '../ui.js';
import { memberPicker } from '../picker.js';
import {
  allMembers, allDeposits, allWithdrawals, settings, submitDeposit, memberSummary, setDepositStatus,
  canModifyDeposit, updateDeposit, deleteDeposit, getMember, submitWithdrawal, setWithdrawalStatus,
  summaryOpts, withdrawalBalance, WITHDRAWAL_TYPES, withdrawalTypeLabel,
} from '../store.js';
import { can } from '../auth.js';
import { App } from '../app.js';

/* ---- icon vocabulary for the option grids ---- */
const TYPE_ICON = { monthly: 'wallet', advance: 'advance', special: 'star', other: 'plus' };
const METHOD_ICON = { cash: 'money', mobile: 'phone', bank: 'building' };
const WTYPE_ICON = { savings: 'deposit', advance_refund: 'restore', other: 'withdraw' };

const TYPE_OPTS = DEPOSIT_TYPES.map(d => ({ value: d.id, bn: d.bn, en: d.en, ic: TYPE_ICON[d.id] || 'plus' }));
const METHOD_OPTS = PAY_METHODS.map(p => ({ value: p.id, bn: p.bn, en: p.en, ic: METHOD_ICON[p.id] || 'wallet' }));
const WTYPE_OPTS = WITHDRAWAL_TYPES.map(w => ({ value: w.id, bn: w.bn, en: w.en, ic: WTYPE_ICON[w.id] || 'withdraw' }));

const TYPE_SHORT = DEPOSIT_TYPES.map(d => ({ value: d.id, bn: d.bn, en: d.en }));
const METHOD_SHORT = PAY_METHODS.map(p => ({ value: p.id, bn: p.bn, en: p.en }));

const mine = (rows, session) => rows.filter(r =>
  r.memberDocId === session.memberDocId || (session.memberId && r.memberId === session.memberId));
const isStaff = session => session.role === 'admin' || session.role === 'maker';

/* ==================== the unified deposits screen ==================== */
export async function pageDeposits(session, params = {}) {
  const section = params.section || '';
  if (section === 'new') return depositEntry(session, params);
  if (section === 'withdraw') return withdrawalScreen(session);

  const staff = isStaff(session);
  const [members, deposits, withdrawals, cfg] = await Promise.all([
    allMembers(), allDeposits(), allWithdrawals(), settings(),
  ]);
  const wrap = page(t('জমা', 'Deposits'), 'Deposits', 'deposit');

  const myDeposits = staff ? deposits : mine(deposits, session);
  const approved = myDeposits.filter(d => d.status === 'approved');
  const pending = myDeposits.filter(d => d.status === 'pending');
  const rejected = myDeposits.filter(d => d.status === 'rejected');

  /* ---- summary (parallel figures → 2-column grid is appropriate) ---- */
  const sum = approved.reduce((a, d) => a + num(d.amount), 0);
  const stats = el('div', { class: 'stats' });
  if (staff) {
    const myW = withdrawals.filter(w => w.status === 'approved');
    stats.append(
      statCard({ label: t('মোট অনুমোদিত জমা', 'Approved deposits'), value: taka(sum), sub: `${approved.length} ${t('টি রেকর্ড', 'records')}`, ic: 'deposit' }),
      statCard({ label: t('মোট উত্তোলন', 'Withdrawals'), value: taka(myW.reduce((a, w) => a + num(w.amount), 0)), sub: `${myW.length} ${t('টি রেকর্ড', 'records')}`, ic: 'withdraw', tone: 'red' }),
      statCard({ label: t('অপেক্ষমাণ', 'Pending'), value: String(pending.length + withdrawals.filter(w => w.status === 'pending').length), sub: t('অনুমোদনের অপেক্ষায়', 'waiting for approval'), ic: 'pending', tone: 'amber' }),
      statCard({ label: t('বাতিল', 'Rejected'), value: String(rejected.length), sub: t('সর্বমোট', 'all time'), ic: 'reject', tone: 'gray' }),
    );
  } else {
    const m = members.find(x => x.id === session.memberDocId) || await getMember(session.memberDocId);
    const s = m ? memberSummary(m, deposits, summaryOpts(cfg, { withdrawals })) : null;
    stats.append(
      statCard({ label: t('আমার মোট জমা', 'My total deposit'), value: taka(sum), sub: `${approved.length} ${t('টি অনুমোদিত', 'approved')}`, ic: 'deposit' }),
      statCard({ label: t('অপেক্ষমাণ', 'Pending'), value: taka(pending.reduce((a, d) => a + num(d.amount), 0)), sub: `${pending.length} ${t('টি জমা', 'deposits')}`, ic: 'pending', tone: 'amber' }),
      statCard({ label: t('বকেয়া', 'Due'), value: taka(s ? s.due : 0), sub: t('অনুমোদিত জমার ভিত্তিতে', 'based on approved deposits'), ic: 'due', tone: s && s.due > 0 ? 'red' : '' }),
      statCard({ label: t('বাতিল', 'Rejected'), value: String(rejected.length), sub: t('সর্বমোট', 'all time'), ic: 'reject', tone: 'gray' }),
    );
  }
  wrap.appendChild(stats);

  /* ---- full-width actions: the deposit module never uses a 2-column grid ---- */
  wrap.appendChild(actionCard({
    label: t('নতুন জমা', 'New deposit'),
    sub: t('জমা দাখিল করুন', 'Submit a deposit'),
    ic: 'plus', tone: 'primary',
    onClick: () => App.go('deposits', 'new'),
  }));
  wrap.appendChild(actionCard({
    label: t('উত্তোলন', 'Withdrawal'),
    sub: staff ? t('উত্তোলন এন্ট্রি ও অনুমোদন', 'Withdrawal entry and approvals') : t('উত্তোলনের আবেদন করুন', 'Request a withdrawal'),
    ic: 'withdraw', tone: 'softred',
    badge: withdrawals.filter(w => w.status === 'pending' && (staff || mine([w], session).length)).length,
    onClick: () => App.go('deposits', 'withdraw'),
  }));

  /* ---- the ONE list (single source of truth for deposit records) ---- */
  wrap.appendChild(sectionHead(
    staff ? t('সব জমার রেকর্ড', 'All deposit records') : t('আমার জমাসমূহ', 'My deposits'),
    'Deposit records',
  ));

  let st = '', tp = '', mt = '', from = '', to = '', q = '';
  const head = el('div', { class: 'txn-head' });
  const searchBox = el('div', { class: 'search-box', html: icon('search') });
  const qEl = el('input', {
    type: 'search', placeholder: staff ? t('নাম / আইডি / বিবরণ…', 'Name / ID / note…') : t('বিবরণ / টাকা…', 'Note / amount…'),
    autocomplete: 'off', 'aria-label': t('জমা খুঁজুন', 'Search deposits'),
  });
  searchBox.appendChild(qEl);
  const filterBtn = el('button', { type: 'button', class: 'btn btn-ghost filter-btn', 'aria-label': t('ফিল্টার', 'Filter') });
  const paintBadge = () => {
    const n = [st, tp, mt, from, to].filter(Boolean).length;
    filterBtn.innerHTML = `${icon('filter')}<span>${esc(t('ফিল্টার', 'Filter'))}</span>${n ? `<span class="fbadge">${n}</span>` : ''}`;
  };
  paintBadge();
  filterBtn.addEventListener('click', () => filterSheet({
    state: { st, tp, mt, from, to },
    sections: [
      { key: 'tp', label: t('ধরন', 'Type'), options: [{ value: '', bn: 'সব', en: 'All' }, ...TYPE_SHORT] },
      { key: 'mt', label: t('পদ্ধতি', 'Method'), options: [{ value: '', bn: 'সব', en: 'All' }, ...METHOD_SHORT] },
    ],
    dates: { fromLabel: t('শুরু', 'From'), toLabel: t('শেষ', 'To') },
    onApply: x => { ({ tp, mt, from, to } = x); paintBadge(); render(); },
    onClear: () => { st = tp = mt = from = to = ''; paintBadge(); render(); },
  }));
  head.append(searchBox, filterBtn);
  wrap.appendChild(head);

  /* status chips — pending / approved / rejected live INSIDE this one list */
  const chips = segChips('depst', [
    { value: '', bn: 'সব', en: 'All' },
    { value: 'pending', bn: 'অপেক্ষমাণ', en: 'Pending' },
    { value: 'approved', bn: 'অনুমোদিত', en: 'Approved' },
    { value: 'rejected', bn: 'বাতিল', en: 'Rejected' },
  ], '', { onChange: v => { st = v; render(); } });
  chips.root.classList.add('chips-bar');
  wrap.appendChild(chips.root);

  const listHost = el('div', { class: 'person-list' });
  wrap.appendChild(listHost);

  const filtered = () => {
    const query = q.trim().toLowerCase();
    return myDeposits.filter(d => {
      if (st && d.status !== st) return false;
      if (tp && d.type !== tp) return false;
      if (mt && d.method !== mt) return false;
      const dt = String(d.date).slice(0, 10);
      if (from && dt < from) return false;
      if (to && dt > to) return false;
      if (query && ![d.txnId, d.memberId, d.memberName, d.description, d.comment, String(d.amount)]
        .some(v => String(v || '').toLowerCase().includes(query))) return false;
      return true;
    }).sort((a, b) => String(b.date).localeCompare(String(a.date))
      || String(b.submittedAt || '').localeCompare(String(a.submittedAt || '')));
  };

  function render() {
    const rows = filtered();
    listHost.replaceChildren();
    if (!rows.length) {
      listHost.appendChild(emptyState({
        ic: 'receipt',
        title: st === 'pending' ? t('কোনো অপেক্ষমাণ জমা নেই', 'No pending deposits')
          : st === 'approved' ? t('কোনো অনুমোদিত জমা নেই', 'No approved deposits')
          : st === 'rejected' ? t('কোনো বাতিল জমা নেই', 'No rejected deposits')
          : t('কোনো জমা নেই', 'No deposits yet'),
        hint: staff ? '' : t('“নতুন জমা” চেপে আপনার প্রথম জমা দাখিল করুন।', 'Tap “New deposit” to submit your first deposit.'),
        actionLabel: staff ? '' : t('নতুন জমা', 'New deposit'),
        onAction: staff ? null : () => App.go('deposits', 'new'),
      }));
      return;
    }
    rows.forEach(d => listHost.appendChild(depositRow(d, session, staff)));
  }

  qEl.addEventListener('input', debounce(() => { q = qEl.value.trim(); render(); }, 160));
  render();
  bindCopyIds(listHost);
  return wrap;
}

/** One deposit record — date first, amount and status, then the meta line. */
function depositRow(d, session, staff) {
  const row = el('div', { class: 'row rec' });
  const tone = d.status === 'approved' ? 'g' : d.status === 'pending' ? 'a' : 'r';
  const desc = d.description || tx(typeLabel(d.type).bn) || '';
  row.innerHTML = `<span class="rw-ic ${tone}">${icon(d.status === 'pending' ? 'clock' : d.status === 'approved' ? 'approve' : 'reject')}</span>
    <span class="rw-bd">
      <span class="rw-t"><b class="num">${esc(fmtDate(d.date))}</b> · <b class="num">${esc(taka(d.amount))}</b></span>
      <span class="rw-s">${esc(desc)}${d.method ? ` · ${esc(tx(methodLabel(d.method).bn))}` : ''}</span>
      ${staff ? `<span class="rw-m">${esc(d.memberName || '')}${d.memberId ? ` · ${esc(d.memberId)}` : ''}</span>` : ''}
      ${d.rejectReason ? `<span class="rw-m warn">${esc(d.rejectReason)}</span>` : ''}
    </span>
    <span class="rw-right">${statusTag(d.status)}</span>`;
  const acts = el('div', { class: 'row-acts' });
  const hit = el('button', { type: 'button', class: 'row-hit', 'aria-label': `${fmtDate(d.date)} ${taka(d.amount)}` });
  hit.addEventListener('click', () => depositDetail(d, session, staff));
  row.appendChild(hit);
  const actionBar = depositActions(session, d, staff);
  if (actionBar) { acts.appendChild(actionBar); row.appendChild(acts); }
  return row;
}

/* Actions live ONLY here and in Pending Requests (no duplicate screens). */
function depositActions(session, d, staff) {
  const acts = el('div', { class: 'btn-row row-actions' });
  if (d.status === 'pending' && can(session, 'deposit:approve')) {
    acts.appendChild(btn(t('অনুমোদন', 'Approve'), 'approve', 'soft', async () => {
      if (!(await confirmBox(t(`${d.memberName} — ${taka(d.amount)} জমাটি অনুমোদন করবেন?`, `Approve ${taka(d.amount)} from ${d.memberName}?`), { okLabel: t('অনুমোদন', 'Approve') }))) return;
      await setDepositStatus(d.id, 'approved', session);
      toast(t('জমা অনুমোদিত হয়েছে', 'Deposit approved'), 'success');
      App.refresh();
    }, { size: 'xs' }));
    acts.appendChild(btn(t('বাতিল', 'Reject'), 'reject', 'softred', async () => {
      const r = await rejectReason(t('জমা বাতিলের কারণ', 'Deposit rejection reason'));
      if (r === null) return;
      await setDepositStatus(d.id, 'rejected', session, r);
      toast(t('জমা বাতিল হয়েছে', 'Deposit rejected'), 'warn');
      App.refresh();
    }, { size: 'xs' }));
  }
  const perm = canModifyDeposit(d, session);
  if (staff && perm.ok) {
    acts.appendChild(btn(t('সম্পাদনা', 'Edit'), 'edit', 'ghost', () => editDeposit(session, d), { size: 'xs' }));
  }
  if (acts.children.length) return acts;
  return null;
}

/* ==================== deposit entry (the only create form) ==================== */
export async function depositEntry(session, params = {}) {
  const [members, deposits, cfg] = await Promise.all([allMembers(), allDeposits(), settings()]);
  const staff = isStaff(session);
  const wrap = page(t('নতুন জমা', 'New deposit'), 'Submit Deposit', 'plus');

  let member = null;
  if (!staff) {
    member = members.find(m => m.id === session.memberDocId) || null;
    if (!member) { wrap.appendChild(banner('err', esc(t('সদস্য প্রোফাইল পাওয়া যায়নি।', 'Member profile not found.')))); return wrap; }
    if (member.status !== 'active') {
      wrap.appendChild(banner('warn', `${esc(t('আপনার সদস্যপদ এখনো সক্রিয় নয়', 'Your membership is not active yet'))} — ${statusTag(member.status)}`));
      return wrap;
    }
  }

  const activeMembers = members.filter(m => m.status === 'active');
  if (staff && !activeMembers.length) {
    wrap.appendChild(banner('warn', esc(t('কোনো সক্রিয় সদস্য নেই — প্রথমে সদস্য অনুমোদন করুন।', 'No active member yet — approve a member first.'))));
    return wrap;
  }

  const infoHost = el('div');
  const form = el('form', { class: 'grid mform', novalidate: true });
  let picker = null;

  const memberField = staff
    ? `<div class="field js-pickhost"><label>${esc(t('সদস্য', 'Member'))} <span class="req">*</span></label></div>`
    : `<div class="field"><label>${esc(t('সদস্য', 'Member'))}</label>
        <input value="${esc(member.memberId)} — ${esc(member.nameBn || member.nameEn)}" readonly>
        <input type="hidden" name="memberDocId" value="${esc(member.id)}"></div>`;

  form.innerHTML = `
    ${memberField}
    <div class="field"><label>${esc(t('তারিখ (পেমেন্টের দিন)', 'Date (payment date)'))} <span class="req">*</span></label>
      <input name="date" type="date" required value="${todayISO()}" ${session.role === 'maker' ? `max="${todayISO()}" min="${todayISO()}"` : ''}>
      ${session.role === 'maker' ? `<div class="hint">${esc(t('মেকার শুধুমাত্র আজকের তারিখে এন্ট্রি করতে পারেন', 'Makers can only enter today’s date'))}</div>` : ''}
      <div class="dfmt"></div>
      <div class="err" data-err="date"></div></div>
    <div class="field"><label>${esc(t('জমার ধরন', 'Deposit type'))} <span class="req">*</span></label><div class="js-type"></div></div>
    <div class="field"><label>${esc(t('পরিশোধ পদ্ধতি', 'Payment method'))} <span class="req">*</span></label><div class="js-method"></div></div>
    <div class="field js-amount"><label>${esc(t('পরিমাণ (৳)', 'Amount (৳)'))} <span class="req">*</span></label>
      <input name="amount" type="number" min="1" step="0.01" required inputmode="decimal" placeholder="0">
      <div class="hint">${esc(t('যেকোনো পরিমাণ গ্রহণযোগ্য', 'Any amount is accepted'))}</div>
      <div class="err" data-err="amount"></div></div>
    <div class="field js-fixed" hidden><label>${esc(t('মাসিক চাঁদা', 'Monthly contribution'))} <span class="req">*</span></label>
      <div class="fixed-amt"><b class="num">৳0</b><span>${esc(t('নির্ধারিত — পরিবর্তনযোগ্য নয়', 'fixed — cannot be changed'))}</span></div>
      <div class="hint">${esc(t('সদস্যের নির্ধারিত কিস্তি অনুযায়ী', 'taken from the member’s monthly installment'))}</div></div>
    <div class="field js-desc" hidden><label>${esc(t('বিবরণ', 'Description'))} <span class="req">*</span></label>
      <input name="description" placeholder="${esc(t('বিশেষ চাঁদা / অন্যান্য জমার বিবরণ', 'Special contribution / other deposit note'))}">
      <div class="err" data-err="description"></div></div>
    <div class="field"><label>${esc(t('মন্তব্য (ঐচ্ছিক)', 'Comment (optional)'))}</label>
      <textarea name="comment" rows="2" placeholder="${esc(t('ঐচ্ছিক', 'Optional'))}"></textarea></div>
    <div class="form-sticky">
      <button class="btn btn-ghost" type="reset">${icon('clear')}<span>${esc(t('মুছুন', 'Clear'))}</span></button>
      <button class="btn btn-primary" type="submit">${icon('save')}<span>${esc(staff ? t('জমা যোগ করুন', 'Add deposit') : t('জমা দাখিল করুন', 'Submit deposit'))}</span></button>
    </div>`;

  const typeSeg = optionGrid('type', TYPE_OPTS, 'monthly', { onChange: syncForm });
  const methodSeg = optionGrid('method', METHOD_OPTS, 'cash');
  form.querySelector('.js-type').appendChild(typeSeg.root);
  form.querySelector('.js-method').appendChild(methodSeg.root);

  const amountField = form.querySelector('.js-amount');
  const fixedField = form.querySelector('.js-fixed');
  const fixedVal = fixedField.querySelector('b');
  const amountInp = form.elements.amount;
  const descField = form.querySelector('.js-desc');
  let currentInstallment = num(staff ? (cfg.defaultInstallment || 0) : (member && member.installment));

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
    } else {
      if (amountInp.readOnly) amountInp.value = '';
      amountInp.readOnly = false;
      amountInp.required = true;
    }
    const need = form.elements.type.value === 'special' || form.elements.type.value === 'other';
    descField.hidden = !need;
    if (!need) form.elements.description.value = '';
  }

  const paintInfo = async () => {
    infoHost.replaceChildren();
    const id = staff ? (picker ? picker.value : '') : member.id;
    if (!id) return;
    const m = members.find(x => x.id === id) || await getMember(id);
    if (!m) return;
    currentInstallment = num(m.installment);
    const s = memberSummary(m, deposits, summaryOpts(cfg));
    const stats = el('div', { class: 'stats' });
    stats.append(
      statCard({ label: t('মাসিক কিস্তি', 'Monthly installment'), value: taka(m.installment), sub: `${s.months} ${t('মাস হিসাবযোগ্য', 'months counted')}`, ic: 'wallet' }),
      statCard({ label: t('মোট জমা', 'Total deposit'), value: taka(s.totalDeposit), sub: `${s.count} ${t('টি অনুমোদিত', 'approved')}`, ic: 'deposit' }),
      statCard({ label: t('বকেয়া', 'Due'), value: taka(s.due), sub: `${t('প্রয়োজন', 'required')} ${taka(s.required)}`, ic: 'due', tone: s.due > 0 ? 'red' : '' }),
      statCard({ label: t('অগ্রিম', 'Advance'), value: taka(s.advance), sub: s.advance > 0 ? t('অতিরিক্ত জমা', 'extra paid') : '—', ic: 'advance', tone: 'blue' }),
    );
    infoHost.appendChild(card(
      staff ? t('সদস্য সারসংক্ষেপ', 'Member summary') : t('আমার সারাংশ', 'My summary'),
      staff ? `Member ${m.memberId}` : 'Summary', stats,
    ));
    syncForm();
  };

  if (staff) {
    picker = memberPicker({ members: activeMembers, value: params.memberDocId || '', onPick: () => paintInfo() });
    const host = form.querySelector('.js-pickhost');
    host.appendChild(picker.root);
    host.insertAdjacentHTML('beforeend', '<div class="err" data-err="memberDocId"></div>');
    if (params.memberDocId) await paintInfo();
  } else {
    await paintInfo();
  }

  const dateInp = form.elements.date;
  const dateFmt = form.querySelector('.dfmt');
  const paintDate = () => { dateFmt.textContent = dateInp.value ? fmtDate(dateInp.value) : ''; };
  dateInp.addEventListener('input', paintDate);
  paintDate();

  wrap.appendChild(infoHost);
  const entryCard = card(
    staff ? t('জমার তথ্য', 'Deposit details') : t('জমা দাখিল', 'Submit deposit'),
    'Deposit form', form,
  );
  entryCard.classList.add('overflow-visible');
  wrap.appendChild(entryCard);

  form.addEventListener('reset', () => setTimeout(() => {
    if (picker) picker.set(params.memberDocId || '');
    typeSeg.reset(); methodSeg.reset();
    dateInp.value = todayISO(); paintDate();
    syncForm(); paintInfo();
  }, 0));

  form.addEventListener('submit', async e => {
    e.preventDefault();
    form.querySelectorAll('.err').forEach(x => x.textContent = '');
    form.querySelectorAll('.field').forEach(x => x.classList.remove('bad'));
    const setErr = (n, msg) => {
      const b = form.querySelector(`[data-err="${n}"]`);
      if (b) { b.textContent = msg; b.closest('.field').classList.add('bad'); }
    };
    const v = Object.fromEntries(new FormData(form).entries());
    const monthly = v.type === 'monthly';
    let bad = false;
    if (!v.memberDocId) { setErr('memberDocId', t('সদস্য নির্বাচন করুন', 'Select a member')); bad = true; }
    if (!v.date) { setErr('date', t('তারিখ দিন', 'Enter a date')); bad = true; }
    if (!monthly && !(num(v.amount) > 0)) { setErr('amount', t('জমার পরিমাণ দিন', 'Enter the amount')); bad = true; }
    if (monthly && !(currentInstallment > 0)) { setErr('amount', t('সদস্যের মাসিক কিস্তি নির্ধারিত নেই', 'The member has no monthly installment')); bad = true; }
    if ((v.type === 'special' || v.type === 'other') && !String(v.description || '').trim()) { setErr('description', t('বিবরণ আবশ্যক', 'Description is required')); bad = true; }
    if (session.role === 'maker' && v.date !== todayISO()) { setErr('date', t('মেকার শুধুমাত্র আজকের তারিখ ব্যবহার করতে পারেন', 'Makers can only use today’s date')); bad = true; }
    if (bad) { toast(t('ফর্মে ত্রুটি রয়েছে', 'Please fix the highlighted fields'), 'error'); return; }

    const b = form.querySelector('button[type=submit]');
    b.disabled = true;
    try {
      const rec = await submitDeposit({ ...v, amount: monthly ? currentInstallment : v.amount }, session);
      await depositSuccess(rec);
      form.reset();
    } catch (err) { toast(err.message, 'error'); }
    finally { b.disabled = false; }
  });
  return wrap;
}

function depositSuccess(rec) {
  return modal({
    title: t('জমা সফল হয়েছে', 'Deposit submitted'), width: 400,
    body: `<div class="success-pop"><div class="tick">${icon('check')}</div></div>
      <div class="kv">
        <div>${esc(t('লেনদেন আইডি', 'Transaction ID'))}</div><div><b class="txn-id-static">${esc(rec.txnId || '')}</b></div>
        <div>${esc(t('সদস্য', 'Member'))}</div><div><b>${esc(rec.memberName || '')}</b> (${esc(rec.memberId || '')})</div>
        <div>${esc(t('তারিখ', 'Date'))}</div><div>${esc(fmtDate(rec.date))}</div>
        <div>${esc(t('ধরন', 'Type'))}</div><div>${esc(tx(typeLabel(rec.type).bn))}</div>
        <div>${esc(t('পদ্ধতি', 'Method'))}</div><div>${esc(tx(methodLabel(rec.method).bn))}</div>
        <div>${esc(t('পরিমাণ', 'Amount'))}</div><div><b style="color:var(--green-dark)">${taka(rec.amount)}</b></div>
        <div>${esc(t('স্ট্যাটাস', 'Status'))}</div><div>${statusTag(rec.status)}</div>
      </div>
      <div class="banner ${rec.status === 'approved' ? 'ok' : 'info'}" style="margin-top:9px">${icon('info')}<span>${
        rec.status === 'approved'
          ? esc(t('জমা সংরক্ষিত ও অনুমোদিত হয়েছে।', 'The deposit was saved and approved.'))
          : esc(t('জমা দাখিল হয়েছে। অনুমোদনের পর হিসাবে যুক্ত হবে।', 'Submitted. It will be added to the account once approved.'))}</span></div>`,
    actions: [{ label: t('ঠিক আছে', 'OK'), value: true, kind: 'primary' }],
  });
}

function depositDetail(d, session, staff) {
  return modal({
    title: t('জমার বিবরণ', 'Deposit details'), width: 420,
    body: kv([
      [t('লেনদেন আইডি', 'Transaction ID'), `<b class="txn-id-static">${esc(d.txnId || '—')}</b>`],
      [t('সদস্য', 'Member'), `<b>${esc(d.memberName || '')}</b> (${esc(d.memberId || '')})`],
      [t('পেমেন্ট তারিখ', 'Payment date'), esc(fmtDate(d.date))],
      [t('ধরন', 'Type'), esc(tx(typeLabel(d.type).bn))],
      [t('পদ্ধতি', 'Method'), esc(tx(methodLabel(d.method).bn))],
      [t('পরিমাণ', 'Amount'), `<b>${taka(d.amount)}</b>`],
      [t('বিবরণ', 'Description'), esc(d.description || '')],
      [t('মন্তব্য', 'Comment'), esc(d.comment || '')],
      [t('স্ট্যাটাস', 'Status'), statusTag(d.status)],
      [t('দাখিল', 'Submitted'), esc(fmtDateTime(d.submittedAt))],
      [t('অনুমোদিত', 'Approved'), d.approvedAt ? esc(fmtDateTime(d.approvedAt)) : ''],
      [t('বাতিলের কারণ', 'Rejection reason'), esc(d.rejectReason || '')],
    ]),
    actions: [
      ...(staff && canModifyDeposit(d, session).ok
        ? [{ label: t('সম্পাদনা', 'Edit'), value: null, kind: 'ghost', onClick: () => { editDeposit(session, d); return true; } }]
        : []),
      { label: t('বন্ধ করুন', 'Close'), value: true, kind: 'primary' },
    ],
  });
}

function editDeposit(session, d) {
  const body = el('div');
  body.innerHTML = `
    <form class="grid mform js-f" novalidate>
      <div class="field"><label>${esc(t('সদস্য', 'Member'))}</label><input value="${esc(d.memberId)} — ${esc(d.memberName)}" readonly></div>
      <div class="grid g2">
        <div class="field"><label>${esc(t('তারিখ', 'Date'))} <span class="req">*</span></label>
          <input name="date" type="date" value="${esc(String(d.date).slice(0, 10))}" ${session.role === 'maker' ? `min="${todayISO()}" max="${todayISO()}"` : ''}>
          <div class="hint">${esc(t('তারিখ বদলালে নতুন লেনদেন আইডি তৈরি হবে', 'Changing the date re-stamps the transaction ID'))}</div></div>
        <div class="field"><label>${esc(t('ধরন', 'Type'))} <span class="req">*</span></label>
          <select name="type">${DEPOSIT_TYPES.map(x => `<option value="${x.id}"${x.id === d.type ? ' selected' : ''}>${esc(tx(x.bn))}</option>`).join('')}</select></div>
        <div class="field"><label>${esc(t('পদ্ধতি', 'Method'))} <span class="req">*</span></label>
          <select name="method">${PAY_METHODS.map(x => `<option value="${x.id}"${x.id === d.method ? ' selected' : ''}>${esc(tx(x.bn))}</option>`).join('')}</select></div>
        <div class="field"><label>${esc(t('পরিমাণ (৳)', 'Amount (৳)'))} <span class="req">*</span></label>
          <input name="amount" type="number" min="1" step="0.01" value="${esc(d.amount)}"></div>
      </div>
      <div class="field"><label>${esc(t('বিবরণ', 'Description'))}</label><input name="description" value="${esc(d.description || '')}"></div>
      <div class="field"><label>${esc(t('মন্তব্য (ঐচ্ছিক)', 'Comment (optional)'))}</label><textarea name="comment" rows="2">${esc(d.comment || '')}</textarea></div>
      <div class="err js-err"></div>
    </form>`;
  const f = body.querySelector('.js-f');
  const errBox = body.querySelector('.js-err');
  return modal({
    title: t('জমা সম্পাদনা', 'Edit deposit'), body, width: 480,
    actions: [
      { label: t('বাতিল', 'Cancel'), value: null, kind: 'ghost' },
      {
        label: t('সংরক্ষণ করুন', 'Save changes'), kind: 'primary', value: true,
        onClick: () => {
          const v = Object.fromEntries(new FormData(f).entries());
          errBox.textContent = '';
          if (!(num(v.amount) > 0)) { errBox.textContent = t('সঠিক পরিমাণ দিন', 'Enter a valid amount'); return false; }
          if ((v.type === 'special' || v.type === 'other') && !String(v.description || '').trim()) { errBox.textContent = t('বিবরণ আবশ্যক', 'Description is required'); return false; }
          updateDeposit(d.id, v, session)
            .then(() => { toast(t('জমা সংরক্ষিত হয়েছে', 'Deposit updated'), 'success'); App.refresh(); })
            .catch(err => toast(err.message, 'error'));
          return true;
        },
      },
    ],
  });
}

/* ==================== withdrawal (entry + list) ==================== */
export async function withdrawalScreen(session) {
  const [members, deposits, withdrawals, cfg] = await Promise.all([
    allMembers(), allDeposits(), allWithdrawals(), settings(),
  ]);
  const staff = isStaff(session);
  const wrap = page(t('উত্তোলন', 'Withdrawal'), 'Withdrawal', 'withdraw');

  let member = null;
  if (!staff) {
    member = members.find(m => m.id === session.memberDocId) || null;
    if (!member) { wrap.appendChild(banner('err', esc(t('সদস্য প্রোফাইল পাওয়া যায়নি।', 'Member profile not found.')))); return wrap; }
  }
  const activeMembers = members.filter(m => m.status === 'active');

  if (member) {
    const bal = withdrawalBalance(member, deposits, withdrawals);
    const stats = el('div', { class: 'stats' });
    stats.append(
      statCard({ label: t('মোট জমা', 'Total deposit'), value: taka(bal.totalDeposit), sub: t('অনুমোদিত', 'approved'), ic: 'deposit' }),
      statCard({ label: t('উপলব্ধ ব্যালান্স', 'Available balance'), value: taka(bal.available), sub: t('উত্তোলনযোগ্য', 'withdrawable'), ic: 'money', tone: 'blue' }),
    );
    wrap.appendChild(stats);
  }

  const infoHost = el('div');
  const form = el('form', { class: 'grid mform', novalidate: true });
  let picker = null;
  const memberField = staff
    ? `<div class="field js-pickhost"><label>${esc(t('সদস্য', 'Member'))} <span class="req">*</span></label></div>`
    : `<div class="field"><label>${esc(t('সদস্য', 'Member'))}</label>
        <input value="${esc(member.memberId)} — ${esc(member.nameBn || member.nameEn)}" readonly>
        <input type="hidden" name="memberDocId" value="${esc(member.id)}"></div>`;

  form.innerHTML = `
    ${memberField}
    <div class="field"><label>${esc(t('তারিখ', 'Date'))} <span class="req">*</span></label>
      <input name="date" type="date" required value="${todayISO()}" ${session.role === 'maker' ? `max="${todayISO()}" min="${todayISO()}"` : ''}>
      <div class="dfmt"></div><div class="err" data-err="date"></div></div>
    <div class="field"><label>${esc(t('উত্তোলনের ধরন', 'Withdrawal type'))} <span class="req">*</span></label><div class="js-type"></div></div>
    <div class="field"><label>${esc(t('পরিশোধ পদ্ধতি', 'Payment method'))} <span class="req">*</span></label><div class="js-method"></div></div>
    <div class="field"><label>${esc(t('পরিমাণ (৳)', 'Amount (৳)'))} <span class="req">*</span></label>
      <input name="amount" type="number" min="1" step="0.01" required inputmode="decimal" placeholder="0">
      <div class="hint">${esc(t('উপলব্ধ ব্যালান্সের বেশি উত্তোলন করা যাবে না', 'You cannot withdraw more than the available balance'))}</div>
      <div class="err" data-err="amount"></div></div>
    <div class="field"><label>${esc(t('বিবরণ (ঐচ্ছিক)', 'Description (optional)'))}</label><input name="description"></div>
    <div class="field"><label>${esc(t('মন্তব্য (ঐচ্ছিক)', 'Comment (optional)'))}</label><textarea name="comment" rows="2"></textarea></div>
    <div class="form-sticky">
      <button class="btn btn-ghost" type="reset">${icon('clear')}<span>${esc(t('মুছুন', 'Clear'))}</span></button>
      <button class="btn btn-danger" type="submit">${icon('upload')}<span>${esc(staff ? t('উত্তোলন সংরক্ষণ', 'Save withdrawal') : t('উত্তোলনের আবেদন', 'Request withdrawal'))}</span></button>
    </div>`;

  const typeSeg = optionGrid('type', WTYPE_OPTS, 'savings');
  const methodSeg = optionGrid('method', METHOD_OPTS, 'cash');
  form.querySelector('.js-type').appendChild(typeSeg.root);
  form.querySelector('.js-method').appendChild(methodSeg.root);

  const dateInp = form.elements.date;
  const dateFmt = form.querySelector('.dfmt');
  const paintDate = () => { dateFmt.textContent = dateInp.value ? fmtDate(dateInp.value) : ''; };
  dateInp.addEventListener('input', paintDate);
  paintDate();

  const paintInfo = async () => {
    infoHost.replaceChildren();
    const id = staff ? (picker ? picker.value : '') : member.id;
    if (!id) return;
    const m = members.find(x => x.id === id) || await getMember(id);
    if (!m) return;
    const bal = withdrawalBalance(m, deposits, withdrawals);
    const stats = el('div', { class: 'stats' });
    stats.append(
      statCard({ label: t('মোট জমা', 'Total deposit'), value: taka(bal.totalDeposit), sub: t('অনুমোদিত', 'approved'), ic: 'deposit' }),
      statCard({ label: t('মোট উত্তোলন', 'Total withdrawal'), value: taka(bal.totalWithdrawal), sub: t('অনুমোদিত', 'approved'), ic: 'upload', tone: 'red' }),
      statCard({ label: t('উপলব্ধ ব্যালান্স', 'Available balance'), value: taka(bal.available), sub: t('উত্তোলনযোগ্য', 'withdrawable'), ic: 'money', tone: 'blue' }),
    );
    infoHost.appendChild(card(t('ব্যালান্স', 'Balance'), `Member ${m.memberId}`, stats));
  };
  if (staff) {
    if (!activeMembers.length) { wrap.appendChild(banner('warn', esc(t('কোনো সক্রিয় সদস্য নেই।', 'No active member yet.')))); return wrap; }
    picker = memberPicker({ members: activeMembers, onPick: () => paintInfo() });
    const host = form.querySelector('.js-pickhost');
    host.appendChild(picker.root);
    host.insertAdjacentHTML('beforeend', '<div class="err" data-err="memberDocId"></div>');
  }
  form.addEventListener('reset', () => setTimeout(() => {
    if (picker) picker.set('');
    typeSeg.reset(); methodSeg.reset();
    dateInp.value = todayISO(); paintDate();
    paintInfo();
  }, 0));

  wrap.appendChild(infoHost);
  if (!staff) await paintInfo();
  const entryCard = card(
    staff ? t('উত্তোলন এন্ট্রি', 'Withdrawal entry') : t('উত্তোলনের আবেদন', 'Withdrawal request'),
    'Withdrawal', form,
  );
  entryCard.classList.add('overflow-visible');
  wrap.appendChild(entryCard);

  form.addEventListener('submit', async e => {
    e.preventDefault();
    form.querySelectorAll('.err').forEach(x => x.textContent = '');
    form.querySelectorAll('.field').forEach(x => x.classList.remove('bad'));
    const setErr = (n, msg) => {
      const b = form.querySelector(`[data-err="${n}"]`);
      if (b) { b.textContent = msg; b.closest('.field').classList.add('bad'); }
    };
    const v = Object.fromEntries(new FormData(form).entries());
    let bad = false;
    if (!v.memberDocId) { setErr('memberDocId', t('সদস্য নির্বাচন করুন', 'Select a member')); bad = true; }
    if (!v.date) { setErr('date', t('তারিখ দিন', 'Enter a date')); bad = true; }
    if (!(num(v.amount) > 0)) { setErr('amount', t('উত্তোলনের পরিমাণ দিন', 'Enter the amount')); bad = true; }
    if (bad) { toast(t('ফর্মে ত্রুটি রয়েছে', 'Please fix the highlighted fields'), 'error'); return; }
    const b = form.querySelector('button[type=submit]');
    b.disabled = true;
    try {
      const rec = await submitWithdrawal(v, session);
      await modal({
        title: t('উত্তোলনের আবেদন দাখিল হয়েছে', 'Withdrawal saved'), width: 380,
        body: `<div class="success-pop"><div class="tick">${icon('check')}</div></div>
          <div class="kv">
            <div>${esc(t('লেনদেন আইডি', 'Transaction ID'))}</div><div><b class="txn-id-static">${esc(rec.txnId || '')}</b></div>
            <div>${esc(t('সদস্য', 'Member'))}</div><div><b>${esc(rec.memberName || '')}</b> (${esc(rec.memberId || '')})</div>
            <div>${esc(t('পরিমাণ', 'Amount'))}</div><div><b style="color:var(--red-dark)">${taka(rec.amount)}</b></div>
            <div>${esc(t('স্ট্যাটাস', 'Status'))}</div><div>${statusTag(rec.status)}</div>
          </div>`,
        actions: [{ label: t('ঠিক আছে', 'OK'), value: true, kind: 'primary' }],
      });
      form.reset();
      App.refresh();
    } catch (err) { toast(err.message, 'error'); }
    finally { b.disabled = false; }
  });

  /* ---- the withdrawal list (same screen, no second page) ---- */
  const rows = (staff ? withdrawals : mine(withdrawals, session)).slice()
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.submittedAt || '').localeCompare(String(a.submittedAt || '')));
  wrap.appendChild(sectionHead(
    staff ? t('সব উত্তোলন', 'All withdrawals') : t('আমার উত্তোলন', 'My withdrawals'),
    'Withdrawal records',
  ));
  const listHost = el('div', { class: 'person-list' });
  if (!rows.length) {
    listHost.appendChild(emptyState({ ic: 'withdraw', title: t('কোনো উত্তোলন নেই', 'No withdrawals yet') }));
  } else {
    rows.forEach(w => {
      const tone = w.status === 'approved' ? 'r' : w.status === 'pending' ? 'a' : 'g';
      const rec = el('div', { class: 'row rec' });
      rec.innerHTML = `<span class="rw-ic ${tone}">${icon('withdraw')}</span>
        <span class="rw-bd">
          <span class="rw-t"><b class="num">${esc(fmtDate(w.date))}</b> · <b class="num due-amt">${esc(taka(w.amount))}</b></span>
          <span class="rw-s">${esc(tx(withdrawalTypeLabel(w.type).bn))}${w.description ? ` · ${esc(w.description)}` : ''}</span>
          ${staff ? `<span class="rw-m">${esc(w.memberName || '')}${w.memberId ? ` · ${esc(w.memberId)}` : ''}</span>` : ''}
        </span>
        <span class="rw-right">${statusTag(w.status)}</span>`;
      if (w.status === 'pending' && staff) {
        const acts = el('div', { class: 'row-acts' });
        const bar = el('div', { class: 'btn-row' });
        bar.appendChild(btn(t('অনুমোদন', 'Approve'), 'approve', 'soft', async () => {
          if (!(await confirmBox(t(`${w.memberName} — ${taka(w.amount)} উত্তোলন অনুমোদন করবেন?`, `Approve the withdrawal of ${taka(w.amount)} for ${w.memberName}?`), { okLabel: t('অনুমোদন', 'Approve') }))) return;
          await setWithdrawalStatus(w.id, 'approved', session);
          toast(t('উত্তোলন অনুমোদিত হয়েছে', 'Withdrawal approved'), 'success');
          App.refresh();
        }, { size: 'xs' }));
        bar.appendChild(btn(t('বাতিল', 'Reject'), 'reject', 'softred', async () => {
          const r = await rejectReason(t('উত্তোলন বাতিলের কারণ', 'Withdrawal rejection reason'));
          if (r === null) return;
          await setWithdrawalStatus(w.id, 'rejected', session, r);
          toast(t('উত্তোলন বাতিল হয়েছে', 'Withdrawal rejected'), 'warn');
          App.refresh();
        }, { size: 'xs' }));
        acts.appendChild(bar);
        rec.appendChild(acts);
      }
      listHost.appendChild(rec);
    });
  }
  wrap.appendChild(listHost);
  bindCopyIds(listHost);
  return wrap;
}

/** Rejection-reason prompt (shared with Approvals). */
export function rejectReason(title = '') {
  const title2 = title || t('বাতিলের কারণ', 'Rejection reason');
  const body = el('div', { class: 'grid' });
  body.innerHTML = `<div class="field"><label>${esc(t('কারণ', 'Reason'))} <span class="req">*</span></label>
      <textarea name="reason" rows="3" placeholder="${esc(t('কারণ লিখুন…', 'Write the reason…'))}"></textarea>
      <div class="err js-e"></div></div>`;
  return modal({
    title: title2, body, width: 420,
    actions: [
      { label: t('বাতিল করুন', 'Cancel'), value: null, kind: 'ghost' },
      {
        label: t('প্রত্যাখ্যান', 'Reject'), kind: 'danger', value: true,
        onClick: () => {
          const v = body.querySelector('textarea').value.trim();
          if (!v) { body.querySelector('.js-e').textContent = t('কারণ আবশ্যক', 'A reason is required'); return false; }
          return v;
        },
      },
    ],
  }).then(v => (typeof v === 'string' ? v : null));
}

/* ---- back-compat aliases (older deep links) ---- */
export const pageDepositsHub = pageDeposits;
export const pageDepositEntry = depositEntry;
export const pageWithdrawal = withdrawalScreen;
export const pageMyDeposits = pageDeposits;
export const pageDepositHistory = pageDeposits;
