/* Guest screens: Login (default), Register, Forgot Password, Registration success.
   Nothing else is rendered while unauthenticated. */
import { el, clear, $, toast, alertBox, esc, num, memberIdFromMobile, isValidMobile, isValidEmail, normalizeMobile, fmtDate, toISO, t, logoSrc } from './util.js';
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
      ${t('ধ্রুব সংসদ · সদস্য ও জমা ব্যবস্থাপনা', 'Dhruvo Sangsad · Member & Deposit Management')}
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

/* ---------------- LOGIN ---------------- */
function loginForm(body, root, onLoggedIn) {
  clear(body);
  const f = el('form', { class: 'grid', novalidate: true });
  f.innerHTML = `
    <div class="auth-title">${t('লগইন', 'Login')}</div>
    <div class="field">
      <label>${t('ইউজার আইডি / মোবাইল', 'User ID / Mobile Number')} <span class="req">*</span></label>
      <input name="identifier" autocomplete="username" placeholder="${t('admin অথবা 01XXXXXXXXX', 'admin or 01XXXXXXXXX')}" required>
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
  f.querySelector('#toForgot').addEventListener('click', () => { mode = 'forgot'; renderAuth(root, onLoggedIn); });

  f.addEventListener('submit', async e => {
    e.preventDefault();
    const errBox = f.querySelector('#loginErr');
    errBox.textContent = '';
    const btn = f.querySelector('button[type=submit]');
    const id = f.elements.identifier.value.trim();
    const pw = f.elements.password.value;
    if (!id || !pw) { errBox.textContent = 'User ID এবং Password দিন / Enter user ID and password'; return; }
    btn.disabled = true; btn.textContent = 'Signing in…';
    try {
      const s = await login(id, pw, { remember: f.elements.remember.checked });
      toast(`স্বাগতম, ${s.displayName}`, 'success');
      onLoggedIn(s);
    } catch (err) {
      errBox.innerHTML = `<span class="form-err">${esc(err.message)}</span>`;
      btn.disabled = false; btn.innerHTML = `${icon('login')} Login`;
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
      const btn = f.querySelector('button[type=submit]'); btn.disabled = true;
      try {
        found = await findMemberForRecovery(mob);
        if (!found) { errBox.innerHTML = errHtml(t('এই মোবাইলে কোনো সদস্য পাওয়া যায়নি', 'No member found for this mobile number')); btn.disabled = false; return; }
        step2();
      } catch (err) {
        errBox.innerHTML = errHtml(err.message);
        btn.disabled = false;
      }
    });
  }

  function step2() {
    holder.replaceChildren();
    const box = el('div', { class: 'grid' });
    box.innerHTML = `
      <div class="auth-title">${t('সদস্য পাওয়া গেছে', 'Member found')}</div>
      <div class="kv">
        <div>Member ID</div><div><b>${esc(found.memberId)}</b></div>
        <div>${t('নাম', 'Name')}</div><div>${esc(found.nameBn || found.nameEn)}</div>
        <div>${t('মোবাইল', 'Mobile')}</div><div>${esc(found.mobile)}</div>
        <div>${t('স্ট্যাটাস', 'Status')}</div><div>${esc((found.status || '').toUpperCase())}</div>
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
      const btn = f.querySelector('button[type=submit]'); btn.disabled = true;
      try {
        await verifyRecoveryDob(found.identifier, day, month);
        step3(day, month);
      } catch (err) {
        errBox.innerHTML = errHtml(err.message);
        btn.disabled = false;
      }
    });
  }

  function step3(dobDay, dobMonth) {
    holder.replaceChildren();
    const f = el('form', { class: 'grid', novalidate: true });
    f.innerHTML = `
      <div class="auth-title">${t('নতুন পাসওয়ার্ড', 'New Password')}</div>
      <div class="banner ok">${icon('check')}<span>${t('যাচাই সফল। এখন নতুন পাসওয়ার্ড দিন।', 'Verified. Set a new password.')}</span></div>
      <div class="field"><label>${t('নতুন পাসওয়ার্ড', 'New Password')} <span class="req">*</span></label><input name="pw1" type="password" required minlength="6"></div>
      <div class="field"><label>${t('পাসওয়ার্ড নিশ্চিত', 'Confirm Password')} <span class="req">*</span></label><input name="pw2" type="password" required minlength="6"></div>
      <button class="btn btn-primary btn-lg btn-block" type="submit">${icon('key')} ${t('পাসওয়ার্ড পরিবর্তন', 'Change Password')}</button>
      <div class="center"><button class="link-btn" type="button" data-back="3">← ${t('ফিরুন', 'Back')}</button></div>
      <div class="err center js-err" style="min-height:12px"></div>`;
    holder.appendChild(f);
    f.querySelector('[data-back]').addEventListener('click', step2);
    f.addEventListener('submit', async e => {
      e.preventDefault();
      const errBox = f.querySelector('.js-err'); errBox.textContent = '';
      if (f.elements.pw1.value !== f.elements.pw2.value) { errBox.innerHTML = errHtml(t('Password মেলেনি', 'Passwords do not match')); return; }
      const btn = f.querySelector('button[type=submit]'); btn.disabled = true;
      try {
        await recoverPassword({ identifier: found.identifier, dobDay, dobMonth, newPassword: f.elements.pw1.value });
        await alertBox(t('পাসওয়ার্ড পরিবর্তন সফল হয়েছে। নতুন পাসওয়ার্ড দিয়ে লগইন করুন।', 'Password changed. Please log in.'), t('সফল', 'Success'));
        mode = 'login'; renderAuth(root, onLoggedIn);
      } catch (err) {
        errBox.innerHTML = errHtml(err.message);
        btn.disabled = false;
      }
    });
  }

  step1();
}

/* ---------------- REGISTER ---------------- */
async function registerForm(body, root, onLoggedIn) {
  clear(body);
  const cfg = await settings();
  const f = el('form', { class: 'grid', novalidate: true });
  f.innerHTML = `
    <div class="auth-title">সদস্য নিবন্ধন / Member Registration</div>
    <div class="banner info">${icon('info')}<span>Member ID স্বয়ংক্রিয়ভাবে মোবাইল নম্বরের শেষ ৬ সংখ্যা দিয়ে তৈরি হবে। নিবন্ধনের পর Maker/Admin অনুমোদন সাপেক্ষে আপনার ID Active হবে।</span></div>

    <div class="field"><label>Mobile Number / মোবাইল <span class="req">*</span></label>
      <input name="mobile" inputmode="numeric" maxlength="11" required placeholder="01712345678">
      <div class="hint" id="midHint">Member ID: —</div><div class="err" data-err="mobile"></div></div>

    <div class="field"><label>WhatsApp Number <span class="req">*</span></label>
      <input name="whatsapp" inputmode="numeric" maxlength="11" required placeholder="01712345678">
      <label class="check" style="margin-top:3px"><input type="checkbox" name="sameWa" checked> মোবাইল নম্বরের অনুরূপ / Same as mobile</label>
      <div class="err" data-err="whatsapp"></div></div>

    <div class="g2 grid">
      <div class="field"><label>নাম (বাংলা) <span class="req">*</span></label><input name="nameBn" required placeholder="মোঃ করিম"><div class="err" data-err="nameBn"></div></div>
      <div class="field"><label>Name (English) <span class="req">*</span></label><input name="nameEn" required placeholder="Md. Karim"><div class="err" data-err="nameEn"></div></div>
      <div class="field"><label>পিতার নাম (বাংলা)</label><input name="fatherBn"></div>
      <div class="field"><label>Father's Name (English)</label><input name="fatherEn"></div>
      <div class="field"><label>মাতার নাম (বাংলা)</label><input name="motherBn"></div>
      <div class="field"><label>Mother's Name (English)</label><input name="motherEn"></div>
      <div class="field"><label>Email ID</label><input name="email" type="email" placeholder="name@mail.com"><div class="err" data-err="email"></div></div>
      <div class="field"><label>NID Number</label><input name="nid" inputmode="numeric"></div>
      <div class="field"><label>Date of Birth (DD-MM-YYYY)</label><input name="dob" type="date"></div>
      <div class="field"><label>Profession / পেশা</label><input name="profession"></div>
    </div>
    <div class="field"><label>Address / ঠিকানা</label><textarea name="address" rows="2"></textarea></div>
    <div class="field"><label>Monthly Installment (৳) <span class="req">*</span></label>
      <input name="installment" type="number" min="1" step="1" value="${cfg.defaultInstallment || 1000}" required><div class="err" data-err="installment"></div></div>
    <div class="g2 grid">
      <div class="field"><label>Password <span class="req">*</span></label><input name="pw1" type="password" required minlength="6"><div class="err" data-err="password"></div></div>
      <div class="field"><label>Confirm Password <span class="req">*</span></label><input name="pw2" type="password" required minlength="6"></div>
    </div>
    <button class="btn btn-primary btn-lg btn-block" type="submit">${icon('register')} Register / নিবন্ধন করুন</button>
    <div class="center"><button class="link-btn" type="button" id="backLogin2">← Back to Login</button></div>`;
  body.appendChild(f);
  f.querySelector('#backLogin2').addEventListener('click', () => { mode = 'login'; renderAuth(root, onLoggedIn); });

  const midHint = f.querySelector('#midHint');
  const syncWa = () => { if (f.elements.sameWa.checked) f.elements.whatsapp.value = f.elements.mobile.value; };
  f.elements.mobile.addEventListener('input', () => {
    f.elements.mobile.value = f.elements.mobile.value.replace(/\D/g, '').slice(0, 11);
    const mid = memberIdFromMobile(f.elements.mobile.value);
    midHint.innerHTML = mid ? `Member ID: <b style="color:var(--green-dark)">${mid}</b>` : 'Member ID: —';
    syncWa();
  });
  f.elements.sameWa.addEventListener('change', () => { syncWa(); f.elements.whatsapp.readOnly = f.elements.sameWa.checked; });
  f.elements.whatsapp.readOnly = true;
  f.elements.whatsapp.addEventListener('input', () => { f.elements.whatsapp.value = f.elements.whatsapp.value.replace(/\D/g, '').slice(0, 11); });

  f.addEventListener('submit', async e => {
    e.preventDefault();
    f.querySelectorAll('.err').forEach(x => x.textContent = '');
    f.querySelectorAll('.field').forEach(x => x.classList.remove('bad'));
    const setErr = (name, msg) => {
      const box = f.querySelector(`[data-err="${name}"]`);
      if (box) { box.textContent = msg; box.closest('.field').classList.add('bad'); }
    };
    const v = Object.fromEntries(new FormData(f).entries());
    let bad = false;
    if (!isValidMobile(v.mobile)) { setErr('mobile', 'সঠিক ১১ সংখ্যার মোবাইল নম্বর দিন / Enter a valid 11-digit mobile number'); bad = true; }
    if (!isValidMobile(v.whatsapp)) { setErr('whatsapp', 'সঠিক WhatsApp নম্বর দিন / Enter a valid WhatsApp number'); bad = true; }
    if (!String(v.nameBn || '').trim()) { setErr('nameBn', 'নাম (বাংলা) আবশ্যক'); bad = true; }
    if (!String(v.nameEn || '').trim()) { setErr('nameEn', 'Name (English) is required'); bad = true; }
    if (v.email && !isValidEmail(v.email)) { setErr('email', 'সঠিক Email দিন / Enter a valid email'); bad = true; }
    if (!(num(v.installment) > 0)) { setErr('installment', 'মাসিক কিস্তি দিন / Enter monthly installment'); bad = true; }
    const pwIssues = passwordIssues(v.pw1);
    if (pwIssues.length) { setErr('password', pwIssues[0]); bad = true; }
    else if (v.pw1 !== v.pw2) { setErr('password', 'Password মেলেনি / Passwords do not match'); bad = true; }
    if (bad) { toast('ফর্মে ত্রুটি রয়েছে / Please fix the highlighted fields', 'error'); return; }

    const btn = f.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'Submitting…';
    try {
      const m = await registerMember({ ...v, password: v.pw1 });
      showSuccess(root, m, onLoggedIn);
    } catch (err) {
      if (err.fieldErrors) err.fieldErrors.forEach(fe => setErr(fe.field === 'memberId' ? 'mobile' : fe.field, fe.msg));
      else toast(err.message, 'error');
      btn.disabled = false; btn.innerHTML = `${icon('register')} Register / নিবন্ধন করুন`;
    }
  });
}

function showSuccess(root, member, onLoggedIn) {
  clear(root);
  const card = el('div', { class: 'auth-card' });
  card.innerHTML = `
    <div class="success-pop">
      <div class="tick">${icon('check')}</div>
      <h4>REGISTRATION SUCCESSFUL</h4>
    </div>
    <div class="kv" style="margin-bottom:10px">
      <div>Member ID</div><div><b style="font-size:11px;color:var(--green-dark)">${esc(member.memberId)}</b></div>
      <div>নাম / Name</div><div>${esc(member.nameBn)} — ${esc(member.nameEn)}</div>
      <div>Mobile</div><div>${esc(member.mobile)}</div>
      <div>Monthly Installment</div><div>৳${esc(member.installment)}</div>
      <div>Status</div><div><span class="tag pending">PENDING APPROVAL</span></div>
    </div>
    <div class="banner ok">${icon('info')}<span>আপনার Registration সফল হয়েছে। Maker/Admin Approval-এর পর আপনার Member ID Active হবে।</span></div>
    <div class="banner info" style="font-size:8px">${icon('login')}<span>লগইন করুন — User ID: <b>${esc(member.mobile)}</b> এবং আপনার নিবন্ধনের Password দিয়ে।</span></div>
    <button class="btn btn-primary btn-lg btn-block" id="goLogin" type="button">${icon('login')} Login</button>`;
  root.appendChild(card);
  card.querySelector('#goLogin').addEventListener('click', () => { mode = 'login'; renderAuth(root, onLoggedIn); });
}

export function setAuthMode(m) { mode = m; }
