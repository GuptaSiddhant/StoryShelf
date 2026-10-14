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
import type { Build } from "../schema/build.ts";
import type { Project } from "../schema/project.ts";
import { screenshotPath } from "../utils/paths.ts";
import type { StoryEntry, Viewport } from "./adapter.ts";
import { partitionAffectedStories, type InheritedStory } from "./affected.ts";
import { assertScreenshotBuffer } from "./guards.ts";
import type { PipelineTables } from "./pipeline.ts";
import { renderBudgetMs, renderWithTimeout, type RenderRequest } from "./render.ts";

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
  input.logger?.info(
    {
      browser,
      rendered: partition.render.length,
      inherited: partition.inherited.length,
      total: input.stories.length,
    },
    "affected capture partitioned",
  );
  const inherited = tagged(partition.inherited, browser);
  if (partition.render.length === 0) {
    return { captures: [], failures: [], inherited, renderCount: 0 };
  }
  const spooled: RenderedSnapshot[] = [];
  const rendered = await renderWithTimeout(
    input.runner,
    renderRequest(input, browser, partition.render, spooled),
    renderBudgetMs(partition.render.length * input.viewports.length, input.renderTimeoutMs),
  );
  return {
    captures: [...spooled, ...tagged(rendered.captures, browser)],
    failures: tagged(rendered.failures, browser),
    inherited,
    renderCount: partition.render.length,
  };
}

/** The render call for one engine; captures stream into `spooled` as they are taken. */
function renderRequest(
  input: MatrixInput,
  browser: BrowserName,
  stories: StoryEntry[],
  spooled: RenderedSnapshot[],
): RenderRequest {
  const { project, build } = input;
  return {
    onCapture: async (capture) => {
      spooled.push(await spoolCapture(input, browser, capture));
    },
    buildId: build.id,
    storybookDir: input.storybookDir,
    stories,
    viewports: input.viewports,
    logger: input.logger,
    executePlay: project.executePlay ?? false,
    playTimeoutMs: project.playTimeoutMs ?? 10_000,
    runA11y: project.runA11y ?? false,
    browser,
  };
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

/** Copy each row with its engine (runners may reuse result objects across calls). */
function tagged<T extends { browser?: string | undefined }>(rows: T[], browser: BrowserName): T[] {
  return rows.map((row) => Object.assign({}, row, { browser }));
}
