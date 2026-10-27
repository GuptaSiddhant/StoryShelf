/** Render orchestration: static server, browser, and per-story captures. */

import {
  TargetLaunchError,
  engineOf,
  type CaptureEnvironment,
  type CaptureTarget,
  type RemoteTarget,
  type RenderResult,
  type RenderedSnapshot,
  type StoryEntry,
  type StorySourceAdapter,
  type Viewport,
} from "@storyshelf/core/adapter/capture-runner";
import { StorybookAdapter, resolveStoryViewports } from "@storyshelf/core/capture";
import type { StoryParameters } from "@storyshelf/core/capture";
import {
  DEFAULT_RECYCLE_BROWSER_EVERY,
  chunk,
  describeSizing,
  createPageLimiter,
  detectCaptureEnvironment,
  isTimeoutError,
  sessionGateFor,
  storybookBase,
  type SessionGate,
} from "@storyshelf/core/utils";
import type { Browser } from "playwright-core";
import { finishing, messageOf, outcomeOf, safeCloseBrowser, safeCloseServer } from "./browser.ts";
import { PagePool } from "./pages.ts";
import { measureRemote } from "./remote-environment.ts";
import { createRuntimeParamsState, extractAllParameters } from "./runtime-params.ts";
import { captureScreenshot } from "./screenshot.ts";
import { createStaticServer } from "./static-server.ts";
import type {
  ActiveRun,
  CaptureContext,
  ExtractInput,
  PlaywrightRenderInput,
  RunInput,
  RuntimeParamsPage,
  LaunchContext,
  TargetDriver,
} from "./types.ts";

/** Where the browser finds the Storybook: the loopback server, or the URL core handed over. */
interface Serving {
  url: string;
  close(): Promise<void>;
}

/** Render all story/viewport combinations for a build. */
export async function renderAll(
  rawInput: PlaywrightRenderInput,
  active: ActiveRun,
  driver: TargetDriver,
  defaultTarget: CaptureTarget,
): Promise<RenderResult> {
  const { input, name, remote } = planRun(rawInput, driver, defaultTarget);
  assertReachable(name, remote, input.storybookUrl);
  // Launch first: a target that will not start must fail before a static server is bound.
  const launch = async (): Promise<Browser> =>
    await driver.launch(name, input.logger, launchContextOf(input));
  const browser = await launch();
  const server = await serve(input, browser);
  input.logger?.info(describeSizing({ ...input, browser: engineOf(name) }), "capture sizing");
  const measured = remote
    ? await measureRemote(browser, remote.remote, input.logger).catch(async (error: unknown) => {
        await Promise.all([safeCloseBrowser(browser, "failed"), safeCloseServer(server)]);
        throw error;
      })
    : undefined;
  const result = await runWithBrowser(input, active, browser, server, launch);
  // Echo the target so persisted rows are attributable without the request.
  for (const row of [...result.captures, ...result.failures]) row.browser = name;
  return { ...result, environment: measured ?? (await localEnvironment(browser)) };
}

/** What a remote service's `acquire` is told about the run a browser is for. */
export function launchContextOf(input: {
  buildId: string;
  shardIndex?: number | undefined;
}): LaunchContext {
  return { buildId: input.buildId, shardIndex: input.shardIndex };
}

/** The input with its target resolved, and the session gate when the target is remote. */
export function planRun<T extends { target?: CaptureTarget | undefined }>(
  rawInput: T,
  driver: TargetDriver,
  defaultTarget: CaptureTarget,
): {
  input: T & { target: CaptureTarget; gate?: SessionGate | undefined };
  name: CaptureTarget;
  remote: RemoteTarget | undefined;
} {
  const name = rawInput.target ?? defaultTarget;
  const remote = driver.remote(name);
  const gate = remote && sessionGateFor(name, remote.remote.sessions);
  return { input: { ...rawInput, target: name, gate }, name, remote };
}

/**
 * Load the preview once and read every story's resolved parameters
 * (`__STORYBOOK_PREVIEW__.extract()`), so the orchestrator can plan modes.
 */
export async function extractAll(
  input: ExtractInput,
  driver: TargetDriver,
  defaultTarget: CaptureTarget,
): Promise<Record<string, StoryParameters>> {
  const first = input.stories[0];
  if (!first) return {};
  const name = input.target ?? defaultTarget;
  assertReachable(name, driver.remote(name), input.storybookUrl);
  const browser = await driver.launch(name, input.logger, launchContextOf(input));
  const server = await serve(input, browser);
  return await finishing(
    async () => await readParameters(browser, server.url, first.id, input.adapter),
    async (failed) => {
      await Promise.all([
        safeCloseBrowser(browser, failed ? "failed" : "finished"),
        safeCloseServer(server),
      ]);
    },
  );
}

/** A target whose browser cannot route back to this host needs a URL; failing here names why. */
export function assertReachable(
  target: CaptureTarget,
  remote: RemoteTarget | undefined,
  storybookUrl: string | undefined,
): void {
  if (remote?.reach === "url" && storybookUrl === undefined) {
    throw new TargetLaunchError(
      target,
      "its browser cannot reach this host, so it needs a Storybook URL (a public origin and a secret to sign it) and none was given",
      { transient: true },
    );
  }
  if (storybookUrl !== undefined) {
    assertStorybookRoot(target, storybookUrl);
  }
}

/** The URL must be the build's directory root; refused before any browser connects. */
function assertStorybookRoot(target: CaptureTarget, storybookUrl: string): void {
  try {
    storybookBase(storybookUrl);
  } catch (error) {
    throw new TargetLaunchError(target, error instanceof Error ? error.message : String(error));
  }
}

/** The loopback server, or the URL given; a server that cannot start closes the browser it was for. */
export async function serve(
  input: Pick<RunInput, "storybookDir" | "storybookUrl">,
  browser: Browser,
): Promise<Serving> {
  if (input.storybookUrl !== undefined) {
    return {
      url: storybookBase(input.storybookUrl),
      close: async () => {
        await Promise.resolve();
      },
    };
  }
  return await createStaticServer(input.storybookDir).catch(async (error: unknown) => {
    await safeCloseBrowser(browser, "failed");
    throw error;
  });
}

async function readParameters(
  browser: Browser,
  baseUrl: string,
  storyId: string,
  custom: StorySourceAdapter | undefined,
): Promise<Record<string, StoryParameters>> {
  const adapter: StorySourceAdapter = custom ?? new StorybookAdapter();
  const page = await browser.newPage();
  await page.goto(adapter.buildUrl(baseUrl, storyId), { waitUntil: "networkidle" });
  await adapter.waitForReady?.(page);
  return await extractAllParameters(page as unknown as RuntimeParamsPage);
}

/** The driver's browser version; undefined for a driver (or test double) that does not report one. */
function browserVersionOf(browser: Browser): string | undefined {
  return typeof browser.version === "function" ? browser.version() : undefined;
}

/** This host's environment: a local browser renders on the machine the runner runs on. */
async function localEnvironment(browser: Browser): Promise<CaptureEnvironment> {
  return await detectCaptureEnvironment(browserVersionOf(browser));
}

async function runWithBrowser(
  input: RunInput,
  active: ActiveRun,
  browser: Browser,
  server: Serving,
  relaunch: () => Promise<Browser>,
): Promise<RenderResult> {
  active.browser = browser;
  const ctx = buildContext(browser, server.url, input);
  const captures: RenderedSnapshot[] = [];
  const failures: RenderResult["failures"] = [];
  return await finishing(
    async () => {
      await runAllCaptures(input, active, ctx, captures, failures, relaunch);
      return { captures, failures };
    },
    async (failed) => {
      active.browser = null;
      await ctx.pagePool?.dispose();
      // ctx.browser is the latest one: recycling replaces the browser mid-run.
      await Promise.all([
        safeCloseBrowser(ctx.browser, outcomeOf(active, failed)),
        safeCloseServer(server),
      ]);
    },
  );
}

function buildContext(
  browser: Browser,
  baseUrl: string,
  input: PlaywrightRenderInput,
): CaptureContext {
  return {
    browser,
    adapter: input.adapter ?? new StorybookAdapter(),
    baseUrl,
    navigationTimeoutMs: input.navigationTimeoutMs,
    executePlay: input.executePlay,
    playTimeoutMs: input.playTimeoutMs,
    runA11y: input.runA11y,
    ...(input.logger ? { logger: input.logger } : {}),
    runtimeParams: createRuntimeParamsState(),
    ...(input.reusePages ? { pagePool: new PagePool(browser) } : {}),
  };
}

async function runAllCaptures(
  input: RunInput,
  active: ActiveRun,
  ctx: CaptureContext,
  captures: RenderedSnapshot[],
  failures: RenderResult["failures"],
  relaunch: () => Promise<Browser>,
): Promise<void> {
  // Bounded: one page per story x viewport all at once exhausts memory on large Storybooks.
  const jobs = input.stories.flatMap((story) =>
    resolveStoryViewports(story, input.viewports).map((viewport) => ({ story, viewport })),
  );
  // Batches drain in-flight pages, so the browser can be swapped between them.
  const batches = chunk(jobs, input.recycleBrowserEvery ?? DEFAULT_RECYCLE_BROWSER_EVERY);
  const pages = createPageLimiter({
    concurrency: input.concurrency,
    ...(input.gate === undefined ? {} : { gate: input.gate }),
    browser: engineOf(input.target ?? "chromium"),
    logger: input.logger,
  });
  try {
    await runBatches(batches, pages, input, active, ctx, { captures, failures, relaunch });
  } finally {
    pages.dispose();
  }
}

async function runBatches(
  batches: { story: StoryEntry; viewport: Viewport }[][],
  pages: ReturnType<typeof createPageLimiter>,
  input: RunInput,
  active: ActiveRun,
  ctx: CaptureContext,
  out: {
    captures: RenderedSnapshot[];
    failures: RenderResult["failures"];
    relaunch: () => Promise<Browser>;
  },
): Promise<void> {
  for (const [index, batch] of batches.entries()) {
    if (index > 0) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- recycle only between drained batches
      await recycleBrowser(active, ctx, out.relaunch, input.logger);
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- batches run one after another
    await pages.each(
      batch,
      async (job) => await captureOne(input, active, ctx, job.story, job.viewport, out),
    );
  }
}

/** Swap in a fresh browser; the old one is closed first so two never coexist. */
async function recycleBrowser(
  active: ActiveRun,
  ctx: CaptureContext,
  relaunch: () => Promise<Browser>,
  logger: PlaywrightRenderInput["logger"],
): Promise<void> {
  if (active.cancelled) throw new Error("Capture cancelled");
  await ctx.pagePool?.dispose();
  await safeCloseBrowser(ctx.browser);
  ctx.browser = await relaunch();
  if (ctx.pagePool) ctx.pagePool = new PagePool(ctx.browser);
  active.browser = ctx.browser;
  logger?.info({}, "browser recycled");
}

/** Capture one story x viewport; resolves to whether it timed out (failures are recorded, not thrown). */
async function captureOne(
  input: PlaywrightRenderInput,
  active: ActiveRun,
  ctx: CaptureContext,
  story: StoryEntry,
  viewport: Viewport,
  out: { captures: RenderedSnapshot[]; failures: RenderResult["failures"] },
): Promise<boolean> {
  if (active.cancelled) throw new Error("Capture cancelled");
  try {
    await pushCapture(ctx, story, viewport, out.captures, out.failures, input);
    return false;
  } catch (error) {
    pushRenderFailure(out.failures, input, story.id, viewport.name, error);
    return isTimeoutError(error);
  }
}

async function pushCapture(
  ctx: CaptureContext,
  story: StoryEntry,
  viewport: Viewport,
  captures: RenderedSnapshot[],
  failures: RenderResult["failures"],
  input: PlaywrightRenderInput,
): Promise<void> {
  const started = performance.now();
  const result = await captureScreenshot(ctx, story, viewport);
  const snapshot: RenderedSnapshot = {
    story: result.story,
    viewportName: viewport.name,
    viewport,
    screenshot: result.screenshot,
    durationMs: Math.round(performance.now() - started),
    ...(result.a11yViolations.length > 0 ? { a11y: result.a11yViolations } : {}),
  };
  // Streaming: hand it over and drop the buffer rather than holding every screenshot.
  if (input.onCapture) await input.onCapture(snapshot);
  else captures.push(snapshot);
  if (result.a11yViolations.length > 0)
    handleA11y(input, failures, story, viewport, result.a11yViolations);
}
function handleA11y(
  input: PlaywrightRenderInput,
  failures: RenderResult["failures"],
  story: StoryEntry,
  viewport: Viewport,
  violations: string[],
): void {
  failures.push({
    storyId: story.id,
    viewportName: viewport.name,
    error: `a11y: ${violations.join("; ")}`,
  });
  input.logger?.warn(
    { storyId: story.id, viewport: viewport.name, violations },
    "a11y violations found",
  );
}

function pushRenderFailure(
  failures: RenderResult["failures"],
  input: PlaywrightRenderInput,
  storyId: string,
  viewportName: string,
  error: unknown,
): void {
  failures.push({ storyId, viewportName, error: messageOf(error) });
  input.logger?.error({ storyId, viewport: viewportName, err: error }, "render failed for story");
}
