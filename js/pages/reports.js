/* Reports: Statement, Overall, Daily, Monthly, Due, Advance, Collection,
   Payment Method, Date Range, Member-wise — with PDF / Excel / CSV export. */
import {
  el, esc, toast, taka, money, num, fmtDate, fmtDateTime, todayISO, monthKey, monthLabel,
  typeLabel, methodLabel, PAY_METHODS, waNumber, modal, t,
} from '../util.js';
import { icon } from '../icons.js';
import { page, card, tableWrap, banner, btn, statCard } from '../ui.js';
import {
  allMembers, allDeposits, allWithdrawals, settings, memberSummary, summariesFor, orgTotals,
  statementRows, approvedOf, DEFAULT_SETTINGS, withdrawalTypeLabel,
} from '../store.js';
import { sheetToPdf, downloadCSV, downloadExcel, safeName } from '../pdf.js';
import { can } from '../auth.js';

/* ---------------- WhatsApp due reminder ---------------- */
let WA_TPL = DEFAULT_SETTINGS.waTemplate;
settings().then(s => { if (s.waTemplate) WA_TPL = s.waTemplate; }).catch(() => {});

/** Exact Bangla due-reminder text with [Member Name] substituted. No amount is included. */
export function dueMessage(name, tpl) {
  return String(tpl || WA_TPL).replace(/\[Member Name\]/g, String(name || '').trim());
}
export async function sendWaReminder(member) {
  const cfg = await settings();
  WA_TPL = cfg.waTemplate || WA_TPL;
  const msg = dueMessage(member.nameBn || member.nameEn, WA_TPL);
  window.open(`https://wa.me/${waNumber(member.whatsapp || member.mobile)}?text=${encodeURIComponent(msg)}`, '_blank');
}

/* ---------------- print-sheet builders ---------------- */
export function sheetHead(cfg, titleEn, subEn) {
  const h = el('header', { class: 'ps-head' });
  h.innerHTML = `
    <img class="ps-logo" src="${esc(logoSrc(cfg))}" alt="">
    <div class="ps-title">${esc(cfg.orgNameBn || 'ধ্রুব সংসদ')}</div>
    <div class="ps-org">${esc(cfg.orgNameEn || 'Dhruvo Sangsad')}${cfg.orgAddress ? ' · ' + esc(cfg.orgAddress) : ''}${cfg.orgPhone ? ' · ' + esc(cfg.orgPhone) : ''}</div>
    <div class="ps-sub">${esc(titleEn)}</div>
    ${subEn ? `<div class="ps-org">${esc(subEn)}</div>` : ''}
    <hr class="ps-rule">`;
  return h;
}
export function sheetFoot(cfg, extra = '') {
  const f = el('footer', { class: 'ps-foot' });
  f.innerHTML = `<span>Generated: ${esc(fmtDateTime(new Date().toISOString()))}${extra ? ' · ' + esc(extra) : ''}</span>
    <span>${esc(cfg.orgNameBn || 'ধ্রুব সংসদ')}${cfg.orgNameEn ? ' · ' + esc(cfg.orgNameEn) : ''}</span>`;
  return f;
}
export function psTable(headers, rows, footer) {
  const t = el('table', { class: 'ps-tbl' });
  const th = el('thead'); const tr = el('tr');
  headers.forEach(h => tr.appendChild(el('th', { class: h.cls || '', text: h.label })));
  th.appendChild(tr); t.appendChild(th);
  const tb = el('tbody');
  if (!rows.length) {
    const r = el('tr'); r.appendChild(el('td', { colSpan: headers.length, class: 'c', text: 'No records found' })); tb.appendChild(r);
  }
  rows.forEach(r => {
    const row = el('tr');
    r.forEach((c, i) => row.appendChild(el('td', { class: (c && typeof c === 'object' ? c.cls : headers[i] && headers[i].cls) || '', text: c && typeof c === 'object' ? String(c.text ?? '') : String(c ?? '') })));
    tb.appendChild(row);
  });
  t.appendChild(tb);
  if (footer && footer.length) {
    const tf = el('tfoot');
    footer.forEach(fr => {
      const row = el('tr');
      fr.forEach((c, i) => row.appendChild(el('td', { class: (c && typeof c === 'object' ? c.cls : headers[i] && headers[i].cls) || '', colSpan: (c && c.span) || 1, text: c && typeof c === 'object' ? String(c.text ?? '') : String(c ?? '') })));
      tf.appendChild(row);
    });
    t.appendChild(tf);
  }
  return t;
}
function psInfo(pairs) {
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
function sechead(text) { return el('div', { class: 'ps-sechead', text }); }

/* ---------------- report registry ---------------- */
const REPORTS = [
  { id: 'statement', bn: 'সদস্য স্টেটমেন্ট', en: 'Member Statement', roles: ['admin', 'maker', 'member'] },
  { id: 'overall', bn: 'সার্বিক প্রতিবেদন', en: 'Overall Report', roles: ['admin', 'maker'] },
  { id: 'daily', bn: 'দৈনিক প্রতিবেদন', en: 'Daily Report', roles: ['admin', 'maker'] },
  { id: 'monthly', bn: 'মাসিক প্রতিবেদন', en: 'Monthly Report', roles: ['admin', 'maker'] },
  { id: 'due', bn: 'বকেয়া প্রতিবেদন', en: 'Due Report', roles: ['admin', 'maker'] },
  { id: 'advance', bn: 'অগ্রিম প্রতিবেদন', en: 'Advance Report', roles: ['admin', 'maker'] },
  { id: 'collection', bn: 'আদায় প্রতিবেদন', en: 'Collection Report', roles: ['admin', 'maker'] },
  { id: 'method', bn: 'পরিশোধ পদ্ধতি প্রতিবেদন', en: 'Payment Method Report', roles: ['admin', 'maker'] },
  { id: 'range', bn: 'তারিখ অনুযায়ী প্রতিবেদন', en: 'Date Range Report', roles: ['admin', 'maker', 'member'] },
  { id: 'memberwise', bn: 'সদস্যভিত্তিক প্রতিবেদন', en: 'Member-wise Report', roles: ['admin', 'maker'] },
  { id: 'withdrawal', bn: 'উত্তোলন প্রতিবেদন', en: 'Withdrawal Report', roles: ['admin', 'maker', 'member'] },
];

export async function pageReports(session, params = {}) {
  const [members, deposits, cfg] = await Promise.all([allMembers(), allDeposits(), settings()]);
  WA_TPL = cfg.waTemplate || WA_TPL;
  const wrap = page('প্রতিবেদন', 'Reports', 'report');
  const list = REPORTS.filter(r => r.roles.includes(session.role));

  const picker = el('select', { name: 'report' });
  list.forEach(r => picker.appendChild(el('option', { value: r.id }, [t(r.bn, r.en)])));
  if (params.report && list.some(r => r.id === params.report)) picker.value = params.report;

  const pf = el('div', { class: 'field', style: 'flex:1 1 240px' });
  pf.appendChild(el('label', { text: t('প্রতিবেদন নির্বাচন', 'Select Report') }));
  pf.appendChild(picker);

  const filterHost = el('div', { class: 'toolbar', style: 'flex:1 1 100%' });
  const top = el('div', { class: 'toolbar' });
  top.append(pf, filterHost);
  wrap.appendChild(card('প্রতিবেদন নির্বাচন ও ফিল্টার', 'Report Selection & Filters', top));

  const out = el('div');
  wrap.appendChild(out);

  const ctx = { session, members, deposits, withdrawals: [], cfg, out, filterHost, render: null };
  ctx.withdrawals = await allWithdrawals().catch(() => []);

  const build = () => {
    filterHost.replaceChildren();
    out.replaceChildren();
    ctx.render = null;
    const r = REPORTS.find(x => x.id === picker.value) || list[0];
    BUILDERS[r.id](ctx, r);
  };

  // "Generate Report" button — the report is rendered only on click, using fresh data.
  const genRow = el('div', { class: 'btn-row', style: 'margin-bottom:10px' });
  genRow.appendChild(btn(t('রিপোর্ট তৈরি করুন', 'Generate Report'), 'report', 'primary', async () => {
    const [m2, d2, c2] = await Promise.all([allMembers(), allDeposits(), settings()]);
    ctx.members = m2; ctx.deposits = d2; ctx.cfg = c2; WA_TPL = c2.waTemplate || WA_TPL;
    ctx.withdrawals = await allWithdrawals().catch(() => []);
    if (!ctx.render) {
      build(); // (re)initialise the builder with fresh data (e.g. members now exist)
    }
    if (!ctx.render) { toast('প্রতিবেদন নির্বাচন করুন / Select a report first', 'warn'); return; }
    await ctx.render();
  }));
  wrap.appendChild(genRow);

  picker.addEventListener('change', build);
  build();
  return wrap;
}

/* ---------------- shared output shell (report opens in a modal) ---------------- */
function outputCard(ctx, { titleBn, titleEn, sheet, screen, excelRows, fileBase, orientation = 'p', criteria = '' }) {
  ctx.out.replaceChildren();

  const body = el('div');
  if (criteria) {
    body.appendChild(el('div', { class: 'banner info', html: `${icon('filter')}<span>${esc(criteria)}</span>` }));
  }
  if (screen) body.appendChild(screen);
  sheet.classList.add('sheet-offscreen');
  body.appendChild(sheet);

  const doPdf = async () => {
    toast('PDF তৈরি হচ্ছে… / Generating PDF…', 'info', 1600);
    try {
      await sheetToPdf(sheet, safeName(fileBase) + '.pdf', { orientation });
      toast('PDF ডাউনলোড হয়েছে / PDF downloaded', 'success');
    } catch (err) { toast('PDF তৈরি ব্যর্থ: ' + err.message, 'error'); }
  };
  const doExcel = () => {
    downloadExcel([{ name: titleEn.slice(0, 28), rows: excelRows() }], safeName(fileBase) + '.xlsx');
    toast('Excel ডাউনলোড হয়েছে / Excel downloaded', 'success');
  };
  const doCsv = () => {
    downloadCSV(excelRows(), safeName(fileBase) + '.csv');
    toast('CSV ডাউনলোড হয়েছে / CSV downloaded', 'success');
  };

  return modal({
    title: `${titleBn} / ${titleEn}`,
    body,
    width: 960,
    actions: [
      { label: 'Download PDF', kind: 'softred', value: null, onClick: () => { doPdf(); return false; } },
      { label: 'Download Excel', kind: 'soft', value: null, onClick: () => { doExcel(); return false; } },
      { label: 'Download CSV', kind: 'ghost', value: null, onClick: () => { doCsv(); return false; } },
      { label: 'Print', kind: 'ghost', value: null, onClick: () => { doPdf(); return false; } },
      { label: 'Close', kind: 'primary', value: true },
    ],
  });
}

function mkField(label, node, w = '140px') {
  const f = el('div', { class: 'field', style: `flex:0 1 ${w}` });
  f.appendChild(el('label', { text: label }));
  f.appendChild(node);
  return f;
}
function memberSelect(members, { includeAll = false, value = '' } = {}) {
  const s = el('select');
  if (includeAll) s.appendChild(el('option', { value: '' }, ['সকল সদস্য / All Members']));
  else s.appendChild(el('option', { value: '' }, ['— সদস্য নির্বাচন / Select member —']));
  members.slice().sort((a, b) => a.memberId.localeCompare(b.memberId)).forEach(m => {
    s.appendChild(el('option', { value: m.id, ...(value === m.id ? { selected: true } : {}) }, [`${m.memberId} — ${m.nameBn || m.nameEn}`]));
  });
  return s;
}
const cfgOf = ctx => ({ countSpecialTowardsInstallment: ctx.cfg.countSpecialTowardsInstallment });

/* ================= 1. Member Statement ================= */
function rStatement(ctx, meta) {
  const { session } = ctx;
  const own = session.role === 'member';
  const pool = () => own ? ctx.members.filter(m => m.id === session.memberDocId) : ctx.members;
  if (!pool().length) { ctx.out.appendChild(banner('info', 'কোনো সদস্য পাওয়া যায়নি / No member found')); return; }

  const sel = memberSelect(pool(), { value: own ? session.memberDocId : (pool()[0] && pool()[0].id) });
  if (own) sel.disabled = true;
  const from = el('input', { type: 'date' });
  const to = el('input', { type: 'date' });
  ctx.filterHost.append(mkField('সদস্য / Member', sel, '220px'), mkField('হইতে / From', from, '130px'), mkField('পর্যন্ত / To', to, '130px'));

  function render() {
    const currentPool = pool();
    const m = currentPool.find(x => x.id === (sel.value || (own ? session.memberDocId : ''))) || currentPool[0];
    if (!m) { toast('সদস্য নির্বাচন করুন / Select a member', 'warn'); return; }
    const s = memberSummary(m, ctx.deposits, cfgOf(ctx));
    let rows = statementRows(s);
    if (from.value) rows = rows.filter(r => String(r.deposit.date).slice(0, 10) >= from.value);
    if (to.value) rows = rows.filter(r => String(r.deposit.date).slice(0, 10) <= to.value);
    // recompute cumulative within the filtered window while keeping global cumulative meaning
    const periodTotal = rows.reduce((a, r) => a + num(r.deposit.amount), 0);

    const sheet = el('div', { class: 'print-sheet' });
    sheet.appendChild(sheetHead(ctx.cfg, 'Member Statement', (from.value || to.value) ? `Period: ${from.value ? fmtDate(from.value) : 'Beginning'} to ${to.value ? fmtDate(to.value) : fmtDate(todayISO())}` : ''));
    sheet.appendChild(psInfo([
      ['Member ID', m.memberId], ['Status', (m.status || '').toUpperCase()],
      ['Name (Bangla)', m.nameBn], ['Name (English)', m.nameEn],
      ['Join Date', fmtDate(m.joinDate)], ['Mobile', m.mobile],
      ["Father's Name", m.fatherBn || m.fatherEn || '-'], ['Address', m.address || '-'],
      ['Monthly Installment', money(m.installment) + ' Tk'], ['Statement Date', fmtDate(todayISO())],
    ]));
    sheet.appendChild(sechead('Deposit Statement'));
    sheet.appendChild(psTable(
      [{ label: 'SL', cls: 'c' }, { label: 'Date', cls: 'c' }, { label: 'Deposit Type' }, { label: 'Payment Method' }, { label: 'Amount', cls: 'num' }, { label: 'Cumulative Amount', cls: 'num' }],
      rows.map(r => [
        { text: r.sl, cls: 'c' }, { text: fmtDate(r.deposit.date), cls: 'c' },
        typeLabel(r.deposit.type).en, methodLabel(r.deposit.method).en,
        { text: money(r.deposit.amount), cls: 'num' }, { text: money(r.cumulative), cls: 'num' },
      ]),
      [[{ text: 'Total', span: 4 }, { text: money(periodTotal), cls: 'num' }, { text: money(rows.length ? rows[rows.length - 1].cumulative : 0), cls: 'num' }]],
    ));
    sheet.appendChild(sheetFoot(ctx.cfg, `Member ${m.memberId}`));

    const stats = el('div', { class: 'stats' });
    stats.append(
      statCard({ label: 'মোট জমা / Total Deposit', value: taka(s.totalDeposit), sub: `${s.count} approved`, ic: 'money' }),
      statCard({ label: 'বকেয়া / Due', value: taka(s.due), sub: `প্রয়োজন ${taka(s.required)}`, ic: 'due', tone: s.due > 0 ? 'red' : '' }),
      statCard({ label: 'অগ্রিম / Advance', value: taka(s.advance), sub: `${s.months} মাস`, ic: 'advance', tone: 'blue' }),
      statCard({ label: 'এই সময়কালে / In period', value: taka(periodTotal), sub: `${rows.length} entry`, ic: 'calendar', tone: 'gray' }),
    );

    outputCard(ctx, {
      titleBn: `${meta.bn} — ${m.nameBn}`, titleEn: `${meta.en} — ${m.memberId}`,
      sheet, screen: stats,
      criteria: `সদস্য / Member: ${m.memberId}${(from.value || to.value) ? ` · সময়কাল / Period: ${from.value ? fmtDate(from.value) : 'Beginning'} → ${to.value ? fmtDate(to.value) : fmtDate(todayISO())}` : ''}`,
      fileBase: `Dhruvo_Sangsad_Member_${m.memberId}_Statement`,
      excelRows: () => {
        const out = [['SL', 'Date', 'Deposit Type', 'Payment Method', 'Amount', 'Cumulative Amount']];
        rows.forEach(r => out.push([r.sl, fmtDate(r.deposit.date), typeLabel(r.deposit.type).en, methodLabel(r.deposit.method).en, num(r.deposit.amount), r.cumulative]));
        out.push(['', '', '', 'Total', periodTotal, '']);
        out.push([]);
        out.push(['Member ID', m.memberId, 'Name', m.nameEn]);
        out.push(['Monthly Installment', num(m.installment), 'Months', s.months]);
        out.push(['Total Deposit', s.totalDeposit, 'Total Due', s.due]);
        out.push(['Total Advance', s.advance, 'Required', s.required]);
        return out;
      },
    });
  }
  ctx.render = render;
}

/* ================= 2. Overall Report ================= */
async function rOverall(ctx, meta) {
  const stSel = el('select');
  [['active', 'শুধু Active'], ['', 'সব সদস্য / All'], ['pending', 'Pending']].forEach(([v, l]) => stSel.appendChild(el('option', { value: v }, [l])));
  ctx.filterHost.append(mkField('সদস্য স্ট্যাটাস / Status', stSel, '160px'));

  function render() {
    const pool = ctx.members.filter(m => (stSel.value ? m.status === stSel.value : m.status !== 'rejected'));
    const sums = pool.map(m => memberSummary(m, ctx.deposits, cfgOf(ctx)))
      .sort((a, b) => (a.member.memberId || '').localeCompare(b.member.memberId || ''));
    const tot = orgTotals(sums);

    const sheet = el('div', { class: 'print-sheet' });
    sheet.appendChild(sheetHead(ctx.cfg, 'Overall Report', `As on ${fmtDate(todayISO())}${stSel.value ? ' · ' + stSel.value.toUpperCase() + ' members' : ''}`));
    sheet.appendChild(psTable(
      [{ label: 'Member Name' }, { label: 'Monthly Installment', cls: 'num' }, { label: 'Total Deposit', cls: 'num' }, { label: 'Total Due', cls: 'num' }],
      sums.map(s => [
        `${s.member.nameEn || s.member.nameBn} (${s.member.memberId})`,
        { text: money(s.member.installment), cls: 'num' },
        { text: money(s.totalDeposit), cls: 'num' },
        { text: money(s.due), cls: 'num' },
      ]),
      [
        [{ text: 'Total Collection' }, { text: '', cls: 'num' }, { text: money(tot.totalDeposit), cls: 'num' }, { text: '', cls: 'num' }],
        [{ text: 'Total Due' }, { text: '', cls: 'num' }, { text: '', cls: 'num' }, { text: money(tot.totalDue), cls: 'num' }],
      ],
    ));
    sheet.appendChild(sheetFoot(ctx.cfg, `${sums.length} member(s)`));

    const screen = tableWrap(
      [{ label: 'Member Name' }, { label: 'Monthly Installment', cls: 'num' }, { label: 'Total Deposit', cls: 'num' }, { label: 'Total Due', cls: 'num' }],
      sums.map(s => [
        `${esc(s.member.nameBn)}<br><span class="faint fs8">${esc(s.member.memberId)}</span>`,
        { text: money(s.member.installment), cls: 'num' },
        { text: money(s.totalDeposit), cls: 'num' },
        { html: s.due > 0 ? `<span class="due-amt">${money(s.due)}</span>` : '0', cls: 'num' },
      ]),
      {
        footer: [{ html: '<b>Total Collection / Total Due</b>' }, { html: '' },
          { html: `<b>${money(tot.totalDeposit)}</b>`, cls: 'num' }, { html: `<b>${money(tot.totalDue)}</b>`, cls: 'num' }],
      },
    );

    outputCard(ctx, {
      titleBn: meta.bn, titleEn: meta.en, sheet, screen,
      criteria: stSel.value ? `Status: ${stSel.value.toUpperCase()}` : 'Status: All (except rejected)',
      fileBase: `Dhruvo_Sangsad_Overall_Report_${fmtDate(todayISO())}`,
      excelRows: () => {
        const out = [['Member Name', 'Monthly Installment', 'Total Deposit', 'Total Due']];
        sums.forEach(s => out.push([`${s.member.nameEn || s.member.nameBn} (${s.member.memberId})`, num(s.member.installment), s.totalDeposit, s.due]));
        out.push(['Total Collection', '', tot.totalDeposit, '']);
        out.push(['Total Due', '', '', tot.totalDue]);
        return out;
      },
    });
  }
  ctx.render = render;
}

/* ================= 3/4/9. Period collection reports ================= */
function periodReport(ctx, meta, mode) {
  const dInput = el('input', { type: 'date', value: todayISO() });
  const mInput = el('input', { type: 'month', value: monthKey(todayISO()) });
  const from = el('input', { type: 'date', value: monthKey(todayISO()) + '-01' });
  const to = el('input', { type: 'date', value: todayISO() });
  if (mode === 'daily') ctx.filterHost.append(mkField('তারিখ / Date', dInput, '150px'));
  else if (mode === 'monthly') ctx.filterHost.append(mkField('মাস / Month', mInput, '150px'));
  else ctx.filterHost.append(mkField('হইতে / From', from, '140px'), mkField('পর্যন্ত / To', to, '140px'));

  function render() {
    let rows, label, fileBase;
    const appr = approvedOf(ctx.deposits);
    if (mode === 'daily') {
      rows = appr.filter(d => String(d.date).slice(0, 10) === dInput.value);
      label = `Date: ${fmtDate(dInput.value)}`;
      fileBase = `Dhruvo_Sangsad_Daily_Report_${fmtDate(dInput.value)}`;
    } else if (mode === 'monthly') {
      rows = appr.filter(d => monthKey(d.date) === mInput.value);
      label = `Month: ${monthLabel(mInput.value)}`;
      fileBase = `Dhruvo_Sangsad_Monthly_Report_${monthLabel(mInput.value).replace(/ /g, '_')}`;
    } else {
      if (from.value && to.value && from.value > to.value) { toast('তারিখের ক্রম সঠিক নয় / From date must be before To date', 'error'); return; }
      rows = appr.filter(d => {
        const x = String(d.date).slice(0, 10);
        return (!from.value || x >= from.value) && (!to.value || x <= to.value);
      });
      label = `Period: ${fmtDate(from.value)} to ${fmtDate(to.value)}`;
      fileBase = `Dhruvo_Sangsad_Date_Range_Report_${fmtDate(from.value)}_to_${fmtDate(to.value)}`;
    }
    if (ctx.session.role === 'member') rows = rows.filter(d => d.memberDocId === ctx.session.memberDocId);
    rows = rows.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.memberId).localeCompare(String(b.memberId)));
    const total = rows.reduce((s, d) => s + num(d.amount), 0);

    const sheet = el('div', { class: 'print-sheet' });
    sheet.appendChild(sheetHead(ctx.cfg, meta.en, label));
    sheet.appendChild(sechead('Collection Details'));
    sheet.appendChild(psTable(
      [{ label: 'SL', cls: 'c' }, { label: 'Date', cls: 'c' }, { label: 'Member ID', cls: 'c' }, { label: 'Member Name' }, { label: 'Deposit Type' }, { label: 'Payment Method' }, { label: 'Amount', cls: 'num' }],
      rows.map((d, i) => [
        { text: i + 1, cls: 'c' }, { text: fmtDate(d.date), cls: 'c' }, { text: d.memberId, cls: 'c' },
        d.memberName, typeLabel(d.type).en, methodLabel(d.method).en, { text: money(d.amount), cls: 'num' },
      ]),
      [[{ text: 'Total Collection', span: 6 }, { text: money(total), cls: 'num' }]],
    ));
    sheet.appendChild(sheetFoot(ctx.cfg));

    const stats = el('div', { class: 'stats' });
    stats.append(
      statCard({ label: 'মোট আদায় / Total Collection', value: taka(total), sub: label, ic: 'money' }),
      statCard({ label: 'লেনদেন / Transactions', value: String(rows.length), sub: 'অনুমোদিত জমা', ic: 'deposit', tone: 'blue' }),
    );

    outputCard(ctx, {
      titleBn: meta.bn, titleEn: `${meta.en} — ${label}`, sheet, screen: stats, fileBase,
      criteria: label,
      excelRows: () => {
        const out = [['SL', 'Date', 'Member ID', 'Member Name', 'Deposit Type', 'Payment Method', 'Amount']];
        rows.forEach((d, i) => out.push([i + 1, fmtDate(d.date), d.memberId, d.memberName, typeLabel(d.type).en, methodLabel(d.method).en, num(d.amount)]));
        out.push(['', '', '', '', '', 'Total Collection', total]);
        return out;
      },
    });
  }
  ctx.render = render;
}

/* ================= 5/6. Due & Advance ================= */
function rDueAdvance(ctx, meta, kind) {
  const { session } = ctx;
  const minInput = el('input', { type: 'number', min: '0', step: '1', value: '1', placeholder: '0' });
  ctx.filterHost.append(mkField(kind === 'due' ? 'ন্যূনতম বকেয়া (৳)' : 'ন্যূনতম অগ্রিম (৳)', minInput, '150px'));

  function render() {
    const min = num(minInput.value);
    const sums = ctx.members.filter(m => m.status === 'active' || m.status === 'pending')
      .map(m => memberSummary(m, ctx.deposits, cfgOf(ctx)))
      .filter(s => (kind === 'due' ? s.due : s.advance) >= Math.max(min, 0.01))
      .sort((a, b) => (kind === 'due' ? b.due - a.due : b.advance - a.advance));
    const total = sums.reduce((s, x) => s + (kind === 'due' ? x.due : x.advance), 0);

    const sheet = el('div', { class: 'print-sheet' });
    sheet.appendChild(sheetHead(ctx.cfg, meta.en, `As on ${fmtDate(todayISO())}`));
    sheet.appendChild(psTable(
      [{ label: 'SL', cls: 'c' }, { label: 'Member ID', cls: 'c' }, { label: 'Member Name' }, { label: 'Mobile', cls: 'c' },
       { label: 'Monthly Installment', cls: 'num' }, { label: 'Total Deposit', cls: 'num' }, { label: kind === 'due' ? 'Total Due' : 'Total Advance', cls: 'num' }],
      sums.map((s, i) => [
        { text: i + 1, cls: 'c' }, { text: s.member.memberId, cls: 'c' }, s.member.nameEn || s.member.nameBn,
        { text: s.member.mobile, cls: 'c' }, { text: money(s.member.installment), cls: 'num' },
        { text: money(s.totalDeposit), cls: 'num' }, { text: money(kind === 'due' ? s.due : s.advance), cls: 'num' },
      ]),
      [[{ text: kind === 'due' ? 'Total Due' : 'Total Advance', span: 6 }, { text: money(total), cls: 'num' }]],
    ));
    sheet.appendChild(sheetFoot(ctx.cfg, `${sums.length} member(s)`));

    const screen = tableWrap(
      [{ label: 'SL', cls: 'num' }, { label: 'ID' }, { label: 'নাম / Name' }, { label: 'Mobile' },
       { label: 'কিস্তি', cls: 'num' }, { label: 'জমা', cls: 'num' }, { label: kind === 'due' ? 'বকেয়া' : 'অগ্রিম', cls: 'num' },
       ...(kind === 'due' && can(session, 'whatsapp') ? [{ label: 'Reminder', cls: 'nowrap' }] : [])],
      sums.map((s, i) => {
        const cells = [
          { text: String(i + 1), cls: 'num' }, `<b>${esc(s.member.memberId)}</b>`, esc(s.member.nameBn),
          esc(s.member.mobile), { text: money(s.member.installment), cls: 'num' },
          { text: money(s.totalDeposit), cls: 'num' },
          { html: `<span class="${kind === 'due' ? 'due-amt' : 'adv-amt'}">${money(kind === 'due' ? s.due : s.advance)}</span>`, cls: 'num' },
        ];
        if (kind === 'due' && can(session, 'whatsapp')) {
          cells.push({ node: btn('WhatsApp', 'whatsapp', 'wa', () => sendWaReminder(s.member), { size: 'xs' }), cls: 'nowrap' });
        }
        return cells;
      }),
      {
        empty: kind === 'due' ? 'কোনো বকেয়া সদস্য নেই / No member with due' : 'কোনো অগ্রিম জমা নেই / No advance found',
        emptyIcon: kind === 'due' ? 'due' : 'advance',
        footer: sums.length ? [{ html: '' }, { html: '' }, { html: `<b>${sums.length} member(s)</b>` }, { html: '' }, { html: '' }, { html: '<b>Total</b>', cls: 'num' },
          { html: `<b>${money(total)}</b>`, cls: 'num' }, ...(kind === 'due' && can(session, 'whatsapp') ? [{ html: '' }] : [])] : null,
      },
    );

    const head = el('div');
    if (kind === 'due' && sums.length && can(session, 'whatsapp')) {
      const bar = el('div', { class: 'btn-row', style: 'margin-bottom:8px' });
      bar.appendChild(btn('সবাইকে রিমাইন্ডার / Open all reminders', 'whatsapp', 'wa', async () => {
        for (const s of sums.slice(0, 10)) { await sendWaReminder(s.member); await new Promise(r => setTimeout(r, 400)); }
        if (sums.length > 10) toast('প্রথম ১০ জনের জন্য খোলা হয়েছে / Opened for first 10 members', 'info');
      }, { size: 'xs' }));
      head.appendChild(bar);
    }
    head.appendChild(screen);

    outputCard(ctx, {
      titleBn: meta.bn, titleEn: meta.en, sheet, screen: head,
      criteria: `ন্যূনতম / Minimum ${kind === 'due' ? 'Due' : 'Advance'} ≥ ৳${min}`,
      fileBase: `Dhruvo_Sangsad_${kind === 'due' ? 'Due' : 'Advance'}_Report_${fmtDate(todayISO())}`,
      excelRows: () => {
        const out = [['SL', 'Member ID', 'Member Name', 'Mobile', 'Monthly Installment', 'Total Deposit', kind === 'due' ? 'Total Due' : 'Total Advance']];
        sums.forEach((s, i) => out.push([i + 1, s.member.memberId, s.member.nameEn || s.member.nameBn, s.member.mobile, num(s.member.installment), s.totalDeposit, kind === 'due' ? s.due : s.advance]));
        out.push(['', '', '', '', '', 'Total', total]);
        return out;
      },
    });
  }
  ctx.render = render;
}

/* ================= 7. Collection report (monthly trend) ================= */
function rCollection(ctx, meta) {
  const yr = el('select');
  const years = Array.from(new Set(approvedOf(ctx.deposits).map(d => String(d.date).slice(0, 4)).concat([String(new Date().getFullYear())]))).sort();
  years.forEach(y => yr.appendChild(el('option', { value: y, ...(y === String(new Date().getFullYear()) ? { selected: true } : {}) }, [y])));
  ctx.filterHost.append(mkField('বছর / Year', yr, '120px'));

  function render() {
    const y = yr.value;
    const appr = approvedOf(ctx.deposits).filter(d => String(d.date).slice(0, 4) === y);
    const months = Array.from({ length: 12 }, (_, i) => `${y}-${String(i + 1).padStart(2, '0')}`);
    const rows = months.map(mk => {
      const list = appr.filter(d => monthKey(d.date) === mk);
      const o = { mk, n: list.length, total: 0, cash: 0, mobile: 0, bank: 0 };
      list.forEach(d => { o.total += num(d.amount); o[d.method] = (o[d.method] || 0) + num(d.amount); });
      return o;
    });
    const total = rows.reduce((s, r) => s + r.total, 0);
    const tCash = rows.reduce((s, r) => s + r.cash, 0), tMob = rows.reduce((s, r) => s + r.mobile, 0), tBank = rows.reduce((s, r) => s + r.bank, 0);

    const sheet = el('div', { class: 'print-sheet' });
    sheet.appendChild(sheetHead(ctx.cfg, 'Collection Report', `Year: ${y}`));
    sheet.appendChild(psTable(
      [{ label: 'Month' }, { label: 'Transactions', cls: 'num' }, { label: 'Cash', cls: 'num' }, { label: 'Mobile Banking', cls: 'num' }, { label: 'Bank', cls: 'num' }, { label: 'Total Collection', cls: 'num' }],
      rows.map(r => [monthLabel(r.mk), { text: r.n, cls: 'num' }, { text: money(r.cash), cls: 'num' }, { text: money(r.mobile), cls: 'num' }, { text: money(r.bank), cls: 'num' }, { text: money(r.total), cls: 'num' }]),
      [[{ text: 'Total' }, { text: appr.length, cls: 'num' }, { text: money(tCash), cls: 'num' }, { text: money(tMob), cls: 'num' }, { text: money(tBank), cls: 'num' }, { text: money(total), cls: 'num' }]],
    ));
    sheet.appendChild(sheetFoot(ctx.cfg));

    const max = Math.max(1, ...rows.map(r => r.total));
    const chart = el('div', { class: 'bars' });
    rows.forEach(r => {
      const b = el('div', { class: 'bar' });
      b.innerHTML = `<div class="bar-track"><div class="bar-fill" style="height:${Math.round((r.total / max) * 100)}%"></div></div>
        <div class="bar-lbl">${monthLabel(r.mk).slice(0, 3)}</div><div class="bar-val">${money(r.total)}</div>`;
      chart.appendChild(b);
    });

    outputCard(ctx, {
      titleBn: meta.bn, titleEn: `${meta.en} — ${y}`, sheet, screen: chart,
      criteria: `বছর / Year: ${y}`,
      fileBase: `Dhruvo_Sangsad_Collection_Report_${y}`,
      excelRows: () => {
        const out = [['Month', 'Transactions', 'Cash', 'Mobile Banking', 'Bank', 'Total Collection']];
        rows.forEach(r => out.push([monthLabel(r.mk), r.n, r.cash, r.mobile, r.bank, r.total]));
        out.push(['Total', appr.length, tCash, tMob, tBank, total]);
        return out;
      },
    });
  }
  ctx.render = render;
}

/* ================= 8. Payment method report ================= */
function rMethod(ctx, meta) {
  const from = el('input', { type: 'date', value: monthKey(todayISO()) + '-01' });
  const to = el('input', { type: 'date', value: todayISO() });
  ctx.filterHost.append(mkField('হইতে / From', from, '140px'), mkField('পর্যন্ত / To', to, '140px'));

  function render() {
    const rows = approvedOf(ctx.deposits).filter(d => {
      const x = String(d.date).slice(0, 10);
      return (!from.value || x >= from.value) && (!to.value || x <= to.value);
    });
    const total = rows.reduce((s, d) => s + num(d.amount), 0);
    const grid = PAY_METHODS.map(p => {
      const list = rows.filter(d => d.method === p.id);
      const amt = list.reduce((s, d) => s + num(d.amount), 0);
      return { p, n: list.length, amt, pct: total ? (amt / total) * 100 : 0, list };
    });

    const sheet = el('div', { class: 'print-sheet' });
    sheet.appendChild(sheetHead(ctx.cfg, 'Payment Method Report', `Period: ${fmtDate(from.value)} to ${fmtDate(to.value)}`));
    sheet.appendChild(psTable(
      [{ label: 'Payment Method' }, { label: 'Transactions', cls: 'num' }, { label: 'Amount', cls: 'num' }, { label: 'Share (%)', cls: 'num' }],
      grid.map(g => [g.p.en, { text: g.n, cls: 'num' }, { text: money(g.amt), cls: 'num' }, { text: g.pct.toFixed(2), cls: 'num' }]),
      [[{ text: 'Total' }, { text: rows.length, cls: 'num' }, { text: money(total), cls: 'num' }, { text: total ? '100.00' : '0.00', cls: 'num' }]],
    ));
    grid.forEach(g => {
      if (!g.list.length) return;
      sheet.appendChild(sechead(`${g.p.en} — Details`));
      sheet.appendChild(psTable(
        [{ label: 'SL', cls: 'c' }, { label: 'Date', cls: 'c' }, { label: 'Member ID', cls: 'c' }, { label: 'Member Name' }, { label: 'Deposit Type' }, { label: 'Amount', cls: 'num' }],
        g.list.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)))
          .map((d, i) => [{ text: i + 1, cls: 'c' }, { text: fmtDate(d.date), cls: 'c' }, { text: d.memberId, cls: 'c' }, d.memberName, typeLabel(d.type).en, { text: money(d.amount), cls: 'num' }]),
        [[{ text: 'Subtotal', span: 5 }, { text: money(g.amt), cls: 'num' }]],
      ));
    });
    sheet.appendChild(sheetFoot(ctx.cfg));

    const stats = el('div', { class: 'stats' });
    stats.append(statCard({ label: 'মোট আদায় / Total', value: taka(total), sub: `${rows.length} transaction(s)`, ic: 'money' }),
      ...grid.map(g => statCard({ label: `${g.p.bn} / ${g.p.en}`, value: taka(g.amt), sub: `${g.n} entry · ${g.pct.toFixed(1)}%`, ic: 'deposit', tone: 'gray' })));

    outputCard(ctx, {
      titleBn: meta.bn, titleEn: meta.en, sheet, screen: stats,
      criteria: `সময়কাল / Period: ${fmtDate(from.value)} → ${fmtDate(to.value)}`,
      fileBase: `Dhruvo_Sangsad_Payment_Method_Report_${fmtDate(from.value)}_to_${fmtDate(to.value)}`,
      excelRows: () => {
        const out = [['Payment Method', 'Transactions', 'Amount', 'Share (%)']];
        grid.forEach(g => out.push([g.p.en, g.n, g.amt, Number(g.pct.toFixed(2))]));
        out.push(['Total', rows.length, total, total ? 100 : 0]);
        out.push([]);
        out.push(['Date', 'Member ID', 'Member Name', 'Deposit Type', 'Payment Method', 'Amount']);
        rows.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)))
          .forEach(d => out.push([fmtDate(d.date), d.memberId, d.memberName, typeLabel(d.type).en, methodLabel(d.method).en, num(d.amount)]));
        return out;
      },
    });
  }
  ctx.render = render;
}

/* ================= 10. Member-wise report ================= */
function rMemberWise(ctx, meta) {
  const sel = memberSelect(ctx.members, { includeAll: true });
  const from = el('input', { type: 'date' });
  const to = el('input', { type: 'date' });
  ctx.filterHost.append(mkField('সদস্য / Member', sel, '220px'), mkField('হইতে / From', from, '130px'), mkField('পর্যন্ত / To', to, '130px'));

  function render() {
    const pool = sel.value ? ctx.members.filter(m => m.id === sel.value) : ctx.members.filter(m => m.status !== 'rejected');
    const inRange = d => {
      const x = String(d.date).slice(0, 10);
      return (!from.value || x >= from.value) && (!to.value || x <= to.value);
    };
    const data = pool.map(m => {
      const s = memberSummary(m, ctx.deposits, cfgOf(ctx));
      const list = s.deposits.filter(inRange).sort((a, b) => String(a.date).localeCompare(String(b.date)));
      return { m, s, list, periodTotal: list.reduce((x, d) => x + num(d.amount), 0) };
    }).sort((a, b) => a.m.memberId.localeCompare(b.m.memberId));
    const gTotal = data.reduce((s, r) => s + r.periodTotal, 0);
    const period = (from.value || to.value) ? `Period: ${from.value ? fmtDate(from.value) : 'Beginning'} to ${to.value ? fmtDate(to.value) : fmtDate(todayISO())}` : `As on ${fmtDate(todayISO())}`;

    const sheet = el('div', { class: 'print-sheet land' });
    sheet.appendChild(sheetHead(ctx.cfg, 'Member-wise Report', period));
    sheet.appendChild(psTable(
      [{ label: 'SL', cls: 'c' }, { label: 'Member ID', cls: 'c' }, { label: 'Member Name' }, { label: 'Mobile', cls: 'c' },
       { label: 'Installment', cls: 'num' }, { label: 'Entries', cls: 'num' }, { label: 'Period Deposit', cls: 'num' },
       { label: 'Total Deposit', cls: 'num' }, { label: 'Total Due', cls: 'num' }, { label: 'Total Advance', cls: 'num' }, { label: 'Status', cls: 'c' }],
      data.map((r, i) => [
        { text: i + 1, cls: 'c' }, { text: r.m.memberId, cls: 'c' }, r.m.nameEn || r.m.nameBn, { text: r.m.mobile, cls: 'c' },
        { text: money(r.m.installment), cls: 'num' }, { text: r.list.length, cls: 'num' }, { text: money(r.periodTotal), cls: 'num' },
        { text: money(r.s.totalDeposit), cls: 'num' }, { text: money(r.s.due), cls: 'num' }, { text: money(r.s.advance), cls: 'num' },
        { text: (r.m.status || '').toUpperCase(), cls: 'c' },
      ]),
      [[{ text: 'Total', span: 6 }, { text: money(gTotal), cls: 'num' },
        { text: money(data.reduce((s, r) => s + r.s.totalDeposit, 0)), cls: 'num' },
        { text: money(data.reduce((s, r) => s + r.s.due, 0)), cls: 'num' },
        { text: money(data.reduce((s, r) => s + r.s.advance, 0)), cls: 'num' }, { text: '' }]],
    ));
    if (data.length === 1) {
      const r = data[0];
      sheet.appendChild(sechead('Deposit Details'));
      let cum = 0;
      sheet.appendChild(psTable(
        [{ label: 'SL', cls: 'c' }, { label: 'Date', cls: 'c' }, { label: 'Deposit Type' }, { label: 'Payment Method' }, { label: 'Description' }, { label: 'Amount', cls: 'num' }, { label: 'Cumulative Amount', cls: 'num' }],
        r.list.map((d, i) => { cum += num(d.amount); return [{ text: i + 1, cls: 'c' }, { text: fmtDate(d.date), cls: 'c' }, typeLabel(d.type).en, methodLabel(d.method).en, d.description || '-', { text: money(d.amount), cls: 'num' }, { text: money(cum), cls: 'num' }]; }),
        [[{ text: 'Total', span: 5 }, { text: money(r.periodTotal), cls: 'num' }, { text: money(cum), cls: 'num' }]],
      ));
    }
    sheet.appendChild(sheetFoot(ctx.cfg, `${data.length} member(s)`));

    const screen = tableWrap(
      [{ label: 'ID' }, { label: 'নাম / Name' }, { label: 'কিস্তি', cls: 'num' }, { label: 'এন্ট্রি', cls: 'num' },
       { label: 'সময়কালীন জমা', cls: 'num' }, { label: 'মোট জমা', cls: 'num' }, { label: 'বকেয়া', cls: 'num' }, { label: 'অগ্রিম', cls: 'num' }],
      data.map(r => [
        `<b>${esc(r.m.memberId)}</b>`, esc(r.m.nameBn), { text: money(r.m.installment), cls: 'num' },
        { text: String(r.list.length), cls: 'num' }, { text: money(r.periodTotal), cls: 'num' },
        { text: money(r.s.totalDeposit), cls: 'num' },
        { html: r.s.due > 0 ? `<span class="due-amt">${money(r.s.due)}</span>` : '0', cls: 'num' },
        { html: r.s.advance > 0 ? `<span class="adv-amt">${money(r.s.advance)}</span>` : '0', cls: 'num' },
      ]),
      { footer: [{ html: '<b>Total</b>' }, { html: '' }, { html: '' }, { html: '' }, { html: `<b>${money(gTotal)}</b>`, cls: 'num' },
        { html: `<b>${money(data.reduce((s, r) => s + r.s.totalDeposit, 0))}</b>`, cls: 'num' },
        { html: `<b>${money(data.reduce((s, r) => s + r.s.due, 0))}</b>`, cls: 'num' },
        { html: `<b>${money(data.reduce((s, r) => s + r.s.advance, 0))}</b>`, cls: 'num' }] },
    );

    outputCard(ctx, {
      titleBn: meta.bn, titleEn: meta.en, sheet, screen, orientation: 'l',
      criteria: period,
      fileBase: sel.value ? `Dhruvo_Sangsad_Member_${data[0].m.memberId}_Report` : `Dhruvo_Sangsad_Member_wise_Report_${fmtDate(todayISO())}`,
      excelRows: () => {
        const out = [['SL', 'Member ID', 'Member Name', 'Mobile', 'Monthly Installment', 'Entries', 'Period Deposit', 'Total Deposit', 'Total Due', 'Total Advance', 'Status']];
        data.forEach((r, i) => out.push([i + 1, r.m.memberId, r.m.nameEn || r.m.nameBn, r.m.mobile, num(r.m.installment), r.list.length, r.periodTotal, r.s.totalDeposit, r.s.due, r.s.advance, r.m.status]));
        out.push(['', '', '', '', '', 'Total', gTotal, data.reduce((s, r) => s + r.s.totalDeposit, 0), data.reduce((s, r) => s + r.s.due, 0), data.reduce((s, r) => s + r.s.advance, 0), '']);
        return out;
      },
    });
  }
  ctx.render = render;
}

/* ================= 11. Withdrawal report ================= */
function rWithdrawal(ctx, meta) {
  const { session } = ctx;
  const own = session.role === 'member';
  const from = el('input', { type: 'date' });
  const to = el('input', { type: 'date' });
  ctx.filterHost.append(mkField('হইতে / From', from, '140px'), mkField('পর্যন্ত / To', to, '140px'));

  function render() {
    let rows = (own ? ctx.withdrawals.filter(w => w.memberDocId === session.memberDocId || w.memberId === session.memberId) : ctx.withdrawals)
      .filter(w => w.status === 'approved');
    if (from.value) rows = rows.filter(w => String(w.date).slice(0, 10) >= from.value);
    if (to.value) rows = rows.filter(w => String(w.date).slice(0, 10) <= to.value);
    rows = rows.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.memberId).localeCompare(String(b.memberId)));
    const total = rows.reduce((s, w) => s + num(w.amount), 0);
    const label = `Period: ${from.value ? fmtDate(from.value) : 'Beginning'} to ${to.value ? fmtDate(to.value) : fmtDate(todayISO())}`;

    const sheet = el('div', { class: 'print-sheet' });
    sheet.appendChild(sheetHead(ctx.cfg, 'Withdrawal Report', label));
    sheet.appendChild(psTable(
      [{ label: 'SL', cls: 'c' }, { label: 'Date', cls: 'c' }, { label: 'Member ID', cls: 'c' }, { label: 'Member Name' }, { label: 'Withdrawal Type' }, { label: 'Payment Method' }, { label: 'Amount', cls: 'num' }],
      rows.map((w, i) => [
        { text: i + 1, cls: 'c' }, { text: fmtDate(w.date), cls: 'c' }, { text: w.memberId, cls: 'c' },
        w.memberName, withdrawalTypeLabel(w.type).en, methodLabel(w.method).en, { text: money(w.amount), cls: 'num' },
      ]),
      [[{ text: 'Total Withdrawal', span: 6 }, { text: money(total), cls: 'num' }]],
    ));
    sheet.appendChild(sheetFoot(ctx.cfg, `${rows.length} withdrawal(s)`));

    const screen = tableWrap(
      [{ label: 'Date' }, { label: 'Member' }, { label: 'ধরন / Type' }, { label: 'পদ্ধতি / Method' }, { label: 'পরিমাণ', cls: 'num' }],
      rows.map(w => [
        esc(fmtDate(w.date)),
        `${esc(w.memberName)}<br><span class="faint fs8">${esc(w.memberId)}</span>`,
        esc(withdrawalTypeLabel(w.type).bn), esc(methodLabel(w.method).bn),
        { text: money(w.amount), cls: 'num' },
      ]),
      {
        empty: 'কোনো উত্তোলন পাওয়া যায়নি / No withdrawals found', emptyIcon: 'withdraw',
        footer: rows.length ? [{ html: '' }, { html: '<b>Total</b>' }, { html: '' }, { html: '' }, { html: `<b>${money(total)}</b>`, cls: 'num' }] : null,
      },
    );

    outputCard(ctx, {
      titleBn: meta.bn, titleEn: meta.en, sheet, screen,
      criteria: label,
      fileBase: `Dhruvo_Sangsad_Withdrawal_Report_${fmtDate(todayISO())}`,
      excelRows: () => {
        const out = [['SL', 'Date', 'Member ID', 'Member Name', 'Withdrawal Type', 'Payment Method', 'Amount']];
        rows.forEach((w, i) => out.push([i + 1, fmtDate(w.date), w.memberId, w.memberName, withdrawalTypeLabel(w.type).en, methodLabel(w.method).en, num(w.amount)]));
        out.push(['', '', '', '', '', 'Total Withdrawal', total]);
        return out;
      },
    });
  }
  ctx.render = render;
}

const BUILDERS = {
  statement: rStatement,
  overall: rOverall,
  daily: (c, m) => periodReport(c, m, 'daily'),
  monthly: (c, m) => periodReport(c, m, 'monthly'),
  due: (c, m) => rDueAdvance(c, m, 'due'),
  advance: (c, m) => rDueAdvance(c, m, 'advance'),
  collection: rCollection,
  method: rMethod,
  range: (c, m) => periodReport(c, m, 'range'),
  memberwise: rMemberWise,
  withdrawal: rWithdrawal,
};
