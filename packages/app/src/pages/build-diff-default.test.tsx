import type { Build, Project, Snapshot } from "@storyshelf/core/schema";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { DefaultComparison } from "../routers/baseline-reference.ts";
import { DefaultComparisonView } from "./build-diff-default.tsx";

const project = { slug: "demo" } as Project;
const build = { id: "build" } as Build;
const snapshot = { id: "snapshot" } as Snapshot;
const comparison: DefaultComparison = {
  id: "baseline",
  version: "2026-01-01T01:00:00Z",
  branch: "main",
  available: true,
  environment: "matching",
};
async function render(value: DefaultComparison): Promise<string> {
  const app = new Hono().get("/", (c): Response | Promise<Response> =>
    c.html(
      <DefaultComparisonView
        project={project}
        build={build}
        snapshot={snapshot}
        comparison={value}
      />,
    ),
  );
  return await (await app.request("/")).text();
}

describe("default baseline comparison", () => {
  it("renders a version-bound, lazy-loaded baseline and current image", async () => {
    const html = await render(comparison);
    expect(html).toContain(
      "reference=default&amp;id=baseline&amp;version=2026-01-01T01%3A00%3A00Z",
    );
    expect(html).toContain('loading="lazy"');
    expect(html).toContain("This build&#39;s screenshot");
    expect(html).toContain("fingerprints match");
    expect(html).toContain("Approval still uses the primary comparison");
  });
  it.each([
    ["different", "fingerprints differ"],
    ["unknown", "environment information is unavailable"],
  ] as const)("explains %s environment", async (environment, message) => {
    expect(await render({ ...comparison, environment })).toContain(message);
  });
  it("explains missing images", async () => {
    const html = await render({ ...comparison, available: false });
    expect(html).toContain("baseline image is unavailable");
    expect(html).not.toContain('alt="Current default-branch baseline"');
  });
});
