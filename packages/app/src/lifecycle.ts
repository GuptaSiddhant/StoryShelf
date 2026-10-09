import type { AdapterSetupContext } from "@storyshelf/core/adapter/metadata";
import {
  AdapterLifecycleError,
  bindAdapterLoggers,
  collectSetups,
  collectTeardowns,
  runAdapterSetups,
  runAdapterTeardowns,
  validateBootAssembly,
} from "@storyshelf/core/adapter/setup";
import type { AdapterSetupResult } from "@storyshelf/core/adapter/setup";
import type { ShelfOptions } from "@storyshelf/core/config";
import type { Logger } from "@storyshelf/core/logger";
import { purgeAiData } from "@storyshelf/core/retention";
import { sanitizeErrorText } from "@storyshelf/core/utils";
import type { ShelfRouter, ShelfLifecycle } from "./app-types.ts";
import { settleInsightJobs } from "./insights/job.ts";
import { startBranchGcTimer } from "./retention-timer.ts";
import type { ServerRuntime } from "./runtime.ts";

/** Mutable setup-settlement cell shared by the gate, health, and `setup()`. */
export interface LifecycleCell {
  ready: Promise<AdapterSetupResult>;
  settled: AdapterSetupResult | null;
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
  options: ShelfOptions,
  logger: Logger,
): Promise<AdapterSetupResult | null> {
  const invalid = validateBootAssembly(options);
  if (invalid.length > 0) {
    logger.error({ failures: invalid }, "adapter validation failed");
    return { ok: false, failures: invalid };
  }
  for (const [label, run] of [
    ["auth", runAuthSetup],
    ["ai", runAiSetup],
  ] as const) {
    // eslint-disable-next-line no-await-in-loop -- boot checks run in order and stop at the first failure
    const failed = await run(options);
    if (failed) {
      logger.error({ failures: failed.failures }, `${label} setup failed`);
      return failed;
    }
  }
  return null;
}

/** Kick the eager background setup run (resolves; never rejects). */
function kickSetup(
  options: ShelfOptions,
  ctx: AdapterSetupContext,
  logger: Logger,
  cell: LifecycleCell,
): void {
  // Auth is not an adapter: its one-shot boot validation runs first, then
  // the adapter setups. A failing secret check fails readiness, like others.
  cell.ready = (async (): Promise<AdapterSetupResult> => {
    const failed = await firstBootFailure(options, logger);
    return failed ?? (await runAdapterSetups(collectSetups(options), ctx, logger));
  })();
  trackSettlement(cell, cell.ready);
}

/** Login method count, or null when the engine throws during introspection. */
function loginMethodCount(auth: NonNullable<ShelfOptions["auth"]>): number | null {
  try {
    return auth.loginMethods().length;
  } catch {
    return null;
  }
}

/** Log which auth mode the server boots with (open servers stay visible). */
function logAuthMode(options: ShelfOptions, logger: Logger): void {
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
  options: ShelfOptions,
  runtime: ServerRuntime,
  cell: LifecycleCell,
): void {
  const setupCtx: AdapterSetupContext = { config: runtime.config, logger: runtime.logger };
  bindAdapterLoggers(options, runtime.logger);
  options.ai?.setLogger?.(runtime.logger.child({ component: "ai" }));
  logAuthMode(options, runtime.logger);
  kickSetup(options, setupCtx, runtime.logger, cell);
  const timer = startBranchGcInterval(options, runtime);
  Object.assign(app, {
    lifecycle: createLifecycle(options, setupCtx, runtime.logger, cell, timer),
  });
}

function startBranchGcInterval(
  options: ShelfOptions,
  runtime: ServerRuntime,
): { stop(): void } | null {
  return startBranchGcTimer(options.database, options.storage, runtime.config, runtime.logger);
}

/** Run auth boot validation, returning a failure result instead of throwing. */
async function runAuthSetup(options: ShelfOptions): Promise<AdapterSetupResult | null> {
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
async function runAiSetup(options: ShelfOptions): Promise<AdapterSetupResult | null> {
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
/** Validation failure settled on the cell — null when the assembly is sound. */
function invalidSources(options: ShelfOptions, cell: LifecycleCell): AdapterSetupResult | null {
  const invalid = validateBootAssembly(options);
  if (invalid.length === 0) {
    return null;
  }
  const result: AdapterSetupResult = { ok: false, failures: invalid };
  cell.ready = Promise.resolve(result);
  cell.settled = result;
  return result;
}
/** Build the `app.lifecycle` namespace closing over one settlement cell. */
function createLifecycle(
  options: ShelfOptions,
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
      const result = await runAdapterSetups(collectSetups(options), ctx, logger);
      cell.ready = Promise.resolve(result);
      cell.settled = result;
      if (!result.ok) {
        throw new AdapterLifecycleError("setup", result.failures);
      }
    },
    teardown: async () => {
      timer?.stop();
      await settleInsightJobs();
      await options.ai?.teardown();
      const result = await runAdapterTeardowns(collectTeardowns(options), ctx, logger);
      await options.observability?.shutdown().catch((error: unknown) => {
        logger.error({ err: error }, "observability shutdown failed");
      });
      if (!result.ok) {
        throw new AdapterLifecycleError("teardown", result.failures);
      }
    },
  };
}
