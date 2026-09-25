/* Statements — the ONE authoritative statement implementation.
   Members: their own passbook. Staff: pick a member.
   Flow: context → period → [View Statement] → popup preview (exact PDF) →
   Download PDF only. No duplicate statement page in Reports/Profile. */
import {
  el, esc, toast, taka, money, num, fmtDate, todayISO, typeLabel, methodLabel, t,
} from '../util.js';
import { page, card, tableWrap, banner, btn, statCard } from '../ui.js';
import { memberPicker } from '../picker.js';
import { allMembers, allDeposits, allWithdrawals, settings, memberSummary, summaryOpts, statementRows, withdrawalBalance } from '../store.js';
import { buildSheet, psInfo, psTable, sechead } from '../sheet.js';
import { previewReport, reportFileName } from '../preview.js';

export async function pageStatements(session, params = {}) {
  const [members, deposits, withdrawals, cfg] = await Promise.all([allMembers(), allDeposits(), allWithdrawals(), settings()]);
  const own = session.role === 'member';
  const wrap = page('স্টেটমেন্ট', 'Statements', 'report');

  /* ---- member selection ---- */
  let memberId = '';
  const pool = () => own ? members.filter(m => m.id === session.memberDocId) : members;
  if (!pool().length) { wrap.appendChild(banner('err', t('কোনো সদস্য পাওয়া যায়নি / No member found', 'No member found'))); return wrap; }

  const from = el('input', { type: 'date' });
  const to = el('input', { type: 'date' });
  let pick = null;
  const filterHost = el('div', { class: 'toolbar' });
  if (own) {
    const m0 = pool()[0];
    const ro = el('input', { value: m0 ? `${m0.memberId} — ${m0.nameBn || m0.nameEn}` : '', readonly: true });
    memberId = m0 ? m0.id : '';
    const f = el('div', { class: 'field', style: 'flex:1 1 220px' });
    f.appendChild(el('label', { text: t('সদস্য', 'Member') }));
    f.appendChild(ro);
    filterHost.appendChild(f);
  } else {
    pick = memberPicker({ members: pool(), value: params.memberDocId || '' });
    const f = el('div', { class: 'field', style: 'flex:1 1 220px' });
    f.appendChild(el('label', { text: t('সদস্য', 'Member') }));
    f.appendChild(pick.root);
    filterHost.appendChild(f);
    const fc = card(t('সদস্য নির্বাচন', 'Choose member'), '', filterHost);
    fc.classList.add('overflow-visible');
    wrap.appendChild(fc);
    memberId = pick.value || '';
  }
  if (own) {
    const fc = card(t('সময়কাল (ঐচ্ছিক)', 'Period (optional)'), '', filterHost);
    wrap.appendChild(fc);
  }
  const mkDate = (label, node) => {
    const f = el('div', { class: 'field', style: 'flex:0 1 150px' });
    f.appendChild(el('label', { text: label }));
    f.appendChild(node);
    return f;
  };
  filterHost.append(mkDate(t('শুরু', 'From'), from), mkDate(t('শেষ', 'To'), to));

  /* live summary of the selected member (current status) */
  const infoHost = el('div');
  wrap.appendChild(infoHost);
  const paintInfo = () => {
    infoHost.replaceChildren();
    const id = own ? memberId : (pick ? pick.value : '');
    if (!id) return;
    const m = members.find(x => x.id === id);
    if (!m) return;
    const s = memberSummary(m, deposits, summaryOpts(cfg, { withdrawals }));
    const bal = withdrawalBalance(m, deposits, withdrawals);
    const stats = el('div', { class: 'stats' });
    stats.append(
      statCard({ label: t('মোট জমা', 'Total Deposit'), value: taka(s.totalDeposit), sub: `${s.count} ${t('টি অনুমোদিত', 'approved')}`, ic: 'money' }),
      statCard({ label: t('বকেয়া', 'Due'), value: taka(s.due), sub: `${t('প্রয়োজন', 'required')} ${taka(s.required)}`, ic: 'due', tone: s.due > 0 ? 'red' : '' }),
      statCard({ label: t('অগ্রিম', 'Advance'), value: taka(s.advance), sub: `${s.months} ${t('মাস', 'months')}`, ic: 'advance', tone: 'blue' }),
      statCard({ label: t('উপলব্ধ ব্যালান্স', 'Available'), value: taka(bal.available), sub: t('উত্তোলনযোগ্য', 'withdrawable'), ic: 'wallet' }),
    );
    infoHost.appendChild(stats);
  };
  paintInfo();

  /* ---- generate ---- */
  const gen = btn(t('স্টেটমেন্ট দেখুন', 'View Statement'), 'report', 'primary', async () => {
    const [m2, d2, w2, c2] = await Promise.all([allMembers(), allDeposits(), allWithdrawals(), settings()]);
    const id = own ? memberId : (pick ? pick.value : '');
    const m = m2.find(x => x.id === id) || m2.find(x => x.id === session.memberDocId);
    if (!m) { toast(t('সদস্য নির্বাচন করুন', 'Select a member'), 'warn'); return; }
    const s = memberSummary(m, d2, summaryOpts(c2, { withdrawals: w2 }));
    let rows = statementRows(s);
    if (from.value) rows = rows.filter(r => String(r.deposit.date).slice(0, 10) >= from.value);
    if (to.value) rows = rows.filter(r => String(r.deposit.date).slice(0, 10) <= to.value);
    const periodTotal = rows.reduce((a, r) => a + num(r.deposit.amount), 0);
    const sub = (from.value || to.value)
      ? `Period: ${from.value ? fmtDate(from.value) : 'Beginning'} to ${to.value ? fmtDate(to.value) : fmtDate(todayISO())}`
      : '';

    const sheet = buildSheet({
      cfg: c2, titleEn: 'Member Statement', subEn: sub, titleBn: t('সদস্য স্টেটমেন্ট', 'Member Statement'),
      parts: [
        psInfo([
          ['Member ID', m.memberId], ['Status', (m.status || '').toUpperCase()],
          ['Name (Bangla)', m.nameBn], ['Name (English)', m.nameEn],
          ['Join Date', fmtDate(m.joinDate)], ['Mobile', m.mobile],
          ["Father's Name", m.fatherBn || m.fatherEn || '-'], ['Address', m.address || '-'],
          ['Monthly Installment', money(m.installment) + ' Tk'], ['Statement Date', fmtDate(todayISO())],
        ]),
        sechead('Deposit Statement'),
        psTable(
          [{ label: 'SL', cls: 'c' }, { label: 'Txn ID', cls: 'c' }, { label: 'Date', cls: 'c' }, { label: 'Deposit Type' }, { label: 'Payment Method' }, { label: 'Amount', cls: 'num' }, { label: 'Cumulative Amount', cls: 'num' }],
          rows.map(r => [
            { text: r.sl, cls: 'c' }, { text: r.deposit.txnId || '—', cls: 'c' }, { text: fmtDate(r.deposit.date), cls: 'c' },
            typeLabel(r.deposit.type).en, methodLabel(r.deposit.method).en,
            { text: money(r.deposit.amount), cls: 'num' }, { text: money(r.cumulative), cls: 'num' },
          ]),
          [[{ text: 'Total', span: 5 }, { text: money(periodTotal), cls: 'num' }, { text: money(rows.length ? rows[rows.length - 1].cumulative : 0), cls: 'num' }]],
        ),
      ],
    });

    await previewReport({
      title: t('স্টেটমেন্ট প্রিভিউ', 'Statement Preview'),
      sheet,
      fileName: reportFileName({ memberName: m.nameEn || m.nameBn, reportType: 'Statement', orgName: c2.orgNameEn }),
    });

    /* after closing the preview, keep an on-screen copy for the current session */
    showOnScreen(sheet, rows, m, periodTotal);
  }, { block: true });
  gen.style.minHeight = '48px'; gen.style.fontSize = '15px'; gen.style.marginTop = '4px';
  wrap.appendChild(gen);

  const outHost = el('div');
  wrap.appendChild(outHost);

  function showOnScreen(_sheet, rows, m, total) {
    outHost.replaceChildren();
    if (!rows.length) { outHost.appendChild(el('div', { class: 'empty', html: `${'' }${esc(t('এই সময়কালে কোনো জমা নেই', 'No deposits in this period'))}` })); return; }
    outHost.appendChild(card(`${t('স্টেটমেন্ট', 'Statement')} — ${m.memberId}`, '', tableWrap(
      [{ label: 'Txn ID' }, { label: 'তারিখ / Date' }, { label: 'ধরন / Type' }, { label: 'পদ্ধতি / Method' }, { label: 'পরিমাণ', cls: 'num' }, { label: 'ক্রমপুঞ্জিত', cls: 'num' }],
      rows.map(r => [
        `<code class="txn-id">${esc(r.deposit.txnId || '—')}</code>`,
        esc(fmtDate(r.deposit.date)),
        esc(typeLabel(r.deposit.type).bn), esc(methodLabel(r.deposit.method).bn),
        { text: money(r.deposit.amount), cls: 'num' }, { text: money(r.cumulative), cls: 'num' },
      ]),
      { footer: [{ html: '<b>সর্বমোট / Total</b>' }, { html: '' }, { html: '' }, { html: `<b>${money(total)}</b>`, cls: 'num' }, { html: '' }, { html: '' }] },
    )));
  }
  return wrap;
}
