#!/usr/bin/env bash
# Seeds the Fly demo project through the public API, like any CI upload: a baseline `main`
# build plus a `feature/new-button` build with restyled primary buttons, so the review page
# shows real pixel diffs. Run from the repo root after building packages/cli and
# fixtures/storybook-8 (needs curl and jq).
#
#   STORYSHELF_URL=https://storyshelf.fly.dev STORYSHELF_ADMIN_TOKEN=... apps/fly-app/seed.sh
#
# Idempotent: build SHAs derive from the fixture's index.json, so an unchanged fixture is a
# no-op and a changed one deletes the demo project and seeds it again.
set -euo pipefail

: "${STORYSHELF_URL:?}" "${STORYSHELF_ADMIN_TOKEN:?}"
SLUG=demo-design-system
FIXTURE=fixtures/storybook-8
STATIC="$PWD/$FIXTURE/storybook-static"
VARIANT="$(mktemp -d)"
# Restyles primary buttons only (their inline background); secondary stories stay unchanged.
FEATURE_CSS='button[style*="29, 78, 216"]{background:#7c3aed!important;border-radius:999px!important}'
# The workspace CLI (built in the job), so it always matches the server on this commit.
CLI=(node "$PWD/packages/cli/dist/index.js")
AUTH=(-H "Authorization: Bearer $STORYSHELF_ADMIN_TOKEN" -H "content-type: application/json")
AUTHOR=(--author-name "Alex Doe" --author-email alex@example.com)

sha_for() { printf '%s:%s' "$1" "$(sha256sum "$STATIC/index.json" | cut -c1-64)" | sha256sum | cut -c1-40; }
MAIN_SHA="$(sha_for main)"
FEATURE_SHA="$(sha_for feature/new-button)"

# Seeded = both builds exist on the server and neither failed.
if BUILDS="$(curl -fsS "${AUTH[@]}" "$STORYSHELF_URL/api/v1/projects/$SLUG/builds" 2>/dev/null)"; then
  if jq -e --arg a "$MAIN_SHA" --arg b "$FEATURE_SHA" \
    '[.[] | select(.status != "failed") | .gitSha] | (index($a) != null) and (index($b) != null)' \
    <<<"$BUILDS" >/dev/null; then
    echo "Demo project is up to date; nothing to do."
    exit 0
  fi
  echo "Demo project is stale; recreating it."
  curl -fsS "${AUTH[@]}" -X DELETE "$STORYSHELF_URL/api/v1/projects/$SLUG" -o /dev/null
fi

# Create the project with fixed metadata and a CI token scoped to it.
curl -fsS "${AUTH[@]}" -X POST "$STORYSHELF_URL/api/v1/projects" -o /dev/null \
  -d '{"name":"Demo Design System","gitRepository":"acme/design-system","gitDefaultBranch":"main"}'
CI_TOKEN="$(curl -fsS "${AUTH[@]}" -X POST "$STORYSHELF_URL/api/v1/projects/$SLUG/tokens" \
  -d '{"name":"demo-seed"}' | jq -er .token)"

upload() { # <dir> <branch> <sha> <message>
  (cd "$FIXTURE" && "${CLI[@]}" upload --url "$STORYSHELF_URL" --slug "$SLUG" --token "$CI_TOKEN" \
    --build-dir "$1" --branch "$2" --sha "$3" --message "$4" "${AUTHOR[@]}")
}

upload "$STATIC" main "$MAIN_SHA" "chore: design system baseline"
cp -r "$STATIC/." "$VARIANT"
sed -i "s|</head>|<style>$FEATURE_CSS</style></head>|" "$VARIANT/iframe.html"
upload "$VARIANT" feature/new-button "$FEATURE_SHA" "feat: rounded primary button in the new brand colour"
