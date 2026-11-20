#!/usr/bin/env bash
# Previous-release database job (ADR 0053 decision 8, #986). For one dialect:
#   1. migrate an empty database with the last PUBLISHED release (installed from npm) and seed it;
#   2. migrate the same database with this checkout, as the next minor release;
#   3. start the published release against it: it must skip its migrations (decision 2), leave
#      `schema_meta` alone, read what step 1 wrote, and write;
#   4. (postgres) run that release's own live database suites, checked out at its tag, against it;
#   5. mixed queue: this checkout enqueues every job kind (a repository link's `notify` job at
#      payload version 2 among them); the published release's consumers run alone (a rollback),
#      then beside this checkout's (a rolling deploy). No job may end `failed` because of its kind
#      or payload version, and each must run once, on a consumer that understands it.
# Fails if any step fails. Run from anywhere:
#   scripts/previous-release.sh <sqlite|postgres>
# Env: DATABASE_URL (postgres), PREVIOUS_RELEASE (default: newest `v*` tag), RUN_TAG_SUITES=0 to skip
# step 4, RUN_MIXED_QUEUE=0 to skip step 5.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.nub/bin:$PATH"

DIALECT="${1:?usage: previous-release.sh <sqlite|postgres>}"
PREV="${PREVIOUS_RELEASE:-$(git tag --list 'v*' --sort=-v:refname | head -1 | sed 's/^v//')}"
[ -n "$PREV" ] || { echo "no release tag found (fetch tags)" >&2; exit 1; }
NEXT="$(echo "$PREV" | awk -F. '{ printf "%d.%d.0", $1, $2 + 1 }')"
WORK="$PWD/.tmp/previous-release/$DIALECT"
rm -rf "$WORK"; mkdir -p "$WORK/consumer"
export DATA_DIR="$WORK/data"

echo "== $DIALECT: previous release $PREV, this checkout as $NEXT"

recorded() {
  case "$DIALECT" in
    sqlite) node -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.argv[1]);console.log(d.prepare(\"SELECT version FROM schema_meta WHERE id='schema'\").get()?.version??'none')" "$DATA_DIR/shelf.db" ;;
    postgres) psql "$DATABASE_URL" -Atc "SELECT version FROM schema_meta WHERE id='schema'" ;;
  esac
}
expect_recorded() {
  local got; got="$(recorded)"
  [ "$got" = "$1" ] || { echo "schema_meta says '$got', expected '$1' ($2)" >&2; exit 1; }
  echo "schema_meta = $got ($2)"
}

if [ "$DIALECT" = postgres ]; then
  : "${DATABASE_URL:?DATABASE_URL is required for postgres}"
  psql "$DATABASE_URL" -qc "DROP SCHEMA public CASCADE; CREATE SCHEMA public"
fi

# The published release, exactly as an operator installs it.
(cd "$WORK/consumer" && npm init -y >/dev/null && npm install --no-audit --no-fund --silent \
  "@storyshelf/app@$PREV" "@storyshelf/core@$PREV" "@storyshelf/storage-local@$PREV" \
  "@storyshelf/db-$DIALECT@$PREV")
cp scripts/previous-release/smoke-previous.mjs scripts/previous-release/mixed-queue-previous.mjs \
  "$WORK/consumer/"

echo "== step 1: previous release on an empty database"
(cd "$WORK/consumer" && node smoke-previous.mjs "$DIALECT" seed)
expect_recorded "$PREV" "written by $PREV"

echo "== step 2: this checkout migrates it"
DIALECT="$DIALECT" RELEASE="$NEXT" nub scripts/previous-release/migrate-current.ts
expect_recorded "$NEXT" "written by this checkout"

echo "== step 3: previous release starts on the new schema"
(cd "$WORK/consumer" && node smoke-previous.mjs "$DIALECT" expect)
expect_recorded "$NEXT" "left alone: $PREV skipped its migrations"

if [ "$DIALECT" = postgres ] && [ "${RUN_TAG_SUITES:-1}" = 1 ]; then
  echo "== step 4: $PREV's own database suites on the new schema"
  git worktree remove --force "$WORK/tag" 2>/dev/null || true
  git worktree add --detach "$WORK/tag" "v$PREV" >/dev/null
  trap 'git worktree remove --force "$WORK/tag" 2>/dev/null || true' EXIT
  (cd "$WORK/tag" && nub ci >/dev/null && nubx turbo run build --filter="@storyshelf/db-postgres^..." >/dev/null)
  # Disposable service database: the suites clear and claim shared rows.
  (cd "$WORK/tag/packages/db-postgres" && LIVE_CLOUD=1 POSTGRES_SCHEMA_MUTATION_TEST=0 \
    nubx vitest run src/postgres.live.test.ts)
fi
if [ "${RUN_MIXED_QUEUE:-1}" = 1 ]; then
  echo "== step 5: mixed queue, $PREV's consumers beside this checkout's"
  mixed() { DIALECT="$DIALECT" RELEASE="$NEXT" WORK="$WORK" nub scripts/previous-release/mixed-queue-current.ts "$@"; }
  previous() { (cd "$WORK/consumer" && node mixed-queue-previous.mjs "$DIALECT" "$1" "$WORK/previous.jsonl"); }
  # Typechecks the kind list against `CaptureJobKind`: a new kind must be enqueued here too.
  nubx tsc -p scripts/previous-release/tsconfig.json
  mixed enqueue 1
  previous 10 # alone, as after a rollback
  mixed rollback
  previous 50 & PREVIOUS_PID=$! # beside this checkout, as during a rolling deploy
  sleep 3
  mixed enqueue 2
  mixed consume
  wait "$PREVIOUS_PID"
  mixed final
fi
echo "== $DIALECT OK"
