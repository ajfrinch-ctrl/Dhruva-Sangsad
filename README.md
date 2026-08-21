# ধ্রুব সংসদ — Dhruvo Sangsad

Member, Deposit, Withdrawal, Due, Advance & Reporting Management System.
Offline-first PWA (HTML5 · CSS3 · vanilla JS · IndexedDB · Service Worker) with
real-time Firebase Realtime Database + Authentication sync.

---

## Running

No build step, no install. Serve the folder over HTTP (a Service Worker needs a real origin):

```bash
cd dhruvo-sangsad
python3 -m http.server 8080
# open http://localhost:8080
```

## First login

| Field    | Value   |
| -------- | ------- |
| User ID  | `admin` |
| Password | `admin` |

The first login forces a profile setup + password change. **Afterwards the default
`admin` password stops working permanently.** Passwords are never stored or displayed in
plain text — they are PBKDF2-SHA256 hashed (150 000 iterations) via `crypto.subtle`.

## Roles

| Role       | Capabilities |
| ---------- | ------------ |
| **Admin**  | Everything: member & deposit management, maker accounts, backup/restore, settings, activity log |
| **Maker**  | Approve/reject/edit members, deposit entry & approval, reports, WhatsApp reminders. Cannot change a Member ID, cannot touch prior-day deposits, no admin panel |
| **Member** | Self-registration, own profile, own deposits, own statement |

A **Member ID is the last 6 digits of the mobile number**, generated automatically, unique,
and never editable. Member ID, mobile, WhatsApp and email are all enforced unique.

Members register as `pending`. A pending member **can log in and view**, but **cannot submit
deposits** until an admin or maker approves them.

## Accounting rule

Only **approved** deposits count toward totals, due, advance, statements, reports and the
dashboard. Pending and rejected rows are excluded everywhere.

```
months    = whole months from join date through today (inclusive)
required  = monthly installment × months
paid      = approved monthly + advance deposits
due       = max(0, required − paid)
advance   = max(0, paid − required)
```

Any deposit amount is accepted — there is no multiple-of-installment restriction.

## Offline & sync

All data lives in IndexedDB (`dhruvo_sangsad`). Every write is also appended to a sync queue.

The app is pre-configured to sync to the production Firebase project **`dhruvo-sangsad`**
(Realtime Database `https://dhruvo-sangsad-default-rtdb.asia-southeast1.firebasedatabase.app`). It connects
automatically and keeps every device in sync; a different config can be set in
**Settings → Firebase**. The queue flushes automatically (on reconnect, on queue change,
and every 30 s). The topbar chip shows `Online / Offline / Syncing / Synced / Sync Error`.

Conflicts are resolved per record using `updatedAt`: if the server copy is newer than the
queued local payload, the remote record is applied locally instead of overwriting the server.
Every record carries `createdAt`, `updatedAt`, `updatedBy`, `deviceId` and `syncStatus`.

Firebase paths written: `authIndex/ authIndexSeeds/ users/ members/ deposits/
withdrawals/ pendingDeposits/ approvals/ notifications/ activityLogs/ settings/
syncMetadata/`.

### Security rules & the authIndex contract

Security rules live in [`firebase/database.rules.json`](firebase/database.rules.json) —
deny-by-default at the root. Roles are resolved through `authIndex/$uid`, which maps a
Firebase Auth uid to the app account:

```
authIndex/$uid = { localId, role, username, memberDocId, updatedAt }
  localId     → users/$localId  (the app user record id)
  memberDocId → members/$memberDocId for members, '' for staff
```

* A uid may **only ever write its own** `authIndex` entry.
* First claim: `role: 'member'` is allowed freely; an `admin`/`maker` first claim
  requires a matching `authIndexSeeds/$uid` entry (bootstrap token).
* After the first claim, `role`, `localId` and `memberDocId` are **immutable** for
  that uid (no self-promotion, no identity re-pointing).
* Member records sync as `pending`; members may then edit their own member profile
  (Member ID and status locked) and submit their own `pending` deposits/withdrawals.
* Only admins read/write `users/` wholesale; members read/write only their own user
  record (self password changes included). `password` hashes are never exposed
  anywhere except each account's own record.
* Staff writes (`status` approval, `approvals`, `settings`, full member/deposit
  management) require `authIndex/$uid/role ∈ {admin, maker}`.

**Deploying rules for the first time (one-time bootstrap):**

1. Replace `BOOTSTRAP-ADMIN-KEY-CHANGE-ME` in `firebase/database.rules.json` with a
   strong random token, then deploy: `firebase deploy --only database:rules`.
2. In the app: **Settings → Firebase → Bootstrap Key** — enter the *same* token and
   Save & Connect. (The key lives only in the local `firebaseConfig` setting, which
   is never pushed to the database.)
3. The first time the admin/maker account logs in, the app writes the seed, claims
   the staff role in `authIndex`, and deletes the seed. Afterwards the key is not
   needed again for that uid.
4. **Firebase App Check:** if App Check is enforced for the Realtime Database, every
   request is rejected with `Missing appcheck token` before rules even run. Either
   keep App Check in *Monitor* mode for this database, or integrate the App Check SDK
   with a reCAPTCHA provider (site key from the console).

Member IDs are immutable, activity logs are append-only, and `settings/firebaseConfig`
is never pushed.

## Exports

* **PDF** — fully offline via bundled jsPDF + html2canvas. B&W print-optimised A4 sheets,
  Noto Sans Bengali + Arial, fixed point sizes (title 13, sub-header 10, member info 8.5,
  table header 8, table data 7.5, total 8, footer 7). Filenames follow
  `Dhruvo_Sangsad_Member_345678_Statement.pdf`.
* **Excel / CSV** — bundled SheetJS.
* **WhatsApp** — due reminder opens `wa.me` with the Bangla template from Settings; the
  member's name is substituted and no amount is ever included.

## Reports

Member Statement · Overall · Daily · Monthly · Due · Advance · Collection · Payment Method ·
Date Range · Member-wise · Withdrawal. Reports generate on demand via the **Generate Report**
button and open in a modal with Download (PDF / Excel / CSV) and Close actions.

Statement columns are exactly `SL | Date | Deposit Type | Payment Method | Amount |
Cumulative Amount`. The overall report is exactly `Member Name | Monthly Installment |
Total Deposit | Total Due` with Total Collection and Total Due footers.

All dates display as `DD-MM-YYYY`.

## Balance & withdrawals

Balance is never hard-coded — it is derived from transactions:

```
available balance = total approved deposits − total approved withdrawals
```

Withdrawals are validated against available balance (cannot exceed it), follow the same
pending → approved/rejected workflow, and appear on the dashboard, Authorization Pending,
and the Withdrawal report.

## Backup & restore

Admin only, under **Backup & Restore**. Export writes a full JSON snapshot of every store;
restore asks for confirmation before replacing local data.

## Layout

```
index.html              app shell
manifest.webmanifest    PWA manifest
sw.js                   service worker (precaches shell, vendor, fonts, all modules)
css/app.css             theme, layout, print sheets
icons/                  192 / 512 / maskable-512
firebase/               Realtime Database security rules
js/
  util.js crypto.js db.js store.js auth.js firebase.js pdf.js icons.js ui.js ui-auth.js app.js
  pages/ account.js dashboard.js members.js deposits.js reports.js misc.js admin.js
vendor/                 jsPDF, html2canvas, SheetJS, Firebase compat SDK, Noto Sans Bengali
```

`vendor/` is committed on purpose: the app must work with no network and there is no
package install or bundling step.
