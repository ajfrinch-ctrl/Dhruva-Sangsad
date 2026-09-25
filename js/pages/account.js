/* First-time admin setup wizard + forced password change + self-service password change */
import { el, esc, toast, modal, isValidMobile, isValidEmail, t, auto } from '../util.js';
import { icon } from '../icons.js';
import { completeAdminSetup, changeOwnPassword } from '../auth.js';
import { passwordIssues } from '../crypto.js';

/** Generic blocking form-modal: resolves with the value returned by onSubmit, or null on cancel. */
function formModal({ title, html, width = 480, okLabel = '', cancelLabel = '', onSubmit, dismissible = false }) {
  okLabel = okLabel || t('সংরক্ষণ করুন', 'Save');
  cancelLabel = cancelLabel || t('বাতিল', 'Cancel');
  return new Promise(resolve => {
    const body = el('div');
    body.innerHTML = `<form class="grid js-form" novalidate>${html}<div class="err js-err"></div></form>`;
    const form = body.querySelector('form');
    const errBox = body.querySelector('.js-err');
    /* Messages may be legacy "বাংলা / English" strings — auto() picks the
       active language so an error can never mix scripts. */
    const fail = m => { errBox.innerHTML = `<span style="color:var(--red-dark);font-weight:700;font-size:8.5px">${esc(auto(m))}</span>`; };

    let done = false;
    const submit = async () => {
      errBox.textContent = '';
      const values = Object.fromEntries(new FormData(form).entries());
      const okBtn = back.querySelector('.js-ok');
      okBtn.disabled = true;
      try {
        const out = await onSubmit(values, fail);
        if (out === undefined || out === null || out === false) { okBtn.disabled = false; return; }
        done = true; back.remove(); resolve(out);
      } catch (err) { fail(err.message); okBtn.disabled = false; }
    };
    form.addEventListener('submit', e => { e.preventDefault(); submit(); });

    const back = el('div', { class: 'modal-back' });
    const box = el('div', { class: 'modal', style: `max-width:${width}px` });
    const head = el('div', { class: 'modal-head', html: `<h3>${esc(title)}</h3>` });
    const bd = el('div', { class: 'modal-body' });
    bd.appendChild(body);
    const ft = el('div', { class: 'modal-foot' });
    ft.appendChild(el('button', { type: 'button', class: 'btn btn-ghost', text: cancelLabel, onclick: () => { if (!done) { back.remove(); resolve(null); } } }));
    ft.appendChild(el('button', { type: 'button', class: 'btn btn-primary js-ok', html: `${icon('save')}<span>${esc(okLabel)}</span>`, onclick: submit }));
    box.append(head, bd, ft); back.appendChild(box); document.body.appendChild(back);
    if (dismissible) back.addEventListener('click', e => { if (e.target === back && !done) { back.remove(); resolve(null); } });
    const first = form.querySelector('input,select,textarea');
    if (first) setTimeout(() => first.focus(), 60);
  });
}
export { formModal };

export function adminSetupWizard(session) {
  return formModal({
    title: t('অ্যাডমিন সেটআপ', 'Admin Setup'),
    width: 520, okLabel: t('সংরক্ষণ করে এগিয়ে যান', 'Save & Continue'), cancelLabel: t('লগআউট', 'Logout'),
    html: `
      <div class="banner warn">${icon('warn')}<span>${t('<b>প্রথমবার লগইন।</b> নিজের তথ্য পূরণ করুন এবং ডিফল্ট পাসওয়ার্ড পরিবর্তন করুন — এরপর “admin” পাসওয়ার্ড আর কাজ করবে না।',
        '<b>First-time setup.</b> Fill in your details and change the default password — the “admin” password stops working afterwards.')}</span></div>
      <div class="grid g2">
        <div class="field"><label>${t('অ্যাডমিনের নাম', 'Admin name')} <span class="req">*</span></label><input name="displayName" required value="${esc(session.displayName || '')}"></div>
        <div class="field"><label>${t('ইউজারনেম', 'Username')} <span class="req">*</span></label><input name="username" required value="${esc(session.username || 'admin')}"></div>
        <div class="field"><label>${t('মোবাইল নম্বর', 'Mobile number')} <span class="req">*</span></label><input name="mobile" inputmode="numeric" maxlength="11" required placeholder="01XXXXXXXXX"></div>
        <div class="field"><label>${t('ইমেইল', 'Email')}</label><input name="email" type="email" placeholder="admin@mail.com"></div>
      </div>
      <div class="field"><label>${t('ঠিকানা', 'Address')}</label><input name="address"></div>
      <div class="grid g2">
        <div class="field"><label>${t('নতুন পাসওয়ার্ড', 'New password')} <span class="req">*</span></label><input name="pw1" type="password" required minlength="6" autocomplete="new-password"></div>
        <div class="field"><label>${t('পাসওয়ার্ড (আবার)', 'Confirm password')} <span class="req">*</span></label><input name="pw2" type="password" required minlength="6" autocomplete="new-password"></div>
      </div>`,
    onSubmit: async (v, fail) => {
      if (!String(v.displayName || '').trim()) return fail(t('অ্যাডমিনের নাম আবশ্যক', 'Admin name is required'));
      if (!String(v.username || '').trim()) return fail(t('ইউজারনেম আবশ্যক', 'Username is required'));
      if (!isValidMobile(v.mobile)) return fail(t('সঠিক মোবাইল নম্বর দিন', 'Enter a valid mobile number'));
      if (v.email && !isValidEmail(v.email)) return fail(t('সঠিক ইমেইল দিন', 'Enter a valid email'));
      const iss = passwordIssues(v.pw1);
      if (iss.length) return fail(iss[0]);
      if (v.pw1 !== v.pw2) return fail(t('পাসওয়ার্ড মেলেনি', 'Passwords do not match'));
      const s = await completeAdminSetup({ ...v, newPassword: v.pw1 });
      toast('Admin সেটআপ সম্পন্ন / Admin setup complete', 'success');
      return s;
    },
  });
}

export function forcePasswordChange() {
  return formModal({
    title: t('পাসওয়ার্ড পরিবর্তন', 'Change password'),
    width: 400, okLabel: t('পাসওয়ার্ড পরিবর্তন', 'Change password'), cancelLabel: t('লগআউট', 'Logout'),
    html: `
      <div class="banner warn">${icon('lock')}<span>${t('নিরাপত্তার জন্য প্রথম লগইনে পাসওয়ার্ড পরিবর্তন করা আবশ্যক।', 'You must change the password before continuing.')}</span></div>
      <div class="field"><label>${t('বর্তমান পাসওয়ার্ড', 'Current password')} <span class="req">*</span></label><input name="cur" type="password" required autocomplete="current-password"></div>
      <div class="field"><label>${t('নতুন পাসওয়ার্ড', 'New password')} <span class="req">*</span></label><input name="pw1" type="password" required minlength="6" autocomplete="new-password"></div>
      <div class="field"><label>${t('নতুন পাসওয়ার্ড (আবার)', 'Confirm new password')} <span class="req">*</span></label><input name="pw2" type="password" required minlength="6" autocomplete="new-password"></div>`,
    onSubmit: async (v, fail) => {
      if (v.pw1 !== v.pw2) return fail(t('পাসওয়ার্ড মেলেনি', 'Passwords do not match'));
      const s = await changeOwnPassword(v.cur, v.pw1);
      toast(t('পাসওয়ার্ড পরিবর্তন সফল', 'Password changed'), 'success');
      return s;
    },
  });
}

/** Self-service password change available to every role from Settings. */
export function changePasswordDialog() {
  return formModal({
    title: t('পাসওয়ার্ড পরিবর্তন', 'Change password'),
    width: 400, okLabel: t('পাসওয়ার্ড হালনাগাদ', 'Update password'), dismissible: true,
    html: `
      <div class="field"><label>${t('বর্তমান পাসওয়ার্ড', 'Current password')} <span class="req">*</span></label><input name="cur" type="password" required autocomplete="current-password"></div>
      <div class="field"><label>${t('নতুন পাসওয়ার্ড', 'New password')} <span class="req">*</span></label><input name="pw1" type="password" required minlength="6" autocomplete="new-password"></div>
      <div class="field"><label>${t('নতুন পাসওয়ার্ড (আবার)', 'Confirm new password')} <span class="req">*</span></label><input name="pw2" type="password" required minlength="6" autocomplete="new-password"></div>
      <div class="hint">${t('পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।', 'Minimum 6 characters.')}</div>`,
    onSubmit: async (v, fail) => {
      if (v.pw1 !== v.pw2) return fail(t('পাসওয়ার্ড মেলেনি', 'Passwords do not match'));
      const s = await changeOwnPassword(v.cur, v.pw1);
      toast(t('পাসওয়ার্ড পরিবর্তন সফল', 'Password updated'), 'success');
      return s;
    },
  });
}
