import { createShelfLogger } from "@storyshelf/core/logger";
import { BuildModel, ProjectModel, SnapshotModel } from "@storyshelf/core/models";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { buildLabels, builds, projects, snapshots } from "@storyshelf/db-sqlite/schema";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";

function styleBlock(html: string): string {
  const match = /<style>(?<css>[\s\S]*)<\/style>/u.exec(html);
  if (!match?.groups?.["css"]) {
    throw new Error("expected a <style> block in the document");
  }
  return match.groups["css"];
}

describe("DocumentLayout stylesheet", () => {
  it("serves the CSS unescaped so selectors and font stacks survive", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const app = createShelfApp({
      database: db,
      storage,
      logger: createShelfLogger({ level: "silent" }),
    });
    const html = await (await app.request("/")).text();
    const css = styleBlock(html);
    expect(css).toContain('[data-theme="dark"]');
    expect(css).toContain("font-family:");
    expect(css).not.toContain("&quot;");
    expect(css).not.toContain("&gt;");
    expect(css).not.toContain("&lt;");
    expect(css).not.toContain("&#39;");
  });

  it("collects hono/css component styles into the storyshelf-css tag", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const project = await new ProjectModel(db, { projects }).create({ name: "Docs" });
    const build = await new BuildModel(db, { builds, buildLabels, snapshots }).create(project.id, {
      gitSha: "abc123",
      gitBranch: "main",
    });
    await new SnapshotModel(db, { snapshots }).create(project.id, build.id, {
      storyId: "button--primary",
      storyName: "Primary",
      storyTitle: "Button",
      viewportName: "desktop",
      viewportWidth: 1280,
      viewportHeight: 720,
      screenshotPath: "screenshots/primary.png",
    });
    const app = createShelfApp({
      database: db,
      storage,
      logger: createShelfLogger({ level: "silent" }),
    });
    const html = await (
      await app.request(`/projects/${project.slug}/builds/${build.id}/diff`)
    ).text();
    expect(html).toContain('id="storyshelf-css"');
    const collected = /<style id="storyshelf-css">(?<css>[\s\S]*)<\/style>/u.exec(html)?.groups?.[
      "css"
    ];
    expect(collected ?? "").toContain("ss-btn-");
  });
});
