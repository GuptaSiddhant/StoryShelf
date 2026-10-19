/** The browser loop: one partition + render pass per engine, sequentially. */
import type { Logger } from "pino";
import type {
  BrowserName,
  CaptureRunner,
  RenderFailure,
  RenderedSnapshot,
} from "../adapters/capture-runner.ts";
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { StorageAdapter } from "../adapters/storage.ts";
import type { AttemptLogRecorder } from "../models/capture-attempt.ts";
import type { Build } from "../schema/build.ts";
import type { CaptureLogLevel } from "../schema/capture-attempt.ts";
import type { Project } from "../schema/project.ts";
import { screenshotPath } from "../utils/paths.ts";
import { isFlakyStory, type StoryEntry, type Viewport } from "./adapter.ts";
import { partitionAffectedStories, type InheritedStory } from "./affected.ts";
import { mirrorAttemptLog, type AttemptMirror } from "./attempt-logger.ts";
import { assertScreenshotBuffer } from "./guards.ts";
import type { PipelineTables } from "./pipeline.ts";
import { renderBudgetMs, renderWithTimeout, type RenderRequest } from "./render.ts";
import { resolveStoryViewports } from "./storybook.ts";

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
  browsers: readonly BrowserName[];
  affectedPaths: string[] | null;
  /** Explicit render budget; unset scales with the number of captures. */
  renderTimeoutMs?: number | undefined;
  logger: Logger | undefined;
  /** Records the pass on the build attempt (partitioning, progress, failures). */
  recordLog?: AttemptLogRecorder | undefined;
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

async function captureOnBrowser(input: MatrixInput, browser: BrowserName): Promise<MatrixResult> {
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
  browser: BrowserName,
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
  return await renderPass(input, browser, mirror, partition.render, inherited);
}

async function renderPass(
  input: MatrixInput,
  browser: BrowserName,
  mirror: AttemptMirror,
  toRender: StoryEntry[],
  inherited: InheritedStory[],
): Promise<MatrixResult> {
  const spooled: RenderedSnapshot[] = [];
  const expected = toRender.flatMap((story) =>
    resolveStoryViewports(story, input.viewports),
  ).length;
  const rendered = await renderWithTimeout(
    input.runner,
    renderRequest(input, browser, toRender, spooled, { mirror, expected }),
    renderBudgetMs(expected, input.renderTimeoutMs),
  );
  mirror.log("info", "render pass finished", {
    browser,
    captured: spooled.length + rendered.captures.length,
    failed: rendered.failures.length,
    expected,
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
  browser: BrowserName,
  stories: StoryEntry[],
  spooled: RenderedSnapshot[],
  progress: { mirror: AttemptMirror; expected: number },
): RenderRequest {
  const { project, build } = input;
  return {
    onCapture: async (capture) => {
      spooled.push(await spoolCapture(input, browser, capture));
      logProgress(progress, browser, spooled.length);
    },
    buildId: build.id,
    storybookDir: input.storybookDir,
    stories,
    viewports: input.viewports,
    logger: progress.mirror.logger,
    executePlay: project.executePlay ?? false,
    playTimeoutMs: project.playTimeoutMs ?? 10_000,
    runA11y: project.runA11y ?? false,
    browser,
  };
}

/** Screenshots between progress lines on the attempt log. */
const PROGRESS_EVERY = 10;

/** Record "captured N/M" every few screenshots so a long render keeps showing movement. */
function logProgress(
  progress: { mirror: AttemptMirror; expected: number },
  browser: BrowserName,
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
  browser: BrowserName,
  capture: RenderedSnapshot,
): Promise<RenderedSnapshot> {
  assertScreenshotBuffer(capture.screenshot);
  const path = screenshotPath(
    input.project.id,
    input.build.id,
    capture.story.id,
    capture.viewportName,
    browser,
  );
  await input.storage.write(path, capture.screenshot);
  return { ...capture, browser, screenshot: EMPTY_SCREENSHOT, stored: true };
}

const EMPTY_SCREENSHOT = Buffer.alloc(0);

/** Attach the render pass's environment to each capture (rows are already private copies). */
function withEnvironment(
  captures: RenderedSnapshot[],
  environment: RenderedSnapshot["environment"],
): RenderedSnapshot[] {
  if (environment) {
    for (const capture of captures) {
      capture.environment = environment;
    }
  }
  return captures;
}

/** Copy each row with its engine (runners may reuse result objects across calls). */
function tagged<T extends { browser?: string | undefined }>(rows: T[], browser: BrowserName): T[] {
  return rows.map((row) => Object.assign({}, row, { browser }));
}
