import type {
  CaptureJob,
  PollableCaptureQueue,
  PollableJob,
  QueueEntry,
} from "@storyshelf/core/adapter/capture-queue";
import type { Logger } from "@storyshelf/core/logger";
import { Redis } from "ioredis";

declare const __PKG_VERSION__: string | undefined;

/**
 * Create a Redis-backed `CaptureQueue` with worker polling.
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
export function createRedisCaptureQueue(options: RedisCaptureQueueOptions): PollableCaptureQueue {
  const key = options.key ?? "shelf:queue";
  const processingKey = `${key}:processing`;
  const delayedKey = `${key}:delayed`;
  const waitTimeSeconds = options.waitTimeSeconds ?? 5;

  const client = getRedisClient(options);
  const ownsClient = options.client === undefined;
  const rt: QueueRuntime = {
    client,
    key,
    processingKey,
    delayedKey,
    waitTimeSeconds,
    logger: options.logger,
  };

  return {
    metadata: {
      name: "Redis Queue",
      version: (globalThis as unknown as { __PKG_VERSION__?: string }).__PKG_VERSION__ ?? "0.0.0",
      description: "Redis-backed capture queue",
      kind: "redis",
      category: "capture-queue",
    },
    lifecycle: buildQueueLifecycle(client, ownsClient),
    setLogger(bound: Logger): void {
      rt.logger ??= bound;
    },
    ...buildCoreMethods(rt),
    ...buildPollMethods(rt),
  };
}

/** Options for configuring a Redis-backed CaptureQueue. */
export interface RedisCaptureQueueOptions {
  /** Pre-configured ioredis client (takes precedence over url). */
  client?: Redis;
  /** Redis URL (e.g. redis://localhost:6379). Used when client not supplied. */
  url?: string;
  /** Redis queue key (default "shelf:queue"). */
  key?: string;
  /** Optional logger for queue diagnostics. */
  logger?: Logger;
  /** Long-poll wait time in seconds (default 5, max 20). */
  waitTimeSeconds?: number;
}

interface QueuedBody {
  buildId?: string;
  status?: string;
  queuedAt?: string;
  reqId?: string;
  attempts?: number;
}

interface QueueRuntime {
  client: Redis;
  key: string;
  processingKey: string;
  delayedKey: string;
  waitTimeSeconds: number;
  logger?: Logger;
}

/** All-or-nothing lifecycle: ping on setup, quit owned clients on teardown. */
function buildQueueLifecycle(
  client: Redis,
  ownsClient: boolean,
): PollableCaptureQueue["lifecycle"] {
  return {
    setup: async () => {
      await client.ping();
    },
    teardown: async () => {
      if (ownsClient) {
        await client.quit().catch(() => {});
      }
    },
    health: async () => {
      await client.ping();
      return { ok: true };
    },
  };
}

function buildCoreMethods(
  rt: QueueRuntime,
): Pick<PollableCaptureQueue, "enqueue" | "status" | "active" | "recent"> {
  return {
    /**
     * Submit a build for capture. Resolves once the message is pushed to Redis.
     *
     * The actual capture execution happens in a separate worker that
     * polls the queue and calls `executeCaptureJob`.
     */
    async enqueue(job: CaptureJob): Promise<void> {
      const payload = JSON.stringify({
        buildId: job.buildId,
        reqId: job.reqId,
        queuedAt: new Date().toISOString(),
        status: "queued",
        attempts: 0,
      });
      await rt.client.lpush(rt.key, payload);
    },

    /**
     * Return the current status entry for a build.
     *
     * For remote queues Redis has no peek; builds table is source of truth.
     * Returns null to signal caller should query the database.
     */
    async status(_buildId: string): Promise<QueueEntry | null> {
      await Promise.resolve();
      return null;
    },

    /**
     * Return queue entries that are queued or running.
     *
     * Remote queues don't track in-queue status server-side; returns empty.
     */
    async active(): Promise<QueueEntry[]> {
      await Promise.resolve();
      return [];
    },

    /**
     * Return the most recent queue entries.
     *
     * Remote queues don't track history server-side; returns empty.
     */
    async recent(_limit: number): Promise<QueueEntry[]> {
      await Promise.resolve();
      return [];
    },
  };
}

function buildPollMethods(rt: QueueRuntime): Pick<PollableCaptureQueue, "poll" | "ack" | "nack"> {
  return {
    /**
     * Poll for a single capture job using BLMOVE with delayed-job promotion.
     *
     * Moves due delayed jobs back to the main queue before blocking.
     * Uses `attempts` stored in the payload (0-indexed).
     */
    async poll(pollOptions?: { waitMs?: number }): Promise<PollableJob | null> {
      await promoteDueDelayed(rt.client, rt.key, rt.delayedKey, rt.logger);
      const waitSeconds = resolveWaitSeconds(pollOptions, rt.waitTimeSeconds);
      const raw = await blmoveWithFallback(rt.client, rt.key, rt.processingKey, waitSeconds);
      return await extractPolledJob(rt.client, rt.processingKey, raw, rt.logger);
    },

    async ack(job: PollableJob): Promise<void> {
      if (!job.receipt) {
        return;
      }
      await rt.client.lrem(rt.processingKey, 1, job.receipt);
    },

    async nack(
      job: PollableJob,
      nackOptions?: { requeue?: boolean; delayMs?: number },
    ): Promise<void> {
      if (!job.receipt) {
        return;
      }
      await rt.client.lrem(rt.processingKey, 1, job.receipt);
      if (nackOptions?.requeue === false) {
        return;
      }
      const delayMs = resolveDelayMs(nackOptions);
      await requeueJob(rt.client, rt.key, rt.delayedKey, job.receipt, delayMs);
    },
  };
}

function resolveWaitSeconds(
  pollOptions: { waitMs?: number } | undefined,
  fallback: number,
): number {
  if (pollOptions?.waitMs === undefined) {
    return fallback;
  }
  return Math.max(0, Math.min(20, Math.floor(pollOptions.waitMs / 1000)));
}

function resolveDelayMs(nackOptions: { delayMs?: number } | undefined): number {
  if (nackOptions?.delayMs === undefined) {
    return 0;
  }
  return Math.max(0, nackOptions.delayMs);
}

async function extractPolledJob(
  client: Redis,
  processingKey: string,
  raw: string | null,
  logger?: Logger,
): Promise<PollableJob | null> {
  if (raw === null || raw === "") {
    return null;
  }
  const body = parseBody(raw);
  if (!body.buildId) {
    await client.lrem(processingKey, 1, raw).catch(() => {});
    logger?.warn({ body: raw }, "received malformed Redis message without buildId");
    return null;
  }
  return {
    buildId: body.buildId,
    reqId: body.reqId,
    receipt: raw,
    attempts: typeof body.attempts === "number" ? body.attempts : 0,
    raw,
  };
}

async function requeueJob(
  client: Redis,
  key: string,
  delayedKey: string,
  receipt: string,
  delayMs: number,
): Promise<void> {
  const body = parseBody(receipt);
  if (!body.buildId) {
    return;
  }
  const payload = buildRequeuePayload(body);
  if (delayMs > 0) {
    const due = Date.now() + Math.min(delayMs, 43_200 * 1000);
    await client.zadd(delayedKey, due.toString(), payload);
    return;
  }
  await client.lpush(key, payload);
}

function buildRequeuePayload(body: QueuedBody): string {
  const nextAttempts = (typeof body.attempts === "number" ? body.attempts : 0) + 1;
  return JSON.stringify({
    buildId: body.buildId,
    reqId: body.reqId,
    queuedAt: body.queuedAt ?? new Date().toISOString(),
    status: "queued",
    attempts: nextAttempts,
  });
}

function parseBody(raw: string): QueuedBody {
  try {
    return JSON.parse(raw) as QueuedBody;
  } catch {
    return {};
  }
}

function getRedisClient(options: RedisCaptureQueueOptions): Redis {
  if (options.client) {
    return options.client;
  }
  if (options.url) {
    return new Redis(options.url);
  }
  return new Redis();
}

async function promoteDueDelayed(
  client: Redis,
  _key: string,
  delayedKey: string,
  logger?: Logger,
): Promise<void> {
  const due = await fetchDueJobs(client, delayedKey);
  await promoteMembers(client, delayedKey, due, logger);
}

async function fetchDueJobs(client: Redis, delayedKey: string): Promise<string[]> {
  try {
    return await client.zrangebyscore(delayedKey, 0, Date.now());
  } catch {
    return [];
  }
}

async function promoteMembers(
  client: Redis,
  delayedKey: string,
  due: string[],
  logger?: Logger,
): Promise<void> {
  if (due.length === 0) {
    return;
  }
  const pipeline = client.pipeline();
  for (const member of due) {
    pipeline.zrem(delayedKey, member);
    // Use main key: need to know main key, derive from delayedKey
    const mainKey = delayedKey.replace(/:delayed$/u, "");
    pipeline.lpush(mainKey, member);
  }
  try {
    await pipeline.exec();
  } catch (error) {
    logger?.warn({ err: error }, "failed to promote delayed Redis jobs");
  }
}

async function blmoveWithFallback(
  client: Redis,
  source: string,
  dest: string,
  timeoutSec: number,
): Promise<string | null> {
  // ioredis 5+ has blmove, older has brpoplpush
  const anyClient = client as unknown as {
    blmove?: (
      src: string,
      dst: string,
      srcDir: string,
      dstDir: string,
      timeout: number,
    ) => Promise<string | null>;
    brpoplpush?: (src: string, dst: string, timeout: number) => Promise<string | null>;
  };
  if (typeof anyClient.blmove === "function") {
    return await anyClient.blmove(source, dest, "RIGHT", "LEFT", timeoutSec);
  }
  if (typeof anyClient.brpoplpush === "function") {
    return await anyClient.brpoplpush(source, dest, timeoutSec);
  }
  return await brpopFallback(client, source, dest, timeoutSec);
}

async function brpopFallback(
  client: Redis,
  source: string,
  dest: string,
  timeoutSec: number,
): Promise<string | null> {
  // Fallback to blocking pop without processing list (at-most-once)
  const raw: unknown = await client.brpop(source, timeoutSec);
  if (!raw) {
    return null;
  }
  // brpop returns [key, value] tuple
  const value: unknown = Array.isArray(raw) ? raw[1] : raw;
  if (typeof value !== "string") {
    return null;
  }
  await client.lpush(dest, value);
  return value;
}
