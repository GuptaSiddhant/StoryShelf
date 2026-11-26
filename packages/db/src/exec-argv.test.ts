import { expect, it } from "vitest";

it("runs workers without wasm code GC (the pglite V8 abort of #1356)", () => {
  expect(process.execArgv).toContain("--no-wasm-code-gc");
});
