/** The browser loop: one partition + render pass per engine, sequentially. */
import { currentImageEngine } from "@storyshelf/image";
import type { Logger } from "pino";
import type {
  CaptureRunner,
  CaptureTarget,
  RenderFailure,
  RenderedSnapshot,
} from "../adapters/capture-runner.ts";
import { TargetLaunchError } from "../adapters/capture-target.ts";
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { StorageAdapter } from "../adapters/storage.ts";
import type { AttemptLogRecorder } from "../models/capture-attempt.ts";
import type { Build } from "../schema/build.ts";
import type { CaptureLogLevel } from "../schema/capture-attempt.ts";
import type { Project } from "../schema/project.ts";
import { storeScreenshot } from "../utils/screenshot-store.ts";
import { isFlakyStory, type StoryEntry, type Viewport } from "./adapter.ts";
import { partitionAffectedStories, type InheritedStory } from "./affected.ts";
import { mirrorAttemptLog, type AttemptMirror } from "./attempt-logger.ts";
import { primaryTargetOf, resolveBrowsers } from "./browsers.ts";
import { assertScreenshotBuffer } from "./guards.ts";
import { renderIsolating, type IsolationNote, type PassOutcome } from "./isolate.ts";
import type { PipelineTables } from "./pipeline.ts";
import type { CaptureProgress } from "./progress.ts";
import type { RenderRequest } from "./render.ts";
import type { EngineWork } from "./shard-plan.ts";
import type { StorybookUrlSource } from "./storybook-urls.ts";
import { resolveStoryViewports } from "./storybook.ts";
import { renderInSlices, SignedUrlLifetimeError } from "./token-chunks.ts";

/** Inputs shared by every engine's pass. */
export interface MatrixInput {
  db: DatabaseAdapter;
  storage: StorageAdapter;
  tables: PipelineTables;
  runner: CaptureRunner;
  build: Build;
  project: Project;
  stories: StoryEntry[];
  viewports: Viewport[];
  storybookDir: string;
  browsers: readonly CaptureTarget[];
  affectedPaths: string[] | null;
  /** Explicit render budget; unset scales with the number of captures. */
  renderTimeoutMs?: number | undefined;
  logger: Logger | undefined;
  /** Records the pass on the build attempt (partitioning, progress, failures). */
  recordLog?: AttemptLogRecorder | undefined;
  /** Called on every screenshot taken, so a long healthy render keeps its job's lease. */
  progress?: CaptureProgress | undefined;
  /**
   * Handle for this job's render calls, so cancelling it reaches only them: the shard id when
   * rendering a shard (sibling shards of one build render at once), the build id otherwise.
   */
  runId?: string | undefined;
  /** The shard's 1-based position in the plan, passed to the runner; absent outside a shard. */
  shardIndex?: number | undefined;
  /** Mints the signed URL for a `reach: "url"` target at the start of each pass. */
  storybookUrl?: StorybookUrlSource | undefined;
}

/** Everything the passes produced, every row tagged with its engine. */
export interface MatrixResult {
  captures: RenderedSnapshot[];
  failures: RenderFailure[];
  inherited: InheritedStory[];
  /** Stories rendered, summed over engines. */
  renderCount: number;
}

/**
 * Capture every story on every engine, one engine at a time (browsers are
 * heavy; parallel launches would multiply memory). Each engine resolves its
 * own baselines, so affected capture inherits per engine.
 */
export async function captureAcrossBrowsers(input: MatrixInput): Promise<MatrixResult> {
  const result: MatrixResult = { captures: [], failures: [], inherited: [], renderCount: 0 };
  for (const browser of input.browsers) {
    // oxlint-disable-next-line no-await-in-loop -- engines run sequentially by design
    const pass = await captureOnBrowser(input, browser);
    result.captures.push(...pass.captures);
    result.failures.push(...pass.failures);
    result.inherited.push(...pass.inherited);
    result.renderCount += pass.renderCount;
  }
  return result;
}

/** Which stories each engine renders and which inherit their baseline, decided before any render. */
export interface PartitionedWork {
  work: EngineWork[];
  inherited: InheritedStory[];
}

/**
 * Affected-capture partitioning for every engine, without rendering: the plan stage of a sharded
 * capture decides what to render (and how to slice it) before any browser starts.
 */
export async function partitionBrowsers(input: MatrixInput): Promise<PartitionedWork> {
  const { project, build } = input;
  const work: EngineWork[] = [];
  const inherited: InheritedStory[] = [];
  for (const browser of input.browsers) {
    // oxlint-disable-next-line no-await-in-loop -- one engine at a time, like the render loop
    const partition = await partitionAffectedStories({
      db: input.db,
      tables: input.tables,
      projectId: project.id,
      branch: build.gitBranch,
      defaultBranch: project.gitDefaultBranch,
      stories: input.stories,
      viewports: input.viewports,
      browser,
      affectedPaths: input.affectedPaths,
    });
    work.push({ browser, stories: partition.render });
    inherited.push(...tagged(partition.inherited, browser));
  }
  return { work, inherited };
}

/**
 * Render explicit per-engine work (one shard's slice), engine by engine. Nothing is inherited here.
 *
 * A story that crashes the browser is narrowed down and failed on its own, so it does not take the
 * rest of the slice with it — see {@link renderIsolating}.
 */
export async function renderWork(
  input: MatrixInput,
  work: readonly EngineWork[],
): Promise<MatrixResult> {
  const result: MatrixResult = { captures: [], failures: [], inherited: [], renderCount: 0 };
  for (const engine of work) {
    const mirror = mirrorAttemptLog(input.logger, input.recordLog, flakyDowngrade(input.stories));
    try {
      // oxlint-disable-next-line no-await-in-loop -- engines run sequentially by design
      const pass = await isolatedPass(input, engine.browser, mirror, engine.stories, []);
      result.captures.push(...pass.captures);
      result.failures.push(...pass.failures);
      result.renderCount += pass.renderCount;
    } finally {
      // oxlint-disable-next-line no-await-in-loop -- flush before the next engine starts
      await mirror.flush();
    }
  }
  return result;
}

/**
 * One engine's render, with a crashing story narrowed down and failed on its own rather than taking
 * the rest of the pass with it — see {@link renderIsolating}.
 */
async function isolatedPass(
  input: MatrixInput,
  browser: CaptureTarget,
  mirror: AttemptMirror,
  toRender: StoryEntry[],
  inherited: InheritedStory[],
): Promise<MatrixResult> {
  const pass = await renderIsolating(
    toRender,
    async (slice) => await attemptPass(input, browser, mirror, slice),
    {
      note: isolationNote(mirror, browser),
      viewportsOf: (story) =>
        resolveStoryViewports(story, input.viewports).map((viewport) => viewport.name),
    },
  );
  return {
    captures: fillEnvironment(pass.captures),
    failures: pass.failures,
    inherited,
    renderCount: pass.renderCount,
  };
}

/** One render pass that never throws: a crash comes back beside whatever it captured first. */
async function attemptPass(
  input: MatrixInput,
  browser: CaptureTarget,
  mirror: AttemptMirror,
  stories: StoryEntry[],
): Promise<PassOutcome> {
  const spooled: RenderedSnapshot[] = [];
  try {
    const pass = await renderPass(input, browser, mirror, stories, [], spooled);
    return { captures: pass.captures, failures: pass.failures };
  } catch (error) {
    // The browser never started, or the signed URL lifetime cannot fit the pass: no story is at
    // fault, so it is not isolated or retried.
    if (error instanceof TargetLaunchError || error instanceof SignedUrlLifetimeError) {
      throw error;
    }
    mirror.log("warn", "render pass crashed, isolating the story at fault", {
      browser,
      stories: stories.length,
      captured: spooled.length,
      err: error instanceof Error ? error.message : String(error),
    });
    return { captures: spooled, failures: [], error };
  }
}

/** Record how a crash was narrowed down on the attempt log. */
function isolationNote(mirror: AttemptMirror, browser: CaptureTarget): IsolationNote {
  return (event, fields) => {
    if (event === "poisoned") {
      mirror.log("error", "story crashed the browser on its own", { browser, ...fields });
      return;
    }
    const message =
      event === "isolating"
        ? "retrying the stories a crash interrupted"
        : "giving up on the stories left after repeated crashes";
    mirror.log("warn", message, { browser, ...fields });
  };
}

/**
 * Give captures spooled before a crash the environment a later pass reported: every pass of an
 * engine runs on the same browser build and host, so the one fingerprint covers them all.
 */
function fillEnvironment(captures: RenderedSnapshot[]): RenderedSnapshot[] {
  const known = captures.find((capture) => capture.environment)?.environment;
  if (!known) {
    return captures;
  }
  for (const capture of captures) {
    capture.environment ??= known;
  }
  return captures;
}

async function captureOnBrowser(input: MatrixInput, browser: CaptureTarget): Promise<MatrixResult> {
  const mirror = mirrorAttemptLog(input.logger, input.recordLog, flakyDowngrade(input.stories));
  try {
    return await passOnBrowser(input, browser, mirror);
  } finally {
    await mirror.flush();
  }
}

/**
 * Failures of flaky stories are non-blocking, so the attempt log shows them as
 * warnings (matching "flaky story failed (non-blocking)"), not errors.
 */
function flakyDowngrade(
  stories: StoryEntry[],
): (level: CaptureLogLevel, fields?: Record<string, unknown>) => CaptureLogLevel {
  const flaky = new Set(stories.filter((story) => isFlakyStory(story)).map((story) => story.id));
  return (level, fields) =>
    level === "error" && typeof fields?.["storyId"] === "string" && flaky.has(fields["storyId"])
      ? "warn"
      : level;
}

async function passOnBrowser(
  input: MatrixInput,
  browser: CaptureTarget,
  mirror: AttemptMirror,
): Promise<MatrixResult> {
  const { project, build } = input;
  const partition = await partitionAffectedStories({
    db: input.db,
    tables: input.tables,
    projectId: project.id,
    branch: build.gitBranch,
    defaultBranch: project.gitDefaultBranch,
    stories: input.stories,
    viewports: input.viewports,
    browser,
    affectedPaths: input.affectedPaths,
  });
  mirror.log("info", "affected capture partitioned", {
    browser,
    rendered: partition.render.length,
    inherited: partition.inherited.length,
    total: input.stories.length,
  });
  const inherited = tagged(partition.inherited, browser);
  if (partition.render.length === 0) {
    return { captures: [], failures: [], inherited, renderCount: 0 };
  }
  return await isolatedPass(input, browser, mirror, partition.render, inherited);
}

/**
 * One engine's render call. `spooled` may be supplied by the caller so that the screenshots taken
 * before a crash survive the throw (they stream in through `onCapture`).
 */
async function renderPass(
  input: MatrixInput,
  browser: CaptureTarget,
  mirror: AttemptMirror,
  toRender: StoryEntry[],
  inherited: InheritedStory[],
  spooled: RenderedSnapshot[] = [],
): Promise<MatrixResult> {
  const expected = toRender.flatMap((story) =>
    resolveStoryViewports(story, input.viewports),
  ).length;
  const rendered = await renderInSlices({
    runner: input.runner,
    request: renderRequest(input, browser, toRender, spooled, { mirror, expected }),
    browser,
    storybookUrl: input.storybookUrl,
    captureCount: (story) => resolveStoryViewports(story, input.viewports).length,
    renderTimeoutMs: input.renderTimeoutMs,
  });
  mirror.log("info", "render pass finished", {
    browser,
    captured: spooled.length + rendered.captures.length,
    failed: rendered.failures.length,
    expected,
    imageEngine: currentImageEngine(),
  });
  const { environment } = rendered;
  return {
    captures: withEnvironment([...spooled, ...tagged(rendered.captures, browser)], environment),
    failures: tagged(rendered.failures, browser),
    inherited,
    renderCount: toRender.length,
  };
}

/** The render call for one engine; captures stream into `spooled` as they are taken. */
function renderRequest(
  input: MatrixInput,
  browser: CaptureTarget,
  stories: StoryEntry[],
  spooled: RenderedSnapshot[],
  progress: { mirror: AttemptMirror; expected: number },
): RenderRequest {
  const { project, build } = input;
  return {
    onCapture: async (capture) => {
      spooled.push(await spoolCapture(input, browser, capture));
      input.progress?.();
      logProgress(progress, browser, spooled.length);
    },
    buildId: build.id,
    runId: input.runId ?? build.id,
    ...(input.shardIndex === undefined ? {} : { shardIndex: input.shardIndex }),
    storybookDir: input.storybookDir,
    stories,
    viewports: input.viewports,
    logger: progress.mirror.logger,
    executePlay: project.executePlay ?? false,
    playTimeoutMs: project.playTimeoutMs ?? 10_000,
    runA11y: (project.runA11y ?? true) && browser === primaryTargetOf(resolveBrowsers(project)),
    target: browser,
  };
}

/** Screenshots between progress lines on the attempt log. */
const PROGRESS_EVERY = 10;

/** Record "captured N/M" every few screenshots so a long render keeps showing movement. */
function logProgress(
  progress: { mirror: AttemptMirror; expected: number },
  browser: CaptureTarget,
  captured: number,
): void {
  if (captured % PROGRESS_EVERY !== 0) return;
  progress.mirror.log("info", `captured ${captured}/${progress.expected} screenshots`, {
    browser,
    captured,
    expected: progress.expected,
  });
}

/**
 * Write a screenshot to storage the moment it is captured and keep only its
 * metadata, so memory holds the pages in flight rather than the whole build.
 */
async function spoolCapture(
  input: MatrixInput,
  browser: CaptureTarget,
  capture: RenderedSnapshot,
): Promise<RenderedSnapshot> {
  assertScreenshotBuffer(capture.screenshot);
  const storedPath = await storeScreenshot(input.storage, input.project.id, capture.screenshot);
  return { ...capture, browser, screenshot: EMPTY_SCREENSHOT, stored: true, storedPath };
}

const EMPTY_SCREENSHOT = Buffer.alloc(0);

/** Attach the render pass's environment to captures that carry none (a slice may have set its own). */
function withEnvironment(
  captures: RenderedSnapshot[],
  environment: RenderedSnapshot["environment"],
): RenderedSnapshot[] {
  if (environment) {
    for (const capture of captures) {
      capture.environment ??= environment;
    }
  }
  return captures;
}

/** Copy each row with its engine (runners may reuse result objects across calls). */
function tagged<T extends { browser?: string | undefined }>(
  rows: T[],
  browser: CaptureTarget,
): T[] {
  return rows.map((row) => Object.assign({}, row, { browser }));
}
