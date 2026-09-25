/* Reports — modern flow per audit:
   SUMMARY (first) → Report Type dropdown → Filters → [Generate Report]
   → popup preview that shows the EXACT sheet → PDF only.
   Excel / CSV / Image / JSON downloads are gone; the member statement lives
   on its own Statements page (not duplicated here). */
import {
  el, toast, taka, money, num, fmtDate, todayISO, monthKey, monthLabel,
  typeLabel, methodLabel, PAY_METHODS, waNumber, t, tx,
} from '../util.js';
import { page, card, btn, statCard, segChips, sectionHead } from '../ui.js';
import { memberPicker } from '../picker.js';
import {
  allMembers, allDeposits, allWithdrawals, settings, memberSummary, summariesFor, orgTotals,
  approvedOf, withdrawalTypeLabel, summaryOpts,
} from '../store.js';
import { buildSheet, psTable, sechead } from '../sheet.js';
import { previewReport, reportFileName } from '../preview.js';
import { DEFAULT_SETTINGS } from '../store.js';

/* ---------------- WhatsApp due reminder ---------------- */
let WA_TPL = DEFAULT_SETTINGS.waTemplate;
settings().then(s => { if (s.waTemplate) WA_TPL = s.waTemplate; }).catch(() => {});

/** Exact Bangla due-reminder text with [Member Name] substituted. */
export function dueMessage(name, tpl) {
  return String(tpl || WA_TPL).replace(/\[Member Name\]/g, String(name || '').trim());
}
export async function sendWaReminder(member) {
  const cfg = await settings();
  WA_TPL = cfg.waTemplate || WA_TPL;
  const msg = dueMessage(member.nameBn || member.nameEn, WA_TPL);
  window.open(`https://wa.me/${waNumber(member.whatsapp || member.mobile)}?text=${encodeURIComponent(msg)}`, '_blank');
}

/* ---------------- report registry (dropdown entries) ---------------- */
const REPORTS = [
  { id: 'daily', bn: 'জমা রিপোর্ট (দৈনিক)', en: 'Deposit Report — Daily', ic: 'calendar', roles: ['admin', 'maker'] },
  { id: 'monthly', bn: 'মাসিক জমা রিপোর্ট', en: 'Monthly Deposit Report', ic: 'chart', roles: ['admin', 'maker'] },
  { id: 'range', bn: 'সময়কাল রিপোর্ট', en: 'Transaction Report', ic: 'clock', roles: ['admin', 'maker', 'member'] },
  { id: 'collection', bn: 'আদার রিপোর্ট (বার্ষিক)', en: 'Collection Report', ic: 'money', roles: ['admin', 'maker'] },
  { id: 'method', bn: 'পরিশোধ পদ্ধতি রিপোর্ট', en: 'Payment Report', ic: 'deposit', roles: ['admin', 'maker'] },
  { id: 'overall', bn: 'সদস্য রিপোর্ট (সার্বিক)', en: 'Member Report', ic: 'members', roles: ['admin', 'maker'] },
  { id: 'memberwise', bn: 'সদস্যভিত্তিক রিপোর্ট', en: 'Member-wise Report', ic: 'usergear', roles: ['admin', 'maker'] },
  { id: 'due', bn: 'বকেয়া রিপোর্ট', en: 'Due Report', ic: 'due', roles: ['admin', 'maker'] },
  { id: 'advance', bn: 'অগ্রিম রিপোর্ট', en: 'Advance Report', ic: 'advance', roles: ['admin', 'maker'] },
  { id: 'withdrawal', bn: 'উত্তোলন রিপোর্ট', en: 'Withdrawal Report', ic: 'withdraw', roles: ['admin', 'maker', 'member'] },
];

export async function pageReports(session, params = {}) {
  const [members, deposits, withdrawals, cfg] = await Promise.all([
    allMembers(), allDeposits(), allWithdrawals(), settings(),
  ]);
  WA_TPL = cfg.waTemplate || WA_TPL;
  const wrap = page('প্রতিবেদন', 'Reports', 'report');

  /* ============ 1 — SUMMARY (always before filters) ============ */
  const isMember = session.role === 'member';
  const stats = el('div', { class: 'stats' });
  if (!isMember) {
    const sums = await summariesFor(members.filter(m => m.status !== 'rejected'), deposits, cfg);
    const tot = orgTotals(sums);
    const apprD = approvedOf(deposits);
    const allTxns = apprD.length + (withdrawals || []).filter(w => w.status === 'approved').length;
    stats.append(
      statCard({ label: t('মোট সদস্য', 'Total Members'), value: String(members.length), sub: `${members.filter(m => m.status === 'active').length} ${t('সক্রিয়', 'active')}`, ic: 'members', tone: 'blue' }),
      statCard({ label: t('লেনদেন', 'Transactions'), value: String(allTxns), sub: t('অনুমোদিত', 'approved'), ic: 'receipt' }),
      statCard({ label: t('মোট জমা', 'Total Deposits'), value: String(apprD.length), sub: `${t('রেকর্ড', 'records')}`, ic: 'deposit' }),
      statCard({ label: t('মোট amount', 'Total Amount'), value: taka(tot.totalDeposit), sub: `${t('বকেয়া', 'Due')} ${taka(tot.totalDue)}`, ic: 'money', tone: 'amber' }),
    );
  } else {
    const m = members.find(x => x.id === session.memberDocId);
    const s = m ? memberSummary(m, deposits, summaryOpts(cfg, { withdrawals })) : null;
    stats.append(
      statCard({ label: t('আমার জমা', 'My Deposits'), value: String(s ? s.count : 0), sub: t('অনুমোদিত', 'approved'), ic: 'deposit' }),
      statCard({ label: t('মোট amount', 'Total Amount'), value: taka(s ? s.totalDeposit : 0), sub: `${t('উত্তোলন', 'Withdrawal')} ${taka(s ? s.totalWithdrawal : 0)}`, ic: 'money' }),
    );
  }
  wrap.appendChild(sectionHead(t('সারসংক্ষেপ', 'Summary'), 'Summary'));
  wrap.appendChild(stats);

  /* ============ 2 — Report type (a dropdown, NOT tiles) ============ */
  const list = REPORTS.filter(r => r.roles.includes(session.role));
  const typeSel = el('select', { 'aria-label': t('প্রতিবেদনের ধরন', 'Report type') });
  list.forEach(r => typeSel.appendChild(el('option', { value: r.id, ...(r.id === list[0].id ? { selected: true } : {}) }, [`${t(r.bn, r.en)}`])));
  if (params.report && list.some(r => r.id === params.report)) typeSel.value = params.report;
  wrap.appendChild(card(t('রিপোর্টের ধরন', 'Report Type'), '', el('div', {}, [typeSel])));

  /* ============ 3 — Filters (contextual) ============ */
  const filterHost = el('div', { class: 'toolbar rep-filters' });
  const filterCard = card(t('ফিল্টার', 'Filters'), '', filterHost);
  filterCard.classList.add('overflow-visible');
  wrap.appendChild(filterCard);

  /* ============ 4 — Generate (filters exist BEFORE it) ============ */
  /* Live count of what the CURRENT filters would produce — the filters visibly
     drive the output instead of being decorative. */
  const liveLine = el('div', { class: 'filter-live', 'aria-live': 'polite' });
  /* the selected builder wires its filter widgets once and returns build() */
  let buildFn = null;
  const ctx = {
    session, members, deposits, withdrawals: withdrawals || [], cfg, filterHost,
    live: () => {
      if (!buildFn || !buildFn.preview) { liveLine.textContent = ''; return; }
      try { liveLine.textContent = buildFn.preview(); }
      catch { liveLine.textContent = ''; }
    },
  };
  const setup = () => {
    filterHost.replaceChildren();
    const meta = REPORTS.find(x => x.id === typeSel.value) || list[0];
    try { buildFn = BUILDERS[meta.id](ctx, meta); }
    catch (err) { buildFn = null; toast(err.message || String(err), 'error'); }
    ctx.live();
  };
  typeSel.addEventListener('change', setup);
  /* any widget inside the filter card (chip, date, picker, select) refreshes the count */
  filterHost.addEventListener('change', () => ctx.live());
  filterHost.addEventListener('input', () => ctx.live());
  setup();

  wrap.appendChild(liveLine);

  const gen = btn(t('রিপোর্ট তৈরি করুন', 'Generate Report'), 'report', 'primary', async () => {
    /* fresh data at click time — the same values feed preview AND pdf */
    const [m2, d2, w2, c2] = await Promise.all([allMembers(), allDeposits(), allWithdrawals(), settings()]);
    ctx.members = m2; ctx.deposits = d2; ctx.withdrawals = w2; ctx.cfg = c2; WA_TPL = c2.waTemplate || WA_TPL;
    const meta = REPORTS.find(x => x.id === typeSel.value) || list[0];
    try {
      const out = buildFn ? buildFn() : null;
      if (!out || !out.sheet) { toast(t('রিপোর্ট তৈরি করা যায়নি', 'Report could not be generated'), 'error'); return; }
      await previewReport({
        title: `${t(meta.bn, meta.en)}`,
        sheet: out.sheet,
        orientation: out.orientation || 'p',
        fileName: reportFileName({ memberName: out.memberName || '', reportType: `${meta.en.replace(/[^A-Za-z0-9 ]/g, '')}`, orgName: (c2.orgNameEn || 'Dhruva_Sangsad') }),
      });
    } catch (err) { toast(err.message || String(err), 'error'); }
  }, { block: true });
  gen.style.minHeight = '48px'; gen.style.fontSize = '15px'; gen.style.marginTop = '4px';
  wrap.appendChild(gen);
  return wrap;
}

/* ---------------- helpers ---------------- */
function mkField(label, node, w = '140px') {
  const f = el('div', { class: 'field', style: `flex:0 1 ${w}` });
  f.appendChild(el('label', { text: label }));
  f.appendChild(node);
  return f;
}
const cfgOf = ctx => summaryOpts(ctx.cfg);
const txnCol = { label: 'Txn ID', cls: 'c' };
const txnCell = r => ({ text: r.txnId || '—', cls: 'c' });

/* ================= 1/3. Period + range collection reports ================= */

const monthStartISO = (iso = todayISO()) => String(iso).slice(0, 7) + '-01';
function lastMonthRange() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  const p = n => String(n).padStart(2, '0');
  const y = d.getFullYear(), m = d.getMonth();
  return { from: `${y}-${p(m + 1)}-01`, to: `${y}-${p(m + 1)}-${p(new Date(y, m + 1, 0).getDate())}` };
}

/**
 * ONE period control for every report that has a date dimension.
 * [এই মাস] [গত মাস] [সব সময়] + always-visible From/To (Custom is always
 * available — typing a date simply switches the selection to Custom).
 * Returns { node, from, to, label(), preset } and calls onChange() whenever the
 * window changes, so the caller can refresh its live preview.
 */
function periodPicker({ mode = 'range', onChange = null } = {}) {
  const last = lastMonthRange();
  const PRESETS = {
    today: { bn: 'আজ', en: 'Today', from: todayISO(), to: todayISO() },
    month: { bn: 'এই মাস', en: 'This month', from: monthStartISO(), to: todayISO() },
    last: { bn: 'গত মাস', en: 'Last month', from: last.from, to: last.to },
    all: { bn: 'সব সময়', en: 'All time', from: '', to: '' },
  };
  const order = mode === 'day' ? ['today', 'month', 'last'] : ['month', 'last', 'all'];
  const initial = mode === 'day' ? 'today' : 'month';

  const chips = el('div', { class: 'seg period-chips' });
  const from = el('input', { type: 'date', value: PRESETS[initial].from });
  const to = el('input', { type: 'date', value: PRESETS[initial].to });
  let preset = initial;

  const paintChips = () => [...chips.children].forEach(b => b.classList.toggle('on', b.dataset.p === preset));

  order.forEach(id => {
    const b = el('button', { type: 'button', class: 'seg-chip', dataset: { p: id }, text: tx(t(PRESETS[id].bn, PRESETS[id].en)) });
    b.addEventListener('click', () => {
      preset = id;
      from.value = PRESETS[id].from;
      to.value = PRESETS[id].to;
      paintChips();
      if (onChange) onChange();
    });
    chips.appendChild(b);
  });
  paintChips();

  const dates = el('div', { class: 'period-dates' });
  const mk = (lbl, node) => {
    const f = el('div', { class: 'field' });
    f.appendChild(el('label', { text: lbl }));
    f.appendChild(node);
    return f;
  };
  dates.append(mk(t('শুরু', 'From'), from), mk(t('শেষ', 'To'), to));
  const node = el('div', { class: 'period-pick' }, [chips, dates]);

  const custom = () => { preset = 'custom'; paintChips(); if (onChange) onChange(); };
  from.addEventListener('change', custom);
  to.addEventListener('change', custom);

  return {
    node, from, to,
    get preset() { return preset; },
    range: () => ({ from: from.value, to: to.value }),
    inRange: d => {
      const x = String(d.date || '').slice(0, 10);
      return (!from.value || x >= from.value) && (!to.value || x <= to.value);
    },
    label: () => (from.value || to.value)
      ? `${fmtDate(from.value) || t('শুরু থেকে', 'beginning')} – ${fmtDate(to.value) || fmtDate(todayISO())}`
      : t('সব সময়', 'all time'),
  };
}

/** Status selector shared by the deposit-based reports (approved/pending/all). */
function statusPicker({ onChange = null } = {}) {
  const chips = segChips('repstatus', [
    { value: 'approved', bn: 'অনুমোদিত', en: 'Approved' },
    { value: 'pending', bn: 'অপেক্ষমাণ', en: 'Pending' },
    { value: 'all', bn: 'সব', en: 'All' },
  ], 'approved', { onChange: () => onChange && onChange() });
  chips.root.classList.add('period-status');
  return chips;
}
const depositsByStatus = (deposits, st) => st === 'approved' ? approvedOf(deposits)
  : st === 'pending' ? deposits.filter(d => d.status === 'pending')
  : deposits;

function periodReport(ctx, meta, mode) {
  const { session } = ctx;
  const own = session.role === 'member';
  const picker = periodPicker({ mode: mode === 'daily' ? 'day' : 'range', onChange: () => ctx.live && ctx.live() });
  const status = statusPicker({ onChange: () => ctx.live && ctx.live() });
  const memPick = !own ? memberPicker({ members: ctx.members, placeholder: t('খালি = সব সদস্য…', 'empty = all members…') }) : null;
  ctx_filter(ctx, mkField(t('সময়কাল', 'Period'), picker.node, '260px'));
  ctx_filter(ctx, mkField(t('স্ট্যাটাস', 'Status'), status.root, '200px'));
  if (memPick) { ctx_filter(ctx, mkField(t('সদস্য', 'Member'), memPick.root, '220px')); ctx.filterHost.closest('.card')?.classList.add('overflow-visible'); }

  const scoped = () => {
    let rows = depositsByStatus(ctx.deposits, status.value);
    if (own) rows = rows.filter(d => d.memberDocId === session.memberDocId);
    else if (memPick && memPick.value) rows = rows.filter(d => d.memberDocId === memPick.value);
    return rows.filter(picker.inRange);
  };

  function build() {
    const rows = scoped().slice().sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.memberId).localeCompare(String(b.memberId)));
    const total = rows.reduce((s, d) => s + num(d.amount), 0);
    const sub = `${mode === 'daily' ? 'Date' : 'Period'}: ${picker.label()}`
      + (status.value === 'approved' ? '' : ` · ${status.value.toUpperCase()}`);

    const sheet = buildSheet({
      cfg: ctx.cfg, titleEn: meta.en, subEn: sub, titleBn: t(meta.bn, meta.en),
      parts: [
        sechead(own ? 'My Collection Details' : 'Collection Details'),
        psTable(
          [txnCol, { label: 'Date', cls: 'c' }, { label: 'Member ID', cls: 'c' }, { label: 'Member Name' }, { label: 'Deposit Type' }, { label: 'Payment Method' }, { label: 'Amount', cls: 'num' }],
          rows.map(d => [
            txnCell(d), { text: fmtDate(d.date), cls: 'c' }, { text: d.memberId, cls: 'c' },
            d.memberName, typeLabel(d.type).en, methodLabel(d.method).en,
            { text: money(d.amount), cls: 'num' },
          ]),
          [[{ text: 'Total Collection', span: 6 }, { text: money(total), cls: 'num' }]],
        ),
      ],
    });
    const sole = rows.length && rows.every(d => d.memberDocId === rows[0].memberDocId) ? rows[0].memberName : '';
    return { sheet, memberName: own ? (ctx.members.find(m => m.id === session.memberDocId)?.nameEn || ctx.members.find(m => m.id === session.memberDocId)?.nameBn || '') : (memPick && memPick.value ? rows[0]?.memberName : sole) };
  }
  /* live counter — proves the filters really drive the output */
  build.preview = () => {
    const rows = scoped();
    return `${rows.length} ${t('টি এন্ট্রি', 'entries')} · ${taka(rows.reduce((s, d) => s + num(d.amount), 0))}`;
  };
  return build;
}
function ctx_filter(ctx, ...nodes) { nodes.forEach(n => ctx.filterHost.appendChild(n)); }

/* ================= Overall / member report ================= */
function rOverall(ctx, meta) {
  const stSel = el('select');
  [['active', t('শুধু সক্রিয়', 'Active only')], ['', t('সব সদস্য (বাতিল বাদে)', 'All except rejected')], ['pending', t('অপেক্ষমাণ', 'Pending')]].forEach(([v, l]) => stSel.appendChild(el('option', { value: v }, [l])));
  ctx_filter(ctx, mkField(t('সদস্য স্ট্যাটাস', 'Member status'), stSel, '160px'));
  stSel.addEventListener('change', () => ctx.live && ctx.live());

  const sumsOf = () => ctx.members.filter(m => (stSel.value ? m.status === stSel.value : m.status !== 'rejected'))
    .map(m => memberSummary(m, ctx.deposits, cfgOf(ctx)))
    .sort((a, b) => (a.member.memberId || '').localeCompare(b.member.memberId || ''));

  const build = () => {
    const sums = sumsOf();
    const tot = orgTotals(sums);
    const sheet = buildSheet({
      cfg: ctx.cfg, titleEn: 'Member Report', subEn: `As on ${fmtDate(todayISO())}${stSel.value ? ' · ' + stSel.value.toUpperCase() + ' members' : ''}`, titleBn: t(meta.bn, meta.en),
      parts: [psTable(
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
      )],
    });
    return { sheet };
  };
  build.preview = () => {
    const sums = sumsOf();
    return `${sums.length} ${t('জন সদস্য', 'members')} · ${taka(orgTotals(sums).totalDeposit)}`;
  };
  return build;
}

/* ================= Due & Advance ================= */
function rDueAdvance(ctx, meta, kind) {
  const minInput = el('input', { type: 'number', min: '0', step: '1', value: '1', placeholder: '0' });
  ctx_filter(ctx, mkField(kind === 'due' ? t('ন্যূনতম বকেয়া (৳)', 'Min due (৳)') : t('ন্যূনতম অগ্রিম (৳)', 'Min advance (৳)'), minInput, '150px'));
  minInput.addEventListener('input', () => ctx.live && ctx.live());

  const sumsOf = () => {
    const min = num(minInput.value);
    return ctx.members.filter(m => m.status === 'active' || m.status === 'pending')
      .map(m => memberSummary(m, ctx.deposits, cfgOf(ctx)))
      .filter(s => (kind === 'due' ? s.due : s.advance) >= Math.max(min, 0.01))
      .sort((a, b) => (kind === 'due' ? b.due - a.due : b.advance - a.advance));
  };

  const build = () => {
    const sums = sumsOf();
    const min = num(minInput.value);
    const total = sums.reduce((s, x) => s + (kind === 'due' ? x.due : x.advance), 0);
    const sheet = buildSheet({
      cfg: ctx.cfg, titleEn: meta.en, subEn: `As on ${fmtDate(todayISO())} · min ৳${min}`, titleBn: t(meta.bn, meta.en),
      parts: [psTable(
        [{ label: 'SL', cls: 'c' }, { label: 'Member ID', cls: 'c' }, { label: 'Member Name' }, { label: 'Mobile', cls: 'c' },
         { label: 'Monthly Installment', cls: 'num' }, { label: 'Total Deposit', cls: 'num' }, { label: kind === 'due' ? 'Total Due' : 'Total Advance', cls: 'num' }],
        sums.map((s, i) => [
          { text: i + 1, cls: 'c' }, { text: s.member.memberId, cls: 'c' }, s.member.nameEn || s.member.nameBn,
          { text: s.member.mobile, cls: 'c' }, { text: money(s.member.installment), cls: 'num' },
          { text: money(s.totalDeposit), cls: 'num' }, { text: money(kind === 'due' ? s.due : s.advance), cls: 'num' },
        ]),
        [[{ text: kind === 'due' ? 'Total Due' : 'Total Advance', span: 6 }, { text: money(total), cls: 'num' }]],
      )],
    });
    return { sheet };
  };
  build.preview = () => {
    const sums = sumsOf();
    return `${sums.length} ${t('জন সদস্য', 'members')} · ${taka(sums.reduce((s, x) => s + (kind === 'due' ? x.due : x.advance), 0))}`;
  };
  return build;
}

/* ================= Collection (yearly) ================= */
function rCollection(ctx, meta) {
  const yr = el('select');
  const years = Array.from(new Set(approvedOf(ctx.deposits).map(d => String(d.date).slice(0, 4)).concat([String(new Date().getFullYear())]))).sort();
  years.forEach(y => yr.appendChild(el('option', { value: y, ...(y === String(new Date().getFullYear()) ? { selected: true } : {}) }, [y])));
  ctx_filter(ctx, mkField(t('বছর', 'Year'), yr, '120px'));
  yr.addEventListener('change', () => ctx.live && ctx.live());

  const apprOf = () => approvedOf(ctx.deposits).filter(d => String(d.date).slice(0, 4) === yr.value);

  const build = () => {
    const y = yr.value;
    const appr = apprOf();
    const months = Array.from({ length: 12 }, (_, i) => `${y}-${String(i + 1).padStart(2, '0')}`);
    const rows = months.map(mk => {
      const list = appr.filter(d => monthKey(d.date) === mk);
      const o = { mk, n: list.length, total: 0, cash: 0, mobile: 0, bank: 0 };
      list.forEach(d => { o.total += num(d.amount); o[d.method] = (o[d.method] || 0) + num(d.amount); });
      return o;
    });
    const total = rows.reduce((s, r) => s + r.total, 0);
    const tCash = rows.reduce((s, r) => s + r.cash, 0), tMob = rows.reduce((s, r) => s + r.mobile, 0), tBank = rows.reduce((s, r) => s + r.bank, 0);
    const sheet = buildSheet({
      cfg: ctx.cfg, titleEn: 'Collection Report', subEn: `Year: ${y}`, titleBn: t(meta.bn, meta.en),
      parts: [psTable(
        [{ label: 'Month' }, { label: 'Transactions', cls: 'num' }, { label: 'Cash', cls: 'num' }, { label: 'Mobile Banking', cls: 'num' }, { label: 'Bank', cls: 'num' }, { label: 'Total Collection', cls: 'num' }],
        rows.map(r => [monthLabel(r.mk), { text: r.n, cls: 'num' }, { text: money(r.cash), cls: 'num' }, { text: money(r.mobile), cls: 'num' }, { text: money(r.bank), cls: 'num' }, { text: money(r.total), cls: 'num' }]),
        [[{ text: 'Total' }, { text: appr.length, cls: 'num' }, { text: money(tCash), cls: 'num' }, { text: money(tMob), cls: 'num' }, { text: money(tBank), cls: 'num' }, { text: money(total), cls: 'num' }]],
      )],
    });
    return { sheet };
  };
  build.preview = () => {
    const appr = apprOf();
    return `${appr.length} ${t('টি এন্ট্রি', 'entries')} · ${taka(appr.reduce((s, d) => s + num(d.amount), 0))}`;
  };
  return build;
}

/* ================= Payment method ================= */
function rMethod(ctx, meta) {
  const picker = periodPicker({ onChange: () => ctx.live && ctx.live() });
  ctx_filter(ctx, mkField(t('সময়কাল', 'Period'), picker.node, '260px'));

  const scoped = () => approvedOf(ctx.deposits).filter(picker.inRange);
  const build = () => {
    const rows = scoped();
    const total = rows.reduce((s, d) => s + num(d.amount), 0);
    const grid = PAY_METHODS.map(p => {
      const list = rows.filter(d => d.method === p.id);
      const amt = list.reduce((s, d) => s + num(d.amount), 0);
      return { p, n: list.length, amt, pct: total ? (amt / total) * 100 : 0, list };
    });
    const parts = [psTable(
      [{ label: 'Payment Method' }, { label: 'Transactions', cls: 'num' }, { label: 'Amount', cls: 'num' }, { label: 'Share (%)', cls: 'num' }],
      grid.map(g => [g.p.en, { text: g.n, cls: 'num' }, { text: money(g.amt), cls: 'num' }, { text: g.pct.toFixed(2), cls: 'num' }]),
      [[{ text: 'Total' }, { text: rows.length, cls: 'num' }, { text: money(total), cls: 'num' }, { text: total ? '100.00' : '0.00', cls: 'num' }]],
    )];
    grid.forEach(g => {
      if (!g.list.length) return;
      parts.push(sechead(`${g.p.en} — Details`));
      parts.push(psTable(
        [txnCol, { label: 'Date', cls: 'c' }, { label: 'Member ID', cls: 'c' }, { label: 'Member Name' }, { label: 'Deposit Type' }, { label: 'Amount', cls: 'num' }],
        g.list.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)))
          .map(d => [txnCell(d), { text: fmtDate(d.date), cls: 'c' }, { text: d.memberId, cls: 'c' }, d.memberName, typeLabel(d.type).en, { text: money(d.amount), cls: 'num' }]),
        [[{ text: 'Subtotal', span: 5 }, { text: money(g.amt), cls: 'num' }]],
      ));
    });
    const sheet = buildSheet({ cfg: ctx.cfg, titleEn: meta.en, subEn: `Period: ${picker.label()}`, titleBn: t(meta.bn, meta.en), parts });
    return { sheet };
  };
  build.preview = () => {
    const rows = scoped();
    return `${rows.length} ${t('টি এন্ট্রি', 'entries')} · ${taka(rows.reduce((s, d) => s + num(d.amount), 0))}`;
  };
  return build;
}

/* ================= Member-wise ================= */
function rMemberWise(ctx, meta) {
  const pick = memberPicker({ members: ctx.members, placeholder: t('খালি রাখলে সকল সদস্য…', 'empty = all members…') });
  const picker = periodPicker({ onChange: () => ctx.live && ctx.live() });
  ctx_filter(ctx, mkField(t('সদস্য', 'Member'), pick.root, '220px'), mkField(t('সময়কাল', 'Period'), picker.node, '260px'));
  ctx.filterHost.closest('.card')?.classList.add('overflow-visible');

  const pool = () => (pick.value ? ctx.members.filter(m => m.id === pick.value) : ctx.members.filter(m => m.status !== 'rejected'));
  const dataOf = () => pool().map(m => {
    const s = memberSummary(m, ctx.deposits, cfgOf(ctx));
    const list = s.deposits.filter(picker.inRange).sort((a, b) => String(a.date).localeCompare(String(b.date)));
    return { m, s, list, periodTotal: list.reduce((x, d) => x + num(d.amount), 0) };
  }).sort((a, b) => a.m.memberId.localeCompare(b.m.memberId));

  const build = () => {
    const data = dataOf();
    const gTotal = data.reduce((s, r) => s + r.periodTotal, 0);
    const period = `Period: ${picker.label()}`;

    const parts = [psTable(
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
    )];
    if (data.length === 1) {
      const r = data[0];
      parts.push(sechead('Deposit Details'));
      let cum = 0;
      parts.push(psTable(
        [txnCol, { label: 'Date', cls: 'c' }, { label: 'Deposit Type' }, { label: 'Payment Method' }, { label: 'Description' }, { label: 'Amount', cls: 'num' }, { label: 'Cumulative', cls: 'num' }],
        r.list.map((d, i) => { cum += num(d.amount); return [txnCell(d), { text: fmtDate(d.date), cls: 'c' }, typeLabel(d.type).en, methodLabel(d.method).en, d.description || '-', { text: money(d.amount), cls: 'num' }, { text: money(cum), cls: 'num' }]; }),
        [[{ text: 'Total', span: 5 }, { text: money(r.periodTotal), cls: 'num' }, { text: money(cum), cls: 'num' }]],
      ));
    }
    const sheet = buildSheet({ cfg: ctx.cfg, titleEn: meta.en, subEn: period, titleBn: t(meta.bn, meta.en), parts, orientation: 'l' });
    return { sheet, memberName: data.length === 1 ? (data[0].m.nameEn || data[0].m.nameBn) : '' };
  };
  build.preview = () => {
    const data = dataOf();
    return `${data.length} ${t('জন সদস্য', 'members')} · ${taka(data.reduce((s, r) => s + r.periodTotal, 0))}`;
  };
  return build;
}

/* ================= Withdrawal report ================= */
function rWithdrawal(ctx, meta) {
  const { session } = ctx;
  const own = session.role === 'member';
  const picker = periodPicker({ onChange: () => ctx.live && ctx.live() });
  ctx_filter(ctx, mkField(t('সময়কাল', 'Period'), picker.node, '260px'));

  const scoped = () => (own ? ctx.withdrawals.filter(w => w.memberDocId === session.memberDocId || w.memberId === session.memberId) : ctx.withdrawals)
    .filter(w => w.status === 'approved').filter(picker.inRange);

  const build = () => {
    let rows = scoped();
    rows = rows.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.memberId).localeCompare(String(b.memberId)));
    const total = rows.reduce((s, w) => s + num(w.amount), 0);
    const sheet = buildSheet({
      cfg: ctx.cfg, titleEn: meta.en,
      subEn: `Period: ${picker.label()}`,
      titleBn: t(meta.bn, meta.en),
      parts: [psTable(
        [txnCol, { label: 'Date', cls: 'c' }, { label: 'Member ID', cls: 'c' }, { label: 'Member Name' }, { label: 'Withdrawal Type' }, { label: 'Payment Method' }, { label: 'Amount', cls: 'num' }],
        rows.map(w => [
          txnCell(w), { text: fmtDate(w.date), cls: 'c' }, { text: w.memberId, cls: 'c' },
          w.memberName, withdrawalTypeLabel(w.type).en, methodLabel(w.method).en, { text: money(w.amount), cls: 'num' },
        ]),
        [[{ text: 'Total Withdrawal', span: 6 }, { text: money(total), cls: 'num' }]],
      )],
    });
    const sole = rows.length && rows.every(w => w.memberDocId === rows[0].memberDocId) ? rows[0].memberName : '';
    return { sheet, memberName: own ? (ctx.members.find(m => m.id === session.memberDocId)?.nameEn || ctx.members.find(m => m.id === session.memberDocId)?.nameBn || '') : sole };
  };
  build.preview = () => {
    const rows = scoped();
    return `${rows.length} ${t('টি উত্তোলন', 'withdrawals')} · ${taka(rows.reduce((s, w) => s + num(w.amount), 0))}`;
  };
  return build;
}

const BUILDERS = {
  overall: rOverall,
  daily: (c, m) => periodReport(c, m, 'daily'),
  monthly: (c, m) => periodReport(c, m, 'monthly'),
  range: (c, m) => periodReport(c, m, 'range'),
  due: (c, m) => rDueAdvance(c, m, 'due'),
  advance: (c, m) => rDueAdvance(c, m, 'advance'),
  collection: rCollection,
  method: rMethod,
  memberwise: rMemberWise,
  withdrawal: rWithdrawal,
};
