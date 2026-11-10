import type { Build } from "@storyshelf/core/schema";
import { Hono } from "hono";
import { describe, expect, it } from "vite-plus/test";
import { InheritedRatioCard } from "./inherited-ratio-card.tsx";

function build(snapshotCount: number, inheritedCount: number, createdAt: string): Build {
  return { snapshotCount, inheritedCount, createdAt } as Build;
}

async function render(builds: Build[]): Promise<string> {
  const app = new Hono().get(
    "/",
    async (c) => await c.html(<InheritedRatioCard builds={builds} />),
  );
  return await (await app.request("/")).text();
}

describe("InheritedRatioCard", () => {
  it("names the metric, the window and what it does not measure", async () => {
    const html = await render([
      build(10, 5, "2026-01-02T00:00:00.000Z"),
      build(10, 10, "2026-01-01T00:00:00.000Z"),
    ]);
    expect(html).toContain("Average inherited share per build");
    expect(html).toContain("75%");
    expect(html).toContain("Over the 2 most recent builds with snapshots");
    expect(html).toContain("reused from a baseline instead of captured again");
    expect(html).toContain("not time or cost saved");
  });

  it("says build in the singular for one build", async () => {
    const html = await render([build(4, 1, "2026-01-01T00:00:00.000Z")]);
    expect(html).toContain("25%");
    expect(html).toContain("Over the most recent build with snapshots,");
  });

  it("renders nothing until a build holds snapshots", async () => {
    expect(await render([])).toBe("");
    expect(await render([build(0, 0, "2026-01-01T00:00:00.000Z")])).toBe("");
  });
});
