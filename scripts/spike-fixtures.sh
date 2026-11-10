#!/usr/bin/env bash
# SPIKE (#821) gate 5: fixtures stay isolated with the root on pnpm + Vite+.
set -uo pipefail
fail=0
note() { echo "[$1] $2"; { echo "- **$1**: $2"; } >> "${GITHUB_STEP_SUMMARY:-/dev/null}"; }
root_before=$(sha256sum pnpm-lock.yaml | cut -d' ' -f1)
for f in storybook-8 storybook-9 storybook-10; do
  d="fixtures/$f"
  before=$(sha256sum "$d/pnpm-lock.yaml" | cut -d' ' -f1)
  git show "origin/main:$d/pnpm-lock.yaml" > ".tmp/$f.main.lock" 2>/dev/null || git show "HEAD:$d/pnpm-lock.yaml" > ".tmp/$f.main.lock"
  rm -rf "$d/node_modules" "$d/storybook-static"
  pnpm --dir "$d" install --frozen-lockfile >".tmp/$f.install1.log" 2>&1 && note "$f install" "frozen install ok" || { note "$f install" "FAILED: $(tail -3 ".tmp/$f.install1.log" | tr '\n' ' ')"; fail=1; continue; }
  pnpm --dir "$d" install --frozen-lockfile >".tmp/$f.install2.log" 2>&1 && note "$f install 2" "second frozen install ok" || { note "$f install 2" "FAILED"; fail=1; }
  after=$(sha256sum "$d/pnpm-lock.yaml" | cut -d' ' -f1)
  [ "$before" = "$after" ] && note "$f lockfile" "unchanged by installs" || { note "$f lockfile" "CHANGED by install"; fail=1; }
  # Resolved package set vs main: compare the `packages:` keys, not bytes.
  node -e '
    const fs=require("fs");
    const keys=(p)=>{const t=fs.readFileSync(p,"utf8");const m=t.split(/^packages:\n/m)[1]?.split(/^\S/m)[0]??"";return [...m.matchAll(/^  (\S.*):$/gm)].map(x=>x[1]).sort().join("\n");};
    process.exit(keys(process.argv[1])===keys(process.argv[2])?0:1)' ".tmp/$f.main.lock" "$d/pnpm-lock.yaml" \
    && note "$f resolved set" "identical to main" || { note "$f resolved set" "DIFFERS from main"; fail=1; }
  pnpm --dir "$d" run build-storybook >".tmp/$f.build.log" 2>&1 && [ -f "$d/storybook-static/index.html" ] && note "$f build" "build-storybook ok" || { note "$f build" "FAILED"; fail=1; }
done
[ "$root_before" = "$(sha256sum pnpm-lock.yaml | cut -d' ' -f1)" ] && note "root lockfile" "unchanged" || { note "root lockfile" "CHANGED"; fail=1; }
# Root commands must not descend into fixtures/.
vp check >".tmp/check.log" 2>&1
if grep -qE '(^|[^A-Za-z-])fixtures/' .tmp/check.log; then note "vp check" "DESCENDS into fixtures/: $(grep -m3 -E '(^|[^A-Za-z-])fixtures/' .tmp/check.log | tr '\n' ' ')"; fail=1; else note "vp check" "does not list fixtures/"; fi
vp test list --filesOnly 2>/dev/null | grep -q "fixtures/" && { note "vp test" "DESCENDS into fixtures/"; fail=1; } || note "vp test" "does not list fixtures/ (fixtures have no test files; weak check)"
# Cached vp task over a fixture (decision 7).
vp run -w fixture-storybook-9 >".tmp/fx-task1.log" 2>&1; vp run -w fixture-storybook-9 2>&1 | tee ".tmp/fx-task2.log" | tail -2
grep -q "2/2 cache hit" ".tmp/fx-task2.log" && note "cached fixture task" "second run replayed (2/2 hits)" || { note "cached fixture task" "second run did not fully replay"; fail=1; }
exit "$fail"
