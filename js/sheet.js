/* The single print-sheet implementation shared by Statements and Reports.
 *
 * Statements/reports are ALWAYS produced in English — regardless of the UI
 * language — because they are financial documents that get printed, filed and
 * shared. The on-screen preview and the downloaded PDF render the SAME node, so
 * they can never disagree.
 */
import { el, esc, fmtDateEn, fmtDateTime } from './util.js';
import { logoSrc } from './brand.js';

export function sheetHead(cfg, titleEn, subEn) {
  const h = el('header', { class: 'ps-head' });
  const src = logoSrc(cfg);
  const orgEn = (cfg && cfg.orgNameEn) || 'Dhruvo Sangsad';
  h.innerHTML = `
    <img class="ps-logo" src="${esc(src)}" alt="" width="192" height="192">
    <div class="ps-title">${esc(String(orgEn).toUpperCase())}</div>
    ${cfg && cfg.orgNameBn ? `<div class="ps-org">${esc(cfg.orgNameBn)}</div>` : ''}
    <div class="ps-org">${[
      cfg && cfg.orgAddress ? esc(cfg.orgAddress) : '',
      cfg && cfg.orgPhone ? esc(cfg.orgPhone) : '',
    ].filter(Boolean).join(' · ')}</div>
    <div class="ps-sub">${esc(titleEn)}</div>
    ${subEn ? `<div class="ps-period">${esc(subEn)}</div>` : ''}
    <hr class="ps-rule">`;
  return h;
}

export function sheetFoot(cfg, extra = '') {
  const f = el('footer', { class: 'ps-foot' });
  f.innerHTML = `<span>Generated: ${esc(fmtDateTime(new Date().toISOString()))}${extra ? ' · ' + esc(extra) : ''}</span>
    <span>${esc((cfg && cfg.orgNameEn) || 'Dhruvo Sangsad')}</span>`;
  return f;
}

export function psTable(headers, rows, footer) {
  const t = el('table', { class: 'ps-tbl' });
  const th = el('thead'); const tr = el('tr');
  headers.forEach(h => tr.appendChild(el('th', { class: h.cls || '', text: h.label })));
  th.appendChild(tr); t.appendChild(th);
  const tb = el('tbody');
  if (!rows.length) {
    const r = el('tr');
    r.appendChild(el('td', { colSpan: headers.length, class: 'c', text: 'No records found' }));
    tb.appendChild(r);
  }
  rows.forEach(r => {
    const row = el('tr');
    r.forEach((c, i) => row.appendChild(el('td', {
      class: (c && typeof c === 'object' ? c.cls : (headers[i] && headers[i].cls)) || '',
      text: c && typeof c === 'object' ? String(c.text ?? '') : String(c ?? ''),
      colspan: (c && typeof c === 'object' && c.span) || 1,
    })));
    tb.appendChild(row);
  });
  t.appendChild(tb);
  if (footer && footer.length) {
    const tf = el('tfoot');
    footer.forEach(fr => {
      const row = el('tr');
      fr.forEach((c, i) => row.appendChild(el('td', {
        class: (c && typeof c === 'object' ? c.cls : (headers[i] && headers[i].cls)) || '',
        colspan: (c && c.span) || 1,
        text: c && typeof c === 'object' ? String(c.text ?? '') : String(c ?? ''),
      })));
      tf.appendChild(row);
    });
    t.appendChild(tf);
  }
  return t;
}

export function psInfo(pairs) {
  const tbl = el('table', { class: 'ps-info-tbl' });
  const tb = el('tbody');
  const cell = (k, v) => {
    const td = el('td');
    td.appendChild(el('span', { class: 'ps-k', text: k }));
    td.appendChild(document.createTextNode(' '));
    td.appendChild(el('span', { class: 'ps-v', text: v == null || v === '' ? '—' : String(v) }));
    return td;
  };
  for (let i = 0; i < pairs.length; i += 2) {
    const tr = el('tr');
    tr.appendChild(cell(pairs[i][0], pairs[i][1]));
    if (pairs[i + 1]) tr.appendChild(cell(pairs[i + 1][0], pairs[i + 1][1]));
    else tr.appendChild(el('td'));
    tb.appendChild(tr);
  }
  tbl.appendChild(tb);
  return tbl;
}

export function sechead(text) { return el('div', { class: 'ps-sechead', text }); }

/** Build a complete sheet node. `titleBn` is accepted for back-compat but the
 *  printed document is English-only by design. */
export function buildSheet({ cfg, titleEn, subEn = '', parts = [], orientation = 'p' }) {
  const sheet = el('div', { class: `print-sheet${orientation === 'l' ? ' land' : ''}` });
  sheet.appendChild(sheetHead(cfg || {}, titleEn, subEn));
  parts.forEach(p => { if (p) sheet.appendChild(p); });
  sheet.appendChild(sheetFoot(cfg || {}));
  return sheet;
}

export { fmtDateEn };
