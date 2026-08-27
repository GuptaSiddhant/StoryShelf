import { join } from "node:path";
import {
  StorybookAdapter,
  runCapture,
  type Build,
  type CaptureRunner,
  type DatabaseAdapter,
  type Project,
  type StorageAdapter,
  type StoryEntry,
  type StorySourceAdapter,
  type Viewport,
} from "@storyshelf/core";
import { BuildModel } from "@storyshelf/core/models/build";
import { ProjectModel } from "@storyshelf/core/models/project";
import { chromium, type Browser } from "playwright";

import { createStaticServer } from "./static-server.ts";
import { DEFAULT_VIEWPORTS } from "./viewport.ts";

export interface CaptureRunnerDeps {
  db: DatabaseAdapter;
  storage: StorageAdapter;
  dataDir: string;
}

interface ScreenshotContext {
  browser: Browser;
  adapter: StorySourceAdapter;
  baseUrl: string;
}

export function createPlaywrightCaptureRunner(deps: CaptureRunnerDeps): CaptureRunner {
  return {
    async run(buildId) {
      await runBuild(deps, buildId);
    },
    async cancel(_buildId) {
      await Promise.resolve();
    },
  };
}

async function loadTarget(deps: CaptureRunnerDeps, buildId: string): Promise<{ build: Build; project: Project }> {
  const build = await new BuildModel(deps.db).get(buildId);
  if (!build) {
    throw new Error(`Build not found: ${buildId}`);
  }
  const project = await new ProjectModel(deps.db).get(build.projectId);
  if (!project) {
    throw new Error(`Project not found: ${build.projectId}`);
  }
  return { build, project };
}

async function runBuild(deps: CaptureRunnerDeps, buildId: string): Promise<void> {
  const { build, project } = await loadTarget(deps, buildId);
  const storybookDir = join(deps.dataDir, project.id, "builds", build.id, "storybook");
  const server = await createStaticServer(storybookDir);
  const browser = await chromium.launch();
  const adapter = new StorybookAdapter();
  const ctx: ScreenshotContext = { browser, adapter, baseUrl: server.url };

  try {
    await new BuildModel(deps.db).setStatus(build.id, "capturing");
    await runCapture({
      db: deps.db,
      storage: deps.storage,
      project,
      build,
      storybookDir,
      viewports: DEFAULT_VIEWPORTS,
      adapter,
      renderStory: async (story, viewport) => await captureScreenshot(ctx, story, viewport),
    });
  } finally {
    await Promise.all([browser.close(), server.close()]);
  }
}

async function captureScreenshot(ctx: ScreenshotContext, story: StoryEntry, viewport: Viewport): Promise<Buffer> {
  const page = await ctx.browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
  try {
    await page.goto(ctx.adapter.buildUrl(ctx.baseUrl, story.id), { waitUntil: "networkidle" });
    if (ctx.adapter.screenshotSelector) {
      await page.waitForSelector(ctx.adapter.screenshotSelector);
    }
    return await page.screenshot();
  } finally {
    await page.close();
  }
}
