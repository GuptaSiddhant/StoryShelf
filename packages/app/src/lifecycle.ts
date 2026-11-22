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
import type { ShelfAppMode, ShelfRouter, ShelfLifecycle } from "./app-types.ts";
import { settleInsightJobs } from "./insights/job.ts";
import { packageVersion } from "./package-version.ts";
import { startBranchGcTimer } from "./retention-timer.ts";
import type { ServerRuntime } from "./runtime.ts";

/** Mutable setup-settlement cell shared by the gate, health, and `setup()`. */
export interface LifecycleCell {
  /** What this app does by itself (default `serve`). */
  mode?: ShelfAppMode;
  ready: Promise<AdapterSetupResult>;
  settled: AdapterSetupResult | null;
  /** The boot checks' outcome (auth secret, AI, images): `setup()` throws while it is a failure. */
  bootFailure?: Promise<AdapterSetupResult | null>;
  /** `bootFailure` once settled (undefined while the checks run), so `setup()` need not wait a tick. */
  bootChecked?: AdapterSetupResult | null;
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
  /** The eager run `attachLifecycle` started and no `setup()` has adopted yet: the first `setup()` awaits it instead of running every hook a second time. */
  eager?: Promise<AdapterSetupResult>;
  /** How many teardowns have started: a setup attempt begun before one is stale and stops. */
  teardowns?: number;
}

/** Longest teardown waits for background boot tasks before closing adapters anyway. */
const BACKGROUND_DRAIN_MS = 5000;

/** Thrown by a `setup()` whose attempt a teardown overtook: it neither runs hooks nor starts the consumer. */
const ABANDONED_SETUP = "Setup abandoned: teardown ran while setup was pending";

/** The current teardown generation; an attempt compares it to the one it started in. */
function generationOf(cell: LifecycleCell): number {
  return cell.teardowns ?? 0;
}

/** Throw when a teardown started since `generation` was read. */
function assertCurrent(cell: LifecycleCell, generation: number): void {
  if (generationOf(cell) !== generation) {
    throw new Error(ABANDONED_SETUP);
  }
}

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
 * Stop polling and wait for the jobs in flight to finish (the SIGTERM drain), at most `graceMs`
 * when given: the jobs still running then are handed back (#912). Also invalidates pending setup
 * attempts, whose adapter hooks `drainBackground` then outwaits.
 */
async function stopConsumer(cell: LifecycleCell, graceMs: number | undefined): Promise<void> {
  cell.teardowns = generationOf(cell) + 1;
  cell.consumerStopped = true;
  await cell.consumer?.stop(graceMs === undefined ? {} : { graceMs });
  await cell.consumerRun;
}

/**
 * Wait for tracked boot tasks, bounded so a hung task can never block shutdown: by the cell's drain
 * limit, and by `remainingMs` (what is left of the shutdown grace) when teardown has one.
 */
async function drainBackground(cell: LifecycleCell, remainingMs = Infinity): Promise<void> {
  const pending = Promise.allSettled(cell.background ?? []);
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(
      resolve,
      Math.max(0, Math.min(cell.drainMs ?? BACKGROUND_DRAIN_MS, remainingMs)),
    );
    timer.unref();
  });
  await Promise.race([pending, timeout]);
  clearTimeout(timer);
}

/**
 * The consumer drain, then the boot-task wait, under one `graceMs` budget: the wait only gets what
 * the job drain left of it, so a stopping host stays inside the platform's stop timeout.
 */
async function drainWithinGrace(cell: LifecycleCell, graceMs?: number): Promise<void> {
  const startedAt = Date.now();
  await stopConsumer(cell, graceMs);
  await drainBackground(
    cell,
    graceMs === undefined ? undefined : graceMs - (Date.now() - startedAt),
  );
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
      logger.error({ failures: failed.failures, step: label }, "boot check failed");
      return failed;
    }
  }
  return null;
}

/** The adapter setups (migrations included), then the AI purge that reads migrated tables. */
async function runAdapterPhase(
  options: ResolvedShelfOptions,
  ctx: AdapterSetupContext,
  logger: Logger,
  mode: ShelfAppMode = "serve",
): Promise<AdapterSetupResult> {
  if (mode === "migrate") {
    // The database's setup is its migrations: nothing else is set up, purged or checked.
    const entries = collectSetups(adapterSourcesOf(options)).filter(
      (entry) => entry.category === "database",
    );
    return await runAdapterSetups(entries, ctx, logger);
  }
  const result = await runAdapterSetups(collectSetups(adapterSourcesOf(options)), ctx, logger);
  return result.ok ? ((await runAiPurge(options)) ?? result) : result;
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
  const migrateOnly = cell.mode === "migrate";
  const bootFailure = migrateOnly ? Promise.resolve(null) : firstBootFailure(options, logger);
  cell.bootFailure = bootFailure;
  bootFailure.then(
    (result) => {
      cell.bootChecked = result;
    },
    () => {}, // Intentionally empty — `cell.ready` settles the rejection as a failed readiness
  );
  const generation = generationOf(cell);
  cell.ready = (async (): Promise<AdapterSetupResult> => {
    const failed = await bootFailure;
    if (failed) {
      return failed;
    }
    // Teardown overtook the boot checks: never run adapter hooks on adapters being closed.
    return generationOf(cell) === generation
      ? await runAdapterPhase(options, ctx, logger, cell.mode)
      : { ok: false, failures: [] };
  })();
  cell.eager = cell.ready;
  trackSettlement(cell, cell.ready);
  trackBackground(cell, cell.ready);
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

/** The eager run of this app's mode: none for a `tool`, which uses its adapters as they are. */
function startEagerSetup(
  options: ResolvedShelfOptions,
  ctx: AdapterSetupContext,
  logger: Logger,
  cell: LifecycleCell,
): void {
  if (cell.mode !== "tool") {
    kickSetup(options, ctx, logger, cell);
    return;
  }
  const idle: AdapterSetupResult = { ok: true, failures: [] };
  cell.ready = Promise.resolve(idle);
  cell.settled = idle;
  cell.bootChecked = null;
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
  startEagerSetup(options, setupCtx, runtime.logger, cell);
  const timer =
    (cell.mode ?? "serve") === "serve" ? startBranchGcInterval(options, runtime, cell) : null;
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
/** Run the AI boot check; failure fails readiness like auth. Its data purge waits for migrations. */
async function runAiSetup(options: ResolvedShelfOptions): Promise<AdapterSetupResult | null> {
  return await aiStep(options, async (ai) => {
    await ai.setup();
  });
}

/** The AI retention sweep, once the adapters (and so the database migrations) are set up. */
async function runAiPurge(options: ResolvedShelfOptions): Promise<AdapterSetupResult | null> {
  return await aiStep(options, async () => {
    await purgeAiData(options.database);
  });
}

/** Run one AI step, turning a throw into an `ai` failure result (null without AI). */
async function aiStep(
  options: ResolvedShelfOptions,
  step: (ai: NonNullable<ResolvedShelfOptions["ai"]>) => Promise<void>,
): Promise<AdapterSetupResult | null> {
  if (!options.ai) {
    return null;
  }
  try {
    await step(options.ai);
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
/**
 * Load the image libraries now, so a missing peer (`sharp`, or the `pngjs` and `pixelmatch` the runner
 * brings) fails readiness instead of the first diff. Only with `testing`: hosting only loads none.
 */
async function runImagesSetup(options: ResolvedShelfOptions): Promise<AdapterSetupResult | null> {
  if (!options.testing) {
    return null;
  }
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
/** Keep a failed result on the cell, so health and readers never see a later run's success. */
function settleFailure(cell: LifecycleCell, result: AdapterSetupResult): AdapterSetupResult {
  cell.ready = Promise.resolve(result);
  cell.settled = result;
  return result;
}

/** Validation failure settled on the cell — null when the assembly is sound. */
function invalidSources(
  options: ResolvedShelfOptions,
  cell: LifecycleCell,
): AdapterSetupResult | null {
  const invalid = validateBootAssembly(adapterSourcesOf(options));
  return invalid.length === 0 ? null : settleFailure(cell, { ok: false, failures: invalid });
}

/** Throw a failed boot check, settling it on the cell (setup must not mask it with a later run). */
function refuseBootCheck(cell: LifecycleCell, failed: AdapterSetupResult | null | undefined): void {
  if (failed) {
    settleFailure(cell, failed);
    // Names only: a hook's own text stays in `failures` and the structured log, never the message.
    throw new AdapterLifecycleError("setup", failed.failures);
  }
}
/**
 * Throw when the assembly is invalid or a boot check failed: there is no "failed, continuing" path,
 * so the host never starts listening. Synchronous once the checks settled (the usual case), so a
 * passing `setup()` still publishes its run on the cell in the same tick; else it waits for them.
 */
function refuseFailedBoot(
  options: ResolvedShelfOptions,
  cell: LifecycleCell,
): Promise<void> | null {
  const blocked = invalidSources(options, cell);
  if (blocked) {
    throw new AdapterLifecycleError("setup", blocked.failures);
  }
  if (cell.bootChecked !== undefined || cell.bootFailure === undefined) {
    refuseBootCheck(cell, cell.bootChecked);
    return null;
  }
  return cell.bootFailure.then((failed) => {
    refuseBootCheck(cell, failed);
  });
}

/**
 * The eager run's result when the first `setup()` can adopt it (it succeeded), else null: a failed
 * eager run, or any later call, runs the hooks again so a transient failure is retryable.
 */
async function adoptEagerRun(
  eager: Promise<AdapterSetupResult>,
): Promise<AdapterSetupResult | null> {
  const result = await eager;
  return result.ok ? result : null;
}

/** Take the unadopted eager run off the cell, synchronously (a later call must publish its rerun in the same tick). */
function takeEagerRun(cell: LifecycleCell): Promise<AdapterSetupResult> | undefined {
  const eager = cell.eager;
  cell.eager = undefined;
  return eager;
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
  const running = runAdapterPhase(options, ctx, logger, cell.mode);
  cell.ready = running;
  trackBackground(cell, running);
  const result = await running;
  cell.settled = result;
  return result;
}

/** Throw a failed rerun, or a teardown that overtook it; otherwise (re)start the consumer. */
function resumeAfterSetup(
  cell: LifecycleCell,
  generation: number,
  result: AdapterSetupResult,
  logger: Logger,
): void {
  if (!result.ok) {
    throw new AdapterLifecycleError("setup", result.failures);
  }
  // A teardown during the run closed the adapters: never restart the consumer on them.
  assertCurrent(cell, generation);
  cell.consumerStopped = false;
  startConsumer(cell, logger);
}

/** A `tool` app never sets its adapters up; asking it to is a mistake of the caller's. */
function refuseToolSetup(cell: LifecycleCell): void {
  if (cell.mode === "tool") {
    throw new Error(
      "A tool-mode app never sets its adapters up: create it in serve or migrate mode.",
    );
  }
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
    mode: cell.mode ?? "serve",
    get ready() {
      return cell.ready;
    },
    logger,
    setup: async () => {
      refuseToolSetup(cell);
      const generation = generationOf(cell);
      const checking = refuseFailedBoot(options, cell);
      if (checking) {
        await checking;
      }
      // Checked here, in the continuation itself: a teardown may start in any microtask before it.
      assertCurrent(cell, generation);
      const eager = takeEagerRun(cell);
      const result =
        (eager ? await adoptEagerRun(eager) : null) ??
        (await rerunSetup(options, ctx, logger, cell));
      resumeAfterSetup(cell, generation, result, logger);
    },
    teardown: async (teardownOptions) => {
      timer?.stop();
      await drainWithinGrace(cell, teardownOptions?.graceMs);
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
