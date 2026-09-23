import type { Logger } from "pino";
import type { CaptureRunner } from "../adapters/capture-runner.ts";
import type { BrowserName } from "../adapters/capture-runner.ts";
import type { StorageAdapter } from "../adapters/storage.ts";
import type { DatabaseAdapter } from "../db/database.ts";
import { BuildModel, type BuildTables } from "../models/build.ts";
import {
  emitAttemptLog,
  type AttemptLogRecorder,
  type CaptureAttemptTables,
} from "../models/capture-attempt.ts";
import type { CaptureLogTables } from "../models/capture-log.ts";
import { ProjectModel, type ProjectTables } from "../models/project.ts";
import type { Build } from "../schema/build.ts";
import type { Project } from "../schema/project.ts";
import { DEFAULT_VIEWPORTS, isDisabledStory, isFlakyStory } from "./adapter.ts";
import type { Viewport } from "./adapter.ts";
import { persistCapture, type PipelineTables } from "./pipeline.ts";
import { resolveViewports } from "./sizing.ts";
import { extractStorybookToScratch, persistStorybookStatics } from "./statics.ts";
import { StorybookAdapter } from "./storybook.ts";

/** Table handles required by the orchestrator. */
export type OrchestratorTables = BuildTables &
  ProjectTables &
  PipelineTables &
  CaptureAttemptTables &
  CaptureLogTables;

/** Inputs for running a capture job against a Storybook build. */
export interface CaptureJobOptions {
  db: DatabaseAdapter;
  tables: OrchestratorTables;
  storage: StorageAdapter;
  runner: CaptureRunner;
  scratchDir: string;
  viewports?: Viewport[];
  logger?: Logger;
  /** Server secret for decrypting webhook secrets at send time. */
  secret?: string | undefined;
}

/** Pointer to the attempt row owning this run's log history. */
export interface CaptureAttemptRef {
  id: string;
  attemptNo: number;
  projectId: string;
}

/** Inputs for running a capture job against a Storybook build. */
export interface CaptureJobInput {
  buildId: string;
  reqId?: string;
  /** Attempt row owning this run; when omitted no per-attempt logs are stored. */
  attempt?: CaptureAttemptRef;
  /** Recorder mirroring phase logs into the attempt's log history. */
  recordLog?: AttemptLogRecorder;
}
/**
 * Run the full capture for a build: extract, render, persist, and finalize.
 *
 * @param input - Build id plus the originating request id.
 * @param options - Adapters, scratch dir, viewports, and logger.
 * @returns Story and blocking-failure counts for the attempt row.
 */
export async function executeCaptureJob(
  input: CaptureJobInput,
  options: CaptureJobOptions,
): Promise<{ storyCount: number; failedCount: number }> {
  const builds = new BuildModel(options.db, options.tables);
  const { build, project } = await loadTarget(options, input.buildId);
  const logger = options.logger?.child({
    buildId: input.buildId,
    reqId: input.reqId,
    ...(input.attempt ? { attemptNo: input.attempt.attemptNo } : {}),
  });
  await builds.setStatus(build.id, "capturing");

  const startTime = performance.now();
  let extractedDir: string | undefined;
  try {
    const extractStart = performance.now();
    extractedDir = await extractStorybookToScratch(
      options.storage,
      options.scratchDir,
      project.id,
      build.id,
    );
    const extractDuration = performance.now() - extractStart;
    logger?.info({ durationMs: Math.round(extractDuration) }, "storybook extracted");
    await emitAttemptLog(input.recordLog, logger, "info", "storybook extracted", {
      durationMs: Math.round(extractDuration),
    });

    // Persist the extracted statics to storage so the published Storybook
    // (`storybookDir`) can be served after the scratch dir is cleaned up.
    const staticsStart = performance.now();
    await persistStorybookStatics(options.storage, extractedDir, project.id, build.id);
    logger?.info(
      { durationMs: Math.round(performance.now() - staticsStart) },
      "storybook statics persisted",
    );
    await emitAttemptLog(input.recordLog, logger, "info", "storybook statics persisted", {
      durationMs: Math.round(performance.now() - staticsStart),
    });

    const adapter = new StorybookAdapter();
    const discovered = await adapter.discover(extractedDir);
    const stories = discovered.filter((s) => !isDisabledStory(s));
    // Resolve viewports via single helper (project JSON → server override → default)
    const rawViewports = (project as unknown as { viewports?: string | null }).viewports;
    const viewports = resolveViewports(rawViewports, DEFAULT_VIEWPORTS, options.viewports);
    const browser = (project as unknown as { browser?: string }).browser as BrowserName | undefined;

    const renderStart = performance.now();
    const result = await options.runner.render({
      buildId: build.id,
      storybookDir: extractedDir,
      stories,
      viewports,
      logger,
      executePlay: project.executePlay ?? false,
      playTimeoutMs: project.playTimeoutMs ?? 10_000,
      runA11y: project.runA11y ?? false,
      browser: browser ?? "chromium",
    });
    const renderDuration = performance.now() - renderStart;
    logger?.info(
      { durationMs: Math.round(renderDuration), storyCount: stories.length },
      "stories rendered",
    );
    await emitAttemptLog(input.recordLog, logger, "info", "stories rendered", {
      durationMs: Math.round(renderDuration),
      storyCount: stories.length,
    });

    const flakyStoryIds = new Set(stories.filter((s) => isFlakyStory(s)).map((s) => s.id));
    const blockingFailed = new Set<string>();
    const flakyFailed = new Set<string>();
    const a11yFailed = new Set<string>();
    for (const f of result.failures) {
      if (f.error.startsWith("a11y:")) a11yFailed.add(f.storyId);
      else if (flakyStoryIds.has(f.storyId)) flakyFailed.add(f.storyId);
      else blockingFailed.add(f.storyId);
    }

    const persistStart = performance.now();
    await persistCapture(
      {
        db: options.db,
        tables: options.tables,
        storage: options.storage,
        project,
        build,
        viewports,
        captures: result.captures,
        logger,
        recordLog: input.recordLog,
        secret: options.secret,
      },
      blockingFailed,
      flakyFailed,
      a11yFailed,
    );
    const persistDuration = performance.now() - persistStart;
    logger?.info({ durationMs: Math.round(persistDuration) }, "capture persisted");
    await emitAttemptLog(input.recordLog, logger, "info", "capture persisted", {
      durationMs: Math.round(persistDuration),
    });

    const totalDuration = performance.now() - startTime;
    logger?.info({ durationMs: Math.round(totalDuration) }, "capture completed");
    await emitAttemptLog(input.recordLog, logger, "info", "capture completed", {
      durationMs: Math.round(totalDuration),
    });
    return { storyCount: stories.length, failedCount: blockingFailed.size };
  } catch (error) {
    const totalDuration = performance.now() - startTime;
    logger?.error({ durationMs: Math.round(totalDuration), err: error }, "capture failed");
    await emitAttemptLog(input.recordLog, logger, "error", "capture failed", {
      durationMs: Math.round(totalDuration),
    });
    await builds.setStatus(build.id, "failed").catch((markError: unknown) => {
      logger?.error({ err: markError }, "failed to mark build failed after capture error");
    });
    throw error;
  }
}

async function loadTarget(
  options: CaptureJobOptions,
  buildId: string,
): Promise<{ build: Build; project: Project }> {
  const build = await new BuildModel(options.db, options.tables).get(buildId);
  if (!build) {
    throw new Error(`Build not found: ${buildId}`);
  }
  const project = await new ProjectModel(options.db, options.tables).get(build.projectId);
  if (!project) {
    throw new Error(`Project not found: ${build.projectId}`);
  }
  return { build, project };
}
