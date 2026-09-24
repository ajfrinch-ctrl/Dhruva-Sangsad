/* Dashboard — mobile-first: hero → quick actions → 2-column stats → pending → activity.
   Same numbers as before, arranged for a phone screen first. */
import { el, esc, taka, num, money, fmtDate, fmtTime, todayISO, t } from '../util.js';
import { icon } from '../icons.js';
import { page, card, statCard, banner, btn } from '../ui.js';
import {
  allMembers, allDeposits, allWithdrawals, allLogs, settings, memberSummary, summariesFor,
  orgTotals, getMember, withdrawalBalance, summaryOpts, logUserName,
} from '../store.js';
import { actionMeta } from './misc.js';
import { App } from '../app.js';

/* ---------------- shared building blocks ---------------- */

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

/** Icon tiles for the 3–4 things people do most. */
function quickRow(items) {
  const row = el('div', { class: 'hub-grid quick-grid' });
  items.filter(Boolean).forEach(it => {
    const b = el('button', { type: 'button', class: `hub-tile${it.tone ? ' ' + it.tone : ''}`, onclick: it.run });
    b.innerHTML = `<span class="tic">${icon(it.ic)}</span>
      <span class="tb"><span class="tt">${esc(it.label)}</span></span>`;
    row.appendChild(b);
  });
  return row;
}

/** “Pending work” rows — tapping one jumps straight to that queue. */
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

function activityCard(logs) {
  const box = el('div', { class: 'card' });
  const body = el('div', { class: 'card-body' });
  if (!logs.length) {
    body.appendChild(el('div', { class: 'empty', html: `${icon('log')}${esc(t('এখনো কোনো কার্যক্রম নেই', 'No activity yet'))}` }));
  } else {
    logs.slice(0, 6).forEach(l => {
      const meta = actionMeta(l.action);
      const row = el('div', { class: 'act' });
      row.innerHTML = `<span class="ai">${icon(meta.ic)}</span>
        <span class="ab"><span class="at">${esc(meta.bn)}</span>
          <span class="as">${esc(logUserName(l))}${l.details ? ' · ' + esc(l.details) : ''}</span></span>
        <span class="aw">${esc(fmtDate(l.createdAt))}<br>${esc(fmtTime(l.createdAt))}</span>`;
      body.appendChild(row);
    });
  }
  box.appendChild(body);
  return box;
}

const thisMonth = () => todayISO().slice(0, 7);

/* ================= STAFF DASHBOARD ================= */
async function staffHome(session) {
  const [members, deposits, withdrawals, cfg, logs] = await Promise.all([
    allMembers(), allDeposits(), allWithdrawals(), settings(), allLogs(),
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

  /* 1 — hero */
  wrap.appendChild(heroCard({
    label: t('মোট জমা', 'Total deposits'),
    value: taka(tot.totalDeposit),
    sub: `${t('এই মাসে', 'This month')} ${taka(monthTotal)} · ${monthDeposits.length} ${t('টি জমা', 'deposits')}`,
    target, achieved: monthTotal,
  }));

  /* 2 — quick actions */
  const quick = [];
  if (session.role !== 'member') quick.push({ ic: 'member', label: t('সদস্য যোগ', 'Add member'), run: () => App.go('members', { tab: 'register' }) });
  quick.push({ ic: 'deposit', label: t('জমা যোগ', 'Add deposit'), run: () => App.go('deposit', { tab: 'entry' }) });
  if (session.role !== 'member') quick.push({ ic: 'approve', tone: 'warn', label: t('অনুমোদন', 'Approvals'), run: () => App.go('authorization') });
  quick.push({ ic: 'report', tone: 'info', label: t('রিপোর্ট', 'Reports'), run: () => App.go('reports') });
  wrap.appendChild(quickRow(quick));

  /* 3 — stats (unchanged numbers, 2 columns on a phone) */
  const stats = el('div', { class: 'stats' });
  stats.append(
    statCard({ label: 'মোট সদস্য / Total Members', value: `${members.length}`, sub: `${active.length} active · ${pendingMembers.length} pending`, ic: 'members', tone: 'blue' }),
    statCard({ label: 'মোট জমা / Total Deposits', value: taka(tot.totalDeposit), sub: 'অনুমোদিত জমা / approved', ic: 'money' }),
    statCard({ label: 'মোট উত্তোলন / Total Withdrawal', value: taka(tot.totalWithdrawal), sub: 'অনুমোদিত উত্তোলন / approved', ic: 'withdraw', tone: 'red' }),
    statCard({ label: 'নিট ব্যালান্স / Net Balance', value: taka(tot.balance), sub: 'জমা − উত্তোলন', ic: 'money', tone: 'blue' }),
    statCard({ label: 'মোট বকেয়া / Total Due', value: taka(tot.totalDue), sub: `${sums.filter(s => s.due > 0).length} member(s)`, ic: 'due', tone: 'red' }),
    statCard({ label: 'মোট অগ্রিম / Total Advance', value: taka(tot.totalAdvance), sub: `${sums.filter(s => s.advance > 0).length} member(s)`, ic: 'advance' }),
    statCard({ label: 'অনুমোদন অপেক্ষমাণ / Pending', value: `${pendingMembers.length + pendingDeposits.length + pendingWithdrawals.length}`, sub: `${pendingMembers.length} member · ${pendingDeposits.length} deposit · ${pendingWithdrawals.length} withdrawal`, ic: 'pending', tone: 'amber' }),
  );
  wrap.appendChild(stats);

  /* 4 — pending work */
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

  /* 5 — recent activity */
  const head2 = el('div', { class: 'sec-head' });
  head2.innerHTML = `<h2>${esc(t('সাম্প্রতিক কার্যক্রম', 'Recent activity'))}</h2><span class="sp"></span>`;
  head2.appendChild(el('button', {
    type: 'button', class: 'link-btn', text: t('সব দেখুন ›', 'See all ›'),
    onclick: () => App.go('settings', { tab: 'activity' }),
  }));
  wrap.appendChild(head2);
  wrap.appendChild(activityCard(logs.slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))));

  return wrap;
}

/* ================= MEMBER DASHBOARD ================= */
async function memberHome(session) {
  const [deposits, withdrawals, cfg, logs] = await Promise.all([allDeposits(), allWithdrawals(), settings(), allLogs()]);
  const m = await getMember(session.memberDocId);
  const wrap = page('আমার ড্যাশবোর্ড', 'My Dashboard', 'dashboard');
  if (!m) { wrap.appendChild(banner('err', 'সদস্য তথ্য পাওয়া যায়নি / Member record not found')); return wrap; }

  const s = memberSummary(m, deposits, summaryOpts(cfg, { withdrawals }));
  const bal = withdrawalBalance(m, deposits, withdrawals);

  if (m.status === 'pending') {
    wrap.appendChild(banner('warn', 'আপনার Registration <b>Pending Approval</b> অবস্থায় আছে। Maker/Admin অনুমোদনের পর আপনি নতুন জমা দিতে পারবেন।'));
  } else if (m.status === 'active') {
    wrap.appendChild(banner('ok', `আপনার Member ID <b>${esc(m.memberId)}</b> সক্রিয় (ACTIVE) আছে। আপনি জমা জমা দিতে পারবেন।`));
  } else if (m.status === 'rejected') {
    wrap.appendChild(banner('err', `আপনার সদস্যপদ বাতিল করা হয়েছে।${m.rejectReason ? ' কারণ: ' + esc(m.rejectReason) : ''}`));
  }

  /* 1 — hero */
  wrap.appendChild(heroCard({
    label: t('আমার মোট জমা', 'My total deposit'),
    value: taka(s.totalDeposit),
    sub: `${s.count} ${t('টি অনুমোদিত জমা', 'approved deposits')}`,
    target: s.required, achieved: Math.min(s.installmentPaid, s.required),
  }));

  /* 2 — quick actions */
  const quick = [];
  if (m.status === 'active') {
    quick.push({ ic: 'deposit', label: t('জমা দাখিল', 'Submit deposit'), run: () => App.go('deposit') });
    quick.push({ ic: 'withdraw', tone: 'danger', label: t('উত্তোলন', 'Withdrawal'), run: () => App.go('deposit', { tab: 'withdrawal' }) });
  }
  quick.push({ ic: 'report', tone: 'info', label: t('আমার স্টেটমেন্ট', 'My statement'), run: () => App.go('reports', { report: 'statement' }) });
  quick.push({ ic: 'member', label: t('আমার প্রোফাইল', 'My profile'), run: () => App.go('member-panel') });
  wrap.appendChild(quickRow(quick));

  /* 3 — stats */
  const stats = el('div', { class: 'stats' });
  stats.append(
    statCard({ label: 'মোট জমা / Total Deposit', value: taka(s.totalDeposit), sub: `${s.count} অনুমোদিত লেনদেন`, ic: 'money' }),
    statCard({ label: 'মোট উত্তোলন / Total Withdrawal', value: taka(s.totalWithdrawal), sub: `${s.withdrawals.length} অনুমোদিত`, ic: 'withdraw', tone: 'red' }),
    statCard({ label: 'উপলব্ধ ব্যালান্স / Available Balance', value: taka(bal.available), sub: 'উত্তোলনযোগ্য / withdrawable', ic: 'money', tone: 'blue' }),
    statCard({ label: 'মোট বকেয়া / Total Due', value: taka(s.due), sub: `প্রয়োজন ${taka(s.required)}`, ic: 'due', tone: s.due > 0 ? 'red' : '' }),
    statCard({ label: 'মোট অগ্রিম / Total Advance', value: taka(s.advance), sub: s.advance > 0 ? 'অতিরিক্ত জমা' : '—', ic: 'advance' }),
    statCard({ label: 'স্ট্যাটাস / Status', value: `<span class="tag ${m.status === 'active' ? 'approved' : m.status}">${esc(m.status.toUpperCase())}</span>`, sub: `ID ${m.memberId}`, ic: 'member', tone: 'gray' }),
  );
  wrap.appendChild(stats);

  /* 4 — my pending / rejected deposits */
  const mine = deposits.filter(d => (d.memberDocId === m.id || d.memberId === m.memberId) && d.status !== 'approved')
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  if (mine.length) {
    const head = el('div', { class: 'sec-head' });
    head.innerHTML = `<h2>${esc(t('অপেক্ষমাণ ও বাতিল জমা', 'Pending & rejected'))}</h2><span class="sp"></span>`;
    wrap.appendChild(head);
    wrap.appendChild(pendingCard(mine.slice(0, 5).map(d => ({
      ic: d.status === 'pending' ? 'clock' : 'reject',
      tone: d.status === 'pending' ? 'withdrawal' : '',
      label: `${fmtDate(d.date)} · ${money(d.amount)}`,
      sub: d.rejectReason || d.description || (d.status === 'pending' ? t('অনুমোদনের অপেক্ষায়', 'Waiting for approval') : t('বাতিল', 'Rejected')),
      count: '',
      run: () => App.go('deposit', { tab: 'transactions' }),
    }))));
  }

  /* 5 — my activity */
  const mineLogs = logs.filter(l => l.userId === session.id)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  if (mineLogs.length) {
    const head = el('div', { class: 'sec-head' });
    head.innerHTML = `<h2>${esc(t('আমার কার্যক্রম', 'My activity'))}</h2><span class="sp"></span>`;
    wrap.appendChild(head);
    wrap.appendChild(activityCard(mineLogs));
  }

  return wrap;
}

export async function pageHome(session) {
  return session.role === 'member' ? memberHome(session) : staffHome(session);
}
