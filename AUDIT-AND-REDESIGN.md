# ধ্রুব সংসদ — Audit & Redesign (v6.6.0)

Complete information-architecture audit, de-duplication, and Android-app-style
UI redesign. **No data was deleted, reset or migrated destructively** — the
only schema addition is an additive `txnId` field backfilled once on boot.

---

## 1. Final information architecture

```
HOME
└── Dashboard (greeting · notices · summary · pending status)

MEMBERS                       (admin/maker)
└── Member Management
    ├── List (search, status/balance filters, cards ⇄ table)
    ├── Register (3-step wizard)
    └── Edit  (member information + details)

DEPOSITS
├── Submit Deposit   (entry — the ONLY place deposit submission exists)
├── My Deposits      (member: every status)
├── My Approved Deposits (member)
├── Deposit History  (search + filter; staff row actions live here only)
└── Withdrawal       (request/entry + history)

TRANSACTIONS
├── All transactions (combined deposit + withdrawal ledger, unique IDs)
├── Today
└── My pending       (member)

STATEMENTS
└── Statements (ONE implementation — member passbook, staff picks member)

REPORTS                       (staff; member: own range + withdrawal)
├── Summary (always first)
├── Report Type (dropdown — no tile walls)
├── Filters
├── Generate → popup preview (exact PDF layout, same node/data)
└── Download PDF (the only download button)

SETTINGS
├── Activity Log        ← sole entry point (was in Member Panel + More + Dashboard)
├── Change Password     ← sole entry point (was in Member Panel)
├── My Account · Language · About
└── staff: Approvals · Staff · Member Logins · Organisation · Cloud Sync · Backup
```

## 2. Duplicates removed (feature inventory)

| Feature                | Before (entry points)                                   | After |
|------------------------|----------------------------------------------------------|-------|
| Activity Log           | Member Panel card · More sheet · Dashboard “see all” · Settings tab | **Settings only** |
| Change Password        | Member Panel button · Settings account · More            | **Settings only** |
| Submit Deposit         | Floating FAB (Dashboard/Deposits) · Member Panel button · quick-action tiles · Deposits tab | **Deposits → Submit Deposit** |
| My Approved Deposits   | Member Panel table · Deposits tab                        | **Deposits → My Approved Deposits** |
| Statements             | Member Panel button · Reports “statement” tile · Dashboard tile | **Statements page only** (removed from Reports registry) |
| Transactions view      | Deposits hub tab · Member Panel button · Dashboard rows  | **Transactions section** (read-only ledger; management stays in Deposits history / Approvals) |
| Reports shortcut       | Dashboard quick tile · Reports page shortcut tiles     | Reports is its own section (desktop rail · mobile More) |
| Excel/CSV downloads    | Reports export bar · Deposit history head · Activity log | **removed** — PDF only in Reports; JSON backup keeps its own export (Settings→Backup) |
| Top-bar clutter        | settings · theme · bell · more · logout buttons          | **[Back] · Title · [Bell]** (theme/language/logout live in More) |

## 3. UI system (Android-app-like, mobile-first to 320px)

* **Icon 2-column grids** everywhere options are selectable: জমার ধরন,
  পরিশোধ পদ্ধতি, withdrawal type/method, hub section menus, home tiles.
  Odd final item keeps normal card size (CSS grid auto-placement — never stretched).
* **Greeting** replaces the permanent “your ID is active” banner:
  সুপ্রভাত (05–11:59) · শুভ অপরাহ্ণ (12–16:59) · শুভ সন্ধ্যা (17–19:59) · শুভ রাত্রি (20–04:59),
  plus “ধ্রুব সংসদে আপনাকে স্বাগতম।”. Approval news arrives via Notifications.
* **Monthly contribution is fixed** — type=মাসিক shows
  `মাসিক চাঁদা ৳<installment>` (read-only; store layer re-derives the amount
  from the member’s configured installment regardless of client input).
* **Transaction cards**: unique ID chip (tap = copy), type, ± amount,
  `date · method`, status tick. Long names wrap; chevron never collides.
* **Member rows**: avatar + name (wrapping up to 3 lines) + Member ID line;
  no overlap with controls.

## 4. Transaction IDs (rules 12–13)

* Format `YYYYMMDDNNN` — date part = **actual payment date** (`d.date`), not
  the application/submission timestamp. Sequence restarts each day.
* One shared per-day sequence across deposits **and** withdrawals → no
  duplicates within a device.
* Editing a payment date re-stamps the ID.
* `ensureTxnIds()` — one-time additive backfill (settings flag `txnIds_v1`);
  existing data is never rewritten if it already carries an id.
* `dedupeTxnIds()` — after boot and after every Firebase pull, later
  duplicates (offline multi-device) are re-stamped.

## 5. Navigation fixes (rule 22)

* Router is now `#route/section` (`#deposits/history`, `#settings/password`…),
  so in-app back, browser back, **Android system back**, refresh and direct
  URL all resolve to the exact sub-page. Deep-link params (e.g. `memberDocId`)
  survive refresh via `sessionParams`.
* Top-bar Back button (shown only when there is somewhere to go), plus
  per-section “← Deposits menu” bars. Esc = close sheet/dialog, else back.
* `#deposit` (old bookmark) aliases to `#deposits`. Pages can never leave a
  blank screen: render failure shows an error state with Retry.

## 6. Data & security preserved (rules 28–29)

* Same IndexedDB stores, same version handling, additive-only migration.
* Role matrix unchanged in behaviour; new route keys (`deposits`,
  `transactions`, `statements`) added for admin/maker/member; members still
  cannot reach Members / Approvals / staff settings. Members' Transactions and
  Statements are hard-filtered to their own `memberDocId`.
* Maker same-day-only entry/edit rule kept in both UI and store layer.
* Firebase RTDB rules untouched — `$other` validation already permits the new
  `txnId` field.

## 7. Verification

Automated node+jsdom integration suites (kept out of the repo, `/home/user/smoke/`):

* `smoke.mjs` — 66 checks: txn-id format/sequence/day-restart/uniqueness,
  fixed monthly amount, migration + backfill, role permissions, every page
  renders for staff & member, IA placement assertions (no Activity Log outside
  Settings, no password change outside Settings, no FAB, no submit shortcut on
  Dashboard, no Excel/CSV buttons), member panel contains profile only.
* `flow.mjs` — 26 checks: hash router parse/build + legacy alias, Reports
  Generate → popup preview shows the exact A4 sheet with org header, txn IDs
  and totals, PDF-only footer, close behavior, Statements flow, deposits hub
  tiles with icons, option-grid odd-last sizing, filename rule
  `Rahim_Uddin_Deposit_Report_2026-09-25_15-40.pdf` + sanitization.

## 8. File map

| File | Status |
|------|--------|
| `js/app.js` | rewritten: clean top bar, section router, back handling, More sheet, no FAB |
| `js/pages/dashboard.js` | rewritten: greeting/notices/summary/status only |
| `js/pages/deposits.js` | rewritten: tile hub, option grids, fixed monthly, txn ids |
| `js/pages/transactions.js` **new** | standalone modern ledger (IDs, filters, details) |
| `js/pages/statements.js` **new** | the single Statements implementation |
| `js/pages/settings.js` **new** | Activity Log · Change Password · account · staff tools |
| `js/pages/member-panel.js` **new** | profile information only |
| `js/pages/reports.js` | rewritten: summary→dropdown→filters→preview→PDF |
| `js/pages/admin.js` | reduced to Approvals + managers + Backup |
| `js/pages/misc.js` | member log card removed; log page trimmed of exports |
| `js/sheet.js`, `js/preview.js` **new** | shared print-sheet builder + PDF-only preview |
| `js/store.js`, `js/util.js`, `js/ui.js`, `js/icons.js`, `js/pdf.js`, `js/auth.js` | additive changes |
| `index.html`, `css/app.css`, `manifest.webmanifest`, `sw.js`, `js/brand.js` | shell + v6.6.0 design system |
