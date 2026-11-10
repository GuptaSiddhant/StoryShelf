import { Hono } from "hono";
import { describe, expect, it } from "vite-plus/test";
import type { ReviewSectionData } from "../routers/review-section.handlers.ts";
import { ChangesetCard } from "./review-changeset.tsx";

/** The card only reads `changeset`; the rest of the section data is not needed to render it. */
function dataWith(baseline: { gitSha: string; gitBranch: string } | null): ReviewSectionData {
  return {
    changeset: {
      baseline,
      changeset: { added: [], changed: [], removed: [], unchanged: 3 },
    },
  } as unknown as ReviewSectionData;
}

async function render(data: ReviewSectionData): Promise<string> {
  const app = new Hono();
  app.get("/", async (c) => await c.html(<ChangesetCard data={data} />));
  return await (await app.request("/")).text();
}

describe("ChangesetCard wording", () => {
  it("says a changed component has different story-index metadata, not a different look", async () => {
    const html = await render(dataWith(null));
    expect(html).toContain("different story-index metadata");
    expect(html).toContain("not necessarily a different look");
    expect(html).toContain("Changes to args or source alone do not show here");
  });

  it("names the baseline build it compares with, or says there is none", async () => {
    const withBaseline = await render(dataWith({ gitSha: "abcdef1234567", gitBranch: "main" }));
    expect(withBaseline).toContain("Compared with the accepted build abcdef1 on main.");
    const without = await render(dataWith(null));
    expect(without).toContain("No accepted build to compare with: every component counts as new.");
  });
});
