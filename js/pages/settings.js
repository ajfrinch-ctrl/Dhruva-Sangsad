/* Settings — the single home for cross-cutting features:
   Activity Log · Change Password · Language · About · (staff) Organisation,
   Staff, Member Logins, Cloud Sync, Backup. Members get the same Activity Log
   and Change Password here — nothing lives in the Member Panel or Dashboard. */
import {
  el, esc, toast, fmtDateTime, num, confirmBox, deviceId, t,
} from '../util.js';
import { icon } from '../icons.js';
import { page, card, banner, btn, kv, embedPage } from '../ui.js';
import {
  allMembers, allDeposits, allWithdrawals, allUsers, settings, saveSettings,
  logActivity, invalidate,
} from '../store.js';
import { queueAll, getSetting, dbClear, STORES } from '../db.js';
import { firebase, DEFAULT_FIREBASE_CONFIG } from '../firebase.js';
import { getLang, setLang } from '../i18n.js';
import { APP_VERSION, logoSrc } from '../brand.js';
import { can } from '../auth.js';
import { App } from '../app.js';
import { pageActivity } from './misc.js';
import { pageBackup, staffManager, accountManager } from './admin.js';

export async function pageSettings(session, params = {}) {
  const staff = session.role === 'admin' || session.role === 'maker';
  const wrap = page(staff ? 'সেটিংস' : 'সেটিংস', 'Settings', 'settings');

  const [members, deposits, withdrawals, users, queue] = await Promise.all([
    allMembers(), allDeposits(), allWithdrawals(), allUsers(), queueAll(),
  ]);
  const pending = members.filter(m => m.status === 'pending').length
    + deposits.filter(d => d.status === 'pending').length
    + withdrawals.filter(w => w.status === 'pending').length;
  const makers = users.filter(u => u.role === 'maker').length;

  /* ---- tile menu ---- */
  const SECTIONS = [
    { id: 'activity', ic: 'log', bn: 'কার্যক্রম লগ', en: 'Activity Log', desc: 'কে, কখন, কী করেছে / who did what, when', tone: '' },
    { id: 'password', ic: 'lock', bn: 'পাসওয়ার্ড পরিবর্তন', en: 'Change Password', desc: 'নিরাপদ রাখুন / keep your account safe', tone: '' },
    { id: 'account', ic: 'member', bn: 'আমার অ্যাকাউন্ট', en: 'My Account', desc: 'ইউজার, রোল, ডিভাইস / user, role, device', tone: '' },
    { id: 'language', ic: 'globe', bn: 'ভাষা', en: 'Language', desc: 'বাংলা / English', tone: '' },
  ];
  if (staff && (can(session, 'member:approve') || can(session, 'deposit:approve'))) {
    SECTIONS.push({ id: 'approvals', ic: 'approve', bn: 'অনুমোদন', en: 'Approvals', desc: pending ? `${pending}টি অনুরোধ অপেক্ষায়` : 'সব অনুমোদন সম্পন্ন', route: 'authorization', badge: pending });
  }
  if (session.role === 'admin') {
    SECTIONS.push({ id: 'staff', ic: 'maker', bn: 'স্টাফ', en: 'Staff', desc: `${makers} জন Maker`, tone: '' });
    SECTIONS.push({ id: 'accounts', ic: 'members', bn: 'সদস্য লগইন', en: 'Member Logins', desc: 'চালু/বন্ধ, পাসওয়ার্ড রিসেট', tone: '' });
  }
  if (can(session, 'settings:manage')) {
    SECTIONS.push({ id: 'organisation', ic: 'building', bn: 'সংগঠন', en: 'Organisation', desc: 'নাম, লোগো, কিস্তি, টেমপ্লেট', tone: '' });
    SECTIONS.push({ id: 'firebase', ic: 'sync', bn: 'ক্লাউড সিঙ্ক', en: 'Cloud Sync', desc: queue.length ? `${queue.length}টি সিঙ্ক বাকি` : 'Firebase সংযোগ', badge: queue.length, tone: '' });
  }
  if (can(session, 'backup:manage')) {
    SECTIONS.push({ id: 'backup', ic: 'backup', bn: 'ব্যাকআপ', en: 'Backup', desc: 'সংরক্ষণ ও পুনরুদ্ধার', tone: '' });
  }
  SECTIONS.push({ id: 'about', ic: 'info', bn: 'অ্যাপ তথ্য', en: 'About', desc: 'সংস্করণ, ডিভাইস, সংযোগ', tone: 'gray' });

  /* member-role view: only the entries they need */
  const visible = staff ? SECTIONS : SECTIONS.filter(x => !['staff', 'accounts', 'organisation', 'firebase', 'backup', 'approvals'].includes(x.id));

  const menu = el('div', { class: 'sec-menu' });
  visible.forEach(s => {
    const b = el('button', { type: 'button', class: `sec-tile${s.tone ? ' ' + s.tone : ''}` });
    b.innerHTML = `<span class="st-ic">${icon(s.ic)}</span>
      <span class="st-tx"><span class="st-t">${esc(t(s.bn.split(' / ')[0], s.en))}</span><span class="st-s">${esc(t(s.desc.split(' / ')[0], s.desc))}</span></span>`
      + (s.badge ? `<span class="pill">${s.badge}</span>` : '');
    b.addEventListener('click', () => (s.route ? App.go(s.route) : open(s.id)));
    menu.appendChild(b);
  });

  const host = el('div');
  wrap.append(menu, host);

  let active = params.tab || params.section || '';
  const open = id => App.go('settings', { section: id });
  const home = () => App.go('settings', {});

  async function paint() {
    host.replaceChildren();
    if (!active) { menu.style.display = ''; return; }
    menu.style.display = 'none';
    const sec = SECTIONS.find(s => s.id === active);
    if (!sec) { active = ''; return paint(); }
    const bar = el('div', { class: 'sec-bar' });
    bar.appendChild(el('button', { type: 'button', class: 'sec-back', html: `${icon('back')}<span>${esc(t('সেটিংস', 'Settings'))}</span>`, onclick: home }));
    bar.appendChild(el('div', { class: 'sec-bar-t', html: `${icon(sec.ic)}<b>${esc(t(sec.bn, sec.en))}</b>` }));
    const pane = el('div');
    host.append(bar, pane);

    if (active === 'activity') await embedPage(pane, pageActivity, session);
    else if (active === 'password') passwordSection(pane);
    else if (active === 'account') accountSection(session, pane);
    else if (active === 'language') languageSection(pane);
    else if (active === 'about') aboutSection(pane);
    else if (active === 'organisation') await organisationSection(session, pane);
    else if (active === 'firebase') await firebaseSection(session, pane);
    else if (active === 'staff') await staffManager(session, pane);
    else if (active === 'accounts') await accountManager(session, pane);
    else if (active === 'backup') await embedPage(pane, pageBackup, session);
  }

  if (active) await paint();

  /* Esc returns to the settings menu. */
  const onKey = ev => {
    if (!host.isConnected) { window.removeEventListener('keydown', onKey); return; }
    if (ev.key === 'Escape' && active) home();
  };
  window.addEventListener('keydown', onKey);
  return wrap;
}

/* ---- Change Password (direct section, not a modal button) ---- */
function passwordSection(host) {
  const f = el('form', { class: 'grid mform', novalidate: true });
  f.innerHTML = `
    <div class="field"><label>${t('বর্তমান পাসওয়ার্ড', 'Current Password')} <span class="req">*</span></label>
      <input name="cur" type="password" required autocomplete="current-password"></div>
    <div class="field"><label>${t('নতুন পাসওয়ার্ড', 'New Password')} <span class="req">*</span></label>
      <input name="pw1" type="password" required minlength="6" autocomplete="new-password"></div>
    <div class="field"><label>${t('নতুন পাসওয়ার্ড (আবার)', 'Confirm New Password')} <span class="req">*</span></label>
      <input name="pw2" type="password" required minlength="6" autocomplete="new-password"></div>
    <div class="hint">${t('পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।', 'Minimum 6 characters.')}</div>
    <div class="err js-err"></div>
    <div class="form-sticky"><button class="btn btn-primary" type="submit">${icon('lock')}<span>${t('পাসওয়ার্ড পরিবর্তন করুন', 'Change Password')}</span></button></div>`;
  f.addEventListener('submit', async e => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(f).entries());
    const err = f.querySelector('.js-err');
    err.textContent = '';
    if (v.pw1 !== v.pw2) { err.textContent = t('দুইটি পাসওয়ার্ড মেলেনি', 'Passwords do not match'); return; }
    try {
      const { changeOwnPassword } = await import('../auth.js');
      await changeOwnPassword(v.cur, v.pw1);
      toast(t('পাসওয়ার্ড পরিবর্তন সফল', 'Password updated'), 'success');
      f.reset();
    } catch (err2) { err.textContent = err2.message; }
  });
  host.appendChild(card('পাসওয়ার্ড পরিবর্তন / Change Password', '', f));
}

/* ---- My account ---- */
function accountSection(session, host) {
  const acc = el('div');
  acc.appendChild(kv([
    ['ব্যবহারকারী / User', esc(session.displayName || session.username)],
    ['ইউজারনেম / Username', esc(session.username)],
    ['রোল / Role', `<span class="tag ${session.role === 'admin' ? 'info' : session.role === 'maker' ? 'approved' : 'gray'}">${esc(session.role === 'admin' ? t('অ্যাডমিন', 'Admin') : session.role === 'maker' ? 'Maker' : t('সদস্য', 'Member'))}</span>`],
    ...(session.memberId ? [['সদস্য আইডি / Member ID', esc(session.memberId)]] : []),
    ['লগইন সময় / Login at', esc(fmtDateTime(session.loginAt))],
    ['ডিভাইস আইডি / Device ID', esc(deviceId())],
  ]));
  host.appendChild(card('আমার অ্যাকাউন্ট', 'My Account', acc));
  if (session.role === 'member') {
    host.appendChild(btn(t('আমার প্রোফাইল', 'My Profile'), 'member', 'ghost', () => App.go('member-panel'), { block: true }));
  }
}

function languageSection(host) {
  const cur = getLang();
  const wrapEl = el('div');
  wrapEl.appendChild(el('p', { class: 'muted', style: 'margin:0 0 12px', text: t(
    'অ্যাপের ভাষা বেছে নিন।',
    'Choose the app language.',
  ) }));
  const row = el('div', { class: 'lang-pick' });
  [
    { id: 'bn', title: 'বাংলা', sub: 'Bangla' },
    { id: 'en', title: 'English', sub: 'ইংরেজি' },
  ].forEach(opt => {
    const b = el('button', {
      type: 'button',
      class: `lang-opt${cur === opt.id ? ' on' : ''}`,
      onclick: () => { setLang(opt.id); },
    });
    b.innerHTML = `<strong>${esc(opt.title)}</strong><span>${esc(opt.sub)}</span>`;
    row.appendChild(b);
  });
  wrapEl.appendChild(row);
  host.appendChild(card('ভাষা', 'Language', wrapEl));
}

function aboutSection(host) {
  host.appendChild(card('অ্যাপ সম্পর্কে', 'About', kv([
    ['অ্যাপ / Application', 'ধ্রুব সংসদ — Dhruvo Sangsad'],
    ['সংস্করণ / Version', APP_VERSION],
    ['ধরন / Type', 'Offline-first PWA · IndexedDB + Firebase Realtime Database'],
    ['সংযোগ / Connection', navigator.onLine ? `<span class="tag approved">${esc(t('অনলাইন', 'Online'))}</span>` : `<span class="tag gray">${esc(t('অফলাইন', 'Offline'))}</span>`],
    ['ডিভাইস আইডি / Device ID', esc(deviceId())],
    ['ব্যাকআপ / Data safety', t('সেটিংস → ব্যাকআপ', 'Settings → Backup')],
  ])));
}

/* ---- Organisation (admin/maker with settings:manage) ---- */
function resizeLogoFile(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) return reject(new Error('ছবি ফাইল দিন / Choose an image file'));
    if (file.size > 4 * 1024 * 1024) return reject(new Error('ফাইল খুব বড় (সর্বোচ্চ ৪ MB)'));
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const max = 512;
      let w = img.naturalWidth || img.width || 512, h = img.naturalHeight || img.height || 512;
      if (w > max || h > max) {
        const s = Math.min(max / w, max / h);
        w = Math.round(w * s); h = Math.round(h * s);
      }
      const c = document.createElement('canvas');
      c.width = Math.max(1, w); c.height = Math.max(1, h);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('ছবি খোলা যায়নি')); }
    img.src = url;
  });
}

async function organisationSection(session, host) {
  const cfg = await settings();
  const f = el('form', { class: 'grid', novalidate: true });
  f.innerHTML = `
    <div class="grid g2">
      <div class="field"><label>সংগঠনের নাম (বাংলা) <span class="req">*</span></label><input name="orgNameBn" value="${esc(cfg.orgNameBn)}" required></div>
      <div class="field"><label>Organisation Name (English) <span class="req">*</span></label><input name="orgNameEn" value="${esc(cfg.orgNameEn)}" required></div>
      <div class="field"><label>ঠিকানা / Address</label><input name="orgAddress" value="${esc(cfg.orgAddress || '')}"></div>
      <div class="field"><label>ফোন / Phone</label><input name="orgPhone" value="${esc(cfg.orgPhone || '')}"></div>
      <div class="field"><label>ডিফল্ট মাসিক কিস্তি (৳) <span class="req">*</span></label><input name="defaultInstallment" type="number" min="1" value="${esc(cfg.defaultInstallment)}"><div class="hint">${t('মাসিক জমার স্থির হার — নতুন সদস্যে প্রযোজ্য', 'Fixed monthly rate — applied to new members')}</div></div>
      <div class="field"><label>মাসিক আদায় লক্ষ্যমাত্রা (৳)</label><input name="monthlyTarget" type="number" min="0" value="${esc(cfg.monthlyTarget)}"><div class="hint">০ দিলে সক্রিয় সদস্যদের কিস্তির যোগফল লক্ষ্য ধরা হবে।</div></div>
    </div>
    <label class="check"><input type="checkbox" name="countSpecialTowardsInstallment" ${cfg.countSpecialTowardsInstallment ? 'checked' : ''}> বিশেষ চাঁদা ও অন্যান্য জমাকেও কিস্তি হিসেবে গণনা করুন</label>
    <div class="field" style="margin-top:8px">
      <label>প্রতিষ্ঠান / অ্যাপ লোগো</label>
      <div class="logo-edit">
        <img class="logo-preview" id="logoPreview" src="${esc(cfg.orgLogo || 'icons/logo.png')}" alt="logo">
        <div>
          <input type="file" id="logoFile" accept="image/png,image/jpeg,image/webp,image/svg+xml">
          <div class="hint">PNG / JPG — সর্বোচ্চ ~৫১২px।</div>
          <button class="btn btn-ghost btn-xs" type="button" id="logoReset">ডিফল্ট লোগো</button>
        </div>
      </div>
    </div>
    <div class="field" style="margin-top:8px"><label>WhatsApp বকেয়া রিমাইন্ডার টেমপ্লেট</label>
      <textarea name="waTemplate" rows="7">${esc(cfg.waTemplate)}</textarea>
      <div class="hint"><b>[Member Name]</b> অংশটি স্বয়ংক্রিয়ভাবে সদস্যের নাম দিয়ে প্রতিস্থাপিত হবে।</div></div>
    <div class="form-actions">
      <button class="btn btn-primary" type="submit">${icon('save')}<span>Save / সংরক্ষণ</span></button>
      <button class="btn btn-ghost" type="reset">${icon('clear')}<span>Reset</span></button>
    </div>`;
  const preview = f.querySelector('#logoPreview');
  const fileInput = f.querySelector('#logoFile');
  let pendingLogo = cfg.orgLogo || '';
  const paintPreview = () => { preview.src = logoSrc({ orgLogo: pendingLogo }); };
  paintPreview();
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    try {
      pendingLogo = await resizeLogoFile(file);
      paintPreview();
      toast('লোগো নির্বাচন করা হয়েছে — Save করুন', 'info');
    } catch (err) {
      toast(err.message || 'লোগো লোড করা যায়নি', 'error');
      fileInput.value = '';
    }
  });
  f.querySelector('#logoReset').addEventListener('click', () => {
    pendingLogo = '';
    fileInput.value = '';
    paintPreview();
  });
  f.addEventListener('reset', () => setTimeout(() => {
    pendingLogo = cfg.orgLogo || '';
    fileInput.value = '';
    paintPreview();
  }, 0));

  f.addEventListener('submit', async e => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(f).entries());
    if (!String(v.orgNameBn || '').trim() || !String(v.orgNameEn || '').trim()) { toast('সংগঠনের নাম আবশ্যক', 'error'); return; }
    if (!String(v.waTemplate || '').includes('[Member Name]')) { toast('টেমপ্লেটে [Member Name] অবশ্যই থাকতে হবে', 'error'); return; }
    const b = f.querySelector('button[type=submit]'); b.disabled = true;
    try {
      await saveSettings({
        orgNameBn: v.orgNameBn.trim(), orgNameEn: v.orgNameEn.trim(),
        orgAddress: (v.orgAddress || '').trim(), orgPhone: (v.orgPhone || '').trim(),
        defaultInstallment: num(v.defaultInstallment), monthlyTarget: num(v.monthlyTarget),
        countSpecialTowardsInstallment: !!v.countSpecialTowardsInstallment,
        waTemplate: v.waTemplate,
        orgLogo: pendingLogo,
      });
    } catch (err) {
      b.disabled = false;
      toast('সেটিংস সংরক্ষণ ব্যর্থ: ' + err.message, 'error');
      return;
    }
    b.disabled = false;
    await logActivity('SETTINGS_UPDATE', 'Organisation settings updated', session);
    toast('সেটিংস সংরক্ষিত হয়েছে / Settings saved', 'success');
    App.refresh();
  });
  host.appendChild(card('সংগঠন ও হিসাব সেটিংস', 'Organisation & Accounting Settings', f));

  /* --- danger zone --- */
  const dz = el('div');
  dz.appendChild(banner('warn', 'নিচের কাজগুলো স্থায়ী। কাজ করার আগে অবশ্যই ব্যাকআপ নিন।'));
  const dRow = el('div', { class: 'btn-row', style: 'margin-top:8px' });
  dRow.appendChild(btn('ব্যাকআপ ও রিস্টোর / Backup & Restore', 'backup', 'ghost', () => App.go('settings', { section: 'backup' })));
  dRow.appendChild(btn('স্থানীয় ডাটা মুছুন / Clear local data', 'trash', 'danger', async () => {
    if (!(await confirmBox('এই ডিভাইসের সমস্ত স্থানীয় ডাটা (সদস্য, জমা, লগ, ব্যবহারকারী) মুছে যাবে। Firebase-এ ডাটা থাকলে পুনরায় Pull করা যাবে। নিশ্চিত?', { okLabel: 'Erase', danger: true }))) return;
    if (!(await confirmBox('শেষ সতর্কতা — সত্যিই মুছে ফেলবেন?', { okLabel: 'Yes, erase', danger: true }))) return;
    for (const st of Object.keys(STORES)) await dbClear(st);
    invalidate();
    toast('স্থানীয় ডাটা মুছে ফেলা হয়েছে', 'warn');
    setTimeout(() => location.reload(), 700);
  }));
  const dc = card('বিপদজনক অঞ্চল', 'Danger Zone', dz);
  dc.body.appendChild(dRow);
  host.appendChild(dc);

}

/* ---- Firebase config ---- */
async function firebaseSection(session, host) {
  const fbCfg = await getSetting('firebaseConfig', null);
  const shown = (fbCfg && fbCfg.databaseURL) ? fbCfg : DEFAULT_FIREBASE_CONFIG;
  const fb = el('form', { class: 'grid', novalidate: true });
  const g = (k, ph) => `<div class="field"><label>${k}</label><input name="${k}" value="${esc((shown && shown[k]) || '')}" placeholder="${esc(ph)}" autocomplete="off"></div>`;
  fb.innerHTML = `
    <div class="grid g2">
      ${g('apiKey', 'AIza…')}${g('authDomain', 'your-project.firebaseapp.com')}
      ${g('databaseURL', 'https://your-project-default-rtdb.firebaseio.com')}${g('projectId', 'your-project-id')}
      ${g('storageBucket', 'your-project.appspot.com')}${g('messagingSenderId', '1234567890')}
      ${g('appId', '1:123:web:abc')}
    </div>
    <div class="form-actions">
      <button class="btn btn-primary" type="submit">${icon('save')}<span>Save & Connect</span></button>
      <button class="btn btn-ghost" type="button" id="fbClear">${icon('clear')}<span>Disconnect</span></button>
      <button class="btn btn-soft" type="button" id="fbSync">${icon('sync')}<span>Sync now</span></button>
    </div>
    <div class="fs8 muted" id="fbStat"></div>`;
  const stat = fb.querySelector('#fbStat');
  const paintStat = () => {
    if (!stat.isConnected) { window.removeEventListener('ds:sync-status', paintStat); return; }
    stat.textContent = `Status: ${firebase.status}${firebase.lastError ? ' — ' + firebase.lastError : ''}`;
  };
  paintStat();
  window.addEventListener('ds:sync-status', paintStat);

  /* cloud actions (previously on the Backup page header) */
  const cRow = el('div', { class: 'btn-stack', style: 'margin-top:10px' });
  cRow.appendChild(btn('এখনই সিঙ্ক / Sync now', 'sync', 'soft', async () => {
    if (!firebase.configured) { toast('প্রথমে Firebase কনফিগার করুন', 'warn'); return; }
    try { const n = await firebase.flush(); toast(`${n}টি সিঙ্ক হয়েছে`, 'success'); App.refresh(); }
    catch (err) { toast(err.message, 'error'); }
  }, { block: true }));
  cRow.appendChild(btn('ক্লাউড থেকে আনুন / Pull from cloud', 'download', 'soft', async () => {
    if (!firebase.configured) { toast('প্রথমে Firebase কনফিগার করুন', 'warn'); return; }
    if (!(await confirmBox('Firebase থেকে সব ডাটা টেনে এনে স্থানীয় ডাটার সাথে মিলানো হবে। চালিয়ে যাবেন?', { okLabel: 'আনুন' }))) return;
    try { const n = await firebase.pullAll(); const { dedupeTxnIds } = await import('../store.js'); await dedupeTxnIds(); invalidate(); toast(`${n}টি রেকর্ড আনা হয়েছে`, 'success'); App.refresh(); }
    catch (err) { toast(err.message, 'error'); }
  }, { block: true }));
  cRow.appendChild(btn('ক্লাউডে পাঠান / Push to cloud', 'upload', 'ghost', async () => {
    if (!firebase.configured) { toast('প্রথমে Firebase কনফিগার করুন', 'warn'); return; }
    if (!(await confirmBox('স্থানীয় সব ডাটা Firebase-এ পাঠানো হবে এবং সার্ভারের একই রেকর্ড প্রতিস্থাপিত হবে। চালিয়ে যাবেন?', { okLabel: 'পাঠান', danger: true }))) return;
    try { const n = await firebase.pushAll(); toast(`${n}টি রেকর্ড পাঠানো হয়েছে`, 'success'); }
    catch (err) { toast(err.message, 'error'); }
  }, { block: true }));

  fb.addEventListener('submit', async e => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(fb).entries());
    if (!v.apiKey || !v.databaseURL) { toast('apiKey ও databaseURL আবশ্যক', 'error'); return; }
    try {
      await firebase.saveConfig(v);
      await logActivity('SETTINGS_UPDATE', 'Firebase configuration updated', session);
      toast(firebase.ready ? 'Firebase সংযুক্ত হয়েছে' : 'সংরক্ষিত হয়েছে', firebase.ready ? 'success' : 'info');
      paintStat();
    } catch (err) { toast(err.message, 'error'); }
  });
  fb.querySelector('#fbClear').addEventListener('click', async () => {
    if (!(await confirmBox('Firebase সংযোগ বিচ্ছিন্ন করবেন? অ্যাপটি শুধুমাত্র অফলাইনে চলবে।', { okLabel: 'Disconnect', danger: true }))) return;
    await firebase.saveConfig(null);
    toast('সংযোগ বিচ্ছিন্ন / Disconnected', 'warn');
    App.refresh();
  });
  fb.querySelector('#fbSync').addEventListener('click', async () => {
    if (!firebase.configured) { toast('প্রথমে Firebase কনফিগার করুন', 'warn'); return; }
    try { const n = await firebase.flush(); toast(`${n} item(s) synced`, 'success'); } catch (err) { toast(err.message, 'error'); }
  });
  host.appendChild(card('ক্লাউড সিঙ্ক', 'Firebase Realtime Database', fb));
  host.appendChild(card('সিঙ্ক অ্যাকশন', 'Sync Actions', cRow));
}
