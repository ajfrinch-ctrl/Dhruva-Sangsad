/* Brand logo helper — separate file so stale store.js / util.js caches cannot break boot. */
export const DEFAULT_LOGO = './icons/logo.png';
export function logoSrc(cfg) {
  const v = cfg && cfg.orgLogo;
  return (v && String(v).trim()) || DEFAULT_LOGO;
}
