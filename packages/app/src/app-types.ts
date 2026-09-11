import { OpenAPIHono } from "@hono/zod-openapi";
import type { AuthUser } from "@storyshelf/core/adapter/auth";
import type { CaptureQueue } from "@storyshelf/core/adapter/capture-queue";
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import type { GitHostProvider } from "@storyshelf/core/adapter/git-host";
import type { AdapterSetupResult } from "@storyshelf/core/adapter/setup";
import type { StorageAdapter } from "@storyshelf/core/adapter/storage";
import type { ShelfConfig, UIConfig } from "@storyshelf/core/config";
import { createShelfLogger, type Logger } from "@storyshelf/core/logger";

/** Per-request shelf context (adapters, config, user, capture queue). */
export interface ShelfContext {
  requestId?: string;
  db: DatabaseAdapter;
  storage: StorageAdapter;
  config: ShelfConfig;
  ui: UIConfig;
  logger: ReturnType<typeof createShelfLogger>;
  user: AuthUser | null;
  authEnabled: boolean;
  enqueueCapture?: (buildId: string, reqId?: string) => Promise<void>;
  captureQueue: CaptureQueue | null;
  gitHosts: GitHostProvider[];
}

/** Hono router type carrying the shelf context variables. */
export type ShelfRouter = OpenAPIHono<{ Variables: ShelfContext }>;

/** App-scoped adapter lifecycle namespace (single `lifecycle` prop avoids Hono collisions). */
export interface ShelfLifecycle {
  /** Settled summary of the eager background setup run; never rejects. */
  readonly ready: Promise<AdapterSetupResult>;
  /** The resolved logger: the passed-in instance, or the app-created default. */
  readonly logger: Logger;
  /**
   * Fail-fast await for server startup (`await app.lifecycle.setup()`).
   * Re-runs setup so transient failures are retryable; throws AdapterLifecycleError.
   * Optional — when skipped, the first request gates on `ready` instead.
   */
  setup(): Promise<void>;
  /** Graceful teardown for SIGTERM/SIGINT (`await app.lifecycle.teardown()`). Idempotent. */
  teardown(): Promise<void>;
}

/** Shelf app with the shelf lifecycle namespace attached. */
export type ShelfApp = ShelfRouter & { readonly lifecycle: ShelfLifecycle };
