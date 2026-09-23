/** Worker polling (poll/ack/nack), delayed promotion, and move fallbacks. */
import type { PollableCaptureQueue, PollableJob } from "@storyshelf/core/adapter/capture-queue";
import type { Logger } from "@storyshelf/core/logger";
import type { Redis } from "ioredis";
import { buildRequeuePayload, extractPolledJob, parseBody } from "./codec.ts";
import type { QueueRuntime } from "./types.ts";

/** Build worker-side `poll`/`ack`/`nack` with at-least-once delivery. */
export function buildPollMethods(
  rt: QueueRuntime,
): Pick<PollableCaptureQueue, "poll" | "ack" | "nack"> {
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

/** Clamp the poll wait to 0–20 seconds, falling back to the configured wait. */
function resolveWaitSeconds(
  pollOptions: { waitMs?: number } | undefined,
  fallback: number,
): number {
  if (pollOptions?.waitMs === undefined) {
    return fallback;
  }
  return Math.max(0, Math.min(20, Math.floor(pollOptions.waitMs / 1000)));
}

/** Clamp the nack delay to a non-negative duration. */
function resolveDelayMs(nackOptions: { delayMs?: number } | undefined): number {
  if (nackOptions?.delayMs === undefined) {
    return 0;
  }
  return Math.max(0, nackOptions.delayMs);
}

/** Requeue a nacked receipt immediately or into the delayed ZSET. */
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
    await zaddDelayed(client, delayedKey, payload, delayMs);
    return;
  }
  await client.lpush(key, payload);
}

/** Add a payload to the delayed ZSET, capping the delay at 12 hours. */
async function zaddDelayed(
  client: Redis,
  delayedKey: string,
  payload: string,
  delayMs: number,
): Promise<void> {
  const due = Date.now() + Math.min(delayMs, 43_200 * 1000);
  await client.zadd(delayedKey, due.toString(), payload);
}

/** Move due delayed jobs back to the main queue before blocking. */
async function promoteDueDelayed(
  client: Redis,
  _key: string,
  delayedKey: string,
  logger?: Logger,
): Promise<void> {
  const due = await fetchDueJobs(client, delayedKey);
  await promoteMembers(client, delayedKey, due, logger);
}

/** Fetch delayed members whose due score has passed. */
async function fetchDueJobs(client: Redis, delayedKey: string): Promise<string[]> {
  try {
    return await client.zrangebyscore(delayedKey, 0, Date.now());
  } catch {
    return [];
  }
}

/** Move due members from the delayed ZSET back onto the main queue. */
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

/** Blocking move with `brpoplpush`/`brpop` fallbacks for older clients. */
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

/** Fallback to blocking pop without processing list (at-most-once). */
async function brpopFallback(
  client: Redis,
  source: string,
  dest: string,
  timeoutSec: number,
): Promise<string | null> {
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
