/* Dashboard — summary information only (no activity feed, no collection
   breakdown, no progress widgets, no detailed tables). */
import { el, esc, taka, num } from '../util.js';
import { icon } from '../icons.js';
import { page, statCard, banner, btn, card } from '../ui.js';
import { allMembers, allDeposits, settings, memberSummary, summariesFor, orgTotals, getMember } from '../store.js';
import { App } from '../app.js';

export async function pageHome(session) {
  return session.role === 'member' ? memberHome(session) : staffHome(session);
}

/* ================= STAFF DASHBOARD ================= */
async function staffHome(session) {
  const [members, deposits, cfg] = await Promise.all([allMembers(), allDeposits(), settings()]);
  const wrap = page('ড্যাশবোর্ড', 'Dashboard', 'dashboard');

  const active = members.filter(m => m.status === 'active');
  const pendingMembers = members.filter(m => m.status === 'pending');
  const pendingDeposits = deposits.filter(d => d.status === 'pending');
  const sums = await summariesFor(members.filter(m => m.status !== 'rejected'), deposits, cfg);
  const tot = orgTotals(sums);

  const stats = el('div', { class: 'stats' });
  stats.append(
    statCard({ label: 'মোট সদস্য / Total Members', value: `${members.length}`, sub: `${active.length} active · ${pendingMembers.length} pending`, ic: 'members', tone: 'blue' }),
    statCard({ label: 'মোট জমা / Total Deposits', value: taka(tot.totalDeposit), sub: 'অনুমোদিত জমা / approved', ic: 'money' }),
    statCard({ label: 'মোট বকেয়া / Total Due', value: taka(tot.totalDue), sub: `${sums.filter(s => s.due > 0).length} member(s)`, ic: 'due', tone: 'red' }),
    statCard({ label: 'মোট অগ্রিম / Total Advance', value: taka(tot.totalAdvance), sub: `${sums.filter(s => s.advance > 0).length} member(s)`, ic: 'advance' }),
    statCard({ label: 'অনুমোদন অপেক্ষমাণ / Pending Authorization', value: `${pendingMembers.length + pendingDeposits.length}`, sub: `${pendingMembers.length} member · ${pendingDeposits.length} deposit`, ic: 'pending', tone: 'amber' }),
  );
  wrap.appendChild(stats);
  return wrap;
}

/* ================= MEMBER DASHBOARD ================= */
async function memberHome(session) {
  const [deposits, cfg] = await Promise.all([allDeposits(), settings()]);
  const m = await getMember(session.memberDocId);
  const wrap = page('আমার ড্যাশবোর্ড', 'My Dashboard', 'dashboard');
  if (!m) { wrap.appendChild(banner('err', 'সদস্য তথ্য পাওয়া যায়নি / Member record not found')); return wrap; }

  const s = memberSummary(m, deposits, { countSpecialTowardsInstallment: cfg.countSpecialTowardsInstallment });

  if (m.status === 'pending') {
    wrap.appendChild(banner('warn', 'আপনার Registration <b>Pending Approval</b> অবস্থায় আছে। Maker/Admin অনুমোদনের পর আপনি নতুন জমা দিতে পারবেন।'));
  } else if (m.status === 'active') {
    wrap.appendChild(banner('ok', `আপনার Member ID <b>${esc(m.memberId)}</b> সক্রিয় (ACTIVE) আছে। আপনি জমা জমা দিতে পারবেন।`));
  } else if (m.status === 'rejected') {
    wrap.appendChild(banner('err', `আপনার সদস্যপদ বাতিল করা হয়েছে।${m.rejectReason ? ' কারণ: ' + esc(m.rejectReason) : ''}`));
  }

  const stats = el('div', { class: 'stats' });
  stats.append(
    statCard({ label: 'মোট জমা / Total Deposit', value: taka(s.totalDeposit), sub: `${s.count} অনুমোদিত লেনদেন`, ic: 'money' }),
    statCard({ label: 'মোট বকেয়া / Total Due', value: taka(s.due), sub: `প্রয়োজন ${taka(s.required)}`, ic: 'due', tone: s.due > 0 ? 'red' : '' }),
    statCard({ label: 'মোট অগ্রিম / Total Advance', value: taka(s.advance), sub: s.advance > 0 ? 'অতিরিক্ত জমা' : '—', ic: 'advance' }),
    statCard({ label: 'মাসিক কিস্তি / Installment', value: taka(m.installment), sub: `${s.months} মাস বিবেচিত`, ic: 'calendar', tone: 'blue' }),
    statCard({ label: 'স্ট্যাটাস / Status', value: `<span class="tag ${m.status === 'active' ? 'approved' : m.status}">${esc(m.status.toUpperCase())}</span>`, sub: `ID ${m.memberId}`, ic: 'member', tone: 'gray' }),
  );
  wrap.appendChild(stats);

  const acts = el('div', { class: 'btn-row' });
  if (m.status === 'active') acts.appendChild(btn('নতুন জমা / New Deposit', 'plus', 'primary', () => App.go('deposit')));
  acts.appendChild(btn('আমার Statement', 'report', 'ghost', () => App.go('reports', { report: 'statement' })));
  acts.appendChild(btn('আমার প্রোফাইল / Profile', 'member', 'ghost', () => App.go('member-panel')));
  wrap.appendChild(card('দ্রুত কাজ', 'Quick Actions', acts));
  return wrap;
}
