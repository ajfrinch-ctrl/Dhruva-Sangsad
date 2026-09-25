/* WhatsApp sharing — ONE module that decides WHICH message belongs to WHICH reason.
 *
 * Why this module exists: every WhatsApp button in the app used to send the
 * due-reminder text, so a member who had just paid, or whose account had just
 * been opened, still received "your installment is overdue". The reason for the
 * share is now explicit and the three messages never mix:
 *
 *   due      → the admin's own template from Settings → Organisation, verbatim
 *              ([Member Name] and the optional extra placeholders are filled in)
 *   account  → "your membership is open" + member ID, installment and the login
 *              details (username + the default password while it is still valid)
 *   payment  → "we received your payment" receipt: transaction id, date, type,
 *              method, amount, total deposit and the remaining due
 *
 * Rules this module follows:
 *   · a message is ALWAYS sent from the same user gesture that opened the sheet,
 *     so the browser never blocks wa.me;
 *   · nothing here writes data — the text is built from what the caller holds;
 *   · the message language is Bangla (the members who receive it read Bangla),
 *     exactly like the stored due template.
 */
import { t, el, taka, fmtDate, num, waNumber, toast, confirmBox, typeLabel, methodLabel } from './util.js';
import { bottomSheet } from './ui.js';
import { getMember, allDeposits, memberSummary, summaryOpts, settings } from './store.js';

/* ---------------- building blocks ---------------- */

const orgOf = cfg => (cfg && (cfg.orgNameBn || cfg.orgNameEn)) || 'ধ্রুব সংসদ';

/** Fill [Placeholder] tokens (case/space insensitive). Unknown tokens stay put. */
export function fillTemplate(tpl, vars = {}) {
  let out = String(tpl == null ? '' : tpl);
  for (const [key, val] of Object.entries(vars)) {
    out = out.replace(new RegExp(`\\[\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\]`, 'gi'), val == null ? '' : String(val));
  }
  return out;
}

/** Phone (or null) for a member / a raw record. */
export const waPhoneOf = m => waNumber((m && (m.whatsapp || m.mobile)) || '');

/**
 * Open WhatsApp with a prefilled message. Returns false when there is no valid
 * number (the caller shows a toast) — never throws, never blocks the app.
 */
export function openWhatsApp(phone, text) {
  const to = waNumber(phone);
  if (!to) { toast(t('সদস্যের WhatsApp নম্বর নেই', 'This member has no WhatsApp number'), 'warn'); return false; }
  window.open(`https://wa.me/${to}?text=${encodeURIComponent(text)}`, '_blank');
  return true;
}

/* ---------------- the three messages ---------------- */

/**
 * DUE REMINDER — the organisation's own wording from Settings, unchanged.
 * Extra placeholders are supported so the admin may enrich the template:
 * [Member Name] · [Member ID] · [Due Amount] · [Installment] · [Org Name].
 */
export function dueMessage(member, cfg, summary = null) {
  const name = (member && (member.nameBn || member.nameEn)) || '';
  const tpl = (cfg && cfg.waTemplate) || '';
  return fillTemplate(tpl, {
    'Member Name': name,
    'Member ID': (member && member.memberId) || '',
    'Due Amount': summary ? taka(summary.due) : '',
    Installment: member ? taka(member.installment) : '',
    'Org Name': orgOf(cfg),
  }).trim();
}

/**
 * ACCOUNT OPENED — sent when a membership is created/approved.
 * `defaultPassword` is only passed while the member still has the default
 * password (never logged in yet); otherwise the member keeps their own secret.
 */
export function accountMessage(member, cfg, { login = '', defaultPassword = '' } = {}) {
  const org = orgOf(cfg);
  const name = (member && (member.nameBn || member.nameEn)) || '';
  const rows = [
    `প্রিয় ${name},`,
    'আসসালামু আলাইকুম।',
    `${org}-এ আপনার সদস্যপদ খোলা হয়েছে।`,
    '',
    `সদস্য আইডি: ${(member && member.memberId) || ''}`,
    `মাসিক কিস্তি: ${taka((member && member.installment) || 0)}`,
    ...(login ? [`লগইন ইউজারনেম: ${login}`] : []),
    ...(defaultPassword ? [`পাসওয়ার্ড: ${defaultPassword}`, 'প্রথম লগইনে পাসওয়ার্ড পরিবর্তন করে নিন।']
      : login ? ['পাসওয়ার্ড: আপনার নিজের নির্ধারিত পাসওয়ার্ড।'] : []),
    '',
    'অ্যাপে লগইন করে আপনার জমা, বকেয়া ও স্টেটমেন্ট দেখতে পারবেন।',
    'ধন্যবাদ।',
    org,
  ];
  return rows.join('\n').trim();
}

/**
 * PAYMENT RECEIVED — receipt for one deposit (approved or still pending).
 * `summary` (memberSummary) adds the running total and the remaining due.
 */
export function paymentMessage(deposit, member, cfg, { summary = null } = {}) {
  const org = orgOf(cfg);
  const d = deposit || {};
  const name = (member && (member.nameBn || member.nameEn)) || d.memberName || '';
  const approved = d.status === 'approved';
  const rows = [
    `প্রিয় ${name},`,
    'আসসালামু আলাইকুম।',
    approved ? 'আপনার জমা গ্রহণ করা হয়েছে।' : 'আপনার জমা দাখিল হয়েছে (অনুমোদনের অপেক্ষায়)।',
    '',
    `লেনদেন আইডি: ${d.txnId || '—'}`,
    `তারিখ: ${fmtDate(d.date) || '—'}`,
    `ধরন: ${typeLabel(d.type).bn}`,
    `পরিশোধ পদ্ধতি: ${methodLabel(d.method).bn}`,
    `পরিমাণ: ${taka(d.amount)}`,
    ...(summary ? [`মোট জমা: ${taka(summary.totalDeposit)}`] : []),
    ...(summary ? [summary.due > 0 ? `বর্তমান বকেয়া: ${taka(summary.due)}` : 'বর্তমান বকেয়া: নেই (সম্পূর্ণ পরিশোধিত)'] : []),
    '',
    'ধন্যবাদ।',
    org,
  ];
  return rows.join('\n').trim();
}

/* ---------------- one-tap openers (sync — never awaited) ---------------- */

export const openDue = (member, cfg, summary, phone) =>
  openWhatsApp(phone || waPhoneOf(member), dueMessage(member, cfg, summary));

export const openAccount = (member, cfg, opts, phone) =>
  openWhatsApp(phone || waPhoneOf(member), accountMessage(member, cfg, opts));

export const openPayment = (deposit, member, cfg, summary, phone) =>
  openWhatsApp(phone || waPhoneOf(member) || (deposit && waPhoneOf(deposit)), paymentMessage(deposit, member, cfg, { summary }));

/* ---------------- the "why are you sharing?" chooser ----------------
   ONE entry point for every WhatsApp button: the staff member picks the reason
   and the matching message goes out. Everything it needs is passed in, so each
   item opens WhatsApp synchronously (no blocked pop-ups, no wrong message).
------------------------------------------------------------------------ */

export function shareChooser({ member, cfg, summary = null, lastDeposit = null, login = '', defaultPassword = '', zIndex = 260 }) {
  const phone = waPhoneOf(member);
  const due = summary ? num(summary.due) : 0;
  const items = [
    {
      ic: 'due',
      label: t('বকেয়া স্মরণ পাঠান', 'Send due reminder'),
      value: due > 0 ? taka(due) : t('বকেয়া নেই', 'No due'),
      run: () => openDue(member, cfg, summary, phone),
    },
    {
      ic: 'member',
      label: t('অ্যাকাউন্ট খোলার তথ্য', 'Account opening details'),
      value: (member && member.memberId) || '',
      run: () => openAccount(member, cfg, { login, defaultPassword }, phone),
    },
    {
      ic: 'receipt',
      label: t('পেমেন্ট রিসিট', 'Payment receipt'),
      value: lastDeposit ? taka(lastDeposit.amount) : t('জমা নেই', 'No deposit'),
      run: () => lastDeposit
        ? openPayment(lastDeposit, member, cfg, summary, phone)
        : toast(t('এই সদস্যের কোনো অনুমোদিত জমা নেই', 'This member has no approved deposit yet'), 'warn'),
    },
  ];
  return bottomSheet({
    title: t('কী কারণে WhatsApp-এ পাঠাচ্ছেন?', 'Why are you sending this on WhatsApp?'),
    body: el('div', { class: 'wa-note', text: t('প্রতিটি কারণের জন্য আলাদা মেসেজ যাবে।', 'Each reason sends its own message.') }),
    items,
    zIndex,
  });
}

/* ---------------- ready-made flows used after an action ---------------- */

/** Last approved deposit of a member (newest first) — for the receipt share. */
export function lastApprovedDepositOf(deposits, member) {
  return (deposits || [])
    .filter(d => d.status === 'approved' && member && (d.memberDocId === member.id || d.memberId === member.memberId))
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.submittedAt || '').localeCompare(String(a.submittedAt || '')))[0] || null;
}

/**
 * After a membership is created or approved: ask once, then send the
 * account-opening message. The message text is built BEFORE the question, so
 * the link opens inside the confirmation click (no pop-up blocker).
 */
export async function offerAccountShare(member, cfg, { login = '', defaultPassword = '', phone = '' } = {}) {
  const to = phone || waPhoneOf(member);
  if (!to) return false;
  const text = accountMessage(member, cfg, { login, defaultPassword });
  const ok = await confirmBox(
    t(`${member.nameBn || member.nameEn} (${member.memberId}) — অ্যাকাউন্ট খোলার তথ্য WhatsApp-এ পাঠাবেন?`,
      `Send the account opening details of ${member.nameBn || member.nameEn} (${member.memberId}) on WhatsApp?`),
    { title: t('WhatsApp-এ পাঠান', 'Send on WhatsApp'), okLabel: t('পাঠান', 'Send') });
  if (!ok) return false;
  return openWhatsApp(to, text);
}

/**
 * Receipt share for a STORED deposit record — it loads the member and the
 * fresh totals itself, so the deposit list and the approvals inbox can both call
 * it right after a payment is received/approved.
 */
export async function shareDepositReceipt(deposit, cfg = null) {
  const [conf, member, deposits] = await Promise.all([
    cfg ? Promise.resolve(cfg) : settings(),
    getMember(deposit.memberDocId),
    allDeposits(),
  ]);
  const m = member || { nameBn: deposit.memberName, nameEn: deposit.memberName, memberId: deposit.memberId, id: deposit.memberDocId };
  return offerReceiptShare(deposit, m, conf, member ? memberSummary(member, deposits, summaryOpts(conf)) : null);
}

/** Receipt share for one deposit record (asks once, then opens WhatsApp). */
export async function offerReceiptShare(deposit, member, cfg, summary = null) {
  const to = waPhoneOf(member) || (deposit && waPhoneOf(deposit));
  if (!to) return false;
  const text = paymentMessage(deposit, member, cfg, { summary });
  const ok = await confirmBox(
    t(`${member.nameBn || member.nameEn} — ${taka(deposit.amount)} জমার রিসিট WhatsApp-এ পাঠাবেন?`,
      `Send the ${taka(deposit.amount)} receipt of ${member.nameBn || member.nameEn} on WhatsApp?`),
    { title: t('রিসিট পাঠান', 'Send receipt'), okLabel: t('পাঠান', 'Send') });
  if (!ok) return false;
  return openWhatsApp(to, text);
}
