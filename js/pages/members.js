/* Member Registration (staff), Member Edit, Member List */
import {
  el, esc, toast, taka, money, num, fmtDate, toISO, todayISO, memberIdFromMobile, isValidMobile,
  isValidEmail, normalizeMobile, debounce, confirmBox, waNumber, modal, alertBox, t,
} from '../util.js';
import { icon } from '../icons.js';
import { page, card, tableWrap, statusTag, banner, btn, kv, tabs, embedPage, emptyState } from '../ui.js';
import { memberPicker } from '../picker.js';
import {
  allMembers, allDeposits, settings, registerMember, updateMember, setMemberStatus,
  memberSummary, getMember, DEFAULT_MEMBER_PASSWORD, summaryOpts,
} from '../store.js';
import { can } from '../auth.js';
import { App } from '../app.js';
import { formModal } from './account.js';
import { dueMessage } from './reports.js';

/* ============ Members hub (Register / Update / Search) ============ */
export async function pageMembersHub(session, params = {}) {
  const wrap = page('সদস্য ব্যবস্থাপনা', 'Member Management', 'members');
  const TABS = [
    { id: 'search', label: 'তালিকা / List' },
    { id: 'register', label: 'নিবন্ধন / Register' },
    { id: 'update', label: 'সম্পাদনা / Edit' },
  ];
  // Daily work starts from the list. A memberDocId shortcut (e.g. from the
  // list's Edit button or approval queues) opens সম্পাদনা directly.
  // Daily work starts from the list. A memberDocId shortcut (e.g. from the
  // list's Edit button or approval queues) opens সম্পাদনা directly.
  const req = params.memberDocId ? 'update' : ((params.section || params.tab) && TABS.some(x => x.id === (params.section || params.tab)) ? (params.section || params.tab) : 'search');
  let active = req;
  const host = el('div');
  const tabBar = tabs(TABS, active, id => {
    active = id;
    App.go('members', { section: id });
  });
  wrap.append(tabBar, host);

  async function paint() {
    host.replaceChildren();
    tabBar.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', TABS[i].id === active));
    if (active === 'register') await embedPage(host, pageRegister, session);
    else if (active === 'update') await embedPage(host, pageMemberUpdate, session, params.memberDocId ? { memberDocId: params.memberDocId } : {});
    else await embedPage(host, pageSearch, session);
  }
  await paint();
  return wrap;
}

/* ============ Member Registration (Admin/Maker enrol on behalf) ============ */
/* Mobile: a 3-step wizard (one column, sticky action bar). Desktop: the same
   fields render as one page — see the .wstep rules in app.css. */
const REG_STEPS = [
  { bn: 'যোগাযোগ', en: 'Contact' },
  { bn: 'পরিচয়', en: 'Identity' },
  { bn: 'কিস্তি ও ঠিকানা', en: 'Installment & address' },
];
/* Server-side field errors jump back to the step that owns the field. */
const REG_FIELD_STEP = {
  mobile: 0, whatsapp: 0, email: 0, memberId: 0,
  nameBn: 1, nameEn: 1, fatherBn: 1, fatherEn: 1, motherBn: 1, motherEn: 1,
  installment: 2, address: 2, nid: 2, profession: 2, dob: 2,
};
const BN_STEP = ['১', '২', '৩'];

export async function pageRegister(session) {
  const cfg = await settings();
  const wrap = page('সদস্য নিবন্ধন', 'Member Registration', 'register');
  wrap.appendChild(banner('info', 'সদস্য নিজে লগইন পেজ থেকেও নিবন্ধন করতে পারেন। এখান থেকে Admin/Maker সদস্যের পক্ষে নিবন্ধন করবেন — নিবন্ধনের পর স্ট্যাটাস <b>অনুমোদনের অপেক্ষায়</b> থাকবে।'));

  let step = 0;
  const form = el('form', { class: 'grid mform', novalidate: true });
  const indicator = el('div', { class: 'wsteps', 'aria-hidden': 'true' });
  form.innerHTML = `
    <div class="wstep" data-step="0">
      <div class="field"><label>মোবাইল নম্বর <span class="req">*</span></label>
        <input name="mobile" inputmode="numeric" maxlength="11" placeholder="01712345678" autocomplete="off">
        <div class="hint" id="midHint">সদস্য ID: —</div><div class="err" data-err="mobile"></div></div>
      <div class="field"><label>WhatsApp নম্বর <span class="req">*</span></label>
        <input name="whatsapp" inputmode="numeric" maxlength="11" placeholder="01712345678" autocomplete="off">
        <label class="check" style="margin-top:3px"><input type="checkbox" name="sameWa" checked> মোবাইল নম্বরের মতোই</label>
        <div class="err" data-err="whatsapp"></div></div>
      <div class="field"><label>ইমেইল (ঐচ্ছিক)</label>
        <input name="email" type="email" placeholder="name@mail.com" autocomplete="off"><div class="err" data-err="email"></div></div>
    </div>
    <div class="wstep" data-step="1">
      <div class="field"><label>নাম (বাংলা) <span class="req">*</span></label>
        <input name="nameBn" autocomplete="off"><div class="err" data-err="nameBn"></div></div>
      <div class="field"><label>নাম (ইংরেজি) <span class="req">*</span></label>
        <input name="nameEn" autocomplete="off"><div class="err" data-err="nameEn"></div></div>
      <div class="field"><label>পিতার নাম (ঐচ্ছিক)</label><input name="fatherBn" autocomplete="off"></div>
      <div class="field"><label>পিতার নাম — ইংরেজি (ঐচ্ছিক)</label><input name="fatherEn" autocomplete="off"></div>
      <div class="field"><label>মাতার নাম (ঐচ্ছিক)</label><input name="motherBn" autocomplete="off"></div>
      <div class="field"><label>মাতার নাম — ইংরেজি (ঐচ্ছিক)</label><input name="motherEn" autocomplete="off"></div>
    </div>
    <div class="wstep" data-step="2">
      <div class="field"><label>মাসিক কিস্তি (৳) <span class="req">*</span></label>
        <input name="installment" type="number" min="1" step="1" value="${cfg.defaultInstallment}" inputmode="numeric">
        <div class="err" data-err="installment"></div>
        <div class="hint">সদস্য মোবাইল নম্বর দিয়ে লগইন করবেন। ডিফল্ট পাসওয়ার্ড <b>${esc(DEFAULT_MEMBER_PASSWORD)}</b> — প্রথম লগইনে পরিবর্তন বাধ্যতামূলক।</div></div>
      <div class="field"><label>ঠিকানা (ঐচ্ছিক)</label><textarea name="address" rows="2"></textarea></div>
      <div class="field"><label>NID (ঐচ্ছিক)</label><input name="nid" inputmode="numeric" autocomplete="off"></div>
      <div class="field"><label>পেশা (ঐচ্ছিক)</label><input name="profession" autocomplete="off"></div>
      <div class="field"><label>জন্মতারিখ (ঐচ্ছিক)</label><input name="dob" type="date"></div>
    </div>
    <div class="form-sticky">
      <button class="btn btn-ghost wiz-back" type="button">${icon('back')}<span>${t('ফিরে যান', 'Back')}</span></button>
      <button class="btn btn-primary wiz-next" type="button"><span>${t('পরের ধাপ', 'Next')}</span>${icon('chevron')}</button>
      <button class="btn btn-primary wiz-submit" type="submit">${icon('check')}<span>${t('সদস্য যোগ করুন', 'Add member')}</span></button>
    </div>`;
  form.prepend(indicator);
  wrap.appendChild(card('নতুন সদস্য তথ্য', 'New Member Details', form));

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

  const midHint = form.querySelector('#midHint');
  const syncWa = () => { if (form.elements.sameWa.checked) form.elements.whatsapp.value = form.elements.mobile.value; };
  form.elements.whatsapp.readOnly = true;
  form.elements.mobile.addEventListener('input', () => {
    form.elements.mobile.value = form.elements.mobile.value.replace(/\D/g, '').slice(0, 11);
    const mid = memberIdFromMobile(form.elements.mobile.value);
    midHint.innerHTML = mid ? `সদস্য ID: <b style="color:var(--green-dark)">${mid}</b>` : 'সদস্য ID: —';
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
  /* Same rules as before — only split per step for the wizard. */
  const validateStep = idx => {
    const v = Object.fromEntries(new FormData(form).entries());
    let bad = false;
    if (idx === 0) {
      if (!isValidMobile(v.mobile)) { setErr('mobile', 'সঠিক ১১ সংখ্যার মোবাইল নম্বর দিন'); bad = true; }
      if (!isValidMobile(v.whatsapp)) { setErr('whatsapp', 'সঠিক WhatsApp নম্বর দিন'); bad = true; }
      if (v.email && !isValidEmail(v.email)) { setErr('email', 'সঠিক ইমেইল দিন'); bad = true; }
    } else if (idx === 1) {
      if (!String(v.nameBn || '').trim()) { setErr('nameBn', 'নাম (বাংলা) আবশ্যক'); bad = true; }
      if (!String(v.nameEn || '').trim()) { setErr('nameEn', t('নাম (ইংরেজি) আবশ্যক', 'Name (English) is required')); bad = true; }
    } else {
      if (!(num(v.installment) > 0)) { setErr('installment', 'মাসিক কিস্তি দিন'); bad = true; }
    }
    return !bad;
  };

  backBtn.addEventListener('click', () => { if (step > 0) { step--; paint(); toTop(); } });
  nextBtn.addEventListener('click', () => {
    clearErrs();
    if (!validateStep(step)) { toast('ফর্মে ত্রুটি রয়েছে / Please fix the highlighted fields', 'error'); focusFirstBad(); return; }
    step++; paint(); toTop();
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    clearErrs();
    for (let i = 0; i < REG_STEPS.length; i++) {
      if (!validateStep(i)) {
        step = i; paint();
        toast('ফর্মে ত্রুটি রয়েছে / Please fix the highlighted fields', 'error');
        focusFirstBad();
        return;
      }
    }
    const v = Object.fromEntries(new FormData(form).entries());
    const b = submitBtn; b.disabled = true;
    try {
      const m = await registerMember({ ...v, password: '' }, { defaultPassword: true });
      await modal({
        title: t('নিবন্ধন সফল', 'Registration Successful'), width: 400,
        body: `<div class="success-pop"><div class="tick">${icon('check')}</div></div>
          <div class="kv"><div>সদস্য ID</div><div><b style="color:var(--green-dark)">${esc(m.memberId)}</b></div>
          <div>নাম</div><div>${esc(m.nameBn)}</div><div>মোবাইল</div><div>${esc(m.mobile)}</div>
          <div>স্ট্যাটাস</div><div><span class="tag pending">অনুমোদনের অপেক্ষায়</span></div></div>
          <div class="banner warn" style="margin-top:9px">${icon('pending')}<span><b>অনুমোদনের অপেক্ষায়</b> — Maker/Admin অনুমোদন দিলে সদস্য সক্রিয় হবেন।</span></div>
          <div class="banner info">${icon('key')}<span>লগইন: <b>${esc(m.mobile)}</b> · ডিফল্ট পাসওয়ার্ড <b>${esc(DEFAULT_MEMBER_PASSWORD)}</b> — প্রথম লগইনে পরিবর্তন বাধ্যতামূলক।</span></div>`,
        actions: [{ label: t('ঠিক আছে', 'OK'), value: true, kind: 'primary' }],
      });
      form.reset();
      midHint.textContent = 'সদস্য ID: —';
      form.elements.installment.value = cfg.defaultInstallment;
      form.elements.whatsapp.readOnly = form.elements.sameWa.checked;
      step = 0; paint(); toTop();
    } catch (err) {
      if (err.fieldErrors) {
        err.fieldErrors.forEach(fe => setErr(fe.field === 'memberId' ? 'mobile' : fe.field, fe.msg));
        const first = err.fieldErrors[0] && err.fieldErrors[0].field;
        step = REG_FIELD_STEP[first] ?? 0;
        paint(); focusFirstBad();
      } else toast(err.message, 'error');
    } finally { b.disabled = false; }
  });

  paint();
  return wrap;
}

/* ============ Member Update ============ */
export async function pageMemberUpdate(session, params = {}) {
  const [members, deposits, cfg] = await Promise.all([allMembers(), allDeposits(), settings()]);
  const wrap = page('সদস্য সম্পাদনা', 'Edit Member', 'edit');
  if (!members.length) { wrap.appendChild(banner('info', 'এখনো কোনো সদস্য নিবন্ধিত হয়নি / No members registered yet')); return wrap; }

  const host = el('div');
  /* Stale async loads (deep-link double-fire, rapid re-picks) must not append. */
  let seq = 0;
  const load = async id => {
    const my = ++seq;
    const m = id ? await getMember(id) : null;
    if (my !== seq) return;
    host.replaceChildren();
    if (m) host.appendChild(memberEditor(session, m, deposits, cfg, () => App.refresh()));
  };
  const picker = memberPicker({
    members,
    value: params.memberDocId && members.some(m => m.id === params.memberDocId) ? params.memberDocId : '',
    onPick: m => load(m ? m.id : ''),
  });
  const pickCard = card('সদস্য খুঁজুন', 'Find member', picker.root);
  pickCard.classList.add('overflow-visible');
  wrap.appendChild(pickCard);
  wrap.appendChild(host);

  if (picker.value) await load(picker.value);
  else if (window.matchMedia && matchMedia('(min-width:1024px)').matches) picker.focus();
  return wrap;
}

export function memberEditor(session, m, deposits, cfg, onSaved) {
  const s = memberSummary(m, deposits, summaryOpts(cfg));
  const box = el('div');

  const summary = el('div', { class: 'stats' });
  summary.innerHTML = `
    <div class="stat"><div class="lbl">${icon('money')} মোট জমা</div><div class="val">${taka(s.totalDeposit)}</div><div class="sub">${s.count}টি অনুমোদিত</div></div>
    <div class="stat red"><div class="lbl">${icon('due')} বকেয়া</div><div class="val">${taka(s.due)}</div><div class="sub">প্রয়োজন ${taka(s.required)}</div></div>
    <div class="stat"><div class="lbl">${icon('advance')} অগ্রিম</div><div class="val">${taka(s.advance)}</div><div class="sub">${s.months} মাস</div></div>
    <div class="stat gray"><div class="lbl">${icon('member')} স্ট্যাটাস</div><div class="val">${statusTag(m.status)}</div><div class="sub">সদস্য ID ${esc(m.memberId)}</div></div>`;
  box.appendChild(summary);

  const canEdit = can(session, 'member:edit');
  const f = el('form', { class: 'grid mform', novalidate: true });
  const ro = canEdit ? '' : 'readonly';
  f.innerHTML = `
    <div class="grid g2">
      <div class="field"><label>সদস্য ID (পরিবর্তনযোগ্য নয়)</label><input value="${esc(m.memberId)}" readonly></div>
      <div class="field"><label>স্ট্যাটাস</label><div style="padding-top:9px">${statusTag(m.status)}</div></div>
      <div class="form-sec">${t('যোগাযোগ', 'Contact')}</div>
      <div class="field"><label>মোবাইল নম্বর <span class="req">*</span></label><input name="mobile" ${ro} maxlength="11" inputmode="numeric" value="${esc(m.mobile)}" autocomplete="off"><div class="hint">নম্বর পরিবর্তন করলেও সদস্য ID অপরিবর্তিত থাকবে।</div><div class="err" data-err="mobile"></div></div>
      <div class="field"><label>WhatsApp নম্বর <span class="req">*</span></label><input name="whatsapp" ${ro} maxlength="11" inputmode="numeric" value="${esc(m.whatsapp)}" autocomplete="off"><div class="err" data-err="whatsapp"></div></div>
      <div class="field"><label>ইমেইল (ঐচ্ছিক)</label><input name="email" type="email" ${ro} value="${esc(m.email || '')}" autocomplete="off"><div class="err" data-err="email"></div></div>
      <div class="field"><label>NID (ঐচ্ছিক)</label><input name="nid" ${ro} value="${esc(m.nid || '')}" autocomplete="off"></div>
      <div class="form-sec">${t('পরিচয়', 'Identity')}</div>
      <div class="field"><label>নাম (বাংলা) <span class="req">*</span></label><input name="nameBn" ${ro} value="${esc(m.nameBn)}" autocomplete="off"><div class="err" data-err="nameBn"></div></div>
      <div class="field"><label>নাম (ইংরেজি) <span class="req">*</span></label><input name="nameEn" ${ro} value="${esc(m.nameEn)}" autocomplete="off"><div class="err" data-err="nameEn"></div></div>
      <div class="field"><label>পিতার নাম (ঐচ্ছিক)</label><input name="fatherBn" ${ro} value="${esc(m.fatherBn || '')}" autocomplete="off"></div>
      <div class="field"><label>পিতার নাম — ইংরেজি (ঐচ্ছিক)</label><input name="fatherEn" ${ro} value="${esc(m.fatherEn || '')}" autocomplete="off"></div>
      <div class="field"><label>মাতার নাম (ঐচ্ছিক)</label><input name="motherBn" ${ro} value="${esc(m.motherBn || '')}" autocomplete="off"></div>
      <div class="field"><label>মাতার নাম — ইংরেজি (ঐচ্ছিক)</label><input name="motherEn" ${ro} value="${esc(m.motherEn || '')}" autocomplete="off"></div>
      <div class="field"><label>জন্মতারিখ (ঐচ্ছিক)</label><input name="dob" type="date" ${ro} value="${esc((m.dob || '').slice(0, 10))}"><div class="hint">প্রদর্শন: ${esc(fmtDate(m.dob) || '—')}</div></div>
      <div class="field"><label>পেশা (ঐচ্ছিক)</label><input name="profession" ${ro} value="${esc(m.profession || '')}" autocomplete="off"></div>
      <div class="form-sec">${t('কিস্তি ও অন্যান্য', 'Installment & more')}</div>
      <div class="field"><label>মাসিক কিস্তি (৳) <span class="req">*</span></label><input name="installment" type="number" min="1" ${ro} value="${esc(m.installment)}"><div class="err" data-err="installment"></div></div>
      <div class="field"><label>যোগদানের তারিখ${session.role === 'admin' ? ' <span class="req">*</span>' : ''}</label>
        ${session.role === 'admin'
          ? `<input name="joinDate" type="date" value="${esc((m.joinDate || '').slice(0, 10))}" required><div class="hint">প্রদর্শন: ${esc(fmtDate(m.joinDate) || '—')} — শুধু Admin পরিবর্তন করতে পারেন।</div><div class="err" data-err="joinDate"></div>`
          : `<input value="${esc(fmtDate(m.joinDate))}" readonly>`}</div>
    </div>
    <div class="field"><label>ঠিকানা (ঐচ্ছিক)</label><textarea name="address" rows="2" ${ro}>${esc(m.address || '')}</textarea></div>`;

  if (canEdit) {
    const acts = el('div', { class: 'form-actions' });
    acts.appendChild(el('button', { class: 'btn btn-primary', type: 'submit', html: `${icon('save')}<span>${t('পরিবর্তন সংরক্ষণ', 'Save changes')}</span>` }));
    acts.appendChild(btn(t('মুছুন', 'Clear'), 'clear', 'ghost', () => f.reset()));
    if (m.status === 'pending') {
      acts.appendChild(btn(t('অনুমোদন', 'Approve'), 'approve', 'soft', async () => {
        if (!(await confirmBox(`${m.nameBn} (${m.memberId}) — সদস্যপদ অনুমোদন করবেন?`, { okLabel: t('অনুমোদন', 'Approve') }))) return;
        await setMemberStatus(m.id, 'active', session);
        toast('সদস্য অনুমোদিত / Member approved', 'success'); onSaved && onSaved();
      }));
      acts.appendChild(btn(t('বাতিল', 'Reject'), 'reject', 'softred', async () => {
        const r = await rejectReason();
        if (r === null) return;
        await setMemberStatus(m.id, 'rejected', session, r);
        toast('সদস্য বাতিল / Member rejected', 'warn'); onSaved && onSaved();
      }));
    }
    if (m.status === 'rejected' && session.role === 'admin') {
      acts.appendChild(btn(t('পুনর্বহাল', 'Re-activate'), 'approve', 'soft', async () => {
        if (!(await confirmBox('সদস্যকে পুনরায় সক্রিয় করবেন? / Re-activate this member?', { okLabel: t('সক্রিয় করুন', 'Activate') }))) return;
        await setMemberStatus(m.id, 'active', session); toast(t('সদস্য পুনর্বহাল হয়েছে', 'Member re-activated'), 'success'); onSaved && onSaved();
      }));
    }
    if (m.status === 'active' && session.role === 'admin') {
      acts.appendChild(btn(t('নিষ্ক্রিয়', 'Deactivate'), 'reject', 'softred', async () => {
        if (!(await confirmBox('সদস্যকে নিষ্ক্রিয় করবেন? / Deactivate this member?', { okLabel: t('নিষ্ক্রিয় করুন', 'Deactivate'), danger: true }))) return;
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
        window.open(`https://wa.me/${waNumber(m.whatsapp || m.mobile)}?text=${encodeURIComponent(dueMessage(m.nameBn || m.nameEn))}`, '_blank');
      }));
    }
    f.appendChild(acts);
  } else {
    f.appendChild(banner('info', 'অনুমোদিত প্রোফাইল তথ্য শুধুমাত্র পঠনযোগ্য / Approved profile information is read only.'));
  }

  f.addEventListener('submit', async e => {
    e.preventDefault();
    f.querySelectorAll('.err').forEach(x => x.textContent = '');
    f.querySelectorAll('.field').forEach(x => x.classList.remove('bad'));
    const setErr = (n, msg) => { const b = f.querySelector(`[data-err="${n}"]`); if (b) { b.textContent = msg; b.closest('.field').classList.add('bad'); } };
    const v = Object.fromEntries(new FormData(f).entries());
    let bad = false;
    if (!isValidMobile(v.mobile)) { setErr('mobile', 'সঠিক মোবাইল নম্বর দিন'); bad = true; }
    if (!isValidMobile(v.whatsapp)) { setErr('whatsapp', 'সঠিক WhatsApp নম্বর দিন'); bad = true; }
    if (!String(v.nameBn || '').trim()) { setErr('nameBn', 'নাম (বাংলা) আবশ্যক'); bad = true; }
    if (!String(v.nameEn || '').trim()) { setErr('nameEn', t('নাম (ইংরেজি) আবশ্যক', 'Name (English) is required')); bad = true; }
    if (v.email && !isValidEmail(v.email)) { setErr('email', 'সঠিক ইমেইল দিন'); bad = true; }
    if (!(num(v.installment) > 0)) { setErr('installment', 'মাসিক কিস্তি দিন'); bad = true; }
    if (session.role === 'admin' && !/^\d{4}-\d{2}-\d{2}$/.test(String(v.joinDate || ''))) { setErr('joinDate', 'সঠিক যোগদানের তারিখ দিন'); bad = true; }
    if (bad) { toast('ফর্মে ত্রুটি রয়েছে', 'error'); return; }
    try {
      await updateMember(m.id, v, session);
      toast('সদস্য তথ্য সংরক্ষণ হয়েছে / Member updated', 'success');
      onSaved && onSaved();
    } catch (err) {
      if (err.fieldErrors) err.fieldErrors.forEach(fe => setErr(fe.field, fe.msg));
      else toast(err.message, 'error');
    }
  });

  box.appendChild(card('সদস্য তথ্য', `Member Information — ${m.memberId}`, f));
  return box;
}

/** Ask for a rejection reason. Resolves with the reason string, or null when cancelled. */
export function rejectReason(title = 'বাতিলের কারণ / Rejection Reason') {
  return new Promise(resolve => {
    const body = el('div');
    body.innerHTML = `<div class="field"><label>কারণ / Reason</label>
      <textarea class="js-reason" rows="3" placeholder="ঐচ্ছিক / optional"></textarea>
      <div class="hint">কারণটি সদস্যের রেকর্ড ও Activity Log-এ সংরক্ষিত হবে।</div></div>`;
    const ta = body.querySelector('.js-reason');
    modal({
      title, body, width: 380,
      actions: [
        { label: t('ফিরে যান', 'Cancel'), value: null, kind: 'ghost' },
        { label: t('বাতিল করুন', 'Reject'), value: 'ok', kind: 'danger' },
      ],
    }).then(v => resolve(v === 'ok' ? ta.value.trim() : null));
  });
}

/* ============ Member Search ============ */
export async function pageSearch(session) {
  const [members, deposits, cfg] = await Promise.all([allMembers(), allDeposits(), settings()]);
  const wrap = page('সদস্য তালিকা', 'Member List', 'search');

  /* Summaries are computed once — members/deposits don't change while the page is open. */
  const sums = new Map();
  members.forEach(m => sums.set(m.id, memberSummary(m, deposits, summaryOpts(cfg))));

  const searchBox = el('div', { class: 'search-box', html: icon('search') });
  const inp = el('input', {
    placeholder: t('ID / নাম / মোবাইল দিয়ে খুঁজুন…', 'Search ID / name / mobile…'),
    autocomplete: 'off', 'aria-label': t('সদস্য খুঁজুন', 'Search members'),
  });
  searchBox.appendChild(inp);
  wrap.appendChild(searchBox);

  const STATUS_FILTERS = [
    { id: '', bn: 'সব', en: 'All' },
    { id: 'active', bn: 'সক্রিয়', en: 'Active' },
    { id: 'pending', bn: 'অপেক্ষমান', en: 'Pending' },
    { id: 'rejected', bn: 'বাতিল', en: 'Rejected' },
    { id: 'inactive', bn: 'নিষ্ক্রিয়', en: 'Inactive' },
  ];
  const DUE_FILTERS = [
    { id: '', bn: 'সব হিসাব', en: 'All balances' },
    { id: 'due', bn: 'শুধু বকেয়া', en: 'Due only' },
    { id: 'advance', bn: 'শুধু অগ্রিম', en: 'Advance only' },
  ];
  let st = '', fl = '';
  const chips = el('div', { class: 'chips', role: 'group', 'aria-label': t('স্ট্যাটাস ফিল্টার', 'Status filter') });
  const chips2 = el('div', { class: 'chips', role: 'group', 'aria-label': t('হিসাব ফিল্টার', 'Balance filter') });
  const countLine = el('div', { class: 'count-line' });
  const listHost = el('div', { class: 'person-list' });
  wrap.append(chips, chips2, countLine, listHost);

  const paintChips = () => {
    const mk = (f, n, on, set) => {
      const b = el('button', { type: 'button', class: 'chip' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false' });
      b.textContent = `${t(f.bn, f.en)} · ${n}`;
      b.addEventListener('click', () => { set(f.id); paintChips(); render(); });
      return b;
    };
    chips.replaceChildren(...STATUS_FILTERS.map(f =>
      mk(f, f.id ? members.filter(m => m.status === f.id).length : members.length, st === f.id, v => { st = v; })));
    chips2.replaceChildren(...DUE_FILTERS.map(f =>
      mk(f, f.id === 'due' ? members.filter(m => (sums.get(m.id) || {}).due > 0).length
        : f.id === 'advance' ? members.filter(m => (sums.get(m.id) || {}).advance > 0).length : members.length,
        fl === f.id, v => { fl = v; })));
  };

  const filtered = () => {
    const q = inp.value.trim().toLowerCase();
    return members
      .filter(m => {
        if (st && m.status !== st) return false;
        if (!q) return true;
        return [m.memberId, m.nameBn, m.nameEn, m.mobile, m.whatsapp, m.email, m.nid]
          .some(x => String(x || '').toLowerCase().includes(q));
      })
      .map(m => ({ m, s: sums.get(m.id) }))
      .filter(r => fl === 'due' ? r.s.due > 0 : fl === 'advance' ? r.s.advance > 0 : true);
  };

  const openWa = m => window.open(`https://wa.me/${waNumber(m.whatsapp || m.mobile)}?text=${encodeURIComponent(dueMessage(m.nameBn || m.nameEn))}`, '_blank');

  const render = () => {
    const rows = filtered();
    const totalDue = rows.reduce((a, r) => a + (r.s.due > 0 ? r.s.due : 0), 0);
    countLine.textContent = t(`${rows.length} জন সদস্য · মোট বকেয়া ${taka(totalDue)}`, `${rows.length} member(s) · total due ${taka(totalDue)}`);
    listHost.replaceChildren();
    if (!rows.length) {
      listHost.appendChild(emptyState({
        ic: 'search',
        title: t('কোনো সদস্য পাওয়া যায়নি', 'No members found'),
        hint: (inp.value.trim() || st || fl) ? t('খোঁজ বা ফিল্টার বদলে আবার দেখুন', 'Try a different search or filter') : '',
        actionLabel: can(session, 'member:edit') ? t('সদস্য যোগ করুন', 'Add member') : '',
        onAction: can(session, 'member:edit') ? () => App.go('members', { section: 'register' }) : null,
      }));
      return;
    }
    if (window.matchMedia && matchMedia('(max-width: 767px)').matches) {
      rows.forEach(({ m, s }) => listHost.appendChild(personCard(m, s, {
        onView: () => viewMember(session, m, s),
        onEdit: can(session, 'member:edit') ? () => App.go('members', { section: 'update', memberDocId: m.id }) : null,
        onWa: s.due > 0 && can(session, 'whatsapp') ? () => openWa(m) : null,
      })));
    } else {
      listHost.appendChild(tableWrap(
        [{ label: 'ID' }, { label: 'নাম' }, { label: 'মোবাইল' }, { label: 'কিস্তি', cls: 'num' },
         { label: 'জমা', cls: 'num' }, { label: 'বকেয়া', cls: 'num' }, { label: 'অগ্রিম', cls: 'num' },
         { label: 'স্ট্যাটাস' }, { label: 'অ্যাকশন', cls: 'nowrap' }],
        rows.map(({ m, s }) => {
          const acts = el('div', { class: 'btn-row' });
          acts.appendChild(btn(t('দেখুন', 'View'), 'eye', 'ghost', () => viewMember(session, m, s), { size: 'xs' }));
          if (can(session, 'member:edit')) acts.appendChild(btn(t('সম্পাদনা', 'Edit'), 'edit', 'ghost', () => App.go('members', { section: 'update', memberDocId: m.id }), { size: 'xs' }));
          if (s.due > 0 && can(session, 'whatsapp')) acts.appendChild(btn('WhatsApp', 'whatsapp', 'wa', () => openWa(m), { size: 'xs' }));
          return [
            `<b>${esc(m.memberId)}</b>`,
            `${esc(m.nameBn)}<br><span class="faint fs8">${esc(m.nameEn)}</span>`,
            esc(m.mobile),
            { text: money(m.installment), cls: 'num' },
            { text: money(s.totalDeposit), cls: 'num' },
            { html: s.due > 0 ? `<span class="due-amt">${money(s.due)}</span>` : '0', cls: 'num' },
            { html: s.advance > 0 ? `<span class="adv-amt">${money(s.advance)}</span>` : '0', cls: 'num' },
            { html: statusTag(m.status) },
            { node: acts, cls: 'nowrap' },
          ];
        }),
        { empty: t('কোনো সদস্য পাওয়া যায়নি', 'No members found'), emptyIcon: 'search' },
      ));
    }
  };

  /* Re-render cards ⇄ table when the viewport crosses the breakpoint. */
  if (window.matchMedia) {
    const mq = matchMedia('(max-width: 767px)');
    const onBp = () => {
      if (!listHost.isConnected) { if (mq.removeEventListener) mq.removeEventListener('change', onBp); return; }
      render();
    };
    if (mq.addEventListener) mq.addEventListener('change', onBp);
  }

  inp.addEventListener('input', debounce(render, 180));
  paintChips();
  render();
  return wrap;
}

export function viewMember(session, m, s) {
  const body = el('div');
  body.appendChild(kv([
    ['সদস্য ID', `<b>${esc(m.memberId)}</b>`],
    ['নাম (বাংলা)', esc(m.nameBn)],
    ['নাম (ইংরেজি)', esc(m.nameEn)],
    ['পিতার নাম', esc(m.fatherBn || m.fatherEn || '')],
    ['মাতার নাম', esc(m.motherBn || m.motherEn || '')],
    ['মোবাইল', esc(m.mobile)],
    ['WhatsApp', esc(m.whatsapp)],
    ['ইমেইল', esc(m.email || '')],
    ['NID', esc(m.nid || '')],
    ['জন্মতারিখ', esc(fmtDate(m.dob))],
    ['পেশা', esc(m.profession || '')],
    ['ঠিকানা', esc(m.address || '')],
    ['মাসিক কিস্তি', taka(m.installment)],
    ['যোগদানের তারিখ', esc(fmtDate(m.joinDate))],
    ['স্ট্যাটাস', statusTag(m.status)],
    ['মোট জমা', `<b>${taka(s.totalDeposit)}</b>`],
    ['মোট বকেয়া', s.due > 0 ? `<span class="due-amt">${taka(s.due)}</span>` : taka(0)],
    ['মোট অগ্রিম', s.advance > 0 ? `<span class="adv-amt">${taka(s.advance)}</span>` : taka(0)],
  ]));
  return modal({ title: `সদস্য তথ্য / Member — ${m.memberId}`, body, width: 460, actions: [{ label: t('বন্ধ করুন', 'Close'), value: true, kind: 'ghost' }] });
}

/** Compact 3-line member card with দেখুন/সম্পাদনা/WhatsApp actions (mobile
 *  list). Tapping the header opens the details — same as দেখুন. Desktop
 *  keeps the table. */
export function personCard(m, s, { onView, onEdit, onWa } = {}) {
  const c = el('div', { class: 'pcard' });
  const head = el('button', { type: 'button', class: 'pc-head', 'aria-label': `${m.nameBn || m.nameEn || m.memberId} — ${t('দেখুন', 'View')}` });
  head.innerHTML = `<span class="pc-ava">${icon('member')}</span>
    <span class="pc-idcol">
      <span class="pc-name">${esc(m.nameBn || m.nameEn || '')}</span>
      ${m.nameBn && m.nameEn && m.nameEn !== m.nameBn ? `<span class="pc-name-en">${esc(m.nameEn)}</span>` : ''}
      <span class="pc-idline">${t('সদস্য আইডি', 'ID')}: <b>${esc(m.memberId)}</b></span>
    </span>
    <span class="pc-side">${statusTag(m.status)}<span class="pc-go">${icon('chevron')}</span></span>`;
  if (onView) head.addEventListener('click', onView);
  c.appendChild(head);
  const nums = el('div', { class: 'pc-nums' });
  nums.innerHTML = `<span>${t('কিস্তি', 'Installment')} <b>${money(m.installment)}</b></span>`
    + `<span>${t('জমা', 'Deposit')} <b>${money(s.totalDeposit)}</b></span>`
    + `<span>${t('বকেয়া', 'Due')} <b class="${s.due > 0 ? 'due-amt' : ''}">${money(s.due)}</b></span>`
    + `<span>${t('অগ্রিম', 'Advance')} <b class="${s.advance > 0 ? 'adv-amt' : ''}">${money(s.advance)}</b></span>`;
  c.appendChild(nums);
  const acts = el('div', { class: 'pc-acts' });
  if (onView) acts.appendChild(btn(t('বিস্তারিত', 'Details'), 'eye', 'ghost', onView, { size: 'xs' }));
  if (onEdit) acts.appendChild(btn(t('সম্পাদনা', 'Edit'), 'edit', 'ghost', onEdit, { size: 'xs' }));
  if (onWa) acts.appendChild(btn('WhatsApp', 'whatsapp', 'wa', onWa, { size: 'xs' }));
  if (acts.children.length) c.appendChild(acts);
  return c;
}
