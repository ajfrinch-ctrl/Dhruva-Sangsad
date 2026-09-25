/* Report preview + PDF-only download (one shared implementation).
   The modal shows the EXACT sheet node that sheetToPdf renders — preview and
   PDF can never diverge. */
import { el, esc, toast, t, fileStamp } from './util.js';
import { icon } from './icons.js';
import { sheetToPdf, safeName } from './pdf.js';

/** Sanitized PDF name: MemberName_ReportType_YYYY-MM-DD_HH-mm.pdf */
export function reportFileName({ memberName = '', reportType, orgName = 'Dhruva_Sangsad' }) {
  const who = safeName(memberName || orgName || 'Dhruva_Sangsad');
  const type = safeName(reportType || 'Report');
  return `${who}_${type}_${fileStamp()}.pdf`;
}

/** Fit the A4 sheet into the modal width without changing the node itself. */
function fitSheet(holder, sheet) {
  const apply = () => {
    const avail = holder.clientWidth - 8;
    const natural = 794; /* 210mm at 96dpi (297mm in landscape) */
    const naturalW = sheet.classList.contains('land') ? 1123 : natural;
    const zoom = Math.min(1, Math.max(0.34, avail / naturalW));
    sheet.style.zoom = zoom;
    holder.style.height = Math.ceil(sheet.offsetHeight * zoom + 8) + 'px';
  };
  apply();
  if (window.ResizeObserver) { const ro = new ResizeObserver(apply); ro.observe(holder); return () => ro.disconnect(); }
  window.addEventListener('resize', apply);
  return () => window.removeEventListener('resize', apply);
}

/**
 * Open the preview popup.
 * { title, sheet, fileName, orientation } — returns a Promise that resolves
 * when the modal closes. The sheet node is MOVED into the modal (same node the
 * PDF renderer will clone), so preview === download.
 */
export function previewReport({ title = '', sheet, fileName, orientation = 'p' }) {
  return new Promise(resolve => {
    const back = el('div', { class: 'modal-back rpv' });
    const box = el('div', { class: 'modal rpv-modal' });
    const head = el('div', { class: 'modal-head' });
    head.innerHTML = `<h3>${icon('report')} ${esc(title || t('রিপোর্ট প্রিভিউ', 'Report Preview'))}</h3>`;
    const closeB = el('button', { class: 'icon-btn rpv-x', type: 'button', 'aria-label': t('বন্ধ', 'Close'), html: '&times;' });
    head.appendChild(closeB);

    const bd = el('div', { class: 'modal-body rpv-body' });
    const holder = el('div', { class: 'sheet-holder rpv-holder' });
    holder.appendChild(sheet);
    bd.appendChild(holder);
    const unbind = fitSheet(holder, sheet);

    const ft = el('div', { class: 'modal-foot rpv-foot' });
    const dl = el('button', {
      type: 'button', class: 'btn btn-primary btn-block',
      html: `${icon('pdf')}<span>${t('পিডিএফ ডাউনলোড', 'Download PDF')}</span>`,
    });
    dl.addEventListener('click', async () => {
      dl.disabled = true;
      dl.innerHTML = `<span class="spin" style="border-color:rgba(255,255,255,.4);border-top-color:#fff"></span><span>${t('তৈরি হচ্ছে…', 'Generating…')}</span>`;
      try {
        await sheetToPdf(sheet, fileName, { orientation });
        toast(t('PDF ডাউনলোড হয়েছে', 'PDF downloaded'), 'success');
      } catch (err) {
        toast(t('PDF তৈরি ব্যর্থ: ', 'PDF failed: ') + err.message, 'error');
      } finally {
        dl.disabled = false;
        dl.innerHTML = `${icon('pdf')}<span>${t('পিডিএফ ডাউনলোড', 'Download PDF')}</span>`;
      }
    });
    ft.appendChild(dl);

    box.append(head, bd, ft);
    back.appendChild(box);
    document.body.appendChild(back);
    const done = () => { unbind(); back.remove(); resolve(); };
    closeB.addEventListener('click', done);
    back.addEventListener('click', e => { if (e.target === back) done(); });
    document.addEventListener('keydown', function onKey(e) {
      if (!back.isConnected) document.removeEventListener('keydown', onKey);
      else if (e.key === 'Escape') { document.removeEventListener('keydown', onKey); done(); }
    });
  });
}
