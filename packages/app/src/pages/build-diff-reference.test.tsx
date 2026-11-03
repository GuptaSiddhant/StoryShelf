import type { Build } from "@storyshelf/core/schema";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { BaselineReference } from "../routers/baseline-reference.ts";
import { CompareStage } from "../ui/components.tsx";
import type { DesignSource } from "./build-diff-model.ts";
import { BaselineReferenceNotice, ComparisonSources } from "./build-diff-reference.tsx";

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

const baselineStage = (
  <CompareStage
    baselineSrc="/b.png"
    currentSrc="/c.png"
    diffSrc="/d.png"
    subject="Button / Primary"
  />
);
const figma: DesignSource = {
  value: "design",
  label: "Design",
  src: "/design.png",
  name: "Button",
  providerName: "Figma",
};

async function renderSources(sources: DesignSource[]): Promise<string> {
  const app = new Hono().get("/", (c): Response | Promise<Response> =>
    c.html(
      <ComparisonSources
        baseline={baselineStage}
        sources={sources}
        currentSrc="/c.png"
        subject="Button / Primary"
      />,
    ),
  );
  return await (await app.request("/")).text();
}

describe("comparison sources: markup", () => {
  it("offers no Design source without a cached render", async () => {
    const html = await renderSources([]);
    expect(html).toContain("data-compare");
    expect(html).not.toContain("data-compare-sources");
    expect(html).not.toContain("Compare against");
    expect(html).not.toContain("Design reference");
  });

  it("adds a switch and a hidden Design stage when a render is cached", async () => {
    const html = await renderSources([figma]);
    expect(html).toContain("Compare against");
    expect(html).toContain('data-compare-source="baseline"');
    expect(html).toMatch(/<div data-compare-source="design" hidden/u);
    expect(html).toContain('src="/design.png"');
    expect(html).toContain('src="/c.png"');
  });

  it("labels the Design stage as a reference that is not a test, and says it is scaled", async () => {
    const html = await renderSources([figma]);
    expect(html).toContain("Design reference: not a test.");
    expect(html).toContain("Scaled to the screenshot");
    expect(html).toContain("Figma · Button");
  });

  it("offers one source per render when a component links several", async () => {
    const html = await renderSources([
      { ...figma, value: "design-1", label: "Figma 1" },
      { ...figma, value: "design-2", label: "Figma 2", src: "/two.png" },
    ]);
    expect(html).toContain("Figma 1");
    expect(html).toContain("Figma 2");
    expect(html).toContain('src="/two.png"');
  });
});

describe("comparison sources: modes", () => {
  it("offers side by side, swipe and onion on the Design stage, with no diff, flip or zoom", async () => {
    const html = await renderSources([figma]);
    const design = html.slice(html.indexOf('data-compare-source="design"'));
    for (const mode of ["Side by side", "Swipe", "Onion skin"]) expect(design).toContain(mode);
    for (const absent of [">Diff<", ">Flip<", "Zoom", 'data-pane="diff"']) {
      expect(design).not.toContain(absent);
    }
    expect(design).toContain('data-modes="split,swipe,onion"');
    expect(design).toContain('data-zooms="fit"');
  });

  it("leaves the baseline stage as it was, with its diff and flip modes", async () => {
    const html = await renderSources([figma]);
    const baseline = html.slice(0, html.indexOf('data-compare-source="design"'));
    expect(baseline).toContain(">Diff<");
    expect(baseline).toContain(">Flip<");
    expect(baseline).toContain('data-pane="diff"');
  });
});
