/* MEMBER MANAGEMENT — one module, three views.
 *
 *   #members            → তালিকা (search · total count · + নতুন সদস্য · cards)
 *   #members/new        → new member (3 compact steps, one column)
 *   #members/edit/<id>  → edit member  (sub-view opened from a card / detail)
 *
 * There is exactly ONE list, ONE registration form and ONE editor: the two
 * pages `তালিকা`/`নিবন্ধন`/`সম্পাদনা` all live here behind `params.section`.
 * Saving always returns to the list (and to the details of the member edited),
 * so nothing is duplicated and nothing is lost.
 */
import {
  el, esc, toast, taka, money, num, fmtDate, todayISO, memberIdFromMobile, isValidMobile,
  isValidEmail, normalizeMobile, debounce, confirmBox, waNumber, modal, alertBox, t,
} from '../util.js';
import { icon } from '../icons.js';
import { page, card, banner, btn, kv, statCard, sectionHead, listRow, emptyState, statusTag, segChips } from '../ui.js';
import { memberPicker } from '../picker.js';
import {
  allMembers, allDeposits, allWithdrawals, settings, registerMember, updateMember, setMemberStatus,
  memberSummary, summaryOpts, getMember, DEFAULT_MEMBER_PASSWORD, withdrawalBalance,
} from '../store.js';
import { can } from '../auth.js';
import { App } from '../app.js';
import { rejectReason } from './deposits.js';
/* WhatsApp due-reminder text — ONE implementation, kept by the report module. */
import { dueMessage } from './reports.js';

const isStaff = session => session.role === 'admin' || session.role === 'maker';

/* ============================ module entry ============================ */

export async function pageMembers(session, params = {}) {
  if (!isStaff(session)) return memberSelfView(session);
  const view = params.section === 'new' ? 'new' : params.section === 'edit' ? 'edit' : 'list';
  if (view === 'new') return newMemberScreen(session);
  if (view === 'edit') return editMemberScreen(session, params);
  return memberListScreen(session, params);
}

/* ================================ LIST ================================ */

export async function memberListScreen(session, params = {}) {
  const [members, deposits, withdrawals, cfg] = await Promise.all([
    allMembers(), allDeposits(), allWithdrawals(), settings(),
  ]);
  const wrap = page(t('সদস্য ব্যবস্থাপনা', 'Member Management'), 'Members', 'members');
  const list = members.slice().sort((a, b) => String(a.memberId).localeCompare(String(b.memberId)));

  /* --- summary strip: total + how many are still pending --- */
  const counts = {
    total: list.length,
    active: list.filter(m => m.status === 'active').length,
    pending: list.filter(m => m.status === 'pending').length,
    rejected: list.filter(m => m.status === 'rejected').length,
  };
  const stats = el('div', { class: 'stats' });
  stats.append(
    statCard({ label: t('মোট সদস্য', 'Total members'), value: String(counts.total), sub: t('নিবন্ধিত', 'registered'), ic: 'member', tone: 'blue' }),
    statCard({ label: t('সক্রিয়', 'Active'), value: String(counts.active), sub: t('অনুমোদিত', 'approved'), ic: 'check' }),
    statCard({ label: t('অপেক্ষমাণ', 'Pending'), value: String(counts.pending), sub: t('অনুমোদন প্রয়োজন', 'awaiting approval'), ic: 'pending', tone: counts.pending ? 'red' : '' }),
  );
  wrap.appendChild(stats);

  /* --- the ONE primary action of this screen --- */
  wrap.appendChild(btn(t('নতুন সদস্য যোগ করুন', 'Add new member'), 'plus', 'primary', () => App.go('members', { section: 'new' }), { block: true, class: 'cta-block' }));

  /* --- search + status chips --- */
  let q = params.q || '';
  let status = params.status || 'all';
  const search = el('input', {
    type: 'search', class: 'search-in', value: q,
    placeholder: t('নাম / সদস্য আইডি / মোবাইল খুঁজুন…', 'Search name / member ID / mobile…'),
  });
  /* segChips(name, {value,bn,en}[], value, {onChange}) → object with .root */
  const chips = segChips('mstatus', [
    { value: 'all', bn: `সব (${counts.total})`, en: `All (${counts.total})` },
    { value: 'active', bn: `সক্রিয় (${counts.active})`, en: `Active (${counts.active})` },
    { value: 'pending', bn: `অপেক্ষমাণ (${counts.pending})`, en: `Pending (${counts.pending})` },
    { value: 'rejected', bn: `বাতিল (${counts.rejected})`, en: `Rejected (${counts.rejected})` },
  ], status, { onChange: v => { status = v; paint(); } });
  chips.root.classList.add('chips-bar');

  const tools = el('div', { class: 'list-tools' });
  const searchBox = el('div', { class: 'search-box' }, [el('span', { class: 'sb-ic', html: icon('search') }), search]);
  tools.append(searchBox, chips.root);
  wrap.appendChild(tools);

  const countPill = el('span', { class: 'count-pill' });
  wrap.appendChild(sectionHead(t('সদস্য তালিকা', 'Member list'), 'Members list'));
  wrap.appendChild(countPill);
  const host = el('div', { class: 'mrows' });
  wrap.appendChild(host);

  search.addEventListener('input', debounce(() => { q = search.value; paint(); }, 160));

  function visible() {
    const needle = String(q || '').trim().toLowerCase();
    return list.filter(m => (status === 'all' || m.status === status) && (!needle
      || [m.memberId, m.nameBn, m.nameEn, m.mobile, m.whatsapp, m.email]
        .map(x => String(x || '').toLowerCase()).join(' ').includes(needle)));
  }

  function paint() {
    host.replaceChildren();
    const rows = visible();
    countPill.textContent = `${rows.length} ${t('জন সদস্য', 'members')}`;
    if (!rows.length) {
      host.appendChild(emptyState({
        ic: 'member',
        title: t('কোনো সদস্য পাওয়া যায়নি', 'No members found'),
        hint: q ? t('অন্য কিছু দিয়ে খুঁজে দেখুন।', 'Try a different search.') : t('নতুন সদস্য যোগ করে শুরু করুন।', 'Add a new member to begin.'),
        actionLabel: q ? '' : t('নতুন সদস্য', 'Add member'),
        onAction: q ? null : () => App.go('members', { section: 'new' }),
      }));
      return;
    }
    rows.forEach(m => host.appendChild(memberCard(session, m, deposits, withdrawals, cfg, paint)));
  }
  paint();
  return wrap;
}

/** Member card — avatar, name/ID, dues and the two row actions (View · Edit). */
export function memberCard(session, m, deposits, withdrawals, cfg, onChanged) {
  const s = memberSummary(m, deposits, summaryOpts(cfg, { withdrawals }));
  const bal = withdrawalBalance(m, deposits, withdrawals);
  const row = el('div', { class: 'mrow' });
  const initials = String(m.nameBn || m.nameEn || '?').trim().charAt(0);
  row.innerHTML = `
    <span class="mrow-av">${esc(initials)}</span>
    <span class="mrow-bd">
      <span class="mrow-t">${esc(m.nameBn || m.nameEn || '')} <span class="mrow-id">${esc(m.memberId)}</span></span>
      <span class="mrow-s">${esc(m.mobile || '')}${m.installment ? ` · ${taka(m.installment)}/${t('মাস', 'mo')}` : ''}</span>
      <span class="mrow-m">
        <span class="mrow-bal">${t('ব্যালেন্স', 'Balance')} <b class="num">${esc(taka(bal.available))}</b></span>
        <span class="dot">·</span>
        <span class="mrow-due ${s.due > 0 ? 'warn' : 'ok'}">${t('বকেয়া', 'Due')} <b class="num">${esc(taka(s.due))}</b></span>
      </span>
    </span>
    <span class="mrow-st">${statusTag(m.status)}</span>`;
  const acts = el('div', { class: 'row-acts' });
  acts.append(
    btn(t('দেখুন', 'View'), 'eye', 'ghost', () => viewMember(session, m, { deposits, withdrawals, cfg, onChanged }), { class: 'btn-sm' }),
    can(session, 'member:edit') ? btn(t('সম্পাদনা', 'Edit'), 'edit', 'soft', () => App.go('members', { section: 'edit', docId: m.id }), { class: 'btn-sm' }) : null,
  );
  row.appendChild(acts);
  return row;
}

/* ------------------------------ member details ------------------------------ */

/** Read-only details popup for one member (View). */
export async function viewMember(session, member, ctx = {}) {
  const m = typeof member === 'string' ? await getMember(member) : member;
  if (!m) { toast(t('সদস্য পাওয়া যায়নি', 'Member not found'), 'error'); return; }
  const [deposits, withdrawals, cfg] = [
    ctx.deposits || await allDeposits(),
    ctx.withdrawals || await allWithdrawals(),
    ctx.cfg || await settings(),
  ];
  const s = memberSummary(m, deposits, summaryOpts(cfg, { withdrawals }));
  const bal = withdrawalBalance(m, deposits, withdrawals);
  const body = el('div', { class: 'mdetail' });
  body.innerHTML = `
    <div class="md-head">
      <span class="mrow-av lg">${esc(String(m.nameBn || m.nameEn || '?').trim().charAt(0))}</span>
      <div><div class="md-name">${esc(m.nameBn || m.nameEn)}</div>
      <div class="md-sub">${esc(m.memberId)} · ${esc(m.mobile || '')} ${statusTag(m.status)}</div></div>
    </div>
    <div class="stats tight">
      <div class="stat"><div class="lbl">${t('মোট জমা', 'Total deposit')}</div><div class="val num">${esc(taka(s.totalDeposit))}</div></div>
      <div class="stat red"><div class="lbl">${t('বকেয়া', 'Due')}</div><div class="val num">${esc(taka(s.due))}</div></div>
      <div class="stat"><div class="lbl">${t('ব্যালেন্স', 'Balance')}</div><div class="val num">${esc(taka(bal.available))}</div></div>
      <div class="stat gray"><div class="lbl">${t('কিস্তি', 'Installment')}</div><div class="val num">${esc(taka(m.installment))}</div></div>
    </div>
    ${kv([
      [t('নাম (ইংরেজি)', 'Name (English)'), esc(m.nameEn || '')],
      [t('পিতা', 'Father'), esc(m.fatherBn || m.fatherEn || '')],
      [t('মাতা', 'Mother'), esc(m.motherBn || m.motherEn || '')],
      [t('WhatsApp', 'WhatsApp'), esc(m.whatsapp || '')],
      [t('ইমেইল', 'Email'), esc(m.email || '')],
      [t('যোগদান', 'Joined'), esc(fmtDate(m.joinDate) || '')],
      [t('ঠিকানা', 'Address'), esc(m.address || '')],
      [t('জন্মতারিখ', 'Date of birth'), esc(fmtDate(m.dob) || '')],
      [t('পেশা', 'Profession'), esc(m.profession || '')],
      [t('NID', 'NID'), esc(m.nid || '')],
    ])}
    ${m.rejectReason ? `<div class="banner warn">${icon('pending')}<span>${esc(t('কারণ', 'Reason'))}: ${esc(m.rejectReason)}</span></div>` : ''}`;

  const acts = [];
  if (can(session, 'member:edit')) {
    acts.push({
      label: t('সম্পাদনা', 'Edit'), value: 'edit', kind: 'primary',
      onClick: () => { App.go('members', { section: 'edit', docId: m.id }); return false; },
    });
  }
  acts.push({
    label: t('স্টেটমেন্ট', 'Statement'), value: 'statement', kind: 'ghost',
    onClick: () => { App.go('statements', { memberDocId: m.id }); return false; },
  });
  if (can(session, 'whatsapp')) {
    acts.push({
      label: t('WhatsApp', 'WhatsApp'), value: 'wa', kind: 'ghost',
      onClick: async () => {
        const c = await settings();
        window.open(`https://wa.me/${waNumber(m.whatsapp || m.mobile)}?text=${encodeURIComponent(dueMessage(m.nameBn || m.nameEn, c.waTemplate))}`, '_blank');
      },
    });
  }
  acts.push({ label: t('বন্ধ', 'Close'), value: null, kind: 'ghost' });
  await modal({ title: t('সদস্যের তথ্য', 'Member details'), body, width: 460, actions: acts });
}

/* ------------------------------ registration ------------------------------ */

const REG_STEPS = [
  { bn: 'যোগাযোগ', en: 'Contact' },
  { bn: 'পরিচয়', en: 'Identity' },
  { bn: 'কিস্তি ও ঠিকানা', en: 'Installment & address' },
];
const REG_FIELD_STEP = {
  mobile: 0, whatsapp: 0, email: 0, memberId: 0,
  nameBn: 1, nameEn: 1, fatherBn: 1, fatherEn: 1, motherBn: 1, motherEn: 1,
  installment: 2, address: 2, nid: 2, profession: 2, dob: 2,
};
const BN_STEP = ['১', '২', '৩'];

export async function newMemberScreen(session) {
  const cfg = await settings();
  const wrap = page(t('নতুন সদস্য', 'New member'), 'Add member', 'plus');

  wrap.appendChild(banner('info', t(
    'সদস্য নিজেও লগইন পেজ থেকে নিবন্ধন করতে পারেন। এখানে আপনি সদস্যের পক্ষে নিবন্ধন করছেন — নিবন্ধনের পর স্ট্যাটাস <b>অনুমোদনের অপেক্ষায়</b> থাকবে।',
    'Members can also register from the login page. Here you register on their behalf — the status stays <b>pending approval</b> afterwards.',
  )));

  let step = 0;
  const form = el('form', { class: 'grid mform', novalidate: true });
  const indicator = el('div', { class: 'wsteps', 'aria-hidden': 'true' });
  form.innerHTML = `
    <div class="wstep" data-step="0">
      <div class="field"><label>${t('মোবাইল নম্বর', 'Mobile number')} <span class="req">*</span></label>
        <input name="mobile" inputmode="numeric" maxlength="11" placeholder="01712345678" autocomplete="off">
        <div class="hint">${t('সদস্য আইডি', 'Member ID')}: <b class="js-mid">—</b></div><div class="err" data-err="mobile"></div></div>
      <div class="field"><label>${t('WhatsApp নম্বর', 'WhatsApp number')} <span class="req">*</span></label>
        <input name="whatsapp" inputmode="numeric" maxlength="11" placeholder="01712345678" autocomplete="off">
        <label class="check" style="margin-top:3px"><input type="checkbox" name="sameWa" checked> ${t('মোবাইল নম্বরের মতোই', 'Same as mobile')}</label>
        <div class="err" data-err="whatsapp"></div></div>
      <div class="field"><label>${t('ইমেইল (ঐচ্ছিক)', 'Email (optional)')}</label>
        <input name="email" type="email" placeholder="name@mail.com" autocomplete="off"><div class="err" data-err="email"></div></div>
    </div>
    <div class="wstep" data-step="1">
      <div class="field"><label>${t('নাম (বাংলা)', 'Name (Bangla)')} <span class="req">*</span></label>
        <input name="nameBn" autocomplete="off"><div class="err" data-err="nameBn"></div></div>
      <div class="field"><label>${t('নাম (ইংরেজি)', 'Name (English)')} <span class="req">*</span></label>
        <input name="nameEn" autocomplete="off"><div class="err" data-err="nameEn"></div></div>
      <div class="field"><label>${t('পিতার নাম (ঐচ্ছিক)', 'Father name (optional)')}</label><input name="fatherBn" autocomplete="off"></div>
      <div class="field"><label>${t('পিতার নাম — ইংরেজি (ঐচ্ছিক)', 'Father name — English (optional)')}</label><input name="fatherEn" autocomplete="off"></div>
      <div class="field"><label>${t('মাতার নাম (ঐচ্ছিক)', 'Mother name (optional)')}</label><input name="motherBn" autocomplete="off"></div>
      <div class="field"><label>${t('মাতার নাম — ইংরেজি (ঐচ্ছিক)', 'Mother name — English (optional)')}</label><input name="motherEn" autocomplete="off"></div>
    </div>
    <div class="wstep" data-step="2">
      <div class="field"><label>${t('মাসিক কিস্তি (৳)', 'Monthly installment (৳)')} <span class="req">*</span></label>
        <input name="installment" type="number" min="1" step="1" value="${esc(cfg.defaultInstallment)}" inputmode="numeric">
        <div class="err" data-err="installment"></div>
        <div class="hint">${t('সদস্য মোবাইল নম্বর দিয়ে লগইন করবেন। ডিফল্ট পাসওয়ার্ড', 'The member signs in with their mobile number. Default password')} <b>${esc(DEFAULT_MEMBER_PASSWORD)}</b> — ${t('প্রথম লগইনে পরিবর্তন বাধ্যতামূলক।', 'change is mandatory on first login.')}</div></div>
      <div class="field"><label>${t('ঠিকানা (ঐচ্ছিক)', 'Address (optional)')}</label><textarea name="address" rows="2"></textarea></div>
      <div class="field"><label>${t('NID (ঐচ্ছিক)', 'NID (optional)')}</label><input name="nid" inputmode="numeric" autocomplete="off"></div>
      <div class="field"><label>${t('পেশা (ঐচ্ছিক)', 'Profession (optional)')}</label><input name="profession" autocomplete="off"></div>
      <div class="field"><label>${t('জন্মতারিখ (ঐচ্ছিক)', 'Date of birth (optional)')}</label><input name="dob" type="date"></div>
    </div>
    <div class="form-sticky">
      <button class="btn btn-ghost wiz-back" type="button">${icon('back')}<span>${t('পিছনে', 'Back')}</span></button>
      <button class="btn btn-primary wiz-next" type="button"><span>${t('পরের ধাপ', 'Next')}</span>${icon('chevron')}</button>
      <button class="btn btn-primary wiz-submit" type="submit">${icon('check')}<span>${t('সদস্য যোগ করুন', 'Add member')}</span></button>
    </div>`;
  form.prepend(indicator);
  wrap.appendChild(card(t('সদস্যের তথ্য', 'Member details'), 'New member', form));

  const steps = [...form.querySelectorAll('.wstep')];
  const backBtn = form.querySelector('.wiz-back');
  const nextBtn = form.querySelector('.wiz-next');
  const submitBtn = form.querySelector('.wiz-submit');
  const paint = () => {
    steps.forEach(s => s.classList.toggle('on', Number(s.dataset.step) === step));
    backBtn.hidden = step === 0;
    nextBtn.hidden = step === REG_STEPS.length - 1;
    submitBtn.hidden = step !== REG_STEPS.length - 1;
    indicator.innerHTML = REG_STEPS.map((s, i) =>
      `<span class="wstep-dot${i === step ? ' on' : ''}${i < step ? ' done' : ''}">${i < step ? '✓' : BN_STEP[i]}</span>`).join('<span class="wstep-line"></span>')
      + `<span class="wstep-lbl">${esc(t('ধাপ', 'Step'))} ${BN_STEP[step]}/${BN_STEP[2]} · ${esc(t(REG_STEPS[step].bn, REG_STEPS[step].en))}</span>`;
  };
  const toTop = () => { const v = document.getElementById('view'); if (v) v.scrollTop = 0; };

  const midBox = form.querySelector('.js-mid');
  const syncWa = () => { if (form.elements.sameWa.checked) form.elements.whatsapp.value = form.elements.mobile.value; };
  form.elements.whatsapp.readOnly = true;
  form.elements.mobile.addEventListener('input', () => {
    form.elements.mobile.value = form.elements.mobile.value.replace(/\D/g, '').slice(0, 11);
    const mid = memberIdFromMobile(form.elements.mobile.value);
    midBox.textContent = mid || '—';
    syncWa();
  });
  form.elements.sameWa.addEventListener('change', () => { form.elements.whatsapp.readOnly = form.elements.sameWa.checked; syncWa(); });
  form.elements.whatsapp.addEventListener('input', () => { form.elements.whatsapp.value = form.elements.whatsapp.value.replace(/\D/g, '').slice(0, 11); });

  const setErr = (n, m) => { const b = form.querySelector(`[data-err="${n}"]`); if (b) { b.textContent = m; b.closest('.field').classList.add('bad'); } };
  const clearErrs = () => {
    form.querySelectorAll('.err').forEach(x => x.textContent = '');
    form.querySelectorAll('.field').forEach(x => x.classList.remove('bad'));
  };
  const focusFirstBad = () => { const f = form.querySelector('.field.bad input, .field.bad textarea'); if (f) f.focus(); };

  const validateStep = idx => {
    const v = Object.fromEntries(new FormData(form).entries());
    let bad = false;
    if (idx === 0) {
      if (!isValidMobile(v.mobile)) { setErr('mobile', t('সঠিক ১১ সংখ্যার মোবাইল নম্বর দিন', 'Enter a valid 11-digit mobile number')); bad = true; }
      if (!isValidMobile(v.whatsapp)) { setErr('whatsapp', t('সঠিক WhatsApp নম্বর দিন', 'Enter a valid WhatsApp number')); bad = true; }
      if (v.email && !isValidEmail(v.email)) { setErr('email', t('সঠিক ইমেইল দিন', 'Enter a valid email')); bad = true; }
    } else if (idx === 1) {
      if (!String(v.nameBn || '').trim()) { setErr('nameBn', t('নাম (বাংলা) আবশ্যক', 'Name (Bangla) is required')); bad = true; }
      if (!String(v.nameEn || '').trim()) { setErr('nameEn', t('নাম (ইংরেজি) আবশ্যক', 'Name (English) is required')); bad = true; }
    } else if (!(num(v.installment) > 0)) { setErr('installment', t('মাসিক কিস্তি দিন', 'Enter the monthly installment')); bad = true; }
    return !bad;
  };

  backBtn.addEventListener('click', () => { if (step > 0) { step--; paint(); toTop(); } });
  nextBtn.addEventListener('click', () => {
    clearErrs();
    if (!validateStep(step)) { toast(t('ফর্মে ত্রুটি রয়েছে', 'Please fix the highlighted fields'), 'error'); focusFirstBad(); return; }
    step++; paint(); toTop();
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    clearErrs();
    for (let i = 0; i < REG_STEPS.length; i++) {
      if (!validateStep(i)) {
        step = i; paint(); toTop();
        toast(t('ফর্মে ত্রুটি রয়েছে', 'Please fix the highlighted fields'), 'error');
        focusFirstBad();
        return;
      }
    }
    const v = Object.fromEntries(new FormData(form).entries());
    const b = submitBtn; b.disabled = true;
    try {
      const m = await registerMember({ ...v, password: '' }, { defaultPassword: true });
      await modal({
        title: t('নিবন্ধন সফল', 'Registration successful'), width: 400,
        body: `<div class="success-pop"><div class="tick">${icon('check')}</div></div>
          <div class="kv"><div>${t('সদস্য আইডি', 'Member ID')}</div><div><b>${esc(m.memberId)}</b></div>
          <div>${t('নাম', 'Name')}</div><div>${esc(m.nameBn)}</div>
          <div>${t('মোবাইল', 'Mobile')}</div><div>${esc(m.mobile)}</div>
          <div>${t('স্ট্যাটাস', 'Status')}</div><div>${statusTag(m.status)}</div></div>
          <div class="banner info">${icon('key')}<span>${t('লগইন', 'Login')}: <b>${esc(m.mobile)}</b> · ${t('ডিফল্ট পাসওয়ার্ড', 'default password')} <b>${esc(DEFAULT_MEMBER_PASSWORD)}</b></div>`,
        actions: [{ label: t('তালিকায় ফিরুন', 'Back to list'), value: true, kind: 'primary' }],
      });
      App.refresh();
      App.go('members');
    } catch (err) {
      if (err.fieldErrors) {
        err.fieldErrors.forEach(fe => setErr(fe.field === 'memberId' ? 'mobile' : fe.field, fe.msg));
        step = REG_FIELD_STEP[err.fieldErrors[0] && err.fieldErrors[0].field] ?? 0;
        paint(); focusFirstBad();
      } else toast(err.message, 'error');
      b.disabled = false;
    }
  });

  paint();
  return wrap;
}

/* -------------------------------- editor -------------------------------- */

export async function editMemberScreen(session, params = {}) {
  const [members, deposits, withdrawals, cfg] = await Promise.all([
    allMembers(), allDeposits(), allWithdrawals(), settings(),
  ]);
  const wrap = page(t('সদস্য সম্পাদনা', 'Edit member'), 'Edit member', 'edit');
  if (!members.length) { wrap.appendChild(emptyState({ ic: 'member', title: t('এখনো কোনো সদস্য নেই', 'No members yet'), hint: t('প্রথমে একজন সদস্য যোগ করুন।', 'Add a member first.'), actionLabel: t('নতুন সদস্য', 'Add member'), onAction: () => App.go('members', { section: 'new' }) })); return wrap; }

  const host = el('div');
  let seq = 0;
  const load = async id => {
    const my = ++seq;
    const m = id ? await getMember(id) : null;
    if (my !== seq) return;
    host.replaceChildren();
    if (m) host.appendChild(memberEditor(session, m, deposits, withdrawals, cfg, () => App.go('members', { section: 'edit', docId: m.id })));
    else host.appendChild(banner('info', esc(t('সম্পাদনার জন্য একজন সদস্য নির্বাচন করুন।', 'Choose a member to edit.'))));
  };
  const picker = memberPicker({
    members,
    value: params.docId && members.some(m => m.id === params.docId) ? params.docId : '',
    onPick: m => { load(m ? m.id : ''); if (m) App.go('members', { section: 'edit', docId: m.id }); },
  });
  const pickCard = card(t('সদস্য খুঁজুন', 'Find member'), 'Find member', picker.root);
  pickCard.classList.add('overflow-visible');
  wrap.appendChild(pickCard);
  wrap.appendChild(host);

  if (picker.value) await load(picker.value);
  else if (window.matchMedia && matchMedia('(min-width:1024px)').matches) picker.focus();
  return wrap;
}

/** Member editor form (also embedded from the member's own profile page). */
export function memberEditor(session, m, deposits, withdrawals, cfg, onSaved) {
  const s = memberSummary(m, deposits, summaryOpts(cfg, { withdrawals }));
  const bal = withdrawalBalance(m, deposits, withdrawals);
  const box = el('div');

  const summary = el('div', { class: 'stats' });
  summary.innerHTML = `
    <div class="stat"><div class="lbl">${icon('money')} ${t('মোট জমা', 'Total deposit')}</div><div class="val num">${esc(taka(s.totalDeposit))}</div><div class="sub">${s.count} ${t('টি অনুমোদিত', 'approved')}</div></div>
    <div class="stat red"><div class="lbl">${icon('due')} ${t('বকেয়া', 'Due')}</div><div class="val num">${esc(taka(s.due))}</div><div class="sub">${t('প্রয়োজন', 'Required')} ${esc(taka(s.required))}</div></div>
    <div class="stat"><div class="lbl">${icon('advance')} ${t('অগ্রিম', 'Advance')}</div><div class="val num">${esc(taka(s.advance))}</div><div class="sub">${s.months} ${t('মাস', 'months')}</div></div>
    <div class="stat gray"><div class="lbl">${icon('member')} ${t('স্ট্যাটাস', 'Status')}</div><div class="val">${statusTag(m.status)}</div><div class="sub">${t('সদস্য আইডি', 'Member ID')} ${esc(m.memberId)} · ${t('ব্যালেন্স', 'Balance')} ${esc(taka(bal.available))}</div></div>`;
  box.appendChild(summary);

  const canEdit = can(session, 'member:edit');
  const f = el('form', { class: 'grid mform', novalidate: true });
  const ro = canEdit ? '' : 'readonly';
  f.innerHTML = `
    <div class="grid g2">
      <div class="field"><label>${t('সদস্য আইডি (পরিবর্তনযোগ্য নয়)', 'Member ID (read only)')}</label><input value="${esc(m.memberId)}" readonly></div>
      <div class="field"><label>${t('স্ট্যাটাস', 'Status')}</label><div style="padding-top:9px">${statusTag(m.status)}</div></div>
      <div class="form-sec">${t('যোগাযোগ', 'Contact')}</div>
      <div class="field"><label>${t('মোবাইল নম্বর', 'Mobile number')} <span class="req">*</span></label><input name="mobile" ${ro} maxlength="11" inputmode="numeric" value="${esc(m.mobile)}" autocomplete="off"><div class="err" data-err="mobile"></div></div>
      <div class="field"><label>${t('WhatsApp নম্বর', 'WhatsApp number')} <span class="req">*</span></label><input name="whatsapp" ${ro} maxlength="11" inputmode="numeric" value="${esc(m.whatsapp)}" autocomplete="off"><div class="err" data-err="whatsapp"></div></div>
      <div class="field"><label>${t('ইমেইল (ঐচ্ছিক)', 'Email (optional)')}</label><input name="email" type="email" ${ro} value="${esc(m.email || '')}" autocomplete="off"><div class="err" data-err="email"></div></div>
      <div class="field"><label>${t('NID (ঐচ্ছিক)', 'NID (optional)')}</label><input name="nid" ${ro} value="${esc(m.nid || '')}" autocomplete="off"></div>
      <div class="form-sec">${t('পরিচয়', 'Identity')}</div>
      <div class="field"><label>${t('নাম (বাংলা)', 'Name (Bangla)')} <span class="req">*</span></label><input name="nameBn" ${ro} value="${esc(m.nameBn)}" autocomplete="off"><div class="err" data-err="nameBn"></div></div>
      <div class="field"><label>${t('নাম (ইংরেজি)', 'Name (English)')} <span class="req">*</span></label><input name="nameEn" ${ro} value="${esc(m.nameEn)}" autocomplete="off"><div class="err" data-err="nameEn"></div></div>
      <div class="field"><label>${t('পিতার নাম (ঐচ্ছিক)', 'Father name (optional)')}</label><input name="fatherBn" ${ro} value="${esc(m.fatherBn || '')}" autocomplete="off"></div>
      <div class="field"><label>${t('পিতার নাম — ইংরেজি (ঐচ্ছিক)', 'Father name — English (optional)')}</label><input name="fatherEn" ${ro} value="${esc(m.fatherEn || '')}" autocomplete="off"></div>
      <div class="field"><label>${t('মাতার নাম (ঐচ্ছিক)', 'Mother name (optional)')}</label><input name="motherBn" ${ro} value="${esc(m.motherBn || '')}" autocomplete="off"></div>
      <div class="field"><label>${t('মাতার নাম — ইংরেজি (ঐচ্ছিক)', 'Mother name — English (optional)')}</label><input name="motherEn" ${ro} value="${esc(m.motherEn || '')}" autocomplete="off"></div>
      <div class="field"><label>${t('জন্মতারিখ (ঐচ্ছিক)', 'Date of birth (optional)')}</label><input name="dob" type="date" ${ro} value="${esc((m.dob || '').slice(0, 10))}"><div class="hint">${t('প্রদর্শন', 'Shown as')}: ${esc(fmtDate(m.dob) || '—')}</div></div>
      <div class="field"><label>${t('পেশা (ঐচ্ছিক)', 'Profession (optional)')}</label><input name="profession" ${ro} value="${esc(m.profession || '')}" autocomplete="off"></div>
      <div class="form-sec">${t('কিস্তি ও অন্যান্য', 'Installment & more')}</div>
      <div class="field"><label>${t('মাসিক কিস্তি (৳)', 'Monthly installment (৳)')} <span class="req">*</span></label><input name="installment" type="number" min="1" ${ro} value="${esc(m.installment)}"><div class="err" data-err="installment"></div></div>
      <div class="field"><label>${t('যোগদানের তারিখ', 'Join date')}${session.role === 'admin' ? ' <span class="req">*</span>' : ''}</label>
        ${session.role === 'admin'
          ? `<input name="joinDate" type="date" value="${esc((m.joinDate || '').slice(0, 10))}" required><div class="hint">${t('প্রদর্শন', 'Shown as')}: ${esc(fmtDate(m.joinDate) || '—')} — ${t('শুধু Admin পরিবর্তন করতে পারেন।', 'only an Admin can change this.')}</div><div class="err" data-err="joinDate"></div>`
          : `<input value="${esc(fmtDate(m.joinDate))}" readonly>`}</div>
    </div>
    <div class="field"><label>${t('ঠিকানা (ঐচ্ছিক)', 'Address (optional)')}</label><textarea name="address" rows="2" ${ro}>${esc(m.address || '')}</textarea></div>`;

  if (canEdit) {
    const acts = el('div', { class: 'form-actions' });
    acts.appendChild(el('button', { class: 'btn btn-primary', type: 'submit', html: `${icon('save')}<span>${t('পরিবর্তন সংরক্ষণ', 'Save changes')}</span>` }));
    acts.appendChild(btn(t('মুছুন', 'Reset'), 'clear', 'ghost', () => f.reset()));
    if (m.status === 'pending') {
      acts.appendChild(btn(t('অনুমোদন', 'Approve'), 'approve', 'soft', async () => {
        if (!(await confirmBox(t(`${m.nameBn} (${m.memberId}) — সদস্যপদ অনুমোদন করবেন?`, `Approve ${m.nameBn} (${m.memberId})?`), { okLabel: t('অনুমোদন', 'Approve') }))) return;
        await setMemberStatus(m.id, 'active', session);
        toast(t('সদস্য অনুমোদিত', 'Member approved'), 'success'); onSaved && onSaved();
      }));
      acts.appendChild(btn(t('প্রত্যাখ্যান', 'Reject'), 'reject', 'softred', async () => {
        const r = await rejectReason(t('সদস্য প্রত্যাখ্যানের কারণ', 'Member rejection reason'));
        if (r === null) return;
        await setMemberStatus(m.id, 'rejected', session, r);
        toast(t('সদস্য প্রত্যাখ্যাত', 'Member rejected'), 'warn'); onSaved && onSaved();
      }));
    }
    if (m.status === 'rejected' && session.role === 'admin') {
      acts.appendChild(btn(t('পুনর্বহাল', 'Re-activate'), 'approve', 'soft', async () => {
        if (!(await confirmBox(t('সদস্যকে পুনরায় সক্রিয় করবেন?', 'Re-activate this member?'), { okLabel: t('সক্রিয় করুন', 'Activate') }))) return;
        await setMemberStatus(m.id, 'active', session); toast(t('সদস্য পুনর্বহাল হয়েছে', 'Member re-activated'), 'success'); onSaved && onSaved();
      }));
    }
    if (m.status === 'active' && session.role === 'admin') {
      acts.appendChild(btn(t('নিষ্ক্রিয়', 'Deactivate'), 'reject', 'softred', async () => {
        if (!(await confirmBox(t('সদস্যকে নিষ্ক্রিয় করবেন?', 'Deactivate this member?'), { okLabel: t('নিষ্ক্রিয় করুন', 'Deactivate'), danger: true }))) return;
        await setMemberStatus(m.id, 'inactive', session); toast(t('সদস্য নিষ্ক্রিয় হয়েছে', 'Member deactivated'), 'warn'); onSaved && onSaved();
      }));
    }
    if (m.status === 'inactive') {
      acts.appendChild(btn(t('সক্রিয়', 'Activate'), 'approve', 'soft', async () => {
        await setMemberStatus(m.id, 'active', session); toast(t('সদস্য সক্রিয় হয়েছে', 'Member activated'), 'success'); onSaved && onSaved();
      }));
    }
    if (s.due > 0 && can(session, 'whatsapp')) {
      acts.appendChild(btn(t('WhatsApp স্মরণ', 'WhatsApp reminder'), 'whatsapp', 'wa', () => {
        window.open(`https://wa.me/${waNumber(m.whatsapp || m.mobile)}?text=${encodeURIComponent(dueMessage(m.nameBn || m.nameEn, cfg.waTemplate))}`, '_blank');
      }));
    }
    f.appendChild(acts);
  } else {
    f.appendChild(banner('info', esc(t('প্রোফাইল তথ্য শুধুমাত্র পঠনযোগ্য।', 'Profile information is read only.'))));
  }

  f.addEventListener('submit', async e => {
    e.preventDefault();
    f.querySelectorAll('.err').forEach(x => x.textContent = '');
    f.querySelectorAll('.field').forEach(x => x.classList.remove('bad'));
    const setErr = (n, msg) => { const b = f.querySelector(`[data-err="${n}"]`); if (b) { b.textContent = msg; b.closest('.field').classList.add('bad'); } };
    const v = Object.fromEntries(new FormData(f).entries());
    let bad = false;
    if (!isValidMobile(v.mobile)) { setErr('mobile', t('সঠিক মোবাইল নম্বর দিন', 'Enter a valid mobile number')); bad = true; }
    if (!isValidMobile(v.whatsapp)) { setErr('whatsapp', t('সঠিক WhatsApp নম্বর দিন', 'Enter a valid WhatsApp number')); bad = true; }
    if (!String(v.nameBn || '').trim()) { setErr('nameBn', t('নাম (বাংলা) আবশ্যক', 'Name (Bangla) is required')); bad = true; }
    if (!String(v.nameEn || '').trim()) { setErr('nameEn', t('নাম (ইংরেজি) আবশ্যক', 'Name (English) is required')); bad = true; }
    if (v.email && !isValidEmail(v.email)) { setErr('email', t('সঠিক ইমেইল দিন', 'Enter a valid email')); bad = true; }
    if (!(num(v.installment) > 0)) { setErr('installment', t('মাসিক কিস্তি দিন', 'Enter the monthly installment')); bad = true; }
    if (session.role === 'admin' && !/^\d{4}-\d{2}-\d{2}$/.test(String(v.joinDate || ''))) { setErr('joinDate', t('সঠিক যোগদানের তারিখ দিন', 'Enter a valid join date')); bad = true; }
    if (bad) { toast(t('ফর্মে ত্রুটি রয়েছে', 'Please fix the highlighted fields'), 'error'); return; }
    try {
      await updateMember(m.id, v, session);
      toast(t('সদস্য তথ্য সংরক্ষণ হয়েছে', 'Member updated'), 'success');
      if (onSaved) onSaved(); else App.refresh();
    } catch (err) {
      if (err.fieldErrors) err.fieldErrors.forEach(fe => setErr(fe.field, fe.msg));
      else toast(err.message, 'error');
    }
  });

  box.appendChild(card(t('সদস্য তথ্য', 'Member information'), m.memberId, f));
  return box;
}

/* ------------------------- member's own read-only view ------------------------- */

async function memberSelfView(session) {
  const [m, deposits, withdrawals, cfg] = await Promise.all([
    getMember(session.memberDocId), allDeposits(), allWithdrawals(), settings(),
  ]);
  const wrap = page(t('আমার প্রোফাইল', 'My profile'), 'My profile', 'member');
  if (!m) { wrap.appendChild(banner('err', esc(t('সদস্য তথ্য পাওয়া যায়নি।', 'Member record not found.')))); return wrap; }
  wrap.appendChild(memberEditor(session, m, deposits, withdrawals, cfg));
  return wrap;
}

export { rejectReason };
export const pageMembersHub = pageMembers;
export { alertBox, normalizeMobile, todayISO, money, listRow };
