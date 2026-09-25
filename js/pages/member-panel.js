/* Member Panel — personal / member profile information ONLY.
   Change Password → Settings. Activity Log → Settings.
   My Approved Deposits → Deposits. Statements → Statements. */
import {
  el, esc, fmtDate, t,
} from '../util.js';
import { icon } from '../icons.js';
import { page, card, kv, banner, statusTag } from '../ui.js';
import { allMembers, getMember } from '../store.js';
import { App } from '../app.js';

export async function pageMemberPanel(session) {
  const wrap = page('আমার প্রোফাইল', 'My Profile', 'member');
  if (session.role !== 'member') { wrap.appendChild(banner('err', 'এই পেজটি শুধুমাত্র সদস্যদের জন্য। / Members only.')); return wrap; }
  const m = await getMember(session.memberDocId);
  if (!m) { wrap.appendChild(banner('err', 'সদস্য প্রোফাইল পাওয়া যায়নি / Member profile not found')); return wrap; }

  if (m.status === 'pending') wrap.appendChild(banner('warn', t('আপনার সদস্যপদ অনুমোদনের অপেক্ষায়।', 'Your membership is awaiting approval.')));
  if (m.status === 'rejected') wrap.appendChild(banner('err', `আপনার সদস্যপদ বাতিল করা হয়েছে।${m.rejectReason ? ' কারণ: ' + esc(m.rejectReason) : ''}`));

  const idCard = el('div', { class: 'pf-hero' });
  idCard.innerHTML = `<span class="pf-ava">${icon('member')}</span>
    <span class="pf-id"><b class="pf-name">${esc(m.nameBn || m.nameEn || '')}</b>
    <span class="pf-en">${esc(m.nameEn || '')}</span>
    <span class="pf-mid">${t('সদস্য আইডি', 'Member ID')} <b>${esc(m.memberId)}</b> ${statusTag(m.status)}</span></span>`;
  wrap.appendChild(idCard);

  wrap.appendChild(card('যোগাযোগ', 'Contact', kv([
    ['মোবাইল / Mobile', esc(m.mobile)],
    ['হোয়াটসঅ্যাপ / WhatsApp', esc(m.whatsapp)],
    ['ইমেইল / Email', esc(m.email || '')],
    ['ঠিকানা / Address', esc(m.address || '')],
  ])));
  wrap.appendChild(card('পরিচয়', 'Identity', kv([
    ['পিতার নাম / Father', esc(m.fatherBn || m.fatherEn || '')],
    ['মাতার নাম / Mother', esc(m.motherBn || m.motherEn || '')],
    ['এনআইডি / NID', esc(m.nid || '')],
    ['জন্ম তারিখ / Date of Birth', esc(fmtDate(m.dob))],
    ['পেশা / Profession', esc(m.profession || '')],
    ['সদস্যপদ / Status', statusTag(m.status)],
    ['যোগদান / Joined', esc(fmtDate(m.joinDate))],
  ])));

  wrap.appendChild(el('div', { class: 'fs8 muted', style: 'margin:2px 2px 10px', text: t(
    'তথ্য সংশোধনের প্রয়োজন হলে Maker/Admin-এর সাথে যোগাযোগ করুন।',
    'For corrections contact your Maker/Admin — members cannot edit their own profile.',
  ) }));

  return wrap;
}
