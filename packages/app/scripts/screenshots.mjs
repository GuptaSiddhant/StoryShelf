// oxlint-disable-next-line unicorn/no-abusive-eslint-disable
/* oxlint-disable */
import { serve } from "@hono/node-server";
import { createShelfLogger } from "@storyshelf/core/logger";
import { ProjectModel, BuildModel, SnapshotModel, BaselineModel } from "@storyshelf/core/models";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import {
  projects,
  builds,
  snapshots,
  baselines,
  buildLabels,
  labelTypes,
  captureAttempts,
  captureLogs,
  projectStatusConfigs,
} from "@storyshelf/db-sqlite/schema";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createShelfApp } from "../src/index.tsx";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "../../../apps/website/public/screenshots");
mkdirSync(outDir, { recursive: true });

const transparentPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=",
  "base64",
);
const redPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function main() {
  const { db } = makeDatabase();
  const { storage } = makeStorage();

  const now = new Date().toISOString();
  const project = await new ProjectModel(db, { projects }).create({
    name: "Demo Design System",
    gitRepository: "acme/design-system",
    gitDefaultBranch: "main",
  });

  const buildModel = new BuildModel(db, { builds, buildLabels, labelTypes });
  const build = await buildModel.create(project.id, {
    gitSha: "abc123def4567890abc123def4567890abc12345",
    gitBranch: "feature/new-button",
    authorName: "Alex Doe",
    authorEmail: "alex@example.com",
    message: "feat: add primary button variant with new tokens",
  });
  await db.update(builds, build.id, { status: "reviewing", updatedAt: now });

  const snapModel = new SnapshotModel(db, { snapshots });
  const viewport = { name: "desktop", width: 1280, height: 720 };
  const stories = [
    {
      id: "components-button--primary",
      name: "Primary",
      title: "Components/Button",
      importPath: "src/Button.stories.tsx",
    },
    {
      id: "components-button--secondary",
      name: "Secondary",
      title: "Components/Button",
      importPath: "src/Button.stories.tsx",
    },
    {
      id: "components-card--default",
      name: "Default",
      title: "Components/Card",
      importPath: "src/Card.stories.tsx",
    },
  ];
  for (const story of stories) {
    const screenshotPath = `${project.id}/builds/${build.id}/screenshots/${story.id}/${viewport.name}.png`;
    const diffPath = `${project.id}/builds/${build.id}/diffs/${story.id}/${viewport.name}.png`;
    const snap = await snapModel.create(project.id, build.id, {
      storyId: story.id,
      storyName: story.name,
      storyTitle: story.title,
      storyImportPath: story.importPath,
      viewportName: viewport.name,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      screenshotPath,
    });
    await storage.write(screenshotPath, transparentPng);
    await storage.write(diffPath, redPng);
    await snapModel.update(snap.id, {
      status: "changed",
      diffPixels: 2345,
      diffRatio: 0.08,
      diffPath,
    });
  }

  await db.update(builds, build.id, {
    status: "reviewing",
    snapshotCount: stories.length,
    changedCount: stories.length,
    approvedCount: 0,
    updatedAt: now,
  });

  // Baseline for primary on main
  const baselineModel = new BaselineModel(db, { baselines }, storage, "test-secret");
  await storage.write(
    `${project.id}/baselines/main/${stories[0].id}/${viewport.name}.png`,
    transparentPng,
  );
  await baselineModel.upsert(
    project.id,
    stories[0].id,
    viewport.name,
    "main",
    "baseline-snap",
    `${project.id}/baselines/main/${stories[0].id}/${viewport.name}.png`,
    transparentPng,
  );

  const app = createShelfApp({
    database: db,
    storage,
    logger: createShelfLogger({ level: "silent" }),
  });
  await app.lifecycle.setup();

  const server = serve({ fetch: app.fetch, port: 0 }, () => {});
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 3457;
  const base = `http://localhost:${port}`;

  const browser = await chromium.launch();
  try {
    // Projects list
    let page = await browser.newPage({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 2,
    });
    await page.goto(`${base}/`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(outDir, "projects-list.png"), fullPage: true });
    console.log("✓ projects-list.png");
    await page.close();

    // Build detail (snapshot cards + bulk actions)
    page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
    await page.goto(`${base}/projects/${project.slug}/builds/${build.id}`, {
      waitUntil: "networkidle",
    });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: join(outDir, "build-review.png"), fullPage: true });
    console.log("✓ build-review.png");
    await page.close();

    // Diff review (sticky review bar + baseline | current | diff viewer)
    page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
    await page.goto(`${base}/projects/${project.slug}/builds/${build.id}/diff`, {
      waitUntil: "networkidle",
    });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: join(outDir, "diff-review.png"), fullPage: false });
    console.log("✓ diff-review.png");
    await page.close();

    console.log("App screenshots done ->", outDir);
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
    await app.lifecycle.teardown();
  }
}

await main();
