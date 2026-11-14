import type { AdapterSetupContext } from "@storyshelf/core/adapter/metadata";
import {
  AdapterLifecycleError,
  bindAdapterLoggers,
  adapterSourcesOf,
  collectSetups,
  collectTeardowns,
  runAdapterSetups,
  runAdapterTeardowns,
  validateBootAssembly,
} from "@storyshelf/core/adapter/setup";
import type { AdapterSetupResult } from "@storyshelf/core/adapter/setup";
import type { CaptureConsumer } from "@storyshelf/core/capture";
import type { ResolvedShelfOptions } from "@storyshelf/core/config";
import { shutdownDiffPool, verifyImageEngine } from "@storyshelf/core/diff";
import type { Logger } from "@storyshelf/core/logger";
import { purgeAiData } from "@storyshelf/core/retention";
import { sanitizeErrorText } from "@storyshelf/core/utils";
import type { ShelfRouter, ShelfLifecycle } from "./app-types.ts";
import { settleInsightJobs } from "./insights/job.ts";
import { packageVersion } from "./package-version.ts";
import { startBranchGcTimer } from "./retention-timer.ts";
import type { ServerRuntime } from "./runtime.ts";

/** Mutable setup-settlement cell shared by the gate, health, and `setup()`. */
export interface LifecycleCell {
  ready: Promise<AdapterSetupResult>;
  settled: AdapterSetupResult | null;
  /** Fire-and-forget boot tasks (recovery, credential check) that teardown must outwait. */
  background?: Promise<unknown>[];
  /** Override of {@link BACKGROUND_DRAIN_MS} (tests). */
  drainMs?: number;
  /** The job consumer (null on hosts that run none); started once adapters are ready, drained by `teardown()`. */
  consumer?: CaptureConsumer | null;
  /** The running consumer session, settled once it was stopped and drained. */
  consumerRun?: Promise<void>;
  /** Teardown ran: the consumer stays stopped (a late "adapters are ready" must not restart it). */
  consumerStopped?: boolean;
}

/** Longest teardown waits for background boot tasks before closing adapters anyway. */
const BACKGROUND_DRAIN_MS = 5000;

/** Register a boot task so `teardown()` does not close adapters underneath it. */
export function trackBackground(cell: LifecycleCell, task: Promise<unknown>): void {
  (cell.background ??= []).push(task);
}

/** Start the job consumer once adapters are set up; a no-op when none exists or it runs. */
export function startConsumer(cell: LifecycleCell, logger: Logger): void {
  const consumer = cell.consumer;
  if (!consumer || consumer.isRunning() || cell.consumerStopped) {
    return;
  }
  cell.consumerRun = consumer.start().catch((error: unknown) => {
    logger.error({ err: error }, "job consumer stopped");
  });
}

/**
 * Stop polling and drain the jobs in flight (the SIGTERM drain): unbounded, or, given `graceMs`,
 * until the grace is spent, when the jobs left are handed back to the queue.
 */
async function stopConsumer(cell: LifecycleCell, graceMs?: number): Promise<void> {
  cell.consumerStopped = true;
  await cell.consumer?.stop(graceMs === undefined ? undefined : { graceMs });
  if (graceMs === undefined) {
    await cell.consumerRun;
  }
}

/** Wait for tracked boot tasks, bounded so a hung task can never block shutdown. */
async function drainBackground(cell: LifecycleCell): Promise<void> {
  const pending = Promise.allSettled(cell.background ?? []);
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, cell.drainMs ?? BACKGROUND_DRAIN_MS);
    timer.unref();
  });
  await Promise.race([pending, timeout]);
  clearTimeout(timer);
}

function trackSettlement(cell: LifecycleCell, promise: Promise<AdapterSetupResult>): void {
  promise.then(
    (result) => {
      cell.settled = result;
    },
    () => {
      cell.settled = { ok: false, failures: [] };
    },
  );
}

/** First failing boot check (assembly, auth, AI), or null when all pass. */
async function firstBootFailure(
  options: ResolvedShelfOptions,
  logger: Logger,
): Promise<AdapterSetupResult | null> {
  const invalid = validateBootAssembly(adapterSourcesOf(options));
  if (invalid.length > 0) {
    logger.error({ failures: invalid }, "adapter validation failed");
    return { ok: false, failures: invalid };
  }
  for (const [label, run] of [
    ["auth", runAuthSetup],
    ["ai", runAiSetup],
    ["images", runImagesSetup],
  ] as const) {
    // eslint-disable-next-line no-await-in-loop -- boot checks run in order and stop at the first failure
    const failed = await run(options);
    if (failed) {
      logger.error({ failures: failed.failures, step: label }, "boot check setup failed");
      return failed;
    }
  }
  return null;
}

/** Kick the eager background setup run (resolves; never rejects). */
function kickSetup(
  options: ResolvedShelfOptions,
  ctx: AdapterSetupContext,
  logger: Logger,
  cell: LifecycleCell,
): void {
  // Auth is not an adapter: its one-shot boot validation runs first, then
  // the adapter setups. A failing secret check fails readiness, like others.
  cell.ready = (async (): Promise<AdapterSetupResult> => {
    const failed = await firstBootFailure(options, logger);
    return (
      failed ?? (await runAdapterSetups(collectSetups(adapterSourcesOf(options)), ctx, logger))
    );
  })();
  trackSettlement(cell, cell.ready);
}

/** Login method count, or null when the engine throws during introspection. */
function loginMethodCount(auth: NonNullable<ResolvedShelfOptions["auth"]>): number | null {
  try {
    return auth.loginMethods().length;
  } catch {
    return null;
  }
}

/** Log which auth mode the server boots with (open servers stay visible). */
function logAuthMode(options: ResolvedShelfOptions, logger: Logger): void {
  if (!options.auth) {
    logger.info("auth disabled (local default; every route is open)");
    return;
  }
  const methods = loginMethodCount(options.auth);
  if (methods === null) {
    logger.warn("auth loginMethods() threw during boot logging");
    return;
  }
  logger.info({ loginMethods: methods }, "auth enabled");
}

/** Kick eager setup and attach the `app.lifecycle` namespace (single run). */
export function attachLifecycle(
  app: ShelfRouter,
  options: ResolvedShelfOptions,
  runtime: ServerRuntime,
  cell: LifecycleCell,
): void {
  const setupCtx: AdapterSetupContext = {
    config: runtime.config,
    logger: runtime.logger,
    release: packageVersion(),
  };
  bindAdapterLoggers(options, runtime.logger);
  options.ai?.setLogger?.(runtime.logger.child({ component: "ai" }));
  logAuthMode(options, runtime.logger);
  kickSetup(options, setupCtx, runtime.logger, cell);
  const timer = startBranchGcInterval(options, runtime, cell);
  Object.assign(app, {
    lifecycle: createLifecycle(options, setupCtx, runtime.logger, cell, timer),
  });
}

function startBranchGcInterval(
  options: ResolvedShelfOptions,
  runtime: ServerRuntime,
  cell: LifecycleCell,
): { stop(): void } | null {
  return startBranchGcTimer(
    options.database,
    options.storage,
    runtime.config,
    runtime.logger,
    Boolean(options.testing),
    async () => await cell.ready,
    options.auth,
  );
}

/** Run auth boot validation, returning a failure result instead of throwing. */
async function runAuthSetup(options: ResolvedShelfOptions): Promise<AdapterSetupResult | null> {
  try {
    await options.auth?.setup?.();
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      failures: [
        { category: "auth", kind: "auth", name: "auth", error: sanitizeErrorText(message, 500) },
      ],
    };
  }
}
/** Run AI boot checks and the stale-run sweep; failure fails readiness like auth. */
async function runAiSetup(options: ResolvedShelfOptions): Promise<AdapterSetupResult | null> {
  if (!options.ai) {
    return null;
  }
  try {
    await options.ai.setup();
    await purgeAiData(options.database);
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      failures: [
        { category: "ai", kind: "ai", name: "ai", error: sanitizeErrorText(message, 500) },
      ],
    };
  }
}
/** Load the configured image engine now, so a missing `sharp` fails readiness instead of the first diff. */
async function runImagesSetup(): Promise<AdapterSetupResult | null> {
  try {
    await verifyImageEngine();
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      failures: [
        {
          category: "images",
          kind: "images",
          name: "images",
          error: sanitizeErrorText(message, 500),
        },
      ],
    };
  }
}
/** Validation failure settled on the cell — null when the assembly is sound. */
function invalidSources(
  options: ResolvedShelfOptions,
  cell: LifecycleCell,
): AdapterSetupResult | null {
  const invalid = validateBootAssembly(adapterSourcesOf(options));
  if (invalid.length === 0) {
    return null;
  }
  const result: AdapterSetupResult = { ok: false, failures: invalid };
  cell.ready = Promise.resolve(result);
  cell.settled = result;
  return result;
}
/**
 * Run the adapter setups again. The run is published on the cell before it is awaited: readers
 * (the retention timer among them) must never see the previous run's result while a new setup is
 * still preparing the adapters.
 */
async function rerunSetup(
  options: ResolvedShelfOptions,
  ctx: AdapterSetupContext,
  logger: Logger,
  cell: LifecycleCell,
): Promise<AdapterSetupResult> {
  const running = runAdapterSetups(collectSetups(adapterSourcesOf(options)), ctx, logger);
  cell.ready = running;
  const result = await running;
  cell.settled = result;
  return result;
}

/** Build the `app.lifecycle` namespace closing over one settlement cell. */
function createLifecycle(
  options: ResolvedShelfOptions,
  ctx: AdapterSetupContext,
  logger: Logger,
  cell: LifecycleCell,
  timer: { stop(): void } | null = null,
): ShelfLifecycle {
  return {
    get ready() {
      return cell.ready;
    },
    logger,
    setup: async () => {
      const blocked = invalidSources(options, cell);
      if (blocked) {
        throw new AdapterLifecycleError("setup", blocked.failures);
      }
      const result = await rerunSetup(options, ctx, logger, cell);
      if (!result.ok) {
        throw new AdapterLifecycleError("setup", result.failures);
      }
      cell.consumerStopped = false;
      startConsumer(cell, logger);
    },
    teardown: async (teardownOptions) => {
      timer?.stop();
      await stopConsumer(cell, teardownOptions?.graceMs);
      await drainBackground(cell);
      await settleInsightJobs();
      await options.ai?.teardown();
      await shutdownDiffPool();
      const result = await runAdapterTeardowns(
        collectTeardowns(adapterSourcesOf(options)),
        ctx,
        logger,
      );
      await options.observability?.shutdown().catch((error: unknown) => {
        logger.error({ err: error }, "observability shutdown failed");
      });
      if (!result.ok) {
        throw new AdapterLifecycleError("teardown", result.failures);
      }
    },
  };
}
