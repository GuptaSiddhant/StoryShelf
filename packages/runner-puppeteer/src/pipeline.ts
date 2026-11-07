/** Render orchestration: static server, browser, and per-story captures. */

import {
  TargetLaunchError,
  engineOf,
  logRemoteSizing,
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
  errorText,
  isTimeoutError,
  sessionGateFor,
  storybookBase,
  type SessionGate,
} from "@storyshelf/core/utils";
import type { Browser } from "puppeteer-core";
import { abortIfCancelled, finishing, messageOf, outcomeOf, safeCloseServer } from "./browser.ts";
import { PagePool } from "./pages.ts";
import { measureRemote } from "./remote-environment.ts";
import { RemoteBrowserLostError, browserLost } from "./remote-loss.ts";
import { createRuntimeParamsState } from "./runtime-params.ts";
import { captureScreenshot } from "./screenshot.ts";
import { createBrowserSession, type BrowserSession } from "./session.ts";
import { createStaticServer } from "./static-server.ts";
import type {
  ActiveRun,
  CaptureContext,
  LaunchContext,
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
  const relaunch = async (): Promise<BrowserSession> =>
    createBrowserSession(
      await driver.launch(
        name,
        input.logger,
        launchContextOf(input, "render", active.abort?.signal),
      ),
    );
  // Launch first: a target that will not start must fail before a static server is bound.
  const session = await relaunch();
  active.session = session;
  await abortIfCancelled(active, session);
  let server: Serving | undefined;
  let ctx: CaptureContext | undefined;
  return await finishing(
    async () => {
      server = await serve(input, session);
      logHostSizing(input, name, remote);
      // Measured while the browser is open: Puppeteer cannot read the version of a closed one.
      const environment = await measureEnvironment(session, remote, input, active.abort?.signal);
      ctx = buildContext(session, server.url, input);
      const { captures, failures } = await runCaptures(input, active, ctx, relaunch);
      // Echo the target so persisted rows are attributable without the request.
      for (const row of [...captures, ...failures]) row.browser = name;
      return { captures, failures, environment };
    },
    async (failed, error) => {
      await ctx?.pagePool?.dispose();
      const current = active.session ?? session;
      active.session = null;
      await Promise.all([current.release(outcomeOf(active, failed), error), closeServer(server)]);
    },
  );
}

async function closeServer(server: Serving | undefined): Promise<void> {
  if (server !== undefined) await safeCloseServer(server);
}

/** What a remote service's `connect` is told about the run a browser is for. */
export function launchContextOf(
  input: { buildId: string; runId?: string | undefined; shardIndex?: number | undefined },
  purpose: LaunchContext["purpose"],
  signal?: AbortSignal,
): LaunchContext {
  return {
    buildId: input.buildId,
    runId: input.runId ?? input.buildId,
    shardIndex: input.shardIndex,
    purpose,
    signal,
  };
}

/** The input with its target resolved, and the session gate when the target is remote. */
export function planRun<
  T extends {
    target?: CaptureTarget | undefined;
    concurrency?: number | undefined;
    logger?: PuppeteerRenderInput["logger"];
  },
>(
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
  const gate =
    remote &&
    sessionGateFor(name, remote.remote.sessions, (value) => {
      rawInput.logger?.warn(
        { target: name, value: String(value) },
        "sessions() returned an invalid value; keeping the last good one",
      );
    });
  if (remote) {
    logRemoteSizing(rawInput.logger, name, remote.remote, {
      gate,
      concurrency: rawInput.concurrency,
      pagesPerConnection: false,
    });
  }
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
    throw new TargetLaunchError(target, error instanceof Error ? error.message : errorText(error));
  }
}

/** The loopback server, or the URL given; a server that cannot start releases the browser it was for. */
export async function serve(
  input: Pick<RunInput, "storybookDir" | "storybookUrl">,
  session: BrowserSession,
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
    await session.release("failed", error);
    throw error;
  });
}

/** This host's environment: a local browser renders on the machine the runner runs on. */
async function measureEnvironment(
  session: BrowserSession,
  remote: RemoteTarget | undefined,
  input: RunInput,
  signal: AbortSignal | undefined,
): Promise<CaptureEnvironment> {
  if (remote) return await measureRemote(session, remote.remote, { logger: input.logger, signal });
  const browser: Browser = session.browser;
  const version = typeof browser.version === "function" ? await browser.version() : undefined;
  return await detectCaptureEnvironment(version);
}

async function runCaptures(
  input: RunInput,
  active: ActiveRun,
  ctx: CaptureContext,
  relaunch: () => Promise<BrowserSession>,
): Promise<Pick<RenderResult, "captures" | "failures">> {
  const captures: RenderedSnapshot[] = [];
  const failures: RenderResult["failures"] = [];
  await runAllCaptures(input, active, ctx, captures, failures, relaunch);
  return { captures, failures };
}

function buildContext(
  session: BrowserSession,
  baseUrl: string,
  input: PuppeteerRenderInput,
): CaptureContext {
  return {
    session,
    adapter: input.adapter ?? new StorybookAdapter(),
    baseUrl,
    navigationTimeoutMs: input.navigationTimeoutMs,
    executePlay: input.executePlay,
    playTimeoutMs: input.playTimeoutMs,
    runA11y: input.runA11y,
    ...(input.logger ? { logger: input.logger } : {}),
    runtimeParams: createRuntimeParamsState(),
    ...(input.reusePages ? { pagePool: new PagePool(session) } : {}),
  };
}

async function runAllCaptures(
  input: RunInput,
  active: ActiveRun,
  ctx: CaptureContext,
  captures: RenderedSnapshot[],
  failures: RenderResult["failures"],
  relaunch: () => Promise<BrowserSession>,
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
  } catch (error) {
    if (error instanceof RemoteBrowserLostError) {
      input.logger?.warn(
        { target: input.target },
        "remote browser lost; ending the pass so the job can be retried",
      );
    }
    throw error;
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
    relaunch: () => Promise<BrowserSession>;
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

/** Swap in a fresh browser; the old one is released first so two never coexist. */
async function recycleBrowser(
  active: ActiveRun,
  ctx: CaptureContext,
  relaunch: () => Promise<BrowserSession>,
  logger: PuppeteerRenderInput["logger"],
): Promise<void> {
  assertNotCancelled(active);
  await ctx.pagePool?.dispose();
  const previous = ctx.session;
  await previous.release(active.cancelled ? "cancelled" : "finished");
  assertNotCancelled(active);
  await acquireReplacement(active, ctx, relaunch);
  logger?.info({}, "browser recycled");
}

function assertNotCancelled(active: ActiveRun): void {
  if (active.cancelled) throw new Error("Capture cancelled");
}

async function acquireReplacement(
  active: ActiveRun,
  ctx: CaptureContext,
  relaunch: () => Promise<BrowserSession>,
): Promise<BrowserSession> {
  const next = await relaunch();
  if (active.cancelled) {
    await next.release("cancelled");
    throw new Error("Capture cancelled");
  }
  ctx.session = next;
  if (ctx.pagePool) ctx.pagePool = new PagePool(next);
  active.session = next;
  return next;
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
  // A lost remote browser ends the pass: nothing more is scheduled on it, and nothing after the
  // drop is recorded as a story failure.
  if (lost(active, ctx)) throw new RemoteBrowserLostError();
  try {
    await pushCapture(ctx, story, viewport, out.captures, out.failures, input);
    return false;
  } catch (error) {
    if (lost(active, ctx)) throw new RemoteBrowserLostError();
    pushRenderFailure(out.failures, input, story.id, viewport.name, error);
    return isTimeoutError(error);
  }
}

/** Whether the run drives someone else's browser (a remote one) and it has disconnected. */
function lost(active: ActiveRun, ctx: CaptureContext): boolean {
  return browserLost(
    ctx.session.ownership === "connected",
    active,
    () => ctx.session.browser.connected,
  );
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

/** The host's sizing of a capture; a remote target runs elsewhere, so nothing is measured here. */
function logHostSizing(
  input: { logger?: PuppeteerRenderInput["logger"]; concurrency?: number | undefined },
  name: CaptureTarget,
  remote: RemoteTarget | undefined,
): void {
  if (!remote) {
    input.logger?.info(describeSizing({ ...input, browser: engineOf(name) }), "capture sizing");
  }
}
