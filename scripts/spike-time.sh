#!/usr/bin/env bash
# SPIKE (#907): time one tool (turbo|vp) on the same task set, at its default concurrency. DO NOT MERGE.
# Cold = cache dir removed. Stage series = build, build-storybook, lint, test as four sequential calls
# (what `verify` does today); graph = one call (turbo `verify`, or vp `verify-graph`). Website excluded.
set -uo pipefail
tool="${1:?turbo|vp}"
mkdir -p .tmp/logs
: > .tmp/times.tsv
sum="${GITHUB_STEP_SUMMARY:-/dev/null}"

if [ "$tool" = turbo ]; then
  clear_cache() { rm -rf .turbo/cache node_modules/.cache/turbo; }
  stage() { nubx turbo run "$1" --filter='!website' --continue; }
  graph() { nubx turbo verify --filter='!website' --continue; }
  pgonly() { nubx turbo run test --only --force --filter=@storyshelf/db-postgres; }
  grouped() { nubx turbo run test --only --force --filter='!website' --continue --log-order=grouped; }
else
  clear_cache() { rm -rf node_modules/.vite/task-cache; }
  stage() { vp run -F '!website' "$1"; }
  graph() { vp run verify-graph; }
  pgonly() { vp run --no-cache -F @storyshelf/db-postgres test; }
  grouped() { vp run -F '!website' --no-cache --log=grouped test; }
fi

# rec <label> <command...>: wall seconds and exit code into times.tsv, full output into logs/<label>.log
rec() {
  local label="$1"; shift
  local s e code
  s=$(date +%s.%N)
  "$@" > ".tmp/logs/$label.log" 2>&1
  code=$?
  e=$(date +%s.%N)
  printf '%s\t%.1f\t%s\n' "$label" "$(echo "$e - $s" | bc -l)" "$code" | tee -a .tmp/times.tsv
  if [ "$code" -ne 0 ]; then
    { echo "::group::$label failed (exit $code)"; grep -nE "FAIL|Error:|SIGTRAP|✗|×|ERROR" ".tmp/logs/$label.log" | head -25; echo "::endgroup::"; }
  fi
  tail -n 4 ".tmp/logs/$label.log" | sed 's/^/    /'
}

for i in 1 2 3; do
  clear_cache
  for st in build build-storybook lint test; do rec "cold-$i-$st" stage "$st"; done
  clear_cache
  rec "cold-$i-graph" graph
done
for i in 1 2 3; do
  for st in build build-storybook lint test; do rec "warm-$i-$st" stage "$st"; done
  rec "warm-$i-graph" graph
done
echo "- docs-only edit" >> docs/testing.md
rec docs-graph graph
git checkout -- docs/testing.md
echo "// spike" >> packages/notify-chat/src/index.ts
rec pkg-graph graph
git checkout -- packages/notify-chat/src/index.ts
for i in 1 2 3; do rec "pg-$i" pgonly; done
rec pkgtimes-test grouped
python3 scripts/spike-summary.py "$tool" >> "$sum"
