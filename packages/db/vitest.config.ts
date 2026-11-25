import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The pglite suites run WebAssembly in many short-lived forked workers. On hosts with Intel
    // PKU, V8 write-protects JIT code with memory protection keys and tracks each code page; its
    // bookkeeping for freed WASM code intermittently fails a fatal check
    // (`jit_page_->allocations_.erase(addr) == 1` in `ThreadIsolation::UnregisterWasmAllocation`),
    // which kills the worker with SIGTRAP even though every test passed (#1356). Turning the keys
    // off removes that path; it only drops a code-memory hardening layer in test workers.
    execArgv: ["--no-memory-protection-keys"],
  },
});
