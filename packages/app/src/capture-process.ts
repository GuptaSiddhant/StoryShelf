/** Chooses between in-process and forked capture, and builds the forked queue. */
import type { CaptureQueue, PollableJob } from "@storyshelf/core/adapter/capture-queue";
import {
  canForkCaptureChild,
  CAPTURE_CONCURRENCY_ENV,
  CAPTURE_SHARD_SIZE_ENV,
  decideCaptureProcess,
  ForkedCaptureQueue,
  forkCaptureChild,
  type ForkDecision,
} from "@storyshelf/core/capture";
import type { ShelfCaptureOptions } from "@storyshelf/core/config";
import { DIFF_WORKERS_ENV, IMAGE_ENGINE_ENV } from "@storyshelf/core/diff";
import type { Logger } from "@storyshelf/core/logger";
import { detectResources } from "@storyshelf/core/utils";
import { CAPTURE_LEASE_MS } from "./stalled-capture.ts";

/** True when the capture runs in a process this server owns, so its queue can retry and cancel. */
export function capturesLocally(queue: CaptureQueue | null | undefined): boolean {
  const kind = queue?.metadata.kind;
  return kind === "memory" || kind === "forked";
}

/**
 * Whether to fork a capture child. `mode: "fork"` forces it (and fails if it cannot); `auto` forks
 * when a `workerEntry` is set and the host can afford a second process.
 *
 * @throws When `mode` is `"fork"` but the runtime cannot fork.
 */
export function shouldForkCapture(
  capture: ShelfCaptureOptions | undefined,
  logger: Logger,
): boolean {
  if (!capture?.workerEntry || capture.mode === "in-process") {
    return false;
  }
  if (capture.mode === "fork") {
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
    throw new Error('capture.mode "fork" is set but child processes are unavailable here');
  }
  return true;
}

function decideForHost(): ForkDecision {
  const { cpus, memoryBytes } = detectResources();
  return decideCaptureProcess({ cpus, memoryBytes, canFork: canForkCaptureChild() });
}

/** Dependencies for {@link createForkedQueue}. */
export interface ForkedQueueDeps {
  workerEntry: string;
  concurrency?: number;
  /** Captures per shard for big builds, handed to the child (`capture.shardSize`). */
  shardSize?: number;
  /** `images.engine`, handed to the child so it diffs with the same codec. */
  imageEngine?: string;
  /** `compare.threads`, handed to the child's diff pool. */
  diffThreads?: number;
  /** Takes over if forking stops being viable. */
  fallback: CaptureQueue;
  onSettled: (job: PollableJob) => Promise<void>;
  logger: Logger;
}

/** Settings the parent hands to a forked child through its environment. */
export function childEnvOf(
  deps: Pick<ForkedQueueDeps, "concurrency" | "shardSize" | "imageEngine" | "diffThreads">,
): Record<string, string> {
  const env: Record<string, string> = {};
  if (deps.concurrency !== undefined) {
    env[CAPTURE_CONCURRENCY_ENV] = String(deps.concurrency);
  }
  if (deps.shardSize !== undefined) {
    env[CAPTURE_SHARD_SIZE_ENV] = String(deps.shardSize);
  }
  if (deps.imageEngine !== undefined) {
    env[IMAGE_ENGINE_ENV] = deps.imageEngine;
  }
  if (deps.diffThreads !== undefined) {
    env[DIFF_WORKERS_ENV] = String(deps.diffThreads);
  }
  return env;
}

/** The parent-side queue for a forked capture child, with the in-process queue as its fallback. */
export function createForkedQueue(deps: ForkedQueueDeps): ForkedCaptureQueue {
  const env = childEnvOf(deps);
  return new ForkedCaptureQueue({
    spawn: () => forkCaptureChild({ entry: deps.workerEntry, env }),
    fallback: deps.fallback,
    leaseMs: CAPTURE_LEASE_MS,
    onSettled: async (job) => {
      await deps.onSettled(job);
    },
    logger: deps.logger,
  });
}
