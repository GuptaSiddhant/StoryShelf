import { describe, expect, it } from "vitest";
import { PER_CAPTURE_BUDGET_MS, signStorybookToken } from "../utils/storybook-token.ts";
import {
  RENDER_TIMEOUT_MS,
  renderBudgetMs,
  renderWithTimeout,
  type RenderRequest,
} from "./render.ts";

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

describe("renderWithTimeout", () => {
  it("scrubs a signed Storybook URL from a failure's error text", async () => {
    const token = signStorybookToken({ secret: "k", projectId: "p1", buildId: "b1" });
    const runner = {
      render: async () =>
        await Promise.resolve({
          captures: [],
          failures: [
            {
              story: { id: "a" },
              viewportName: "desktop",
              error: `goto https://x.test/_s/${token}/iframe.html failed`,
            },
          ],
        }),
      cancel: async () => {},
    };
    const result = await renderWithTimeout(runner as never, {} as RenderRequest, 1000);
    expect(result.failures[0]?.error).toBe("goto https://x.test/_s/[redacted]/iframe.html failed");
  });
});
