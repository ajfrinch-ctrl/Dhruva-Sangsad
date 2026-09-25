/* Notifications (top-right bell) + Activity Log (Settings only). */
import {
  el, esc, toast, fmtDate, fmtTime, todayISO, debounce, modal, t,
} from '../util.js';
import { icon } from '../icons.js';
import { page, card, btn, filterSheet, emptyState } from '../ui.js';
import { visibleNotifications, markNotificationRead, allLogs, logUserName } from '../store.js';
import { App } from '../app.js';

const NOTIF_ICON = { register: 'register', deposit: 'deposit', approve: 'approve', reject: 'reject', info: 'bell', warn: 'warn', due: 'due' };

/* ==================== Notifications (popup from top-right bell) ==================== */
export async function openNotifications(session) {
  const items = await visibleNotifications(session);
  const isRead = n => !!(n.readBy && n.readBy[session.id]);

  const body = el('div');
  const head = el('div', { class: 'btn-row', style: 'margin-bottom:10px' });
  head.appendChild(btn('সব পঠিত করুন', 'check', 'soft', async () => {
    const unread = items.filter(n => !isRead(n));
    if (!unread.length) { toast('কোনো অপঠিত বিজ্ঞপ্তি নেই', 'info'); return; }
    for (const n of unread) await markNotificationRead(n.id, session.id);
    toast(`${unread.length}টি বিজ্ঞপ্তি পঠিত চিহ্নিত হয়েছে`, 'success');
    App.refreshNotifBadge();
    body.replaceChildren();
    buildList();
  }, { size: 'xs' }));
  body.appendChild(head);

  function buildList() {
    if (!items.length) {
      body.appendChild(el('div', { class: 'empty', html: `${icon('bell')}এখনো কোনো বিজ্ঞপ্তি নেই` }));
      return;
    }
    const list = el('div', { class: 'list' });
    items.forEach(n => {
      const sticky = !!(n.sticky || n.kind === 'due');
      const read = !sticky && isRead(n);
      const li = el('div', { class: 'li' + (read ? '' : ' unread') + (n.kind === 'due' ? ' wa-msg' : '') });
      li.innerHTML = `
        <div class="ic ${n.kind === 'due' ? 'r' : n.kind === 'reject' ? 'b' : 'a'}">${icon(NOTIF_ICON[n.kind] || 'bell')}</div>
        <div class="bd"><div class="t">${esc(n.title)}${read || sticky ? (sticky ? ' <span class="tag due">বকেয়া</span>' : '') : ' <span class="tag pending">নতুন</span>'}</div>
          <div class="s">${esc(n.body || '')}</div>
          ${n.action === 'deposit' ? '<div class="s" style="margin-top:6px"><span class="tag info">এখনই জমা দিন →</span></div>' : ''}</div>
        <div class="w">${esc(fmtDate(n.createdAt))}<br>${esc(fmtTime(n.createdAt))}</div>`;
      li.style.cursor = 'pointer';
      li.title = t('ট্যাপ করে পঠিত চিহ্নিত করুন', 'Tap to mark read');
      li.addEventListener('click', async () => {
        if (!sticky && !read) {
          await markNotificationRead(n.id, session.id);
          li.classList.remove('unread');
          li.querySelector('.tag.pending')?.remove();
          App.refreshNotifBadge();
        }
        if (n.action === 'deposit') {
          document.querySelector('.modal-back')?.remove();
          App.go('deposits', { section: 'entry' });
        }
      });
      list.appendChild(li);
    });
    body.appendChild(list);
  }
  buildList();

  return modal({ title: t('বিজ্ঞপ্তি', 'Notifications'), body, width: 540, actions: [{ label: t('বন্ধ করুন', 'Close'), value: true, kind: 'primary' }] });
}

/* ==================== Activity Log ==================== */
const ACTION_META = {
  REGISTRATION: { ic: 'register', bn: 'নিবন্ধন' },
  MEMBER_UPDATE: { ic: 'edit', bn: 'সদস্য হালনাগাদ' },
  MEMBER_APPROVAL: { ic: 'approve', bn: 'সদস্য অনুমোদন' },
  MEMBER_REJECTION: { ic: 'reject', bn: 'সদস্য বাতিল' },
  MEMBER_STATUS: { ic: 'member', bn: 'সদস্য স্ট্যাটাস' },
  DEPOSIT_SUBMISSION: { ic: 'deposit', bn: 'জমা দাখিল' },
  DEPOSIT_APPROVAL: { ic: 'approve', bn: 'জমা অনুমোদন' },
  DEPOSIT_REJECTION: { ic: 'reject', bn: 'জমা বাতিল' },
  DEPOSIT_EDIT: { ic: 'edit', bn: 'জমা সম্পাদনা' },
  DEPOSIT_DELETE: { ic: 'trash', bn: 'জমা মুছে ফেলা' },
  WITHDRAWAL_SUBMISSION: { ic: 'withdraw', bn: 'উত্তোলন দাখিল' },
  WITHDRAWAL_APPROVAL: { ic: 'approve', bn: 'উত্তোলন অনুমোদন' },
  WITHDRAWAL_REJECTION: { ic: 'reject', bn: 'উত্তোলন বাতিল' },
  STAFF_CREATE: { ic: 'maker', bn: 'স্টাফ তৈরি' },
  STAFF_STATUS: { ic: 'maker', bn: 'স্টাফ স্ট্যাটাস' },
  STAFF_DELETE: { ic: 'trash', bn: 'স্টাফ মুছে ফেলা' },
  PASSWORD_RESET: { ic: 'key', bn: 'পাসওয়ার্ড রিসেট' },
  PASSWORD_CHANGE: { ic: 'lock', bn: 'পাসওয়ার্ড পরিবর্তন' },
  PASSWORD_RECOVERY: { ic: 'key', bn: 'পাসওয়ার্ড পুনরুদ্ধার' },
  ADMIN_SETUP: { ic: 'admin', bn: 'অ্যাডমিন সেটআপ' },
  LOGIN: { ic: 'login', bn: 'লগইন' },
  LOGOUT: { ic: 'logout', bn: 'লগআউট' },
  BACKUP: { ic: 'backup', bn: 'ব্যাকআপ' },
  RESTORE: { ic: 'restore', bn: 'রিস্টোর' },
  SETTINGS_UPDATE: { ic: 'settings', bn: 'সেটিংস হালনাগাদ' },
};
export const actionMeta = a => ACTION_META[a] || { ic: 'log', bn: a };

/* One compact timeline row (shared with the dashboard recent-activity card).
   opts.member = true renders the member's own view: Bengali action + a short
   Bengali description (no raw English details, no user name — it's always them). */
const bnD = n => String(n).replace(/\d/g, d => '০১২৩৪৫৬৭৮৯'[Number(d)]);

/** Short Bengali description per action for the member's own log. */
const MEMBER_LOG_DETAIL = {
  LOGIN: () => 'লগইন করেছেন',
  LOGOUT: () => 'লগআউট করেছেন',
  PASSWORD_CHANGE: () => 'পাসওয়ার্ড পরিবর্তন করেছেন',
  PASSWORD_RECOVERY: () => 'পাসওয়ার্ড পুনরুদ্ধার করেছেন',
  REGISTRATION: () => 'নিবন্ধন সম্পন্ন',
  DEPOSIT_SUBMISSION: () => 'জমা দাখিল করেছেন',
  WITHDRAWAL_SUBMISSION: () => 'উত্তোলনের আবেদন দাখিল করেছেন',
  MEMBER_UPDATE: () => 'প্রোফাইল হালনাগাদ',
  SESSION_TIMEOUT: () => 'সেশন মেয়াদ শেষ (৩০ মিনিট নিষ্ক্রিয়)',
};
const logDetailBn = l => {
  const fn = MEMBER_LOG_DETAIL[l && l.action];
  return fn ? fn(l) : (l && l.details) || t('আপনার কার্যক্রম', 'Your activity');
};

export function actRow(l, opts = {}) {
  const meta = actionMeta(l.action);
  const sub = opts.member
    ? esc(logDetailBn(l))
    : esc(logUserName(l)) + (l.details ? ' · ' + esc(l.details) : '');
  const row = el('div', { class: 'act' });
  row.innerHTML = `<span class="ai">${icon(meta.ic)}</span>
    <span class="ab"><span class="at">${esc(meta.bn)}</span>
      <span class="as">${sub}</span></span>
    <span class="aw">${esc(fmtDate(l.createdAt))}<br>${esc(fmtTime(l.createdAt))}</span>`;
  return row;
}

export async function pageActivity(session) {
  const logs = await allLogs();
  const isMember = session.role === 'member';
  const wrap = page('কার্যক্রম লগ', 'Activity Log', 'log');

  const mine = session.role === 'admin' || session.role === 'maker'
    ? logs
    : logs.filter(l => l.userId === session.id);

  const PAGE_SIZE = 10;

  // Default window: the most recent 7 days (same as before the sheet).
  const sevenDaysAgo = () => { const d = new Date(); d.setDate(d.getDate() - 6); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
  let act = '', role = '', from = isMember ? '' : sevenDaysAgo(), to = isMember ? '' : todayISO();

  let current = [];
  let shown = PAGE_SIZE;
  const resetShown = () => { shown = PAGE_SIZE; };

  /* One clean list — no download buttons (activity log is a viewer). */
  const listCard = card('কার্যক্রম তালিকা', 'Activity Records', el('div'));

  let qEl = null;
  if (!isMember) {
    const head = el('div', { class: 'txn-head' });
    const searchBox = el('div', { class: 'search-box', html: icon('search') });
    qEl = el('input', {
      placeholder: t('ব্যবহারকারী / কার্যক্রম / বিবরণ…', 'User / action / details…'),
      autocomplete: 'off', 'aria-label': t('লগ খুঁজুন', 'Search log'),
    });
    searchBox.appendChild(qEl);
    const filterBtn = el('button', { type: 'button', class: 'btn btn-ghost filter-btn', 'aria-label': t('ফিল্টার', 'Filter') });
    const paintBadge = () => {
      const n = [act, role, from, to].filter(Boolean).length;
      filterBtn.innerHTML = `${icon('filter')}<span>${esc(t('ফিল্টার', 'Filter'))}</span>${n ? `<span class="fbadge">${n}</span>` : ''}`;
    };
    paintBadge();
    const actOpts = [{ value: '', bn: 'সব', en: 'All' },
      ...Array.from(new Set(mine.map(l => l.action))).sort().map(a => ({ value: a, bn: actionMeta(a).bn, en: a }))];
    const roleOpts = [
      { value: '', bn: 'সব', en: 'All' }, { value: 'admin', bn: 'অ্যাডমিন', en: 'Admin' },
      { value: 'maker', bn: 'Maker', en: 'Maker' }, { value: 'member', bn: 'সদস্য', en: 'Member' },
    ];
    filterBtn.addEventListener('click', () => filterSheet({
      state: { act, role, from, to },
      sections: [
        { key: 'act', label: t('কার্যক্রম', 'Action'), options: actOpts },
        { key: 'role', label: t('রোল', 'Role'), options: roleOpts },
      ],
      dates: { fromLabel: t('শুরু', 'From'), toLabel: t('শেষ', 'To') },
      onApply: s => { ({ act, role, from, to } = s); paintBadge(); resetShown(); render(); },
      onClear: () => { act = role = from = to = ''; paintBadge(); resetShown(); render(); },
    }));
    head.append(searchBox, filterBtn);
    wrap.appendChild(head);
  }
  wrap.appendChild(listCard);

  const render = () => {
    const term = qEl ? qEl.value.trim().toLowerCase() : '';
    current = mine.filter(l => {
      if (act && l.action !== act) return false;
      if (role && l.role !== role) return false;
      const d = String(l.createdAt).slice(0, 10);
      if (from && d < from) return false;
      if (to && d > to) return false;
      if (term && ![logUserName(l), l.userId, l.action, l.details, l.role].some(x => String(x || '').toLowerCase().includes(term))) return false;
      return true;
    }).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

    const body = listCard.body;
    body.replaceChildren();
    if (!current.length) {
      body.appendChild(emptyState({ ic: 'log', title: t('কোনো কার্যক্রম পাওয়া যায়নি', 'No activity found'), compact: true }));
      return;
    }
    const vis = current.slice(0, shown);
    body.appendChild(el('div', { class: 'count-line', text: `${vis.length} / ${current.length}টি` }));
    const tl = el('div', { class: 'act-list' });
    vis.forEach(l => tl.appendChild(actRow(l, { member: isMember })));
    body.appendChild(tl);
    if (current.length > shown) {
      const more = el('button', {
        type: 'button', class: 'btn btn-ghost btn-block',
        text: `${t('আরও দেখুন', 'Show more')} (${current.length - shown}টি বাকি)`,
      });
      more.addEventListener('click', () => { shown += PAGE_SIZE; render(); });
      const mrow = el('div', { style: 'margin-top:10px' });
      mrow.appendChild(more);
      body.appendChild(mrow);
    }
  };

  if (qEl) qEl.addEventListener('input', debounce(() => { resetShown(); render(); }, 180));
  render();
  return wrap;
}
