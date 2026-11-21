#!/usr/bin/env bash
# Prepares the Fly demo through the public API (#1275). The demo shows one project, `storyshelf-ui`
# (the app's own Storybook, uploaded by app-storybook.yml). This script:
#   1. deletes the old seeded `demo-design-system` project (builds, baselines and stored files),
#      through the admin API; a no-op once it is gone;
#   2. makes sure `storyshelf-ui` exists, so the read-only demo account has a project to be a
#      viewer of (the server, `demo-viewer.ts`, creates the account from the SHELF_DEMO_VIEWER_PASSWORD
#      Fly secret and adds the membership; this script never sees that password).
#
#   SHELF_URL=https://storyshelf.fly.dev SHELF_ADMIN_TOKEN=... apps/fly-app/seed.sh
#
# Idempotent: a re-run changes nothing.
set -euo pipefail

: "${SHELF_URL:?}" "${SHELF_ADMIN_TOKEN:?}"
OLD_SLUG=demo-design-system
UI_SLUG=storyshelf-ui
AUTH=(-H "Authorization: Bearer $SHELF_ADMIN_TOKEN" -H "content-type: application/json")

# Prints the HTTP status of a request; only the status decides what happens next.
status_of() { curl -sS -o /dev/null -w '%{http_code}' "${AUTH[@]}" "$@"; }

# 1. The old seeded project. Only 200 (delete it) and 404 (already gone) are expected.
code="$(status_of "$SHELF_URL/api/v1/projects/$OLD_SLUG")"
case "$code" in
  200)
    echo "Deleting the old seeded project '$OLD_SLUG'."
    curl -fsS "${AUTH[@]}" -X DELETE "$SHELF_URL/api/v1/projects/$OLD_SLUG" -o /dev/null
    ;;
  404) ;;
  *) echo "::error::GET /projects/$OLD_SLUG answered '$code'"; exit 1 ;;
esac

# 2. The demo project.
code="$(status_of "$SHELF_URL/api/v1/projects/$UI_SLUG")"
case "$code" in
  200) ;;
  404)
    echo "Creating the '$UI_SLUG' project."
    curl -fsS "${AUTH[@]}" -X POST "$SHELF_URL/api/v1/projects" -o /dev/null \
      -d '{"name":"StoryShelf UI","gitRepository":"GuptaSiddhant/StoryShelf","gitDefaultBranch":"main","requireVerifiedDefault":false}'
    ;;
  *) echo "::error::GET /projects/$UI_SLUG answered '$code'"; exit 1 ;;
esac

echo "Demo project is up to date; nothing to do."
