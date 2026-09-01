# ধ্রুব সংসদ — Dhruvo Sangsad

Offline-first সদস্য, জমা, বকেয়া, অগ্রিম, উত্তোলন ও রিপোর্ট ব্যবস্থাপনা সিস্টেম। PWA + IndexedDB + Firebase Realtime Database (rtd-ds) — কোনো build step ছাড়াই GitHub Pages থেকে সরাসরি চলে।

**Live:** https://ajfrinch-ctrl.github.io/Dhruva-Sangsad/

## ✨ বৈশিষ্ট্য
- **Offline-first:** IndexedDB + sync queue, internet ফিরলে auto-sync
- **Real-time multi-device:** Firebase RTDB listeners (child_added/changed/removed)
- **Roles:** admin / maker / member — role-based navigation & permissions
- **Member:** registration (Member ID = mobile শেষ ৬ digit), approval workflow, forced password change
- **Deposits:** monthly / advance / special / other, cash/mobile/bank, pending→approved flow
- **Withdrawals:** savings / advance_refund / other, balance check including pending withdrawals (overdraft protection)
- **Reports:** statement, overall, daily, monthly, due, advance, collection, method, range, member-wise, withdrawal — PDF/Excel/CSV
- **Security:** PBKDF2-SHA256 (150k iter), no plaintext password in RTDB, tightened RTDB rules
- **PWA:** manifest, service worker (cache-first shell, network-first navigation), offline banner, sync chip

## 🗂️ Structure
```
index.html
manifest.webmanifest
sw.js
css/app.css
js/
  app.js, auth.js, db.js, firebase.js, crypto.js, store.js, ui.js, ui-auth.js, util.js, icons.js, pdf.js
  pages/ dashboard, members, deposits, reports, admin, account, misc
vendor/ firebase-* compat, jspdf, html2canvas, xlsx, fonts
firebase/database.rules.json
```

## 🔧 Local run
No build needed:
```bash
python3 -m http.server 8000
# open http://localhost:8000
```
Or VS Code Live Server.

Default admin on fresh install: `admin / admin` → first login forces setup wizard (name, username, mobile, password change).

## ☁️ Firebase (rtd-ds)
Default config in `js/firebase.js` points to `rtd-ds` project (see FIREBASE_MIGRATION.md).  
Settings → Firebase → Save & Connect to override, or Disconnect for offline-only.

Security rules in `firebase/database.rules.json`:
- `authIndex`: first user can be admin (numChildren()===0), otherwise role must match or admin can create
- `pendingDeposits`: read admin/maker only, write staff or own memberDocId
- `notifications`: staff can write any, member can only create audience=staff kind=deposit/withdraw/register
- `syncMetadata`: write only own deviceId

Deploy rules via Firebase console.

## 🚀 Deploy to GitHub Pages
```bash
./deploy-to-pages.sh --yes
```
Script validates assets, commits, pushes to Pages source branch, waits for build, verifies live site.

## 🔒 Audit fixes applied (2026-09-01)
- Firebase config updated to `rtd-ds` (was stale dhruvo-sangsad)
- manifest `id` changed from absolute `/dhruvo-sangsad/` to `./index.html` for project pages compatibility
- Withdrawal overdraft: `withdrawalBalance()` now subtracts pending withdrawals; approval re-checks balance
- RTDB rules tightened for pendingDeposits, notifications, syncMetadata, authIndex bootstrap
- update-version workflow: added `[skip ci]` + `if: !contains(message, 'chore: bump version')` to prevent infinite loop
- Added proper README, fixed VERSION handling

## 📄 License
Private — ধ্রুব সংসদ internal use.
