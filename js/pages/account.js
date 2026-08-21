/* First-time admin setup wizard + forced password change + self-service password change */
import { el, esc, toast, modal, isValidMobile, isValidEmail } from '../util.js';
import { icon } from '../icons.js';
import { completeAdminSetup, changeOwnPassword } from '../auth.js';
import { passwordIssues } from '../crypto.js';

/** Generic blocking form-modal: resolves with the value returned by onSubmit, or null on cancel. */
function formModal({ title, html, width = 480, okLabel = 'Save', cancelLabel = 'Cancel', onSubmit, dismissible = false }) {
  return new Promise(resolve => {
    const body = el('div');
    body.innerHTML = `<form class="grid js-form" novalidate>${html}<div class="err js-err"></div></form>`;
    const form = body.querySelector('form');
    const errBox = body.querySelector('.js-err');
    const fail = m => { errBox.innerHTML = `<span style="color:var(--red-dark);font-weight:700;font-size:8.5px">${esc(m)}</span>`; };

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
    title: 'Admin Setup / অ্যাডমিন সেটআপ',
    width: 520, okLabel: 'Save & Continue', cancelLabel: 'Logout',
    html: `
      <div class="banner warn">${icon('warn')}<span><b>প্রথমবার লগইন / First-time setup.</b> Admin তথ্য পূরণ করুন এবং ডিফল্ট Password পরিবর্তন করুন। এরপর “admin” Password আর কাজ করবে না।</span></div>
      <div class="grid g2">
        <div class="field"><label>Admin Name / নাম <span class="req">*</span></label><input name="displayName" required value="${esc(session.displayName || '')}"></div>
        <div class="field"><label>Username <span class="req">*</span></label><input name="username" required value="${esc(session.username || 'admin')}"></div>
        <div class="field"><label>Mobile Number <span class="req">*</span></label><input name="mobile" inputmode="numeric" maxlength="11" required placeholder="01XXXXXXXXX"></div>
        <div class="field"><label>Email</label><input name="email" type="email" placeholder="admin@mail.com"></div>
      </div>
      <div class="field"><label>Address / ঠিকানা</label><input name="address"></div>
      <div class="grid g2">
        <div class="field"><label>New Password <span class="req">*</span></label><input name="pw1" type="password" required minlength="6" autocomplete="new-password"></div>
        <div class="field"><label>Confirm Password <span class="req">*</span></label><input name="pw2" type="password" required minlength="6" autocomplete="new-password"></div>
      </div>`,
    onSubmit: async (v, fail) => {
      if (!String(v.displayName || '').trim()) return fail('Admin Name আবশ্যক / Name is required');
      if (!String(v.username || '').trim()) return fail('Username আবশ্যক / Username is required');
      if (!isValidMobile(v.mobile)) return fail('সঠিক মোবাইল নম্বর দিন / Enter a valid mobile number');
      if (v.email && !isValidEmail(v.email)) return fail('সঠিক Email দিন / Enter a valid email');
      const iss = passwordIssues(v.pw1);
      if (iss.length) return fail(iss[0]);
      if (v.pw1 !== v.pw2) return fail('Password মেলেনি / Passwords do not match');
      const s = await completeAdminSetup({ ...v, newPassword: v.pw1 });
      toast('Admin সেটআপ সম্পন্ন / Admin setup complete', 'success');
      return s;
    },
  });
}

export function forcePasswordChange() {
  return formModal({
    title: 'Password পরিবর্তন / Change Password',
    width: 400, okLabel: 'Change Password', cancelLabel: 'Logout',
    html: `
      <div class="banner warn">${icon('lock')}<span>নিরাপত্তার জন্য প্রথম লগইনে Password পরিবর্তন করা আবশ্যক। / You must change your password before continuing.</span></div>
      <div class="field"><label>Current Password <span class="req">*</span></label><input name="cur" type="password" required autocomplete="current-password"></div>
      <div class="field"><label>New Password <span class="req">*</span></label><input name="pw1" type="password" required minlength="6" autocomplete="new-password"></div>
      <div class="field"><label>Confirm New Password <span class="req">*</span></label><input name="pw2" type="password" required minlength="6" autocomplete="new-password"></div>`,
    onSubmit: async (v, fail) => {
      if (v.pw1 !== v.pw2) return fail('Password মেলেনি / Passwords do not match');
      const s = await changeOwnPassword(v.cur, v.pw1);
      toast('Password পরিবর্তন সফল / Password changed', 'success');
      return s;
    },
  });
}

/** Self-service password change available to every role from Settings. */
export function changePasswordDialog() {
  return formModal({
    title: 'Password পরিবর্তন / Change Password',
    width: 400, okLabel: 'Update Password', dismissible: true,
    html: `
      <div class="field"><label>Current Password <span class="req">*</span></label><input name="cur" type="password" required autocomplete="current-password"></div>
      <div class="field"><label>New Password <span class="req">*</span></label><input name="pw1" type="password" required minlength="6" autocomplete="new-password"></div>
      <div class="field"><label>Confirm New Password <span class="req">*</span></label><input name="pw2" type="password" required minlength="6" autocomplete="new-password"></div>
      <div class="hint">Password কমপক্ষে ৬ অক্ষরের হতে হবে। / Minimum 6 characters.</div>`,
    onSubmit: async (v, fail) => {
      if (v.pw1 !== v.pw2) return fail('Password মেলেনি / Passwords do not match');
      const s = await changeOwnPassword(v.cur, v.pw1);
      toast('Password পরিবর্তন সফল / Password updated', 'success');
      return s;
    },
  });
}
