/* Money Management (deposit entry) + Deposit History */
import {
  el, esc, toast, taka, money, num, fmtDate, fmtDateTime, todayISO, modal, confirmBox,
  DEPOSIT_TYPES, PAY_METHODS, typeLabel, methodLabel, debounce, monthKey,
} from '../util.js';
import { icon } from '../icons.js';
import { page, card, tableWrap, statusTag, banner, btn, kv, statCard, tabs, embedPage } from '../ui.js';
import {
  allMembers, allDeposits, settings, submitDeposit, memberSummary, setDepositStatus,
  canModifyDeposit, updateDeposit, deleteDeposit, getMember,
} from '../store.js';
import { can } from '../auth.js';
import { App } from '../app.js';
import { rejectReason } from './members.js';
import { downloadCSV, downloadExcel, safeName } from '../pdf.js';

/* ==================== Deposits hub (Entry / Transactions) ==================== */
export async function pageDepositsHub(session, params = {}) {
  const wrap = page('জমা / লেনদেন', 'Deposits & Transactions', 'money');
  const TABS = [
    { id: 'entry', label: 'জমা এন্ট্রি / Deposit Entry' },
    { id: 'transactions', label: 'লেনদেন / Transactions' },
  ];
  let active = params.tab && TABS.some(t => t.id === params.tab) ? params.tab : 'entry';
  const host = el('div');
  const tabBar = tabs(TABS, active, id => {
    active = id;
    App.params = { ...(App.params || {}), tab: id };
    paint();
    tabBar.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', TABS[i].id === id));
  });
  wrap.append(tabBar, host);

  async function paint() {
    host.replaceChildren();
    if (active === 'entry') await embedPage(host, pageDeposit, session);
    else await embedPage(host, pageDepositHistory, session);
  }
  await paint();
  return wrap;
}

/* ==================== Deposit entry ==================== */
export async function pageDeposit(session, params = {}) {
  const [members, deposits, cfg] = await Promise.all([allMembers(), allDeposits(), settings()]);
  const staff = session.role === 'admin' || session.role === 'maker';
  const wrap = page('অর্থ ব্যবস্থাপনা', 'Money Management — Deposit Entry', 'money');

  /* ---- member context ---- */
  let member = null;
  if (!staff) {
    member = members.find(m => m.id === session.memberDocId) || null;
    if (!member) { wrap.appendChild(banner('err', 'সদস্য প্রোফাইল পাওয়া যায়নি / Member profile not found.')); return wrap; }
    if (member.status !== 'active') {
      wrap.appendChild(banner('warn', `আপনার সদস্যপদ এখনো <b>${esc((member.status || '').toUpperCase())}</b>। অনুমোদনের পূর্বে জমা দাখিল করা যাবে না। / Your membership is not active yet — deposits cannot be submitted.`));
      return wrap;
    }
  }

  const activeMembers = members.filter(m => m.status === 'active');
  if (staff && !activeMembers.length) {
    wrap.appendChild(banner('warn', 'কোনো Active সদস্য নেই। প্রথমে সদস্য অনুমোদন করুন। / No active member yet — approve a member first.'));
    return wrap;
  }

  const infoHost = el('div');
  const form = el('form', { class: 'grid', novalidate: true });

  const memberField = staff ? `
    <div class="field"><label>সদস্য নির্বাচন / Select Member <span class="req">*</span></label>
      <select name="memberDocId" required>
        <option value="">— ID — Name —</option>
        ${activeMembers.slice().sort((a, b) => a.memberId.localeCompare(b.memberId))
          .map(m => `<option value="${esc(m.id)}"${params.memberDocId === m.id ? ' selected' : ''}>${esc(m.memberId)} — ${esc(m.nameBn || m.nameEn)}</option>`).join('')}
      </select><div class="err" data-err="memberDocId"></div></div>`
    : `<div class="field"><label>সদস্য / Member</label><input value="${esc(member.memberId)} — ${esc(member.nameBn)}" readonly>
        <input type="hidden" name="memberDocId" value="${esc(member.id)}"></div>`;

  form.innerHTML = `
    <div class="grid g2">
      ${memberField}
      <div class="field"><label>তারিখ / Date <span class="req">*</span></label>
        <input name="date" type="date" required value="${todayISO()}" ${session.role === 'maker' ? `max="${todayISO()}" min="${todayISO()}"` : ''}>
        ${session.role === 'maker' ? '<div class="hint">Maker শুধুমাত্র আজকের তারিখে এন্ট্রি করতে পারবেন।</div>' : ''}
        <div class="err" data-err="date"></div></div>
      <div class="field"><label>জমার ধরন / Deposit Type <span class="req">*</span></label>
        <select name="type" required>${DEPOSIT_TYPES.map(t => `<option value="${t.id}">${esc(t.bn)} / ${esc(t.en)}</option>`).join('')}</select></div>
      <div class="field"><label>পরিশোধ পদ্ধতি / Payment Method <span class="req">*</span></label>
        <select name="method" required>${PAY_METHODS.map(t => `<option value="${t.id}">${esc(t.bn)} / ${esc(t.en)}</option>`).join('')}</select></div>
      <div class="field"><label>জমার পরিমাণ (৳) / Amount <span class="req">*</span></label>
        <input name="amount" type="number" min="1" step="0.01" required inputmode="decimal" placeholder="0">
        <div class="hint">যেকোনো পরিমাণ গ্রহণযোগ্য / Any amount is accepted</div>
        <div class="err" data-err="amount"></div></div>
      <div class="field js-desc" hidden><label>বিবরণ / Description <span class="req">*</span></label>
        <input name="description" placeholder="বিশেষ চাঁদা / অন্যান্য জমার বিবরণ"><div class="err" data-err="description"></div></div>
    </div>
    <div class="field"><label>মন্তব্য / Comment</label><textarea name="comment" rows="2" placeholder="ঐচ্ছিক / optional"></textarea></div>
    <div class="form-actions">
      <button class="btn btn-primary" type="submit">${icon('save')}<span>${staff ? 'Save Deposit / জমা সংরক্ষণ' : 'Submit / জমা দাখিল'}</span></button>
      <button class="btn btn-ghost" type="reset">${icon('clear')}<span>Clear</span></button>
    </div>`;

  const descField = form.querySelector('.js-desc');
  const syncDesc = () => {
    const need = form.elements.type.value === 'special' || form.elements.type.value === 'other';
    descField.hidden = !need;
    if (!need) form.elements.description.value = '';
  };
  form.elements.type.addEventListener('change', syncDesc);
  syncDesc();

  const paintInfo = async () => {
    infoHost.replaceChildren();
    const id = form.elements.memberDocId.value;
    if (!id) return;
    const m = await getMember(id);
    if (!m) return;
    const s = memberSummary(m, deposits, { countSpecialTowardsInstallment: cfg.countSpecialTowardsInstallment });
    const stats = el('div', { class: 'stats' });
    stats.append(
      statCard({ label: 'মাসিক কিস্তি / Installment', value: taka(m.installment), sub: `${s.months} মাস হিসাবযোগ্য`, ic: 'money' }),
      statCard({ label: 'মোট জমা / Total Deposit', value: taka(s.totalDeposit), sub: `${s.count} approved`, ic: 'deposit' }),
      statCard({ label: 'বকেয়া / Due', value: taka(s.due), sub: `প্রয়োজন ${taka(s.required)}`, ic: 'due', tone: s.due > 0 ? 'red' : '' }),
      statCard({ label: 'অগ্রিম / Advance', value: taka(s.advance), sub: s.advance > 0 ? 'অতিরিক্ত জমা' : '—', ic: 'advance', tone: 'blue' }),
    );
    infoHost.appendChild(card('সদস্য সারসংক্ষেপ', `Member Summary — ${m.memberId} · ${m.nameBn}`, stats));
  };
  if (staff) form.elements.memberDocId.addEventListener('change', paintInfo);

  wrap.appendChild(infoHost);
  wrap.appendChild(card(staff ? 'জমা এন্ট্রি' : 'জমা দাখিল', staff ? 'Deposit Entry' : 'Submit Deposit', form));
  await paintInfo();

  form.addEventListener('reset', () => setTimeout(() => { form.elements.date.value = todayISO(); syncDesc(); paintInfo(); }, 0));

  form.addEventListener('submit', async e => {
    e.preventDefault();
    form.querySelectorAll('.err').forEach(x => x.textContent = '');
    form.querySelectorAll('.field').forEach(x => x.classList.remove('bad'));
    const setErr = (n, msg) => { const b = form.querySelector(`[data-err="${n}"]`); if (b) { b.textContent = msg; b.closest('.field').classList.add('bad'); } };
    const v = Object.fromEntries(new FormData(form).entries());
    let bad = false;
    if (!v.memberDocId) { setErr('memberDocId', 'সদস্য নির্বাচন করুন'); bad = true; }
    if (!v.date) { setErr('date', 'তারিখ দিন'); bad = true; }
    if (!(num(v.amount) > 0)) { setErr('amount', 'জমার পরিমাণ দিন'); bad = true; }
    if ((v.type === 'special' || v.type === 'other') && !String(v.description || '').trim()) { setErr('description', 'বিবরণ আবশ্যক'); bad = true; }
    if (session.role === 'maker' && v.date !== todayISO()) { setErr('date', 'Maker শুধুমাত্র আজকের তারিখ ব্যবহার করতে পারবেন'); bad = true; }
    if (bad) { toast('ফর্মে ত্রুটি রয়েছে / Please fix the highlighted fields', 'error'); return; }

    const b = form.querySelector('button[type=submit]'); b.disabled = true;
    try {
      const rec = await submitDeposit(v, session);
      await depositSuccess(rec);
      form.reset();
      form.elements.date.value = todayISO();
      syncDesc();
      App.refresh();
    } catch (err) { toast(err.message, 'error'); }
    finally { b.disabled = false; }
  });
  return wrap;
}

function depositSuccess(rec) {
  return modal({
    title: 'DEPOSIT SUCCESSFUL', width: 380,
    body: `<div class="success-pop"><div class="tick">${icon('check')}</div></div>
      <div class="kv">
        <div>Member</div><div><b>${esc(rec.memberName)}</b> (${esc(rec.memberId)})</div>
        <div>তারিখ / Date</div><div>${esc(fmtDate(rec.date))}</div>
        <div>ধরন / Type</div><div>${esc(typeLabel(rec.type).bn)}</div>
        <div>পদ্ধতি / Method</div><div>${esc(methodLabel(rec.method).bn)}</div>
        <div>পরিমাণ / Amount</div><div><b style="color:var(--green-dark);font-size:11px">${taka(rec.amount)}</b></div>
        <div>Status</div><div>${statusTag(rec.status)}</div>
      </div>
      <div class="banner ${rec.status === 'approved' ? 'ok' : 'info'}" style="margin-top:9px">${icon('info')}<span>${
        rec.status === 'approved'
          ? 'জমা সফলভাবে সংরক্ষিত ও অনুমোদিত হয়েছে।'
          : 'আপনার জমা সফলভাবে দাখিল হয়েছে। Maker/Admin অনুমোদনের পর এটি হিসাবে যুক্ত হবে।'}</span></div>`,
    actions: [{ label: 'OK', value: true, kind: 'primary' }],
  });
}

/* ==================== Deposit history ==================== */
export async function pageDepositHistory(session, params = {}) {
  const [members, deposits, cfg] = await Promise.all([allMembers(), allDeposits(), settings()]);
  const staff = session.role === 'admin' || session.role === 'maker';
  const wrap = page('জমার ইতিহাস', 'Deposit History', 'history');

  const mine = staff ? deposits : deposits.filter(d => d.memberDocId === session.memberDocId || d.memberId === session.memberId);

  /* filters */
  const bar = el('div', { class: 'toolbar' });
  const searchBox = el('div', { class: 'search-box', html: icon('search') });
  const q = el('input', { placeholder: 'Member ID / নাম / বিবরণ', autocomplete: 'off' });
  searchBox.appendChild(q);
  const mk = (label, node, w = '132px') => { const f = el('div', { class: 'field', style: `flex:0 1 ${w}` }); f.appendChild(el('label', { text: label })); f.appendChild(node); return f; };
  const stSel = el('select');
  [['', 'সব স্ট্যাটাস / All'], ['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected']].forEach(([v, l]) => stSel.appendChild(el('option', { value: v }, [l])));
  if (params.status) stSel.value = params.status;
  const tpSel = el('select');
  tpSel.appendChild(el('option', { value: '' }, ['সব ধরন / All types']));
  DEPOSIT_TYPES.forEach(t => tpSel.appendChild(el('option', { value: t.id }, [`${t.bn} / ${t.en}`])));
  const mtSel = el('select');
  mtSel.appendChild(el('option', { value: '' }, ['সব পদ্ধতি / All methods']));
  PAY_METHODS.forEach(t => mtSel.appendChild(el('option', { value: t.id }, [`${t.bn} / ${t.en}`])));
  const from = el('input', { type: 'date' });
  const to = el('input', { type: 'date' });
  bar.append(searchBox, mk('Status', stSel), mk('ধরন / Type', tpSel), mk('পদ্ধতি / Method', mtSel), mk('হইতে / From', from, '120px'), mk('পর্যন্ত / To', to, '120px'));
  bar.appendChild(btn('Clear', 'clear', 'ghost', () => { q.value = ''; stSel.value = ''; tpSel.value = ''; mtSel.value = ''; from.value = ''; to.value = ''; render(); }));
  wrap.appendChild(bar);

  const sumHost = el('div');
  wrap.appendChild(sumHost);

  const listCard = card('জমার তালিকা', 'Deposit Records', el('div'), [
    btn('Excel', 'excel', 'soft', () => exportRows('xlsx'), { size: 'xs' }),
    btn('CSV', 'csv', 'ghost', () => exportRows('csv'), { size: 'xs' }),
  ]);
  wrap.appendChild(listCard);

  let current = [];
  const filtered = () => {
    const t = q.value.trim().toLowerCase();
    return mine.filter(d => {
      if (stSel.value && d.status !== stSel.value) return false;
      if (tpSel.value && d.type !== tpSel.value) return false;
      if (mtSel.value && d.method !== mtSel.value) return false;
      const dt = String(d.date).slice(0, 10);
      if (from.value && dt < from.value) return false;
      if (to.value && dt > to.value) return false;
      if (t && ![d.memberId, d.memberName, d.description, d.comment, String(d.amount)].some(x => String(x || '').toLowerCase().includes(t))) return false;
      return true;
    }).sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.submittedAt).localeCompare(String(a.submittedAt)));
  };

  const exportRows = kind => {
    if (!current.length) { toast('রপ্তানির জন্য কোনো তথ্য নেই / Nothing to export', 'warn'); return; }
    const rows = [['SL', 'Date', 'Member ID', 'Member Name', 'Deposit Type', 'Payment Method', 'Amount', 'Description', 'Status']];
    current.forEach((d, i) => rows.push([i + 1, fmtDate(d.date), d.memberId, d.memberName, typeLabel(d.type).en, methodLabel(d.method).en, num(d.amount), d.description || '', d.status]));
    rows.push(['', '', '', '', '', 'Total', current.reduce((s, d) => s + num(d.amount), 0), '', '']);
    const fn = safeName(`Dhruvo_Sangsad_Deposit_History_${todayISO()}`);
    if (kind === 'csv') downloadCSV(rows, fn + '.csv');
    else downloadExcel([{ name: 'Deposit History', rows }], fn + '.xlsx');
  };

  const render = () => {
    current = filtered();
    const appr = current.filter(d => d.status === 'approved');
    const pend = current.filter(d => d.status === 'pending');
    const stats = el('div', { class: 'stats' });
    stats.append(
      statCard({ label: 'রেকর্ড / Records', value: String(current.length), sub: 'ফিল্টার অনুযায়ী', ic: 'log', tone: 'gray' }),
      statCard({ label: 'অনুমোদিত জমা / Approved', value: taka(appr.reduce((s, d) => s + num(d.amount), 0)), sub: `${appr.length} entry`, ic: 'approve' }),
      statCard({ label: 'অপেক্ষমাণ / Pending', value: taka(pend.reduce((s, d) => s + num(d.amount), 0)), sub: `${pend.length} entry`, ic: 'pending', tone: 'amber' }),
    );
    sumHost.replaceChildren(card('সারসংক্ষেপ', 'Summary', stats));

    const body = listCard.body;
    body.replaceChildren();
    body.appendChild(tableWrap(
      [{ label: 'SL', cls: 'num' }, { label: 'Date' }, ...(staff ? [{ label: 'Member' }] : []),
       { label: 'ধরন / Type' }, { label: 'পদ্ধতি / Method' }, { label: 'পরিমাণ', cls: 'num' },
       { label: 'বিবরণ / Description' }, { label: 'Status' }, { label: 'Action', cls: 'nowrap' }],
      current.map((d, i) => {
        const acts = el('div', { class: 'btn-row' });
        if (d.status === 'pending' && can(session, 'deposit:approve')) {
          acts.appendChild(btn('Approve', 'approve', 'soft', async () => {
            if (!(await confirmBox(`${d.memberName} — ${taka(d.amount)} জমাটি অনুমোদন করবেন?`, { okLabel: 'Approve' }))) return;
            await setDepositStatus(d.id, 'approved', session); toast('জমা অনুমোদিত / Deposit approved', 'success'); App.refresh();
          }, { size: 'xs' }));
          acts.appendChild(btn('Reject', 'reject', 'softred', async () => {
            const r = await rejectReason('জমা বাতিলের কারণ / Deposit Rejection Reason');
            if (r === null) return;
            await setDepositStatus(d.id, 'rejected', session, r); toast('জমা বাতিল / Deposit rejected', 'warn'); App.refresh();
          }, { size: 'xs' }));
        }
        const perm = canModifyDeposit(d, session);
        if (staff && perm.ok) {
          acts.appendChild(btn('Edit', 'edit', 'ghost', () => editDeposit(session, d), { size: 'xs' }));
          acts.appendChild(btn('Delete', 'trash', 'softred', async () => {
            if (!(await confirmBox(`${d.memberName} — ${taka(d.amount)} (${fmtDate(d.date)}) জমাটি মুছে ফেলবেন? এটি ফেরানো যাবে না।`, { okLabel: 'Delete', danger: true }))) return;
            try { await deleteDeposit(d.id, session); toast('জমা মুছে ফেলা হয়েছে / Deposit deleted', 'warn'); App.refresh(); }
            catch (err) { toast(err.message, 'error'); }
          }, { size: 'xs' }));
        }
        acts.appendChild(btn('View', 'eye', 'ghost', () => viewDeposit(d), { size: 'xs' }));
        return [
          { text: String(i + 1), cls: 'num' },
          esc(fmtDate(d.date)),
          ...(staff ? [`${esc(d.memberName)}<br><span class="faint fs8">${esc(d.memberId)}</span>`] : []),
          esc(typeLabel(d.type).bn),
          esc(methodLabel(d.method).bn),
          { text: money(d.amount), cls: 'num' },
          esc(d.description || '—'),
          { html: statusTag(d.status) },
          { node: acts, cls: 'nowrap' },
        ];
      }),
      {
        empty: 'কোনো জমা পাওয়া যায়নি / No deposit records found',
        emptyIcon: 'deposit',
        footer: current.length ? [
          { html: '', cls: '' }, { html: 'সর্বমোট / Total' }, ...(staff ? [{ html: '' }] : []), { html: '' }, { html: '' },
          { html: `<b>${money(current.reduce((s, d) => s + num(d.amount), 0))}</b>`, cls: 'num' }, { html: '' }, { html: '' }, { html: '' },
        ] : null,
      },
    ));
  };

  q.addEventListener('input', debounce(render, 180));
  [stSel, tpSel, mtSel, from, to].forEach(x => x.addEventListener('change', render));
  render();
  return wrap;
}

function viewDeposit(d) {
  return modal({
    title: `জমার বিবরণ / Deposit — ${d.memberId}`, width: 420,
    body: kv([
      ['Member', `<b>${esc(d.memberName)}</b> (${esc(d.memberId)})`],
      ['তারিখ / Date', esc(fmtDate(d.date))],
      ['ধরন / Type', `${esc(typeLabel(d.type).bn)} / ${esc(typeLabel(d.type).en)}`],
      ['পদ্ধতি / Method', `${esc(methodLabel(d.method).bn)} / ${esc(methodLabel(d.method).en)}`],
      ['পরিমাণ / Amount', `<b>${taka(d.amount)}</b>`],
      ['বিবরণ / Description', esc(d.description || '')],
      ['মন্তব্য / Comment', esc(d.comment || '')],
      ['Status', statusTag(d.status)],
      ['দাখিল / Submitted', `${esc(fmtDateTime(d.submittedAt))} <span class="faint">(${esc(d.submittedByRole || '')})</span>`],
      ['অনুমোদন / Approved', d.approvedAt ? esc(fmtDateTime(d.approvedAt)) : ''],
      ['বাতিলের কারণ / Reject reason', esc(d.rejectReason || '')],
      ['Sync', esc(d.syncStatus || 'local')],
    ]),
    actions: [{ label: 'Close', value: true, kind: 'ghost' }],
  });
}

function editDeposit(session, d) {
  const body = el('div');
  body.innerHTML = `
    <form class="grid js-f" novalidate>
      <div class="grid g2">
        <div class="field"><label>Member</label><input value="${esc(d.memberId)} — ${esc(d.memberName)}" readonly></div>
        <div class="field"><label>তারিখ / Date <span class="req">*</span></label>
          <input name="date" type="date" value="${esc(String(d.date).slice(0, 10))}" ${session.role === 'maker' ? `min="${todayISO()}" max="${todayISO()}"` : ''}></div>
        <div class="field"><label>ধরন / Type <span class="req">*</span></label>
          <select name="type">${DEPOSIT_TYPES.map(t => `<option value="${t.id}"${t.id === d.type ? ' selected' : ''}>${esc(t.bn)} / ${esc(t.en)}</option>`).join('')}</select></div>
        <div class="field"><label>পদ্ধতি / Method <span class="req">*</span></label>
          <select name="method">${PAY_METHODS.map(t => `<option value="${t.id}"${t.id === d.method ? ' selected' : ''}>${esc(t.bn)} / ${esc(t.en)}</option>`).join('')}</select></div>
        <div class="field"><label>পরিমাণ (৳) <span class="req">*</span></label><input name="amount" type="number" min="1" step="0.01" value="${esc(d.amount)}"></div>
        <div class="field"><label>বিবরণ / Description</label><input name="description" value="${esc(d.description || '')}"></div>
      </div>
      <div class="field"><label>মন্তব্য / Comment</label><textarea name="comment" rows="2">${esc(d.comment || '')}</textarea></div>
      <div class="err js-err"></div>
    </form>`;
  const f = body.querySelector('.js-f');
  const errBox = body.querySelector('.js-err');
  return modal({
    title: 'জমা সম্পাদনা / Edit Deposit', body, width: 480,
    actions: [
      { label: 'Cancel', value: null, kind: 'ghost' },
      {
        label: 'Update', kind: 'primary', value: true,
        onClick: () => {
          const v = Object.fromEntries(new FormData(f).entries());
          errBox.textContent = '';
          if (!(num(v.amount) > 0)) { errBox.textContent = 'সঠিক পরিমাণ দিন'; return false; }
          if ((v.type === 'special' || v.type === 'other') && !String(v.description || '').trim()) { errBox.textContent = 'বিবরণ আবশ্যক'; return false; }
          updateDeposit(d.id, v, session)
            .then(() => { toast('জমা হালনাগাদ হয়েছে / Deposit updated', 'success'); App.refresh(); })
            .catch(err => toast(err.message, 'error'));
          return true;
        },
      },
    ],
  });
}
