/* Shared UI kit — every screen is built from these blocks, so spacing, colour
   and behaviour stay identical across the app (and a fix here fixes every
   screen). All labels go through t()/auto() so a label can never mix
   languages. */
import { el, esc, money, taka, fmtDate, STATUS_BN, STATUS_EN, t, tx, auto } from './util.js';
import { icon, bigIcon } from './icons.js';

/* ================= page scaffolding ================= */

export function page(titleBn, titleEn, iconName, actions = []) {
  const wrap = el('div');
  const head = el('div', { class: 'page-head' });
  head.innerHTML = `<h1>${icon(iconName)} <span>${esc(t(titleBn, titleEn))}</span></h1><span class="spacer"></span>`;
  actions.forEach(a => head.appendChild(a));
  wrap.appendChild(head);
  return wrap;
}

export function sectionHead(titleBn, titleEn, actionLabel = '', onAction = null) {
  const head = el('div', { class: 'sec-head' });
  head.innerHTML = `<h2>${esc(t(titleBn, titleEn))}</h2><span class="spacer"></span>`;
  if (actionLabel && onAction) {
    head.appendChild(el('button', { type: 'button', class: 'link-btn', text: tx(actionLabel), onclick: onAction }));
  }
  return head;
}

export function card(titleBn, titleEn, bodyNode, headExtras = []) {
  const c = el('div', { class: 'card' });
  if (titleBn || titleEn) {
    const h = el('div', { class: 'card-head' });
    h.innerHTML = `<h3>${esc(t(titleBn || '', titleEn || ''))}</h3><span class="spacer"></span>`;
    headExtras.forEach(x => h.appendChild(x));
    c.appendChild(h);
  }
  const b = el('div', { class: 'card-body' });
  if (bodyNode) b.appendChild(bodyNode);
  c.appendChild(b);
  c.body = b;
  return c;
}

/* ================= stats ================= */

export function statCard({ label, value, sub, tone = '', ic = 'money' }) {
  return el('div', {
    class: `stat ${tone}`,
    html: `<div class="lbl">${icon(ic)} <span>${esc(tx(label))}</span></div>
      <div class="val">${value}</div>
      ${sub ? `<div class="sub">${esc(tx(sub))}</div>` : ''}`,
  });
}

/** Big single-figure hero (dashboard balance / total). */
export function heroCard({ label, value, sub = '', target = 0, achieved = 0, foot = '' }) {
  const pct = target > 0 ? Math.min(100, Math.round((achieved / target) * 100)) : 0;
  const box = el('div', { class: 'hero-card' });
  box.innerHTML = `<div class="hc-lbl"><span>${esc(tx(label))}</span>${target > 0 ? `<span>${esc(tx(t('লক্ষ্য', 'Target')))} ${esc(money(target))}</span>` : ''}</div>
    <div class="hc-val num">${value}</div>
    ${sub ? `<div class="hc-sub">${esc(tx(sub))}</div>` : ''}
    ${target > 0 ? `<div class="hc-bar"><i style="width:${pct}%"></i></div>
      <div class="hc-foot"><span>${esc(money(achieved))}</span><span>${pct}%</span></div>` : ''}
    ${foot ? `<div class="hc-foot"><span>${esc(foot)}</span></div>` : ''}`;
  return box;
}

/* ================= full-width primary actions =================
   The deposit module (and the dashboard's Submit Deposit) intentionally use
   full-width rows: they are the main action of their screen, so they are never
   squeezed into a two-column grid or reduced to a floating button. */

export function actionCard({ label, sub = '', ic = 'plus', tone = 'primary', badge = 0, onClick = null, href = '' }) {
  const tag = href ? 'a' : 'button';
  const node = el(tag, {
    class: `action-card ${tone}`,
    ...(href ? { href } : { type: 'button' }),
  });
  node.innerHTML = `<span class="ac-ic">${bigIcon(ic)}</span>
    <span class="ac-tx"><span class="ac-t">${esc(tx(label))}</span>${sub ? `<span class="ac-s">${esc(tx(sub))}</span>` : ''}</span>
    ${badge > 0 ? `<span class="pill">${badge > 99 ? '99+' : badge}</span>` : ''}
    ${href ? '' : `<span class="ac-go">${icon('chevron')}</span>`}`;
  if (onClick) node.addEventListener('click', ev => { if (href) ev.preventDefault(); onClick(ev); });
  return node;
}

/* ================= generic list rows ================= */

export function listRow({ ic = 'info', tone = '', title = '', sub = '', meta = '', right = null, onClick = null, tag = 'div' }) {
  const row = el(tag, { class: `row ${tone}` });
  row.innerHTML = `<span class="rw-ic ${tone}">${icon(ic)}</span>
    <span class="rw-bd"><span class="rw-t">${title}</span>${sub ? `<span class="rw-s">${sub}</span>` : ''}${meta ? `<span class="rw-m">${meta}</span>` : ''}</span>`;
  if (right) row.appendChild(right);
  if (onClick) {
    const btn = el('button', { type: 'button', class: 'row-hit', 'aria-label': tx(title).replace(/<[^>]*>/g, '') });
    row.appendChild(btn);
    btn.addEventListener('click', onClick);
    row.classList.add('tappable');
  }
  return row;
}

/** Two numbers side by side inside a row (deposit / payment / balance). */
export function amountCell(v, kind = '') {
  const cls = kind === 'in' ? 'adv-amt' : kind === 'out' ? 'due-amt' : '';
  const txt = (v === '' || v === null || v === undefined || Number(v) === 0) ? '—' : money(v);
  return `<b class="${cls} num">${esc(txt === '—' ? '—' : txt)}</b>`;
}

/* ================= compact transaction rows =================
   Mobile-finance style: every transaction starts COLLAPSED — one line with the
   member name and the amount (nothing wraps, nothing overflows). Tapping the
   row expands the details (and the row actions); tapping again collapses it. */

/** Start of today (ISO) — the only day the small "recent" lists ever show. */
export const isTodayRecord = (r, today) => String((r && r.date) || '').slice(0, 10) === today;

/** Newest first: payment date, then submission time. */
export const byNewest = (a, b) => String(b.date || '').localeCompare(String(a.date || ''))
  || String(b.submittedAt || '').localeCompare(String(a.submittedAt || ''));

/** The rule every transaction list follows: TODAY only, latest 5. */
export function todaysLatest(rows, today, limit = 5) {
  return (rows || []).filter(r => isTodayRecord(r, today)).sort(byNewest).slice(0, limit);
}

export function txnRow({ ic = 'deposit', tone = '', name = '', meta = '', amount = '', amountKind = '', details = [], actions = null, open = false } = {}) {
  const row = el('div', { class: `txr${open ? ' open' : ''}` });
  const head = el('button', { type: 'button', class: 'txr-head', 'aria-expanded': open ? 'true' : 'false' });
  head.innerHTML = `<span class="rw-ic ${tone}">${bigIcon(ic)}</span>
    <span class="txr-name"><b>${esc(name)}</b>${meta ? `<small>${esc(meta)}</small>` : ''}</span>
    <span class="txr-amt ${amountKind}">${esc(amount)}</span>
    <span class="txr-chev">${icon('chevron')}</span>`;
  const body = el('div', { class: 'txr-body' });
  body.appendChild(kv(details));
  if (actions && actions.children && actions.children.length) body.appendChild(actions);
  head.addEventListener('click', () => {
    const on = !row.classList.contains('open');
    row.classList.toggle('open', on);
    head.setAttribute('aria-expanded', on ? 'true' : 'false');
  });
  row.append(head, body);
  return row;
}

/* ================= tables ================= */

export function tableWrap(headers, rows, { footer = null, empty = '', emptyIcon = 'info' } = {}) {
  const wrap = el('div', { class: 'tbl-wrap' });
  const labels = headers.map(h => tx(h.label !== undefined ? h.label : h));
  if (!rows.length) {
    wrap.appendChild(emptyState({ ic: emptyIcon, title: empty || t('কোনো তথ্য পাওয়া যায়নি', 'No records found'), compact: true }));
    return wrap;
  }
  const tbl = el('table', { class: 'tbl' });
  const thead = el('thead');
  const tr = el('tr');
  headers.forEach((h, i) => tr.appendChild(el('th', { class: h.cls || '', text: labels[i] })));
  thead.appendChild(tr); tbl.appendChild(thead);
  const tb = el('tbody');
  rows.forEach(r => {
    const row = el('tr');
    r.forEach((c, i) => {
      const label = labels[i] || '';
      if (c && c.nodeType) { const td = el('td', { dataset: { label } }); td.appendChild(c); row.appendChild(td); }
      else if (c && typeof c === 'object') {
        const td = el('td', { class: c.cls || '', dataset: { label }, colspan: c.span || 1 });
        if (c.node) td.appendChild(c.node); else td.innerHTML = c.html !== undefined ? c.html : esc(c.text ?? '');
        row.appendChild(td);
      } else row.appendChild(el('td', { dataset: { label }, html: c === null || c === undefined ? '' : String(c) }));
    });
    tb.appendChild(row);
  });
  tbl.appendChild(tb);
  if (footer && footer.length) {
    const tf = el('tfoot'); const fr = el('tr');
    footer.forEach(c => {
      if (c && typeof c === 'object' && !c.nodeType) fr.appendChild(el('td', { class: c.cls || '', html: c.html !== undefined ? c.html : esc(c.text ?? ''), colspan: c.span || 1 }));
      else fr.appendChild(el('td', { html: String(c ?? '') }));
    });
    tf.appendChild(fr); tbl.appendChild(tf);
  }
  wrap.appendChild(tbl);
  return wrap;
}

/* ================= statements =================
   The statement is a chronological account activity table: the DATE comes
   first, there is no serial number and no transaction-id column. Deposit and
   Payment are separate columns and Balance is the running account balance, so
   the sheet is readable exactly as a passbook. */

export function statementTable(rows, { openingBalance = 0, footer = true } = {}) {
  const head = [
    { label: t('তারিখ', 'Date'), cls: 'nowrap' },
    { label: t('বিবরণ', 'Description') },
    { label: t('জমা', 'Deposit'), cls: 'num' },
    { label: t('পরিশোধ', 'Payment'), cls: 'num' },
    { label: t('ব্যালেন্স', 'Balance'), cls: 'num' },
  ];
  const body = rows.map(r => [
    esc(fmtDate(r.date)),
    esc(r.description || '—'),
    amountCell(r.deposit, 'in'),
    amountCell(r.payment, 'out'),
    { html: `<b class="num">${esc(money(r.balance))}</b>`, cls: 'num' },
  ]);
  const totals = rows.reduce((a, r) => ({
    deposit: a.deposit + (Number(r.deposit) || 0),
    payment: a.payment + (Number(r.payment) || 0),
  }), { deposit: 0, payment: 0 });
  const foot = footer && rows.length ? [
    { html: `<b>${esc(t('সর্বমোট', 'Total'))}</b>` }, { html: '' },
    { html: `<b class="num">${esc(money(totals.deposit))}</b>`, cls: 'num' },
    { html: `<b class="num">${esc(money(totals.payment))}</b>`, cls: 'num' },
    { html: `<b class="num">${esc(money(rows.length ? rows[rows.length - 1].balance : openingBalance))}</b>`, cls: 'num' },
  ] : null;
  return tableWrap(head, body, {
    footer: foot,
    empty: t('এই সময়ে কোনো লেনদেন নেই', 'No transactions in this period'),
    emptyIcon: 'receipt',
  });
}

/* ================= tags / banners / kv ================= */

export function statusTag(status) {
  const cls = (status === 'active' || status === 'approved') ? 'approved'
    : status === 'pending' ? 'pending'
    : status === 'rejected' ? 'rejected' : 'gray';
  return `<span class="tag ${cls}">${esc(t(STATUS_BN[status], STATUS_EN[status]) || status || '')}</span>`;
}

export function banner(kind, html) {
  const ic = kind === 'err' ? 'warn' : kind === 'warn' ? 'warn' : kind === 'ok' ? 'check' : 'info';
  return el('div', { class: `banner ${kind}`, html: `${icon(ic)}<span>${html}</span>` });
}

export function kv(pairs) {
  const k = el('div', { class: 'kv' });
  pairs.forEach(([a, b]) => {
    k.appendChild(el('div', { text: tx(a) }));
    k.appendChild(el('div', { html: (b === null || b === undefined || b === '') ? '<span class="faint">—</span>' : String(b) }));
  });
  return k;
}

export function tabs(items, active, onPick) {
  const box = el('div', { class: 'tabs' });
  items.forEach(i => box.appendChild(el('button', {
    type: 'button', class: i.id === active ? 'on' : '', text: tx(i.label), onclick: () => onPick(i.id),
  })));
  return box;
}

/* ================= fields ================= */

export function field(label, inputNode, { required = false, hint = '', name = '' } = {}) {
  const f = el('div', { class: 'field' });
  f.appendChild(el('label', { html: `${esc(label)}${required ? ' <span class="req">*</span>' : ''}` }));
  f.appendChild(inputNode);
  if (hint) f.appendChild(el('div', { class: 'hint', text: hint }));
  f.appendChild(el('div', { class: 'err', dataset: { err: name || '' } }));
  return f;
}
export function input(attrs = {}) { return el('input', attrs); }
export function select(options, attrs = {}) {
  const s = el('select', attrs);
  options.forEach(o => s.appendChild(el('option', { value: o.value, ...(o.selected ? { selected: true } : {}) }, [o.label])));
  return s;
}
export function btn(label, iconName, kind = 'ghost', onclick, extra = {}) {
  return el('button', {
    type: 'button',
    class: `btn btn-${kind}${extra.size === 'xs' ? ' btn-xs' : ''}${extra.block ? ' btn-block' : ''}`,
    html: `${iconName ? icon(iconName) : ''}<span>${esc(tx(label))}</span>`, onclick, ...(extra.attrs || {}),
  });
}

/* ================= states ================= */

export function skeleton({ rows = 3, cards = 0, title = '' } = {}) {
  const wrap = el('div', { class: 'page-skeleton' });
  if (title) wrap.appendChild(el('div', { class: 'sk', style: 'height:26px;width:120px;margin-bottom:14px' }));
  if (cards) {
    const g = el('div', { class: 'skgrid' });
    for (let i = 0; i < cards; i++) g.appendChild(el('div', { class: 'sk', style: 'height:76px' }));
    wrap.appendChild(g);
  }
  for (let i = 0; i < rows; i++) {
    wrap.appendChild(el('div', { class: 'sk', style: `height:${i === 0 ? 104 : 60}px;margin-top:12px` }));
  }
  return wrap;
}

export function emptyState({ ic = 'info', title, hint = '', actionLabel = '', onAction = null, compact = false } = {}) {
  const box = el('div', { class: `empty-state${compact ? ' compact' : ''}` });
  box.innerHTML = `<div class="es-ic">${icon(ic)}</div>
    <div class="es-t">${esc(tx(title || t('কোনো তথ্য পাওয়া যায়নি', 'Nothing here yet')))}</div>
    ${hint ? `<div class="es-h">${esc(tx(hint))}</div>` : ''}`;
  if (actionLabel && onAction) box.appendChild(el('button', { type: 'button', class: 'btn btn-primary', text: tx(actionLabel), onclick: onAction }));
  return box;
}

export function errorState({ title, hint = '', onRetry = null } = {}) {
  const box = el('div', { class: 'empty-state err' });
  box.innerHTML = `<div class="es-ic">${icon('warn')}</div>
    <div class="es-t">${esc(tx(title || t('কিছু একটা সমস্যা হয়েছে', 'Something went wrong')))}</div>
    ${hint ? `<div class="es-h">${esc(tx(hint))}</div>` : ''}`;
  if (onRetry) box.appendChild(el('button', { type: 'button', class: 'btn btn-ghost', text: t('আবার চেষ্টা করুন', 'Try again'), onclick: onRetry }));
  return box;
}

export async function withSkeleton(host, render, opts = {}) {
  host.replaceChildren(skeleton(opts));
  try {
    const node = await render();
    host.replaceChildren();
    if (node) host.appendChild(node);
    return node;
  } catch (e) {
    console.error('[ui] render failed', e);
    host.replaceChildren(errorState({ hint: String((e && e.message) || e), onRetry: () => withSkeleton(host, render, opts) }));
    return null;
  }
}

/* ================= segmented controls ================= */

export function segChips(name, options, value, { onChange = null } = {}) {
  const wrap = el('div', { class: 'seg', role: 'radiogroup' });
  const hidden = el('input', { type: 'hidden', name, value: options.some(o => o.value === value) ? value : options[0].value });
  const paint = () => {
    [...wrap.querySelectorAll('.seg-chip')].forEach(b => {
      const on = b.dataset.value === hidden.value;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  };
  options.forEach(o => {
    const b = el('button', { type: 'button', class: 'seg-chip', role: 'radio', 'aria-checked': 'false', text: tx(t(o.bn, o.en)) });
    b.dataset.value = o.value;
    b.addEventListener('click', () => {
      if (hidden.value === o.value) return;
      hidden.value = o.value;
      paint();
      hidden.dispatchEvent(new Event('change', { bubbles: true }));
      if (onChange) onChange(o.value);
    });
    wrap.appendChild(b);
  });
  paint();
  const root = el('div');
  root.append(wrap, hidden);
  return {
    root, hidden, wrap,
    get value() { return hidden.value; },
    set(v) { if (options.some(o => o.value === v) && hidden.value !== v) { hidden.value = v; paint(); } },
    reset() { this.set(options[0].value); },
  };
}

export function optionGrid(name, options, value, { onChange = null, cols = 2 } = {}) {
  const wrap = el('div', { class: `opt-grid${cols === 1 ? ' one-col' : ''}`, role: 'radiogroup' });
  const hidden = el('input', { type: 'hidden', name, value: options.some(o => o.value === value) ? value : options[0].value });
  const paint = () => {
    [...wrap.querySelectorAll('.opt-card')].forEach(b => {
      const on = b.dataset.value === hidden.value;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  };
  options.forEach(o => {
    const b = el('button', {
      type: 'button', class: 'opt-card', role: 'radio', 'aria-checked': 'false',
      html: `<span class="oc-ic">${icon(o.ic || 'plus')}</span><span class="oc-tx">${esc(tx(t(o.bn, o.en)))}</span>`,
    });
    b.dataset.value = o.value;
    b.addEventListener('click', () => {
      if (hidden.value === o.value) return;
      hidden.value = o.value;
      paint();
      hidden.dispatchEvent(new Event('change', { bubbles: true }));
      if (onChange) onChange(o.value);
    });
    wrap.appendChild(b);
  });
  paint();
  const root = el('div');
  root.append(wrap, hidden);
  return {
    root, hidden, wrap,
    get value() { return hidden.value; },
    set(v) { if (options.some(o => o.value === v) && hidden.value !== v) { hidden.value = v; paint(); } },
    reset() { this.set(options[0].value); },
  };
}

/** Icon-tile menu — used only where a hub genuinely has several destinations. */
export function tileMenu(items, onPick, { ariaLabel = '' } = {}) {
  const grid = el('div', { class: 'sec-menu', role: 'list', ...(ariaLabel ? { 'aria-label': ariaLabel } : {}) });
  items.filter(Boolean).forEach(it => {
    const b = el('button', { type: 'button', class: `sec-tile${it.tone ? ' ' + it.tone : ''}`, role: 'listitem', onclick: () => onPick(it.id) });
    b.innerHTML = `<span class="st-ic">${bigIcon(it.ic)}</span>
      <span class="st-tx"><span class="st-t">${esc(t(it.bn, it.en))}</span>${it.sub ? `<span class="st-s">${esc(tx(it.sub))}</span>` : ''}</span>`
      + (it.badge ? `<span class="pill">${it.badge > 99 ? '99+' : it.badge}</span>` : '');
    grid.appendChild(b);
  });
  return grid;
}

/* ================= ids ================= */

export function txnIdChip(id) {
  if (!id) return '';
  return `<button type="button" class="txn-id" data-copy="${esc(id)}" title="${t('কপি করুন', 'Copy')}">${esc(id)}</button>`;
}
export function bindCopyIds(container) {
  container.addEventListener('click', e => {
    const b = e.target.closest ? e.target.closest('[data-copy]') : null;
    if (!b) return;
    e.stopPropagation();
    const v = b.dataset.copy;
    const ok = () => { b.classList.add('copied'); setTimeout(() => b.classList.remove('copied'), 1200); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(v).then(ok).catch(() => {});
    else {
      const ta = el('textarea', { value: v });
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); ok(); } catch { /* ignore */ }
      ta.remove();
    }
  });
}

/* ================= filter sheet ================= */

export function filterSheet({ title, sections = [], dates = null, state = {}, onApply, onClear }) {
  const tmp = { ...state };
  const body = el('div', { class: 'fsheet' });
  sections.forEach(({ key, label, options }) => {
    const sec = el('div', { class: 'fsheet-sec' });
    sec.appendChild(el('div', { class: 'fsheet-lbl', text: tx(label) }));
    sec.appendChild(segChips('f_' + key, options, tmp[key], { onChange: v => { tmp[key] = v; } }).root);
    body.appendChild(sec);
  });
  let fromI = null, toI = null;
  if (dates) {
    const box = el('div', { class: 'fsheet-dates' });
    const mk = (lbl, val) => {
      const f = el('div', { class: 'field' });
      f.appendChild(el('label', { text: tx(lbl) }));
      const i = el('input', { type: 'date', value: val || '' });
      f.appendChild(i); box.appendChild(f);
      return i;
    };
    fromI = mk(dates.fromLabel, tmp.from);
    toI = mk(dates.toLabel, tmp.to);
    body.appendChild(box);
  }
  const bar = el('div', { class: 'fsheet-actions' });
  const applyB = el('button', { type: 'button', class: 'btn btn-primary', text: t('প্রয়োগ করুন', 'Apply') });
  const clearB = el('button', { type: 'button', class: 'btn btn-ghost', text: t('ফিল্টার মুছুন', 'Clear filters') });
  bar.append(applyB, clearB);
  body.appendChild(bar);
  const { close } = bottomSheet({ title: title || t('ফিল্টার', 'Filter'), body });
  applyB.addEventListener('click', () => { if (dates) { tmp.from = fromI.value; tmp.to = toI.value; } close(); onApply(tmp); });
  clearB.addEventListener('click', () => { close(); onClear(); });
}

/* ================= sheet + switch ================= */

/* Every open sheet is tracked so the shell can close them all at once (e.g.
   when a bottom-bar tab is tapped while a sheet is open — the bar is never
   hidden behind a sheet). */
const openSheets = new Set();
export function closeAllSheets() {
  [...openSheets].forEach(h => { try { h.close(); } catch { /* already gone */ } });
}

export function bottomSheet({ title, items = [], body = null, onClose = null, zIndex = 0 } = {}) {
  const back = el('div', { class: 'sheet-backdrop', ...(zIndex ? { style: `z-index:${zIndex}` } : {}) });
  const sheet = el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', ...(zIndex ? { style: `z-index:${zIndex + 1}` } : {}) });
  sheet.appendChild(el('div', { class: 'sheet-grab' }));
  if (title) sheet.appendChild(el('div', { class: 'sheet-title', text: tx(title) }));
  if (body) sheet.appendChild(body);
  const list = el('div', { class: 'sheet-list' });
  let closed = false;
  const handle = { close: () => close() };
  items.forEach(it => {
    if (it === 'sep') { list.appendChild(el('div', { class: 'sheet-sep' })); return; }
    if (it && typeof it === 'object' && it.header) { list.appendChild(el('div', { class: 'sheet-header', text: tx(it.header) })); return; }
    const row = el('button', { type: 'button', class: `sheet-item${it.danger ? ' danger' : ''}` });
    row.innerHTML = `<span class="si-ic">${bigIcon(it.ic || 'info')}</span><span class="si-tx">${esc(tx(it.label))}</span>`;
    if (it.right) { const r = el('span', { class: 'si-right' }); r.appendChild(it.right); row.appendChild(r); }
    else if (it.value != null) row.appendChild(el('span', { class: 'si-val', text: it.value }));
    /* ONE tap: the sheet is removed synchronously first, then the action runs. */
    row.addEventListener('click', ev => {
      ev.preventDefault(); ev.stopPropagation();
      if (!it.keepOpen) close();
      if (typeof it.run === 'function') it.run();
    });
    list.appendChild(row);
  });
  sheet.appendChild(list);
  const close = () => {
    if (closed) return;
    closed = true;
    openSheets.delete(handle);
    back.remove(); sheet.remove();
    document.removeEventListener('keydown', onKey);
    if (typeof onClose === 'function') { try { onClose(); } catch { /* ignore */ } }
  };
  const onKey = e => { if (e.key === 'Escape') close(); };
  back.onclick = close;
  document.addEventListener('keydown', onKey);
  document.body.append(back, sheet);
  openSheets.add(handle);
  requestAnimationFrame(() => { back.classList.add('on'); sheet.classList.add('on'); });
  return handle;
}

export function switchEl(on, onChange) {
  const b = el('button', { type: 'button', class: `switch${on ? ' on' : ''}`, 'aria-pressed': on ? 'true' : 'false', 'aria-label': on ? 'On' : 'Off' });
  b.onclick = e => {
    e.stopPropagation();
    const next = !b.classList.contains('on');
    b.classList.toggle('on', next);
    b.setAttribute('aria-pressed', next ? 'true' : 'false');
    if (onChange) onChange(next);
  };
  return b;
}

/** Render a page function into a host and drop its own page header. */
export async function embedPage(host, pageFn, session, params = {}) {
  const node = await pageFn(session, params);
  const head = node && node.querySelector && node.querySelector('.page-head');
  if (head) head.remove();
  host.replaceChildren(node);
  return node;
}

/* ================= back-compat shims ================= */
export function sectionBar() { return null; }
export function exportBar() { return null; }
export const money2 = money;
export { taka, fmtDate, money, auto };
