import type { Build, Project, Snapshot } from "@storyshelf/core/schema";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { DiffViewer } from "./build-diff-viewer.tsx";
import type { DesignItem } from "./design-links.tsx";

const project = { slug: "demo" } as Project;
const build = { id: "b1", isDefault: false } as Build;
const selected = {
  id: "s1",
  storyId: "button--primary",
  storyTitle: "Button",
  storyName: "Primary",
  storyImportPath: "src/Button.stories.tsx",
  status: "changed",
  viewportName: "desktop",
  viewportWidth: 800,
  viewportHeight: 600,
  browser: "chromium",
  diffPath: "d.png",
  diffPixels: 12,
  diffRatio: 0.031,
  baselineVersion: null,
} as unknown as Snapshot;

const design = (extra: Partial<DesignItem> = {}): DesignItem => ({
  url: "https://figma.test/file/1",
  providerName: "Figma",
  name: "Button",
  state: "ok",
  renderUrl: "/api/v1/projects/demo/design/1/render",
  stale: false,
  ...extra,
});

async function render(items?: DesignItem[]): Promise<string> {
  const app = new Hono().get("/", (c): Response | Promise<Response> =>
    c.html(
      <DiffViewer
        project={project}
        build={build}
        selected={selected}
        hasBaseline={{ s1: true }}
        design={items}
      />,
    ),
  );
  return await (await app.request("/")).text();
}

describe("review stage: compare to design", () => {
  it("offers the Design source only when the component has a cached render", async () => {
    const withRender = await render([design()]);
    expect(withRender).toContain("Compare against");
    expect(withRender).toContain("/api/v1/projects/demo/design/1/render");
    for (const html of [
      await render(),
      await render([]),
      await render([design({ renderUrl: null })]),
    ]) {
      expect(html).not.toContain("Compare against");
      expect(html).not.toContain("Design reference: not a test");
    }
  });

  it("keeps the baseline stage and the reference pane under it", async () => {
    const html = await render([design()]);
    expect(html).toContain('data-compare-source="baseline"');
    expect(html).toContain(">Diff<");
    expect(html).toContain("Figma reference");
  });

  it("states the design is a reference, not a test", async () => {
    expect(await render([design()])).toContain("Design reference: not a test.");
  });

  it("still shows the stale-design notice beside the Design source", async () => {
    const html = await render([design({ stale: true })]);
    expect(html).toContain("Design changed since this baseline was approved");
    expect(html).toContain("This does not block review.");
    expect(html).toContain("Compare against");
  });

  it("still shows the deleted-design notice, and does not fabricate a source without a render", async () => {
    const html = await render([design({ state: "deleted", renderUrl: null })]);
    expect(html).toContain("Design not found");
    expect(html).not.toContain("Compare against");
  });
});
