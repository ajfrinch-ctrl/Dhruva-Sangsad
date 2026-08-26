#!/usr/bin/env bash
# Deploy ধ্রুব সংসদ to Firebase Hosting (static PWA, no build step).
#
# Usage:
#   ./deploy-to-firebase.sh              # hosting only
#   ./deploy-to-firebase.sh --rules      # hosting + Realtime Database rules
#   ./deploy-to-firebase.sh --project ID # override .firebaserc
set -Eeuo pipefail

RULES=0
PROJECT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --rules) RULES=1; shift ;;
    --project) PROJECT="$2"; shift 2 ;;
    -h|--help) sed -n '2,8p' "$0" | sed 's/^# \\{0,1\\}//'; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
done

cd "$(dirname "$0")"

if ! command -v firebase >/dev/null 2>&1; then
  echo "Firebase CLI missing. Install: npm i -g firebase-tools" >&2
  echo "Then: firebase login" >&2
  exit 1
fi

for f in index.html manifest.webmanifest sw.js css/app.css js/app.js; do
  [[ -f "$f" ]] || { echo "missing $f" >&2; exit 2; }
done

args=(deploy --only hosting)
[[ $RULES -eq 1 ]] && args=(deploy --only hosting,database)
[[ -n "$PROJECT" ]] && args+=(--project "$PROJECT")

echo "==> firebase ${args[*]}"
firebase "${args[@]}"
echo
echo "Live URL: https://$(python3 - <<'PY' 2>/dev/null || true
import json
print(json.load(open(".firebaserc"))["projects"]["default"])
PY
).web.app"
echo "Also:     https://PROJECT_ID.firebaseapp.com"
