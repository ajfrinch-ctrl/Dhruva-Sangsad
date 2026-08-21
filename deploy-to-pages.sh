#!/usr/bin/env bash
#
# deploy-to-pages.sh — deploy ধ্রুব সংসদ (Dhruvo Sangsad) to GitHub Pages.
#
# This repository is a static, build-free PWA served from the repository root,
# so "deploying" means: validate the tree, publish the commit to the branch
# GitHub Pages builds from, wait for that build to finish, then verify the
# live site actually serves the new content.
#
# Usage:
#   ./deploy-to-pages.sh [options]
#
# Options:
#   -m, --message <msg>   Commit message for uncommitted changes.
#   -n, --dry-run         Run every check, change nothing, push nothing.
#   -y, --yes             Do not prompt for confirmation (for CI).
#       --no-verify       Skip fetching the live site after the build.
#       --allow-detached  Permit deploying from a branch that Pages does not
#                         publish (pushes it, but nothing goes live).
#       --timeout <sec>   Seconds to wait for the Pages build (default 300).
#   -h, --help            Show this help.
#
# Exit codes: 0 success · 1 usage/precondition · 2 validation · 3 git/push
#             4 Pages build failed or timed out · 5 live verification failed
#
set -Eeuo pipefail

REPO_SLUG="ajfrinch-ctrl/Dhruva-Sangsad"
BUILD_TIMEOUT=300
DRY_RUN=0
ASSUME_YES=0
SKIP_VERIFY=0
ALLOW_DETACHED=0
COMMIT_MESSAGE=""

# ── output helpers ───────────────────────────────────────────────────────────
if [[ -t 1 ]] && command -v tput >/dev/null 2>&1 && [[ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]]; then
  C_RESET=$'\033[0m'; C_DIM=$'\033[2m';  C_RED=$'\033[31m'
  C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_BLUE=$'\033[34m'; C_BOLD=$'\033[1m'
else
  C_RESET=""; C_DIM=""; C_RED=""; C_GREEN=""; C_YELLOW=""; C_BLUE=""; C_BOLD=""
fi

step()  { printf '\n%s==>%s %s%s%s\n' "$C_BLUE" "$C_RESET" "$C_BOLD" "$*" "$C_RESET"; }
ok()    { printf '  %s✓%s %s\n' "$C_GREEN"  "$C_RESET" "$*"; }
warn()  { printf '  %s!%s %s\n' "$C_YELLOW" "$C_RESET" "$*"; }
info()  { printf '  %s·%s %s\n' "$C_DIM"    "$C_RESET" "$*"; }
die()   { local code="$1"; shift; printf '\n%sERROR:%s %s\n' "$C_RED" "$C_RESET" "$*" >&2; exit "$code"; }

trap 'die 1 "unexpected failure on line $LINENO"' ERR

# ── argument parsing ─────────────────────────────────────────────────────────
usage() { sed -n '3,25p' "$0" | sed 's/^# \{0,1\}//'; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    -m|--message)    [[ $# -ge 2 ]] || die 1 "--message needs a value"; COMMIT_MESSAGE="$2"; shift 2 ;;
    -n|--dry-run)    DRY_RUN=1; shift ;;
    -y|--yes)        ASSUME_YES=1; shift ;;
    --no-verify)     SKIP_VERIFY=1; shift ;;
    --allow-detached) ALLOW_DETACHED=1; shift ;;
    --timeout)       [[ $# -ge 2 ]] || die 1 "--timeout needs a value"; BUILD_TIMEOUT="$2"; shift 2 ;;
    -h|--help)       usage; exit 0 ;;
    *)               die 1 "unknown option: $1 (try --help)" ;;
  esac
done

[[ "$BUILD_TIMEOUT" =~ ^[0-9]+$ ]] || die 1 "--timeout must be a whole number of seconds"

printf '%s┌────────────────────────────────────────────────┐%s\n' "$C_BOLD" "$C_RESET"
printf '%s│  ধ্রুব সংসদ · deploy to GitHub Pages            │%s\n' "$C_BOLD" "$C_RESET"
printf '%s└────────────────────────────────────────────────┘%s\n' "$C_BOLD" "$C_RESET"
[[ $DRY_RUN -eq 1 ]] && warn "DRY RUN — nothing will be committed, pushed or deployed"

# ── 1. tooling ───────────────────────────────────────────────────────────────
step "Checking tooling"
for tool in git gh curl; do
  command -v "$tool" >/dev/null 2>&1 || die 1 "required tool not found: $tool"
done
ok "git · gh · curl present"

gh auth status >/dev/null 2>&1 || die 1 "GitHub CLI is not authenticated. Run: gh auth login"
ok "GitHub CLI authenticated"

# ── 2. repository ────────────────────────────────────────────────────────────
step "Inspecting repository"
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die 1 "not inside a git repository"
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"
info "root: $REPO_ROOT"

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[[ "$BRANCH" != "HEAD" ]] || die 1 "detached HEAD — check out a branch first"
info "branch: $BRANCH"

git remote get-url origin >/dev/null 2>&1 || die 1 "no 'origin' remote configured"

# ── 3. validate the static site ──────────────────────────────────────────────
step "Validating site contents"

REQUIRED=(index.html manifest.webmanifest sw.js .nojekyll css/app.css js/app.js)
missing=()
for f in "${REQUIRED[@]}"; do [[ -f "$f" ]] || missing+=("$f"); done
[[ ${#missing[@]} -eq 0 ]] || die 2 "missing required file(s): ${missing[*]}"
ok "required files present (${#REQUIRED[@]} checked)"

# .nojekyll matters: without it Pages runs Jekyll and drops _underscore paths.
[[ -f .nojekyll ]] && ok ".nojekyll present (Jekyll processing disabled)"

# Every asset the service worker precaches must exist, or the app breaks offline.
if [[ -f sw.js ]]; then
  sw_missing=()
  while IFS= read -r asset; do
    [[ -n "$asset" && "$asset" != "./" ]] || continue
    [[ -e "$asset" ]] || sw_missing+=("$asset")
  done < <(sed -n '/^const PRECACHE = \[/,/^\];/p' sw.js \
             | grep -oE "'[^']+'" | tr -d "'")
  if [[ ${#sw_missing[@]} -gt 0 ]]; then
    die 2 "sw.js precaches file(s) that do not exist: ${sw_missing[*]}"
  fi
  ok "every sw.js precache entry resolves on disk"
fi

# Assets referenced by index.html must exist too (relative paths only).
idx_missing=()
while IFS= read -r ref; do
  [[ -n "$ref" ]] || continue
  case "$ref" in http*|//*|data:*|\#*|mailto:*) continue ;; esac
  [[ -e "${ref%%\?*}" ]] || idx_missing+=("$ref")
done < <(grep -oE '(src|href)="[^"]+"' index.html | sed -E 's/^(src|href)="//; s/"$//')
[[ ${#idx_missing[@]} -eq 0 ]] || die 2 "index.html references missing file(s): ${idx_missing[*]}"
ok "index.html asset references resolve"

# Root-absolute paths break project pages served under /<repo>/.
if grep -qE '(src|href)="/[^/]' index.html; then
  warn "index.html uses root-absolute paths — these break under /Dhruva-Sangsad/"
fi

# Syntax-check the JS if node is available. Modules are ESM; sw.js is a worker.
if command -v node >/dev/null 2>&1; then
  js_bad=()
  # js/ is loaded via <script type="module"> — it must parse as an ES module.
  # A CommonJS parse is too permissive here and lets real syntax errors through.
  while IFS= read -r -d '' jsfile; do
    node --input-type=module --check < "$jsfile" >/dev/null 2>&1 || js_bad+=("$jsfile")
  done < <(find js -name '*.js' -not -name '*.min.js' -print0 2>/dev/null)

  # sw.js and vendor/ are classic scripts, so they parse as non-module code.
  while IFS= read -r -d '' jsfile; do
    node --check "$jsfile" >/dev/null 2>&1 || js_bad+=("$jsfile")
  done < <(find sw.js vendor -maxdepth 2 -name '*.js' -not -name '*.min.js' -print0 2>/dev/null)

  if [[ ${#js_bad[@]} -gt 0 ]]; then
    die 2 "JavaScript syntax errors in: ${js_bad[*]}"
  fi
  ok "JavaScript files parse cleanly"
fi

# JSON must be valid or the PWA install and the Firebase rules silently fail.
if command -v jq >/dev/null 2>&1; then
  json_bad=()
  for jsonfile in manifest.webmanifest firebase/database.rules.json; do
    [[ -f "$jsonfile" ]] || continue
    jq empty "$jsonfile" >/dev/null 2>&1 || json_bad+=("$jsonfile")
  done
  [[ ${#json_bad[@]} -eq 0 ]] || die 2 "invalid JSON in: ${json_bad[*]}"
  ok "manifest and Firebase rules are valid JSON"
fi

# ── 4. resolve the Pages publishing source ───────────────────────────────────
step "Reading GitHub Pages configuration"
if ! PAGES_JSON="$(gh api "repos/$REPO_SLUG/pages" 2>/dev/null)"; then
  die 1 "GitHub Pages is not enabled for $REPO_SLUG (or the token cannot read it).
       Enable it: Settings → Pages → Deploy from a branch → main → / (root)"
fi

pages_field() { printf '%s' "$PAGES_JSON" | jq -r "$1 // empty" 2>/dev/null; }

SOURCE_BRANCH="$(pages_field '.source.branch')"
SOURCE_PATH="$(pages_field '.source.path')"
BUILD_TYPE="$(pages_field '.build_type')"
SITE_URL="$(pages_field '.html_url')"
: "${SOURCE_BRANCH:=main}" "${SOURCE_PATH:=/}" "${SITE_URL:=https://ajfrinch-ctrl.github.io/Dhruva-Sangsad/}"

ok "source: branch '$SOURCE_BRANCH', path '$SOURCE_PATH' (build type: ${BUILD_TYPE:-unknown})"
info "site: $SITE_URL"

if [[ "$BUILD_TYPE" == "workflow" ]]; then
  warn "Pages builds via GitHub Actions; this script pushes and then tracks that run"
fi

if [[ "$BRANCH" != "$SOURCE_BRANCH" ]]; then
  if [[ $ALLOW_DETACHED -eq 1 ]]; then
    warn "on '$BRANCH' but Pages publishes '$SOURCE_BRANCH' — pushing anyway, nothing goes live"
  else
    die 1 "you are on '$BRANCH' but GitHub Pages publishes from '$SOURCE_BRANCH'.
       Merge into '$SOURCE_BRANCH' and rerun, or pass --allow-detached to push
       this branch without publishing."
  fi
fi

# ── 5. commit pending work ───────────────────────────────────────────────────
step "Checking working tree"
if [[ -n "$(git status --porcelain)" ]]; then
  git status --short | sed 's/^/    /'
  if [[ $DRY_RUN -eq 1 ]]; then
    warn "uncommitted changes would be committed (dry run — skipped)"
  else
    if [[ -z "$COMMIT_MESSAGE" ]]; then
      COMMIT_MESSAGE="Deploy to GitHub Pages ($(date -u '+%Y-%m-%d %H:%M UTC'))"
    fi
    if [[ $ASSUME_YES -eq 0 ]]; then
      read -r -p "  Commit these changes as \"$COMMIT_MESSAGE\"? [y/N] " reply
      [[ "$reply" =~ ^[Yy]$ ]] || die 1 "aborted by user"
    fi
    git add -A
    git commit -m "$COMMIT_MESSAGE" >/dev/null || die 3 "commit failed"
    ok "committed: $COMMIT_MESSAGE"
  fi
else
  ok "working tree clean"
fi

LOCAL_SHA="$(git rev-parse HEAD)"
info "commit: ${LOCAL_SHA:0:7}"

# ── 6. push ──────────────────────────────────────────────────────────────────
step "Publishing to origin/$BRANCH"
git fetch origin "$BRANCH" --quiet 2>/dev/null || true

if git rev-parse --verify --quiet "refs/remotes/origin/$BRANCH" >/dev/null; then
  REMOTE_SHA="$(git rev-parse "refs/remotes/origin/$BRANCH")"
  BEHIND="$(git rev-list --count "HEAD..refs/remotes/origin/$BRANCH")"
  if [[ "$BEHIND" -gt 0 ]]; then
    die 3 "origin/$BRANCH has $BEHIND commit(s) you do not have locally.
       Run: git pull --rebase origin $BRANCH"
  fi
else
  REMOTE_SHA=""
fi

ALREADY_PUBLISHED=0
if [[ "$REMOTE_SHA" == "$LOCAL_SHA" ]]; then
  ALREADY_PUBLISHED=1
  ok "origin/$BRANCH is already at ${LOCAL_SHA:0:7} — nothing to push"
elif [[ $DRY_RUN -eq 1 ]]; then
  warn "would push ${LOCAL_SHA:0:7} to origin/$BRANCH (dry run — skipped)"
else
  if [[ $ASSUME_YES -eq 0 ]]; then
    read -r -p "  Push ${LOCAL_SHA:0:7} to origin/$BRANCH and deploy? [y/N] " reply
    [[ "$reply" =~ ^[Yy]$ ]] || die 1 "aborted by user"
  fi
  git push origin "$BRANCH" 2>&1 | sed 's/^/    /' \
    || die 3 "push failed — the token may lack write access to $REPO_SLUG"
  ok "pushed ${LOCAL_SHA:0:7} to origin/$BRANCH"
fi

if [[ $DRY_RUN -eq 1 ]]; then
  step "Dry run complete"
  ok "all validations passed; nothing was changed"
  exit 0
fi

if [[ "$BRANCH" != "$SOURCE_BRANCH" ]]; then
  step "Done (not a Pages source branch)"
  warn "'$BRANCH' is not published by Pages — the live site is unchanged"
  exit 0
fi

# ── 7. wait for the Pages build ──────────────────────────────────────────────
step "Waiting for the GitHub Pages build"

PREV_BUILD_ID="$(gh api "repos/$REPO_SLUG/pages/builds/latest" --jq '.url' 2>/dev/null || echo "")"

# A no-op push produces no new build, so request one explicitly.
if [[ $ALREADY_PUBLISHED -eq 1 && "$BUILD_TYPE" != "workflow" ]]; then
  if gh api -X POST "repos/$REPO_SLUG/pages/builds" >/dev/null 2>&1; then
    info "content unchanged — requested a fresh build"
  else
    warn "could not request a rebuild (needs admin rights); checking the last build"
  fi
fi

deadline=$(( SECONDS + BUILD_TIMEOUT ))
build_status=""
build_sha=""
build_error=""
spin=0

while (( SECONDS < deadline )); do
  if BUILD_JSON="$(gh api "repos/$REPO_SLUG/pages/builds/latest" 2>/dev/null)"; then
    build_status="$(printf '%s' "$BUILD_JSON" | jq -r '.status // empty')"
    build_sha="$(printf '%s' "$BUILD_JSON" | jq -r '.commit // empty')"
    build_error="$(printf '%s' "$BUILD_JSON" | jq -r '.error.message // empty')"

    if [[ "$build_status" == "built" && "$build_sha" == "$LOCAL_SHA" ]]; then
      duration="$(printf '%s' "$BUILD_JSON" | jq -r '.duration // 0')"
      printf '\r'
      ok "build succeeded for ${build_sha:0:7} in $(( duration / 1000 ))s"
      break
    fi
    if [[ "$build_status" == "errored" ]]; then
      printf '\r'
      die 4 "Pages build errored: ${build_error:-no message returned}"
    fi
  fi

  spin=$(( (spin + 1) % 4 ))
  frames='|/-\'
  printf '\r  %s%s%s waiting… status=%-10s elapsed=%ss ' \
    "$C_DIM" "${frames:$spin:1}" "$C_RESET" "${build_status:-pending}" "$SECONDS"
  sleep 5
done
printf '\r%*s\r' 60 ''

if [[ "$build_status" != "built" ]]; then
  die 4 "timed out after ${BUILD_TIMEOUT}s (last status: ${build_status:-unknown}).
       Check: https://github.com/$REPO_SLUG/deployments"
fi

if [[ "$build_sha" != "$LOCAL_SHA" ]]; then
  warn "live build is ${build_sha:0:7}, expected ${LOCAL_SHA:0:7} — a later push may have won the race"
fi

# ── 8. verify the live site ──────────────────────────────────────────────────
if [[ $SKIP_VERIFY -eq 1 ]]; then
  step "Skipping live verification (--no-verify)"
else
  step "Verifying the live site"
  sleep 3   # Pages' CDN needs a moment to expose the new build.

  probe() { # path -> prints HTTP status, empty on network failure
    curl -fsS -o /dev/null -w '%{http_code}' --max-time 20 \
      -H 'Cache-Control: no-cache' "${SITE_URL%/}/$1" 2>/dev/null || printf ''
  }

  reachable=1
  failed=()
  for path in "" "index.html" "manifest.webmanifest" "sw.js" "css/app.css" \
              "js/app.js" "icons/icon-192.png"; do
    code="$(probe "$path")"
    label="${path:-/}"
    if [[ -z "$code" ]]; then
      reachable=0
      warn "$label — network unreachable from this machine"
      break
    elif [[ "$code" == "200" ]]; then
      ok "$label → 200"
    else
      failed+=("$label → $code")
      printf '  %s✗%s %s → %s\n' "$C_RED" "$C_RESET" "$label" "$code"
    fi
  done

  if [[ $reachable -eq 0 ]]; then
    warn "could not reach $SITE_URL — the build succeeded, so verify in a browser"
  elif [[ ${#failed[@]} -gt 0 ]]; then
    die 5 "live site is serving errors: ${failed[*]}"
  fi
fi

# ── done ─────────────────────────────────────────────────────────────────────
step "Deployed"
printf '  %s%s%s\n' "$C_GREEN$C_BOLD" "$SITE_URL" "$C_RESET"
info "commit ${LOCAL_SHA:0:7} on $SOURCE_BRANCH"
info "hard-refresh (Ctrl/Cmd+Shift+R) to bypass the service worker cache"
exit 0
