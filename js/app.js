/* ধ্রুব সংসদ — application shell, section-aware hash router, role guard,
   clean top bar ([Back/Menu] · title · [Bell]), idle timeout.
   No floating action buttons anywhere — every action lives in its section. */
import { $, el, clear, toast, esc, alertBox, confirmBox, t } from './util.js';
import { logoSrc } from './brand.js';
import { setLang, getLang } from './i18n.js';
import { icon } from './icons.js';
import { openDB } from './db.js';
import { ensureBootstrapAdmin, getSession, clearSession, logout, can, checkBootstrapSession } from './auth.js';
import { renderAuth, setAuthMode } from './ui-auth.js';
import { firebase } from './firebase.js';
import { applyRole, getTheme, toggleTheme } from './theme.js';
import { bottomSheet, switchEl, skeleton, errorState } from './ui.js';
import { initShellGestures } from './gestures.js';
import { initInstallPrompt } from './install-prompt.js';
import { visibleNotifications, logActivity, settings, syncDueNotifications, ensureTxnIds, dedupeTxnIds, allMembers, allDeposits, allWithdrawals } from './store.js';
import { adminSetupWizard, forcePasswordChange } from './pages/account.js';

import { pageHome } from './pages/dashboard.js';
import { pageMembersHub } from './pages/members.js';
import { pageDepositsHub } from './pages/deposits.js';
import { pageTransactionsHub } from './pages/transactions.js';
import { pageStatements } from './pages/statements.js';
import { pageReports } from './pages/reports.js';
import { pageSettings } from './pages/settings.js';
import { pageMemberPanel } from './pages/member-panel.js';
import { pageAuthorization } from './pages/admin.js';
import { openNotifications } from './pages/misc.js';

/* Mobile-first navigation — grouped by domain, one home per feature. */
const NAV = [
  { id: 'home', bn: 'হোম', en: 'Home', icon: 'home', slots: ['staff', 'member'] },
  { id: 'members', bn: 'সদস্য', en: 'Members', icon: 'members', slots: ['staff'] },
  { id: 'deposits', bn: 'জমা', en: 'Deposits', icon: 'deposit', slots: ['staff', 'member'] },
  { id: 'transactions', bn: 'লেনদেন', en: 'Txns', icon: 'receipt', slots: ['member'] },
  { id: 'statements', bn: 'স্টেটমেন্ট', en: 'Statement', icon: 'report', slots: [] },
  { id: 'reports', bn: 'রিপোর্ট', en: 'Reports', icon: 'chart', slots: [] },
  { id: 'authorization', bn: 'অনুমোদন', en: 'Approvals', icon: 'approve', slots: ['staff'] },
  { id: 'settings', bn: 'সেটিংস', en: 'Settings', icon: 'settings', slots: [] },
  { id: 'member-panel', bn: 'প্রোফাইল', en: 'Profile', icon: 'member', slots: [] },
];

/* legacy route aliases (old bookmarks / notification links) */
const ALIAS = { 'deposit': 'deposits', 'member-panel': 'member-panel' };

const PAGES = {
  'home': pageHome,
  'members': pageMembersHub,
  'deposits': pageDepositsHub,
  'transactions': pageTransactionsHub,
  'statements': pageStatements,
  'reports': pageReports,
  'settings': pageSettings,
  'member-panel': pageMemberPanel,
  'authorization': pageAuthorization,
};

/* "#route/section" — every hub sub-page is deep-linkable and back-navigable. */
export function parseHash(h) {
  let raw = String(h || '').replace(/^#/, '');
  if (!raw) return { route: 'home', section: '' };
  const [route, section = ''] = raw.split('/');
  return { route: ALIAS[route] || route, section };
}
export function hashFor(route, params = {}) {
  const sec = params.section || params.tab || '';
  return `#${route}${sec ? '/' + sec : ''}`;
}

/** Extra params that survive a refresh inside the hash (e.g. memberDocId). */
const sessionParams = {};

export const App = {
  session: null,
  route: 'home',
  section: '',
  unread: 0,
  navDepth: 0,
  async go(route, params = {}) {
    const s = this.session;
    if (!s) { this.showAuth(); return; }
    route = ALIAS[route] || route;
    if (!PAGES[route]) { route = 'home'; params = {}; }
    if (!can(s, route)) {
      toast(t('এই মডিউলে প্রবেশাধিকার নেই', 'You do not have access to this module'), 'error');
      route = 'home'; params = {};
    }
    /* remember memberDocId-style params for refresh/section switches */
    for (const k of Object.keys(params)) if (k !== 'section' && k !== 'tab') sessionParams[`${route}.${k}`] = params[k];
    const merged = { ...params };
    for (const k of Object.keys(sessionParams)) {
      if (k.startsWith(route + '.') && merged[k.slice(route.length + 1)] === undefined) merged[k.slice(route.length + 1)] = sessionParams[k];
    }
    const target = hashFor(route, merged);
    const pushing = location.hash !== target;
    if (pushing) { this.navDepth++; location.hash = target; }
    await this.render(route, merged);
  },
  async render(route, params = {}) {
    this.route = route;
    const { section } = parseHash(hashFor(route, params));
    this.section = section;
    resetIdleTimer();
    const view = $('#view');
    clear(view);
    view.appendChild(skeleton({ rows: 3, cards: 4 }));
    try {
      const node = await PAGES[route](this.session, params);
      clear(view);
      view.appendChild(node);
      view.scrollTop = 0; window.scrollTo(0, 0);
    } catch (e) {
      console.error(e);
      clear(view);
      view.appendChild(errorState({
        title: t('এই পেজটি লোড করা যায়নি', 'This page could not be loaded'),
        hint: e && e.message ? e.message : '',
        onRetry: () => this.render(route, params),
      }));
    }
    this.paintNav();
    this.paintFooter();
    this.paintBack();
  },
  refresh() {
    const params = { section: this.section || '' };
    for (const k of Object.keys(sessionParams)) {
      if (k.startsWith(this.route + '.')) params[k.slice(this.route.length + 1)] = sessionParams[k];
    }
    return this.render(this.route, params);
  },
  /** In-app back: browser history first (covers More→page, Android back,
   *  refresh), fall back to the section's hub, then home. Never a blank page. */
  back() {
    if (this.navDepth > 0 && history.length > 1) { this.navDepth--; history.back(); return; }
    const hubFor = { deposits: 'deposits', transactions: 'transactions', settings: 'settings', members: 'members', reports: 'reports', statements: 'statements' };
    if (this.section && hubFor[this.route]) { this.go(this.route, {}); return; }
    this.go('home');
  },
  applyBrand(cfg) {
    const src = logoSrc(cfg);
    document.querySelectorAll('#brandLogo img, .js-org-logo').forEach(img => { img.src = src; });
    const link = document.querySelector('link[rel="icon"]');
    if (link && src && !String(src).startsWith('data:')) link.href = src;
  },
  async paintFooter() {
    const elx = $('#appFooterOrg');
    if (!elx) return;
    try {
      const cfg = await settings();
      this.applyBrand(cfg);
      const bn = (cfg.orgNameBn || '').trim();
      const en = (cfg.orgNameEn || '').trim();
      const extra = [cfg.orgAddress, cfg.orgPhone].filter(Boolean).join(' · ');
      elx.innerHTML = `<img class="foot-logo js-org-logo" src="${esc(logoSrc(cfg))}" alt="">`
        + `<strong>${esc(bn || 'ধ্রুব সংসদ')}</strong>`
        + (en ? `<span class="app-footer-en">${esc(en)}</span>` : '')
        + (extra ? `<span class="app-footer-meta">${esc(extra)}</span>` : '')
        + `<span class="app-footer-meta">v${esc(APP_VERSION)}</span>`;
    } catch {
      elx.textContent = 'ধ্রুব সংসদ';
    }
  },

  labelOf(item) {
    const s = this.session;
    const isStaff = !s || s.role !== 'member';
    return t(
      (isStaff && item.bnStaff) ? item.bnStaff : item.bn,
      (isStaff && item.enStaff) ? item.enStaff : item.en,
    );
  },

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

  moreButton(where) {
    const b = el('button', {
      class: 'nav-tab nav-more', type: 'button', dataset: { route: 'more' },
      title: t('আরও', 'More'),
      html: `${icon('menu')}<span>${esc(t('আরও', 'More'))}</span>`,
      onclick: () => this.openMore(),
    });
    if (where === 'rail') b.classList.add('rail-tab');
    return b;
  },

  paintNav() {
    const s = this.session; if (!s) return;
    const bottom = $('#bottomnav');
    const rail = $('#rail');
    const group = s.role === 'member' ? 'member' : 'staff';

    /* bottom bar: 4 primary destinations + “More” (secondary items live there) */
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
      rail.appendChild(el('div', { class: 'rail-logo', html: icon('home') }));
      NAV.filter(i => can(s, i.id)).forEach(i => rail.appendChild(this.navButton(i, 'rail')));
      rail.appendChild(this.moreButton('rail'));
    }

    this.paintApprovalBadge();
  },

  /** Top bar: Back only when there is somewhere to go. No shortcut clutter. */
  paintBack() {
    const btn = $('#btnBack');
    if (!btn) return;
    const showBack = this.route !== 'home' || !!this.section;
    btn.hidden = !showBack;
    btn.innerHTML = icon('back');
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
    if (!btn) return;
    btn.innerHTML = icon('bell');
    if (this.unread > 0) btn.appendChild(el('span', { class: 'badge', text: this.unread > 99 ? '99+' : String(this.unread) }));
  },

  /** “More” sheet — secondary destinations & preferences only.
   *  Activity Log and Change Password are reached THROUGH Settings, never
   *  listed as separate shortcuts. */
  openMore() {
    const s = this.session; if (!s) return;
    const isStaff = s.role !== 'member';
    const group = isStaff ? 'staff' : 'member';
    const leftovers = NAV.filter(i => can(s, i.id) && !(i.slots || []).includes(group));
    const items = [];
    const themeRow = {
      ic: getTheme() === 'amoled' ? 'sun' : 'moon', label: t('ডার্ক মোড', 'Dark mode'),
      keepOpen: true, right: switchEl(getTheme() === 'amoled', () => { toggleTheme(); this.refresh(); }),
    };

    items.push({ header: t('মেনু', 'Menu') });
    leftovers.forEach(i => items.push({ ic: i.icon, label: this.labelOf(i), run: () => this.go(i.id) }));
    items.push('sep');
    items.push({ header: t('পছন্দ', 'Preferences') });
    items.push(themeRow);
    items.push({ ic: 'globe', label: t('ভাষা: ' + (getLang() === 'en' ? 'English' : 'বাংলা'), 'Language: ' + (getLang() === 'en' ? 'English' : 'Bangla')), keepOpen: true, right: switchEl(getLang() === 'en', () => setLang(getLang() === 'en' ? 'bn' : 'en')) });
    items.push('sep');
    items.push({ ic: 'logout', label: t('লগআউট', 'Logout'), danger: true, run: () => this.doLogout() });
    return bottomSheet({ title: t('আরও', 'More'), items });
  },

  showAuth() {
    $('#app').classList.remove('on');
    $('#app').setAttribute('aria-hidden', 'true');
    clear($('#view'));
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
    const { route, section } = parseHash(location.hash);
    if (PAGES[route] && can(this.session, route)) {
      const params = { section };
      for (const k of Object.keys(sessionParams)) {
        if (k.startsWith(route + '.')) params[k.slice(route.length + 1)] = sessionParams[k];
      }
      await this.render(route, params);
    } else {
      await this.go('home');
    }
  },

  async doLogout() {
    if (!(await confirmBox(t('আপনি কি লগআউট করতে চান?', 'Do you want to log out?'), { title: t('লগআউট', 'Logout'), okLabel: t('লগআউট', 'Logout') }))) return;
    await logout();
    this.session = null; window.DS_SESSION = null;
    applyRole('');
    clearIdleTimer();
    setAuthMode('login');
    history.replaceState(null, '', location.pathname + location.search);
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
  bar.classList.add(st === 'sync-error' ? 'sync-error' : `sync-${st}`);
  document.documentElement.dataset.sync = st;
}
window.addEventListener('ds:sync-status', e => paintSync(e.detail.status));

/* ---------------- keyboard shortcuts (desktop convenience) ---------------- */
const GO_KEYS = {
  h: 'home', m: 'members', d: 'deposits', a: 'authorization',
  t: 'transactions', s: 'settings', r: 'reports', x: 'statements',
};
const SHORTCUTS = [
  ['g h', t('হোম', 'Home')], ['g m', t('সদস্য', 'Members')], ['g d', t('জমা', 'Deposits')],
  ['g t', t('লেনদেন', 'Transactions')], ['g x', t('স্টেটমেন্ট', 'Statements')], ['g r', t('রিপোর্ট', 'Reports')],
  ['g a', t('অনুমোদন', 'Approvals')], ['g s', t('সেটিংস', 'Settings')],
  ['/', t('অনুসন্ধান ফিল্ডে যান', 'Focus the search field')],
  ['?', t('এই সাহায্য', 'This help')], ['Esc', t('শিট/মোডাল বন্ধ', 'Close sheet or dialog')], ['Backspace', t('ফিরে যান', 'Back')],
];

export function shortcutSheet() {
  bottomSheet({
    title: t('কীবোর্ড শর্টকাট', 'Keyboard shortcuts'),
    items: SHORTCUTS.map(([k, label]) => ({ label: `${k} — ${label}`, ic: 'key', keepOpen: true })),
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
    const back = document.querySelector('.sheet-backdrop') || document.querySelector('.rpv');
    if (back) { back.click(); e.preventDefault(); return; }
    App.back(); e.preventDefault();
    return;
  }
  if (k === 'Backspace') { App.back(); e.preventDefault(); return; }
  if (k === '?') { shortcutSheet(); return; }
  if (k === '/') {
    const box = document.querySelector('.main input[type="search"]')
      || [...document.querySelectorAll('.main input')].find(i => /search|খুঁজ/i.test(i.placeholder || ''));
    if (box) { e.preventDefault(); box.focus(); box.select?.(); }
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
  history.replaceState(null, '', location.pathname + location.search);
  App.showAuth();
  alertBox('Your session expired due to 30 minutes of inactivity. Please log in again.', 'সেশন মেয়াদ শেষ / Session Expired');
}

/* ---------------- boot ---------------- */
async function boot() {
  if (window.__DS_BOOTED) return;
  window.__DS_BOOTED = true;

  try {
    await Promise.race([
      openDB(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('IndexedDB timeout')), 8000)),
    ]);
    await ensureBootstrapAdmin();
    /* safe additive migration: unique transaction ids for legacy records.
       It NEVER deletes or rewrites anything that already has an id. */
    await ensureTxnIds().catch(() => {});
    await dedupeTxnIds().catch(() => {});
  } catch (e) {
    console.error('boot db', e);
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

  try { initShellGestures({ onRefresh: () => App.refresh() }); } catch (e) { console.error('gestures', e); }

  /* clean top bar: [Back] — title — [Bell] */
  const backBtn = $('#btnBack');
  if (backBtn) backBtn.onclick = () => App.back();
  const notifBtn = $('#btnNotif');
  if (notifBtn) { notifBtn.innerHTML = icon('bell'); notifBtn.onclick = () => { if (App.session) openNotifications(App.session); }; }

  ['mousemove', 'mousedown', 'keydown', 'touchstart', 'touchmove', 'scroll', 'click', 'wheel']
    .forEach(ev => window.addEventListener(ev, resetIdleTimer, { passive: true, capture: true }));

  window.addEventListener('ds:data-changed', e => {
    const st = e.detail && e.detail.store;
    if (st === 'notifications' || st === '*') App.refreshNotifBadge();
    if (st === 'deposits' || st === 'withdrawals' || st === '*') App.paintApprovalBadge();
    if (e.detail && e.detail.remote && App.session) {
      clearTimeout(window.__dsRefresh);
      window.__dsRefresh = setTimeout(() => App.refresh(), 400);
    }
  });

  /* Browser/Android back: hashchange drives the router; never a blank page. */
  window.addEventListener('hashchange', () => {
    if (!App.session) return;
    const { route, section } = parseHash(location.hash);
    if (!route) return;
    const next = PAGES[route] && can(App.session, route) ? route : 'home';
    if (next === App.route && (section || '') === (App.section || '')) return;   // already there
    const params = { section };
    for (const k of Object.keys(sessionParams)) {
      if (k.startsWith(next + '.')) params[k.slice(next.length + 1)] = sessionParams[k];
    }
    App.render(next, params);
  });
  window.addEventListener('popstate', () => {
    if (App.navDepth > 0) App.navDepth = Math.max(0, App.navDepth - 1);
  });

  initInstallPrompt();

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
    const tx = document.querySelector('#authScreen .auth-title');
    if (tx) tx.textContent = 'লোড সমস্যা: ' + (e.message || e);
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister())).catch(() => {});
    caches.keys().then(ks => Promise.all(ks.map(k => caches.delete(k)))).catch(() => {});
  }
}
boot();
