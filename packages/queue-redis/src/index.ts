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

  return {
    metadata: {
      name: "Redis Queue",
      version: (globalThis as unknown as { __PKG_VERSION__?: string }).__PKG_VERSION__ ?? "0.0.0",
      description: "Redis-backed capture queue",
      kind: "redis",
      category: "capture-queue",
    },
    lifecycle: {
      init: async () => {
        await client.ping();
      },
      close: async () => {
        if (ownsClient) {
          await client.quit().catch(() => {});
        }
      },
    },
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
      await client.lpush(key, payload);
    },

    /**
     * Return the current status entry for a build.
     *
     * For remote queues Redis has no peek; builds table is source of truth.
     * Returns null to signal caller should query the database.
     */
    async status(_buildId: string): Promise<QueueEntry | null> {
      return null;
    },

    /**
     * Return queue entries that are queued or running.
     *
     * Remote queues don't track in-queue status server-side; returns empty.
     */
    async active(): Promise<QueueEntry[]> {
      return [];
    },

    /**
     * Return the most recent queue entries.
     *
     * Remote queues don't track history server-side; returns empty.
     */
    async recent(_limit: number): Promise<QueueEntry[]> {
      return [];
    },

    /**
     * Poll for a single capture job using BLMOVE with delayed-job promotion.
     *
     * Moves due delayed jobs back to the main queue before blocking.
     * Uses `attempts` stored in the payload (0-indexed).
     */
    async poll(pollOptions?: { waitMs?: number }): Promise<PollableJob | null> {
      await promoteDueDelayed(client, key, delayedKey, options.logger);

      const waitSeconds =
        pollOptions?.waitMs !== undefined
          ? Math.max(0, Math.min(20, Math.floor(pollOptions.waitMs / 1000)))
          : waitTimeSeconds;

      const raw = await blmoveWithFallback(client, key, processingKey, waitSeconds);

      if (raw === null || raw === "") {
        return null;
      }

      const body = parseBody(raw);
      if (!body.buildId) {
        // Malformed: remove from processing and return null
        await client.lrem(processingKey, 1, raw).catch(() => {});
        options.logger?.warn({ body: raw }, "received malformed Redis message without buildId");
        return null;
      }

      return {
        buildId: body.buildId,
        reqId: body.reqId,
        receipt: raw,
        attempts: typeof body.attempts === "number" ? body.attempts : 0,
        raw,
      };
    },

    async ack(job: PollableJob): Promise<void> {
      if (!job.receipt) {
        return;
      }
      await client.lrem(processingKey, 1, job.receipt);
    },

    async nack(
      job: PollableJob,
      nackOptions?: { requeue?: boolean; delayMs?: number },
    ): Promise<void> {
      if (!job.receipt) {
        return;
      }
      await client.lrem(processingKey, 1, job.receipt);
      if (nackOptions?.requeue === false) {
        return;
      }
      const delayMs = nackOptions?.delayMs !== undefined ? Math.max(0, nackOptions.delayMs) : 0;
      const body = parseBody(job.receipt);
      if (!body.buildId) {
        return;
      }
      const nextAttempts = (typeof body.attempts === "number" ? body.attempts : 0) + 1;
      const payload = JSON.stringify({
        buildId: body.buildId,
        reqId: body.reqId,
        queuedAt: body.queuedAt ?? new Date().toISOString(),
        status: "queued",
        attempts: nextAttempts,
      });

      if (delayMs > 0) {
        const due = Date.now() + Math.min(delayMs, 43200 * 1000);
        await client.zadd(delayedKey, due.toString(), payload);
      } else {
        await client.lpush(key, payload);
      }
    },
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
  const now = Date.now();
  // ZRANGEBYSCORE with LIMIT to avoid large bursts; promote in batches
  let due: string[] = [];
  try {
    due = await client.zrangebyscore(delayedKey, 0, now);
  } catch {
    return;
  }
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
  // Fallback to blocking pop without processing list (at-most-once)
  const raw = await client.brpop(source, timeoutSec);
  if (!raw) {
    return null;
  }
  // brpop returns [key, value] tuple
  const value = Array.isArray(raw) ? (raw[1] as string) : (raw as unknown as string);
  if (typeof value === "string") {
    await client.lpush(dest, value);
    return value;
  }
  return null;
}
