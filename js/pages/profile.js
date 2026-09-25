/* My Profile — the single home of "who am I".
 *
 * Read-only identity, contact and membership information (members see their own
 * record only; staff see their account). It deliberately duplicates NOTHING:
 *   · editing a member          → Member Management (staff)
 *   · Change Password, Activity Log → Settings
 *   · deposits / statements / transactions → their own modules
 * A member can never edit their own profile — Maker/Admin corrects the data.
 * Change Password lives ONLY in Settings — there is no pointer/duplicate here.
 */
import { el, esc, fmtDate, t, taka } from '../util.js';
import { page, card, kv, banner, statusTag, statCard } from '../ui.js';
import {
  allDeposits, allWithdrawals, getMember, memberSummary, settings, summaryOpts, withdrawalBalance,
} from '../store.js';

export async function pageProfile(session) {
  const wrap = page(t('আমার প্রোফাইল', 'My Profile'), 'My Profile', 'member');
  if (session.role === 'member') await memberProfile(wrap, session);
  else staffProfile(wrap, session);
  return wrap;
}

/* ========================= member (own record) ========================= */

async function memberProfile(wrap, session) {
  const m = session.memberDocId ? await getMember(session.memberDocId) : null;
  if (!m) {
    wrap.appendChild(banner('err', esc(t('সদস্য প্রোফাইল পাওয়া যায়নি।', 'Member profile not found.'))));
    return;
  }

  if (m.status === 'pending') {
    wrap.appendChild(banner('warn', esc(t('আপনার সদস্যপদ অনুমোদনের অপেক্ষায়।', 'Your membership is awaiting approval.'))));
  }
  if (m.status === 'rejected') {
    wrap.appendChild(banner('err',
      esc(t('আপনার সদস্যপদ বাতিল করা হয়েছে।', 'Your membership has been cancelled.'))
      + (m.rejectReason ? ` — ${esc(m.rejectReason)}` : '')));
  }

  const [deposits, withdrawals, cfg] = await Promise.all([allDeposits(), allWithdrawals(), settings()]);
  const s = memberSummary(m, deposits, summaryOpts(cfg, { withdrawals }));
  const bal = withdrawalBalance(m, deposits, withdrawals);

  const stats = el('div', { class: 'stats' });
  stats.append(
    statCard({ label: t('মোট জমা', 'Total deposit'), value: taka(s.totalDeposit), sub: `${s.count} ${t('টি অনুমোদিত', 'approved')}`, ic: 'money' }),
    statCard({ label: t('বকেয়া', 'Due'), value: taka(s.due), sub: `${t('প্রয়োজন', 'Required')} ${taka(s.required)}`, ic: 'due', tone: s.due > 0 ? 'red' : '' }),
    statCard({ label: t('ব্যালেন্স', 'Balance'), value: taka(bal.available), sub: t('জমা − উত্তোলন', 'deposits − withdrawals'), ic: 'wallet', tone: 'blue' }),
    statCard({ label: t('মাসিক কিস্তি', 'Monthly installment'), value: taka(m.installment), sub: `${s.months} ${t('মাস গণনা', 'months counted')}`, ic: 'calendar' }),
  );
  wrap.appendChild(stats);

  wrap.appendChild(card(t('সদস্যপদ', 'Membership'), 'Membership', kv([
    [t('নাম (বাংলা)', 'Name (Bangla)'), esc(m.nameBn || '')],
    [t('নাম (ইংরেজি)', 'Name (English)'), esc(m.nameEn || '')],
    [t('সদস্য আইডি', 'Member ID'), `<b>${esc(m.memberId)}</b>`],
    [t('স্ট্যাটাস', 'Status'), statusTag(m.status)],
    [t('যোগদান', 'Joined'), esc(fmtDate(m.joinDate) || '')],
    [t('মাসিক কিস্তি', 'Monthly installment'), taka(m.installment)],
  ])));

  wrap.appendChild(card(t('যোগাযোগ', 'Contact'), 'Contact', kv([
    [t('মোবাইল', 'Mobile'), esc(m.mobile || '')],
    [t('WhatsApp', 'WhatsApp'), esc(m.whatsapp || '')],
    [t('ইমেইল', 'Email'), esc(m.email || '')],
    [t('ঠিকানা', 'Address'), esc(m.address || '')],
  ])));

  wrap.appendChild(card(t('পরিচয়', 'Identity'), 'Identity', kv([
    [t('পিতার নাম', 'Father'), esc(m.fatherBn || m.fatherEn || '')],
    [t('মাতার নাম', 'Mother'), esc(m.motherBn || m.motherEn || '')],
    [t('জন্মতারিখ', 'Date of birth'), esc(fmtDate(m.dob) || '')],
    [t('পেশা', 'Profession'), esc(m.profession || '')],
    [t('জাতীয় পরিচয়পত্র', 'NID'), esc(m.nid || '')],
  ])));

  wrap.appendChild(el('div', {
    class: 'fs8 muted', style: 'margin:6px 2px 2px',
    text: t(
      'তথ্য সংশোধনের প্রয়োজন হলে Maker/Admin-এর সাথে যোগাযোগ করুন — সদস্য নিজে প্রোফাইল সম্পাদনা করতে পারেন না।',
      'Contact your Maker/Admin to correct these details — members cannot edit their own profile.',
    ),
  }));
}

/* ============================ staff (account) ============================ */

function staffProfile(wrap, session) {
  const role = session.role === 'admin' ? t('অ্যাডমিন', 'Admin') : t('মেকার', 'Maker');
  wrap.appendChild(card(t('অ্যাকাউন্ট', 'Account'), 'Account', kv([
    [t('নাম', 'Name'), esc(session.displayName || '')],
    [t('ইউজারনেম', 'Username'), esc(session.username || '')],
    [t('ভূমিকা', 'Role'), esc(role)],
    [t('সদস্য আইডি', 'Member ID'), esc(session.memberId || '')],
  ])));
}
