/**
 * StoryShelf core: domain-only barrel (no HTTP).
 *
 * Adapter interfaces, models, schema, capture pipeline, retention, and
 * config/logger/types helpers. Everything HTTP — `createShelfApp`,
 * routers, pages, middleware, the request store — lives in
 * `@storyshelf/app`. Prefer the granular subpaths (`core/adapter/*`,
 * `core/models`, `core/capture`, …); this barrel exists for the small
 * shared surface below. Importing it must never pull Hono into a bundle.
 */
export type {
  AdapterSnapshot,
  BrandTheme,
  ShelfConfig,
  ShelfOptions,
  ShelfViewport,
  UIConfig,
} from "./config.ts";
export {
  DEFAULT_MAX_UPLOAD_BYTES,
  shelfConfigSchema,
  uiConfigSchema,
  validateConfig,
  validateUiConfig,
} from "./config.ts";
export {
  createShelfLogger,
  type Logger,
  type LoggerOptions,
  type PinoTransport,
} from "./logger.ts";
export type { BuildStatus, ProjectRole, SiteRole, SnapshotStatus } from "./types.ts";
export { BUILD_STATUSES, SNAPSHOT_STATUSES, TERMINAL_BUILD_STATUSES } from "./types.ts";
