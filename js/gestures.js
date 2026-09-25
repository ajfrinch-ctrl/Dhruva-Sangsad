/* ধ্রুব সংসদ — touch gestures.
   Roadmap step-8 polish (docs/mobile-ui-design.md §10.1):
   swipe-to-act on approval rows, pull-to-refresh on the content scroller,
   collapse-on-scroll topbar (mobile shell) and shared haptic ticks.
   Every gesture degrades gracefully: no touch → no swipe/PTR, mouse users
   keep the buttons, and reduced-motion users get instant (non-animated)
   behaviour. Nothing here is required for the app to work. */
import { el, haptic } from './util.js';
import { t } from './i18n.js';
import { icon } from './icons.js';

const SWIPE_THRESHOLD = 72;   /* px of horizontal drag needed to fire the action */
const SWIPE_MAX = 120;        /* rubber-band clamp so the row cannot fly away */
const PTR_THRESHOLD = 56;     /* indicator height (px) that arms a refresh */
const PTR_MAX = 88;
const TOPBAR_HIDE_AFTER = 140;/* start hiding only once scrolled this far */
const MOBILE_Q = '(max-width: 1023px)'; /* same breakpoint as the bottom-nav shell */

const reducedMotion = () => {
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches; }
  catch { return false; }
};
const isMobileLayout = () => {
  try { return matchMedia(MOBILE_Q).matches; }
  catch { return true; }
};
const shellOn = () => !!document.querySelector('#app.on');

/* ------------------------------------------------------------------ *
 * Swipe-to-act — wrap a row's content in a draggable front layer with
 * the actions painted underneath. Release past the threshold and the
 * matching action runs (the same confirm dialogs as the buttons).
 *   attachSwipe(row, {
 *     leading:  { ic, label, run },   // revealed by swiping right →
 *     trailing: { ic, label, run },   // revealed by swiping left ←
 *   });
 * ------------------------------------------------------------------ */
let activeSwipe = null;

export function attachSwipe(row, { leading = null, trailing = null } = {}) {
  if (!row || (!leading && !trailing)) return null;
  if (row.dataset.swipe === '1') return row; /* idempotent across re-renders */
  row.dataset.swipe = '1';
  row.classList.add('swipe');

  const under = el('div', { class: 'swipe-under' });
  const leadZone = el('div', { class: 'su-zone su-lead' });
  const trailZone = el('div', { class: 'su-zone su-trail' });
  if (leading) {
    leadZone.innerHTML = icon(leading.ic || 'check');
    leadZone.appendChild(el('span', { text: leading.label || '' }));
  }
  if (trailing) {
    trailZone.innerHTML = icon(trailing.ic || 'x');
    trailZone.appendChild(el('span', { text: trailing.label || '' }));
  }
  under.append(leadZone, trailZone);

  const front = el('div', { class: 'swipe-front' });
  while (row.firstChild) front.appendChild(row.firstChild);
  row.append(under, front);

  let startX = 0, startY = 0, dx = 0, pid = null, past = 0, moved = false, busy = false;

  const setX = x => { dx = x; front.style.transform = x ? `translateX(${x}px)` : ''; };
  const markPast = () => {
    const p = dx >= SWIPE_THRESHOLD ? 1 : dx <= -SWIPE_THRESHOLD ? -1 : 0;
    if (p !== past) {
      past = p;
      leadZone.classList.toggle('past', p === 1);
      trailZone.classList.toggle('past', p === -1);
      if (p !== 0) haptic('tick');
    }
  };
  const snapBack = () => {
    front.style.transition = '';
    front.classList.remove('drag');
    setX(0); past = 0;
    leadZone.classList.remove('past');
    trailZone.classList.remove('past');
  };
  front.__swipeReset = snapBack;

  front.addEventListener('pointerdown', e => {
    if (busy || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (activeSwipe && activeSwipe !== front) {
      try { activeSwipe.__swipeReset?.(); } catch { /* already gone */ }
    }
    activeSwipe = front;
    pid = e.pointerId; startX = e.clientX; startY = e.clientY;
    moved = false;
    front.style.transition = 'none';
    front.classList.add('drag');
    try { front.setPointerCapture?.(e.pointerId); } catch { /* old browsers */ }
  });
  front.addEventListener('pointermove', e => {
    if (e.pointerId !== pid) return;
    let x = e.clientX - startX;
    const y = e.clientY - startY;
    /* Mostly vertical → the user is scrolling; hand the gesture back. */
    if (!moved && Math.abs(y) > 10 && Math.abs(y) > Math.abs(x)) {
      pid = null;
      snapBack();
      return;
    }
    if (Math.abs(x) > 6 || Math.abs(y) > 6) moved = true;
    if (!leading && x > 0) x = 0;
    if (!trailing && x < 0) x = 0;
    setX(Math.max(-SWIPE_MAX, Math.min(SWIPE_MAX, x)));
    markPast();
  });
  const finish = async e => {
    if (e.pointerId !== pid) return;
    pid = null;
    if (activeSwipe === front) activeSwipe = null;
    const fire = past === 1 ? leading : past === -1 ? trailing : null;
    if (moved) row.__suppressClick = true;
    if (!fire) { snapBack(); return; }
    busy = true;
    haptic('tap');
    try { await fire.run(); } catch (err) { console.error('[swipe]', err); }
    busy = false;
    if (front.isConnected) snapBack(); /* approve/reject usually re-render the list */
  };
  front.addEventListener('pointerup', finish);
  front.addEventListener('pointercancel', () => {
    pid = null;
    if (activeSwipe === front) activeSwipe = null;
    snapBack();
  });

  /* A drag that ends over a button must not also click it. */
  row.addEventListener('click', e => {
    if (row.__suppressClick) {
      row.__suppressClick = false;
      e.stopPropagation();
      e.preventDefault();
    }
  }, true);

  return row;
}

/* ------------------------------------------------------------------ *
 * Pull-to-refresh — drag down from the very top of the scroller.
 * ------------------------------------------------------------------ */
function attachPullToRefresh(view, onRefresh) {
  if (!view || view.dataset.ptr === '1') return;
  view.dataset.ptr = '1';
  let startY = 0, armed = false, pulling = false, ready = false, refreshing = false, ptr = null;

  const ensurePtr = () => {
    if (ptr && ptr.isConnected) return ptr;
    ptr = el('div', { class: 'ptr', html: '<span class="ptr-box"><span class="ptr-spin"></span><span class="ptr-tx"></span></span>' });
    view.prepend(ptr);
    return ptr;
  };
  const setLabel = s => { ensurePtr().querySelector('.ptr-tx').textContent = s; };
  const collapse = () => {
    if (!ptr || !ptr.isConnected) { ptr = null; return; }
    const p = ptr; ptr = null;
    p.classList.add('ease');
    p.style.height = '0px';
    setTimeout(() => p.remove(), 230);
  };

  view.addEventListener('touchstart', e => {
    if (refreshing || !shellOn()) return;
    if (e.touches.length !== 1) { armed = false; return; }
    if (view.scrollTop <= 1) {
      armed = true; startY = e.touches[0].clientY; pulling = false; ready = false;
    } else armed = false;
  }, { passive: true });

  view.addEventListener('touchmove', e => {
    if (!armed || refreshing || !shellOn()) return;
    const dy = e.touches[0].clientY - startY;
    if (!pulling && dy < 8) return;
    if (dy <= 0) { pulling = false; collapse(); return; }
    pulling = true;
    /* Already at the top — swallow the rubber-band / chained native refresh. */
    e.preventDefault();
    const h = Math.min(PTR_MAX, dy * 0.45);
    ensurePtr().style.height = h + 'px';
    const r = h >= PTR_THRESHOLD;
    if (r !== ready) {
      ready = r;
      ensurePtr().classList.toggle('ready', r);
      setLabel(r ? t('ছেড়ে দিন', 'Release') : t('রিফ্রেশ করতে টানুন', 'Pull to refresh'));
      if (r) haptic('tick');
    } else if (!ensurePtr().querySelector('.ptr-tx').textContent) {
      setLabel(t('রিফ্রেশ করতে টানুন', 'Pull to refresh'));
    }
  }, { passive: false });

  const cancel = () => { armed = pulling = ready = false; collapse(); };
  view.addEventListener('touchcancel', cancel, { passive: true });
  view.addEventListener('touchend', async () => {
    if (!armed) return;
    armed = false;
    if (!pulling) return;
    pulling = false;
    if (!ready || refreshing) { ready = false; collapse(); return; }
    ready = false; refreshing = true;
    const p = ensurePtr();
    p.classList.add('loading', 'ease');
    p.classList.remove('ready');
    p.style.height = PTR_THRESHOLD + 'px';
    setLabel(t('রিফ্রেশ হচ্ছে…', 'Refreshing…'));
    haptic('tap');
    try { await onRefresh(); } catch (err) { console.error('[ptr]', err); }
    finally {
      refreshing = false;
      collapse(); /* the re-render usually removed the indicator already */
    }
  }, { passive: true });
}

/* ------------------------------------------------------------------ *
 * Collapse-on-scroll — slide the fixed topbar away while scrolling
 * down on the mobile shell; any upward scroll brings it back.
 * ------------------------------------------------------------------ */
function attachTopbarCollapse(view) {
  if (!view || view.dataset.tbc === '1') return;
  view.dataset.tbc = '1';
  let lastY = 0, hidden = false;
  const apply = h => {
    if (h === hidden) return;
    hidden = h;
    document.body.classList.toggle('tb-hidden', h);
  };
  view.addEventListener('scroll', () => {
    if (!shellOn() || !isMobileLayout() || reducedMotion()) {
      if (hidden) apply(false);
      return;
    }
    const y = view.scrollTop;
    const dy = y - lastY;
    lastY = y;
    if (y < 60) { apply(false); return; }
    if (dy > 6 && y > TOPBAR_HIDE_AFTER) apply(true);
    else if (dy < -4) apply(false);
  }, { passive: true });
  try {
    const mq = matchMedia(MOBILE_Q);
    mq.addEventListener?.('change', () => { if (!mq.matches && hidden) apply(false); });
  } catch { /* old browsers */ }
}

/** Wire every shell-level gesture once. Safe to call a single time from boot. */
export function initShellGestures({ onRefresh, collapseTopbar = true } = {}) {
  const view = document.getElementById('view');
  if (!view) return;
  const refresh = typeof onRefresh === 'function' ? onRefresh : () => window.App?.refresh();
  attachPullToRefresh(view, refresh);
  /* The shell keeps the top bar fixed (app-like); collapse-on-scroll is opt-in. */
  if (collapseTopbar) attachTopbarCollapse(view);
}
