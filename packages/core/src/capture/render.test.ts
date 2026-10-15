import { describe, expect, it } from "vitest";
import { PER_CAPTURE_BUDGET_MS, RENDER_TIMEOUT_MS, renderBudgetMs } from "./render.ts";

describe("renderBudgetMs", () => {
  it("keeps the default floor for small matrices", () => {
    expect(renderBudgetMs(10)).toBe(RENDER_TIMEOUT_MS);
  });

  it("scales with the capture count for large matrices", () => {
    // 1,000 captures on a one-page host must not be cancelled at 15 minutes.
    expect(renderBudgetMs(1000)).toBe(1000 * PER_CAPTURE_BUDGET_MS);
    expect(renderBudgetMs(1000)).toBeGreaterThan(RENDER_TIMEOUT_MS);
  });

  it("honours an explicit budget even when it is shorter", () => {
    expect(renderBudgetMs(1000, 50)).toBe(50);
  });
});
