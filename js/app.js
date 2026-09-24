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
import { visibleNotifications, invalidate, logActivity, settings, syncDueNotifications, allMembers, allDeposits, allWithdrawals } from './store.js';
import { adminSetupWizard, forcePasswordChange } from './pages/account.js';

import { pageHome } from './pages/dashboard.js';
import { pageMembersHub } from './pages/members.js';
import { pageDepositsHub } from './pages/deposits.js';
import { pageAuthorization, pageSettings, pageMemberPanel } from './pages/admin.js';
import { pageReports } from './pages/reports.js';
import { openNotifications } from './pages/misc.js';

const NAV = [
  { id: 'home', bn: 'ড্যাশবোর্ড', en: 'Dashboard', icon: 'dashboard' },
  { id: 'members', bn: 'সদস্য ব্যবস্থাপনা', en: 'Member Management', icon: 'members' },
  { id: 'deposit', bn: 'জমা / লেনদেন', en: 'Deposits', icon: 'money' },
  { id: 'authorization', bn: 'অনুমোদন', en: 'Approvals', icon: 'approve' },
  { id: 'reports', bn: 'রিপোর্ট', en: 'Reports', icon: 'report' },
  /* Staff see this as the admin hub; members keep the plain “Settings” label. */
  { id: 'settings', bn: 'সেটিংস', en: 'Settings', icon: 'settings', bnStaff: 'অ্যাডমিন', enStaff: 'Admin' },
];

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
    view.appendChild(el('div', { class: 'empty', html: t('লোড হচ্ছে…', 'Loading…') }));
    try {
      const node = await PAGES[route](s, params);
      clear(view);
      view.appendChild(node);
      view.scrollTop = 0; window.scrollTo(0, 0);
    } catch (e) {
      console.error(e);
      clear(view);
      view.appendChild(el('div', { class: 'banner err', html: `${icon('warn')}<span>${esc(e.message || 'Error')}</span>` }));
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

  paintNav() {
    const s = this.session; if (!s) return;
    const nav = $('#topnav');
    const bottom = $('#bottomnav');
    clear(nav);
    if (bottom) { clear(bottom); bottom.hidden = s.role !== 'member'; }
    const items = s.role === 'member'
      ? NAV.filter(i => i.id === 'home' || i.id === 'deposit' || i.id === 'reports')
      : NAV;
    const host = (s.role === 'member' && bottom) ? bottom : nav;
    if (!host) return;
    for (const item of items) {
      if (!can(s, item.id)) continue;
      const isStaff = s.role !== 'member';
      const label = t(
        (isStaff && item.bnStaff) ? item.bnStaff : item.bn,
        (isStaff && item.enStaff) ? item.enStaff : item.en,
      );
      const btn = el('button', {
        class: `nav-tab${this.route === item.id ? ' on' : ''}`, type: 'button',
        title: label, dataset: { route: item.id },
        html: `${icon(item.icon)}<span>${label}</span>`,
        onclick: () => this.go(item.id),
      });
      host.appendChild(btn);
    }
    this.paintApprovalBadge();
    const setBtn = $('#btnSettings');
    if (setBtn) setBtn.hidden = s.role !== 'member';
    const userName = s.displayName || s.username || s.memberId || '';
    const brand = $('#brandRole');
    brand.innerHTML = `<span class="brand-name">${esc(userName)}</span><span class="brand-role-tag">${esc((s.role || '').toUpperCase())}</span>`;
  },

  /** Red pill on the Approvals tab: how many requests are waiting. */
  async paintApprovalBadge() {
    const s = this.session;
    if (!s || (!can(s, 'member:approve') && !can(s, 'deposit:approve'))) return;
    try {
      const [members, deposits, withdrawals] = await Promise.all([allMembers(), allDeposits(), allWithdrawals()]);
      const n = members.filter(m => m.status === 'pending').length
        + deposits.filter(d => d.status === 'pending').length
        + withdrawals.filter(w => w.status === 'pending').length;
      const tab = document.querySelector('#topnav .nav-tab[data-route="authorization"]');
      if (!tab) return;
      tab.querySelector('.pill')?.remove();
      if (n > 0) tab.appendChild(el('span', { class: 'pill', text: n > 99 ? '99+' : String(n) }));
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

/* ---------------- topbar sync border (no text chip) ---------------- */
function paintSync(status) {
  const bar = document.querySelector('.topbar');
  if (!bar) return;
  const st = status || (navigator.onLine ? 'online' : 'offline');
  bar.classList.remove('sync-online', 'sync-offline', 'sync-syncing', 'sync-synced', 'sync-error');
  const cls = st === 'sync-error' ? 'sync-error' : `sync-${st}`;
  bar.classList.add(cls);
  document.documentElement.dataset.sync = st;
}
window.addEventListener('ds:sync-status', e => paintSync(e.detail.status));

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
