/* Brand logo helper — separate file so stale store.js / util.js caches cannot break boot. */
export const DEFAULT_LOGO = './icons/logo.png';

/** Single source of truth for the app version. Keep in step with the cache
 *  buster on index.html (`?v=`) and css/app.css when releasing. */
export const APP_VERSION = '6.5.22';

export function logoSrc(cfg) {
  const v = cfg && cfg.orgLogo;
  return (v && String(v).trim()) || DEFAULT_LOGO;
}
