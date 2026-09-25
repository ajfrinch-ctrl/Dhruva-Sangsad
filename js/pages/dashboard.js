/* Dashboard — greeting → notices → summary. Clean, no shortcut collection,
   no activity-log button, no floating "Submit Deposit" and no status banner:
   approval info lives in Notifications, and the dashboard only shows state. */
import { el, esc, taka, num, money, fmtDate, fmtTime, todayISO, t } from '../util.js';
import { icon } from '../icons.js';
import { page, statCard, statusTag } from '../ui.js';
import {
  allMembers, allDeposits, allWithdrawals, settings, memberSummary, summariesFor,
  orgTotals, getMember, withdrawalBalance, summaryOpts, visibleNotifications,
} from '../store.js';
import { App } from '../app.js';

/* ---------------- shared building blocks ---------------- */

/** Time-based greeting (05:00–11:59 / 12:00–16:59 / 17:00–19:59 / 20:00–04:59). */
export function greetingLine() {
  const h = new Date().getHours();
  return h >= 5 && h < 12 ? t('সুপ্রভাত', 'Good morning')
    : h >= 12 && h < 17 ? t('শুভ অপরাহ্ণ', 'Good afternoon')
    : h >= 17 && h < 20 ? t('শুভ সন্ধ্যা', 'Good evening')
    : t('শুভ রাত্রি', 'Good night');
}

function greetBox(name, orgName) {
  const box = el('div', { class: 'greet' });
  box.innerHTML = `<div class="greet-hi">${esc(greetingLine())}</div>
    <div class="greet-sub">${esc(name ? name + ' — ' : '')}${esc(t(`ধ্রুব সংসদে আপনাকে স্বাগতম।`, `Welcome to ${orgName || 'Dhruva Sangsad'}.`))}</div>
    <div class="greet-date">${icon('calendar')}${esc(fmtDate(todayISO()))} · ${esc(fmtTime(new Date().toISOString()))}</div>`;
  return box;
}

/** Big gradient summary card: one number, one progress line. */
function heroCard({ label, value, sub, target = 0, achieved = 0 }) {
  const pct = target > 0 ? Math.min(100, Math.round((achieved / target) * 100)) : 0;
  const box = el('div', { class: 'hero-card' });
  box.innerHTML = `<div class="hc-lbl"><span>${esc(label)}</span>${target ? `<span>${esc(t('লক্ষ্য ', 'Target '))}${esc(money(target))}</span>` : ''}</div>
    <div class="hc-val num">${esc(value)}</div>
    ${sub ? `<div class="hc-sub">${esc(sub)}</div>` : ''}
    ${target ? `<div class="hc-bar"><i style="width:${pct}%"></i></div>
      <div class="hc-foot"><span>${esc(money(achieved))}</span><span>${pct}%</span></div>` : ''}`;
  return box;
}

/** Important notices (from the notification store) — max 3 rows, tap → bell. */
async function noticesCard(session) {
  let items = [];
  try { items = (await visibleNotifications(session)).slice(0, 3); } catch { return null; }
  if (!items.length) return null;
  const box = el('div', { class: 'card notice-card' });
  const head = el('div', { class: 'card-head' });
  head.innerHTML = `<h3>${icon('bell')} ${esc(t('গুরুত্বপূর্ণ নোটিশ', 'Important notices'))}</h3><span class="spacer"></span>`;
  head.appendChild(el('button', { type: 'button', class: 'link-btn', text: t('সব দেখুন ›', 'See all ›'), onclick: () => import('./misc.js').then(m => m.openNotifications(App.session)) }));
  const body = el('div', { class: 'card-body tight' });
  items.forEach(n => {
    const row = el('div', { class: 'act' });
    const tone = n.kind === 'due' || n.kind === 'reject' ? 'r' : n.kind === 'approve' ? 'g' : 'a';
    row.innerHTML = `<span class="ai ${tone}">${icon(n.kind === 'due' ? 'due' : n.kind === 'approve' ? 'approve' : n.kind === 'reject' ? 'reject' : 'bell')}</span>
      <span class="ab"><span class="at">${esc(n.title)}</span><span class="as">${esc(n.body || '')}</span></span>
      <span class="aw">${esc(fmtDate(n.createdAt))}</span>`;
    body.appendChild(row);
  });
  box.append(head, body);
  return box;
}

/** “Pending work” rows — status information for the approving role. */
function pendingCard(rows) {
  const box = el('div', { class: 'card' });
  rows.forEach((r, i) => {
    const row = el('button', { type: 'button', class: 'appr', style: 'width:100%;text-align:left;border-radius:0;border-left:0;border-right:0;border-top:' + (i ? '1px solid var(--line-2)' : '0'), onclick: r.run });
    row.innerHTML = `<span class="ic ${r.tone || ''}">${icon(r.ic)}</span>
      <span class="bd"><span class="tt">${esc(r.label)}</span><span class="ss">${esc(r.sub)}</span></span>
      <span class="amt num">${esc(r.count)}</span>
      <span class="go" style="color:var(--faint)">${icon('chevron')}</span>`;
    box.appendChild(row);
  });
  return box;
}

const thisMonth = () => todayISO().slice(0, 7);

/* ================= STAFF DASHBOARD ================= */
async function staffHome(session) {
  const [members, deposits, withdrawals, cfg] = await Promise.all([
    allMembers(), allDeposits(), allWithdrawals(), settings(),
  ]);
  const wrap = page('ড্যাশবোর্ড', 'Dashboard', 'dashboard');

  const active = members.filter(m => m.status === 'active');
  const pendingMembers = members.filter(m => m.status === 'pending');
  const pendingDeposits = deposits.filter(d => d.status === 'pending');
  const pendingWithdrawals = withdrawals.filter(w => w.status === 'pending');
  const sums = await summariesFor(members.filter(m => m.status !== 'rejected'), deposits, cfg);
  const tot = orgTotals(sums);

  const monthDeposits = deposits.filter(d => d.status === 'approved' && String(d.date || '').slice(0, 7) === thisMonth());
  const monthTotal = monthDeposits.reduce((s, d) => s + num(d.amount), 0);
  const target = num(cfg.monthlyTarget) || active.reduce((s, m) => s + num(m.installment), 0);

  /* 0 — greeting */
  wrap.appendChild(greetBox('', cfg.orgNameBn || cfg.orgNameEn));

  /* 1 — notices (approvals & dues surface here, not as permanent banners) */
  const notices = await noticesCard(session);
  if (notices) wrap.appendChild(notices);

  /* 2 — hero */
  wrap.appendChild(heroCard({
    label: t('মোট জমা', 'Total deposits'),
    value: taka(tot.totalDeposit),
    sub: `${t('এই মাসে', 'This month')} ${taka(monthTotal)} · ${monthDeposits.length} ${t('টি জমা', 'deposits')}`,
    target, achieved: monthTotal,
  }));

  /* 3 — summary cards (2-column grid; an odd last card keeps its size) */
  const stats = el('div', { class: 'stats' });
  stats.append(
    statCard({ label: 'মোট সদস্য / Total Members', value: `${members.length}`, sub: `${active.length} active · ${pendingMembers.length} pending`, ic: 'members', tone: 'blue' }),
    statCard({ label: 'মোট জমা / Total Deposits', value: taka(tot.totalDeposit), sub: 'অনুমোদিত জমা / approved', ic: 'money' }),
    statCard({ label: 'মোট উত্তোলন / Total Withdrawal', value: taka(tot.totalWithdrawal), sub: 'অনুমোদিত উত্তোলন / approved', ic: 'withdraw', tone: 'red' }),
    statCard({ label: 'নিট ব্যালান্স / Net Balance', value: taka(tot.balance), sub: 'জমা − উত্তোলন', ic: 'money', tone: 'blue' }),
    statCard({ label: 'মোট বকেয়া / Total Due', value: taka(tot.totalDue), sub: `${sums.filter(s => s.due > 0).length} member(s)`, ic: 'due', tone: 'red' }),
    statCard({ label: 'মোট অগ্রিম / Total Advance', value: taka(tot.totalAdvance), sub: `${sums.filter(s => s.advance > 0).length} member(s)`, ic: 'advance' }),
  );
  wrap.appendChild(stats);

  /* 4 — current status: what is waiting for a decision */
  const canApprove = pendingMembers.length || pendingDeposits.length || pendingWithdrawals.length;
  if (canApprove) {
    const head = el('div', { class: 'sec-head' });
    head.innerHTML = `<h2>${esc(t('অপেক্ষমাণ কাজ', 'Pending work'))}</h2><span class="sp"></span>`;
    const seeAll = el('button', { type: 'button', class: 'link-btn', text: t('সব দেখুন ›', 'See all ›'), onclick: () => App.go('authorization') });
    head.appendChild(seeAll);
    wrap.appendChild(head);
    wrap.appendChild(pendingCard([
      { ic: 'members', tone: 'member', label: t('সদস্য অনুমোদন', 'Member approvals'), sub: t('নতুন নিবন্ধন', 'New registrations'), count: pendingMembers.length, run: () => App.go('authorization') },
      { ic: 'deposit', tone: 'deposit', label: t('জমা অনুমোদন', 'Deposit approvals'), sub: t('জমা অনুমোদনের অপেক্ষায়', 'Waiting for approval'), count: pendingDeposits.length, run: () => App.go('authorization') },
      { ic: 'withdraw', tone: 'withdrawal', label: t('উত্তোলন অনুমোদন', 'Withdrawal approvals'), sub: t('উত্তোলনের অনুরোধ', 'Withdrawal requests'), count: pendingWithdrawals.length, run: () => App.go('authorization') },
    ]));
  }

  return wrap;
}

/* ================= MEMBER DASHBOARD ================= */
async function memberHome(session) {
  const [deposits, withdrawals, cfg] = await Promise.all([allDeposits(), allWithdrawals(), settings()]);
  const m = await getMember(session.memberDocId);
  const wrap = page('আমার ড্যাশবোর্ড', 'My Dashboard', 'dashboard');
  if (!m) { wrap.appendChild(el('div', { class: 'banner err', html: 'সদস্য তথ্য পাওয়া যায়নি / Member record not found' })); return wrap; }

  const s = memberSummary(m, deposits, summaryOpts(cfg, { withdrawals }));
  const bal = withdrawalBalance(m, deposits, withdrawals);

  /* 0 — greeting (no permanent "your ID is active" banner — approval news
        already arrives through Notifications) */
  wrap.appendChild(greetBox(m.nameBn || m.nameEn, cfg.orgNameBn));

  /* 1 — notices */
  const notices = await noticesCard(session);
  if (notices) wrap.appendChild(notices);

  /* 2 — hero: my savings + monthly progress */
  wrap.appendChild(heroCard({
    label: t('আমার মোট জমা', 'My total deposit'),
    value: taka(s.totalDeposit),
    sub: `${s.count} ${t('টি অনুমোদিত জমা', 'approved deposits')}`,
    target: s.required, achieved: Math.min(s.installmentPaid, s.required),
  }));

  /* 3 — summary cards */
  const stats = el('div', { class: 'stats' });
  stats.append(
    statCard({ label: 'মাসিক কিস্তি / Monthly', value: taka(m.installment), sub: t('নির্ধারিত হার', 'fixed rate'), ic: 'wallet' }),
    statCard({ label: 'মোট জমা / Total Deposit', value: taka(s.totalDeposit), sub: `${s.count} অনুমোদিত লেনদেন`, ic: 'money' }),
    statCard({ label: 'উপলব্ধ ব্যালান্স / Available', value: taka(bal.available), sub: 'উত্তোলনযোগ্য / withdrawable', ic: 'money', tone: 'blue' }),
    statCard({ label: 'মোট বকেয়া / Due', value: taka(s.due), sub: s.due > 0 ? t('অনুমোদনের অপেক্ষায় নেই — যত দ্রুত সম্ভব জমা দিন', 'pay at your earliest convenience') : t('সব ঠিক আছে', 'all clear'), ic: 'due', tone: s.due > 0 ? 'red' : '' }),
    statCard({ label: 'মোট অগ্রিম / Advance', value: taka(s.advance), sub: s.advance > 0 ? 'অতিরিক্ত জমা' : '—', ic: 'advance' }),
    statCard({ label: 'সদস্যপদ / Membership', value: statusTag(m.status), sub: `${t('আইডি', 'ID')} ${m.memberId}`, ic: 'member', tone: 'gray' }),
  );
  wrap.appendChild(stats);

  /* 4 — my pending / rejected deposits as current status (information only) */
  const mine = deposits.filter(d => (d.memberDocId === m.id || d.memberId === m.memberId) && d.status !== 'approved')
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  if (mine.length) {
    const head = el('div', { class: 'sec-head' });
    head.innerHTML = `<h2>${esc(t('আমার জমার অবস্থা', 'My deposit status'))}</h2><span class="sp"></span>`;
    wrap.appendChild(head);
    const box = el('div', { class: 'card' });
    mine.slice(0, 4).forEach((d, i) => {
      const row = el('div', { class: 'act' });
      row.innerHTML = `<span class="ai ${d.status === 'pending' ? 'a' : 'r'}">${icon(d.status === 'pending' ? 'clock' : 'reject')}</span>
        <span class="ab"><span class="at">${fmtDate(d.date)} · ${money(d.amount)}</span>
        <span class="as">${esc(d.rejectReason || d.description || (d.status === 'pending' ? t('অনুমোদনের অপেক্ষায়', 'Waiting for approval') : t('বাতিল', 'Rejected')))}</span></span>
        <span class="aw">${statusTag(d.status)}</span>`;
      box.appendChild(row);
    });
    wrap.appendChild(box);
  }

  return wrap;
}

export async function pageHome(session) {
  return session.role === 'member' ? memberHome(session) : staffHome(session);
}
