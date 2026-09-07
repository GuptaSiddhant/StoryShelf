import {
  AdapterLifecycleError,
  collectCloses,
  collectInits,
  runAdapterCloses,
  runAdapterInits,
} from "@storyshelf/core/adapter/init";
import type { AdapterInitResult } from "@storyshelf/core/adapter/init";
import type { AdapterInitContext } from "@storyshelf/core/adapter/metadata";
import type { ShelfOptions } from "@storyshelf/core/config";
import type { Logger } from "@storyshelf/core/logger";
import type { ShelfApp, ShelfLifecycle } from "./app-types.ts";
import type { ServerRuntime } from "./runtime.ts";

/** Mutable init-settlement cell shared by the gate, health, and `init()`. */
export interface LifecycleCell {
  ready: Promise<AdapterInitResult>;
  settled: AdapterInitResult | null;
}

function trackSettlement(cell: LifecycleCell, promise: Promise<AdapterInitResult>): void {
  promise.then(
    (result) => {
      cell.settled = result;
    },
    () => {
      cell.settled = { ok: false, failures: [] };
    },
  );
}

/** Kick the eager background init run (resolves; never rejects). */
function kickInit(
  options: ShelfOptions,
  ctx: AdapterInitContext,
  logger: Logger,
  cell: LifecycleCell,
): void {
  cell.ready = runAdapterInits(collectInits(options), ctx, logger);
  trackSettlement(cell, cell.ready);
}

/** Kick eager init and attach the `app.lifecycle` namespace (single run). */
export function attachLifecycle(
  app: ShelfApp,
  options: ShelfOptions,
  runtime: ServerRuntime,
  cell: LifecycleCell,
): void {
  const initCtx: AdapterInitContext = { config: runtime.config, logger: runtime.logger };
  kickInit(options, initCtx, runtime.logger, cell);
  Object.assign(app, { lifecycle: createLifecycle(options, initCtx, runtime.logger, cell) });
}

/** Build the `app.lifecycle` namespace closing over one settlement cell. */
function createLifecycle(
  options: ShelfOptions,
  ctx: AdapterInitContext,
  logger: Logger,
  cell: LifecycleCell,
): ShelfLifecycle {
  return {
    get ready() {
      return cell.ready;
    },
    logger,
    init: async () => {
      const result = await runAdapterInits(collectInits(options), ctx, logger);
      cell.ready = Promise.resolve(result);
      cell.settled = result;
      if (!result.ok) {
        throw new AdapterLifecycleError("init", result.failures);
      }
    },
    close: async () => {
      const result = await runAdapterCloses(collectCloses(options), ctx, logger);
      if (!result.ok) {
        throw new AdapterLifecycleError("close", result.failures);
      }
    },
  };
}
