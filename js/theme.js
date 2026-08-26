/* Light + hard (AMOLED) dark. Stored per device. */
const KEY = 'ds_theme';

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
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', t === 'amoled' ? '#000000' : '#16a34a');
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
}

applyTheme(getTheme());
