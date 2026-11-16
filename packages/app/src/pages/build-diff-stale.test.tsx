import type { Build, Project } from "@storyshelf/core/schema";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { StaleBaselineLine } from "./build-diff-stale.tsx";

const project = { slug: "app" } as Project;
const build = { id: "b1" } as Build;
async function render(staleCount: number, canReview: boolean): Promise<string> {
  const app = new Hono();
  app.get(
    "/",
    async (c) =>
      await c.html(
        <StaleBaselineLine
          project={project}
          build={build}
          staleCount={staleCount}
          canReview={canReview}
        />,
      ),
  );
  return await (await app.request("/")).text();
}

describe("StaleBaselineLine", () => {
  it("says one diff is out of date, and many are", async () => {
    expect(await render(1, true)).toContain("1 diff is out of date");
    expect(await render(3, true)).toContain("3 diffs are out of date");
  });

  it("offers Re-diff only to a viewer who may review", async () => {
    const withForm = await render(2, true);
    expect(withForm).toContain("/api/v1/projects/app/builds/b1/rediff");
    expect(withForm).toContain("Re-diff");
    expect(await render(2, false)).not.toContain("rediff");
  });
});
