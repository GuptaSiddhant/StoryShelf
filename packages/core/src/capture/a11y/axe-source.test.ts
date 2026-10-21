import { beforeEach, describe, expect, it } from "vitest";
import { axeInjectionScript, loadAxeSource, resetAxeSourceCache } from "./axe-source.ts";

beforeEach(resetAxeSourceCache);

describe("loadAxeSource", () => {
  it("reads the real axe bundle and caches it", async () => {
    const first = await loadAxeSource();
    expect(first).toContain("axe");
    expect(first.length).toBeGreaterThan(100_000);
    expect(await loadAxeSource()).toBe(first);
  });
});

describe("axeInjectionScript", () => {
  it("evaluates the source once per document", () => {
    const script = axeInjectionScript(
      "globalThis.count = (globalThis.count ?? 0) + 1; globalThis.axe = {};",
    );
    const scope = globalThis as unknown as { count?: number; axe?: unknown };
    delete scope.axe;
    delete scope.count;
    // oxlint-disable-next-line no-eval -- evaluating the script string is what the runners do
    (0, eval)(script);
    // oxlint-disable-next-line no-eval -- second injection must be a no-op
    (0, eval)(script);
    expect(scope.count).toBe(1);
    delete scope.axe;
    delete scope.count;
  });

  it("survives a trailing line comment in the source", () => {
    expect(() => {
      // oxlint-disable-next-line no-eval -- see above
      (0, eval)(axeInjectionScript("//# sourceMappingURL=x.map"));
    }).not.toThrow();
  });
});
