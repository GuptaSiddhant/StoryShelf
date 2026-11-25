import { expect, it } from "vitest";

it("runs workers without V8 memory protection keys (the pglite SIGTRAP of #1356)", () => {
  expect(process.execArgv).toContain("--no-memory-protection-keys");
});
