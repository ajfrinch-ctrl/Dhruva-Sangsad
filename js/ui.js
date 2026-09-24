/* Shared page building blocks */
import { el, esc, money, taka, fmtDate, STATUS_BN, STATUS_EN, t, tx } from './util.js';
import { icon } from './icons.js';

export function page(titleBn, titleEn, iconName, actions = []) {
  const wrap = el('div');
  const head = el('div', { class: 'page-head' });
  head.innerHTML = `<h1>${icon(iconName)} ${esc(t(titleBn, titleEn))}</h1><span class="spacer"></span>`;
  actions.forEach(a => head.appendChild(a));
  wrap.appendChild(head);
  return wrap;
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

export function statCard({ label, value, sub, tone = '', ic = 'money' }) {
  return el('div', { class: `stat ${tone}`, html: `
    <div class="lbl">${icon(ic)} ${esc(tx(label))}</div>
    <div class="val">${value}</div>
    ${sub ? `<div class="sub">${esc(tx(sub))}</div>` : ''}` });
}

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
    type: 'button', class: `btn btn-${kind}${extra.size === 'xs' ? ' btn-xs' : ''}${extra.block ? ' btn-block' : ''}`,
    html: `${iconName ? icon(iconName) : ''}<span>${esc(tx(label))}</span>`, onclick, ...(extra.attrs || {}),
  });
}

export function tableWrap(headers, rows, { footer = null, empty, emptyIcon = 'info' } = {}) {
  empty = empty || t('কোনো তথ্য পাওয়া যায়নি', 'No records found');
  const wrap = el('div', { class: 'tbl-wrap' });
  if (!rows.length) {
    wrap.appendChild(emptyState({ ic: emptyIcon, title: empty, compact: true }));
    return wrap;
  }
  const tbl = el('table', { class: 'tbl' });
  const thead = el('thead');
  const tr = el('tr');
  headers.forEach(h => tr.appendChild(el('th', { class: h.cls || '', text: tx(h.label !== undefined ? h.label : h) })));
  thead.appendChild(tr); tbl.appendChild(thead);
  /* Column labels are kept on every cell so narrow screens can turn each row
     into a card (see the "responsive card table" block in app.css). */
  const labels = headers.map(h => tx(h.label !== undefined ? h.label : h));
  const tb = el('tbody');
  rows.forEach(r => {
    const row = el('tr');
    r.forEach((c, i) => {
      const label = labels[i] || '';
      if (c && c.nodeType) { const td = el('td', { dataset: { label } }); td.appendChild(c); row.appendChild(td); }
      else if (c && typeof c === 'object') {
        const td = el('td', { class: c.cls || '', dataset: { label } });
        if (c.node) td.appendChild(c.node); else td.innerHTML = c.html !== undefined ? c.html : esc(c.text ?? '');
        row.appendChild(td);
      } else row.appendChild(el('td', { dataset: { label }, html: c === null || c === undefined ? '' : String(c) }));
    });
    tb.appendChild(row);
  });
  tbl.appendChild(tb);
  if (footer) {
    const tf = el('tfoot'); const fr = el('tr');
    footer.forEach(c => {
      if (c && typeof c === 'object' && !c.nodeType) fr.appendChild(el('td', { class: c.cls || '', html: c.html !== undefined ? c.html : esc(c.text ?? '') }));
      else fr.appendChild(el('td', { html: String(c ?? '') }));
    });
    tf.appendChild(fr); tbl.appendChild(tf);
  }
  wrap.appendChild(tbl);
  return wrap;
}

export function statusTag(status) {
  const cls = status === 'active' || status === 'approved' ? 'approved' : status === 'pending' ? 'pending' : status === 'rejected' ? 'rejected' : 'gray';
  return `<span class="tag ${cls}">${esc(t(STATUS_BN[status], STATUS_EN[status]) || status)}</span>`;
}
export function statusTagBn(status) { return statusTag(status); }

export function banner(kind, html) { return el('div', { class: `banner ${kind}`, html: `${icon(kind === 'err' ? 'warn' : kind === 'warn' ? 'warn' : kind === 'ok' ? 'check' : 'info')}<span>${html}</span>` }); }

export function kv(pairs) {
  const k = el('div', { class: 'kv' });
  pairs.forEach(([a, b]) => { k.appendChild(el('div', { text: tx(a) })); k.appendChild(el('div', { html: b === null || b === undefined || b === '' ? '<span class="faint">—</span>' : String(b) })); });
  return k;
}

export function tabs(items, active, onPick) {
  const t = el('div', { class: 'tabs' });
  items.forEach(i => t.appendChild(el('button', {
    type: 'button', class: i.id === active ? 'on' : '', text: tx(i.label), onclick: () => onPick(i.id),
  })));
  return t;
}

export function money2(v) { return money(v); }
export { taka, fmtDate };

/* ------------------------------------------------------------------ *
 * States — skeleton · empty · error · offline  (mobile-first)
 * ------------------------------------------------------------------ */

/**
 * Loading placeholder. `rows` = list rows, `cards` = stat cards.
 * Shows a shimmering skeleton instead of a blank screen.
 */
export function skeleton({ rows = 4, cards = 0, title = '' } = {}) {
  const wrap = el('div', { class: 'sk-wrap' });
  if (title) wrap.appendChild(el('div', { class: 'sk-line sk-title', style: 'width:120px;margin-bottom:12px' }));
  if (cards) {
    const g = el('div', { class: 'stat-grid' });
    for (let i = 0; i < cards; i++) {
      g.appendChild(el('div', { class: 'sk-card', html: '<i class="sk-line" style="width:52%"></i><i class="sk-line sk-big"></i><i class="sk-line" style="width:38%"></i>' }));
    }
    wrap.appendChild(g);
  }
  for (let i = 0; i < rows; i++) {
    wrap.appendChild(el('div', { class: 'sk-row', html: `
      <i class="sk-dot"></i>
      <span class="sk-lines"><i class="sk-line" style="width:${58 + (i % 3) * 12}%"></i><i class="sk-line sk-sm" style="width:${30 + (i % 4) * 10}%"></i></span>` }));
  }
  return wrap;
}

/** Empty state with an icon, a message, an optional hint and one action. */
export function emptyState({ ic = 'info', title, hint = '', actionLabel = '', onAction = null, compact = false } = {}) {
  const box = el('div', { class: `empty-state${compact ? ' compact' : ''}` });
  box.innerHTML = `
    <div class="es-ic">${icon(ic)}</div>
    <div class="es-t">${esc(tx(title || t('কোনো তথ্য পাওয়া যায়নি', 'Nothing here yet')))}</div>
    ${hint ? `<div class="es-h">${esc(tx(hint))}</div>` : ''}`;
  if (actionLabel && onAction) {
    const b = el('button', { type: 'button', class: 'btn-primary sm', text: tx(actionLabel), onclick: onAction });
    box.appendChild(b);
  }
  return box;
}

/** Error state with a retry button. */
export function errorState({ title, hint = '', onRetry = null } = {}) {
  const box = el('div', { class: 'empty-state err' });
  box.innerHTML = `
    <div class="es-ic">${icon('warn')}</div>
    <div class="es-t">${esc(tx(title || t('কিছু একটা সমস্যা হয়েছে', 'Something went wrong')))}</div>
    ${hint ? `<div class="es-h">${esc(tx(hint))}</div>` : ''}`;
  if (onRetry) box.appendChild(el('button', { type: 'button', class: 'btn-ghost sm', text: t('আবার চেষ্টা করুন', 'Try again'), onclick: onRetry }));
  return box;
}

/**
 * Wrap an async render: paint a skeleton, then the real content; on failure
 * show an error state with a retry button.
 *   body.appendChild(await withSkeleton(host, () => renderThing()));
 */
export async function withSkeleton(host, render, opts = {}) {
  host.innerHTML = '';
  host.appendChild(skeleton(opts));
  try {
    const node = await render();
    host.innerHTML = '';
    if (node) host.appendChild(node);
    return node;
  } catch (e) {
    console.error('[ui] render failed', e);
    host.innerHTML = '';
    host.appendChild(errorState({ hint: String(e && e.message || e), onRetry: () => withSkeleton(host, render, opts) }));
    return null;
  }
}

/** Mobile bottom sheet (used by the “More” menu). Returns { close }. */
export function bottomSheet({ title, items = [] } = {}) {
  const back = el('div', { class: 'sheet-backdrop' });
  const sheet = el('div', { class: 'sheet' });
  sheet.appendChild(el('div', { class: 'sheet-grab' }));
  if (title) sheet.appendChild(el('div', { class: 'sheet-title', text: tx(title) }));
  const list = el('div', { class: 'sheet-list' });
  items.forEach(it => {
    if (it === 'sep') { list.appendChild(el('div', { class: 'sheet-sep' })); return; }
    const row = el('button', { type: 'button', class: `sheet-item${it.danger ? ' danger' : ''}` });
    row.innerHTML = `<span class="si-ic">${icon(it.ic || 'info')}</span><span class="si-tx">${esc(tx(it.label))}</span>`;
    if (it.right) { const r = el('span', { class: 'si-right' }); r.appendChild(it.right); row.appendChild(r); }
    else if (it.value != null) row.appendChild(el('span', { class: 'si-val', text: it.value }));
    row.onclick = () => { if (!it.keepOpen) close(); if (typeof it.run === 'function') it.run(); };
    list.appendChild(row);
  });
  sheet.appendChild(list);
  const close = () => {
    back.remove(); sheet.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = e => { if (e.key === 'Escape') close(); };
  back.onclick = close;
  document.addEventListener('keydown', onKey);
  document.body.append(back, sheet);
  requestAnimationFrame(() => { back.classList.add('on'); sheet.classList.add('on'); });
  return { close };
}

/** Small on/off switch used inside sheets and settings rows. */
export function switchEl(on, onChange) {
  const b = el('button', { type: 'button', class: `switch${on ? ' on' : ''}`, 'aria-pressed': on ? 'true' : 'false' });
  b.onclick = e => {
    e.stopPropagation();
    const next = !b.classList.contains('on');
    b.classList.toggle('on', next);
    b.setAttribute('aria-pressed', next ? 'true' : 'false');
    if (onChange) onChange(next);
  };
  return b;
}

/** Render a page function into a host, stripping its own page header (used by hub pages). */
export async function embedPage(host, pageFn, session, params = {}) {
  const node = await pageFn(session, params);
  const head = node && node.querySelector && node.querySelector('.page-head');
  if (head) head.remove();
  host.replaceChildren(node);
  return node;
}
