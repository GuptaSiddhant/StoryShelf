/** Option and runtime types for the Redis capture queue. */
import type { Logger } from "@storyshelf/core/logger";
import type { Redis } from "ioredis";

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

/** Wire shape stored as the Redis message payload. */
export interface QueuedBody {
  buildId?: string;
  status?: string;
  queuedAt?: string;
  reqId?: string;
  attempts?: number;
}

/** Shared per-queue runtime threaded through core and poll methods. */
export interface QueueRuntime {
  client: Redis;
  key: string;
  processingKey: string;
  delayedKey: string;
  waitTimeSeconds: number;
  logger?: Logger;
}
