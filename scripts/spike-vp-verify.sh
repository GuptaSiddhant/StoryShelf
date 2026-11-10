#!/usr/bin/env bash
# SPIKE (#821): the `verify` graph as four `vp run -r` stages, timed, with each stage's cache table
# (`vp run --last-details`) appended to the job summary. Usage: spike-vp-verify.sh <label> [extra vp run flags]
set -uo pipefail
label="${1:?label}"; shift
extra=("$@")
sum="${GITHUB_STEP_SUMMARY:-/dev/null}"
start_all=$(date +%s)
status=0
{ echo "## vp verify: $label"; echo; } >> "$sum"
for stage in build build-storybook lint test; do
  t0=$(date +%s)
  vp run -r --concurrency-limit "${VP_CONCURRENCY:-1}" "${extra[@]}" "$stage" 2>&1 | tee ".tmp/vp-$label-$stage.log" | tail -n 5
  code=${PIPESTATUS[0]}
  t1=$(date +%s)
  if [ "$code" -ne 0 ]; then
    echo "::group::$stage failures"
    grep -nE "FAIL|AssertionError|Error:|✗|×|SIGTRAP|failed" ".tmp/vp-$label-$stage.log" | head -40
    echo "::endgroup::"
  fi
  {
    echo "### $stage: $((t1 - t0))s (exit $code)"
    echo '```'
    vp run --last-details 2>&1 | grep -E "Statistics|Performance|Cache (hit|miss)|#" | grep -vE "^\s*$" | head -150
    echo '```'
  } >> "$sum"
  [ "$code" -eq 0 ] || status=$code
done
echo "**total $label: $(( $(date +%s) - start_all ))s**" >> "$sum"
exit "$status"
