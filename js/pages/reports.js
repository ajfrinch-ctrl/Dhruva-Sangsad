/* Reports — modern flow per audit:
   SUMMARY (first) → Report Type dropdown → Filters → [Generate Report]
   → popup preview that shows the EXACT sheet → PDF only.
   Excel / CSV / Image / JSON downloads are gone; the member statement lives
   on its own Statements page (not duplicated here). */
import {
  el, esc, toast, taka, money, num, fmtDate, todayISO, monthKey, monthLabel,
  typeLabel, methodLabel, PAY_METHODS, waNumber, t,
} from '../util.js';
import { page, card, btn, statCard } from '../ui.js';
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
  wrap.appendChild(el('div', { class: 'sec-head', html: `<h2>${esc(t('সারসংক্ষেপ', 'Summary'))}</h2><span class="sp"></span>` }));
  wrap.appendChild(stats);

  /* ============ 2 — Report type (a dropdown, NOT tiles) ============ */
  const list = REPORTS.filter(r => r.roles.includes(session.role));
  const typeSel = el('select', { 'aria-label': t('প্রতিবেদনের ধরন', 'Report type') });
  list.forEach(r => typeSel.appendChild(el('option', { value: r.id, ...(r.id === list[0].id ? { selected: true } : {}) }, [`${t(r.bn, r.en)}`])));
  if (params.report && list.some(r => r.id === params.report)) typeSel.value = params.report;
  wrap.appendChild(card(t('রিপোর্টের ধরন', 'Report Type'), '', el('div', {}, [typeSel])));

  /* ============ 3 — Filters (contextual) ============ */
  const filterHost = el('div', { class: 'toolbar' });
  const filterCard = card(t('ফিল্টার', 'Filters'), '', filterHost);
  filterCard.classList.add('overflow-visible');
  wrap.appendChild(filterCard);

  /* ============ 4 — Generate (filters exist BEFORE it) ============ */
  const ctx = { session, members, deposits, withdrawals: withdrawals || [], cfg, filterHost };
  /* the selected builder wires its filter widgets once, and returns build() */
  let buildFn = null;
  const setup = () => {
    filterHost.replaceChildren();
    const meta = REPORTS.find(x => x.id === typeSel.value) || list[0];
    try { buildFn = BUILDERS[meta.id](ctx, meta); }
    catch (err) { buildFn = null; toast(err.message || String(err), 'error'); }
  };
  typeSel.addEventListener('change', setup);
  setup();

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
function periodReport(ctx, meta, mode) {
  const { session } = ctx;
  const own = session.role === 'member';
  const dInput = el('input', { type: 'date', value: todayISO() });
  const mInput = el('input', { type: 'month', value: monthKey(todayISO()) });
  const from = el('input', { type: 'date', value: monthKey(todayISO()) + '-01' });
  const to = el('input', { type: 'date', value: todayISO() });
  const memPick = !own ? memberPicker({ members: ctx.members, placeholder: t('খালি = সব সদস্য…', 'empty = all members…') }) : null;
  if (mode === 'daily') ctx_filter(ctx, mkField(t('তারিখ', 'Date'), dInput, '150px'));
  else if (mode === 'monthly') ctx_filter(ctx, mkField(t('মাস', 'Month'), mInput, '150px'));
  else { ctx_filter(ctx, mkField(t('শুরু', 'From'), from, '140px')); ctx_filter(ctx, mkField(t('শেষ', 'To'), to, '140px')); }
  if (memPick) { ctx_filter(ctx, mkField(t('সদস্য', 'Member'), memPick.root, '220px')); ctx.filterHost.closest('.card')?.classList.add('overflow-visible'); }

  function build() {
    let rows;
    let sub;
    if (mode === 'daily') {
      rows = approvedOf(ctx.deposits).filter(d => String(d.date).slice(0, 10) === dInput.value);
      sub = `Date: ${fmtDate(dInput.value)}`;
    } else if (mode === 'monthly') {
      rows = approvedOf(ctx.deposits).filter(d => monthKey(d.date) === mInput.value);
      sub = `Month: ${monthLabel(mInput.value)}`;
    } else {
      if (from.value && to.value && from.value > to.value) throw new Error(t('তারিখের ক্রম সঠিক নয় / From date must be before To date', 'From date must be before To date'));
      rows = approvedOf(ctx.deposits).filter(d => {
        const x = String(d.date).slice(0, 10);
        return (!from.value || x >= from.value) && (!to.value || x <= to.value);
      });
      sub = `Period: ${fmtDate(from.value)} to ${fmtDate(to.value)}`;
    }
    if (own) rows = rows.filter(d => d.memberDocId === session.memberDocId);
    else if (memPick && memPick.value) rows = rows.filter(d => d.memberDocId === memPick.value);
    rows = rows.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.memberId).localeCompare(String(b.memberId)));
    const total = rows.reduce((s, d) => s + num(d.amount), 0);

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
  return build;
}
function ctx_filter(ctx, ...nodes) { nodes.forEach(n => ctx.filterHost.appendChild(n)); }

/* ================= Overall / member report ================= */
function rOverall(ctx, meta) {
  const stSel = el('select');
  [['active', t('শুধু সক্রিয়', 'Active only')], ['', t('সব সদস্য (বাতিল বাদে)', 'All except rejected')], ['pending', t('অপেক্ষমাণ', 'Pending')]].forEach(([v, l]) => stSel.appendChild(el('option', { value: v }, [l])));
  ctx_filter(ctx, mkField(t('সদস্য স্ট্যাটাস', 'Member status'), stSel, '160px'));

  return () => {
    const pool = ctx.members.filter(m => (stSel.value ? m.status === stSel.value : m.status !== 'rejected'));
    const sums = pool.map(m => memberSummary(m, ctx.deposits, cfgOf(ctx)))
      .sort((a, b) => (a.member.memberId || '').localeCompare(b.member.memberId || ''));
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
}

/* ================= Due & Advance ================= */
function rDueAdvance(ctx, meta, kind) {
  const minInput = el('input', { type: 'number', min: '0', step: '1', value: '1', placeholder: '0' });
  ctx_filter(ctx, mkField(kind === 'due' ? t('ন্যূনতম বকেয়া (৳)', 'Min due (৳)') : t('ন্যূনতম অগ্রিম (৳)', 'Min advance (৳)'), minInput, '150px'));

  return () => {
    const min = num(minInput.value);
    const sums = ctx.members.filter(m => m.status === 'active' || m.status === 'pending')
      .map(m => memberSummary(m, ctx.deposits, cfgOf(ctx)))
      .filter(s => (kind === 'due' ? s.due : s.advance) >= Math.max(min, 0.01))
      .sort((a, b) => (kind === 'due' ? b.due - a.due : b.advance - a.advance));
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
}

/* ================= Collection (yearly) ================= */
function rCollection(ctx, meta) {
  const yr = el('select');
  const years = Array.from(new Set(approvedOf(ctx.deposits).map(d => String(d.date).slice(0, 4)).concat([String(new Date().getFullYear())]))).sort();
  years.forEach(y => yr.appendChild(el('option', { value: y, ...(y === String(new Date().getFullYear()) ? { selected: true } : {}) }, [y])));
  ctx_filter(ctx, mkField(t('বছর', 'Year'), yr, '120px'));

  return () => {
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
}

/* ================= Payment method ================= */
function rMethod(ctx, meta) {
  const from = el('input', { type: 'date', value: monthKey(todayISO()) + '-01' });
  const to = el('input', { type: 'date', value: todayISO() });
  ctx_filter(ctx, mkField(t('শুরু', 'From'), from, '140px'), mkField(t('শেষ', 'To'), to, '140px'));

  return () => {
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
    const sheet = buildSheet({ cfg: ctx.cfg, titleEn: meta.en, subEn: `Period: ${fmtDate(from.value)} to ${fmtDate(to.value)}`, titleBn: t(meta.bn, meta.en), parts });
    return { sheet };
  };
}

/* ================= Member-wise ================= */
function rMemberWise(ctx, meta) {
  const pick = memberPicker({ members: ctx.members, placeholder: t('খালি রাখলে সকল সদস্য…', 'empty = all members…') });
  const from = el('input', { type: 'date' });
  const to = el('input', { type: 'date' });
  ctx_filter(ctx, mkField(t('সদস্য', 'Member'), pick.root, '220px'), mkField(t('শুরু', 'From'), from, '130px'), mkField(t('শেষ', 'To'), to, '130px'));
  ctx.filterHost.closest('.card')?.classList.add('overflow-visible');

  return () => {
    const pool = pick.value ? ctx.members.filter(m => m.id === pick.value) : ctx.members.filter(m => m.status !== 'rejected');
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
}

/* ================= Withdrawal report ================= */
function rWithdrawal(ctx, meta) {
  const { session } = ctx;
  const own = session.role === 'member';
  const from = el('input', { type: 'date' });
  const to = el('input', { type: 'date' });
  ctx_filter(ctx, mkField(t('শুরু', 'From'), from, '140px'), mkField(t('শেষ', 'To'), to, '140px'));

  return () => {
    let rows = (own ? ctx.withdrawals.filter(w => w.memberDocId === session.memberDocId || w.memberId === session.memberId) : ctx.withdrawals)
      .filter(w => w.status === 'approved');
    if (from.value) rows = rows.filter(w => String(w.date).slice(0, 10) >= from.value);
    if (to.value) rows = rows.filter(w => String(w.date).slice(0, 10) <= to.value);
    rows = rows.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.memberId).localeCompare(String(b.memberId)));
    const total = rows.reduce((s, w) => s + num(w.amount), 0);
    const sheet = buildSheet({
      cfg: ctx.cfg, titleEn: meta.en,
      subEn: `Period: ${from.value ? fmtDate(from.value) : 'Beginning'} to ${to.value ? fmtDate(to.value) : fmtDate(todayISO())}`,
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
