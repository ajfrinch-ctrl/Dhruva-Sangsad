/* ধ্রুব সংসদ — utilities */
import { t, getLang, loc, tx } from './i18n.js';
export { t, getLang, loc, tx };

export const APP_NAME_BN = 'ধ্রুব সংসদ';
export const APP_NAME_EN = 'Dhruvo Sangsad';
export const DEFAULT_LOGO = 'icons/logo.png';
export function logoSrc(cfg) {
  const v = cfg && cfg.orgLogo;
  return (v && String(v).trim()) || DEFAULT_LOGO;
}

/* ---------------- DOM ---------------- */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  const list = Array.isArray(children) ? children : [children];
  for (const c of list) {
    if (c === null || c === undefined || c === false) continue;
    node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return node;
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
export function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); return node; }
export function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ---------------- ids / device ---------------- */
export function uid(prefix = 'id') {
  const rnd = crypto.getRandomValues(new Uint8Array(8));
  return prefix + '_' + Date.now().toString(36) + '_' + Array.from(rnd).map(b => b.toString(16).padStart(2, '0')).join('');
}
export function deviceId() {
  let d = localStorage.getItem('ds_device_id');
  if (!d) { d = uid('dev'); localStorage.setItem('ds_device_id', d); }
  return d;
}

/* ---------------- dates ---------------- */
export function todayISO(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function nowISO() { return new Date().toISOString(); }
/** ISO (YYYY-MM-DD) or timestamp -> DD-MM-YYYY */
export function fmtDate(v) {
  if (!v) return '';
  let s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) { const [y, m, d] = s.slice(0, 10).split('-'); return `${d}-${m}-${y}`; }
  if (/^\d{2}-\d{2}-\d{4}$/.test(s)) return s;
  const dt = new Date(v);
  if (!isNaN(dt)) { const p = n => String(n).padStart(2, '0'); return `${p(dt.getDate())}-${p(dt.getMonth() + 1)}-${dt.getFullYear()}`; }
  return s;
}
export function fmtDateTime(v) {
  if (!v) return '';
  const dt = new Date(v);
  if (isNaN(dt)) return String(v);
  const p = n => String(n).padStart(2, '0');
  let h = dt.getHours(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
  return `${p(dt.getDate())}-${p(dt.getMonth() + 1)}-${dt.getFullYear()} ${p(h)}:${p(dt.getMinutes())} ${ap}`;
}
export function fmtTime(v) {
  const dt = new Date(v); if (isNaN(dt)) return '';
  const p = n => String(n).padStart(2, '0');
  let h = dt.getHours(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
  return `${p(h)}:${p(dt.getMinutes())} ${ap}`;
}
/** DD-MM-YYYY -> ISO */
export function toISO(ddmmyyyy) {
  if (!ddmmyyyy) return '';
  const m = String(ddmmyyyy).match(/^(\d{2})-(\d{2})-(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : String(ddmmyyyy);
}
export function monthKey(iso) { return String(iso || '').slice(0, 7); }
export function monthLabel(key) {
  const en = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const bn = ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'];
  const names = getLang() === 'en' ? en : bn;
  const [y, m] = String(key).split('-');
  return `${names[Number(m) - 1] || m} ${y}`;
}
/** whole months from a to b inclusive of both endpoints' months (>=1) */
export function monthsBetweenInclusive(isoA, isoB) {
  if (!isoA || !isoB) return 1;
  const a = new Date(isoA.slice(0, 10) + 'T00:00:00');
  const b = new Date(isoB.slice(0, 10) + 'T00:00:00');
  if (isNaN(a) || isNaN(b)) return 1;
  const n = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) + 1;
  return Math.max(0, n);
}

/* ---------------- numbers / money ---------------- */
export function num(v) { const n = Number(String(v ?? '').replace(/,/g, '').trim()); return isNaN(n) ? 0 : n; }
export function money(v) {
  const n = Math.round(num(v) * 100) / 100;
  const s = n.toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
  return s;
}
export function taka(v) { return '৳' + money(v); }

/* ---------------- validation ---------------- */
export function normalizeMobile(v) {
  let s = String(v || '').replace(/[^\d+]/g, '');
  s = s.replace(/^\+?88/, '');
  return s;
}
export function isValidMobile(v) { return /^01[3-9]\d{8}$/.test(normalizeMobile(v)); }
export function isValidEmail(v) { return !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v).trim()); }
export function memberIdFromMobile(mobile) {
  const s = normalizeMobile(mobile);
  return s.length >= 6 ? s.slice(-6) : '';
}
export function waNumber(v) {
  const s = normalizeMobile(v);
  return s.startsWith('0') ? '88' + s : s;
}

/* ---------------- deposit vocabulary ---------------- */
export const DEPOSIT_TYPES = [
  { id: 'monthly', bn: 'মাসিক জমা', en: 'Monthly Deposit' },
  { id: 'advance', bn: 'অগ্রিম জমা', en: 'Advance Deposit' },
  { id: 'special', bn: 'বিশেষ চাঁদা', en: 'Special Contribution' },
  { id: 'other', bn: 'অন্যান্য', en: 'Other' },
];
export const PAY_METHODS = [
  { id: 'cash', bn: 'নগদ', en: 'Cash' },
  { id: 'mobile', bn: 'মোবাইল ব্যাংকিং', en: 'Mobile Banking' },
  { id: 'bank', bn: 'ব্যাংক', en: 'Bank' },
];
export const typeLabel = id => (DEPOSIT_TYPES.find(t => t.id === id) || { bn: id, en: id });
export const methodLabel = id => (PAY_METHODS.find(t => t.id === id) || { bn: id, en: id });
export const STATUS_BN = { pending: 'অপেক্ষমাণ', approved: 'অনুমোদিত', rejected: 'বাতিল', active: 'সক্রিয়', inactive: 'নিষ্ক্রিয়' };
export const STATUS_EN = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected', active: 'Active', inactive: 'Inactive' };

/* ---------------- toast / modal ---------------- */
export function toast(msg, kind = 'info', ms = 3200) {
  let wrap = document.getElementById('toastWrap');
  if (!wrap) { wrap = el('div', { id: 'toastWrap', class: 'toast-wrap' }); document.body.appendChild(wrap); }
  const t = el('div', { class: `toast toast-${kind}`, html: `<span>${esc(msg)}</span>` });
  wrap.appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 240); }, ms);
}

export function modal({ title, body, actions = [], width = 420, dismissible = true }) {
  return new Promise(resolve => {
    const back = el('div', { class: 'modal-back' });
    const box = el('div', { class: 'modal', style: `max-width:${width}px` });
    const head = el('div', { class: 'modal-head' }, [el('h3', { text: title || '' })]);
    if (dismissible) {
      head.appendChild(el('button', { class: 'icon-btn', title: 'Close', html: '&times;', onclick: () => done(null) }));
    }
    const bd = el('div', { class: 'modal-body' });
    if (typeof body === 'string') bd.innerHTML = body; else if (body) bd.appendChild(body);
    const ft = el('div', { class: 'modal-foot' });
    (actions.length ? actions : [{ label: 'OK', value: true, kind: 'primary' }]).forEach(a => {
      ft.appendChild(el('button', {
        class: `btn btn-${a.kind || 'ghost'}`, type: 'button',
        onclick: () => { if (a.onClick) { const r = a.onClick(bd); if (r === false) return; } done(a.value); }
      }, [a.label]));
    });
    box.append(head, bd, ft); back.appendChild(box); document.body.appendChild(back);
    if (dismissible) back.addEventListener('click', e => { if (e.target === back) done(null); });
    const first = bd.querySelector('input,select,textarea');
    if (first) setTimeout(() => first.focus(), 60);
    function done(v) { back.remove(); resolve(v); }
  });
}

export function confirmBox(message, { title, okLabel, danger = false } = {}) {
  return modal({
    title: title || t('নিশ্চিত করুন', 'Confirm'), body: `<p class="cf-msg">${esc(message)}</p>`, width: 380,
    actions: [
      { label: t('বাতিল', 'Cancel'), value: false, kind: 'ghost' },
      { label: okLabel || t('হ্যাঁ', 'Yes'), value: true, kind: danger ? 'danger' : 'primary' },
    ],
  }).then(v => v === true);
}

export function alertBox(message, title) {
  return modal({ title: title || t('বার্তা', 'Message'), body: `<p class="cf-msg">${esc(message)}</p>`, width: 380, actions: [{ label: t('ঠিক আছে', 'OK'), value: true, kind: 'primary' }] });
}

/* ---------------- misc ---------------- */
export function debounce(fn, ms = 220) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
export function sortBy(arr, key, dir = 'asc') {
  const f = typeof key === 'function' ? key : (o => o[key]);
  return arr.slice().sort((a, b) => {
    const x = f(a), y = f(b);
    if (x === y) return 0;
    return (x > y ? 1 : -1) * (dir === 'desc' ? -1 : 1);
  });
}
export function groupBy(arr, keyFn) {
  const m = new Map();
  for (const it of arr) { const k = keyFn(it); if (!m.has(k)) m.set(k, []); m.get(k).push(it); }
  return m;
}
