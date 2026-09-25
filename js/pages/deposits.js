/* Money Management (deposit entry) + Deposit History */
import {
  el, esc, toast, taka, money, num, fmtDate, fmtDateTime, todayISO, modal, confirmBox,
  DEPOSIT_TYPES, PAY_METHODS, typeLabel, methodLabel, debounce, monthKey, t,
} from '../util.js';
import { icon } from '../icons.js';
import { page, card, tableWrap, statusTag, banner, btn, kv, statCard, tabs, embedPage, emptyState, segChips, filterSheet } from '../ui.js';
import { memberPicker } from '../picker.js';
import {
  allMembers, allDeposits, allWithdrawals, settings, submitDeposit, memberSummary, setDepositStatus,
  canModifyDeposit, updateDeposit, deleteDeposit, getMember, submitWithdrawal, setWithdrawalStatus, summaryOpts,
  withdrawalBalance, WITHDRAWAL_TYPES, withdrawalTypeLabel,
} from '../store.js';
import { can } from '../auth.js';
import { App } from '../app.js';
import { rejectReason } from './members.js';
import { downloadCSV, downloadExcel, safeName } from '../pdf.js';

/* Short chip labels (full option adjectives stay in tables/modals). */
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
const WTYPE_SHORT = [
  { value: 'savings', bn: 'সঞ্চয়', en: 'Savings' },
  { value: 'advance_refund', bn: 'অগ্রিম ফেরত', en: 'Advance refund' },
  { value: 'other', bn: 'অন্যান্য', en: 'Other' },
];

/* segChips + filterSheet live in js/ui.js (shared with restore mode + activity log). */

/* ==================== Deposits hub (Entry / Withdrawal / Transactions) ==================== */
export async function pageDepositsHub(session, params = {}) {
  const wrap = page('জমা / লেনদেন', 'Deposits & Transactions', 'money');
  const TABS = [
    { id: 'entry', label: 'জমা এন্ট্রি / Deposit Entry' },
    { id: 'withdrawal', label: 'উত্তোলন / Withdrawal' },
    { id: 'transactions', label: 'লেনদেন / Transactions' },
  ];
  let active = params.tab && TABS.some(t => t.id === params.tab) ? params.tab : 'entry';
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
    if (active === 'entry') await embedPage(host, pageDeposit, session);
    else if (active === 'withdrawal') await embedPage(host, pageWithdrawal, session);
    else await embedPage(host, pageDepositHistory, session);
  }
  await paint();
  return wrap;
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
      <div class="field"><label>উত্তোলনের ধরন <span class="req">*</span></label><div class="js-type"></div></div>
      <div class="field"><label>পরিশোধ পদ্ধতি <span class="req">*</span></label><div class="js-method"></div></div>
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
  const typeSeg = segChips('type', WTYPE_SHORT, 'savings');
  const methodSeg = segChips('method', METHOD_SHORT, 'cash');
  form.querySelector('.js-type').appendChild(typeSeg.root);
  form.querySelector('.js-method').appendChild(methodSeg.root);

  /* The native date input renders in the device locale (often MM/DD/YYYY);
     mirror the chosen date below it in the app's local format DD-MM-YYYY. */
  const dateInp = form.elements.date;
  const dateFmt = el('div', { class: 'dfmt', text: dateInp.value ? fmtDate(dateInp.value) : '' });
  dateInp.insertAdjacentElement('afterend', dateFmt);
  const syncDateFmt = () => { dateFmt.textContent = dateInp.value ? fmtDate(dateInp.value) : ''; };
  dateInp.addEventListener('input', syncDateFmt);

  const paintInfo = async () => {
    infoHost.replaceChildren();
    /* During preselect construction the picker's hidden input is not in the
       form yet — read through the picker then. */
    const id = form.elements.memberDocId ? form.elements.memberDocId.value : (picker ? picker.value : '');
    if (!id) return;
    const m = await getMember(id);
    if (!m) return;
    const bal = withdrawalBalance(m, deposits, withdrawals);
    const stats = el('div', { class: 'stats' });
    stats.append(
      statCard({ label: 'মোট জমা / Total Deposit', value: taka(bal.totalDeposit), sub: 'অনুমোদিত জমা', ic: 'deposit' }),
      statCard({ label: 'মোট উত্তোলন / Total Withdrawal', value: taka(bal.totalWithdrawal), sub: 'অনুমোদিত উত্তোলন', ic: 'upload', tone: 'red' }),
      statCard({ label: 'উপলব্ধ ব্যালান্স / Available Balance', value: taka(bal.available), sub: 'উত্তোলনযোগ্য', ic: 'money', tone: 'blue' }),
    );
    infoHost.appendChild(card(staff ? 'ব্যালান্স' : 'আমার ব্যালান্স', staff ? `Balance — ${m.memberId} · ${m.nameBn}` : `My Balance — ${m.memberId} · ${m.nameBn}`, stats));
  };
  if (staff) {
    picker = memberPicker({ members: activeMembers, onPick: () => paintInfo() });
    const host = form.querySelector('.js-pickhost');
    host.appendChild(picker.root);
    host.insertAdjacentHTML('beforeend', '<div class="err" data-err="memberDocId"></div>');
  }
  /* Native reset restores hidden inputs but not chip/picker UI — sync it all. */
  form.addEventListener('reset', () => setTimeout(() => {
    if (picker) picker.set('');
    typeSeg.reset(); methodSeg.reset();
    form.elements.date.value = todayISO();
    syncDateFmt();
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

  /* --- history list: cards on mobile, table on desktop --- */
  const mine = staff ? withdrawals : withdrawals.filter(w => w.memberDocId === session.memberDocId || w.memberId === session.memberId);
  const rows = mine.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.submittedAt).localeCompare(String(a.submittedAt)));
  const wActions = w => {
    const acts = el('div', { class: 'btn-row' });
    if (w.status === 'pending' && (session.role === 'admin' || session.role === 'maker')) {
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
        [{ label: 'তারিখ' }, ...(staff ? [{ label: 'সদস্য' }] : []), { label: 'ধরন' }, { label: 'পদ্ধতি' },
         { label: 'পরিমাণ', cls: 'num' }, { label: 'বিবরণ' }, { label: 'স্ট্যাটাস' }, { label: 'অ্যাকশন', cls: 'nowrap' }],
        rows.map(w => [
          esc(fmtDate(w.date)),
          ...(staff ? [`${esc(w.memberName)}<br><span class="faint fs8">${esc(w.memberId)}</span>`] : []),
          esc(withdrawalTypeLabel(w.type).bn), esc(methodLabel(w.method).bn),
          { text: money(w.amount), cls: 'num' }, esc(w.description || '—'),
          { html: statusTag(w.status) }, { node: wActions(w), cls: 'nowrap' },
        ]),
        { empty: t('কোনো উত্তোলন নেই', 'No withdrawals'), emptyIcon: 'withdraw' },
      ));
    }
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

/* ==================== Deposit entry ==================== */
export async function pageDeposit(session, params = {}) {
  const [members, deposits, cfg] = await Promise.all([allMembers(), allDeposits(), settings()]);
  const staff = session.role === 'admin' || session.role === 'maker';
  const wrap = page('অর্থ ব্যবস্থাপনা', 'Money Management — Deposit Entry', 'money');

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
      <div class="field"><label>তারিখ <span class="req">*</span></label>
        <input name="date" type="date" required value="${todayISO()}" ${session.role === 'maker' ? `max="${todayISO()}" min="${todayISO()}"` : ''}>
        ${session.role === 'maker' ? '<div class="hint">Maker শুধুমাত্র আজকের তারিখে এন্ট্রি করতে পারবেন।</div>' : ''}
        <div class="err" data-err="date"></div></div>
      <div class="field"><label>জমার ধরন <span class="req">*</span></label><div class="js-type"></div></div>
      <div class="field"><label>পরিশোধ পদ্ধতি <span class="req">*</span></label><div class="js-method"></div></div>
      <div class="field"><label>পরিমাণ (৳) <span class="req">*</span></label>
        <input name="amount" type="number" min="1" step="0.01" required inputmode="decimal" placeholder="0">
        <div class="hint">যেকোনো পরিমাণ গ্রহণযোগ্য</div>
        <div class="err" data-err="amount"></div></div>
      <div class="field js-desc" hidden><label>বিবরণ <span class="req">*</span></label>
        <input name="description" placeholder="বিশেষ চাঁদা / অন্যান্য জমার বিবরণ"><div class="err" data-err="description"></div></div>
    </div>
    <div class="field"><label>মন্তব্য (ঐচ্ছিক)</label><textarea name="comment" rows="2" placeholder="ঐচ্ছিক"></textarea></div>
    <div class="form-sticky">
      <button class="btn btn-ghost" type="reset">${icon('clear')}<span>${t('মুছুন', 'Clear')}</span></button>
      <button class="btn btn-primary" type="submit">${icon('save')}<span>${staff ? t('জমা যোগ করুন', 'Add deposit') : t('জমা দাখিল করুন', 'Submit deposit')}</span></button>
    </div>`;
  const typeSeg = segChips('type', TYPE_SHORT, 'monthly');
  const methodSeg = segChips('method', METHOD_SHORT, 'cash');
  form.querySelector('.js-type').appendChild(typeSeg.root);
  form.querySelector('.js-method').appendChild(methodSeg.root);

  const descField = form.querySelector('.js-desc');
  const syncDesc = () => {
    const need = form.elements.type.value === 'special' || form.elements.type.value === 'other';
    descField.hidden = !need;
    if (!need) form.elements.description.value = '';
  };
  form.elements.type.addEventListener('change', syncDesc);
  syncDesc();

  /* The native date input renders in the device locale (often MM/DD/YYYY);
     mirror the chosen date below it in the app's local format DD-MM-YYYY. */
  const dateInp = form.elements.date;
  const dateFmt = el('div', { class: 'dfmt', text: dateInp.value ? fmtDate(dateInp.value) : '' });
  dateInp.insertAdjacentElement('afterend', dateFmt);
  const syncDateFmt = () => { dateFmt.textContent = dateInp.value ? fmtDate(dateInp.value) : ''; };
  dateInp.addEventListener('input', syncDateFmt);

  const paintInfo = async () => {
    infoHost.replaceChildren();
    /* During preselect construction the picker's hidden input is not in the
       form yet — read through the picker then. */
    const id = form.elements.memberDocId ? form.elements.memberDocId.value : (picker ? picker.value : '');
    if (!id) return;
    const m = await getMember(id);
    if (!m) return;
    const s = memberSummary(m, deposits, summaryOpts(cfg));
    const stats = el('div', { class: 'stats' });
    stats.append(
      statCard({ label: 'মাসিক কিস্তি', value: taka(m.installment), sub: `${s.months} মাস হিসাবযোগ্য`, ic: 'money' }),
      statCard({ label: 'মোট জমা', value: taka(s.totalDeposit), sub: `${s.count}টি অনুমোদিত`, ic: 'deposit' }),
      statCard({ label: 'বকেয়া', value: taka(s.due), sub: `প্রয়োজন ${taka(s.required)}`, ic: 'due', tone: s.due > 0 ? 'red' : '' }),
      statCard({ label: 'অগ্রিম', value: taka(s.advance), sub: s.advance > 0 ? 'অতিরিক্ত জমা' : '—', ic: 'advance', tone: 'blue' }),
    );
    infoHost.appendChild(card(staff ? 'সদস্য সারসংক্ষেপ' : 'আমার সারাংশ', staff ? `Member Summary — ${m.memberId} · ${m.nameBn}` : `My Summary — ${m.memberId} · ${m.nameBn}`, stats));
  };
  if (staff) {
    picker = memberPicker({ members: activeMembers, value: params.memberDocId || '', onPick: () => paintInfo() });
    const host = form.querySelector('.js-pickhost');
    host.appendChild(picker.root);
    host.insertAdjacentHTML('beforeend', '<div class="err" data-err="memberDocId"></div>');
  }

  wrap.appendChild(infoHost);
  wrap.appendChild(banner('info', 'মাসের <b>১২ তারিখের</b> মধ্যে জমা না দিলে <b>বকেয়া</b> হিসেবে দেখাবে।'));
  const entryCard = card(staff ? 'জমা এন্ট্রি' : 'জমা দাখিল', staff ? 'Deposit Entry' : 'Submit Deposit', form);
  if (staff) entryCard.classList.add('overflow-visible');
  wrap.appendChild(entryCard);
  await paintInfo();

  /* Native reset restores hidden inputs but not chip/picker UI — sync it all. */
  form.addEventListener('reset', () => setTimeout(() => {
    if (picker) picker.set(params.memberDocId || '');
    typeSeg.reset(); methodSeg.reset();
    form.elements.date.value = todayISO();
    syncDateFmt();
    syncDesc(); paintInfo();
  }, 0));

  form.addEventListener('submit', async e => {
    e.preventDefault();
    form.querySelectorAll('.err').forEach(x => x.textContent = '');
    form.querySelectorAll('.field').forEach(x => x.classList.remove('bad'));
    const setErr = (n, msg) => { const b = form.querySelector(`[data-err="${n}"]`); if (b) { b.textContent = msg; b.closest('.field').classList.add('bad'); } };
    const v = Object.fromEntries(new FormData(form).entries());
    let bad = false;
    if (!v.memberDocId) { setErr('memberDocId', 'সদস্য নির্বাচন করুন'); bad = true; }
    if (!v.date) { setErr('date', 'তারিখ দিন'); bad = true; }
    if (!(num(v.amount) > 0)) { setErr('amount', 'জমার পরিমাণ দিন'); bad = true; }
    if ((v.type === 'special' || v.type === 'other') && !String(v.description || '').trim()) { setErr('description', 'বিবরণ আবশ্যক'); bad = true; }
    if (session.role === 'maker' && v.date !== todayISO()) { setErr('date', 'Maker শুধুমাত্র আজকের তারিখ ব্যবহার করতে পারবেন'); bad = true; }
    if (bad) { toast('ফর্মে ত্রুটি রয়েছে', 'error'); return; }

    const b = form.querySelector('button[type=submit]'); b.disabled = true;
    try {
      const rec = await submitDeposit(v, session);
      await depositSuccess(rec);
      form.reset();
      form.elements.date.value = todayISO();
      syncDesc();
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
        <div>সদস্য</div><div><b>${esc(rec.memberName)}</b> (${esc(rec.memberId)})</div>
        <div>তারিখ</div><div>${esc(fmtDate(rec.date))}</div>
        <div>ধরন</div><div>${esc(typeLabel(rec.type).bn)}</div>
        <div>পদ্ধতি</div><div>${esc(methodLabel(rec.method).bn)}</div>
        <div>পরিমাণ</div><div><b style="color:var(--green-dark);font-size:11px">${taka(rec.amount)}</b></div>
        <div>স্ট্যাটাস</div><div>${statusTag(rec.status)}</div>
      </div>
      <div class="banner ${rec.status === 'approved' ? 'ok' : 'info'}" style="margin-top:9px">${icon('info')}<span>${
        rec.status === 'approved'
          ? 'জমা সফলভাবে সংরক্ষিত ও অনুমোদিত হয়েছে।'
          : 'আপনার জমা সফলভাবে দাখিল হয়েছে। Maker/Admin অনুমোদনের পর এটি হিসাবে যুক্ত হবে।'}</span></div>`,
    actions: [{ label: t('ঠিক আছে', 'OK'), value: true, kind: 'primary' }],
  });
}

/* Compact transaction card (mobile lists): date · type + tag / member / amount ·
   method / actions. Shared by the deposit history and the withdrawal history. */
function txnCard(d, { staff, typeBn, actions = null }) {
  const c = el('div', { class: 'tcard' });
  const top = el('div', { class: 'tc-top' });
  top.innerHTML = `<span class="tc-t">${esc(fmtDate(d.date))} · ${esc(typeBn)}</span>`;
  top.insertAdjacentHTML('beforeend', statusTag(d.status));
  c.appendChild(top);
  if (staff) c.appendChild(el('div', { class: 'tc-sub', text: `${d.memberName} · ${d.memberId}` }));
  const amt = el('div', { class: 'tc-amt' });
  amt.innerHTML = `<b>${money(d.amount)}</b><span> · ${esc(methodLabel(d.method).bn)}</span>`;
  c.appendChild(amt);
  if (d.description) c.appendChild(el('div', { class: 'tc-desc', text: d.description }));
  if (actions && actions.children.length) {
    const a = el('div', { class: 'pc-acts' });
    a.appendChild(actions);
    c.appendChild(a);
  }
  return c;
}

/* Row actions for one deposit — identical logic for the card and the table,
   only Bengali labels. Approve/Reject/Edit/Delete/View permissions untouched. */
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
  acts.appendChild(btn(t('দেখুন', 'View'), 'eye', 'ghost', () => viewDeposit(d), { size: 'xs' }));
  return acts;
}

const DEP_STATUS_OPTS = [
  { value: '', bn: 'সব', en: 'All' },
  { value: 'pending', bn: 'অপেক্ষমাণ', en: 'Pending' },
  { value: 'approved', bn: 'অনুমোদিত', en: 'Approved' },
  { value: 'rejected', bn: 'বাতিল', en: 'Rejected' },
];

/* Reusable filter sheet: single-select chip groups + date range. Picks stay
   local until [প্রয়োগ করুন]; [ফিল্টার মুছুন] clears everything. */
/* ==================== Deposit history ==================== */
export async function pageDepositHistory(session, params = {}) {
  const [members, deposits, cfg] = await Promise.all([allMembers(), allDeposits(), settings()]);
  const staff = session.role === 'admin' || session.role === 'maker';
  const wrap = page('জমার ইতিহাস', 'Deposit History', 'history');

  const mine = staff ? deposits : deposits.filter(d => d.memberDocId === session.memberDocId || d.memberId === session.memberId);

  /* filter state lives here now — the sheet only edits a copy until Apply */
  let st = params.status || '', tp = '', mt = '', from = '', to = '';

  const head = el('div', { class: 'txn-head' });
  const searchBox = el('div', { class: 'search-box', html: icon('search') });
  const q = el('input', {
    placeholder: t('সদস্য / বিবরণ / টাকা…', 'Member / note / amount…'),
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
      { key: 'st', label: t('স্ট্যাটাস', 'Status'), options: DEP_STATUS_OPTS },
      { key: 'tp', label: t('ধরন', 'Type'), options: [{ value: '', bn: 'সব', en: 'All' }, ...TYPE_SHORT] },
      { key: 'mt', label: t('পদ্ধতি', 'Method'), options: [{ value: '', bn: 'সব', en: 'All' }, ...METHOD_SHORT] },
    ],
    dates: { fromLabel: t('তারিখ: শুরু', 'Date: from'), toLabel: t('শেষ', 'to') },
    onApply: s => { ({ st, tp, mt, from, to } = s); paintBadge(); render(); },
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
      if (query && ![d.memberId, d.memberName, d.description, d.comment, String(d.amount)].some(x => String(x || '').toLowerCase().includes(query))) return false;
      return true;
    }).sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.submittedAt).localeCompare(String(a.submittedAt)));
  };

  const exportRows = kind => {
    if (!current.length) { toast('রপ্তানির জন্য কোনো তথ্য নেই', 'warn'); return; }
    const rows = [['SL', 'Date', 'Member ID', 'Member Name', 'Deposit Type', 'Payment Method', 'Amount', 'Description', 'Status']];
    current.forEach((d, i) => rows.push([i + 1, fmtDate(d.date), d.memberId, d.memberName, typeLabel(d.type).en, methodLabel(d.method).en, num(d.amount), d.description || '', d.status]));
    rows.push(['', '', '', '', '', 'Total', current.reduce((s, d) => s + num(d.amount), 0), '', '']);
    const fn = safeName(`Dhruvo_Sangsad_Deposit_History_${todayISO()}`);
    if (kind === 'csv') downloadCSV(rows, fn + '.csv');
    else downloadExcel([{ name: 'Deposit History', rows }], fn + '.xlsx');
  };
  const exportBtn = (kind, ic, label) => el('button', {
    type: 'button', class: 'icon-btn', html: icon(ic),
    title: label, 'aria-label': label, onclick: () => exportRows(kind),
  });

  const render = () => {
    current = filtered();
    const appr = current.filter(d => d.status === 'approved');
    const pend = current.filter(d => d.status === 'pending');
    const stats = el('div', { class: 'stats' });
    stats.append(
      statCard({ label: 'রেকর্ড', value: String(current.length), sub: 'ফিল্টার অনুযায়ী', ic: 'log', tone: 'gray' }),
      statCard({ label: 'অনুমোদিত জমা', value: taka(appr.reduce((s, d) => s + num(d.amount), 0)), sub: `${appr.length}টি এন্ট্রি`, ic: 'approve' }),
      statCard({ label: 'অপেক্ষমাণ', value: taka(pend.reduce((s, d) => s + num(d.amount), 0)), sub: `${pend.length}টি এন্ট্রি`, ic: 'pending', tone: 'amber' }),
    );
    sumHost.replaceChildren(card('সারসংক্ষেপ', 'Summary', stats, [
      exportBtn('xlsx', 'excel', t('Excel ডাউনলোড', 'Download Excel')),
      exportBtn('csv', 'csv', t('CSV ডাউনলোড', 'Download CSV')),
    ]));

    listHost.replaceChildren();
    if (!current.length) {
      const filteredOut = q.value.trim() || st || tp || mt || from || to;
      listHost.appendChild(emptyState({
        ic: 'deposit',
        title: t('কোনো জমা পাওয়া যায়নি', 'No deposit records found'),
        hint: filteredOut ? t('খোঁজ বা ফিল্টার বদলে আবার দেখুন', 'Try a different search or filter') : '',
        actionLabel: can(session, 'deposit:create-any') ? t('জমা এন্ট্রি', 'Add deposit') : '',
        onAction: can(session, 'deposit:create-any') ? () => App.go('deposit', { tab: 'entry' }) : null,
      }));
      return;
    }
    if (window.matchMedia && matchMedia('(max-width: 767px)').matches) {
      current.forEach(d => listHost.appendChild(txnCard(d, {
        staff, typeBn: typeLabel(d.type).bn, actions: depositActions(session, d, staff),
      })));
    } else {
      listHost.appendChild(tableWrap(
        [{ label: 'ক্রম', cls: 'num' }, { label: 'তারিখ' }, ...(staff ? [{ label: 'সদস্য' }] : []),
         { label: 'ধরন' }, { label: 'পদ্ধতি' }, { label: 'পরিমাণ', cls: 'num' },
         { label: 'বিবরণ' }, { label: 'স্ট্যাটাস' }, { label: 'অ্যাকশন', cls: 'nowrap' }],
        current.map((d, i) => [
          { text: String(i + 1), cls: 'num' },
          esc(fmtDate(d.date)),
          ...(staff ? [`${esc(d.memberName)}<br><span class="faint fs8">${esc(d.memberId)}</span>`] : []),
          esc(typeLabel(d.type).bn),
          esc(methodLabel(d.method).bn),
          { text: money(d.amount), cls: 'num' },
          esc(d.description || '—'),
          { html: statusTag(d.status) },
          { node: depositActions(session, d, staff), cls: 'nowrap' },
        ]),
        {
          empty: t('কোনো জমা পাওয়া যায়নি', 'No deposit records found'),
          emptyIcon: 'deposit',
          footer: [
            { html: '', cls: '' }, { html: 'সর্বমোট' }, ...(staff ? [{ html: '' }] : []), { html: '' }, { html: '' },
            { html: `<b>${money(current.reduce((s, d) => s + num(d.amount), 0))}</b>`, cls: 'num' }, { html: '' }, { html: '' }, { html: '' },
          ],
        },
      ));
    }
  };

  /* Re-render cards ⇄ table when the viewport crosses the breakpoint. */
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
  return wrap;
}

function viewDeposit(d) {
  return modal({
    title: `জমার বিবরণ / Deposit — ${d.memberId}`, width: 420,
    body: kv([
      ['সদস্য', `<b>${esc(d.memberName)}</b> (${esc(d.memberId)})`],
      ['তারিখ', esc(fmtDate(d.date))],
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
          <input name="date" type="date" value="${esc(String(d.date).slice(0, 10))}" ${session.role === 'maker' ? `min="${todayISO()}" max="${todayISO()}"` : ''}></div>
        <div class="field"><label>ধরন <span class="req">*</span></label>
          <select name="type">${DEPOSIT_TYPES.map(t => `<option value="${t.id}"${t.id === d.type ? ' selected' : ''}>${esc(t.bn)}</option>`).join('')}</select></div>
        <div class="field"><label>পদ্ধতি <span class="req">*</span></label>
          <select name="method">${PAY_METHODS.map(t => `<option value="${t.id}"${t.id === d.method ? ' selected' : ''}>${esc(t.bn)}</option>`).join('')}</select></div>
        <div class="field"><label>পরিমাণ (৳) <span class="req">*</span></label><input name="amount" type="number" min="1" step="0.01" value="${esc(d.amount)}"></div>
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
