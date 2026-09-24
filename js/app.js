/* ধ্রুব সংসদ — application shell, router, role-based navigation guard, idle timeout */
import { $, el, clear, toast, esc, alertBox, confirmBox, t } from './util.js';
import { logoSrc } from './brand.js';
import { setLang, getLang } from './i18n.js';
import { icon } from './icons.js';
import { openDB } from './db.js';
import { ensureBootstrapAdmin, getSession, clearSession, logout, can, PERMISSIONS, checkBootstrapSession } from './auth.js';
import { renderAuth, setAuthMode } from './ui-auth.js';
import { firebase } from './firebase.js';
import { applyRole, getTheme, toggleTheme } from './theme.js';
import { bottomSheet, switchEl, skeleton, errorState } from './ui.js';
import { initShellGestures } from './gestures.js';
import { visibleNotifications, invalidate, logActivity, settings, syncDueNotifications, allMembers, allDeposits, allWithdrawals } from './store.js';
import { adminSetupWizard, forcePasswordChange } from './pages/account.js';

import { pageHome } from './pages/dashboard.js';
import { pageMembersHub } from './pages/members.js';
import { pageDepositsHub } from './pages/deposits.js';
import { pageAuthorization, pageSettings, pageMemberPanel } from './pages/admin.js';
import { pageReports } from './pages/reports.js';
import { openNotifications } from './pages/misc.js';

/* Mobile-first navigation.
   `slots` = which items sit in the bottom bar (the rest live in “More”);
   members get their own 3 slots. Desktop renders every item in the left rail. */
const NAV = [
  { id: 'home', bn: 'হোম', en: 'Home', icon: 'dashboard', slots: ['staff', 'member'] },
  { id: 'members', bn: 'সদস্য', en: 'Members', icon: 'members', slots: ['staff'] },
  { id: 'deposit', bn: 'জমা', en: 'Deposits', icon: 'deposit', slots: ['staff', 'member'] },
  { id: 'authorization', bn: 'অনুমোদন', en: 'Approvals', icon: 'approve', slots: ['staff'] },
  { id: 'member-panel', bn: 'আমার', en: 'Mine', icon: 'member', slots: ['member'] },
  { id: 'reports', bn: 'রিপোর্ট', en: 'Reports', icon: 'report', slots: [] },
  /* Staff see this as the admin hub; members keep the plain “Settings” label. */
  { id: 'settings', bn: 'সেটিংস', en: 'Settings', icon: 'settings', bnStaff: 'অ্যাডমিন', enStaff: 'Admin', slots: [] },
];

/* Contextual primary action (FAB). Only the screens where one action dominates. */
const FAB = {
  members: { ic: 'plus', bn: 'সদস্য যোগ', en: 'Add member', perm: 'member:edit', run: () => App.go('members', { tab: 'register' }) },
  deposit: { ic: 'plus', bn: 'জমা যোগ', en: 'Add deposit', perm: 'deposit:create-any', run: () => App.go('deposit', { tab: 'entry' }) },
};

const PAGES = {
  'home': pageHome,
  'members': pageMembersHub,
  'deposit': pageDepositsHub,
  'authorization': pageAuthorization,
  'reports': pageReports,
  'settings': pageSettings,
  'member-panel': pageMemberPanel,
};

export const App = {
  session: null,
  route: 'home',
  unread: 0,
  async go(route, params = {}) {
    const s = this.session;
    if (!s) { this.showAuth(); return; }
    if (!PAGES[route] || !can(s, route)) {
      toast(t('এই মডিউলে প্রবেশাধিকার নেই', 'You do not have access to this module'), 'error');
      route = 'home';
    }
    this.route = route;
    this.params = params;
    location.hash = '#' + route;
    resetIdleTimer();
    const view = $('#view');
    clear(view);
    view.appendChild(skeleton({ rows: 3, cards: 4 }));
    try {
      const node = await PAGES[route](s, params);
      clear(view);
      view.appendChild(node);
      view.scrollTop = 0; window.scrollTo(0, 0);
    } catch (e) {
      console.error(e);
      clear(view);
      view.appendChild(errorState({
        title: t('এই পেজটি লোড করা যায়নি', 'This page could not be loaded'),
        hint: e && e.message ? e.message : '',
        onRetry: () => this.go(route, params),
      }));
    }
    this.paintNav();
    this.paintFooter();
  },
  applyBrand(cfg) {
    const src = logoSrc(cfg);
    document.querySelectorAll('#brandLogo img, .js-org-logo').forEach(img => { img.src = src; });
    const link = document.querySelector('link[rel="icon"]');
    if (link && src && !String(src).startsWith('data:')) link.href = src;
  },
  async paintFooter() {
    const el = $('#appFooterOrg');
    if (!el) return;
    try {
      const cfg = await settings();
      this.applyBrand(cfg);
      const bn = (cfg.orgNameBn || '').trim();
      const en = (cfg.orgNameEn || '').trim();
      const extra = [cfg.orgAddress, cfg.orgPhone].filter(Boolean).join(' · ');
      el.innerHTML = `<img class="foot-logo js-org-logo" src="${esc(logoSrc(cfg))}" alt="">`
        + `<strong>${esc(bn || 'ধ্রুব সংসদ')}</strong>`
        + (en ? `<span class="app-footer-en">${esc(en)}</span>` : '')
        + (extra ? `<span class="app-footer-meta">${esc(extra)}</span>` : '')
        + `<span class="app-footer-meta">v${esc(APP_VERSION)}</span>`;
    } catch {
      el.textContent = 'ধ্রুব সংসদ';
    }
  },
  refresh() { return this.go(this.route, this.params || {}); },

  labelOf(item) {
    const s = this.session;
    const isStaff = !s || s.role !== 'member';
    return t(
      (isStaff && item.bnStaff) ? item.bnStaff : item.bn,
      (isStaff && item.enStaff) ? item.enStaff : item.en,
    );
  },

  /** One nav button, shaped for the bottom bar or the desktop rail. */
  navButton(item, where) {
    const label = this.labelOf(item);
    const b = el('button', {
      class: `nav-tab${this.route === item.id ? ' on' : ''}`, type: 'button',
      title: label, dataset: { route: item.id },
      html: `${icon(item.icon)}<span>${esc(label)}</span>`,
      onclick: () => this.go(item.id),
    });
    if (where === 'rail') b.classList.add('rail-tab');
    return b;
  },

  /** The 5th slot of the bottom bar + the last rail item: everything else. */
  moreButton(where) {
    const b = el('button', {
      class: 'nav-tab nav-more', type: 'button', dataset: { route: 'more' },
      title: t('আরও', 'More'),
      html: `${icon('grid')}<span>${esc(t('আরও', 'More'))}</span>`,
      onclick: () => this.openMore(),
    });
    if (where === 'rail') b.classList.add('rail-tab');
    return b;
  },

  paintNav() {
    const s = this.session; if (!s) return;
    const nav = $('#topnav');
    if (nav) nav.hidden = true;          // replaced by the bottom bar / rail
    const bottom = $('#bottomnav');
    const rail = $('#rail');
    const group = s.role === 'member' ? 'member' : 'staff';

    /* bottom bar: the 4 (or 3) primary destinations + “More” */
    if (bottom) {
      bottom.hidden = false;
      bottom.replaceChildren();
      const slots = NAV.filter(i => can(s, i.id) && (i.slots || []).includes(group));
      slots.forEach(i => bottom.appendChild(this.navButton(i, 'bottom')));
      bottom.appendChild(this.moreButton('bottom'));
    }

    /* desktop rail: every destination + “More” */
    if (rail) {
      rail.hidden = false;
      rail.replaceChildren();
      const logo = el('div', { class: 'rail-logo', html: icon('dashboard') });
      rail.appendChild(logo);
      NAV.filter(i => can(s, i.id)).forEach(i => rail.appendChild(this.navButton(i, 'rail')));
      rail.appendChild(this.moreButton('rail'));
    }

    this.paintApprovalBadge();
    this.paintFab();

    const setBtn = $('#btnSettings');
    if (setBtn) setBtn.hidden = true;   // “Settings” now lives in the More sheet
    const userName = s.displayName || s.username || s.memberId || '';
    const brand = $('#brandRole');
    brand.innerHTML = `<span class="brand-name">${esc(userName)}</span><span class="brand-role-tag">${esc((s.role || '').toUpperCase())}</span>`;
  },

  /** Contextual FAB — one dominant action per screen, hidden elsewhere. */
  paintFab() {
    const s = this.session;
    const fab = $('#fab');
    if (!fab) return;
    const f = FAB[this.route];
    const allowed = f && (!f.perm || can(s, f.perm) || (f.perm === 'deposit:create-any' && can(s, 'deposit:create-own')));
    if (!allowed) { fab.hidden = true; return; }
    fab.hidden = false;
    fab.innerHTML = `${icon(f.ic)}<span>${esc(t(f.bn, f.en))}</span>`;
    fab.onclick = f.run;
  },

  /** “More” sheet: the secondary destinations, theme, language and logout. */
  openMore() {
    const s = this.session; if (!s) return;
    const items = [];
    NAV.filter(i => can(s, i.id) && !(i.slots || []).includes(s.role === 'member' ? 'member' : 'staff'))
      .forEach(i => items.push({ ic: i.icon, label: this.labelOf(i), run: () => this.go(i.id) }));
    if (can(s, 'backup:manage')) {
      items.push({ ic: 'backup', label: t('ব্যাকআপ', 'Backup'), run: () => this.go('settings', { tab: 'backup' }) });
    }
    if (can(s, 'staff:manage')) {
      items.push({ ic: 'maker', label: t('ইউজার ম্যানেজমেন্ট', 'User management'), run: () => this.go('settings', { tab: 'staff' }) });
    }
    items.push({ ic: 'log', label: t('অ্যাকটিভিটি লগ', 'Activity Log'), run: () => this.go('settings', { tab: 'activity' }) });
    items.push({ ic: 'key', label: t('কীবোর্ড শর্টকাট', 'Keyboard shortcuts'), run: () => shortcutSheet() });
    items.push('sep');
    items.push({
      ic: getTheme() === 'amoled' ? 'moon' : 'sun', label: t('ডার্ক মোড', 'Dark mode'),
      keepOpen: true, right: switchEl(getTheme() === 'amoled', () => toggleTheme()),
    });
    items.push({
      ic: 'globe', label: t('ভাষা / Language', 'Language'),
      keepOpen: true, right: switchEl(getLang() === 'en', () => setLang(getLang() === 'en' ? 'bn' : 'en')),
    });
    items.push('sep');
    items.push({ ic: 'logout', label: t('লগআউট', 'Logout'), danger: true, run: () => this.doLogout() });
    return bottomSheet({ title: t('আরও', 'More'), items });
  },

  /** Red pill on the Approvals item: how many requests are waiting. */
  async paintApprovalBadge() {
    const s = this.session;
    if (!s || (!can(s, 'member:approve') && !can(s, 'deposit:approve'))) return;
    try {
      const [members, deposits, withdrawals] = await Promise.all([allMembers(), allDeposits(), allWithdrawals()]);
      const n = members.filter(m => m.status === 'pending').length
        + deposits.filter(d => d.status === 'pending').length
        + withdrawals.filter(w => w.status === 'pending').length;
      document.querySelectorAll('.nav-tab[data-route="authorization"]').forEach(tab => {
        tab.querySelector('.pill')?.remove();
        if (n > 0) tab.appendChild(el('span', { class: 'pill', text: n > 99 ? '99+' : String(n) }));
      });
    } catch { /* non-critical — skip the badge */ }
  },

  async refreshNotifBadge() {
    const s = this.session; if (!s) return;
    const list = await visibleNotifications(s);
    this.unread = list.filter(n => n.sticky || n.kind === 'due' || !(n.readBy || {})[s.id]).length;
    const btn = $('#btnNotif');
    btn.innerHTML = icon('bell');
    if (this.unread > 0) btn.appendChild(el('span', { class: 'badge', text: this.unread > 99 ? '99+' : String(this.unread) }));
  },

  showAuth() {
    $('#app').classList.remove('on');
    $('#app').setAttribute('aria-hidden', 'true');
    clear($('#view'));
    clear($('#topnav'));
    const scr = $('#authScreen');
    scr.classList.remove('hidden');
    renderAuth(scr, s => this.enter(s));
  },

  async enter(session) {
    this.session = session;
    window.DS_SESSION = session;
    applyRole(session.role);
    $('#authScreen').classList.add('hidden');
    clear($('#authScreen'));
    $('#app').classList.add('on');
    $('#app').setAttribute('aria-hidden', 'false');
    resetIdleTimer();

    // first-time admin setup / forced password change gates
    if (session.role === 'admin' && (session.isBootstrap || session.profileComplete === false)) {
      if (session.isBootstrap) {
        try { await checkBootstrapSession(session); }
        catch (e) {
          this.session = null; window.DS_SESSION = null; applyRole('');
          this.showAuth();
          alertBox(e.message, 'লগইন / Login');
          return;
        }
      }
      const done = await adminSetupWizard(session);
      if (!done) { await logout(); this.session = null; this.showAuth(); return; }
      this.session = done;
    } else if (session.mustChangePassword) {
      const done = await forcePasswordChange(session);
      if (!done) { await logout(); this.session = null; this.showAuth(); return; }
      this.session = done;
    }
    try { await syncDueNotifications(); } catch {}
    await this.refreshNotifBadge();
    const hash = (location.hash || '').replace('#', '');
    await this.go(hash && PAGES[hash] && can(this.session, hash) ? hash : 'home');
  },

  async doLogout() {
    if (!(await confirmBox(t('আপনি কি লগআউট করতে চান?', 'Do you want to log out?'), { title: t('লগআউট', 'Logout'), okLabel: t('লগআউট', 'Logout') }))) return;
    await logout();
    this.session = null; window.DS_SESSION = null;
    applyRole('');
    clearIdleTimer();
    setAuthMode('login');
    location.hash = '';
    toast(t('লগআউট সম্পন্ন', 'Logged out'), 'success');
    this.showAuth();
  },
};
window.App = App;

/* ---------------- topbar sync border + offline bar ---------------- */
function paintOfflineBar(on) {
  let bar = $('#offlineBar');
  if (!bar) {
    bar = el('div', { class: 'offline-bar', id: 'offlineBar' });
    const app = $('#app') || document.body;
    app.insertBefore(bar, app.firstChild);
  }
  bar.innerHTML = `${icon('offline')}<span>${esc(t('অফলাইন — ডেটা ডিভাইসেই থাকবে, অনলাইনে সিঙ্ক হবে', 'Offline — data stays on this device and syncs when online'))}</span>`;
  bar.hidden = !on;
  document.documentElement.dataset.offline = on ? '1' : '0';
}

function paintSync(status) {
  const bar = document.querySelector('.topbar');
  const st = status || (navigator.onLine ? 'online' : 'offline');
  paintOfflineBar(st === 'offline' || st === 'sync-error');
  if (!bar) return;
  bar.classList.remove('sync-online', 'sync-offline', 'sync-syncing', 'sync-synced', 'sync-error');
  const cls = st === 'sync-error' ? 'sync-error' : `sync-${st}`;
  bar.classList.add(cls);
  document.documentElement.dataset.sync = st;
}
window.addEventListener('ds:sync-status', e => paintSync(e.detail.status));

/* ---------------- keyboard shortcuts (desktop convenience) ---------------- */
const GO_KEYS = {
  h: 'home', m: 'members', d: 'deposit', a: 'authorization',
  r: 'reports', s: 'settings', u: 'users', l: 'activity',
};
const SHORTCUTS = [
  ['g h', t('হোম', 'Home')], ['g m', t('সদস্য', 'Members')], ['g d', t('জমা', 'Deposits')],
  ['g a', t('অনুমোদন', 'Approvals')], ['g r', t('রিপোর্ট', 'Reports')], ['g s', t('সেটিংস', 'Settings')],
  ['n', t('প্রধান অ্যাকশন (FAB)', 'Primary action (FAB)')],
  ['/', t('অনুসন্ধান ফিল্ডে যান', 'Focus the search field')],
  ['?', t('এই সাহায্য', 'This help')], ['Esc', t('শিট/মোডাল বন্ধ', 'Close sheet or dialog')],
];

export function shortcutSheet() {
  bottomSheet({
    title: t('কীবোর্ড শর্টকাট', 'Keyboard shortcuts'),
    items: SHORTCUTS.map(([k, label]) => ({
      label: `${k} — ${label}`, ic: 'key', keepOpen: true,
    })),
  });
}

let chord = null;
window.addEventListener('keydown', e => {
  if (!App.session) return;
  const tgt = e.target || {};
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(tgt.tagName || '') || tgt.isContentEditable) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key;

  if (chord === 'g') {
    chord = null;
    const route = GO_KEYS[(k || '').toLowerCase()];
    if (route) { e.preventDefault(); App.go(route); }
    return;
  }
  if (k === 'Escape') {
    const back = document.querySelector('.sheet-backdrop');
    if (back) { back.click(); e.preventDefault(); }
    return;
  }
  if (k === '?') { shortcutSheet(); return; }
  if (k === '/') {
    const box = document.querySelector('.main input[type="search"]')
      || [...document.querySelectorAll('.main input')].find(i => /search/i.test(i.placeholder || ''));
    if (box) { e.preventDefault(); box.focus(); box.select?.(); }
    return;
  }
  if ((k === 'n' || k === 'N') && !chord) {
    const f = $('#fab');
    if (f && !f.hidden) { e.preventDefault(); f.click(); }
    return;
  }
  if (k === 'g') { chord = 'g'; setTimeout(() => { chord = null; }, 1200); }
});

/* ---------------- automatic session timeout (30 min inactivity) ---------------- */
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
let idleTimer = null;

function clearIdleTimer() { if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; } }

function resetIdleTimer() {
  clearIdleTimer();
  if (!App.session) return;
  idleTimer = setTimeout(onIdleTimeout, IDLE_TIMEOUT_MS);
}

async function onIdleTimeout() {
  if (!App.session) return;
  const s = App.session;
  App.session = null; window.DS_SESSION = null;
  applyRole('');
  clearIdleTimer();
  try { await logActivity('SESSION_TIMEOUT', `${s.role} ${s.username || s.displayName} — 30 minutes of inactivity`, s); } catch {}
  try { firebase.signOut().catch(() => {}); } catch {}
  clearSession();
  setAuthMode('login');
  location.hash = '';
  App.showAuth();
  alertBox('Your session expired due to 30 minutes of inactivity. Please log in again.', 'সেশন মেয়াদ শেষ / Session Expired');
}

/* ---------------- boot ---------------- */
async function boot() {
  // Prevent double-init if app.js is evaluated twice (with/without ?v=)
  if (window.__DS_BOOTED) return;
  window.__DS_BOOTED = true;

  try {
    await Promise.race([
      openDB(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('IndexedDB timeout')), 8000)),
    ]);
    await ensureBootstrapAdmin();
  } catch (e) {
    console.error('boot db', e);
    /* A silent console error leaves the user on a blank/broken screen, so say so. */
    try {
      const why = (e && e.message) ? e.message : String(e);
      alertBox(
        t('লোকাল ডেটাবেস (IndexedDB) খোলা যায়নি — ', 'The local database (IndexedDB) could not be opened — ') + why +
        t(' অন্য ট্যাব বা পুরনো ভার্সনের অ্যাপ বন্ধ করে পেজটি রিলোড করুন।', ' Close other tabs or older versions of the app and reload the page.'),
        t('ডেটাবেস সমস্যা', 'Database problem'),
      );
    } catch (_) {}
  }
  paintSync(navigator.onLine ? 'online' : 'offline');
  try { firebase.init(); } catch (e) { console.error('firebase', e); }

  /* Step-8 touch polish: pull-to-refresh + collapse-on-scroll topbar. */
  try { initShellGestures({ onRefresh: () => App.refresh() }); } catch (e) { console.error('gestures', e); }

  // onclick replaces any previous handler (safe if boot runs twice)
  $('#btnLogout').innerHTML = icon('logout');
  $('#btnLogout').onclick = () => App.doLogout();

  const setBtn = $('#btnSettings');
  if (setBtn) {
    setBtn.innerHTML = icon('settings');
    setBtn.onclick = () => { if (App.session) App.go('settings'); };
  }

  $('#btnNotif').innerHTML = icon('bell');
  $('#btnNotif').onclick = () => { if (App.session) openNotifications(App.session); };
  const moreBtn = $('#btnMore');
  if (moreBtn) { moreBtn.innerHTML = icon('grid'); moreBtn.onclick = () => App.openMore(); }
  const paintThemeBtn = () => {
    const b = $('#btnTheme'); if (!b) return;
    const dark = getTheme() === 'amoled';
    b.innerHTML = icon(dark ? 'sun' : 'moon');
    b.setAttribute('aria-label', dark ? 'Light mode' : 'Hard dark');
    b.title = dark ? 'লাইট মোড / Light' : 'হার্ড ডার্ক / Hard dark';
  };
  paintThemeBtn();
  // onclick replaces any previous handler (safe if boot runs twice)
  $('#btnTheme').onclick = () => { toggleTheme(); paintThemeBtn(); };
  window.addEventListener('ds:theme', paintThemeBtn);

  // Reset the idle timer on any meaningful user interaction.
  ['mousemove', 'mousedown', 'keydown', 'touchstart', 'touchmove', 'scroll', 'click', 'wheel']
    .forEach(ev => window.addEventListener(ev, resetIdleTimer, { passive: true, capture: true }));

  window.addEventListener('ds:data-changed', e => {
    const st = e.detail && e.detail.store;
    if (st === 'notifications' || st === '*') App.refreshNotifBadge();
    if (e.detail && e.detail.remote && App.session) {
      clearTimeout(window.__dsRefresh);
      window.__dsRefresh = setTimeout(() => App.refresh(), 400);
    }
  });
  window.addEventListener('hashchange', () => {
    const h = (location.hash || '').replace('#', '');
    if (App.session && h && h !== App.route && PAGES[h]) App.go(h);
  });
  window.addEventListener('online', () => toast(t('ইন্টারনেট সংযোগ ফিরে এসেছে — সিঙ্ক হচ্ছে', 'Back online — syncing'), 'success'));
  window.addEventListener('offline', () => toast(t('অফলাইন মোড — ডেটা লোকালি সংরক্ষিত হবে', 'Offline mode — data is saved locally'), 'warn'));
  window.addEventListener('ds:lang', () => {
    if (App.session) App.refresh();
    else App.showAuth();
  });

  try {
    const s = getSession();
    if (s) await App.enter(s); else App.showAuth();
  } catch (e) {
    console.error('boot enter', e);
    App.showAuth();
    const t = document.querySelector('#authScreen .auth-title');
    if (t) t.textContent = 'লোড সমস্যা: ' + (e.message || e);
  }

  if ('serviceWorker' in navigator) {
    /* Preview / first load: drop any stale SW that was serving old JS modules. */
    navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister())).catch(() => {});
    caches.keys().then(ks => Promise.all(ks.map(k => caches.delete(k)))).catch(() => {});
  }
}
boot();
