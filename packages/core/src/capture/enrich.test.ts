import { describe, expect, it, vi } from "vitest";
import type { CaptureRunner } from "../adapters/capture-runner.ts";
import { PER_CAPTURE_BUDGET_MS } from "../utils/storybook-token.ts";
import { enrichStories } from "./enrich.ts";
import { RENDER_TIMEOUT_MS } from "./render.ts";

function story(id: string) {
  return {
    id,
    title: "T",
    name: id,
    importPath: "./a.stories.ts",
    tags: [],
    type: "story" as const,
  };
}

describe("enrichStories", () => {
  it("asks for the signed URL with the parameter pass's budget, which scales with the stories", async () => {
    const extractParameters = vi.fn(async () => await Promise.resolve({}));
    const storybookUrl = vi.fn(async () => await Promise.resolve("https://x.test/_s/t/"));
    const runner = { extractParameters } as unknown as CaptureRunner;
    const many = Array.from({ length: 2000 }, (_, index) => story(`s${index}`));
    await enrichStories({
      runner,
      buildId: "b",
      storybookDir: "/x",
      stories: many,
      target: "chromium@farm",
      allowlist: null,
      logger: undefined,
      storybookUrl,
    });
    expect(storybookUrl).toHaveBeenCalledWith("chromium@farm", {
      budgetMs: 2000 * PER_CAPTURE_BUDGET_MS,
    });
    expect(2000 * PER_CAPTURE_BUDGET_MS).toBeGreaterThan(RENDER_TIMEOUT_MS);
    expect(extractParameters).toHaveBeenCalledWith(
      expect.objectContaining({ storybookUrl: "https://x.test/_s/t/" }),
    );
  });
});
