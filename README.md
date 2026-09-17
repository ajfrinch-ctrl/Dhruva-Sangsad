# ধ্রুব সংসদ / Dhruva Sangsad

Offline-first member, deposit, and reporting PWA (IndexedDB + Firebase Realtime Database).

## Run locally

Open `index.html` via any static server, or use Firebase Hosting emulator:

```bash
npx firebase-tools serve --only hosting
```

Default first login: `admin` / `admin` (change immediately).

## Deploy

- **Firebase Hosting:** see [FIREBASE_HOSTING.md](FIREBASE_HOSTING.md) — `./deploy-to-firebase.sh`
- **GitHub Pages:** `./deploy-to-pages.sh`

## New Firebase project

1. Project ID in use: `dhruva-sangsad-app`
2. Enable Realtime Database + Auth (Email/Password and Anonymous)
3. Paste web `firebaseConfig` in the app: Settings → Cloud Sync
4. Start with rules in `firebase/database.rules.starter.json`
