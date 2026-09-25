/* ধ্রুব সংসদ — Service Worker (offline-first shell + runtime cache)
 *
 * v7 notes
 *  · the old single 764 KB logo is no longer precached — the UI, the manifest
 *    and the PDF sheets all use the optimised `icons/icon-192.png`;
 *  · the app is one module graph (js/app.js) — every module it can reach is
 *    precached so the app still boots with no connectivity;
 *  · heavy layout engines (jspdf / html2canvas) are precached because reports
 *    and statements must work offline; the Excel engine is NOT precached — it
 *    is only fetched if an export is actually used (and then cached).
 */
const VERSION = 'ds-v7.0.0';
const SHELL = `${VERSION}-shell`;
const RUNTIME = `${VERSION}-runtime`;

/* Everything the app needs to boot and run fully offline. */
const PRECACHE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch.png',
  /* fonts */
  'vendor/fonts/noto-sans-bengali-bengali-400-normal.woff2',
  'vendor/fonts/noto-sans-bengali-bengali-700-normal.woff2',
  'vendor/fonts/noto-sans-bengali-latin-400-normal.woff2',
  'vendor/fonts/noto-sans-bengali-latin-700-normal.woff2',
  /* vendor: sync + print engines (loaded on demand by js/vendor.js) */
  'vendor/firebase-app-compat.js',
  'vendor/firebase-auth-compat.js',
  'vendor/firebase-database-compat.js',
  'vendor/jspdf.umd.min.js',
  'vendor/jspdf.plugin.autotable.min.js',
  'vendor/html2canvas.min.js',
  /* application modules */
  'js/app.js',
  'js/brand.js',
  'js/vendor.js',
  'js/i18n.js',
  'js/theme.js',
  'js/crypto.js',
  'js/db.js',
  'js/auth.js',
  'js/store.js',
  'js/firebase.js',
  'js/ui.js',
  'js/util.js',
  'js/icons.js',
  'js/pdf.js',
  'js/sheet.js',
  'js/preview.js',
  'js/picker.js',
  'js/gestures.js',
  'js/install-prompt.js',
  'js/ui-auth.js',
  /* pages */
  'js/pages/account.js',
  'js/pages/admin.js',
  'js/pages/dashboard.js',
  'js/pages/deposits.js',
  'js/pages/members.js',
  'js/pages/misc.js',
  'js/pages/member-panel.js',
  'js/pages/notifications.js',
  'js/pages/profile.js',
  'js/pages/reports.js',
  'js/pages/settings.js',
  'js/pages/statements.js',
  'js/pages/transactions.js',
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    /* addAll is atomic — a single 404 would abort the install, so cache individually. */
    await Promise.all(PRECACHE.map(async url => {
      try {
        const res = await fetch(new Request(url, { cache: 'reload' }));
        if (res && (res.ok || res.type === 'opaque')) await cache.put(url, res);
      } catch (_) { /* asset unavailable at install time — runtime cache will pick it up */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== SHELL && k !== RUNTIME).map(k => caches.delete(k)));
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.enable(); } catch (_) {}
    }
    await self.clients.claim();
    const wins = await self.clients.matchAll({ type: 'window' });
    wins.forEach(c => c.postMessage({ type: 'VERSION_CHANGED', version: VERSION }));
  })());
});

self.addEventListener('message', event => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') self.skipWaiting();
  if (data.type === 'CLEAR_CACHE') {
    event.waitUntil(caches.keys().then(ks => Promise.all(ks.map(k => caches.delete(k)))));
  }
});

/* Never touch Firebase / websocket / non-GET traffic — it must reach the network
   (or fail) so the app's own sync-queue logic can handle it. */
function bypass(url, request) {
  if (request.method !== 'GET') return true;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return true;
  if (url.origin !== self.location.origin) return true;
  if (/firebaseio\.com|googleapis\.com|firebaseapp\.com/.test(url.host)) return true;
  return false;
}

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (bypass(url, req)) return;

  /* Navigations: network-first, fall back to the cached shell (offline start-up). */
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const preload = await event.preloadResponse;
        if (preload) { (await caches.open(RUNTIME)).put('index.html', preload.clone()); return preload; }
        const fresh = await fetch(req);
        (await caches.open(RUNTIME)).put('index.html', fresh.clone());
        return fresh;
      } catch (_) {
        return (await caches.match('index.html')) || (await caches.match('./')) ||
          new Response('<h1>অফলাইন / Offline</h1>', { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 503 });
      }
    })());
    return;
  }

  /* JS/CSS: network-first so a deployed fix is never stuck behind the cache. */
  if (/\.(js|mjs|css)$/i.test(url.pathname)) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: 'no-store' });
        if (fresh && fresh.ok) {
          try { (await caches.open(SHELL)).put(url.pathname.replace(/^\//, ''), fresh.clone()); } catch (_) {}
        }
        return fresh;
      } catch (_) {
        return (await caches.match(req, { ignoreSearch: true })) ||
          new Response('', { status: 504, statusText: 'Offline' });
      }
    })());
    return;
  }

  /* Other static assets: cache-first with background refresh. */
  event.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: true });
    const network = fetch(req).then(async res => {
      if (res && res.ok && res.type === 'basic') {
        const cache = await caches.open(cached ? SHELL : RUNTIME);
        try { await cache.put(req, res.clone()); } catch (_) {}
      }
      return res;
    }).catch(() => null);
    if (cached) { network; return cached; }
    const res = await network;
    if (res) return res;
    return new Response('', { status: 504, statusText: 'Offline' });
  })());
});
