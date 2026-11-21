#!/usr/bin/env bash
# Seeds the Fly demo project through the public API, like any CI upload: a baseline `main`
# build plus a `feature/new-button` build with restyled primary buttons, so the review page
# shows real pixel diffs. Run from the repo root after building packages/cli and
# fixtures/storybook-9 (needs curl and jq).
#
#   SHELF_URL=https://storyshelf.fly.dev SHELF_ADMIN_TOKEN=... apps/fly-app/seed.sh
#
# Idempotent: build SHAs derive from the fixture's index.json, so an unchanged fixture is a
# no-op and a changed one deletes the demo project and seeds it again.
set -euo pipefail

: "${SHELF_URL:?}" "${SHELF_ADMIN_TOKEN:?}"
SLUG=demo-design-system
FIXTURE=fixtures/storybook-9
STATIC="$PWD/$FIXTURE/storybook-static"
VARIANT="$(mktemp -d)"
# Restyles primary buttons only (their inline background); secondary stories stay unchanged.
FEATURE_CSS='button[style*="29, 78, 216"]{background:#7c3aed!important;border-radius:999px!important}'
# The workspace CLI (built in the job), so it always matches the server on this commit.
CLI=(node "$PWD/packages/cli/dist/index.js")
AUTH=(-H "Authorization: Bearer $SHELF_ADMIN_TOKEN" -H "content-type: application/json")
AUTHOR=(--author-name "Alex Doe" --author-email alex@example.com)

# DEMO_BROWSER (e.g. chromium@sprite) renders the demo on that target; unset keeps the VM's Chromium.
# The create endpoint has no browsers field, so it is set with an update. A target the server does
# not offer (its secrets are unset) answers 400 and stops the seed. Idempotent, so it also runs when
# the demo is already up to date, otherwise a newly set DEMO_BROWSER would be ignored.
set_demo_browser() {
  [ -n "${DEMO_BROWSER:-}" ] || return 0
  curl -fsS "${AUTH[@]}" -X PATCH "$SHELF_URL/api/v1/projects/$SLUG" -o /dev/null \
    -d "$(jq -nc --arg b "$DEMO_BROWSER" '{browsers: [$b]}')"
}

# The demo's AI profile (#992): AI insights only show once a site admin picks a profile. Set only
# when it differs, so a re-run is a no-op. The profile exists only when the server has AI configured
# (ANTHROPIC_API_KEY on Fly); without it the server answers 400 "Unknown AI profile", so the seed
# warns and carries on without insights. Any other failure still stops the seed.
set_demo_ai_profile() {
  local current code
  current="$(curl -fsS "${AUTH[@]}" "$SHELF_URL/api/v1/projects/$SLUG" | jq -r '.aiProfile // empty')"
  [ "$current" = "default" ] && return 0
  code="$(curl -sS "${AUTH[@]}" -X PATCH "$SHELF_URL/api/v1/projects/$SLUG" -o /dev/null \
    -w '%{http_code}' -d '{"aiProfile":"default"}')"
  case "$code" in
    2*) ;;
    400 | 501) echo "AI is not configured on this server; leaving the demo without an AI profile." ;;
    *) echo "::error::PATCH aiProfile answered '$code'"; exit 1 ;;
  esac
}

# The demo is public (#809): the repository is public, so every branch's builds may be opened without
# an account (diffs, Library, Storybook). Verdicts, comments and settings still need sign-in. The create
# endpoint has no such field, so it is a PATCH, set only when it differs; a re-run is a no-op.
set_demo_public() {
  local current
  current="$(curl -fsS "${AUTH[@]}" "$SHELF_URL/api/v1/projects/$SLUG" | jq -r '.publicBranchRegex // empty')"
  [ "$current" = ".*" ] && return 0
  curl -fsS "${AUTH[@]}" -X PATCH "$SHELF_URL/api/v1/projects/$SLUG" -o /dev/null \
    -d '{"publicBranchRegex":".*"}'
}

# The sign-in page links visitors to the demo's Storybook at /_/$SLUG/, which serves the latest
# *approved* build on the default branch (#809). Make sure the seeded `main` build is approved, through
# the review path a person uses ("Approve all", the same API call; never a direct status write). Waits for
# capture to settle, does nothing when the build is already approved, so a re-run is a no-op.
approve_main() {
  local i build status
  for i in $(seq 1 120); do
    build="$(curl -fsS "${AUTH[@]}" "$SHELF_URL/api/v1/projects/$SLUG/builds" |
      jq -c --arg sha "$MAIN_SHA" '[.[] | select(.gitSha == $sha)] | first // empty')"
    status="$(jq -r '.status // empty' <<<"$build")"
    case "$status" in
      approved) return 0 ;;
      failed | cancelled | rejected) echo "::error::the seeded main build is '$status'"; return 1 ;;
      "" | pending | capturing | comparing) sleep 5 ;;
      *)
        curl -fsS "${AUTH[@]}" -X POST -o /dev/null \
          "$SHELF_URL/api/v1/projects/$SLUG/builds/$(jq -r '.id' <<<"$build")/approve-all"
        sleep 2
        ;;
    esac
  done
  echo "::error::the seeded main build did not reach 'approved' in time"
  return 1
}

sha_for() { printf '%s:%s' "$1" "$(sha256sum "$STATIC/index.json" | cut -c1-64)" | sha256sum | cut -c1-40; }
MAIN_SHA="$(sha_for main)"
FEATURE_SHA="$(sha_for feature/new-button)"

# Seeded = both builds exist on the server and neither failed. Only a 404 means "not seeded
# yet"; any other failure (auth, 5xx, unreachable) stops here instead of guessing.
BUILDS_FILE="$(mktemp)"
CODE="$(curl -sS -o "$BUILDS_FILE" -w '%{http_code}' "${AUTH[@]}" \
  "$SHELF_URL/api/v1/projects/$SLUG/builds" || true)"
case "$CODE" in
  200)
    if jq -e --arg a "$MAIN_SHA" --arg b "$FEATURE_SHA" \
      '[.[] | select(.status != "failed") | .gitSha] | (index($a) != null) and (index($b) != null)' \
      "$BUILDS_FILE" >/dev/null; then
      set_demo_browser
      set_demo_public
      set_demo_ai_profile
      approve_main
      echo "Demo project is up to date; nothing to do."
      exit 0
    fi
    echo "Demo project is stale; recreating it."
    curl -fsS "${AUTH[@]}" -X DELETE "$SHELF_URL/api/v1/projects/$SLUG" -o /dev/null
    ;;
  404) ;;
  *)
    echo "::error::GET $SHELF_URL/api/v1/projects/$SLUG/builds answered '$CODE': $(head -c 300 "$BUILDS_FILE")"
    exit 1
    ;;
esac

# Create the project with fixed metadata. Uploads use the admin token itself: a project token
# minted through it has no owner, which makes it a viewer that cannot upload.
curl -fsS "${AUTH[@]}" -X POST "$SHELF_URL/api/v1/projects" -o /dev/null \
  -d '{"name":"Demo Design System","gitRepository":"acme/design-system","gitDefaultBranch":"main","requireVerifiedDefault":false}'
# Before the first upload, so the first build already renders on the chosen target.
set_demo_browser
set_demo_public
set_demo_ai_profile

# --full on both uploads: the fixture now builds with preview-stats.json, and no source file
# differs between the two builds (the feature build only injects CSS into the built output), so
# affected capture would inherit every story and the demo would show no diffs.
upload() { # <dir> <branch> <sha> <message>
  (cd "$FIXTURE" && "${CLI[@]}" upload --url "$SHELF_URL" --slug "$SLUG" --token "$SHELF_ADMIN_TOKEN" \
    --build-dir "$1" --branch "$2" --sha "$3" --message "$4" "${AUTHOR[@]}" --full)
}

upload "$STATIC" main "$MAIN_SHA" "chore: design system baseline"
cp -r "$STATIC/." "$VARIANT"
sed -i "s|</head>|<style>$FEATURE_CSS</style></head>|" "$VARIANT/iframe.html"
upload "$VARIANT" feature/new-button "$FEATURE_SHA" "feat: rounded primary button in the new brand colour"
approve_main
