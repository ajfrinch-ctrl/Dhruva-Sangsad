/* ধ্রুব সংসদ — application shell.
 *
 * Responsibilities (nothing else):
 *   · boot as fast as possible: the static HTML shell is already painted, we
 *     only take it over, decide signed-in vs signed-out, and render the route;
 *   · hash router (`#route` / `#route/section`) so browser Back, Android Back,
 *     refresh and deep links all land on the same screen;
 *   · ONE back control (the top bar arrow) and ONE navigation model
 *     (bottom bar + desktop rail + More sheet);
 *   · background services (database, cloud sync, service worker) never block
 *     the first paint.
 */
import { $, el, clear, toast, esc, alertBox, confirmBox, t, tx } from './util.js';
import { logoSrc, applyLogo, APP_VERSION } from './brand.js';
import { setLang, getLang, applyLang } from './i18n.js';
import { icon } from './icons.js';
import { openDB } from './db.js';
import { ensureBootstrapAdmin, getSession, clearSession, logout, can, checkBootstrapSession } from './auth.js';
import { renderAuth, setAuthMode } from './ui-auth.js';
import { initFirebase } from './vendor.js';
import { applyRole, getTheme, toggleTheme } from './theme.js';
import { bottomSheet, switchEl, skeleton, errorState } from './ui.js';
import { initShellGestures } from './gestures.js';
import { initInstallPrompt } from './install-prompt.js';
import {
  visibleNotifications, logActivity, settings, syncDueNotifications,
  ensureTxnIds, dedupeTxnIds, allMembers, allDeposits, allWithdrawals,
} from './store.js';
import { adminSetupWizard, forcePasswordChange } from './pages/account.js';

import { pageHome } from './pages/dashboard.js';
import { pageMembers } from './pages/members.js';
import { pageDeposits } from './pages/deposits.js';
import { pageTransactions } from './pages/transactions.js';
import { pageStatements } from './pages/statements.js';
import { pageReports } from './pages/reports.js';
import { pageSettings } from './pages/settings.js';
import { pageProfile } from './pages/profile.js';
import { pageAuthorization } from './pages/admin.js';

/* ------------------------------------------------------------------ *
 * Navigation model — one destination per feature, one home per feature.
 * The bottom bar shows the four primary slots for the active role; every
 * other destination is reachable from the More sheet (and the desktop rail),
 * never from a second copy of the same screen.
 * ------------------------------------------------------------------ */
export const NAV = [
  { id: 'home',         bn: 'হোম',            en: 'Home',         icon: 'home',      slots: ['staff', 'member'] },
  { id: 'members',      bn: 'সদস্য',           en: 'Members',      icon: 'members',   slots: ['staff'] },
  { id: 'deposits',     bn: 'জমা',             en: 'Deposits',     icon: 'deposit',   slots: ['staff', 'member'] },
  { id: 'transactions', bn: 'লেনদেন',          en: 'Transactions', icon: 'receipt',   slots: ['member'] },
  { id: 'statements',   bn: 'স্টেটমেন্ট',      en: 'Statement',    icon: 'report',    slots: [] },
  { id: 'reports',      bn: 'রিপোর্ট',         en: 'Reports',      icon: 'chart',     slots: [] },
  { id: 'authorization',bn: 'অপেক্ষমাণ অনুরোধ', en: 'Pending Requests', icon: 'approve', slots: [] },
  { id: 'settings',     bn: 'সেটিংস',          en: 'Settings',     icon: 'settings',  slots: [] },
  { id: 'profile',      bn: 'আমার প্রোফাইল',   en: 'My Profile',   icon: 'member',    slots: [] },
];

/* legacy routes (old bookmarks, manifest shortcuts, notification links) */
const ALIAS = {
  deposit: 'deposits',
  'member-panel': 'profile',
  members_hub: 'members',
  approval: 'authorization',
  approvals: 'authorization',
  activity: 'settings',
};

const PAGES = {
  home: pageHome,
  members: pageMembers,
  deposits: pageDeposits,
  transactions: pageTransactions,
  statements: pageStatements,
  reports: pageReports,
  settings: pageSettings,
  profile: pageProfile,
  authorization: pageAuthorization,
};

/* Route id → permission id. The profile screen replaced the old member-panel
   page, but the role matrix still grants that page as 'member-panel'. */
const ROUTE_PERM = { profile: 'member-panel' };
const canRoute = (s, route) => can(s, ROUTE_PERM[route] || route);

/* Auth routes live in their own full-screen host (no shell chrome). */
const AUTH_ROUTES = new Set(['login', 'register', 'forgot', 'recover']);

export function parseHash(h) {
  const raw = String(h || '').replace(/^#/, '').replace(/^\/+/, '');
  if (!raw) return { route: '', section: '' };
  const [route, section = ''] = raw.split('/');
  return { route: ALIAS[route] || route, section };
}
export function hashFor(route, section = '') {
  return `#${route}${section ? '/' + section : ''}`;
}

/** Extra params that survive a refresh inside the hash (e.g. edit a member). */
const sessionParams = {};

const boot = $('#boot');
const appEl = $('#app');
const authEl = $('#auth');

function hideBoot() {
  if (!boot) return;
  boot.classList.add('off');
  setTimeout(() => boot.remove(), 260);
}

/* ------------------------------------------------------------------ *
 * App
 * ------------------------------------------------------------------ */
export const App = {
  session: null,
  route: '',
  section: '',
  unread: 0,
  depth: 0,

  /* ---------------- routing ---------------- */

  /** Navigate to a route (+ optional section). History-driven: the hash is the
   *  single source of truth, so the browser back button always works. */
  go(route, section = '') {
    const s = this.session;
    if (!s) { this.goAuth('login'); return; }
    route = ALIAS[route] || route;
    if (!PAGES[route]) { route = 'home'; section = ''; }
    if (!canRoute(s, route)) {
      toast(t('এই মডিউলে প্রবেশাধিকার নেই', 'You do not have access to this module'), 'error');
      route = 'home'; section = '';
    }
    const target = hashFor(route, section);
    if (location.hash === target) { this.render(route, section); return; }
    location.hash = target;   // hashchange → render()
  },

  goAuth(route) {
    const target = hashFor(route);
    if (location.hash === target) { this.renderAuthRoute(route); return; }
    location.hash = target;
  },

  /** Render the route currently in the URL. */
  async route_(fromHash = false) {
    const { route, section } = parseHash(location.hash);
    if (!this.session) { this.goAuth(route && AUTH_ROUTES.has(route) ? route : 'login'); return; }
    if (route && AUTH_ROUTES.has(route)) { this.go('home'); return; }
    const allowed = route && PAGES[route] && canRoute(this.session, route);
    /* A route this role may not open: render Home AND fix the URL, so the hash,
       the highlighted nav item and the screen never disagree (replace() keeps a
       bogus entry out of the history, so Back still behaves). */
    if (route && PAGES[route] && !allowed) {
      await this.render('home', '', fromHash);
      if (location.hash !== '#home') location.replace('#home');
      return;
    }
    await this.render(allowed ? route : 'home', section, fromHash);
  },

  async render(route, section = '', fromHash = false) {
    const s = this.session;
    if (!s) return;
    this.route = route;
    this.section = section || '';
    if (!fromHash) this.depth++;
    showShell();
    paintNav(route);
    const view = $('#view');
    clear(view);
    view.appendChild(skeleton({ rows: 3, cards: 2 }));
    view.scrollTop = 0;
    window.scrollTo(0, 0);
    try {
      const node = await PAGES[route](s, { section: this.section });
      if (this.route !== route) return;      // a newer navigation won
      clear(view);
      view.appendChild(node);
      paintBack();
    } catch (e) {
      console.error('[page]', route, e);
      clear(view);
      view.appendChild(errorState({
        title: t('এই পেজটি লোড করা যায়নি', 'This page could not be loaded'),
        hint: (e && e.message) || '',
        onRetry: () => this.render(route, section, true),
      }));
    }
    this.paintBrand();
    resetIdleTimer();
  },

  /** Re-render the current route in place (keeps the history entry). */
  refresh() {
    if (!this.session) { this.renderAuthRoute('login'); return; }
    return this.render(this.route || 'home', this.section, true);
  },

  /* ---------------- back ---------------- */

  /** ONE back control. Browser history first (covers More → page, Android
   *  back, refresh), then the parent screen, then Home. Never a dead end. */
  back() {
    if (this.depth > 0 && history.length > 1) { this.depth--; history.back(); return; }
    const parent = { members: 'members', deposits: 'deposits', settings: 'settings', reports: 'reports', statements: 'statements', transactions: 'transactions' };
    if (this.section && parent[this.route]) { this.go(this.route); return; }
    if (this.route !== 'home') { this.go('home'); return; }
    // already home: leave the app (Android behaviour) if we can
    try { history.back(); } catch { /* ignore */ }
  },

  /* ---------------- auth screens ---------------- */

  renderAuthRoute(route) {
    const r = AUTH_ROUTES.has(route) ? route : 'login';
    setAuthMode(r === 'recover' ? 'forgot' : r);
    showAuthHost();
    renderAuth(authEl, s => this.enter(s));
    hideBoot();
  },

  showAuth() { this.renderAuthRoute(parseHash(location.hash).route || 'login'); },

  async enter(session, { silent = false } = {}) {
    this.session = session;
    window.DS_SESSION = session;
    applyRole(session.role);
    showShell();
    hideBoot();
    authEl.hidden = true;
    resetIdleTimer();

    const { route, section } = parseHash(location.hash);
    const target = (route && PAGES[route] && canRoute(session, route) && !AUTH_ROUTES.has(route)) ? route : 'home';
    await this.render(target, section, true);

    /* Gates that must not delay the first paint: they are modals, so the shell
       is already on screen when they open. */
    try {
      if (session.role === 'admin' && (session.isBootstrap || session.profileComplete === false)) {
        if (session.isBootstrap) await checkBootstrapSession(session);
        const done = await adminSetupWizard(session);
        if (!done) { await this.doLogout({ confirm: false }); return; }
        this.session = done; window.DS_SESSION = done;
      } else if (session.mustChangePassword) {
        const done = await forcePasswordChange(session);
        if (!done) { await this.doLogout({ confirm: false }); return; }
        this.session = done; window.DS_SESSION = done;
      }
    } catch (e) {
      this.session = null; window.DS_SESSION = null; applyRole('');
      this.showAuth();
      alertBox(e.message || String(e), t('লগইন', 'Login'));
      return;
    }

    /* Non-critical background work. */
    idle(() => {
      syncDueNotifications().then(() => this.refreshNotifBadge()).catch(() => {});
      initFirebase().catch(() => {});
    });
  },

  async doLogout({ confirm = true } = {}) {
    if (confirm && !(await confirmBox(t('আপনি কি লগআউট করতে চান?', 'Do you want to log out?'), {
      title: t('লগআউট', 'Logout'), okLabel: t('লগআউট', 'Logout'), danger: true,
    }))) return;
    try { await logout(); } catch { /* best effort */ }
    this.session = null; window.DS_SESSION = null; this.depth = 0;
    applyRole('');
    document.documentElement.setAttribute('data-session', '0');
    document.documentElement.setAttribute('data-role', 'guest');
    clearIdleTimer();
    location.hash = hashFor('login');
    setAuthMode('login');
    showAuthHost();
    renderAuth(authEl, s => this.enter(s));
  },

  /* ---------------- brand / chrome ---------------- */

  async paintBrand() {
    try {
      const cfg = await settings();
      applyLogo(cfg);
      const name = t(cfg.orgNameBn || 'ধ্রুব সংসদ', cfg.orgNameEn || 'Dhruva Sangsad');
      const bname = $('#brandName'); if (bname) bname.textContent = name;
    } catch { /* keep the static markup */ }
  },

  async paintRole() {
    const s = this.session; if (!s) return;
    const roleEl = $('#brandRole');
    if (!roleEl) return;
    const label = s.role === 'admin' ? t('অ্যাডমিন', 'Administrator')
      : s.role === 'maker' ? t('মেকার', 'Maker')
      : t('সদস্য', 'Member');
    const who = s.displayName || s.username || '';
    roleEl.innerHTML = `${esc(who)}${who ? ' · ' : ''}<span class="brand-role-tag">${esc(label)}</span>`;
  },

  async refreshNotifBadge() {
    const s = this.session; if (!s) return;
    let list = [];
    try { list = await visibleNotifications(s); } catch { return; }
    this.unread = list.filter(n => n.sticky || n.kind === 'due' || !(n.readBy || {})[s.id]).length;
    const btn = $('#btnNotif');
    if (!btn) return;
    btn.innerHTML = icon('bell');
    if (this.unread > 0) btn.appendChild(el('span', { class: 'badge', text: this.unread > 99 ? '99+' : String(this.unread) }));
    btn.setAttribute('aria-label', t(`নোটিফিকেশন (${this.unread})`, `Notifications (${this.unread})`));
  },

  /** More sheet — every destination that is not in the bottom bar, plus the
   *  app preferences. Activity Log and Change Password are NOT here: they live
   *  inside Settings (one feature → one location). */
  openMore() {
    const s = this.session; if (!s) return;
    const items = [];
    const rest = NAV.filter(i => canRoute(s, i.id) && !onBottomBar(i.id, s));
    if (rest.length) {
      items.push({ header: t('সব বিভাগ', 'All sections') });
      rest.forEach(i => items.push({
        ic: i.icon, label: t(i.bn, i.en),
        run: () => this.go(i.id),
      }));
      items.push('sep');
    }
    items.push({ header: t('পছন্দ', 'Preferences') });
    items.push({
      ic: getTheme() === 'amoled' ? 'sun' : 'moon',
      label: t('ডার্ক মোড', 'Dark mode'), keepOpen: true,
      right: switchEl(getTheme() === 'amoled', () => { toggleTheme(); this.refresh(); }),
    });
    items.push({
      ic: 'globe', keepOpen: true,
      label: t('ভাষা', 'Language'),
      right: switchEl(getLang() === 'en', () => setLang(getLang() === 'en' ? 'bn' : 'en')),
    });
    items.push('sep');
    items.push({ ic: 'logout', label: t('লগআউট', 'Logout'), danger: true, run: () => this.doLogout() });
    return bottomSheet({ title: t('আরও', 'More'), items });
  },
};
window.App = App;

/* ------------------------------------------------------------------ *
 * Shell painting
 * ------------------------------------------------------------------ */
function showShell() {
  if (appEl) { appEl.classList.add('on'); appEl.setAttribute('aria-hidden', 'false'); }
  if (authEl) authEl.hidden = true;
}
function showAuthHost() {
  if (appEl) { appEl.classList.remove('on'); appEl.setAttribute('aria-hidden', 'true'); }
  if (authEl) { authEl.hidden = false; }
}
const onBottomBar = (id, s) => {
  const group = s.role === 'member' ? 'member' : 'staff';
  const item = NAV.find(i => i.id === id);
  return !!(item && (item.slots || []).includes(group));
};

function paintNav(route) {
  document.querySelectorAll('#bottomnav .nav-item[data-route]').forEach(a => {
    a.classList.toggle('on', a.dataset.route === route);
    a.setAttribute('aria-current', a.dataset.route === route ? 'page' : 'false');
  });
  const rail = $('#rail');
  const s = App.session;
  if (!rail || !s) return;
  rail.replaceChildren();
  NAV.filter(i => canRoute(s, i.id)).forEach(i => {
    rail.appendChild(el('a', {
      class: `rail-tab${route === i.id ? ' on' : ''}`, href: hashFor(i.id),
      html: `${icon(i.icon)}<span>${esc(t(i.bn, i.en))}</span>`,
      onclick: (ev) => { ev.preventDefault(); App.go(i.id); },
    }));
  });
}

function paintBack() {
  const btn = $('#btnBack');
  if (!btn) return;
  const show = App.route !== 'home' || !!App.section || App.depth > 0;
  btn.hidden = !show;
  btn.innerHTML = icon('back');
}

/* ------------------------------------------------------------------ *
 * Keyboard shortcuts (desktop convenience) — unchanged feature set.
 * ------------------------------------------------------------------ */
const GO_KEYS = { h: 'home', m: 'members', d: 'deposits', a: 'authorization', t: 'transactions', s: 'settings', r: 'reports', x: 'statements', p: 'profile' };
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
    const back = document.querySelector('.sheet-backdrop') || document.querySelector('.rpv');
    if (back) { back.click(); e.preventDefault(); return; }
    App.back(); e.preventDefault();
    return;
  }
  if (k === 'Backspace') { App.back(); e.preventDefault(); return; }
  if (k === '/') {
    const box = document.querySelector('.main input[type="search"]')
      || [...document.querySelectorAll('.main input')].find(i => /search|খুঁজ/i.test(i.placeholder || ''));
    if (box) { e.preventDefault(); box.focus(); box.select?.(); }
    return;
  }
  if (k === 'g') { chord = 'g'; setTimeout(() => { chord = null; }, 1200); }
});

/* ------------------------------------------------------------------ *
 * Sync / connectivity chrome
 * ------------------------------------------------------------------ */
function paintSync(status) {
  const st = status || (navigator.onLine ? 'online' : 'offline');
  document.documentElement.dataset.sync = st;
  const bar = document.querySelector('.topbar');
  if (bar) {
    bar.classList.remove('sync-online', 'sync-offline', 'sync-syncing', 'sync-synced', 'sync-error');
    bar.classList.add(st === 'sync-error' ? 'sync-error' : `sync-${st}`);
  }
  let offline = $('#offlineBar');
  const show = st === 'offline' || st === 'sync-error';
  if (!offline) {
    offline = el('div', { class: 'offline-bar', id: 'offlineBar' });
    const host = $('#app') || document.body;
    host.insertBefore(offline, host.firstChild);
  }
  offline.innerHTML = `${icon('offline')}<span>${esc(t('অফলাইন — ডেটা এই ডিভাইসেই থাকবে, অনলাইনে এলে সিঙ্ক হবে', 'Offline — data stays on this device and syncs when you are back online'))}</span>`;
  offline.hidden = !show;
}
window.addEventListener('ds:sync-status', e => paintSync(e.detail && e.detail.status));

/* ------------------------------------------------------------------ *
 * Automatic session timeout (30 min inactivity)
 * ------------------------------------------------------------------ */
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
  try { await logActivity('SESSION_TIMEOUT', `${s.role} ${s.username || s.displayName} — 30 minutes of inactivity`, s); } catch { /* ignore */ }
  clearSession();
  setAuthMode('login');
  location.hash = hashFor('login');
  App.showAuth();
  alertBox(
    t('৩০ মিনিট নিষ্ক্রিয়তার কারণে সেশন শেষ হয়েছে। আবার লগইন করুন।', 'Your session expired after 30 minutes of inactivity. Please log in again.'),
    t('সেশন শেষ', 'Session expired'),
  );
}

/** Run after the first paint / when the browser is idle. */
function idle(fn, ms = 220) {
  const run = () => { try { fn(); } catch (e) { console.error(e); } };
  if ('requestIdleCallback' in window) requestIdleCallback(() => setTimeout(run, 0), { timeout: ms + 1600 });
  else setTimeout(run, ms);
}

/* ------------------------------------------------------------------ *
 * Service worker — registered ONCE, updated in place. The old builds
 * unregistered the worker and deleted every cache on each load, which is why
 * the app re-downloaded the logo and all assets on every visit.
 * ------------------------------------------------------------------ */
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).then(reg => {
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener('statechange', () => {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            toast(t('নতুন সংস্করণ ডাউনলোড হয়েছে — পরের বার খুললে চালু হবে', 'A new version was downloaded — it will apply on the next launch'), 'info');
          }
        });
      });
    }).catch(() => { /* offline / private mode — the app still works */ });
  });
}

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */
function wireChrome() {
  const backBtn = $('#btnBack');
  if (backBtn) backBtn.addEventListener('click', () => App.back());

  const notifBtn = $('#btnNotif');
  if (notifBtn) {
    notifBtn.innerHTML = icon('bell');
    notifBtn.addEventListener('click', () => {
      if (!App.session) return;
      import('./pages/notifications.js').then(m => m.openNotifications(App.session)).catch(() => {});
    });
  }

  const moreBtn = $('#navMore');
  if (moreBtn) {
    moreBtn.innerHTML = `${icon('menu')}<span class="ni-lbl"><span class="i-bn">আরও</span><span class="i-en">More</span></span>`;
    moreBtn.addEventListener('click', () => App.openMore());
  }

  document.querySelectorAll('#bottomnav .nav-item[data-ic][data-route]').forEach(a => {
    const ic = a.dataset.ic;
    const label = a.querySelector('.ni-lbl') || (() => {
      const s = el('span', { class: 'ni-lbl' });
      while (a.childNodes.length > 1) s.appendChild(a.childNodes[1]);
      a.appendChild(s);
      return s;
    })();
    a.innerHTML = icon(ic);
    a.appendChild(label);
    a.addEventListener('click', ev => {
      ev.preventDefault();
      if (!App.session) { App.goAuth('login'); return; }
      App.go(a.dataset.route || 'home');
    });
  });
}

function wireEvents() {
  window.addEventListener('hashchange', () => App.route_(true));
  window.addEventListener('popstate', () => { if (App.depth > 0) App.depth = Math.max(0, App.depth - 1); });
  window.addEventListener('ds:lang', () => {
    applyLang(getLang());
    if (App.session) { applyLogo(); App.paintRole(); App.refresh(); } else App.showAuth();
  });
  window.addEventListener('ds:data-changed', e => {
    const st = e.detail && e.detail.store;
    if (st === 'notifications' || st === '*') App.refreshNotifBadge();
    if (e.detail && e.detail.remote && App.session) {
      clearTimeout(window.__dsRefresh);
      window.__dsRefresh = setTimeout(() => App.refresh(), 450);
    }
  });
  window.addEventListener('online', () => { paintSync('online'); toast(t('ইন্টারনেট সংযোগ ফিরে এসেছে', 'Back online'), 'success'); });
  window.addEventListener('offline', () => { paintSync('offline'); toast(t('অফলাইন মোড — ডেটা এই ডিভাইসে সংরক্ষিত হবে', 'Offline mode — data is saved on this device'), 'warn'); });
  ['mousemove', 'mousedown', 'keydown', 'touchstart', 'touchmove', 'scroll', 'click', 'wheel']
    .forEach(ev => window.addEventListener(ev, resetIdleTimer, { passive: true, capture: true }));
}

async function bootApp() {
  wireChrome();
  wireEvents();
  applyLogo();
  paintSync(navigator.onLine ? 'online' : 'offline');
  registerSW();

  const session = App.session || getSession();
  if (session) {
    await App.enter(session);
    App.paintRole();
    App.refreshNotifBadge().catch(() => {});
  } else {
    App.showAuth();
    hideBoot();
  }

  /* Everything below is deliberately off the critical path. */
  idle(async () => {
    try {
      await openDB();
      await ensureBootstrapAdmin();
      /* Additive maintenance only: stamps missing transaction ids, never
         rewrites or deletes existing records. */
      await ensureTxnIds().catch(() => {});
      await dedupeTxnIds().catch(() => {});
    } catch (e) {
      console.error('[db]', e);
      alertBox(
        t('লোকাল ডেটাবেস (IndexedDB) খোলা যায়নি — ', 'The local database (IndexedDB) could not be opened — ')
        + ((e && e.message) || '') +
        t(' অন্য ট্যাব বা পুরনো ভার্সনের অ্যাপ বন্ধ করে আবার রিলোড করুন।', ' Close other tabs or older versions of the app and reload.'),
        t('ডেটাবেস সমস্যা', 'Database problem'),
      );
    }
  }, 60);

  idle(() => { try { initShellGestures({ onRefresh: () => App.refresh() }); } catch (e) { console.error(e); } }, 900);
  idle(() => { try { initInstallPrompt(); } catch (e) { console.error(e); } }, 2600);
  idle(() => { initFirebase().catch(() => {}); }, 1200);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootApp, { once: true });
else bootApp();
