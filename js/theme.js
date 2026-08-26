/* Light / Dark / AMOLED + role accent. Stored per device. */
const KEY = 'ds_theme';

export function getTheme() {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'dark' || v === 'amoled' || v === 'light') return v;
  } catch {}
  return 'light';
}

export function applyTheme(theme) {
  const t = theme === 'dark' || theme === 'amoled' ? theme : 'light';
  try { localStorage.setItem(KEY, t); } catch {}
  document.documentElement.dataset.theme = t;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute('content', t === 'amoled' ? '#000000' : t === 'dark' ? '#0b1220' : getComputedStyle(document.documentElement).getPropertyValue('--role-accent').trim() || '#16a34a');
  }
}

export function setTheme(theme) {
  applyTheme(theme);
  window.dispatchEvent(new CustomEvent('ds:theme', { detail: getTheme() }));
}

export function applyRole(role) {
  /* Role accents reverted — keep a data attribute only for optional styling. */
  const r = role === 'admin' || role === 'maker' || role === 'member' ? role : '';
  document.documentElement.dataset.role = r;
  return;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && getTheme() === 'light') {
    const map = { admin: '#7c3aed', maker: '#0d9488', member: '#ea580c' };
    meta.setAttribute('content', map[r] || '#16a34a');
  }
}

applyTheme('light');
