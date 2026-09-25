/* Brand — ONE optimized local logo asset, reused by every surface.
 *
 * Why this replaces the old 764 KB `icons/logo.png`:
 *   The shell, the login card, the footer and every print sheet used to point
 *   at the full-resolution master, so the same (huge) image was downloaded and
 *   decoded again and again on each surface. Now every surface resolves its
 *   source through `logoSrc()` → a single 192px asset (≈5.6 KB, PNG8) that
 *   covers the largest in-app size (login 76px, topbar 32px, print 60px @3x)
 *   with room to spare. At most ONE network request per browser session, and
 *   from the second visit the service worker serves it from cache with no
 *   network at all.
 *
 * Rules every caller must respect:
 *   1. Never hard-code an <img src> for the logo — call logoSrc()/applyBrand().
 *   2. An uploaded organisation logo is stored as a data-URL, so choosing a
 *      custom logo can never add a network request either.
 *   3. Nothing may await the logo before painting UI.
 */

/* Single source of truth for the app version. Keep in step with the `?v=`
   cache buster on index.html and the service-worker cache name. */
export const APP_VERSION = '7.2.0';

/** The one small logo used everywhere in the UI (favicon, manifest icon 192,
 *  topbar, login, footer, install prompt and print/PDF sheets). */
export const LOGO_SMALL = './icons/icon-192.png';
/** Large icon — install/PWA surfaces only (nobody downloads it at runtime). */
export const LOGO_512 = './icons/icon-512.png';
/** Legacy full-resolution master, kept on disk so existing custom-logo
 *  settings that still point at it keep working. Never used by the UI. */
export const LOGO_MASTER = './icons/logo.png';
/** Back-compat alias (older modules import DEFAULT_LOGO). */
export const DEFAULT_LOGO = LOGO_SMALL;

/* Custom organisation logo (Settings → Organisation) — a data-URL, cached in
   memory for the session so re-rendering a page never re-reads settings. */
let customLogo = null;

const clean = v => (v && String(v).trim()) || '';

/** Cache / replace the custom organisation logo (data-URL or '' to clear). */
export function setCustomLogo(dataUrl) {
  customLogo = clean(dataUrl) || null;
}
export function hasCustomLogo() { return !!customLogo; }

/** Resolve the logo source for the given settings object (optional). */
export function logoSrc(cfg) {
  const orgOwn = clean(cfg && cfg.orgLogo);
  if (orgOwn) return orgOwn;          // data-URL → no request
  if (customLogo) return customLogo;
  return LOGO_SMALL;
}

/** Paint the logo into every element that carries `data-logo`, in one pass.
 *  Called by the shell, the login screen and Settings → Organisation, so no
 *  page ever needs its own logo loading logic. */
export function applyLogo(cfg, root = document) {
  const src = logoSrc(cfg);
  root.querySelectorAll('img[data-logo]').forEach(img => {
    if (img.getAttribute('src') !== src) img.setAttribute('src', src);
  });
  /* Favicon follows the brand (only for non-data URLs — a data-URL favicon
     would have to be re-parsed by the browser on every render). */
  if (!src.startsWith('data:')) {
    const link = root.querySelector('link[rel="icon"], link[rel="apple-touch-icon"]');
    if (link && link.getAttribute('href') !== src) link.setAttribute('href', src);
  }
  return src;
}

/** Warm the browser cache for the logo without blocking anything. Called once
 *  from the inline boot script so the first paint of any screen finds the
 *  logo already decoded. Deliberately fire-and-forget. */
export function warmLogo() {
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = logoSrc();
  } catch { /* ignore */ }
}
