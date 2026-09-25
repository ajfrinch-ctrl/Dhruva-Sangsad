/* Transactions — a completely separate, modern section.
   Every row is one money movement with its unique id (YYYYMMDDNNN),
   the actual payment date, type, amount, method and status. */
import {
  el, esc, toast, taka, money, num, fmtDate, fmtTime, fmtDateTime, modal, debounce, t,
  typeLabel, methodLabel,
} from '../util.js';
import { icon } from '../icons.js';
import { page, card, tableWrap, statusTag, banner, btn, kv, statCard, emptyState, filterSheet, sectionBar, tileMenu, txnIdChip, bindCopyIds } from '../ui.js';
import { allDeposits, allWithdrawals, withdrawalTypeLabel } from '../store.js';
import { App } from '../app.js';

/* Normalize deposits + withdrawals into one stream of transactions. */
export function combineTxns(deposits, withdrawals, { forMember = null } = {}) {
  const d = deposits.map(x => ({ ...x, kind: 'deposit', kindLabel: typeLabel(x.type), amount: num(x.amount) }));
  const w = withdrawals.map(x => ({ ...x, kind: 'withdrawal', kindLabel: withdrawalTypeLabel(x.type), amount: num(x.amount) }));
  let all = d.concat(w);
  if (forMember) {
    all = all.filter(x => x.memberDocId === forMember.memberDocId || x.memberId === forMember.memberId);
  }
  return all.sort((a, b) => String(b.date).localeCompare(String(a.date))
    || String(b.submittedAt || '').localeCompare(String(a.submittedAt || '')));
}

/* ==================== Transactions hub ==================== */
export async function pageTransactionsHub(session, params = {}) {
  const isStaff = session.role === 'admin' || session.role === 'maker';

  const SECTIONS = [
    { id: 'list', ic: 'receipt', bn: 'লেনদেন', en: 'Transactions', sub: 'সব জমা ও উত্তোলন এক তালিকায়', tone: '' },
    { id: 'today', ic: 'calendar', bn: 'আজকের লেনদেন', en: "Today's", sub: 'আজকের তারিখের সব এন্ট্রি', tone: 'info' },
    ...(!isStaff ? [{ id: 'pending', ic: 'clock', bn: 'আমার অপেক্ষমাণ', en: 'My Pending', sub: 'অনুমোদনের অপেক্ষায়', tone: 'warn' }] : []),
  ];

  const valid = params.section && SECTIONS.some(x => x.id === params.section);
  if (!valid) {
    const wrap = page('লেনদেন', 'Transactions', 'history');
    wrap.appendChild(tileMenu(SECTIONS, id => App.go('transactions', { section: id }), { ariaLabel: t('লেনদেন বিভাগ', 'Transaction views') }));
    return wrap;
  }
  const sec = SECTIONS.find(x => x.id === params.section);
  const wrap = el('div');
  wrap.appendChild(sectionBar(sec.bn, sec.en, sec.ic, () => App.go('transactions', {}), t('লেনদেন মেনু', 'Transactions menu')));
  const host = el('div');
  wrap.appendChild(host);
  const fn = sec.id === 'today' ? pageTodayTxns : sec.id === 'pending' ? pagePendingMine : pageTxnList;
  const node = await fn(session);
  const head = node.querySelector('.page-head'); if (head) head.remove();
  host.appendChild(node);
  bindCopyIds(host);
  return wrap;
}

/* ==================== the modern list ==================== */
export async function pageTxnList(session, { onlyToday = false, onlyPendingMine = false } = {}) {
  const isStaff = session.role === 'admin' || session.role === 'maker';
  const [deposits, withdrawals] = await Promise.all([allDeposits(), allWithdrawals()]);
  const wrap = page('লেনদেন', 'Transactions', 'receipt');

  let rows = combineTxns(deposits, withdrawals, isStaff ? {} : { forMember: session });
  if (onlyToday) rows = rows.filter(x => String(x.date).slice(0, 10) === todayKey());
  if (onlyPendingMine) rows = rows.filter(x => x.status === 'pending');

  let kind = onlyPendingMine ? '' : 'all', st = onlyPendingMine ? 'pending' : '', from = '', to = '', q = '';

  /* --- summary strip (2-col on mobile) --- */
  const approved = rows.filter(x => x.status === 'approved');
  const dep = approved.filter(x => x.kind === 'deposit').reduce((s, x) => s + x.amount, 0);
  const wit = approved.filter(x => x.kind === 'withdrawal').reduce((s, x) => s + x.amount, 0);
  const stats = el('div', { class: 'stats' });
  stats.append(
    statCard({ label: t('মোট লেনদেন', 'Transactions'), value: String(rows.length), sub: onlyToday ? t('আজ', 'today') : t('সব সময়', 'all time'), ic: 'receipt', tone: 'gray' }),
    statCard({ label: t('মোট জমা', 'Deposits In'), value: taka(dep), sub: `${approved.filter(x => x.kind === 'deposit').length}টি অনুমোদিত`, ic: 'deposit' }),
    statCard({ label: t('মোট উত্তোলন', 'Withdrawals Out'), value: taka(wit), sub: `${approved.filter(x => x.kind === 'withdrawal').length}টি অনুমোদিত`, ic: 'withdraw', tone: 'red' }),
    statCard({ label: t('নেট', 'Net'), value: taka(dep - wit), sub: 'জমা − উত্তোলন', ic: 'money', tone: dep - wit >= 0 ? 'blue' : 'red' }),
  );
  wrap.appendChild(stats);

  /* --- search + filter --- */
  if (!onlyToday && !onlyPendingMine) {
    const head = el('div', { class: 'txn-head' });
    const searchBox = el('div', { class: 'search-box', html: icon('search') });
    const qEl = el('input', {
      placeholder: t('ID / সদস্য / পরিমাণ…', 'ID / member / amount…'),
      autocomplete: 'off', 'aria-label': t('লেনদেন খুঁজুন', 'Search transactions'),
    });
    searchBox.appendChild(qEl);
    const filterBtn = el('button', { type: 'button', class: 'btn btn-ghost filter-btn', 'aria-label': t('ফিল্টার', 'Filter') });
    const paintBadge = () => {
      const n = [kind && kind !== 'all' ? kind : '', st, from, to].filter(Boolean).length;
      filterBtn.innerHTML = `${icon('filter')}<span>${esc(t('ফিল্টার', 'Filter'))}</span>${n ? `<span class="fbadge">${n}</span>` : ''}`;
    };
    paintBadge();
    filterBtn.addEventListener('click', () => filterSheet({
      state: { kind, st, from, to },
      sections: [
        { key: 'kind', label: t('ধরন', 'Kind'), options: [{ value: 'all', bn: 'সব', en: 'All' }, { value: 'deposit', bn: 'জমা', en: 'Deposits' }, { value: 'withdrawal', bn: 'উত্তোলন', en: 'Withdrawals' }] },
        { key: 'st', label: t('স্ট্যাটাস', 'Status'), options: [{ value: '', bn: 'সব', en: 'All' }, { value: 'pending', bn: 'অপেক্ষমাণ', en: 'Pending' }, { value: 'approved', bn: 'অনুমোদিত', en: 'Approved' }, { value: 'rejected', bn: 'বাতিল', en: 'Rejected' }] },
      ],
      dates: { fromLabel: t('শুরু', 'From'), toLabel: t('শেষ', 'To') },
      onApply: s => { kind = s.kind; st = s.st || ''; from = s.from; to = s.to; paintBadge(); render(); },
      onClear: () => { kind = 'all'; st = ''; from = ''; to = ''; paintBadge(); render(); },
    }));
    qEl.addEventListener('input', debounce(() => { q = qEl.value.trim().toLowerCase(); render(); }, 160));
    head.append(searchBox, filterBtn);
    wrap.appendChild(head);
  }

  const listHost = el('div', { class: 'person-list txn-list' });
  wrap.appendChild(listHost);

  const visible = () => rows.filter(x => {
    if (kind && kind !== 'all' && x.kind !== kind) return false;
    if (st && x.status !== st) return false;
    const dt = String(x.date).slice(0, 10);
    if (from && dt < from) return false;
    if (to && dt > to) return false;
    if (q && ![x.txnId, x.memberId, x.memberName, String(x.amount), x.description, x.comment]
      .some(v => String(v || '').toLowerCase().includes(q))) return false;
    return true;
  });

  function render() {
    const cur = visible();
    listHost.replaceChildren();
    if (!cur.length) {
      listHost.appendChild(emptyState({
        ic: 'receipt',
        title: onlyToday ? t('আজ কোনো লেনদেন নেই', 'No transactions today') : t('কোনো লেনদেন পাওয়া যায়নি', 'No transactions found'),
      }));
      return;
    }
    if (window.matchMedia && matchMedia('(max-width: 767px)').matches) {
      cur.forEach(x => listHost.appendChild(txnRowCard(x, session)));
    } else {
      listHost.appendChild(tableWrap(
        [{ label: 'Txn ID' }, { label: 'তারিখ' }, { label: isStaff ? 'সদস্য' : 'বিভাগ' }, { label: 'ধরন' },
         { label: 'পদ্ধতি' }, { label: 'পরিমাণ', cls: 'num' }, { label: 'স্ট্যাটাস' }, { label: '', cls: 'nowrap' }],
        cur.map(x => [
          { html: txnIdChip(x.txnId) },
          esc(fmtDate(x.date)),
          isStaff ? `<b class="cell-name">${esc(x.memberName)}</b><br><span class="faint fs8">${esc(x.memberId)}</span>` : `<span class="tag ${x.kind === 'deposit' ? 'approved' : 'due'}">${esc(x.kind === 'deposit' ? t('জমা', 'Deposit') : t('উত্তোলন', 'Withdrawal'))}</span>`,
          esc(x.kindLabel.bn),
          esc(methodLabel(x.method).bn),
          { html: `<b class="${x.kind === 'deposit' ? 'adv-amt' : 'due-amt'}">${x.kind === 'deposit' ? '+' : '−'}${money(x.amount)}</b>`, cls: 'num' },
          { html: statusTag(x.status) },
          { node: btn(t('বিস্তারিত', 'Details'), 'eye', 'ghost', () => txnDetail(x), { size: 'xs' }), cls: 'nowrap' },
        ]),
        { empty: t('কোনো লেনদেন নেই', 'No transactions'), emptyIcon: 'receipt' },
      ));
    }
  }
  if (window.matchMedia) {
    const mq = matchMedia('(max-width: 767px)');
    const onBp = () => {
      if (!listHost.isConnected) { if (mq.removeEventListener) mq.removeEventListener('change', onBp); return; }
      render();
    };
    if (mq.addEventListener) mq.addEventListener('change', onBp);
  }
  render();
  bindCopyIds(listHost);
  return wrap;
}

export async function pageTodayTxns(session) {
  return pageTxnList(session, { onlyToday: true });
}
export async function pagePendingMine(session) {
  return pageTxnList(session, { onlyPendingMine: true });
}
function todayKey() { const p = n => String(n).padStart(2, '0'); const d = new Date(); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }

/* The Android-style transaction card: ID → type/amount → date·method → status. */
function txnRowCard(x, session) {
  const c = el('button', { type: 'button', class: 'txncard', 'aria-label': `${x.txnId} ${taka(x.amount)}` });
  const isDep = x.kind === 'deposit';
  c.innerHTML = `
    <span class="tx-ic ${isDep ? 'g' : 'r'}">${icon(isDep ? 'deposit' : 'withdraw')}</span>
    <span class="tx-bd">
      <span class="tx-top"><code class="txn-id">${esc(x.txnId || '—')}</code>${statusTag(x.status)}</span>
      <span class="tx-mid"><b>${esc(x.kindLabel.bn)}</b><b class="tx-amt ${isDep ? 'adv-amt' : 'due-amt'}">${isDep ? '+' : '−'}${taka(x.amount)}</b></span>
      <span class="tx-sub">${esc((session.role !== 'member') ? `${x.memberName} · ` : '')}${esc(fmtDate(x.date))} · ${esc(methodLabel(x.method).bn)}</span>
    </span>
    <span class="tx-go">${icon('chevron')}</span>`;
  c.addEventListener('click', () => txnDetail(x));
  return c;
}

function txnDetail(x) {
  return modal({
    title: `${t('লেনদেনের বিবরণ', 'Transaction Details')}`, width: 420,
    body: kv([
      [t('Transaction ID', 'Transaction ID'), `<b class="txn-id-static">${esc(x.txnId || '—')}</b>`],
      [t('ধরন', 'Kind'), x.kind === 'deposit' ? t('জমা', 'Deposit') : t('উত্তোলন', 'Withdrawal')],
      [t('বিভাগ', 'Type'), esc(x.kindLabel.bn)],
      [t('পদ্ধতি', 'Method'), esc(methodLabel(x.method).bn)],
      [t('পরিমাণ', 'Amount'), `<b class="${x.kind === 'deposit' ? 'adv-amt' : 'due-amt'}">${taka(x.amount)}</b>`],
      [t('পেমেন্টের তারিখ', 'Payment date'), esc(fmtDate(x.date))],
      [t('সদস্য', 'Member'), `<b>${esc(x.memberName)}</b> (${esc(x.memberId)})`],
      [t('দাখিল', 'Submitted'), esc(fmtDateTime(x.submittedAt))],
      [t('স্ট্যাটাস', 'Status'), statusTag(x.status)],
      ...(x.rejectReason ? [[t('বাতিলের কারণ', 'Reason'), esc(x.rejectReason)]] : []),
      ...(x.description ? [[t('বিবরণ', 'Description'), esc(x.description)]] : []),
    ]),
    actions: [{ label: t('বন্ধ করুন', 'Close'), value: true, kind: 'ghost' }],
  });
}
