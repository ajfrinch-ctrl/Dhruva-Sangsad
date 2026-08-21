/* Notifications (top-right icon popup) + Activity Log */
import {
  el, esc, toast, fmtDate, fmtTime, todayISO, debounce, modal,
} from '../util.js';
import { icon } from '../icons.js';
import { page, card, tableWrap, btn } from '../ui.js';
import { visibleNotifications, markNotificationRead, allLogs } from '../store.js';
import { downloadCSV, downloadExcel, safeName } from '../pdf.js';
import { App } from '../app.js';

const NOTIF_ICON = { register: 'register', deposit: 'deposit', approve: 'approve', reject: 'reject', info: 'bell', warn: 'warn' };

/* ==================== Notifications (popup from top-right bell) ==================== */
export async function openNotifications(session) {
  const items = await visibleNotifications(session);
  const isRead = n => !!(n.readBy && n.readBy[session.id]);

  const body = el('div');
  const head = el('div', { class: 'btn-row', style: 'margin-bottom:10px' });
  head.appendChild(btn('সব পঠিত চিহ্নিত করুন / Mark all read', 'check', 'soft', async () => {
    const unread = items.filter(n => !isRead(n));
    if (!unread.length) { toast('কোনো অপঠিত বিজ্ঞপ্তি নেই / Nothing unread', 'info'); return; }
    for (const n of unread) await markNotificationRead(n.id, session.id);
    toast(`${unread.length}টি বিজ্ঞপ্তি পঠিত চিহ্নিত হয়েছে`, 'success');
    App.refreshNotifBadge();
    body.replaceChildren();
    buildList();
  }, { size: 'xs' }));
  body.appendChild(head);

  function buildList() {
    if (!items.length) {
      body.appendChild(el('div', { class: 'empty', html: `${icon('bell')}কোনো বিজ্ঞপ্তি নেই / No notifications` }));
      return;
    }
    const list = el('div', { class: 'list' });
    items.forEach(n => {
      const read = isRead(n);
      const li = el('div', { class: 'li' + (read ? '' : ' unread') });
      li.innerHTML = `
        <div class="ic ${n.kind === 'reject' ? 'b' : 'a'}">${icon(NOTIF_ICON[n.kind] || 'bell')}</div>
        <div class="bd"><div class="t">${esc(n.title)}${read ? '' : ' <span class="tag pending">NEW</span>'}</div>
          <div class="s">${esc(n.body || '')}</div></div>
        <div class="w">${esc(fmtDate(n.createdAt))}<br>${esc(fmtTime(n.createdAt))}</div>`;
      if (!read) {
        li.style.cursor = 'pointer';
        li.title = 'পঠিত চিহ্নিত করতে ক্লিক করুন / Click to mark as read';
        li.addEventListener('click', async () => {
          await markNotificationRead(n.id, session.id);
          li.classList.remove('unread');
          li.querySelector('.tag.pending')?.remove();
          App.refreshNotifBadge();
        });
      }
      list.appendChild(li);
    });
    body.appendChild(list);
  }
  buildList();

  return modal({ title: 'বিজ্ঞপ্তি / Notifications', body, width: 540, actions: [{ label: 'Close', value: true, kind: 'primary' }] });
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

export async function pageActivity(session) {
  const logs = await allLogs();
  const wrap = page('কার্যক্রম লগ', 'Activity Log', 'log');

  const mine = session.role === 'admin' || session.role === 'maker'
    ? logs
    : logs.filter(l => l.userId === session.id);

  const PAGE_SIZE = 10;
  let currentPage = 0;

  const bar = el('div', { class: 'toolbar' });
  const searchBox = el('div', { class: 'search-box', html: icon('search') });
  const q = el('input', { placeholder: 'ব্যবহারকারী / কার্যক্রম / বিবরণ', autocomplete: 'off' });
  searchBox.appendChild(q);
  const mk = (label, node, w = '150px') => { const f = el('div', { class: 'field', style: `flex:0 1 ${w}` }); f.appendChild(el('label', { text: label })); f.appendChild(node); return f; };
  const actSel = el('select');
  actSel.appendChild(el('option', { value: '' }, ['সব কার্যক্রম / All actions']));
  Array.from(new Set(mine.map(l => l.action))).sort().forEach(a => actSel.appendChild(el('option', { value: a }, [`${actionMeta(a).bn} / ${a}`])));
  const roleSel = el('select');
  [['', 'সব রোল / All roles'], ['admin', 'Admin'], ['maker', 'Maker'], ['member', 'Member']].forEach(([v, l]) => roleSel.appendChild(el('option', { value: v }, [l])));

  // Default window: the most recent 7 days.
  const sevenDaysAgo = () => { const d = new Date(); d.setDate(d.getDate() - 6); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
  const from = el('input', { type: 'date', value: sevenDaysAgo() });
  const to = el('input', { type: 'date', value: todayISO() });

  bar.append(searchBox, mk('কার্যক্রম / Action', actSel, '180px'), mk('রোল / Role', roleSel, '130px'), mk('হইতে / From', from, '130px'), mk('পর্যন্ত / To', to, '130px'));
  bar.appendChild(btn('Clear', 'clear', 'ghost', () => { q.value = ''; actSel.value = ''; roleSel.value = ''; from.value = ''; to.value = ''; currentPage = 0; render(); }, { size: 'xs' }));
  wrap.appendChild(bar);

  const listCard = card('কার্যক্রম তালিকা', 'Activity Records', el('div'), [
    btn('Excel', 'excel', 'soft', () => doExport('xlsx'), { size: 'xs' }),
    btn('CSV', 'csv', 'ghost', () => doExport('csv'), { size: 'xs' }),
  ]);
  wrap.appendChild(listCard);

  let current = [];
  const doExport = kind => {
    if (!current.length) { toast('রপ্তানির জন্য কোনো তথ্য নেই / Nothing to export', 'warn'); return; }
    const rows = [['SL', 'Date', 'Time', 'User', 'Role', 'Action', 'Details']];
    current.forEach((l, i) => rows.push([i + 1, fmtDate(l.createdAt), fmtTime(l.createdAt), l.displayName || l.userId || '', l.role || '', l.action, l.details || '']));
    const fn = safeName(`Dhruvo_Sangsad_Activity_Log_${todayISO()}`);
    if (kind === 'csv') downloadCSV(rows, fn + '.csv');
    else downloadExcel([{ name: 'Activity Log', rows }], fn + '.xlsx');
    toast('রপ্তানি সম্পন্ন / Exported', 'success');
  };

  const render = () => {
    const t = q.value.trim().toLowerCase();
    current = mine.filter(l => {
      if (actSel.value && l.action !== actSel.value) return false;
      if (roleSel.value && l.role !== roleSel.value) return false;
      const d = String(l.createdAt).slice(0, 10);
      if (from.value && d < from.value) return false;
      if (to.value && d > to.value) return false;
      if (t && ![l.displayName, l.userId, l.action, l.details, l.role].some(x => String(x || '').toLowerCase().includes(t))) return false;
      return true;
    }).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

    const totalPages = Math.max(1, Math.ceil(current.length / PAGE_SIZE));
    if (currentPage > totalPages - 1) currentPage = totalPages - 1;
    if (currentPage < 0) currentPage = 0;
    const start = currentPage * PAGE_SIZE;
    const pageRows = current.slice(start, start + PAGE_SIZE);

    const body = listCard.body;
    body.replaceChildren();
    body.appendChild(el('div', { class: 'fs8 muted', style: 'margin-bottom:6px', text: `${current.length} record(s) — page ${currentPage + 1} of ${totalPages}` }));
    body.appendChild(tableWrap(
      [{ label: 'SL', cls: 'num' }, { label: 'তারিখ / Date' }, { label: 'সময় / Time' }, { label: 'ব্যবহারকারী / User' },
       { label: 'রোল / Role' }, { label: 'কার্যক্রম / Action' }, { label: 'বিবরণ / Details' }],
      pageRows.map((l, i) => [
        { text: String(start + i + 1), cls: 'num' },
        esc(fmtDate(l.createdAt)),
        esc(fmtTime(l.createdAt)),
        esc(l.displayName || l.userId || '—'),
        `<span class="tag ${l.role === 'admin' ? 'info' : l.role === 'maker' ? 'approved' : 'gray'}">${esc((l.role || '—').toUpperCase())}</span>`,
        `${icon(actionMeta(l.action).ic)} ${esc(actionMeta(l.action).bn)}<br><span class="faint fs8">${esc(l.action)}</span>`,
        esc(l.details || ''),
      ]),
      { empty: 'কোনো কার্যক্রম পাওয়া যায়নি / No activity found', emptyIcon: 'log' },
    ));

    // Pagination controls
    if (current.length > PAGE_SIZE) {
      const nav = el('div', { class: 'btn-row', style: 'margin-top:10px;align-items:center' });
      nav.appendChild(btn('পূর্ববর্তী / Previous', '', 'ghost', () => { if (currentPage > 0) { currentPage--; render(); } }, { size: 'xs', attrs: currentPage <= 0 ? { disabled: true } : {} }));
      nav.appendChild(el('span', { class: 'fs8 muted', text: `Page ${currentPage + 1} / ${totalPages}` }));
      nav.appendChild(btn('পরবর্তী / Next', '', 'ghost', () => { if (currentPage < totalPages - 1) { currentPage++; render(); } }, { size: 'xs', attrs: currentPage >= totalPages - 1 ? { disabled: true } : {} }));
      body.appendChild(nav);
    }
  };

  const onFilterChange = () => { currentPage = 0; render(); };
  q.addEventListener('input', debounce(onFilterChange, 180));
  [actSel, roleSel, from, to].forEach(x => x.addEventListener('change', onFilterChange));
  render();
  return wrap;
}
