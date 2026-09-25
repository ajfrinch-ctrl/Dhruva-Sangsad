/* Dashboard — greeting · summary · ONE full-width Submit Deposit action.
 *
 * There is deliberately NO “Important Notice” card here: approvals, dues and
 * announcements arrive through the notification bell (top bar) and through the
 * dedicated Pending Requests screen. The dashboard only states the current
 * position of the organisation / the member, plus the single primary action.
 */
import { el, esc, taka, num, fmtDate, fmtTime, todayISO, t, tx } from '../util.js';
import { icon } from '../icons.js';
import { page, statCard, statusTag, heroCard, actionCard, sectionHead } from '../ui.js';
import {
  allMembers, allDeposits, allWithdrawals, settings, memberSummary, summariesFor,
  orgTotals, getMember, withdrawalBalance, summaryOpts,
} from '../store.js';
import { App } from '../app.js';

/* ---------------- shared building blocks ---------------- */

/** Time-based greeting: সুপ্রভাত 05–11:59 · শুভ অপরাহ্ণ 12–16:59 · শুভ সন্ধ্যা 17–19:59 · শুভ রাত্রি 20–04:59 */
export function greetingLine() {
  const h = new Date().getHours();
  return h >= 5 && h < 12 ? t('সুপ্রভাত', 'Good morning')
    : h >= 12 && h < 17 ? t('শুভ অপরাহ্ণ', 'Good afternoon')
    : h >= 17 && h < 20 ? t('শুভ সন্ধ্যা', 'Good evening')
    : t('শুভ রাত্রি', 'Good night');
}

function greetBox(name, sub) {
  const box = el('div', { class: 'greet' });
  box.innerHTML = `<div class="greet-hi">${esc(greetingLine())}${name ? `, ${esc(name)}` : ''}</div>
    <div class="greet-sub">${esc(sub || '')}</div>
    <div class="greet-date">${icon('calendar')}${esc(fmtDate(todayISO()))} · ${esc(fmtTime(new Date().toISOString()))}</div>`;
  return box;
}

/** The single primary action of the whole app: full width, never a FAB and
 *  never duplicated on another dashboard card. */
function submitDeposit() {
  return actionCard({
    label: t('জমা দাখিল করুন', 'Submit Deposit'),
    sub: t('নতুন জমা যোগ করুন', 'Record a new deposit'),
    ic: 'plus', tone: 'primary',
    onClick: () => App.go('deposits', 'new'),
  });
}

function recentRows(rows, onOpen) {
  const box = el('div', { class: 'card' });
  rows.forEach((r, i) => {
    const row = el('button', { type: 'button', class: 'row tappable', style: i ? 'border-top:1px solid var(--line-2)' : '' });
    row.innerHTML = `<span class="rw-ic ${r.tone}">${icon(r.ic)}</span>
      <span class="rw-bd"><span class="rw-t">${esc(r.title)}</span><span class="rw-s">${esc(r.sub)}</span></span>
      <span class="rw-amt">${r.amount}</span>`;
    row.addEventListener('click', onOpen);
    box.appendChild(row);
  });
  return box;
}

const thisMonth = () => todayISO().slice(0, 7);

/* ================= MEMBER DASHBOARD ================= */
async function memberHome(session, params) {
  const [members, deposits, withdrawals, cfg] = await Promise.all([
    allMembers(), allDeposits(), allWithdrawals(), settings(),
  ]);
  const m = members.find(x => x.id === session.memberDocId) || await getMember(session.memberDocId);
  const wrap = page(t('আমার ড্যাশবোর্ড', 'My Dashboard'), 'Dashboard', 'dashboard');
  if (!m) {
    wrap.appendChild(el('div', { class: 'banner err', html: `${icon('warn')}<span>${esc(t('সদস্য তথ্য পাওয়া যায়নি। সহায়তার জন্য অ্যাডমিনের সাথে যোগাযোগ করুন।', 'Member record not found. Please contact your admin.'))}</span>` }));
    return wrap;
  }

  const s = memberSummary(m, deposits, summaryOpts(cfg, { withdrawals }));
  const bal = withdrawalBalance(m, deposits, withdrawals);
  const monthTotal = s.deposits.filter(d => String(d.date).slice(0, 7) === thisMonth())
    .reduce((a, d) => a + num(d.amount), 0);

  /* 1 — greeting */
  wrap.appendChild(greetBox(m.nameBn || m.nameEn, t(`ধ্রুব সংসদে স্বাগত — সদস্য আইডি ${m.memberId}`, `Welcome to ${cfg.orgNameEn || 'Dhruva Sangsad'} — Member ID ${m.memberId}`)));

  /* 2 — ONE full-width primary action */
  wrap.appendChild(submitDeposit());

  /* 3 — balance hero */
  wrap.appendChild(heroCard({
    label: t('আমার মোট জমা', 'My total deposit'),
    value: taka(s.totalDeposit),
    sub: `${s.count} ${t('টি অনুমোদিত জমা', 'approved deposits')} · ${t('এই মাসে', 'this month')} ${taka(monthTotal)}`,
    target: s.required, achieved: Math.min(s.installmentPaid, s.required),
  }));

  /* 4 — summary (2-column grid is correct here: these are parallel figures) */
  const stats = el('div', { class: 'stats' });
  stats.append(
    statCard({ label: t('মাসিক কিস্তি', 'Monthly installment'), value: taka(m.installment), sub: t('নির্ধারিত হার', 'fixed rate'), ic: 'wallet' }),
    statCard({ label: t('বকেয়া', 'Due'), value: taka(s.due), sub: s.due > 0 ? t('অনুমোদিত জমার ভিত্তিতে', 'based on approved deposits') : t('সব পরিশোধিত', 'all clear'), ic: 'due', tone: s.due > 0 ? 'red' : '' }),
    statCard({ label: t('অগ্রিম', 'Advance'), value: taka(s.advance), sub: s.advance > 0 ? t('অতিরিক্ত জমা', 'extra paid') : '—', ic: 'advance', tone: 'blue' }),
    statCard({ label: t('উপলব্ধ ব্যালান্স', 'Available balance'), value: taka(bal.available), sub: t('উত্তোলনযোগ্য', 'withdrawable'), ic: 'money' }),
    statCard({ label: t('মোট উত্তোলন', 'Total withdrawal'), value: taka(s.totalWithdrawal), sub: t('অনুমোদিত', 'approved'), ic: 'withdraw', tone: 'amber' }),
    statCard({ label: t('সদস্যপদ', 'Membership'), value: statusTag(m.status), sub: `${t('আইডি', 'ID')} ${m.memberId}`, ic: 'member', tone: 'gray' }),
  );
  wrap.appendChild(stats);

  /* 5 — pending items (status only, not a permanent notice board) */
  const pending = s.deposits.filter(d => d.status !== 'approved').concat(
    s.withdrawals.filter(w => w.status !== 'approved'),
  ).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  if (pending.length) {
    wrap.appendChild(sectionHead(t('অপেক্ষমাণ জমা/উত্তোলন', 'Waiting for approval'), 'Pending', t('সব দেখুন ›', 'See all ›'), () => App.go('deposits')));
    wrap.appendChild(recentRows(pending.slice(0, 3).map(d => ({
      ic: d.status === 'pending' ? 'clock' : 'reject',
      tone: d.status === 'pending' ? 'a' : 'r',
      title: `${fmtDate(d.date)} · ${d.kindLabelEn || ''}`.trim(),
      sub: d.rejectReason || d.description || t('অনুমোদনের অপেক্ষায়', 'Waiting for approval'),
      amount: statusTag(d.status),
    })), () => App.go('deposits')));
  }

  /* 6 — recent account activity (chronological, links to the statement) */
  const recent = s.deposits.concat(s.withdrawals).sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 4);
  if (recent.length) {
    wrap.appendChild(sectionHead(t('সাম্প্রতিক লেনদেন', 'Recent activity'), 'Recent', t('স্টেটমেন্ট ›', 'Statement ›'), () => App.go('statements')));
    wrap.appendChild(recentRows(recent.map(d => ({
      ic: d.amount && d.kindLabelEn === 'Withdrawal' ? 'withdraw' : 'deposit',
      tone: d.status === 'approved' ? 'g' : d.status === 'pending' ? 'a' : 'r',
      title: `${fmtDate(d.date)} · ${taka(d.amount)}`,
      sub: d.description || (d.txnId ? `#${d.txnId}` : ''),
      amount: statusTag(d.status),
    })), () => App.go('statements')));
  }

  return wrap;
}

/* ================= STAFF DASHBOARD ================= */
async function staffHome(session, params) {
  const [members, deposits, withdrawals, cfg] = await Promise.all([
    allMembers(), allDeposits(), allWithdrawals(), settings(),
  ]);
  const wrap = page(t('ড্যাশবোর্ড', 'Dashboard'), 'Dashboard', 'dashboard');

  const active = members.filter(m => m.status === 'active');
  const pendingMembers = members.filter(m => m.status === 'pending');
  const pendingDeposits = deposits.filter(d => d.status === 'pending');
  const pendingWithdrawals = withdrawals.filter(w => w.status === 'pending');
  const pendingTotal = pendingMembers.length + pendingDeposits.length + pendingWithdrawals.length;

  const sums = await summariesFor(members.filter(m => m.status !== 'rejected'), deposits, cfg);
  const tot = orgTotals(sums);
  const monthDeposits = deposits.filter(d => d.status === 'approved' && String(d.date || '').slice(0, 7) === thisMonth());
  const monthTotal = monthDeposits.reduce((a, d) => a + num(d.amount), 0);
  const target = num(cfg.monthlyTarget) || active.reduce((a, m) => a + num(m.installment), 0);

  /* 1 — greeting */
  wrap.appendChild(greetBox(session.displayName || session.username, t(`আজ ${fmtDate(todayISO())} — সংগঠনের সারসংক্ষেপ`, `Overview for ${fmtDate(todayISO())}`)));

  /* 2 — the same single primary action as the member dashboard */
  wrap.appendChild(submitDeposit());

  /* 3 — organisation totals */
  wrap.appendChild(heroCard({
    label: t('মোট জমা', 'Total deposits'),
    value: taka(tot.totalDeposit),
    sub: `${t('এই মাসে', 'this month')} ${taka(monthTotal)} · ${monthDeposits.length} ${t('টি জমা', 'deposits')}`,
    target, achieved: monthTotal,
  }));

  /* 4 — summary grid */
  const stats = el('div', { class: 'stats' });
  stats.append(
    statCard({ label: t('মোট সদস্য', 'Total members'), value: String(members.length), sub: `${active.length} ${t('সক্রিয়', 'active')} · ${pendingMembers.length} ${t('অপেক্ষমাণ', 'pending')}`, ic: 'members', tone: 'blue' }),
    statCard({ label: t('মোট উত্তোলন', 'Total withdrawal'), value: taka(tot.totalWithdrawal), sub: t('অনুমোদিত উত্তোলন', 'approved withdrawals'), ic: 'withdraw', tone: 'red' }),
    statCard({ label: t('নিট ব্যালান্স', 'Net balance'), value: taka(tot.balance), sub: t('জমা − উত্তোলন', 'deposits − withdrawals'), ic: 'money', tone: 'blue' }),
    statCard({ label: t('মোট বকেয়া', 'Total due'), value: taka(tot.totalDue), sub: `${sums.filter(s => s.due > 0).length} ${t('জন সদস্য', 'member(s)')}`, ic: 'due', tone: 'red' }),
    statCard({ label: t('মোট অগ্রিম', 'Total advance'), value: taka(tot.totalAdvance), sub: `${sums.filter(s => s.advance > 0).length} ${t('জন সদস্য', 'member(s)')}`, ic: 'advance' }),
    statCard({ label: t('অপেক্ষমাণ', 'Pending'), value: String(pendingTotal), sub: t('অনুমোদনের অপেক্ষায়', 'waiting for a decision'), ic: 'pending', tone: pendingTotal ? 'amber' : '' }),
  );
  wrap.appendChild(stats);

  /* 5 — pending work: a compact status row that links to the dedicated
         Pending Requests screen (the only place approvals are performed). */
  if (pendingTotal) {
    wrap.appendChild(sectionHead(t('অপেক্ষমাণ অনুরোধ', 'Pending requests'), 'Pending', t('সব দেখুন ›', 'See all ›'), () => App.go('authorization')));
    const box = el('div', { class: 'card' });
    [
      pendingMembers.length ? { ic: 'members', tone: 'b', title: t('সদস্য অনুমোদন', 'Member approvals'), sub: t('নতুন নিবন্ধন', 'New registrations'), n: pendingMembers.length } : null,
      pendingDeposits.length ? { ic: 'deposit', tone: 'g', title: t('জমা অনুমোদন', 'Deposit approvals'), sub: t('জমার অনুরোধ', 'Deposits waiting'), n: pendingDeposits.length } : null,
      pendingWithdrawals.length ? { ic: 'withdraw', tone: 'a', title: t('উত্তোলন অনুমোদন', 'Withdrawal approvals'), sub: t('উত্তোলনের অনুরোধ', 'Withdrawals waiting'), n: pendingWithdrawals.length } : null,
    ].filter(Boolean).forEach((r, i) => {
      const row = el('button', { type: 'button', class: 'row tappable', style: i ? 'border-top:1px solid var(--line-2)' : '' });
      row.innerHTML = `<span class="rw-ic ${r.tone}">${icon(r.ic)}</span>
        <span class="rw-bd"><span class="rw-t">${esc(r.title)}</span><span class="rw-s">${esc(r.sub)}</span></span>
        <span class="rw-amt"><span class="pill">${r.n}</span></span>`;
      row.addEventListener('click', () => App.go('authorization'));
      box.appendChild(row);
    });
    wrap.appendChild(box);
  }

  /* 6 — latest deposits (glanceable, links into the Deposits ledger) */
  const latest = deposits.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 4);
  if (latest.length) {
    wrap.appendChild(sectionHead(t('সর্বশেষ জমা', 'Latest deposits'), 'Latest', t('সব দেখুন ›', 'See all ›'), () => App.go('deposits')));
    wrap.appendChild(recentRows(latest.map(d => ({
      ic: 'deposit',
      tone: d.status === 'approved' ? 'g' : d.status === 'pending' ? 'a' : 'r',
      title: `${fmtDate(d.date)} · ${taka(d.amount)}`,
      sub: `${d.memberName || ''}${d.memberId ? ' · ' + d.memberId : ''}`,
      amount: statusTag(d.status),
    })), () => App.go('deposits')));
  }

  return wrap;
}

export async function pageHome(session, params) {
  return session.role === 'member' ? memberHome(session, params) : staffHome(session, params);
}
