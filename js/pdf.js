/* Offline PDF generation.
   Bangla is a complex script (conjuncts + reordered vowel signs) that raw TTF
   embedding in jsPDF cannot shape correctly, so the print sheet is laid out in
   HTML with locally bundled Noto Sans Bengali / Arial, rasterised by the
   browser's own shaping engine (html2canvas) and paginated into a jsPDF A4
   document. Everything used here is bundled locally — no network required. */

import { downloadBlob, toast } from './util.js';

const A4 = { w: 210, h: 297 };

function jsPDFCtor() {
  const ns = window.jspdf || window.jsPDF;
  const C = ns && (ns.jsPDF || ns);
  if (!C) throw new Error('PDF engine unavailable');
  return C;
}

async function fontsReady() {
  try {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    if (document.fonts && document.fonts.load) {
      await Promise.all([
        document.fonts.load('400 10pt "Noto Sans Bengali"', 'ধ্রুব সংসদ'),
        document.fonts.load('700 10pt "Noto Sans Bengali"', 'ধ্রুব সংসদ'),
      ]);
    }
  } catch { /* ignore */ }
}

/** Render a .print-sheet node into a multi-page A4 PDF and download it. */
export async function sheetToPdf(node, filename, { orientation = 'p' } = {}) {
  if (!node) throw new Error('Nothing to export');
  await fontsReady();
  const pw = orientation === 'l' ? A4.h : A4.w;
  const ph = orientation === 'l' ? A4.w : A4.h;

  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-10000px;top:0;background:#fff;z-index:-1;';
  const clone = node.cloneNode(true);
  clone.classList.add('pdf-render');
  clone.style.width = pw + 'mm';
  clone.style.margin = '0';
  clone.style.boxShadow = 'none';
  holder.appendChild(clone);
  document.body.appendChild(holder);

  try {
    const canvas = await window.html2canvas(clone, {
      scale: Math.min(3, Math.max(2, window.devicePixelRatio || 2)),
      backgroundColor: '#ffffff',
      useCORS: true, logging: false, imageTimeout: 0,
      windowWidth: clone.scrollWidth,
    });

    const Ctor = jsPDFCtor();
    const pdf = new Ctor({ orientation, unit: 'mm', format: 'a4', compress: true });
    const pxPerMm = canvas.width / pw;
    const pagePx = Math.floor(ph * pxPerMm);
    const pages = Math.max(1, Math.ceil(canvas.height / pagePx));

    for (let i = 0; i < pages; i++) {
      const sliceH = Math.min(pagePx, canvas.height - i * pagePx);
      const c = document.createElement('canvas');
      c.width = canvas.width; c.height = sliceH;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(canvas, 0, i * pagePx, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
      const img = c.toDataURL('image/jpeg', 0.94);
      if (i > 0) pdf.addPage();
      pdf.addImage(img, 'JPEG', 0, 0, pw, sliceH / pxPerMm, undefined, 'FAST');
    }
    const blob = pdf.output('blob');
    downloadBlob(blob, filename.endsWith('.pdf') ? filename : filename + '.pdf');
    return true;
  } finally {
    holder.remove();
  }
}

/* ---------------- Excel / CSV ---------------- */

export function toCSV(rows) {
  return rows.map(r => r.map(c => {
    const s = c === null || c === undefined ? '' : String(c);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\r\n');
}

export function downloadCSV(rows, filename) {
  const csv = '\uFEFF' + toCSV(rows);
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), filename.endsWith('.csv') ? filename : filename + '.csv');
}

export function downloadExcel(sheets, filename) {
  if (!window.XLSX) { toast('Excel engine unavailable', 'error'); return false; }
  const wb = window.XLSX.utils.book_new();
  const list = Array.isArray(sheets) ? sheets : [sheets];
  list.forEach((s, i) => {
    const ws = window.XLSX.utils.aoa_to_sheet(s.rows);
    const widths = (s.rows[0] || []).map((_, ci) => ({
      wch: Math.min(38, Math.max(10, ...s.rows.map(r => String(r[ci] ?? '').length + 2))),
    }));
    ws['!cols'] = widths;
    window.XLSX.utils.book_append_sheet(wb, ws, (s.name || `Sheet${i + 1}`).slice(0, 31));
  });
  const out = window.XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  downloadBlob(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    filename.endsWith('.xlsx') ? filename : filename + '.xlsx');
  return true;
}

export function safeName(s) {
  return String(s || 'report').replace(/[^\w\-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}
