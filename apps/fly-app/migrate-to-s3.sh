#!/usr/bin/env bash
# One-time, idempotent copy of the demo's stored objects (published Storybooks, screenshots,
# baselines, diffs) from the volume under /data to the Tigris bucket. Everything except
# `shelf.db*` (SQLite stays on the volume) and the scratch directory is copied under the same
# key; an object already in the bucket is skipped, so a run that is cut short can simply be run again.
#
# Run it on the machine, after the deploy that adds `storage-s3` and with the bucket secrets set:
#
#   fly ssh console -a storyshelf -C "/app/migrate-to-s3.sh --dry-run"   # counts only, writes nothing
#   fly ssh console -a storyshelf -C "/app/migrate-to-s3.sh"
#
# It reads AWS_BUCKET, AWS_ENDPOINT_URL_S3, AWS_REGION and the AWS_* credentials from the
# machine's environment (the Fly secrets) and prints only counts, never a key or a credential.
set -euo pipefail
exec node "$(dirname "$0")/dist/migrate-to-s3.mjs" "$@"
