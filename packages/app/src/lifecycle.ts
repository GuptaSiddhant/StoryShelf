import type { AdapterSetupContext } from "@storyshelf/core/adapter/metadata";
import {
  AdapterLifecycleError,
  bindAdapterLoggers,
  collectSetups,
  collectTeardowns,
  runAdapterSetups,
  runAdapterTeardowns,
  validateAdapterSources,
} from "@storyshelf/core/adapter/setup";
import type { AdapterSetupResult } from "@storyshelf/core/adapter/setup";
import type { ShelfOptions } from "@storyshelf/core/config";
import type { Logger } from "@storyshelf/core/logger";
import type { ShelfRouter, ShelfLifecycle } from "./app-types.ts";
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
    const invalid = validateAdapterSources(options);
    if (invalid.length > 0) {
      logger.error({ failures: invalid }, "adapter validation failed");
      return { ok: false, failures: invalid };
    }
    await options.auth?.setup?.();
    return await runAdapterSetups(collectSetups(options), ctx, logger);
  })();
  trackSettlement(cell, cell.ready);
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

/** Validation failure result, settling the cell and throwing — null when valid. */
function invalidSources(options: ShelfOptions, cell: LifecycleCell): AdapterSetupResult | null {
  const invalid = validateAdapterSources(options);
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
