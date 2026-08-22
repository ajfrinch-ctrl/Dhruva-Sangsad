1| # ধ্রুব সংসদ — Dhruvo Sangsad
2| 
3| Member, Deposit, Withdrawal, Due, Advance & Reporting Management System.
4| Offline-first PWA (HTML5 · CSS3 · vanilla JS · IndexedDB · Service Worker) with
5| real-time Firebase Realtime Database + Authentication sync.
6| 
7| ---
8| 
9| ## Running
10| 
11| No build step, no install. Serve the folder over HTTP (a Service Worker needs a real origin):
12| 
13| ```bash
14| cd dhruvo-sangsad
15| python3 -m http.server 8080
16| # open http://localhost:8080
17| ```
18| 
19| ## First login
20| 
21| | Field    | Value   |
22| | -------- | ------- |
23| | User ID  | `admin` |
24| | Password | `admin` |
25| 
26| The first login forces a profile setup + password change. **Afterwards the default
27| `admin` password stops working permanently.** Passwords are never stored or displayed in
28| plain text — they are PBKDF2-SHA256 hashed (150 000 iterations) via `crypto.subtle`.
29| 
30| ## Roles
31| 
32| | Role       | Capabilities |
33| | ---------- | ------------ |
34| | **Admin**  | Everything: member & deposit management, maker accounts, backup/restore, settings, activity log |
35| | **Maker**  | Approve/reject/edit members, deposit entry & approval, reports, WhatsApp reminders. Cannot change a Member ID, cannot touch prior-day deposits, no admin panel |
36| | **Member** | Self-registration, own profile, own deposits, own statement |
37| 
38| A **Member ID is the last 6 digits of the mobile number**, generated automatically, unique,
39| and never editable. Member ID, mobile, WhatsApp and email are all enforced unique.
40| 
41| Members register as `pending`. A pending member **can log in and view**, but **cannot submit
42| deposits** until an admin or maker approves them.
43| 
44| ## Accounting rule
45| 
46| Only **approved** deposits count toward totals, due, advance, statements, reports and the
47| dashboard. Pending and rejected rows are excluded everywhere.
48| 
49| ```
50| months    = whole months from join date through today (inclusive)
51| required  = monthly installment × months
52| paid      = approved monthly + advance deposits
53| due       = max(0, required − paid)
54| advance   = max(0, paid − required)
55| ```
56| 
57| Any deposit amount is accepted — there is no multiple-of-installment restriction.
58| 
59| ## Offline & sync
60| 
61| All data lives in IndexedDB (`dhruvo_sangsad`). Every write is also appended to a sync queue.
62| 
63| The app is pre-configured to sync to the central Firebase project **`rtd-ds`**
64| (Realtime Database `https://rtd-ds-default-rtdb.firebaseio.com`). 
65| 
65| **Multi-Device Real-Time Synchronization:**
66| - Every authorized device automatically syncs with the central Firebase Realtime Database
67| - When any user (Admin/Maker/Member) creates, updates, or deletes data on one device, all other logged-in devices see the change in real-time (no page refresh needed)
68| - Each device connects automatically and keeps every device in sync
69| - A different config can be set in **Settings → Firebase**
69| - The queue flushes automatically (on reconnect, on queue change, and every 30 s)
70| - The topbar chip shows `Online / Offline / Syncing / Synced / Sync Error`
71| 
72| Conflicts are resolved per record using `updatedAt`: if the server copy is newer than the
73| queued local payload, the remote record is applied locally instead of overwriting the server.
74| Every record carries `createdAt`, `updatedAt`, `updatedBy`, `deviceId` and `syncStatus`.
75| 
76| Firebase paths written: `authIndex/ users/ members/ deposits/ withdrawals/
77| pendingDeposits/ approvals/ notifications/ activityLogs/ settings/ syncMetadata/`.
78| Security rules live in [`firebase/database.rules.json`](firebase/database.rules.json) —
79| deny-by-default at the root, role checks read from `authIndex/$uid/role` (published on
80| Firebase Auth sign-in), Member IDs are immutable, activity logs are append-only, and
81| `settings/firebaseConfig` is never pushed.
82| 
83| ## Exports
84| 
85| * **PDF** — fully offline via bundled jsPDF + html2canvas. B&W print-optimised A4 sheets,
86|   Noto Sans Bengali + Arial, fixed point sizes (title 13, sub-header 10, member info 8.5,
87|   table header 8, table data 7.5, total 8, footer 7). Filenames follow
88|   `Dhruvo_Sangsad_Member_345678_Statement.pdf`.
89| * **Excel / CSV** — bundled SheetJS.
90| * **WhatsApp** — due reminder opens `wa.me` with the Bangla template from Settings; the
91|   member's name is substituted and no amount is ever included.
92| 
93| ## Reports
94| 
95| Member Statement · Overall · Daily · Monthly · Due · Advance · Collection · Payment Method ·
96| Date Range · Member-wise · Withdrawal. Reports generate on demand via the **Generate Report**
97| button and open in a modal with Download (PDF / Excel / CSV) and Close actions.
98| 
99| Statement columns are exactly `SL | Date | Deposit Type | Payment Method | Amount |
100| Cumulative Amount`. The overall report is exactly `Member Name | Monthly Installment |
101| Total Deposit | Total Due` with Total Collection and Total Due footers.
102| 
103| All dates display as `DD-MM-YYYY`.
104| 
105| ## Balance & withdrawals
106| 
107| Balance is never hard-coded — it is derived from transactions:
108| 
109| ```
110| available balance = total approved deposits − total approved withdrawals
111| ```
112| 
113| Withdrawals are validated against available balance (cannot exceed it), follow the same
114| pending → approved/rejected workflow, and appear on the dashboard, Authorization Pending,
115| and the Withdrawal report.
116| 
117| ## Backup & restore
118| 
119| Admin only, under **Backup & Restore**. Export writes a full JSON snapshot of every store;
120| restore asks for confirmation before replacing local data.
121| 
122| ## Layout
123| 
124| ```
125| index.html              app shell
126| manifest.webmanifest    PWA manifest
127| sw.js                   service worker (precaches shell, vendor, fonts, all modules)
128| css/app.css             theme, layout, print sheets
129| icons/                  192 / 512 / maskable-512
130| firebase/               Realtime Database security rules
131| js/
132|   util.js crypto.js db.js store.js auth.js firebase.js pdf.js icons.js ui.js ui-auth.js app.js
133|   pages/ account.js dashboard.js members.js deposits.js reports.js misc.js admin.js
134| vendor/                 jsPDF, html2canvas, SheetJS, Firebase compat SDK, Noto Sans Bengali
135| ```
136| 
137| `vendor/` is committed on purpose: the app must work with no network and there is no
138| package install or bundling step.
139| 
