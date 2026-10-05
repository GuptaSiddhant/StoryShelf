/**
 * Create a Redis-backed `CaptureQueue` with worker polling.
 *
 * Composition root: wires client resolution, lifecycle, server-side
 * operations, and worker polling into a `PollableCaptureQueue`. Key
 * derivation, serialization, and per-concern logic live in their own modules.
 *
 * Server side uses `enqueue` only; `status`/`active`/`recent` are no-ops
 * that return empty results (the builds table is the source of truth for remote
 * queues). Workers poll via `poll`/`ack`/`nack` which use `BLMOVE` for
 * at-least-once delivery plus a delayed ZSET for `nack` with `delayMs`.
 *
 * A separately-assembled worker polls the queue and calls
 * `executeCaptureJob` from `@storyshelf/core`.
 *
 * Redis keys:
 * - `{key}` — main FIFO queue (LPUSH / BLMOVE RIGHT→LEFT)
 * - `{key}:processing` — in-flight jobs (for ack/nack)
 * - `{key}:delayed` — ZSET for delayed requeues (score = due epoch ms)
 *
 * @param options - Redis connection and queue configuration.
 * @returns A `PollableCaptureQueue` satisfying the core interface.
 */
import type { PollableCaptureQueue } from "@storyshelf/core/adapter/capture-queue";
import type { Logger } from "@storyshelf/core/logger";
import { resolveQueueRuntime } from "./client.ts";
import { buildQueueLifecycle } from "./lifecycle.ts";
import { buildCoreMethods } from "./operations.ts";
import { buildPollMethods } from "./poll.ts";
import type { RedisCaptureQueueOptions } from "./types.ts";

declare const __PKG_VERSION__: string | undefined;

export function createRedisCaptureQueue(options: RedisCaptureQueueOptions): PollableCaptureQueue {
  const { rt, ownsClient } = resolveQueueRuntime(options);

  return {
    metadata: {
      name: "Redis Queue",
      version: (globalThis as unknown as { __PKG_VERSION__?: string }).__PKG_VERSION__ ?? "0.0.0",
      description: "Redis-backed capture queue",
      kind: "redis",
      category: "capture-queue",
    },
    lifecycle: buildQueueLifecycle(rt.client, ownsClient),
    setLogger(bound: Logger): void {
      rt.logger ??= bound;
    },
    ...buildCoreMethods(rt),
    ...buildPollMethods(rt),
  };
}

export type { RedisCaptureQueueOptions } from "./types.ts";
