/* Install prompt — floating pill (Active-Plus style), cancellable:
   logo + "অ্যাপ হিসেবে ব্যবহার করুন" + "হোম স্ক্রিনে ধ্রুব সংসদ যোগ করুন।"
   + ইনস্টল + ×.
   - If the browser fires beforeinstallprompt → ইনস্টল opens the native prompt.
   - Otherwise (e.g. iOS Safari) the pill still floats up and ইনস্টল shows
     step-by-step "add to home screen" instructions for the detected device.
   - × cancels it for good (localStorage); hidden in standalone/installed mode. */
import { el, esc, modal, t } from './util.js';
import { logoSrc } from './brand.js';

const DISMISS_KEY = 'ds_install_dismissed';

export function initInstallPrompt() {
  if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return;
  let deferred = null;

  const dismissed = () => {
    try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return true; }
  };
  const hide = () => {
    const bar = document.getElementById('installBar');
    if (bar) bar.remove();
  };

  const guideHtml = () => {
    const ua = (navigator.userAgent || '').toLowerCase();
    if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ipod')) {
      return `${t('নিচের Share বাটন (বক্স + উপরের তীর) চাপুন।', 'Tap the Share button (box with an up arrow) below.')}
        <br>${t('তারপর', 'Then')} <b>${t('“হোম স্ক্রিনে যোগ করুন”', '“Add to Home Screen”')}</b> ${t('বেছে নিন।', 'and tap it.')}`;
    }
    if (ua.includes('android')) {
      return `${t('Chrome মেনু (ডান-উপরের', 'Open the Chrome menu (top-right ')} ⋮ ${t(') চাপুন, তারপর', '), then tap')} <b>${t('“হোম স্ক্রিনে যোগ করুন”', '“Add to Home Screen”')}</b>${t('।', '.')}`;
    }
    return `${t('ব্রাউজার মেনু থেকে', 'From the browser menu, choose')} <b>${t('“হোম স্ক্রিনে যোগ করুন”', '“Add to Home Screen / Install”')}</b>${t('।', '.')}`;
  };

  const show = () => {
    if (document.getElementById('installBar')) return;
    const bar = el('div', { id: 'installBar', class: 'install-bar', 'aria-label': t('অ্যাপ ইনস্টল করুন', 'Install the app') });
    bar.innerHTML = `
      <div class="ib-logo"><img src="${esc(logoSrc())}" alt=""></div>
      <div class="ib-txt"><b>${t('অ্যাপ হিসেবে ব্যবহার করুন', 'Use as an app')}</b>
        <span>${t('হোম স্ক্রিনে ধ্রুব সংসদ যোগ করুন।', 'Add Dhruvo Sangsad to your home screen.')}</span></div>
      <button class="btn btn-primary ib-install" type="button">${t('ইনস্টল', 'Install')}</button>
      <button class="icon-btn ib-close" type="button" title="${esc(t('বন্ধ', 'Close'))}" aria-label="${esc(t('বন্ধ', 'Close'))}">&times;</button>`;
    document.body.appendChild(bar);
    requestAnimationFrame(() => bar.classList.add('on'));
    bar.querySelector('.ib-install').addEventListener('click', async () => {
      if (deferred) {
        deferred.prompt();
        try { await deferred.userChoice; } catch { /* ignore */ }
        hide();
        deferred = null;
        return;
      }
      /* No native install API (e.g. iOS) — show how to add manually. */
      hide();
      await modal({
        title: t('হোম স্ক্রিনে যোগ করুন', 'Add to Home Screen'),
        body: `<p class="cf-msg" style="line-height:1.6">${guideHtml()}</p>`,
        width: 400,
        actions: [{ label: t('ঠিক আছে', 'OK'), value: true, kind: 'primary' }],
      });
    });
    bar.querySelector('.ib-close').addEventListener('click', () => {
      hide();
      try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ }
    });
  };

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferred = e;
    if (!dismissed()) show();
  });
  window.addEventListener('appinstalled', () => {
    hide();
    deferred = null;
  });

  /* Fallback: browsers without beforeinstallprompt (iOS Safari) still get the
     floating pill with manual instructions. */
  setTimeout(() => { if (!deferred && !dismissed()) show(); }, 4000);
}
