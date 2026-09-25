/* ধ্রুব সংসদ — UI language. ONE source of truth: bn | en, stored per device.
 *
 * Contract used by every module (this is what keeps the UI from mixing
 * languages):
 *
 *   t(bn, en)        → strictly one language. Never returns "বাংলা / English".
 *   tx('bn / en')    → splits a legacy "বাংলা / English" literal and returns the
 *                      active side only. Unknown second halves (e.g. a Bangla
 *                      value accidentally put after the slash) are dropped, so
 *                      a mislabelled literal can never leak into the UI.
 *   loc({bn,en})     → object form.
 *   pick(en, bn)     → same as t() with the English argument first.
 *
 * PDF/print sheets never use this module: statements and reports are always
 * rendered in English (see js/sheet.js), regardless of the UI language.
 */

const KEY = 'ds_lang';
export const LANGS = ['bn', 'en'];

let current = 'bn';

function readStored() {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'en' ? 'en' : 'bn';
  } catch { return 'bn'; }
}

export function getLang() { return current; }
export function isBangla() { return current === 'bn'; }

export function applyLang(lang) {
  current = lang === 'en' ? 'en' : 'bn';
  try { localStorage.setItem(KEY, current); } catch { /* private mode */ }
  const root = document.documentElement;
  root.lang = current === 'en' ? 'en' : 'bn';
  root.dir = 'ltr';
  root.dataset.lang = current;
}

/** Switch language and notify the shell so visible screens re-render. */
export function setLang(lang) {
  const next = lang === 'en' ? 'en' : 'bn';
  const changed = next !== current;
  applyLang(next);
  if (changed) window.dispatchEvent(new CustomEvent('ds:lang', { detail: current }));
  return current;
}

export function toggleLang() { return setLang(current === 'en' ? 'bn' : 'en'); }

/** Primary translator: t('বাংলা', 'English'). */
export function t(bn, en) {
  const bnS = bn == null ? '' : String(bn);
  const enS = en == null ? '' : String(en);
  if (current === 'en') return enS !== '' ? enS : bnS;
  return bnS !== '' ? bnS : enS;
}

/* A "translation" is only accepted when both sides are in the expected script.
   Anything else is treated as a single-language string. This is what stops
   legacy "মাসিক / Monthly" literals from leaking one language into the other. */
const looksBangla = s => /[\u0980-\u09FF]/.test(s);
const looksLatin = s => /[A-Za-z]/.test(s) && !looksBangla(s);

/** Auto-pick the active side of a legacy "বাংলা / English" literal. */
export function auto(str) {
  const s = str == null ? '' : String(str);
  const i = s.indexOf(' / ');
  if (i < 0) return s;
  const left = s.slice(0, i).trim();
  const right = s.slice(i + 3).trim();
  if (current === 'en') return looksLatin(right) ? right : (looksLatin(left) ? left : right || left);
  return looksBangla(left) ? left : (looksBangla(right) ? right : left || right);
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

/* Apply the stored language before anything renders. */
applyLang(readStored());
