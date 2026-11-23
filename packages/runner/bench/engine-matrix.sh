#!/usr/bin/env bash
# Interleaved stock/Flashwright capture passes on one Storybook build, same Chromium binary.
#   bench/engine-matrix.sh <storybook-static> <out dir> <passes> [concurrency]
# Spike #1379. Nothing here touches nub.lock or any package.json; everything lives under .tmp/ (gitignored).
# Setup (once), from the repo root:
#   1. Flashwright, scripts off:  mkdir -p .tmp/fw-install && cd .tmp/fw-install && echo '{"private":true}' > package.json &&
#        npm i --ignore-scripts flashwright-core@1.64.1-flashwright.12     # sha512-iuK+eMGQ...bDr85A==
#   2. One Chromium for both engines (Flashwright wants revision 1248, stock 1.63.0 wants 1243): unzip
#        https://cdn.playwright.dev/builds/cft/156.0.8078.4/linux64/chrome-headless-shell-linux64.zip into
#        .tmp/pwb/chromium_headless_shell-1248/ (+ an empty INSTALLATION_COMPLETE file), then
#        ln -s ../pwb/chromium_headless_shell-1248 .tmp/pwb-stock/chromium_headless_shell-1243
#   3. A built fixture, e.g. (cd fixtures/storybook-9 && pnpm install && pnpm run build-storybook).
# Then:  bench/engine-matrix.sh ../../fixtures/storybook-9/storybook-static ../../.tmp/run-sb9 5
#        node --conditions=source bench/engine-diff.ts ../../.tmp/run-sb9      (pixel gate, threshold 0)
set -euo pipefail
root="$(git rev-parse --show-toplevel)"; cd "$root/packages/runner"
static="$1"; out="$2"; passes="$3"; conc="${4:-1}"
fw="file://$root/.tmp/fw-install/node_modules/flashwright-core/index.mjs"
for n in $(seq 1 "$passes"); do
  env -u SHELF_BENCH_CORE_ENTRY PLAYWRIGHT_BROWSERS_PATH="$root/.tmp/pwb-stock" node --conditions=source --import ./bench/engine-register.mjs \
    bench/engine-capture.ts "$static" "$out/stock-$n" 1 "$conc"
  PLAYWRIGHT_BROWSERS_PATH="$root/.tmp/pwb" SHELF_BENCH_CORE_ENTRY="$fw" node --conditions=source --import ./bench/engine-register.mjs \
    bench/engine-capture.ts "$static" "$out/fw-$n" 1 "$conc"
done
