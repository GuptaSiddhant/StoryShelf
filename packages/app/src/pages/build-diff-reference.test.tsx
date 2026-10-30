import type { Build } from "@storyshelf/core/schema";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { BaselineReference } from "../routers/baseline-reference.ts";
import { BaselineReferenceNotice } from "./build-diff-reference.tsx";

async function render(reference: BaselineReference): Promise<string> {
  const app = new Hono().get("/", (c): Response | Promise<Response> =>
    c.html(<BaselineReferenceNotice reference={reference} />),
  );
  return await (await app.request("/")).text();
}

describe("baseline reference notice", () => {
  it("explains missing and unavailable references", async () => {
    expect(await render({ kind: "none" })).toContain("No baseline at capture");
    expect(await render({ kind: "unavailable" })).toContain("Baseline reference unavailable");
  });
  it("renders the branch, verified build, and missing image", async () => {
    const html = await render({
      kind: "known",
      branch: "feature/x",
      defaultBranch: false,
      updatedAt: "2026-01-01",
      imageAvailable: false,
      build: { id: "build1", gitSha: "abcdef123" } as Build,
    });
    expect(html).toContain("Accepted branch");
    expect(html).toContain("feature/x");
    expect(html).toContain("build1");
    expect(html).toContain("abcdef1");
    expect(html).toContain("baseline image is unavailable");
  });
  it("reports missing build details on the default branch", async () => {
    const html = await render({
      kind: "known",
      branch: "main",
      defaultBranch: true,
      updatedAt: "2026-01-01",
      imageAvailable: true,
      build: null,
    });
    expect(html).toContain("Default branch");
    expect(html).toContain("Reference build and commit are unavailable");
  });
});
