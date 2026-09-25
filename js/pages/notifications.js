/* Notification centre — opened from the top-bar bell.
 *
 * ONE implementation (the old misc.js version is retired with it). app.js loads
 * this module lazily, so it can never delay the first paint.
 *
 * Rules:
 *   · only the LATEST 10 UNREAD notifications are listed (store.unreadNotifications);
 *   · a notification that has been read disappears from the list at once — it
 *     is never shown again;
 *   · sticky/due notices stay until the underlying thing is fixed — they
 *     cannot be dismissed by tapping.
 */
import { el, esc, auto, fmtDate, fmtTime, toast, t } from '../util.js';
import { icon } from '../icons.js';
import { bottomSheet, btn, emptyState } from '../ui.js';
import { unreadNotifications, markNotificationRead, isStickyNotification } from '../store.js';
import { App } from '../app.js';

const ICON = {
  register: 'register', deposit: 'deposit', approve: 'approve', reject: 'reject',
  due: 'due', warn: 'warn', withdraw: 'withdraw', info: 'bell',
};
const TONE = {
  register: 'b', deposit: 'g', approve: 'g', reject: 'r', due: 'r', warn: 'a', withdraw: 'r', info: 'b',
};

export async function openNotifications(session) {
  let items = await unreadNotifications(session);

  const body = el('div', { class: 'notif-body' });
  const sheet = bottomSheet({ title: t('বিজ্ঞপ্তি', 'Notifications'), body });

  /* Reading removes the item from the list immediately (no second visit). */
  const drop = n => { items = items.filter(x => x.id !== n.id); };

  const markAll = async () => {
    const unread = items.filter(n => !isStickyNotification(n));
    if (!unread.length) { toast(t('কোনো অপঠিত বিজ্ঞপ্তি নেই', 'Nothing unread'), 'info'); return; }
    for (const n of unread) {
      await markNotificationRead(n.id, session.id);
      drop(n);
    }
    App.refreshNotifBadge();
    toast(t('সব বিজ্ঞপ্তি পঠিত হয়েছে', 'All notifications marked read'), 'success');
    paint();
  };

  function paint() {
    body.replaceChildren();

    const dismissable = items.filter(n => !isStickyNotification(n)).length;
    if (dismissable) {
      const bar = el('div', { class: 'btn-row end', style: 'padding:0 14px 8px' });
      bar.appendChild(btn(t('সব পঠিত করুন', 'Mark all read'), 'check', 'soft', markAll, { size: 'xs' }));
      body.appendChild(bar);
    }

    if (!items.length) {
      body.appendChild(emptyState({
        ic: 'bell',
        title: t('কোনো নতুন বিজ্ঞপ্তি নেই', 'No new notifications'),
        hint: t('নতুন জমা, অনুমোদন ও বকেয়ার তথ্য এখানে দেখা যাবে।', 'New deposits, approvals and dues appear here.'),
        compact: true,
      }));
      return;
    }

    const list = el('div', { class: 'list' });
    items.forEach(n => {
      const li = el('div', {
        class: 'li unread' + (n.kind === 'due' ? ' wa-msg' : ''),
        role: 'button', tabindex: '0',
      });
      li.innerHTML = `
        <div class="ic ${TONE[n.kind] || 'b'}">${icon(ICON[n.kind] || 'bell')}</div>
        <div class="bd">
          <div class="t">${esc(auto(n.title))} <span class="tag pending">${esc(t('নতুন', 'New'))}</span></div>
          ${n.body ? `<div class="s">${esc(auto(n.body))}</div>` : ''}
          ${n.action === 'deposit' ? `<div class="s" style="margin-top:6px"><span class="tag info">${esc(t('এখনই জমা দিন →', 'Submit deposit now →'))}</span></div>` : ''}
        </div>
        <div class="w">${esc(fmtDate(n.createdAt))}<br>${esc(fmtTime(n.createdAt))}</div>`;

      const open = async () => {
        if (!isStickyNotification(n)) {
          await markNotificationRead(n.id, session.id);
          drop(n);
          App.refreshNotifBadge();
          paint();
        }
        if (n.action === 'deposit') {
          sheet.close();
          App.go('deposits', 'new');
        }
      };
      li.addEventListener('click', open);
      li.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
      list.appendChild(li);
    });
    body.appendChild(list);
  }

  paint();
}
