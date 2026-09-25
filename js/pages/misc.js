/* Notifications (top-right bell) + Activity Log (Settings only). */
import {
  el, esc, fmtDate, fmtTime, todayISO, debounce, t,
} from '../util.js';
import { icon } from '../icons.js';
import { page, card, btn, filterSheet, emptyState } from '../ui.js';
import { allLogs, logUserName } from '../store.js';

/* Activity Log (Settings → Activity Log).
   The notification centre lives in its own module (pages/notifications.js) —
   it is NOT duplicated here: one feature, one implementation. */

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
const bnD = n => String(n);

/** Short Bengali description per action for the member's own log. */
const MEMBER_LOG_DETAIL = {
  LOGIN: () => 'Signed in',
  LOGOUT: () => 'Signed out',
  PASSWORD_CHANGE: () => 'Password changed',
  PASSWORD_RECOVERY: () => 'Password recovered',
  REGISTRATION: () => 'Registration completed',
  DEPOSIT_SUBMISSION: () => 'Deposit submitted',
  WITHDRAWAL_SUBMISSION: () => 'Withdrawal request submitted',
  MEMBER_UPDATE: () => 'Profile updated',
  SESSION_TIMEOUT: () => 'Session expired (30 minutes inactive)',
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
    body.appendChild(el('div', { class: 'count-line', text: `${vis.length} / ${current.length}` }));
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
