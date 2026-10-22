#!/usr/bin/env bash
# Seeds the Fly demo project through the public API, like any CI upload: a baseline `main`
# build plus a `feature/new-button` build with restyled primary buttons, so the review page
# shows real pixel diffs. Run from the repo root after building fixtures/storybook-8.
#
#   STORYSHELF_URL=https://storyshelf.fly.dev STORYSHELF_ADMIN_TOKEN=... apps/fly-app/seed.sh
#
# Skips when the project already exists (delete it in the UI to re-seed).
set -euo pipefail

: "${STORYSHELF_URL:?}" "${STORYSHELF_ADMIN_TOKEN:?}"
SLUG=demo-design-system
FIXTURE=fixtures/storybook-8
STATIC="$PWD/$FIXTURE/storybook-static"
VARIANT="$(mktemp -d)"
# Restyles primary buttons only (their inline background); secondary stories stay unchanged.
FEATURE_CSS='button[style*="29, 78, 216"]{background:#7c3aed!important;border-radius:999px!important}'
CLI=(npx -y storyshelf@latest)
AUTHOR=(--author-name "Alex Doe" --author-email alex@example.com)

if curl -fsS -H "Authorization: Bearer $STORYSHELF_ADMIN_TOKEN" \
  "$STORYSHELF_URL/api/v1/projects/$SLUG" >/dev/null 2>&1; then
  echo "Project $SLUG already seeded; nothing to do."
  exit 0
fi

# `create` prints the project's CI token; scope the uploads to it.
CI_TOKEN="$(cd "$FIXTURE" && "${CLI[@]}" create --url "$STORYSHELF_URL" --name "Demo Design System" |
  sed -n 's/^CI token: //p')"
[ -n "$CI_TOKEN" ] || { echo "::error::could not read the CI token from 'storyshelf create'"; exit 1; }

upload() { # <dir> <branch> <message>
  (cd "$FIXTURE" && "${CLI[@]}" upload --url "$STORYSHELF_URL" --slug "$SLUG" --token "$CI_TOKEN" \
    --build-dir "$1" --branch "$2" --sha "$(printf '%s:%s' "$2" "$(sha256sum "$STATIC/index.json" | cut -c1-40)" | sha256sum | cut -c1-40)" \
    --message "$3" "${AUTHOR[@]}")
}

upload "$STATIC" main "chore: design system baseline"
cp -r "$STATIC/." "$VARIANT"
sed -i "s|</head>|<style>$FEATURE_CSS</style></head>|" "$VARIANT/iframe.html"
upload "$VARIANT" feature/new-button "feat: rounded primary button in the new brand colour"
