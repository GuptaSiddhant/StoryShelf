import type { Logger } from "pino";
import type { CaptureRunner, RenderResult } from "../adapters/capture-runner.ts";
import type { BrowserName } from "../adapters/capture-runner.ts";
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { StorageAdapter } from "../adapters/storage.ts";
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
import { parentContext, withSpan } from "../tracing.ts";
import { DEFAULT_VIEWPORTS, isDisabledStory, isFlakyStory } from "./adapter.ts";
import type { Viewport } from "./adapter.ts";
import { partitionAffectedStories } from "./affected.ts";
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
  /** Render budget override (tests use a short fuse). */
  renderTimeoutMs?: number | undefined;
}

/** Default budget for one render call before the orchestrator cancels it. */
export const RENDER_TIMEOUT_MS = 15 * 60_000;

/** Failure error text cap (persisted rows and logs stay bounded). */
const FAILURE_ERROR_MAX = 500;

/** Render input assembled by the orchestrator for one build. */
interface RenderRequest {
  buildId: string;
  storybookDir: string;
  stories: Parameters<CaptureRunner["render"]>[0]["stories"];
  viewports: Parameters<CaptureRunner["render"]>[0]["viewports"];
  logger: Logger | undefined;
  executePlay: boolean;
  playTimeoutMs: number;
  runA11y: boolean;
  browser: BrowserName;
}

/** Cap failure error text so one chatty runner cannot flood rows and logs. */
function capFailures(result: RenderResult): RenderResult {
  return {
    captures: result.captures,
    failures: result.failures.map((failure) => ({
      ...failure,
      error:
        failure.error.length > FAILURE_ERROR_MAX
          ? failure.error.slice(0, FAILURE_ERROR_MAX)
          : failure.error,
    })),
  };
}

/** Render with a timeout; cancels the runner when the budget expires. */
async function renderWithTimeout(
  runner: CaptureRunner,
  request: RenderRequest,
  timeoutMs: number,
): Promise<RenderResult> {
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(new Error(`Render timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  timer?.unref?.();
  try {
    return capFailures(await Promise.race([runner.render(request), timeout]));
  } catch (error) {
    if (timedOut) {
      await runner.cancel(request.buildId).catch(() => {});
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
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
  /**
   * W3C `traceparent` from the enqueueing request or queue payload.
   * Continues the inbound trace instead of starting a root span.
   */
  traceparent?: string;
  /** Attempt row owning this run; when omitted no per-attempt logs are stored. */
  attempt?: CaptureAttemptRef;
  /** Recorder mirroring phase logs into the attempt's log history. */
  recordLog?: AttemptLogRecorder;
}
/**
 * Run the full capture for a build: extract, render, persist, and finalize.
 *
 * The run executes inside a `capture.job` span (continuing `input.traceparent`
 * when present) with one child span per pipeline phase.
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
  return await withSpan(
    "capture.job",
    async () => await runCapturePhases(input, options, builds, build, project),
    {
      "storyshelf.build_id": build.id,
      ...(input.reqId ? { "storyshelf.req_id": input.reqId } : {}),
      ...(input.attempt ? { "storyshelf.attempt_no": input.attempt.attemptNo } : {}),
    },
    parentContext(input.traceparent),
  );
}

/** Execute the phase pipeline inside the `capture.job` span. */
async function runCapturePhases(
  input: CaptureJobInput,
  options: CaptureJobOptions,
  builds: BuildModel,
  build: Build,
  project: Project,
): Promise<{ storyCount: number; failedCount: number }> {
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
    extractedDir = await withSpan("capture.extract", async () => {
      return await extractStorybookToScratch(
        options.storage,
        options.scratchDir,
        project.id,
        build.id,
      );
    });
    const extractDuration = performance.now() - extractStart;
    logger?.info({ durationMs: Math.round(extractDuration) }, "storybook extracted");
    await emitAttemptLog(input.recordLog, logger, "info", "storybook extracted", {
      durationMs: Math.round(extractDuration),
    });

    // Persist the extracted statics to storage so the published Storybook
    // (`storybookDir`) can be served after the scratch dir is cleaned up.
    // Copy to a const: closures below need the narrowed string type.
    const storybookDir: string = extractedDir;
    const staticsStart = performance.now();
    await withSpan("capture.persist-statics", async () => {
      await persistStorybookStatics(options.storage, storybookDir, project.id, build.id);
    });
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

    const partition = await partitionAffectedStories({
      db: options.db,
      tables: options.tables,
      projectId: project.id,
      branch: build.gitBranch,
      defaultBranch: project.gitDefaultBranch,
      stories,
      viewports,
      affectedPaths: affectedPathsFor(build),
    });
    logger?.info(
      {
        rendered: partition.render.length,
        inherited: partition.inherited.length,
        total: stories.length,
      },
      "affected capture partitioned",
    );
    await emitAttemptLog(input.recordLog, logger, "info", "affected capture partitioned", {
      rendered: partition.render.length,
      inherited: partition.inherited.length,
      total: stories.length,
    });

    const renderStart = performance.now();
    const renderTimeoutMs = options.renderTimeoutMs ?? RENDER_TIMEOUT_MS;
    const result = await withSpan(
      "capture.render",
      async () => {
        if (partition.render.length === 0) {
          return { captures: [], failures: [] };
        }
        return await renderWithTimeout(
          options.runner,
          {
            buildId: build.id,
            storybookDir,
            stories: partition.render,
            viewports,
            logger,
            executePlay: project.executePlay ?? false,
            playTimeoutMs: project.playTimeoutMs ?? 10_000,
            runA11y: project.runA11y ?? false,
            browser: browser ?? "chromium",
          },
          renderTimeoutMs,
        );
      },
      { "storyshelf.render_count": partition.render.length },
    );
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
    await withSpan("capture.persist", async () => {
      await persistCapture(
        {
          db: options.db,
          tables: options.tables,
          storage: options.storage,
          project,
          build,
          viewports,
          captures: result.captures,
          inherited: partition.inherited,
          logger,
          recordLog: input.recordLog,
          secret: options.secret,
        },
        blockingFailed,
        flakyFailed,
        a11yFailed,
      );
    });
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

/**
 * Resolve the affected import paths for a build, or `null` for full capture
 * (affected capture disabled, or no computation was posted).
 */
function affectedPathsFor(build: Build): string[] | null {
  if (!build.affectedOnly) {
    return null;
  }
  return BuildModel.affectedPaths(build);
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
