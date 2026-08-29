import { mkdir, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

import AdmZip from "adm-zip";
import {
  StorybookAdapter,
  runCapture,
  storybookZipPath,
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
import type { Logger } from "pino";

import { createStaticServer } from "./static-server.ts";
import { DEFAULT_VIEWPORTS } from "./viewport.ts";

export interface CaptureRunnerDeps {
  db: DatabaseAdapter;
  storage: StorageAdapter;
  dataDir: string;
  logger?: Logger;
}

interface ScreenshotContext {
  browser: Browser;
  adapter: StorySourceAdapter;
  baseUrl: string;
}

/** A capture that may currently be in flight, so that `cancel` can abort it. */
interface ActiveRun {
  cancelled: boolean;
  browser: Browser | null;
}

const activeRuns = new Map<string, ActiveRun>();

export function createPlaywrightCaptureRunner(deps: CaptureRunnerDeps): CaptureRunner {
  return {
    async run(buildId, reqId) {
      const active: ActiveRun = { cancelled: false, browser: null };
      activeRuns.set(buildId, active);
      try {
        await runBuild(deps, buildId, reqId, active);
      } finally {
        activeRuns.delete(buildId);
      }
    },
    async cancel(buildId) {
      const active = activeRuns.get(buildId);
      if (!active) {
        return;
      }
      active.cancelled = true;
      await closeBrowser(active.browser);
    },
  };
}

async function closeBrowser(browser: Browser | null): Promise<void> {
  if (!browser) {
    return;
  }
  try {
    await browser.close();
  } catch {
    // The run's own `finally` performs final cleanup; cancel must never throw.
  }
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

function blockedTarget(root: string, entryName: string): boolean {
  const candidate = resolve(join(root, entryName));
  return candidate !== root && !candidate.startsWith(root + sep);
}

function assertNoTraversal(zip: AdmZip, root: string): void {
  for (const entry of zip.getEntries()) {
    if (blockedTarget(root, entry.entryName)) {
      throw new Error(`Blocked path traversal in uploaded Storybook: ${entry.entryName}`);
    }
  }
}

async function extractStorybook(deps: CaptureRunnerDeps, projectId: string, buildId: string): Promise<string> {
  const targetDir = join(deps.dataDir, projectId, "builds", buildId, "storybook");
  const root = resolve(targetDir);
  const zip = new AdmZip(await deps.storage.read(storybookZipPath(projectId, buildId)));
  assertNoTraversal(zip, root);
  await rm(targetDir, { recursive: true, force: true });
  await mkdir(targetDir, { recursive: true });
  zip.extractAllTo(targetDir, true);
  return targetDir;
}

async function runBuild(deps: CaptureRunnerDeps, buildId: string, reqId: string | undefined, active: ActiveRun): Promise<void> {
  const { build, project } = await loadTarget(deps, buildId);
  const storybookDir = await extractStorybook(deps, project.id, build.id);
  const server = await createStaticServer(storybookDir);
  const browser = await chromium.launch();
  active.browser = browser;
  const adapter = new StorybookAdapter();
  const ctx: ScreenshotContext = { browser, adapter, baseUrl: server.url };
  const builds = new BuildModel(deps.db);
  const logger = deps.logger?.child({ buildId, reqId });

  try {
    await builds.setStatus(build.id, "capturing");
    await runCapture({
      db: deps.db,
      storage: deps.storage,
      project,
      build,
      storybookDir,
      viewports: DEFAULT_VIEWPORTS,
      adapter,
      renderStory: async (story, viewport) => await captureScreenshot(ctx, story, viewport),
      logger,
    });
    if (active.cancelled) {
      await builds.setStatus(build.id, "failed");
    }
  } catch (error) {
    await builds.setStatus(build.id, "failed");
    throw error;
  } finally {
    active.browser = null;
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