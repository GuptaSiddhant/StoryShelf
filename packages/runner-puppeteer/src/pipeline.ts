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
  type Viewport,
} from "@storyshelf/core/adapter/capture-runner";
import { StorybookAdapter, resolveStoryViewports } from "@storyshelf/core/capture";
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
import type { Browser } from "puppeteer-core";
import { messageOf, safeCloseBrowser, safeCloseServer } from "./browser.ts";
import { PagePool } from "./pages.ts";
import { measureRemote } from "./remote-environment.ts";
import { createRuntimeParamsState } from "./runtime-params.ts";
import { captureScreenshot } from "./screenshot.ts";
import { createStaticServer } from "./static-server.ts";
import type {
  ActiveRun,
  CaptureContext,
  PuppeteerRenderInput,
  RunInput,
  TargetDriver,
} from "./types.ts";

/** Where the browser finds the Storybook: the loopback server, or the URL core handed over. */
interface Serving {
  url: string;
  close(): Promise<void>;
}

/** Render all story/viewport combinations for a build. */
export async function renderAll(
  rawInput: PuppeteerRenderInput,
  active: ActiveRun,
  driver: TargetDriver,
  defaultTarget: CaptureTarget,
): Promise<RenderResult> {
  const { input, name, remote } = planRun(rawInput, driver, defaultTarget);
  assertReachable(name, remote, input.storybookUrl);
  // Launch first: a target that will not start must fail before a static server is bound.
  const browser = await driver.launch(name, input.logger);
  const server = await serve(input, browser);
  input.logger?.info(describeSizing({ ...input, browser: engineOf(name) }), "capture sizing");
  // Measured while the browser is open: Puppeteer cannot read the version of a closed one.
  const environment = remote
    ? await measureRemote(browser, remote.remote, input.logger)
    : await localEnvironment(browser);
  const result = await runWithBrowser(
    input,
    active,
    browser,
    server,
    async () => await driver.launch(name, input.logger),
  );
  // Echo the target so persisted rows are attributable without the request.
  for (const row of [...result.captures, ...result.failures]) row.browser = name;
  return { ...result, environment };
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
    await safeCloseBrowser(browser);
    throw error;
  });
}

/** This host's environment: a local browser renders on the machine the runner runs on. */
async function localEnvironment(browser: Browser): Promise<CaptureEnvironment> {
  const version = typeof browser.version === "function" ? await browser.version() : undefined;
  return await detectCaptureEnvironment(version);
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
  try {
    await runAllCaptures(input, active, ctx, captures, failures, relaunch);
    return { captures, failures };
  } finally {
    active.browser = null;
    await ctx.pagePool?.dispose();
    // ctx.browser is the latest one: recycling replaces the browser mid-run.
    await Promise.all([safeCloseBrowser(ctx.browser), safeCloseServer(server)]);
  }
}

function buildContext(
  browser: Browser,
  baseUrl: string,
  input: PuppeteerRenderInput,
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
  logger: PuppeteerRenderInput["logger"],
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
  input: PuppeteerRenderInput,
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
  input: PuppeteerRenderInput,
): Promise<void> {
  const result = await captureScreenshot(ctx, story, viewport);
  const snapshot: RenderedSnapshot = {
    story: result.story,
    viewportName: viewport.name,
    viewport,
    screenshot: result.screenshot,
    ...(result.a11yViolations.length > 0 ? { a11y: result.a11yViolations } : {}),
  };
  // Streaming: hand it over and drop the buffer rather than holding every screenshot.
  if (input.onCapture) await input.onCapture(snapshot);
  else captures.push(snapshot);
  if (result.a11yViolations.length > 0)
    handleA11y(input, failures, story, viewport, result.a11yViolations);
}
function handleA11y(
  input: PuppeteerRenderInput,
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
  input: PuppeteerRenderInput,
  storyId: string,
  viewportName: string,
  error: unknown,
): void {
  failures.push({ storyId, viewportName, error: messageOf(error) });
  input.logger?.error({ storyId, viewport: viewportName, err: error }, "render failed for story");
}
