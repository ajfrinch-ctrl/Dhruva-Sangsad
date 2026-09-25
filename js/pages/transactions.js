/* Transactions — one chronological ledger of money movements.
 *
 * A member's ledger is their own by definition, so the screen is titled
 * “My Transactions” and offers NO member name / member ID filter: those
 * controls existed only for staff. Staff (who can see everybody) keep a member
 * picker, because filtering by member is meaningful for them.
 */
import {
  el, esc, toast, taka, money, num, fmtDate, fmtDateTime, modal, debounce, t, tx,
  typeLabel, methodLabel,
} from '../util.js';
import { icon } from '../icons.js';
import {
  page, card, tableWrap, statusTag, emptyState, filterSheet, statCard, kv, sectionHead,
} from '../ui.js';
import { memberPicker } from '../picker.js';
import { allMembers, allDeposits, allWithdrawals, withdrawalTypeLabel } from '../store.js';
import { App } from '../app.js';

/** Normalise deposits + withdrawals into one stream of transactions. */
export function combineTxns(deposits, withdrawals, { forMember = null } = {}) {
  const d = deposits.map(x => ({ ...x, kind: 'deposit', kindLabel: typeLabel(x.type), amount: num(x.amount) }));
  const w = withdrawals.map(x => ({ ...x, kind: 'withdrawal', kindLabel: withdrawalTypeLabel(x.type), amount: num(x.amount) }));
  let all = d.concat(w);
  if (forMember) {
    all = all.filter(x => x.memberDocId === forMember.memberDocId || (forMember.memberId && x.memberId === forMember.memberId));
  }
  return all.sort((a, b) => String(b.date).localeCompare(String(a.date))
    || String(b.submittedAt || '').localeCompare(String(a.submittedAt || '')));
}

const isStaff = session => session.role === 'admin' || session.role === 'maker';

export async function pageTransactions(session) {
  const staff = isStaff(session);
  const [members, deposits, withdrawals] = await Promise.all([allMembers(), allDeposits(), allWithdrawals()]);
  const wrap = page(
    staff ? t('লেনদেন', 'Transactions') : t('আমার লেনদেন', 'My Transactions'),
    'Transactions', 'receipt',
  );

  /* Members: own rows only — enforced here, not by a filter the user must set. */
  const rows = combineTxns(deposits, withdrawals, staff ? {} : { forMember: session });

  let kind = '', st = '', from = '', to = '', q = '', memberDocId = '';
  let picker = null;

  const approved = rows.filter(x => x.status === 'approved');
  const dep = approved.filter(x => x.kind === 'deposit').reduce((a, x) => a + x.amount, 0);
  const wit = approved.filter(x => x.kind === 'withdrawal').reduce((a, x) => a + x.amount, 0);
  const stats = el('div', { class: 'stats' });
  stats.append(
    statCard({ label: t('মোট লেনদেন', 'Transactions'), value: String(rows.length), sub: t('সব সময়', 'all time'), ic: 'receipt', tone: 'gray' }),
    statCard({ label: t('মোট জমা', 'Deposits in'), value: taka(dep), sub: `${approved.filter(x => x.kind === 'deposit').length} ${t('টি অনুমোদিত', 'approved')}`, ic: 'deposit' }),
    statCard({ label: t('মোট উত্তোলন', 'Withdrawals out'), value: taka(wit), sub: `${approved.filter(x => x.kind === 'withdrawal').length} ${t('টি অনুমোদিত', 'approved')}`, ic: 'withdraw', tone: 'red' }),
    statCard({ label: t('নিট', 'Net'), value: taka(dep - wit), sub: t('জমা − উত্তোলন', 'deposits − withdrawals'), ic: 'money', tone: dep - wit >= 0 ? 'blue' : 'red' }),
  );
  wrap.appendChild(stats);

  /* ---- search + filters ---- */
  const head = el('div', { class: 'txn-head' });
  const searchBox = el('div', { class: 'search-box', html: icon('search') });
  const qEl = el('input', {
    type: 'search', autocomplete: 'off',
    placeholder: staff ? t('আইডি / সদস্য / পরিমাণ…', 'ID / member / amount…') : t('আইডি / পরিমাণ / বিবরণ…', 'ID / amount / note…'),
    'aria-label': t('লেনদেন খুঁজুন', 'Search transactions'),
  });
  searchBox.appendChild(qEl);
  const filterBtn = el('button', { type: 'button', class: 'btn btn-ghost filter-btn', 'aria-label': t('ফিল্টার', 'Filter') });
  const paintBadge = () => {
    const n = [kind, st, from, to, memberDocId].filter(Boolean).length;
    filterBtn.innerHTML = `${icon('filter')}<span>${esc(t('ফিল্টার', 'Filter'))}</span>${n ? `<span class="fbadge">${n}</span>` : ''}`;
  };
  paintBadge();
  filterBtn.addEventListener('click', () => filterSheet({
    state: { kind, st, from, to },
    sections: [
      { key: 'kind', label: t('ধরন', 'Kind'), options: [{ value: '', bn: 'সব', en: 'All' }, { value: 'deposit', bn: 'জমা', en: 'Deposits' }, { value: 'withdrawal', bn: 'উত্তোলন', en: 'Withdrawals' }] },
      { key: 'st', label: t('স্ট্যাটাস', 'Status'), options: [{ value: '', bn: 'সব', en: 'All' }, { value: 'pending', bn: 'অপেক্ষমাণ', en: 'Pending' }, { value: 'approved', bn: 'অনুমোদিত', en: 'Approved' }, { value: 'rejected', bn: 'বাতিল', en: 'Rejected' }] },
      ...(staff ? [{ key: 'member', label: t('সদস্য', 'Member'), options: [{ value: '', bn: 'সব সদস্য', en: 'All members' }] }] : []),
    ],
    dates: { fromLabel: t('শুরু', 'From'), toLabel: t('শেষ', 'To') },
    onApply: x => { ({ kind, st, from, to } = x); paintBadge(); render(); },
    onClear: () => { kind = st = from = to = ''; memberDocId = ''; if (picker) picker.set(''); paintBadge(); render(); },
  }));
  head.append(searchBox, filterBtn);
  wrap.appendChild(head);

  /* Staff-only member picker (members never see this control). */
  if (staff) {
    const host = el('div', { class: 'mpick-row' });
    picker = memberPicker({
      members,
      placeholder: t('সদস্য দিয়ে ফিল্টার করুন (ঐচ্ছিক)…', 'Filter by member (optional)…'),
      onPick: m => { memberDocId = m ? m.id : ''; paintBadge(); render(); },
    });
    const clear = el('button', { type: 'button', class: 'link-btn', text: t('মুছে ফেলুন', 'Clear'), onclick: () => { picker.set(''); memberDocId = ''; paintBadge(); render(); } });
    const lf = el('div', { class: 'field' });
    lf.appendChild(el('label', { text: t('সদস্য অনুযায়ী দেখুন', 'View by member') }));
    lf.appendChild(picker.root);
    host.appendChild(lf);
    host.appendChild(clear);
    const c = card(t('সদস্য ফিল্টার', 'Member filter'), 'Staff only', host);
    c.classList.add('overflow-visible', 'staff-filter');
    wrap.appendChild(c);
  }

  const listHost = el('div', { class: 'person-list' });
  wrap.appendChild(listHost);

  const filtered = () => rows.filter(x => {
    if (kind && x.kind !== kind) return false;
    if (st && x.status !== st) return false;
    if (memberDocId && x.memberDocId !== memberDocId && x.memberId !== (members.find(m => m.id === memberDocId) || {}).memberId) return false;
    const dt = String(x.date).slice(0, 10);
    if (from && dt < from) return false;
    if (to && dt > to) return false;
    if (q) {
      const needle = q.toLowerCase();
      if (![x.txnId, x.memberId, x.memberName, String(x.amount), x.description, x.comment]
        .some(v => String(v || '').toLowerCase().includes(needle))) return false;
    }
    return true;
  });

  function render() {
    const cur = filtered();
    listHost.replaceChildren();
    if (!cur.length) {
      listHost.appendChild(emptyState({
        ic: 'receipt',
        title: t('কোনো লেনদেন পাওয়া যায়নি', 'No transactions found'),
        hint: (q || kind || st || from || to || memberDocId) ? t('খোঁজ বা ফিল্টার বদলে আবার দেখুন', 'Try a different search or filter') : '',
      }));
      return;
    }
    cur.forEach(x => listHost.appendChild(txnRow(x, session)));
  }

  qEl.addEventListener('input', debounce(() => { q = qEl.value.trim(); render(); }, 160));
  render();
  return wrap;
}

/** Ledger row: date · type → amount → method/note → status. */
function txnRow(x, session) {
  const staff = isStaff(session);
  const dep = x.kind === 'deposit';
  const row = el('div', { class: 'row rec' });
  row.innerHTML = `<span class="rw-ic ${dep ? 'g' : 'r'}">${icon(dep ? 'deposit' : 'withdraw')}</span>
    <span class="rw-bd">
      <span class="rw-t"><b class="num">${esc(fmtDate(x.date))}</b> · <b>${esc(tx(x.kindLabel.bn))}</b></span>
      <span class="rw-s">${esc(tx(methodLabel(x.method).bn))}${x.description ? ` · ${esc(x.description)}` : ''}</span>
      ${staff ? `<span class="rw-m">${esc(x.memberName || '')}${x.memberId ? ` · ${esc(x.memberId)}` : ''}</span>` : ''}
    </span>
    <span class="rw-right">
      <b class="num ${dep ? 'adv-amt' : 'due-amt'}">${dep ? '+' : '−'}${esc(money(x.amount))}</b>
      ${statusTag(x.status)}
    </span>`;
  const hit = el('button', { type: 'button', class: 'row-hit', 'aria-label': `${fmtDate(x.date)} ${taka(x.amount)}` });
  hit.addEventListener('click', () => txnDetail(x));
  row.appendChild(hit);
  return row;
}

function txnDetail(x) {
  return modal({
    title: t('লেনদেনের বিবরণ', 'Transaction details'), width: 420,
    body: kv([
      [t('লেনদেন আইডি', 'Transaction ID'), `<b class="txn-id-static">${esc(x.txnId || '—')}</b>`],
      [t('ধরন', 'Kind'), x.kind === 'deposit' ? t('জমা', 'Deposit') : t('উত্তোলন', 'Withdrawal')],
      [t('বিভাগ', 'Category'), esc(tx(x.kindLabel.bn))],
      [t('পদ্ধতি', 'Method'), esc(tx(methodLabel(x.method).bn))],
      [t('পরিমাণ', 'Amount'), `<b class="${x.kind === 'deposit' ? 'adv-amt' : 'due-amt'}">${taka(x.amount)}</b>`],
      [t('পেমেন্টের তারিখ', 'Payment date'), esc(fmtDate(x.date))],
      [t('সদস্য', 'Member'), `<b>${esc(x.memberName || '')}</b> (${esc(x.memberId || '')})`],
      [t('দাখিল', 'Submitted'), esc(fmtDateTime(x.submittedAt))],
      [t('স্ট্যাটাস', 'Status'), statusTag(x.status)],
      ...(x.rejectReason ? [[t('বাতিলের কারণ', 'Reason'), esc(x.rejectReason)]] : []),
      ...(x.description ? [[t('বিবরণ', 'Description'), esc(x.description)]] : []),
    ]),
    actions: [{ label: t('বন্ধ করুন', 'Close'), value: true, kind: 'ghost' }],
  });
}
