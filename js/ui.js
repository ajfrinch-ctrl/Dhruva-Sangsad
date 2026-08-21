/* Shared page building blocks */
import { el, esc, money, taka, fmtDate, STATUS_BN, STATUS_EN } from './util.js';
import { icon } from './icons.js';

export function page(titleBn, titleEn, iconName, actions = []) {
  const wrap = el('div');
  const head = el('div', { class: 'page-head' });
  head.innerHTML = `<h1>${icon(iconName)} ${esc(titleBn)}</h1><span class="sub">${esc(titleEn)}</span><span class="spacer"></span>`;
  actions.forEach(a => head.appendChild(a));
  wrap.appendChild(head);
  return wrap;
}

export function card(titleBn, titleEn, bodyNode, headExtras = []) {
  const c = el('div', { class: 'card' });
  if (titleBn || titleEn) {
    const h = el('div', { class: 'card-head' });
    h.innerHTML = `<h3>${esc(titleBn || '')}</h3>${titleEn ? `<span class="fs8 muted">${esc(titleEn)}</span>` : ''}<span class="spacer"></span>`;
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
    <div class="lbl">${icon(ic)} ${esc(label)}</div>
    <div class="val">${value}</div>
    ${sub ? `<div class="sub">${esc(sub)}</div>` : ''}` });
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
    html: `${iconName ? icon(iconName) : ''}<span>${esc(label)}</span>`, onclick, ...(extra.attrs || {}),
  });
}

export function tableWrap(headers, rows, { footer = null, empty = 'কোনো তথ্য পাওয়া যায়নি / No records found', emptyIcon = 'info' } = {}) {
  const wrap = el('div', { class: 'tbl-wrap' });
  if (!rows.length) {
    wrap.appendChild(el('div', { class: 'empty', html: `${icon(emptyIcon)}${esc(empty)}` }));
    return wrap;
  }
  const t = el('table', { class: 'tbl' });
  const thead = el('thead');
  const tr = el('tr');
  headers.forEach(h => tr.appendChild(el('th', { class: h.cls || '', text: h.label !== undefined ? h.label : h })));
  thead.appendChild(tr); t.appendChild(thead);
  const tb = el('tbody');
  rows.forEach(r => {
    const row = el('tr');
    r.forEach(c => {
      if (c && c.nodeType) { const td = el('td'); td.appendChild(c); row.appendChild(td); }
      else if (c && typeof c === 'object') {
        const td = el('td', { class: c.cls || '' });
        if (c.node) td.appendChild(c.node); else td.innerHTML = c.html !== undefined ? c.html : esc(c.text ?? '');
        row.appendChild(td);
      } else row.appendChild(el('td', { html: c === null || c === undefined ? '' : String(c) }));
    });
    tb.appendChild(row);
  });
  t.appendChild(tb);
  if (footer) {
    const tf = el('tfoot'); const fr = el('tr');
    footer.forEach(c => {
      if (c && typeof c === 'object' && !c.nodeType) fr.appendChild(el('td', { class: c.cls || '', html: c.html !== undefined ? c.html : esc(c.text ?? '') }));
      else fr.appendChild(el('td', { html: String(c ?? '') }));
    });
    tf.appendChild(fr); t.appendChild(tf);
  }
  wrap.appendChild(t);
  return wrap;
}

export function statusTag(status) {
  const cls = status === 'active' || status === 'approved' ? 'approved' : status === 'pending' ? 'pending' : status === 'rejected' ? 'rejected' : 'gray';
  return `<span class="tag ${cls}">${esc(STATUS_EN[status] || status)}</span>`;
}
export function statusTagBn(status) {
  const cls = status === 'active' || status === 'approved' ? 'approved' : status === 'pending' ? 'pending' : status === 'rejected' ? 'rejected' : 'gray';
  return `<span class="tag ${cls}">${esc(STATUS_BN[status] || status)}</span>`;
}

export function banner(kind, html) { return el('div', { class: `banner ${kind}`, html: `${icon(kind === 'err' ? 'warn' : kind === 'warn' ? 'warn' : kind === 'ok' ? 'check' : 'info')}<span>${html}</span>` }); }

export function kv(pairs) {
  const k = el('div', { class: 'kv' });
  pairs.forEach(([a, b]) => { k.appendChild(el('div', { text: a })); k.appendChild(el('div', { html: b === null || b === undefined || b === '' ? '<span class="faint">—</span>' : String(b) })); });
  return k;
}

export function tabs(items, active, onPick) {
  const t = el('div', { class: 'tabs' });
  items.forEach(i => t.appendChild(el('button', {
    type: 'button', class: i.id === active ? 'on' : '', text: i.label, onclick: () => onPick(i.id),
  })));
  return t;
}

export function money2(v) { return money(v); }
export { taka, fmtDate };

/** Render a page function into a host, stripping its own page header (used by hub pages). */
export async function embedPage(host, pageFn, session, params = {}) {
  const node = await pageFn(session, params);
  const head = node && node.querySelector && node.querySelector('.page-head');
  if (head) head.remove();
  host.replaceChildren(node);
  return node;
}
