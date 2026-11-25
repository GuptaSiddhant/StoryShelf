import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The pglite suites create and close many PGlite (WebAssembly) instances per worker. Node 24's
    // V8 (13.6) can free a dying wasm-to-JS import wrapper twice when its wasm code GC races a
    // wrapper lookup, and aborts the worker with SIGTRAP on a fatal check
    // (`jit_page_->allocations_.erase(addr) == 1` or `jit_page.has_value()`), even though every
    // test passed (#1356). Upstream: nodejs/node#66366, fixed in V8 9b8ca54d5a, backport
    // nodejs/node#66376 not yet in a 24.x release. `--no-wasm-code-gc` removes the freeing path;
    // V8 flags are refused in NODE_OPTIONS, so they must go on the workers' command line.
    // `--no-memory-protection-keys` (#1387) is not enough: the check fires without PKU too.
    execArgv: ["--no-wasm-code-gc"],
  },
});
