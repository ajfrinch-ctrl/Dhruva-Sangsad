# ধ্রুব সংসদ — Dhruvo Sangsad

Member, Deposit, Withdrawal, Due, Advance & Reporting Management System.
Offline-first PWA (HTML5 · CSS3 · vanilla JS · IndexedDB · Service Worker) with
real-time Firebase Realtime Database + Authentication + Storage sync.

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
(Realtime Database `https://dhruvo-sangsad-default-rtdb.firebaseio.com`). It connects
automatically and keeps every device in sync; a different config can be set in
**Settings → Firebase**. The queue flushes automatically (on reconnect, on queue change,
and every 30 s). The topbar chip shows `Online / Offline / Syncing / Synced / Sync Error`.

Conflicts are resolved per record using `updatedAt`: if the server copy is newer than the
queued local payload, the remote record is applied locally instead of overwriting the server.
Every record carries `createdAt`, `updatedAt`, `updatedBy`, `deviceId` and `syncStatus`.

Firebase paths written: `authIndex/ users/ members/ deposits/ withdrawals/
pendingDeposits/ approvals/ notifications/ activityLogs/ settings/ filesData/ syncMetadata/`.
File binaries live in Firebase Storage at `uploads/{uid}/{uniqueFileId}_{safeFileName}`;
only metadata is stored in Realtime Database `filesData/{fileId}` and cached in IndexedDB.
Security rules live in [`firebase/database.rules.json`](firebase/database.rules.json) and
[`firebase/storage.rules`](firebase/storage.rules) —
deny-by-default at the root, role checks read from `authIndex/$uid/role` (published on
Firebase Auth sign-in), Member IDs are immutable, activity logs are append-only, and
`settings/firebaseConfig` is never pushed.

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
firebase/               Realtime Database + Storage security rules (`database.rules.json`, `storage.rules`)
js/
  util.js crypto.js db.js store.js auth.js firebase.js storage.js pdf.js icons.js ui.js ui-auth.js app.js
  pages/ account.js dashboard.js members.js deposits.js reports.js misc.js admin.js
vendor/                 jsPDF, html2canvas, SheetJS, Firebase compat SDK (app/auth/database/storage), Noto Sans Bengali
```

## Files (Firebase Storage)

Authenticated users can upload JPEG / PNG / WebP / PDF files up to 10 MB from
**Settings → Files**, a member profile, or the member panel.

* Storage path: `uploads/{firebaseAuthUid}/{uniqueFileId}_{safeFileName}`
* Metadata path: Realtime Database `filesData/{fileId}` (also cached in IndexedDB)
* Offline uploads are refused with “ইন্টারনেট সংযোগ প্রয়োজন / Internet connection required”
* Activity log actions: `FILE_UPLOAD`, `FILE_DELETE`, `FILE_VIEW`

Deploy rules (requires the [Firebase CLI](https://firebase.google.com/docs/cli) and
access to project `dhruvo-sangsad`):

```bash
firebase deploy --only database,storage
```

If Storage has never been enabled on the project, open Firebase Console → Storage
and click **Get started**. The app shows a clear error until that is done. Allowed
MIME types and the 10 MB cap can later be overridden from Admin settings keys
`allowedFileTypes` and `maxFileSizeBytes`.

`vendor/` is committed on purpose: the app must work with no network and there is no
package install or bundling step.
