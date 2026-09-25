/* ধ্রুব সংসদ — UI language. The app UI is ENGLISH ONLY.
 *
 * There is no language switch any more: every module still calls t(bn, en) /
 * tx('bn / en') (the call sites were left untouched), but this module always
 * resolves to the English side, so no screen can ever show Bangla UI text.
 *
 *   t(bn, en)        → the English argument (falls back to bn only when en is empty).
 *   tx('bn / en')    → the English half of a legacy "বাংলা / English" literal.
 *   loc({bn,en})     → object form.
 *   pick(en, bn)     → same as t() with the English argument first.
 *
 * PDF/print sheets never use this module: statements and reports are always
 * rendered in English (see js/sheet.js).
 */

const KEY = 'ds_lang';
export const LANGS = ['en'];

const current = 'en';

export function getLang() { return current; }
export function isBangla() { return false; }

export function applyLang() {
  try { localStorage.setItem(KEY, current); } catch { /* private mode */ }
  const root = document.documentElement;
  root.lang = 'en';
  root.dir = 'ltr';
  root.dataset.lang = current;
}

/** Kept for API compatibility — the language can no longer change. */
export function setLang() { return current; }
export function toggleLang() { return current; }

/** Primary translator: t('বাংলা', 'English') → 'English'. */
export function t(bn, en) {
  const bnS = bn == null ? '' : String(bn);
  const enS = en == null ? '' : String(en);
  return enS !== '' ? enS : bnS;
}

/* A "translation" is only accepted when the right-hand side is in Latin script.
   Anything else is treated as a single-language string. */
const looksBangla = s => /[\u0980-\u09FF]/.test(s);
const looksLatin = s => /[A-Za-z]/.test(s) && !looksBangla(s);

/** Auto-pick the English side of a legacy "বাংলা / English" literal. */
export function auto(str) {
  const s = str == null ? '' : String(str);
  const i = s.indexOf(' / ');
  if (i < 0) return s;
  const left = s.slice(0, i).trim();
  const right = s.slice(i + 3).trim();
  return looksLatin(right) ? right : (looksLatin(left) ? left : right || left);
}

/** Back-compat alias — old code called tx(mixed). */
export function tx(mixed) { return auto(mixed); }

/** Object form: { bn, en }. */
export function loc(item) {
  if (item == null) return '';
  if (typeof item === 'string') return auto(item);
  return t(item.bn, item.en);
}

/** English-first alias used by newer screens: pick('Dashboard', 'ড্যাশবোর্ড'). */
export function pick(en, bn) { return t(bn, en); }

/* Apply before anything renders. */
applyLang();
