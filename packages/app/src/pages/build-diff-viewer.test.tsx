import type { Build, Project, Snapshot } from "@storyshelf/core/schema";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { DiffViewer, type DiffViewerProps } from "./build-diff-viewer.tsx";
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

async function render(
  items?: DesignItem[],
  snapshot: Snapshot = selected,
  extra: Partial<DiffViewerProps> = {},
): Promise<string> {
  const app = new Hono().get("/", (c): Response | Promise<Response> =>
    c.html(
      <DiffViewer
        project={project}
        build={build}
        selected={snapshot}
        hasBaseline={{ s1: true }}
        design={items}
        {...extra}
      />,
    ),
  );
  return await (await app.request("/")).text();
}

const known = (imageSize: { width: number; height: number }): DiffViewerProps["reference"] => ({
  kind: "known",
  branch: "main",
  defaultBranch: true,
  updatedAt: "2026-01-01T00:00:00.000Z",
  imageAvailable: true,
  imageSize,
  build: { id: "ref", gitSha: "aaaaaaa123" } as Build,
});

describe("review stage: size change", () => {
  it("says the sizes differ instead of a 100% diff, and the diff mode says why it is empty", async () => {
    const html = await render(
      undefined,
      { ...selected, diffPath: null, diffPixels: 0, diffRatio: 1 },
      { reference: known({ width: 100, height: 100 }), currentSize: { width: 120, height: 100 } },
    );
    expect(html).toContain("100×100 → 120×100");
    expect(html).toContain("sizes differ");
    expect(html).not.toContain(">0 px<");
    expect(html).not.toContain(">100.0%<");
    expect(html).not.toContain("No diff yet");
    expect(html).toContain("No pixel diff: the images are different sizes");
    // Both images at one scale: the same 120-wide box.
    expect(html.match(/viewBox="0 0 120 100"/gu)).toHaveLength(2);
  });

  it("keeps the pixel figures when the sizes match", async () => {
    const html = await render(undefined, selected, {
      reference: known({ width: 800, height: 600 }),
      currentSize: { width: 800, height: 600 },
    });
    expect(html).toContain("12 px");
    expect(html).not.toContain("sizes differ");
  });

  it("names the baseline in one quiet line, not an alert", async () => {
    const html = await render(undefined, selected, { reference: known({ width: 1, height: 1 }) });
    expect(html).toContain("vs main ·");
    expect(html).toContain(">aaaaaaa</a>");
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain(">ref<");
  });
});

describe("review stage: unstable render", () => {
  it("flags a snapshot whose second render differed, and nothing else", async () => {
    const flagged = await render(undefined, { ...selected, unstable: true });
    expect(flagged).toContain("Unstable render: likely flaky");
    expect(flagged).toContain("This change may be noise");
    const unflagged = await Promise.all(
      [false, null].map(async (unstable) => await render(undefined, { ...selected, unstable })),
    );
    for (const page of unflagged) expect(page).not.toContain("Unstable render");
    expect(await render()).not.toContain("Unstable render");
  });
});

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

describe("review stage: no baseline", () => {
  it("shows only the screenshot for a new snapshot: no mode switch and no diff pane", async () => {
    const app = new Hono().get("/", (c): Response | Promise<Response> =>
      c.html(
        <DiffViewer
          project={project}
          build={build}
          selected={{ ...selected, status: "new", diffPath: null, baselineVersion: null }}
          hasBaseline={{ s1: false }}
        />,
      ),
    );
    const html = await (await app.request("/")).text();
    expect(html).toContain("New story — no baseline yet. Approve to set the baseline.");
    expect(html).toContain('data-single=""');
    expect(html).toContain('data-pane="current"');
    expect(html).not.toContain("data-compare-mode");
    expect(html).not.toContain('data-pane="diff"');
    expect(html).not.toContain("data-compare-swipe");
  });
});
