# Firebase Hosting — ধ্রুব সংসদ

Static PWA. No `npm run build`. Site root = repository root.

After deploy the app is at:

- `https://dhruva-sangsad-app.web.app`
- `https://dhruva-sangsad-app.firebaseapp.com`

## Console (first time)

1. [Firebase Console](https://console.firebase.google.com/) → your project
2. **Build → Hosting → Get started**
3. Skip the CLI sample if you already have this repo
4. You still need the CLI once to upload files (next section)

## CLI deploy

```bash
npm i -g firebase-tools
firebase login
```

If you switch projects, edit `.firebaserc` or:

```bash
firebase use --add
```

Then:

```bash
./deploy-to-firebase.sh
# or
firebase deploy --only hosting
```

Publish starter database rules at the same time:

```bash
./deploy-to-firebase.sh --rules
```

## GitHub Actions

1. Firebase Console → Project settings → Service accounts → **Generate new private key**
2. GitHub repo → Settings → Secrets → Actions → `FIREBASE_SERVICE_ACCOUNT` = the whole JSON
3. Push to `main` or run **Deploy to Firebase Hosting** from the Actions tab

Hosting workflow uses project `dhruva-sangsad-app`.

## After it is live

1. Open the Hosting URL
2. Log in `admin` / `admin` and change the password
3. Settings → Cloud Sync → paste the **same project’s** `firebaseConfig` → Save & Connect
