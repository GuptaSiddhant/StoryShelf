/** Redis client construction and shared queue runtime resolution. */
import { Redis } from "ioredis";
import type { QueueRuntime, RedisCaptureQueueOptions } from "./types.ts";

/** Resolve the effective runtime (keys, client, waits) plus client ownership. */
export function resolveQueueRuntime(options: RedisCaptureQueueOptions): {
  rt: QueueRuntime;
  ownsClient: boolean;
} {
  const key = options.key ?? "shelf:queue";
  const client = getRedisClient(options);
  const rt: QueueRuntime = {
    client,
    key,
    processingKey: `${key}:processing`,
    delayedKey: `${key}:delayed`,
    waitTimeSeconds: options.waitTimeSeconds ?? 5,
    logger: options.logger,
  };
  return { rt, ownsClient: options.client === undefined };
}

/** Return the injected client, or build one from `url` (default localhost). */
export function getRedisClient(options: RedisCaptureQueueOptions): Redis {
  if (options.client) {
    return options.client;
  }
  if (options.url) {
    return new Redis(options.url);
  }
  return new Redis();
}
