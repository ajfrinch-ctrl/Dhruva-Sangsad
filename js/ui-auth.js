/* Guest screens: Login (default), Register, Forgot Password, Registration success.
   Nothing else is rendered while unauthenticated. */
import { el, clear, $, toast, alertBox, esc, num, memberIdFromMobile, isValidMobile, isValidEmail, normalizeMobile, fmtDate, toISO, t } from './util.js';
import { logoSrc, APP_VERSION } from './brand.js';
import { getLang, setLang } from './i18n.js';
import { icon } from './icons.js';
import { login, recoverPassword, findMemberForRecovery, verifyRecoveryDob } from './auth.js';
import { registerMember, settings } from './store.js';
import { passwordIssues } from './crypto.js';
import { getTheme, toggleTheme } from './theme.js';

let mode = 'login';

export function renderAuth(root, onLoggedIn) {
  clear(root);
  root.classList.remove('hidden');
  const card = el('div', { class: 'auth-card' });
  card.innerHTML = `
    <div class="auth-brand">
      <div class="auth-logo"><img class="js-org-logo" src="${esc(logoSrc())}" alt="ধ্রুব সংসদ"></div>
      <h1>ধ্রুব সংসদ</h1>
      <div class="sub">Dhruvo Sangsad</div>
    </div>
    <div class="auth-tabs" id="authTabs">
      <button type="button" data-m="login" class="${mode === 'login' ? 'on' : ''}">${t('লগইন', 'Login')}</button>
      <button type="button" data-m="register" class="${mode === 'register' ? 'on' : ''}">${t('নিবন্ধন', 'Register')}</button>
    </div>
    <div id="authBody"></div>
    <div class="auth-lang">
      <button type="button" data-lang="bn" class="${getLang() === 'bn' ? 'on' : ''}">বাংলা</button>
      <button type="button" data-lang="en" class="${getLang() === 'en' ? 'on' : ''}">English</button>
    </div>
    <div class="auth-foot">
      ${t('ধ্রুব সংসদ · সদস্য ও জমা ব্যবস্থাপনা', 'Dhruvo Sangsad · Member & Deposit Management')} · v${APP_VERSION}
    </div>`;
  const themeBtn = el('button', { class: 'icon-btn auth-theme-btn', type: 'button' });
  const paint = () => {
    const dark = getTheme() === 'amoled';
    themeBtn.innerHTML = icon(dark ? 'sun' : 'moon');
    themeBtn.title = dark ? 'লাইট মোড / Light' : 'হার্ড ডার্ক / Hard dark';
  };
  paint();
  themeBtn.addEventListener('click', () => { toggleTheme(); paint(); });
  root.appendChild(themeBtn);
  root.appendChild(card);
  settings().then(cfg => {
    const src = logoSrc(cfg);
    root.querySelectorAll('.js-org-logo').forEach(img => { img.src = src; });
    if (window.App && App.applyBrand) App.applyBrand(cfg);
  }).catch(() => {});
  card.querySelectorAll('#authTabs button').forEach(b => b.addEventListener('click', () => {
    mode = b.dataset.m; renderAuth(root, onLoggedIn);
  }));
  card.querySelectorAll('.auth-lang button').forEach(b => b.addEventListener('click', () => setLang(b.dataset.lang)));
  const body = card.querySelector('#authBody');
  if (mode === 'login') loginForm(body, root, onLoggedIn);
  else if (mode === 'register') registerForm(body, root, onLoggedIn);
  else if (mode === 'forgot') forgotForm(body, root, onLoggedIn);
}

/* Password show/hide: wraps an <input type=password> with a 44px eye toggle. */
function pwToggle(input) {
  const wrap = el('span', { class: 'pw-wrap' });
  input.after(wrap);
  wrap.appendChild(input);
  const b = el('button', { type: 'button', class: 'pw-eye', 'aria-pressed': 'false' });
  const paint = () => {
    const show = input.type === 'text';
    b.innerHTML = icon(show ? 'eyeOff' : 'eye');
    b.setAttribute('aria-pressed', show ? 'true' : 'false');
    b.setAttribute('aria-label', t(show ? 'পাসওয়ার্ড লুকান' : 'পাসওয়ার্ড দেখান', show ? 'Hide password' : 'Show password'));
  };
  b.addEventListener('click', () => { input.type = input.type === 'password' ? 'text' : 'password'; input.focus(); paint(); });
  paint();
  wrap.appendChild(b);
  return wrap;
}

/* ---------------- LOGIN ---------------- */
function loginForm(body, root, onLoggedIn) {
  clear(body);
  const f = el('form', { class: 'grid', novalidate: true });
  f.innerHTML = `
    <div class="field">
      <label>${t('ইউজারনেম বা মোবাইল', 'Username or mobile')} <span class="req">*</span></label>
      <input name="identifier" inputmode="text" autocomplete="username" placeholder="${t('ইউজারনেম বা 01XXXXXXXXX', 'Username or 01XXXXXXXXX')}" required>
    </div>
    <div class="field">
      <label>${t('পাসওয়ার্ড', 'Password')} <span class="req">*</span></label>
      <input name="password" type="password" autocomplete="current-password" placeholder="••••••" required>
    </div>
    <label class="check"><input type="checkbox" name="remember"> ${t('এই ডিভাইসে মনে রাখুন', 'Remember me')}</label>
    <button class="btn btn-primary btn-lg btn-block" type="submit">${icon('login')} ${t('লগইন', 'Login')}</button>
    <div class="center"><button class="link-btn" type="button" id="toForgot">${t('পাসওয়ার্ড ভুলে গেছেন?', 'Forgot Password?')}</button></div>
    <div class="err center" id="loginErr" style="min-height:12px"></div>`;
  body.appendChild(f);
  pwToggle(f.elements.password);
  /* Digits-only input gets the telephone keypad; usernames keep the text one. */
  f.elements.identifier.addEventListener('input', () => {
    f.elements.identifier.inputMode = /^[0-9+]*$/.test(f.elements.identifier.value) ? 'tel' : 'text';
  });
  f.querySelector('#toForgot').addEventListener('click', () => { mode = 'forgot'; renderAuth(root, onLoggedIn); });

  f.addEventListener('submit', async e => {
    e.preventDefault();
    const errBox = f.querySelector('#loginErr');
    errBox.textContent = '';
    const btn = f.querySelector('button[type=submit]');
    const id = f.elements.identifier.value.trim();
    const pw = f.elements.password.value;
    if (!id || !pw) { errBox.innerHTML = `<span class="form-err">${esc(t('ইউজারনেম বা পাসওয়ার্ড দিন', 'Enter username and password'))}</span>`; return; }
    btn.disabled = true; btn.textContent = t('লগইন হচ্ছে…', 'Signing in…');
    try {
      const s = await login(id, pw, { remember: f.elements.remember.checked });
      toast(`স্বাগতম, ${s.displayName}`, 'success');
      onLoggedIn(s);
    } catch (err) {
      errBox.innerHTML = `<span class="form-err">${esc(err.message)}</span>`;
      btn.disabled = false; btn.innerHTML = `${icon('login')} ${t('লগইন', 'Login')}`;
    }
  });
}

/* ---------------- FORGOT PASSWORD: mobile → profile → day+month → reset ---------------- */
function forgotForm(body, root, onLoggedIn) {
  clear(body);
  const holder = el('div');
  body.appendChild(holder);
  let found = null;

  const errHtml = msg => `<span class="form-err">${esc(msg)}</span>`;
  const months = [
    [1, 'জানুয়ারি / January'], [2, 'ফেব্রুয়ারি / February'], [3, 'মার্চ / March'],
    [4, 'এপ্রিল / April'], [5, 'মে / May'], [6, 'জুন / June'],
    [7, 'জুলাই / July'], [8, 'আগস্ট / August'], [9, 'সেপ্টেম্বর / September'],
    [10, 'অক্টোবর / October'], [11, 'নভেম্বর / November'], [12, 'ডিসেম্বর / December'],
  ];

  function step1() {
    found = null;
    holder.replaceChildren();
    const f = el('form', { class: 'grid', novalidate: true });
    f.innerHTML = `
      <div class="auth-title">${t('পাসওয়ার্ড ভুলে গেছেন', 'Forgot Password')}</div>
      <div class="banner info">${icon('info')}<span>${t('মোবাইল নম্বর দিন। সদস্য পাওয়া গেলে তথ্য দেখাবে।', 'Enter your mobile number. If found, your profile will be shown.')}</span></div>
      <div class="field"><label>${t('মোবাইল নম্বর', 'Mobile Number')} <span class="req">*</span></label>
        <input name="mobile" inputmode="numeric" maxlength="11" required placeholder="01XXXXXXXXX"></div>
      <button class="btn btn-primary btn-lg btn-block" type="submit">${icon('search')} ${t('সদস্য খুঁজুন', 'Search member')}</button>
      <div class="center"><button class="link-btn" type="button" data-back="1">← ${t('লগইনে ফিরুন', 'Back to Login')}</button></div>
      <div class="err center js-err" style="min-height:12px"></div>`;
    holder.appendChild(f);
    f.querySelector('[data-back]').addEventListener('click', () => { mode = 'login'; renderAuth(root, onLoggedIn); });
    f.elements.mobile.addEventListener('input', () => { f.elements.mobile.value = f.elements.mobile.value.replace(/\D/g, '').slice(0, 11); });
    f.addEventListener('submit', async e => {
      e.preventDefault();
      const errBox = f.querySelector('.js-err'); errBox.textContent = '';
      const mob = f.elements.mobile.value.trim();
      if (!isValidMobile(mob)) { errBox.innerHTML = errHtml(t('সঠিক ১১ সংখ্যার মোবাইল নম্বর দিন', 'Enter a valid 11-digit mobile number')); return; }
      const btn = f.querySelector('button[type=submit]');
      const btnHtml = btn.innerHTML;
      btn.disabled = true; btn.textContent = t('খুঁজছি…', 'Searching…');
      try {
        found = await findMemberForRecovery(mob);
        if (!found) { errBox.innerHTML = errHtml(t('এই মোবাইলে কোনো সদস্য পাওয়া যায়নি', 'No member found for this mobile number')); btn.disabled = false; btn.innerHTML = btnHtml; return; }
        step2();
      } catch (err) {
        errBox.innerHTML = errHtml(err.message);
        btn.disabled = false; btn.innerHTML = btnHtml;
      }
    });
  }

  function step2() {
    holder.replaceChildren();
    const box = el('div', { class: 'grid' });
    box.innerHTML = `
      <div class="auth-title">${t('সদস্য পাওয়া গেছে', 'Member found')}</div>
      <div class="kv">
        <div>${t('সদস্য ID', 'Member ID')}</div><div><b>${esc(found.memberId)}</b></div>
        <div>${t('নাম', 'Name')}</div><div>${esc(found.nameBn || found.nameEn)}</div>
        <div>${t('মোবাইল', 'Mobile')}</div><div>${esc(found.mobile)}</div>
        <div>${t('স্ট্যাটাস', 'Status')}</div><div>${esc(t({ active: 'সক্রিয়', pending: 'অপেক্ষমাণ', rejected: 'বাতিল' }[found.status] || found.status || '—', found.status || '—'))}</div>
      </div>
      <div class="banner info">${icon('info')}<span>${t('এখন জন্ম তারিখ (দিন) ও মাস দিয়ে যাচাই করুন।', 'Now verify with your date of birth (day) and month.')}</span></div>`;
    const f = el('form', { class: 'grid', novalidate: true });
    f.innerHTML = `
      <div class="grid g2">
        <div class="field"><label>${t('জন্ম তারিখ (দিন)', 'Birth day')} <span class="req">*</span></label>
          <input name="dobDay" inputmode="numeric" maxlength="2" required placeholder="01–31"></div>
        <div class="field"><label>${t('জন্ম মাস', 'Birth month')} <span class="req">*</span></label>
          <select name="dobMonth" required>
            <option value="">— ${t('মাস', 'Month')} —</option>
            ${months.map(([n, l]) => `<option value="${n}">${l}</option>`).join('')}
          </select></div>
      </div>
      <button class="btn btn-primary btn-lg btn-block" type="submit">${icon('check')} ${t('যাচাই করুন', 'Verify')}</button>
      <div class="center"><button class="link-btn" type="button" data-back="2">← ${t('ফিরুন', 'Back')}</button></div>
      <div class="err center js-err" style="min-height:12px"></div>`;
    box.appendChild(f);
    holder.appendChild(box);
    f.querySelector('[data-back]').addEventListener('click', step1);
    f.addEventListener('submit', async e => {
      e.preventDefault();
      const errBox = f.querySelector('.js-err'); errBox.textContent = '';
      const day = Number(f.elements.dobDay.value);
      const month = Number(f.elements.dobMonth.value);
      if (!(day >= 1 && day <= 31) || !(month >= 1 && month <= 12)) {
        errBox.innerHTML = errHtml(t('সঠিক দিন ও মাস দিন', 'Enter a valid day and month')); return;
      }
      const btn = f.querySelector('button[type=submit]');
      const btnHtml = btn.innerHTML;
      btn.disabled = true; btn.textContent = t('যাচাই হচ্ছে…', 'Verifying…');
      try {
        await verifyRecoveryDob(found.identifier, day, month);
        step3(day, month);
      } catch (err) {
        errBox.innerHTML = errHtml(err.message);
        btn.disabled = false; btn.innerHTML = btnHtml;
      }
    });
  }

  function step3(dobDay, dobMonth) {
    holder.replaceChildren();
    const f = el('form', { class: 'grid', novalidate: true });
    f.innerHTML = `
      <div class="auth-title">${t('নতুন পাসওয়ার্ড', 'New Password')}</div>
      <div class="banner ok">${icon('check')}<span>${t('যাচাই সফল। এখন নতুন পাসওয়ার্ড দিন।', 'Verified. Set a new password.')}</span></div>
      <div class="field"><label>${t('নতুন পাসওয়ার্ড', 'New Password')} <span class="req">*</span></label><input name="pw1" type="password" required minlength="6" autocomplete="new-password"></div>
      <div class="field"><label>${t('পাসওয়ার্ড নিশ্চিত', 'Confirm Password')} <span class="req">*</span></label><input name="pw2" type="password" required minlength="6" autocomplete="new-password"></div>
      <button class="btn btn-primary btn-lg btn-block" type="submit">${icon('key')} ${t('পাসওয়ার্ড পরিবর্তন', 'Change Password')}</button>
      <div class="center"><button class="link-btn" type="button" data-back="3">← ${t('ফিরুন', 'Back')}</button></div>
      <div class="err center js-err" style="min-height:12px"></div>`;
    holder.appendChild(f);
    pwToggle(f.elements.pw1);
    pwToggle(f.elements.pw2);
    f.querySelector('[data-back]').addEventListener('click', step2);
    f.addEventListener('submit', async e => {
      e.preventDefault();
      const errBox = f.querySelector('.js-err'); errBox.textContent = '';
      if (f.elements.pw1.value !== f.elements.pw2.value) { errBox.innerHTML = errHtml(t('পাসওয়ার্ড মেলেনি', 'Passwords do not match')); return; }
      const btn = f.querySelector('button[type=submit]');
      const btnHtml = btn.innerHTML;
      btn.disabled = true; btn.textContent = t('পরিবর্তন হচ্ছে…', 'Changing…');
      try {
        await recoverPassword({ identifier: found.identifier, dobDay, dobMonth, newPassword: f.elements.pw1.value });
        await alertBox(t('পাসওয়ার্ড পরিবর্তন সফল হয়েছে। নতুন পাসওয়ার্ড দিয়ে লগইন করুন।', 'Password changed. Please log in.'), t('সফল', 'Success'));
        mode = 'login'; renderAuth(root, onLoggedIn);
      } catch (err) {
        errBox.innerHTML = errHtml(err.message);
        btn.disabled = false; btn.innerHTML = btnHtml;
      }
    });
  }

  step1();
}

/* ---------------- REGISTER (3-step wizard on mobile, one page on desktop) ---------------- */
const AUTH_REG_STEPS = [
  { bn: 'যোগাযোগ', en: 'Contact' },
  { bn: 'পরিচয়', en: 'Identity' },
  { bn: 'অ্যাকাউন্ট', en: 'Account' },
];
/* Server-side field errors jump back to the step that owns the field. */
const AUTH_REG_FIELD_STEP = {
  mobile: 0, whatsapp: 0, memberId: 0,
  nameBn: 1, nameEn: 1, fatherBn: 1, fatherEn: 1, motherBn: 1, motherEn: 1,
  email: 1, nid: 1, dob: 1, profession: 1, address: 1,
  installment: 2, password: 2,
};
const AUTH_BN_STEP = ['১', '২', '৩'];

async function registerForm(body, root, onLoggedIn) {
  clear(body);
  const cfg = await settings();
  let step = 0;
  const f = el('form', { class: 'grid', novalidate: true });
  const indicator = el('div', { class: 'wsteps', 'aria-hidden': 'true' });
  f.innerHTML = `
    <div class="wstep" data-step="0">
      <div class="banner info sm">${icon('info')}<span>${t('সদস্য ID মোবাইলের শেষ ৬ সংখ্যা দিয়ে স্বয়ংক্রিয় হবে।', 'Your member ID is the last 6 digits of your mobile.')}</span></div>
      <div class="field"><label>${t('মোবাইল নম্বর', 'Mobile number')} <span class="req">*</span></label>
        <input name="mobile" inputmode="numeric" maxlength="11" required placeholder="01712345678" autocomplete="tel">
        <div class="hint" id="midHint">${t('সদস্য ID: —', 'Member ID: —')}</div><div class="err" data-err="mobile"></div></div>
      <div class="field"><label>${t('WhatsApp নম্বর', 'WhatsApp number')} <span class="req">*</span></label>
        <input name="whatsapp" inputmode="numeric" maxlength="11" required placeholder="01712345678" autocomplete="tel">
        <label class="check" style="margin-top:3px"><input type="checkbox" name="sameWa" checked> ${t('মোবাইল নম্বরের মতোই', 'Same as mobile')}</label>
        <div class="err" data-err="whatsapp"></div></div>
    </div>
    <div class="wstep" data-step="1">
      <div class="field"><label>${t('নাম (বাংলা)', 'Name (Bangla)')} <span class="req">*</span></label>
        <input name="nameBn" required placeholder="মোঃ করিম" autocomplete="off"><div class="err" data-err="nameBn"></div></div>
      <div class="field"><label>${t('নাম (ইংরেজি)', 'Name (English)')} <span class="req">*</span></label>
        <input name="nameEn" required placeholder="Md. Karim" autocomplete="off"><div class="err" data-err="nameEn"></div></div>
      <details class="acc">
        <summary>${t('আরও তথ্য (ঐচ্ছিক)', 'More info (optional)')}</summary>
        <div class="grid">
          <div class="field"><label>${t('পিতার নাম (বাংলা)', "Father's name (Bangla)")}</label><input name="fatherBn" autocomplete="off"></div>
          <div class="field"><label>${t('পিতার নাম (ইংরেজি)', "Father's name (English)")}</label><input name="fatherEn" autocomplete="off"></div>
          <div class="field"><label>${t('মাতার নাম (বাংলা)', "Mother's name (Bangla)")}</label><input name="motherBn" autocomplete="off"></div>
          <div class="field"><label>${t('মাতার নাম (ইংরেজি)', "Mother's name (English)")}</label><input name="motherEn" autocomplete="off"></div>
          <div class="field"><label>${t('ইমেইল', 'Email')}</label><input name="email" type="email" placeholder="name@mail.com" autocomplete="off"><div class="err" data-err="email"></div></div>
          <div class="field"><label>${t('NID', 'NID')}</label><input name="nid" inputmode="numeric" autocomplete="off"></div>
          <div class="field"><label>${t('জন্মতারিখ', 'Date of birth')}</label><input name="dob" type="date"></div>
          <div class="field"><label>${t('পেশা', 'Profession')}</label><input name="profession" autocomplete="off"></div>
          <div class="field"><label>${t('ঠিকানা', 'Address')}</label><textarea name="address" rows="2"></textarea></div>
        </div>
      </details>
    </div>
    <div class="wstep" data-step="2">
      <div class="field"><label>${t('মাসিক কিস্তি (৳)', 'Monthly installment (৳)')} <span class="req">*</span></label>
        <input name="installment" type="number" min="1" step="1" value="${cfg.defaultInstallment || 1000}" required inputmode="numeric"><div class="err" data-err="installment"></div></div>
      <div class="field"><label>${t('পাসওয়ার্ড', 'Password')} <span class="req">*</span></label>
        <input name="pw1" type="password" required minlength="6" autocomplete="new-password"><div class="err" data-err="password"></div></div>
      <div class="field"><label>${t('পাসওয়ার্ড (আবার)', 'Password (again)')} <span class="req">*</span></label>
        <input name="pw2" type="password" required minlength="6" autocomplete="new-password"></div>
      <div class="banner warn sm">${icon('pending')}<span>${t('নিবন্ধনের পর Admin/Maker অনুমোদন লাগবে।', 'Admin/Maker approval is needed after registration.')}</span></div>
    </div>
    <div class="form-sticky">
      <button class="btn btn-ghost wiz-back" type="button">${icon('back')}<span>${t('ফিরে যান', 'Back')}</span></button>
      <button class="btn btn-primary btn-lg wiz-next" type="button"><span>${t('পরের ধাপ', 'Next')}</span>${icon('chevron')}</button>
      <button class="btn btn-primary btn-lg wiz-submit" type="submit">${icon('register')}<span>${t('নিবন্ধন করুন', 'Register')}</span></button>
    </div>
    <div class="center"><button class="link-btn" type="button" id="backLogin2">← ${t('লগইনে ফিরুন', 'Back to Login')}</button></div>`;
  f.prepend(indicator);
  body.appendChild(f);
  f.querySelector('#backLogin2').addEventListener('click', () => { mode = 'login'; renderAuth(root, onLoggedIn); });
  pwToggle(f.elements.pw1);
  pwToggle(f.elements.pw2);

  const steps = [...f.querySelectorAll('.wstep')];
  const backBtn = f.querySelector('.wiz-back');
  const nextBtn = f.querySelector('.wiz-next');
  const submitBtn = f.querySelector('.wiz-submit');
  const paint = () => {
    steps.forEach(s => s.classList.toggle('on', Number(s.dataset.step) === step));
    backBtn.hidden = step === 0;
    nextBtn.hidden = step === AUTH_REG_STEPS.length - 1;
    submitBtn.hidden = step !== AUTH_REG_STEPS.length - 1;
    indicator.innerHTML = AUTH_REG_STEPS.map((s, i) =>
      `<span class="wstep-dot${i === step ? ' on' : ''}${i < step ? ' done' : ''}">${i < step ? '✓' : AUTH_BN_STEP[i]}</span>`).join('<span class="wstep-line"></span>')
      + `<span class="wstep-lbl">${esc(t('ধাপ', 'Step'))} ${AUTH_BN_STEP[step]}/${AUTH_BN_STEP[2]} · ${esc(t(AUTH_REG_STEPS[step].bn, AUTH_REG_STEPS[step].en))}</span>`;
  };
  const toTop = () => { try { window.scrollTo(0, 0); } catch { /* ignore */ } };

  const midHint = f.querySelector('#midHint');
  const syncWa = () => { if (f.elements.sameWa.checked) f.elements.whatsapp.value = f.elements.mobile.value; };
  f.elements.mobile.addEventListener('input', () => {
    f.elements.mobile.value = f.elements.mobile.value.replace(/\D/g, '').slice(0, 11);
    const mid = memberIdFromMobile(f.elements.mobile.value);
    midHint.innerHTML = mid ? `${esc(t('সদস্য ID', 'Member ID'))}: <b style="color:var(--green-dark)">${mid}</b>` : esc(t('সদস্য ID: —', 'Member ID: —'));
    syncWa();
  });
  f.elements.sameWa.addEventListener('change', () => { syncWa(); f.elements.whatsapp.readOnly = f.elements.sameWa.checked; });
  f.elements.whatsapp.readOnly = true;
  f.elements.whatsapp.addEventListener('input', () => { f.elements.whatsapp.value = f.elements.whatsapp.value.replace(/\D/g, '').slice(0, 11); });

  const setErr = (name, msg) => {
    const box = f.querySelector(`[data-err="${name}"]`);
    if (box) { box.textContent = msg; box.closest('.field').classList.add('bad'); }
  };
  const clearErrs = () => {
    f.querySelectorAll('.err').forEach(x => x.textContent = '');
    f.querySelectorAll('.field').forEach(x => x.classList.remove('bad'));
  };
  const focusFirstBad = () => { const el = f.querySelector('.field.bad input, .field.bad textarea'); if (el) el.focus(); };
  /* Same rules as before — only split per step for the wizard. */
  const validateStep = idx => {
    const v = Object.fromEntries(new FormData(f).entries());
    let bad = false;
    if (idx === 0) {
      if (!isValidMobile(v.mobile)) { setErr('mobile', t('সঠিক ১১ সংখ্যার মোবাইল নম্বর দিন', 'Enter a valid 11-digit mobile number')); bad = true; }
      if (!isValidMobile(v.whatsapp)) { setErr('whatsapp', t('সঠিক WhatsApp নম্বর দিন', 'Enter a valid WhatsApp number')); bad = true; }
    } else if (idx === 1) {
      if (!String(v.nameBn || '').trim()) { setErr('nameBn', t('নাম (বাংলা) আবশ্যক', 'Name (Bangla) is required')); bad = true; }
      if (!String(v.nameEn || '').trim()) { setErr('nameEn', t('নাম (ইংরেজি) আবশ্যক', 'Name (English) is required')); bad = true; }
      if (v.email && !isValidEmail(v.email)) { setErr('email', t('সঠিক ইমেইল দিন', 'Enter a valid email')); bad = true; }
    } else {
      if (!(num(v.installment) > 0)) { setErr('installment', t('মাসিক কিস্তি দিন', 'Enter monthly installment')); bad = true; }
      const pwIssues = passwordIssues(v.pw1);
      if (pwIssues.length) { setErr('password', pwIssues[0]); bad = true; }
      else if (v.pw1 !== v.pw2) { setErr('password', t('পাসওয়ার্ড মেলেনি', 'Passwords do not match')); bad = true; }
    }
    return !bad;
  };

  backBtn.addEventListener('click', () => { if (step > 0) { step--; paint(); toTop(); } });
  nextBtn.addEventListener('click', () => {
    clearErrs();
    if (!validateStep(step)) { toast(t('ফর্মে ত্রুটি রয়েছে', 'Please fix the highlighted fields'), 'error'); focusFirstBad(); return; }
    step++; paint(); toTop();
  });

  f.addEventListener('submit', async e => {
    e.preventDefault();
    clearErrs();
    for (let i = 0; i < AUTH_REG_STEPS.length; i++) {
      if (!validateStep(i)) {
        step = i; paint();
        toast(t('ফর্মে ত্রুটি রয়েছে', 'Please fix the highlighted fields'), 'error');
        focusFirstBad();
        return;
      }
    }
    const v = Object.fromEntries(new FormData(f).entries());
    const btn = submitBtn; btn.disabled = true; btn.textContent = t('নিবন্ধন হচ্ছে…', 'Submitting…');
    try {
      const m = await registerMember({ ...v, password: v.pw1 });
      showSuccess(root, m, onLoggedIn);
    } catch (err) {
      if (err.fieldErrors) {
        err.fieldErrors.forEach(fe => setErr(fe.field === 'memberId' ? 'mobile' : fe.field, fe.msg));
        const first = err.fieldErrors[0] && err.fieldErrors[0].field;
        step = AUTH_REG_FIELD_STEP[first] ?? 0;
        paint(); focusFirstBad();
      } else toast(err.message, 'error');
      btn.disabled = false; btn.innerHTML = `${icon('register')}<span>${t('নিবন্ধন করুন', 'Register')}</span>`;
    }
  });

  paint();
}

function showSuccess(root, member, onLoggedIn) {
  clear(root);
  const card = el('div', { class: 'auth-card' });
  card.innerHTML = `
    <div class="success-pop">
      <div class="tick">${icon('check')}</div>
      <h4>${t('নিবন্ধন সফল!', 'Registration successful!')}</h4>
    </div>
    <div class="kv" style="margin-bottom:10px">
      <div>${t('সদস্য ID', 'Member ID')}</div><div><b style="font-size:11px;color:var(--green-dark)">${esc(member.memberId)}</b></div>
      <div>${t('নাম', 'Name')}</div><div>${esc(member.nameBn)} — ${esc(member.nameEn)}</div>
      <div>${t('মোবাইল', 'Mobile')}</div><div>${esc(member.mobile)}</div>
      <div>${t('মাসিক কিস্তি', 'Monthly installment')}</div><div>৳${esc(member.installment)}</div>
      <div>${t('স্ট্যাটাস', 'Status')}</div><div><span class="tag pending">${t('অনুমোদনের অপেক্ষায়', 'Pending approval')}</span></div>
    </div>
    <div class="banner ok">${icon('info')}<span>${t('Maker/Admin অনুমোদন দিলে আপনার সদস্য ID সক্রিয় হবে।', 'Your member ID will activate after Maker/Admin approval.')}</span></div>
    <div class="banner info">${icon('login')}<span>${t('লগইন করুন — ইউজারনেম:', 'Log in — username:')} <b>${esc(member.mobile)}</b> ${t('এবং আপনার পাসওয়ার্ড দিয়ে।', 'with your password.')}</span></div>
    <button class="btn btn-primary btn-lg btn-block" id="goLogin" type="button">${icon('login')} ${t('লগইনে ফিরুন', 'Back to Login')}</button>`;
  root.appendChild(card);
  card.querySelector('#goLogin').addEventListener('click', () => { mode = 'login'; renderAuth(root, onLoggedIn); });
}

export function setAuthMode(m) { mode = m; }
