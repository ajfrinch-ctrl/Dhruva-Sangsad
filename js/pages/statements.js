/* Statements — the ONE authoritative statement implementation.
 *
 *   STATEMENT = what happened to this member's account, over time.
 *   Columns  = Date · Description · Deposit · Payment · Balance
 *              (no serial number, no transaction-id column)
 *   Output   = ALWAYS English: the on-screen preview and the downloaded PDF
 *              are the same sheet node, so they cannot disagree — and the PDF
 *              stays English even when the UI language is বাংলা.
 *
 * Staff choose a member here; a member automatically gets their own account and
 * is never shown a member filter.
 */
import {
  el, esc, toast, taka, num, fmtDate, fmtDateEn, todayISO, t, tx,
  typeLabel, methodLabel,
} from '../util.js';
import { page, card, statementTable, banner, btn, statCard, kv, sectionHead } from '../ui.js';
import { memberPicker } from '../picker.js';
import {
  allMembers, allDeposits, allWithdrawals, settings, memberSummary, summaryOpts, statementRows,
  withdrawalBalance, withdrawalTypeLabel,
} from '../store.js';
import { buildSheet, psInfo, psTable, sechead } from '../sheet.js';
import { previewReport, reportFileName } from '../preview.js';

const isStaff = session => session.role === 'admin' || session.role === 'maker';
const monthStart = () => todayISO().slice(0, 7) + '-01';
const prevMonth = () => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  const p = n => String(n).padStart(2, '0');
  return { from: `${d.getFullYear()}-${p(d.getMonth() + 1)}-01`, to: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate())}` };
};

/** English description used by the printable sheet (matches the PDF). */
export function statementDescription(row) {
  const label = row.kind === 'deposit' ? typeLabel(row.type).en : withdrawalTypeLabel(row.type).en;
  const method = methodLabel(row.method).en;
  const extra = row.description ? ` — ${row.description}` : '';
  return `${label} · ${method}${extra}`;
}

export async function pageStatements(session, params = {}) {
  const staff = isStaff(session);
  const [members, deposits, withdrawals, cfg] = await Promise.all([
    allMembers(), allDeposits(), allWithdrawals(), settings(),
  ]);
  const wrap = page(t('স্টেটমেন্ট', 'Statement'), 'Member Statement', 'report');

  /* ---- member context: members get their own, staff pick one ---- */
  let memberDocId = '';
  let picker = null;
  let ready = false;
  if (staff) {
    const pool = members.filter(m => m.status !== 'rejected');
    if (!pool.length) { wrap.appendChild(banner('err', esc(t('কোনো সদস্য পাওয়া যায়নি।', 'No member found.')))); return wrap; }
    const host = el('div', { class: 'toolbar' });
    picker = memberPicker({
      members: pool,
      value: params.memberDocId || '',
      placeholder: t('সদস্য খুঁজুন (নাম / আইডি / মোবাইল)…', 'Find a member (name / ID / mobile)…'),
      /* the picker also fires for its initial value, before the rest of the
         screen exists — paint() only once the page is fully built (ready) */
      onPick: () => { if (ready) paint(); },
    });
    const f = el('div', { class: 'field' });
    f.appendChild(el('label', { text: t('সদস্য', 'Member') }));
    f.appendChild(picker.root);
    host.appendChild(f);
    const pickerCard = card(t('সদস্য নির্বাচন', 'Choose member'), 'Statement', host);
    pickerCard.classList.add('overflow-visible');
    wrap.appendChild(pickerCard);
    memberDocId = picker.value || '';
  } else {
    memberDocId = session.memberDocId || '';
  }

  /* ---- period: optional; the user decides, nothing is hard-coded ---- */
  const fromEl = el('input', { type: 'date', value: params.from || '' });
  const toEl = el('input', { type: 'date', value: params.to || '' });
  const periodHost = el('div', { class: 'toolbar' });
  const mkDate = (label, node) => {
    const f = el('div', { class: 'field', style: 'flex:1 1 150px' });
    f.appendChild(el('label', { text: label }));
    f.appendChild(node);
    return f;
  };
  periodHost.append(mkDate(t('শুরু', 'From'), fromEl), mkDate(t('শেষ', 'To'), toEl));
  const quick = el('div', { class: 'seg' });
  [
    { id: 'all', label: t('সব সময়', 'All time') },
    { id: 'month', label: t('এই মাস', 'This month') },
    { id: 'last', label: t('গত মাস', 'Last month') },
  ].forEach(q => {
    const b = el('button', { type: 'button', class: 'seg-chip', text: q.label });
    b.addEventListener('click', () => {
      if (q.id === 'all') { fromEl.value = ''; toEl.value = ''; }
      else if (q.id === 'month') { fromEl.value = monthStart(); toEl.value = todayISO(); }
      else { const p = prevMonth(); fromEl.value = p.from; toEl.value = p.to; }
      [...quick.children].forEach(c => c.classList.toggle('on', c === b));
      paint();
    });
    quick.appendChild(b);
  });
  quick.firstChild.classList.add('on');
  const periodCard = card(t('সময়কাল (ঐচ্ছিক)', 'Period (optional)'), 'Statement period', el('div', {}, [quick, periodHost]));
  wrap.appendChild(periodCard);

  const infoHost = el('div');
  const bodyHost = el('div');
  wrap.appendChild(infoHost);
  wrap.appendChild(bodyHost);

  /* ---- render the statement on screen immediately (no PDF needed) ---- */
  let current = null;

  function paint() {
    infoHost.replaceChildren();
    bodyHost.replaceChildren();
    const id = staff ? (picker ? picker.value : '') : memberDocId;
    if (!id) {
      bodyHost.appendChild(banner('info', esc(t('স্টেটমেন্ট দেখতে একজন সদস্য নির্বাচন করুন।', 'Choose a member to see their statement.'))));
      return;
    }
    const m = members.find(x => x.id === id);
    if (!m) { bodyHost.appendChild(banner('err', esc(t('সদস্য পাওয়া যায়নি।', 'Member not found.')))); return; }

    const summary = memberSummary(m, deposits, summaryOpts(cfg, { withdrawals }));
    const rows = statementRows(summary, { from: fromEl.value, to: toEl.value });
    const bal = withdrawalBalance(m, deposits, withdrawals);
    const totalDeposit = rows.reduce((a, r) => a + r.deposit, 0);
    const totalPayment = rows.reduce((a, r) => a + r.payment, 0);
    current = { m, summary, rows, cfg, totalDeposit, totalPayment, closing: rows.length ? rows[rows.length - 1].balance : 0 };

    const stats = el('div', { class: 'stats' });
    stats.append(
      statCard({ label: t('মোট জমা', 'Total deposit'), value: taka(totalDeposit), sub: `${rows.filter(r => r.kind === 'deposit').length} ${t('টি এন্ট্রি', 'entries')}`, ic: 'deposit' }),
      statCard({ label: t('মোট পরিশোধ', 'Total payment'), value: taka(totalPayment), sub: `${rows.filter(r => r.kind === 'withdrawal').length} ${t('টি এন্ট্রি', 'entries')}`, ic: 'withdraw', tone: 'red' }),
      statCard({ label: t('বর্তমান ব্যালেন্স', 'Closing balance'), value: taka(current.closing), sub: t('সব অনুমোদিত লেনদেন', 'all approved activity'), ic: 'money', tone: 'blue' }),
      statCard({ label: t('বকেয়া', 'Due'), value: taka(summary.due), sub: t('অনুমোদিত জমার ভিত্তিতে', 'based on approved deposits'), ic: 'due', tone: summary.due > 0 ? 'red' : '' }),
    );
    infoHost.appendChild(statCardShell(m, stats));

    bodyHost.appendChild(sectionHead(t('লেনদেনের বিবরণ', 'Statement details'), 'Statement'));
    bodyHost.appendChild(statementTable(
      rows.map(r => ({
        date: r.date,
        description: r.kind === 'deposit' ? t(typeLabel(r.type).bn, typeLabel(r.type).en) : t(withdrawalTypeLabel(r.type).bn, withdrawalTypeLabel(r.type).en),
        deposit: r.deposit, payment: r.payment, balance: r.balance,
      })),
    ));

    const actions = el('div', { class: 'statement-actions' });
    actions.appendChild(btn(t('প্রিভিউ ও পিডিএফ', 'Preview & PDF'), 'pdf', 'primary', openPreview, { block: true }));
    bodyHost.appendChild(actions);
  }

  function statCardShell(m, stats) {
    const c = card(t('সদস্য', 'Member'), 'Statement', el('div', {}, [
      kv([
        [t('নাম', 'Name'), esc(m.nameBn || m.nameEn || '')],
        [t('সদস্য আইডি', 'Member ID'), `<b>${esc(m.memberId)}</b>`],
        [t('মাসিক কিস্তি', 'Monthly installment'), taka(m.installment)],
      ]),
      stats,
    ]));
    return c;
  }

  /** The printable sheet — English, identical to the downloaded PDF. */
  function buildStatementSheet() {
    const { m, rows, cfg: c } = current;
    const period = (fromEl.value || toEl.value)
      ? `Period: ${fromEl.value ? fmtDateEn(fromEl.value) : 'Beginning'} to ${toEl.value ? fmtDateEn(toEl.value) : fmtDateEn(todayISO())}`
      : `Period: Beginning to ${fmtDateEn(todayISO())}`;
    return buildSheet({
      cfg: c,
      titleEn: 'Member Statement',
      titleBn: 'Dhruva Sangsad',
      subEn: period,
      parts: [
        psInfo([
          ['Member ID', m.memberId], ['Status', String(m.status || '').toUpperCase()],
          ['Name (English)', m.nameEn], ['Name (Bangla)', m.nameBn],
          ['Mobile', m.mobile], ['Joined', fmtDateEn(m.joinDate)],
          ['Monthly Installment', `${taka(m.installment)}`], ['Statement Date', fmtDateEn(todayISO())],
          ['Opening Balance', taka(0)], ['Closing Balance', taka(current.closing)],
          ['Total Deposit', taka(current.totalDeposit)], ['Total Payment', taka(current.totalPayment)],
        ]),
        sechead('Account Activity'),
        psTable(
          [
            { label: 'Date', cls: 'c' }, { label: 'Description' },
            { label: 'Deposit', cls: 'num' }, { label: 'Payment', cls: 'num' }, { label: 'Balance', cls: 'num' },
          ],
          rows.map(r => [
            { text: fmtDateEn(r.date), cls: 'c' },
            statementDescription(r),
            { text: r.deposit ? taka(r.deposit) : '—', cls: 'num' },
            { text: r.payment ? taka(r.payment) : '—', cls: 'num' },
            { text: taka(r.balance), cls: 'num' },
          ]),
          [[
            { text: 'Total', span: 2 },
            { text: taka(current.totalDeposit), cls: 'num' },
            { text: taka(current.totalPayment), cls: 'num' },
            { text: taka(current.closing), cls: 'num' },
          ]],
        ),
        sechead('Summary'),
        psInfo([
          ['Total Deposits', String(rows.filter(r => r.kind === 'deposit').length)],
          ['Total Payments', String(rows.filter(r => r.kind === 'withdrawal').length)],
          ['Due (approved basis)', taka(current.summary.due)],
          ['Advance', taka(current.summary.advance)],
          ['Available Balance', taka(withdrawalBalance(m, deposits, withdrawals).available)],
        ]),
      ],
    });
  }

  async function openPreview() {
    if (!current) { toast(t('সদস্য নির্বাচন করুন', 'Select a member'), 'warn'); return; }
    const { m, cfg: c } = current;
    await previewReport({
      title: t('স্টেটমেন্ট প্রিভিউ', 'Statement preview'),
      sheet: buildStatementSheet(),
      fileName: reportFileName({ memberName: m.nameEn || m.nameBn, reportType: 'Statement', orgName: c.orgNameEn }),
    });
  }

  fromEl.addEventListener('change', paint);
  toEl.addEventListener('change', paint);
  ready = true;
  paint();
  return wrap;
}

/* legacy export name kept for older imports */
export const pageStatementsLegacy = pageStatements;
export { num };
