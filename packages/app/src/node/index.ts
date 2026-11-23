/**
 * `@storyshelf/app/node`: serve a created app on Node (`startServer`). A subpath, so hosts that use
 * `app.fetch` directly (Bun, Workers, Lambda, Next) never load `@hono/node-server`. Importing it
 * has no side effects: no listener and no signal handler exists until `startServer` runs.
 */
export { startServer } from "./start-server.ts";
export { StartInterruptedError } from "./errors.ts";
export { DEFAULT_SHUTDOWN_TIMEOUT_MS } from "./types.ts";
export type {
  NodeHostApp,
  NodeServer,
  ShutdownResult,
  ShutdownTrigger,
  StartServerOptions,
} from "./types.ts";
