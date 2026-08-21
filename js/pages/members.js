/* Member Registration (staff), Member Update, Member Search */
import {
  el, esc, toast, taka, money, num, fmtDate, toISO, todayISO, memberIdFromMobile, isValidMobile,
  isValidEmail, normalizeMobile, debounce, confirmBox, waNumber, modal, alertBox,
} from '../util.js';
import { icon } from '../icons.js';
import { page, card, tableWrap, statusTag, banner, btn, kv, tabs, embedPage } from '../ui.js';
import {
  allMembers, allDeposits, settings, registerMember, updateMember, setMemberStatus,
  memberSummary, getMember, DEFAULT_MEMBER_PASSWORD,
} from '../store.js';
import { can } from '../auth.js';
import { App } from '../app.js';
import { formModal } from './account.js';
import { dueMessage } from './reports.js';

/* ============ Members hub (Register / Update / Search) ============ */
export async function pageMembersHub(session, params = {}) {
  const wrap = page('সদস্য ব্যবস্থাপনা', 'Member Management', 'members');
  const TABS = [
    { id: 'register', label: 'নিবন্ধন / Register' },
    { id: 'update', label: 'হালনাগাদ / Update' },
    { id: 'search', label: 'অনুসন্ধান / Search' },
  ];
  // A memberDocId shortcut (e.g. from approval queues) opens the Update tab.
  let active = params.memberDocId ? 'update' : (params.tab && TABS.some(t => t.id === params.tab) ? params.tab : 'register');
  const host = el('div');
  const tabBar = tabs(TABS, active, id => {
    active = id;
    App.params = { ...(App.params || {}), tab: id };
    paint();
    tabBar.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', TABS[i].id === id));
  });
  wrap.append(tabBar, host);

  async function paint() {
    host.replaceChildren();
    if (active === 'register') await embedPage(host, pageRegister, session);
    else if (active === 'update') await embedPage(host, pageMemberUpdate, session, params.memberDocId ? { memberDocId: params.memberDocId } : {});
    else await embedPage(host, pageSearch, session);
  }
  await paint();
  return wrap;
}

/* ============ Member Registration (Admin/Maker enrol on behalf) ============ */
export async function pageRegister(session) {
  const cfg = await settings();
  const wrap = page('সদস্য নিবন্ধন', 'Member Registration', 'register');
  wrap.appendChild(banner('info', 'সদস্য নিজে Login পেজ থেকেও নিবন্ধন করতে পারেন। এখান থেকে Admin/Maker সদস্যের পক্ষে নিবন্ধন করতে পারবেন — নিবন্ধনের পর স্ট্যাটাস <b>Pending Approval</b> থাকবে।'));

  const form = el('form', { class: 'grid', novalidate: true });
  form.innerHTML = `
    <fieldset><legend>${'যোগাযোগ / Contact'}</legend>
      <div class="grid g2">
        <div class="field"><label>Mobile Number <span class="req">*</span></label>
          <input name="mobile" inputmode="numeric" maxlength="11" required placeholder="01712345678">
          <div class="hint" id="midHint">Member ID: —</div><div class="err" data-err="mobile"></div></div>
        <div class="field"><label>WhatsApp Number <span class="req">*</span></label>
          <input name="whatsapp" inputmode="numeric" maxlength="11" required placeholder="01712345678">
          <label class="check" style="margin-top:3px"><input type="checkbox" name="sameWa" checked> মোবাইল নম্বরের অনুরূপ</label>
          <div class="err" data-err="whatsapp"></div></div>
        <div class="field"><label>Email ID</label><input name="email" type="email"><div class="err" data-err="email"></div></div>
        <div class="field"><label>NID Number</label><input name="nid" inputmode="numeric"></div>
      </div>
    </fieldset>
    <fieldset><legend>পরিচিতি / Identity</legend>
      <div class="grid g2">
        <div class="field"><label>নাম (বাংলা) <span class="req">*</span></label><input name="nameBn" required><div class="err" data-err="nameBn"></div></div>
        <div class="field"><label>Name (English) <span class="req">*</span></label><input name="nameEn" required><div class="err" data-err="nameEn"></div></div>
        <div class="field"><label>পিতার নাম (বাংলা)</label><input name="fatherBn"></div>
        <div class="field"><label>Father's Name (English)</label><input name="fatherEn"></div>
        <div class="field"><label>মাতার নাম (বাংলা)</label><input name="motherBn"></div>
        <div class="field"><label>Mother's Name (English)</label><input name="motherEn"></div>
        <div class="field"><label>Date of Birth (DD-MM-YYYY)</label><input name="dob" type="date"></div>
        <div class="field"><label>Profession / পেশা</label><input name="profession"></div>
      </div>
      <div class="field" style="margin-top:8px"><label>Address / ঠিকানা</label><textarea name="address" rows="2"></textarea></div>
    </fieldset>
    <fieldset><legend>আর্থিক ও নিরাপত্তা / Financial &amp; Security</legend>
      <div class="grid g2">
        <div class="field"><label>Monthly Installment (৳) <span class="req">*</span></label><input name="installment" type="number" min="1" step="1" value="${cfg.defaultInstallment}" required><div class="err" data-err="installment"></div></div>
      </div>
      <div class="hint" style="margin-top:4px">সদস্য এই Mobile Number দিয়ে লগইন করবেন। ডিফল্ট পাসওয়ার্ড <b>${esc(DEFAULT_MEMBER_PASSWORD)}</b> — প্রথম লগইনে পাসওয়ার্ড পরিবর্তন বাধ্যতামূলক।</div>
    </fieldset>
    <div class="form-actions">
      <button class="btn btn-primary" type="submit">${icon('save')}<span>Save / সংরক্ষণ</span></button>
      <button class="btn btn-ghost" type="reset">${icon('clear')}<span>Clear</span></button>
    </div>`;
  wrap.appendChild(card('নতুন সদস্য তথ্য', 'New Member Details', form));

  const midHint = form.querySelector('#midHint');
  const syncWa = () => { if (form.elements.sameWa.checked) form.elements.whatsapp.value = form.elements.mobile.value; };
  form.elements.whatsapp.readOnly = true;
  form.elements.mobile.addEventListener('input', () => {
    form.elements.mobile.value = form.elements.mobile.value.replace(/\D/g, '').slice(0, 11);
    const mid = memberIdFromMobile(form.elements.mobile.value);
    midHint.innerHTML = mid ? `Member ID: <b style="color:var(--green-dark)">${mid}</b>` : 'Member ID: —';
    syncWa();
  });
  form.elements.sameWa.addEventListener('change', () => { form.elements.whatsapp.readOnly = form.elements.sameWa.checked; syncWa(); });
  form.elements.whatsapp.addEventListener('input', () => { form.elements.whatsapp.value = form.elements.whatsapp.value.replace(/\D/g, '').slice(0, 11); });
  form.addEventListener('reset', () => setTimeout(() => { midHint.textContent = 'Member ID: —'; form.elements.installment.value = cfg.defaultInstallment; }, 0));

  form.addEventListener('submit', async e => {
    e.preventDefault();
    form.querySelectorAll('.err').forEach(x => x.textContent = '');
    form.querySelectorAll('.field').forEach(x => x.classList.remove('bad'));
    const setErr = (n, m) => { const b = form.querySelector(`[data-err="${n}"]`); if (b) { b.textContent = m; b.closest('.field').classList.add('bad'); } };
    const v = Object.fromEntries(new FormData(form).entries());
    let bad = false;
    if (!isValidMobile(v.mobile)) { setErr('mobile', 'সঠিক ১১ সংখ্যার মোবাইল নম্বর দিন'); bad = true; }
    if (!isValidMobile(v.whatsapp)) { setErr('whatsapp', 'সঠিক WhatsApp নম্বর দিন'); bad = true; }
    if (!String(v.nameBn || '').trim()) { setErr('nameBn', 'নাম (বাংলা) আবশ্যক'); bad = true; }
    if (!String(v.nameEn || '').trim()) { setErr('nameEn', 'Name (English) is required'); bad = true; }
    if (v.email && !isValidEmail(v.email)) { setErr('email', 'সঠিক Email দিন'); bad = true; }
    if (!(num(v.installment) > 0)) { setErr('installment', 'মাসিক কিস্তি দিন'); bad = true; }
    if (bad) { toast('ফর্মে ত্রুটি রয়েছে / Please fix the highlighted fields', 'error'); return; }
    const b = form.querySelector('button[type=submit]'); b.disabled = true;
    try {
      const m = await registerMember({ ...v, password: '' }, { defaultPassword: true });
      await modal({
        title: 'REGISTRATION SUCCESSFUL', width: 400,
        body: `<div class="success-pop"><div class="tick">${icon('check')}</div></div>
          <div class="kv"><div>Member ID</div><div><b style="color:var(--green-dark)">${esc(m.memberId)}</b></div>
          <div>Name</div><div>${esc(m.nameBn)}</div><div>Mobile</div><div>${esc(m.mobile)}</div>
          <div>Status</div><div><span class="tag pending">PENDING APPROVAL</span></div></div>
          <div class="banner ok" style="margin-top:9px">${icon('info')}<span>Registration সফল হয়েছে। সদস্য <b>${esc(m.mobile)}</b> দিয়ে লগইন করবেন।</span></div>
          <div class="banner info">${icon('key')}<span>লগইন পাসওয়ার্ড (ডিফল্ট): <b>${esc(DEFAULT_MEMBER_PASSWORD)}</b> — প্রথম লগইনে পাসওয়ার্ড পরিবর্তন বাধ্যতামূলক।</span></div>`,
        actions: [{ label: 'OK', value: true, kind: 'primary' }],
      });
      form.reset(); midHint.textContent = 'Member ID: —'; form.elements.installment.value = cfg.defaultInstallment;
    } catch (err) {
      if (err.fieldErrors) err.fieldErrors.forEach(fe => setErr(fe.field === 'memberId' ? 'mobile' : fe.field, fe.msg));
      else toast(err.message, 'error');
    } finally { b.disabled = false; }
  });
  return wrap;
}

/* ============ Member Update ============ */
export async function pageMemberUpdate(session, params = {}) {
  const [members, deposits, cfg] = await Promise.all([allMembers(), allDeposits(), settings()]);
  const wrap = page('সদস্য হালনাগাদ', 'Member Update', 'edit');
  if (!members.length) { wrap.appendChild(banner('info', 'এখনো কোনো সদস্য নিবন্ধিত হয়নি / No members registered yet')); return wrap; }

  const sel = el('select', { name: 'pick' });
  sel.appendChild(el('option', { value: '' }, ['— সদস্য নির্বাচন করুন / Select member —']));
  members.slice().sort((a, b) => a.memberId.localeCompare(b.memberId)).forEach(m => {
    sel.appendChild(el('option', { value: m.id, ...(params.memberDocId === m.id ? { selected: true } : {}) }, [`${m.memberId} — ${m.nameBn}${m.status !== 'active' ? ' (' + m.status + ')' : ''}`]));
  });
  const picker = el('div', { class: 'field' });
  picker.appendChild(el('label', { html: 'সদস্য নির্বাচন / Select Member <span class="req">*</span>' }));
  picker.appendChild(sel);
  const host = el('div');
  wrap.appendChild(card('সদস্য নির্বাচন', 'Select Member', picker));
  wrap.appendChild(host);

  const load = async id => {
    host.replaceChildren();
    if (!id) return;
    const m = await getMember(id);
    if (!m) return;
    host.appendChild(memberEditor(session, m, deposits, cfg, () => App.refresh()));
  };
  sel.addEventListener('change', () => load(sel.value));
  if (params.memberDocId) await load(params.memberDocId);
  return wrap;
}

export function memberEditor(session, m, deposits, cfg, onSaved) {
  const s = memberSummary(m, deposits, { countSpecialTowardsInstallment: cfg.countSpecialTowardsInstallment });
  const box = el('div');

  const summary = el('div', { class: 'stats' });
  summary.innerHTML = `
    <div class="stat"><div class="lbl">${icon('money')} মোট জমা</div><div class="val">${taka(s.totalDeposit)}</div><div class="sub">${s.count} approved</div></div>
    <div class="stat red"><div class="lbl">${icon('due')} বকেয়া</div><div class="val">${taka(s.due)}</div><div class="sub">প্রয়োজন ${taka(s.required)}</div></div>
    <div class="stat"><div class="lbl">${icon('advance')} অগ্রিম</div><div class="val">${taka(s.advance)}</div><div class="sub">${s.months} মাস</div></div>
    <div class="stat gray"><div class="lbl">${icon('member')} স্ট্যাটাস</div><div class="val">${statusTag(m.status)}</div><div class="sub">ID ${esc(m.memberId)}</div></div>`;
  box.appendChild(summary);

  const canEdit = can(session, 'member:edit');
  const f = el('form', { class: 'grid', novalidate: true });
  const ro = canEdit ? '' : 'readonly';
  f.innerHTML = `
    <div class="grid g2">
      <div class="field"><label>Member ID (পরিবর্তনযোগ্য নয় / not editable)</label><input value="${esc(m.memberId)}" readonly></div>
      <div class="field"><label>Status</label><input value="${esc((m.status || '').toUpperCase())}" readonly></div>
      <div class="field"><label>Mobile Number <span class="req">*</span></label><input name="mobile" ${ro} maxlength="11" inputmode="numeric" value="${esc(m.mobile)}"><div class="hint">নম্বর পরিবর্তন করলেও Member ID অপরিবর্তিত থাকবে।</div><div class="err" data-err="mobile"></div></div>
      <div class="field"><label>WhatsApp Number <span class="req">*</span></label><input name="whatsapp" ${ro} maxlength="11" inputmode="numeric" value="${esc(m.whatsapp)}"><div class="err" data-err="whatsapp"></div></div>
      <div class="field"><label>নাম (বাংলা) <span class="req">*</span></label><input name="nameBn" ${ro} value="${esc(m.nameBn)}"><div class="err" data-err="nameBn"></div></div>
      <div class="field"><label>Name (English) <span class="req">*</span></label><input name="nameEn" ${ro} value="${esc(m.nameEn)}"><div class="err" data-err="nameEn"></div></div>
      <div class="field"><label>পিতার নাম (বাংলা)</label><input name="fatherBn" ${ro} value="${esc(m.fatherBn || '')}"></div>
      <div class="field"><label>Father's Name (English)</label><input name="fatherEn" ${ro} value="${esc(m.fatherEn || '')}"></div>
      <div class="field"><label>মাতার নাম (বাংলা)</label><input name="motherBn" ${ro} value="${esc(m.motherBn || '')}"></div>
      <div class="field"><label>Mother's Name (English)</label><input name="motherEn" ${ro} value="${esc(m.motherEn || '')}"></div>
      <div class="field"><label>Email ID</label><input name="email" type="email" ${ro} value="${esc(m.email || '')}"><div class="err" data-err="email"></div></div>
      <div class="field"><label>NID Number</label><input name="nid" ${ro} value="${esc(m.nid || '')}"></div>
      <div class="field"><label>Date of Birth</label><input name="dob" type="date" ${ro} value="${esc((m.dob || '').slice(0, 10))}"><div class="hint">প্রদর্শন: ${esc(fmtDate(m.dob) || '—')}</div></div>
      <div class="field"><label>Profession / পেশা</label><input name="profession" ${ro} value="${esc(m.profession || '')}"></div>
      <div class="field"><label>Monthly Installment (৳) <span class="req">*</span></label><input name="installment" type="number" min="1" ${ro} value="${esc(m.installment)}"><div class="err" data-err="installment"></div></div>
      <div class="field"><label>Join Date</label><input value="${esc(fmtDate(m.joinDate))}" readonly></div>
    </div>
    <div class="field"><label>Address / ঠিকানা</label><textarea name="address" rows="2" ${ro}>${esc(m.address || '')}</textarea></div>`;

  if (canEdit) {
    const acts = el('div', { class: 'form-actions' });
    acts.appendChild(el('button', { class: 'btn btn-primary', type: 'submit', html: `${icon('save')}<span>Update / হালনাগাদ</span>` }));
    acts.appendChild(btn('Clear', 'clear', 'ghost', () => f.reset()));
    if (m.status === 'pending') {
      acts.appendChild(btn('Approve / অনুমোদন', 'approve', 'soft', async () => {
        if (!(await confirmBox(`${m.nameBn} (${m.memberId}) — সদস্যপদ অনুমোদন করবেন?`, { okLabel: 'Approve' }))) return;
        await setMemberStatus(m.id, 'active', session);
        toast('সদস্য অনুমোদিত / Member approved', 'success'); onSaved && onSaved();
      }));
      acts.appendChild(btn('Reject / বাতিল', 'reject', 'softred', async () => {
        const r = await rejectReason();
        if (r === null) return;
        await setMemberStatus(m.id, 'rejected', session, r);
        toast('সদস্য বাতিল / Member rejected', 'warn'); onSaved && onSaved();
      }));
    }
    if (m.status === 'rejected' && session.role === 'admin') {
      acts.appendChild(btn('পুনর্বহাল / Re-activate', 'approve', 'soft', async () => {
        if (!(await confirmBox('সদস্যকে পুনরায় সক্রিয় করবেন? / Re-activate this member?', { okLabel: 'Activate' }))) return;
        await setMemberStatus(m.id, 'active', session); toast('Activated', 'success'); onSaved && onSaved();
      }));
    }
    if (m.status === 'active' && session.role === 'admin') {
      acts.appendChild(btn('নিষ্ক্রিয় / Deactivate', 'reject', 'softred', async () => {
        if (!(await confirmBox('সদস্যকে নিষ্ক্রিয় করবেন? / Deactivate this member?', { okLabel: 'Deactivate', danger: true }))) return;
        await setMemberStatus(m.id, 'inactive', session); toast('Deactivated', 'warn'); onSaved && onSaved();
      }));
    }
    if (m.status === 'inactive') {
      acts.appendChild(btn('সক্রিয় / Activate', 'approve', 'soft', async () => {
        await setMemberStatus(m.id, 'active', session); toast('Activated', 'success'); onSaved && onSaved();
      }));
    }
    if (s.due > 0 && can(session, 'whatsapp')) {
      acts.appendChild(btn('WhatsApp Reminder', 'whatsapp', 'wa', () => {
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
    if (!String(v.nameEn || '').trim()) { setErr('nameEn', 'Name (English) is required'); bad = true; }
    if (v.email && !isValidEmail(v.email)) { setErr('email', 'সঠিক Email দিন'); bad = true; }
    if (!(num(v.installment) > 0)) { setErr('installment', 'মাসিক কিস্তি দিন'); bad = true; }
    if (bad) { toast('ফর্মে ত্রুটি রয়েছে', 'error'); return; }
    try {
      await updateMember(m.id, v, session);
      toast('সদস্য তথ্য হালনাগাদ হয়েছে / Member updated', 'success');
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
        { label: 'Cancel', value: null, kind: 'ghost' },
        { label: 'Reject', value: 'ok', kind: 'danger' },
      ],
    }).then(v => resolve(v === 'ok' ? ta.value.trim() : null));
  });
}

/* ============ Member Search ============ */
export async function pageSearch(session) {
  const [members, deposits, cfg] = await Promise.all([allMembers(), allDeposits(), settings()]);
  const wrap = page('সদস্য অনুসন্ধান', 'Member Search', 'search');

  const bar = el('div', { class: 'toolbar' });
  const searchBox = el('div', { class: 'search-box', html: icon('search') });
  const inp = el('input', { placeholder: 'Member ID / নাম / Name / Mobile / WhatsApp', autocomplete: 'off' });
  searchBox.appendChild(inp);
  const statusSel = el('select', {}, []);
  [['', 'সব স্ট্যাটাস / All'], ['active', 'Active'], ['pending', 'Pending'], ['rejected', 'Rejected'], ['inactive', 'Inactive']]
    .forEach(([v, l]) => statusSel.appendChild(el('option', { value: v }, [l])));
  const statusField = el('div', { class: 'field', style: 'flex:0 1 130px' });
  statusField.appendChild(el('label', { text: 'স্ট্যাটাস / Status' }));
  statusField.appendChild(statusSel);
  const dueSel = el('select');
  [['', 'সব / All'], ['due', 'শুধু বকেয়া / Due only'], ['advance', 'শুধু অগ্রিম / Advance only']]
    .forEach(([v, l]) => dueSel.appendChild(el('option', { value: v }, [l])));
  const dueField = el('div', { class: 'field', style: 'flex:0 1 130px' });
  dueField.appendChild(el('label', { text: 'ফিল্টার / Filter' }));
  dueField.appendChild(dueSel);
  bar.append(searchBox, statusField, dueField);
  wrap.appendChild(bar);

  const resultCard = card('ফলাফল', 'Results', el('div'));
  wrap.appendChild(resultCard);
  const countTag = el('span', { class: 'tag info' });
  resultCard.querySelector('.card-head').appendChild(countTag);

  const render = () => {
    const q = inp.value.trim().toLowerCase();
    const st = statusSel.value, fl = dueSel.value;
    let list = members.filter(m => {
      if (st && m.status !== st) return false;
      if (!q) return true;
      return [m.memberId, m.nameBn, m.nameEn, m.mobile, m.whatsapp, m.email, m.nid]
        .some(x => String(x || '').toLowerCase().includes(q));
    });
    const rows = list.map(m => {
      const s = memberSummary(m, deposits, { countSpecialTowardsInstallment: cfg.countSpecialTowardsInstallment });
      return { m, s };
    }).filter(r => fl === 'due' ? r.s.due > 0 : fl === 'advance' ? r.s.advance > 0 : true);
    countTag.textContent = `${rows.length} member(s)`;

    const body = resultCard.body;
    body.replaceChildren();
    body.appendChild(tableWrap(
      [{ label: 'ID' }, { label: 'নাম / Name' }, { label: 'Mobile' }, { label: 'কিস্তি', cls: 'num' },
       { label: 'জমা', cls: 'num' }, { label: 'বকেয়া', cls: 'num' }, { label: 'অগ্রিম', cls: 'num' },
       { label: 'Status' }, { label: 'Action', cls: 'nowrap' }],
      rows.map(({ m, s }) => {
        const acts = el('div', { class: 'btn-row' });
        acts.appendChild(btn('View', 'eye', 'ghost', () => viewMember(session, m, s), { size: 'xs' }));
        if (can(session, 'member:edit')) acts.appendChild(btn('Edit', 'edit', 'ghost', () => App.go('members', { tab: 'update', memberDocId: m.id }), { size: 'xs' }));
        if (s.due > 0 && can(session, 'whatsapp')) {
          acts.appendChild(btn('WA', 'whatsapp', 'wa', () => window.open(`https://wa.me/${waNumber(m.whatsapp || m.mobile)}?text=${encodeURIComponent(dueMessage(m.nameBn || m.nameEn))}`, '_blank'), { size: 'xs' }));
        }
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
      { empty: 'কোনো সদস্য পাওয়া যায়নি / No members found', emptyIcon: 'search' },
    ));
  };
  inp.addEventListener('input', debounce(render, 180));
  statusSel.addEventListener('change', render);
  dueSel.addEventListener('change', render);
  render();
  return wrap;
}

export function viewMember(session, m, s) {
  const body = el('div');
  body.appendChild(kv([
    ['Member ID', `<b>${esc(m.memberId)}</b>`],
    ['নাম (বাংলা)', esc(m.nameBn)],
    ['Name (English)', esc(m.nameEn)],
    ['পিতার নাম', esc(m.fatherBn || m.fatherEn || '')],
    ['মাতার নাম', esc(m.motherBn || m.motherEn || '')],
    ['Mobile', esc(m.mobile)],
    ['WhatsApp', esc(m.whatsapp)],
    ['Email', esc(m.email || '')],
    ['NID', esc(m.nid || '')],
    ['Date of Birth', esc(fmtDate(m.dob))],
    ['Profession', esc(m.profession || '')],
    ['Address', esc(m.address || '')],
    ['Monthly Installment', taka(m.installment)],
    ['Join Date', esc(fmtDate(m.joinDate))],
    ['Status', statusTag(m.status)],
    ['মোট জমা / Total Deposit', `<b>${taka(s.totalDeposit)}</b>`],
    ['মোট বকেয়া / Total Due', s.due > 0 ? `<span class="due-amt">${taka(s.due)}</span>` : taka(0)],
    ['মোট অগ্রিম / Total Advance', s.advance > 0 ? `<span class="adv-amt">${taka(s.advance)}</span>` : taka(0)],
  ]));
  return modal({ title: `সদস্য তথ্য / Member — ${m.memberId}`, body, width: 460, actions: [{ label: 'Close', value: true, kind: 'ghost' }] });
}
