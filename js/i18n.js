/* UI language: bn | en — stored per device. */
const KEY = 'ds_lang';

export function getLang() {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'en' ? 'en' : 'bn';
  } catch { return 'bn'; }
}

export function t(bn, en) {
  return getLang() === 'en' ? (en == null || en === '' ? bn : en) : (bn == null || bn === '' ? en : bn);
}

/** Split a "বাংলা / English" string and return the active language. */
export function tx(mixed) {
  const s = String(mixed ?? '');
  const i = s.indexOf(' / ');
  if (i < 0) return s;
  return t(s.slice(0, i), s.slice(i + 3));
}

export function loc(item) {
  if (!item) return '';
  if (typeof item === 'string') return item;
  return t(item.bn, item.en);
}

export function applyLang(lang) {
  const l = lang === 'en' ? 'en' : 'bn';
  try { localStorage.setItem(KEY, l); } catch {}
  document.documentElement.lang = l === 'en' ? 'en' : 'bn';
  document.documentElement.dir = 'ltr';
}

export function setLang(lang) {
  applyLang(lang);
  window.dispatchEvent(new CustomEvent('ds:lang', { detail: getLang() }));
}

applyLang(getLang());
