/* Light + hard (AMOLED) dark. Role accents. Stored per device. */
const KEY = 'ds_theme';

const ROLE_COLOR = { admin: '#7c3aed', maker: '#0d9488', member: '#ea580c' };

export function getTheme() {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'amoled' || v === 'dark') return 'amoled';
    if (v === 'light') return 'light';
  } catch {}
  return 'light';
}

export function applyTheme(theme) {
  const t = theme === 'amoled' || theme === 'dark' ? 'amoled' : 'light';
  try { localStorage.setItem(KEY, t); } catch {}
  document.documentElement.dataset.theme = t;
  document.documentElement.style.colorScheme = t === 'amoled' ? 'dark' : 'light';
  paintThemeColor();
}

function paintThemeColor() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  if (getTheme() === 'amoled') { meta.setAttribute('content', '#000000'); return; }
  const role = document.documentElement.dataset.role;
  meta.setAttribute('content', ROLE_COLOR[role] || '#16a34a');
}

export function setTheme(theme) {
  applyTheme(theme);
  window.dispatchEvent(new CustomEvent('ds:theme', { detail: getTheme() }));
}

export function toggleTheme() {
  setTheme(getTheme() === 'amoled' ? 'light' : 'amoled');
}

export function applyRole(role) {
  const r = role === 'admin' || role === 'maker' || role === 'member' ? role : '';
  document.documentElement.dataset.role = r;
  paintThemeColor();
}

applyTheme(getTheme());
