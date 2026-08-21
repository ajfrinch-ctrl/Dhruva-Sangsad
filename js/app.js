/* ধ্রুব সংসদ — application shell, router, role-based navigation guard, idle timeout */
import { $, el, clear, toast, esc, alertBox, confirmBox } from './util.js';
import { icon } from './icons.js';
import { openDB } from './db.js';
import { ensureBootstrapAdmin, getSession, clearSession, logout, can, PERMISSIONS } from './auth.js';
import { renderAuth, setAuthMode } from './ui-auth.js';
import { firebase } from './firebase.js';
import { visibleNotifications, invalidate, logActivity } from './store.js';
import { adminSetupWizard, forcePasswordChange } from './pages/account.js';

import { pageHome } from './pages/dashboard.js';
import { pageMembersHub } from './pages/members.js';
import { pageDepositsHub } from './pages/deposits.js';
import { pageAuthorization, pageSettings, pageMemberPanel } from './pages/admin.js';
import { pageReports } from './pages/reports.js';
import { openNotifications } from './pages/misc.js';

const NAV = [
  { id: 'home', bn: 'ড্যাশবোর্ড', en: 'Dashboard', icon: 'dashboard' },
  { id: 'members', bn: 'সদস্য ব্যবস্থাপনা', en: 'Members', icon: 'members' },
  { id: 'deposit', bn: 'জমা / লেনদেন', en: 'Deposits', icon: 'money' },
  { id: 'authorization', bn: 'অনুমোদন অপেক্ষমাণ', en: 'Authorization Pending', icon: 'approve' },
  { id: 'reports', bn: 'রিপোর্ট', en: 'Reports', icon: 'report' },
  { id: 'settings', bn: 'সেটিংস', en: 'Settings', icon: 'settings' },
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
      toast('এই মডিউলে প্রবেশাধিকার নেই / You do not have access to this module', 'error');
      route = 'home';
    }
    this.route = route;
    this.params = params;
    location.hash = '#' + route;
    resetIdleTimer();
    const view = $('#view');
    clear(view);
    view.appendChild(el('div', { class: 'empty', html: 'লোড হচ্ছে… / Loading…' }));
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
  },
  refresh() { return this.go(this.route, this.params || {}); },

  paintNav() {
    const s = this.session; if (!s) return;
    const nav = $('#topnav');
    clear(nav);
    for (const item of NAV) {
      if (!can(s, item.id)) continue;
      const btn = el('button', {
        class: `nav-tab${this.route === item.id ? ' on' : ''}`, type: 'button',
        title: `${item.bn} — ${item.en}`,
        html: `${icon(item.icon)}<span>${item.bn}</span>`,
        onclick: () => this.go(item.id),
      });
      nav.appendChild(btn);
    }
    $('#brandRole').textContent = `${s.displayName} · ${s.role.toUpperCase()}`;
  },

  async refreshNotifBadge() {
    const s = this.session; if (!s) return;
    const list = await visibleNotifications(s);
    this.unread = list.filter(n => !(n.readBy || {})[s.id]).length;
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
    $('#authScreen').classList.add('hidden');
    clear($('#authScreen'));
    $('#app').classList.add('on');
    $('#app').setAttribute('aria-hidden', 'false');
    resetIdleTimer();

    // first-time admin setup / forced password change gates
    if (session.role === 'admin' && (session.isBootstrap || session.profileComplete === false)) {
      const done = await adminSetupWizard(session);
      if (!done) { await logout(); this.session = null; this.showAuth(); return; }
      this.session = done;
    } else if (session.mustChangePassword) {
      const done = await forcePasswordChange(session);
      if (!done) { await logout(); this.session = null; this.showAuth(); return; }
      this.session = done;
    }
    await this.refreshNotifBadge();
    const hash = (location.hash || '').replace('#', '');
    await this.go(hash && PAGES[hash] && can(this.session, hash) ? hash : 'home');
  },

  async doLogout() {
    if (!(await confirmBox('আপনি কি লগআউট করতে চান? / Do you want to log out?', { title: 'লগআউট / Logout', okLabel: 'Logout' }))) return;
    await logout();
    this.session = null; window.DS_SESSION = null;
    clearIdleTimer();
    setAuthMode('login');
    location.hash = '';
    toast('লগআউট সম্পন্ন / Logged out', 'success');
    this.showAuth();
  },
};
window.App = App;

/* ---------------- sync status chip ---------------- */
const SYNC_LABEL = { online: 'Online', offline: 'Offline', syncing: 'Syncing…', synced: 'Synced', 'sync-error': 'Sync Error' };
function paintSync(status) {
  const chip = $('#syncChip'); if (!chip) return;
  chip.className = 'chip ' + status;
  const ic = status === 'offline' ? 'offline' : status === 'syncing' ? 'sync' : status === 'sync-error' ? 'warn' : 'online';
  chip.innerHTML = `${icon(ic)}<span>${SYNC_LABEL[status] || status}</span>`;
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
  await openDB();
  await ensureBootstrapAdmin();
  paintSync(navigator.onLine ? 'online' : 'offline');
  firebase.init();

  $('#btnLogout').innerHTML = icon('logout');
  $('#btnLogout').addEventListener('click', () => App.doLogout());
  $('#btnNotif').innerHTML = icon('bell');
  $('#btnNotif').addEventListener('click', () => { if (App.session) openNotifications(App.session); });

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
  window.addEventListener('online', () => toast('ইন্টারনেট সংযোগ ফিরে এসেছে — সিঙ্ক হচ্ছে / Back online — syncing', 'success'));
  window.addEventListener('offline', () => toast('অফলাইন মোড — ডেটা লোকালি সংরক্ষিত হবে / Offline mode — data is saved locally', 'warn'));

  const s = getSession();
  if (s) await App.enter(s); else App.showAuth();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}
boot();
