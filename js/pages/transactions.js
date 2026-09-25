/* Transactions — summary of money movements + today's compact list.
 *
 * A member's ledger is their own by definition, so the screen is titled
 * “My Transactions”. The list follows the app-wide rule for transaction lists:
 * TODAY only, latest 5, each row collapsed (name + amount) until tapped.
 */
import {
  el, esc, taka, money, num, fmtDate, fmtDateTime, todayISO, t, tx,
  typeLabel, methodLabel, STATUS_EN,
} from '../util.js';
import { page, statusTag, statCard, sectionHead, txnRow, todaysLatest } from '../ui.js';
import { allDeposits, allWithdrawals, withdrawalTypeLabel } from '../store.js';

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
  const [deposits, withdrawals] = await Promise.all([allDeposits(), allWithdrawals()]);
  const wrap = page(
    staff ? t('লেনদেন', 'Transactions') : t('আমার লেনদেন', 'My Transactions'),
    'Transactions', 'receipt',
  );

  /* Members: own rows only — enforced here, not by a filter the user must set. */
  const rows = combineTxns(deposits, withdrawals, staff ? {} : { forMember: session });

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

  /* ---- the list: TODAY's transactions only, latest 5, collapsed rows ----
     Older days are never shown in this compact list (the Statement covers
     history). No transaction today → the list section is hidden. */
  const todays = todaysLatest(rows, todayISO(), 5);
  if (todays.length) {
    wrap.appendChild(sectionHead(t('আজকের লেনদেন', 'Transactions'), 'Transactions'));
    const listHost = el('div', { class: 'txn-list' });
    todays.forEach(x => listHost.appendChild(txnRowOf(x, session)));
    wrap.appendChild(listHost);
  }
  return wrap;
}

/** Collapsed: member name + signed amount. Tap → full details. */
function txnRowOf(x, session) {
  const staff = isStaff(session);
  const dep = x.kind === 'deposit';
  const tone = x.status === 'approved' ? (dep ? 'g' : 'r') : x.status === 'pending' ? 'a' : 'r';
  return txnRow({
    ic: dep ? 'deposit' : 'withdraw', tone,
    name: x.memberName || x.memberId || '',
    meta: `${t(x.kindLabel.bn, x.kindLabel.en)} · ${tx(STATUS_EN[x.status] || x.status || '')}`,
    amount: `${dep ? '+' : '−'}${money(x.amount)}`,
    amountKind: x.status === 'rejected' ? '' : (dep ? 'in' : 'out'),
    details: [
      [t('পরিমাণ', 'Amount'), `<b class="${dep ? 'adv-amt' : 'due-amt'}">${taka(x.amount)}</b>`],
      [t('তারিখ', 'Date'), esc(fmtDate(x.date))],
      [t('ধরন', 'Kind'), dep ? t('জমা', 'Deposit') : t('উত্তোলন', 'Withdrawal')],
      [t('বিভাগ', 'Category'), esc(t(x.kindLabel.bn, x.kindLabel.en))],
      [t('পরিশোধ পদ্ধতি', 'Payment method'), esc(t(methodLabel(x.method).bn, methodLabel(x.method).en))],
      [t('স্ট্যাটাস', 'Status'), statusTag(x.status)],
      [t('লেনদেন আইডি', 'Transaction ID'), `<b class="txn-id-static">${esc(x.txnId || '—')}</b>`],
      ...(staff ? [[t('সদস্য আইডি', 'Member ID'), esc(x.memberId || '')]] : []),
      ...(x.description ? [[t('বিবরণ', 'Description'), esc(x.description)]] : []),
      [t('দাখিল', 'Submitted'), esc(fmtDateTime(x.submittedAt))],
      ...(x.rejectReason ? [[t('বাতিলের কারণ', 'Rejection reason'), esc(x.rejectReason)]] : []),
    ],
  });
}
