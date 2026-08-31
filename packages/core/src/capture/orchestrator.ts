import { mkdir, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

import AdmZip from "adm-zip";
import type { Logger } from "pino";

import type { CaptureRunner } from "../adapters/capture-runner.ts";
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { StorageAdapter } from "../adapters/storage.ts";
import { BuildModel } from "../models/build.ts";
import { ProjectModel } from "../models/project.ts";
import type { Build, Project } from "../schema.ts";
import { storybookZipPath } from "../utils/paths.ts";
import { persistCapture } from "./pipeline.ts";
import { StorybookAdapter } from "./storybook.ts";
import { DEFAULT_VIEWPORTS } from "./viewports.ts";
import type { Viewport } from "./adapter.ts";

/**
 * The capture orchestrator's dependencies.
 *
 * The orchestrator owns everything a capture renderer must not: loading the
 * build, extracting the uploaded archive, discovering stories, orchestrating
 * the pure renderer, and persisting snapshots/baselines/diffs.
 */
export interface CaptureJobOptions {
  /** Database adapter. */
  db: DatabaseAdapter;
  /** Storage adapter holding the uploaded Storybook archive. */
  storage: StorageAdapter;
  /** Pure renderer that turns an extracted Storybook directory into screenshots. */
  runner: CaptureRunner;
  /** Base directory for extracting uploaded Storybook archives. */
  scratchDir: string;
  /** Viewports to render at (defaults to `DEFAULT_VIEWPORTS`). */
  viewports?: Viewport[];
  /** Optional logger; a scoped child is derived for the job. */
  logger?: Logger;
}

/**
 * Run a capture job for a build end to end.
 *
 * This is the server-side orchestration the `CaptureRunner` used to own
 * internally. It loads the target, sets the build capturing, extracts the
 * uploaded Storybook archive, discovers stories, delegates rendering to the
 * pure `runner`, and finally persists snapshots/diffs/baselines and finalizes
 * the build.
 *
 * @param input - The build to capture.
 * @param options - Orchestration dependencies.
 */
export async function executeCaptureJob(input: { buildId: string; reqId?: string }, options: CaptureJobOptions): Promise<void> {
  const builds = new BuildModel(options.db);
  const { build, project } = await loadTarget(options, input.buildId);
  const logger = options.logger?.child({ buildId: input.buildId, reqId: input.reqId });
  await builds.setStatus(build.id, "capturing");

  const startTime = performance.now();
  let storybookDir: string | undefined;
  try {
    const extractStart = performance.now();
    storybookDir = await extractStorybook(options, project.id, build.id);
    const extractDuration = performance.now() - extractStart;
    logger?.info({ durationMs: Math.round(extractDuration) }, "storybook extracted");

    const adapter = new StorybookAdapter();
    const stories = await adapter.discover(storybookDir);
    const viewports = options.viewports ?? DEFAULT_VIEWPORTS;

    const renderStart = performance.now();
    const result = await options.runner.render({ buildId: build.id, storybookDir, stories, viewports, logger });
    const renderDuration = performance.now() - renderStart;
    logger?.info({ durationMs: Math.round(renderDuration), storyCount: stories.length }, "stories rendered");

    const persistStart = performance.now();
    await persistCapture(
      {
        db: options.db,
        storage: options.storage,
        project,
        build,
        viewports,
        captures: result.captures,
        logger,
      },
      new Set(result.failures.map((failure) => failure.storyId)),
    );
    const persistDuration = performance.now() - persistStart;
    logger?.info({ durationMs: Math.round(persistDuration) }, "capture persisted");

    const totalDuration = performance.now() - startTime;
    logger?.info({ durationMs: Math.round(totalDuration) }, "capture completed");
  } catch (error) {
    const totalDuration = performance.now() - startTime;
    logger?.error({ durationMs: Math.round(totalDuration), err: error }, "capture failed");
    await builds.setStatus(build.id, "failed").catch((markError: unknown) => {
      logger?.error({ err: markError }, "failed to mark build failed after capture error");
    });
    throw error;
  }
}

async function loadTarget(options: CaptureJobOptions, buildId: string): Promise<{ build: Build; project: Project }> {
  const build = await new BuildModel(options.db).get(buildId);
  if (!build) {
    throw new Error(`Build not found: ${buildId}`);
  }
  const project = await new ProjectModel(options.db).get(build.projectId);
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

async function extractStorybook(options: CaptureJobOptions, projectId: string, buildId: string): Promise<string> {
  const targetDir = join(options.scratchDir, projectId, "builds", buildId, "storybook");
  const root = resolve(targetDir);
  const zip = new AdmZip(await options.storage.read(storybookZipPath(projectId, buildId)));
  assertNoTraversal(zip, root);
  await rm(targetDir, { recursive: true, force: true });
  await mkdir(targetDir, { recursive: true });
  zip.extractAllTo(targetDir, true);
  return targetDir;
}
