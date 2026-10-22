/** Chooses between in-process and forked capture, and builds the forked handler. */
import {
  canForkCaptureChild,
  CAPTURE_RETRIES_ENV,
  CAPTURE_SHARD_SIZE_ENV,
  CAPTURE_STORYBOOK_URL_TTL_ENV,
  createForkedCaptureHandler,
  decideCaptureProcess,
  forkCaptureChild,
  type ForkDecision,
  type ForkedCaptureHandler,
  type KindHandler,
  type ConsumerJob,
} from "@storyshelf/core/capture";
import type { ShelfTestingOptions } from "@storyshelf/core/config";
import { DIFF_WORKERS_ENV, IMAGE_ENGINE_ENV } from "@storyshelf/core/diff";
import type { Logger } from "@storyshelf/core/logger";
import { detectResources } from "@storyshelf/core/utils";

/**
 * Whether to fork a capture child. `mode: "fork"` forces it (and fails if it cannot); `auto` forks
 * when a `workerEntry` is set and the host can afford a second process.
 *
 * @throws When `mode` is `"fork"` but the runtime cannot fork.
 */
export function shouldForkCapture(
  testing: ShelfTestingOptions | undefined,
  logger: Logger,
): boolean {
  if (!testing?.workerEntry || testing.mode === "in-process") {
    return false;
  }
  if (testing.mode === "fork") {
    return requireFork();
  }
  const decision = decideForHost();
  if (decision.mode === "in-process") {
    logger.info({ reason: decision.reason }, "capture workerEntry set; capturing in-process");
  }
  return decision.mode === "fork";
}

function requireFork(): true {
  if (!canForkCaptureChild()) {
    throw new Error('testing.mode "fork" is set but child processes are unavailable here');
  }
  return true;
}

function decideForHost(): ForkDecision {
  const { cpus, memoryBytes } = detectResources();
  return decideCaptureProcess({ cpus, memoryBytes, canFork: canForkCaptureChild() });
}

/** Dependencies for {@link createForkedHandler}. */
export interface ForkedHandlerDeps {
  workerEntry: string;
  /** Captures per shard for big builds, handed to the child (`testing.shardSize`). */
  shardSize?: number;
  /** `testing.storybookUrlTtl` (seconds), handed to the child, which mints signed Storybook URLs. */
  storybookUrlTtl?: number;
  /** `testing.images.engine`, handed to the child so it diffs with the same codec. */
  imageEngine?: string;
  /** `testing.compare.threads`, handed to the child's diff pool. */
  diffThreads?: number;
  /** `testing.retries`, handed to the child, which stamps it on the shard jobs it queues. */
  retries: number;
  /** Takes over if forking stops being viable. */
  fallback: KindHandler;
  /** A job the child kept killing on its last attempt: write its failure. */
  onCrashed: (job: ConsumerJob, error: string) => Promise<void>;
  logger: Logger;
}

/** Settings the parent hands to a forked child through its environment. */
export function childEnvOf(
  deps: Pick<
    ForkedHandlerDeps,
    "shardSize" | "storybookUrlTtl" | "imageEngine" | "diffThreads" | "retries"
  >,
): Record<string, string> {
  const env: Record<string, string> = { [CAPTURE_RETRIES_ENV]: String(deps.retries) };
  if (deps.shardSize !== undefined) {
    env[CAPTURE_SHARD_SIZE_ENV] = String(deps.shardSize);
  }
  if (deps.storybookUrlTtl !== undefined) {
    env[CAPTURE_STORYBOOK_URL_TTL_ENV] = String(deps.storybookUrlTtl);
  }
  if (deps.imageEngine !== undefined) {
    env[IMAGE_ENGINE_ENV] = deps.imageEngine;
  }
  if (deps.diffThreads !== undefined) {
    env[DIFF_WORKERS_ENV] = String(deps.diffThreads);
  }
  return env;
}

/** The `capture` handler that runs jobs in a forked child, with the in-process handler as its fallback. */
export function createForkedHandler(deps: ForkedHandlerDeps): ForkedCaptureHandler {
  const env = childEnvOf(deps);
  return createForkedCaptureHandler({
    spawn: () => forkCaptureChild({ entry: deps.workerEntry, env }),
    fallback: deps.fallback,
    maxRetries: deps.retries,
    onCrashed: deps.onCrashed,
    logger: deps.logger,
  });
}
