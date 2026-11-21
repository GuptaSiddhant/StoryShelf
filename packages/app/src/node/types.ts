import type { ShelfLifecycle } from "../app-types.ts";

/** What the Node host needs of an app: its fetch handler and its lifecycle. A `ShelfApp` is one. */
export interface NodeHostApp {
  fetch(request: Request, env?: unknown): Response | Promise<Response>;
  readonly lifecycle: ShelfLifecycle;
}

/** What started a shutdown: an explicit `close()`, a signal, an aborted `signal`, or a failed start. */
export type ShutdownTrigger = "close" | "SIGINT" | "SIGTERM" | "abort" | "start-failed";

/** Options of {@link startServer}. */
export interface StartServerOptions {
  /** An app that already exists (`createShelfApp(...)`): the host never creates one or picks adapters. */
  app: NodeHostApp;
  /** TCP port; `0` picks a free one (read it back from `server.port`). Default `3000`. */
  port?: number;
  /** Address to bind; Node's default (every interface) when omitted. */
  hostname?: string;
  /**
   * Register SIGINT/SIGTERM handlers that shut the server down. Default `false`: an embedder keeps
   * its own handlers. The host removes only the handlers it registered, and never exits the process.
   */
  handleSignals?: boolean;
  /**
   * The whole shutdown's bound, in ms (default {@link DEFAULT_SHUTDOWN_TIMEOUT_MS}): requests in
   * flight, then the app's job drain and teardown. Keep it a few seconds below the platform's
   * SIGTERM-to-SIGKILL window. Work still running at the deadline is fenced: connections are
   * destroyed and jobs are handed back to the queue; a job that ignores that is recovered once its
   * lease (`testing.leaseSeconds`) runs out.
   */
  shutdownTimeoutMs?: number;
  /** Runs once the app is ready and before the port opens (boot hooks: an admin account, a seed). */
  beforeListen?: () => Promise<void> | void;
  /** Aborting it shuts the server down, interrupting a start-up still in progress. */
  signal?: AbortSignal;
}

/** How a shutdown ended. */
export interface ShutdownResult {
  /** True when every request finished and the app's teardown completed before the deadline. */
  readonly complete: boolean;
  /** Why it is incomplete: the deadline passed, or the app's teardown threw. */
  readonly incomplete?: "timeout" | "teardown-failed";
  readonly trigger: ShutdownTrigger;
  readonly durationMs: number;
}

/** A started Node server. */
export interface NodeServer {
  /** The bound port (the chosen one when `port: 0`). */
  readonly port: number;
  /** A base URL for logs and local clients, e.g. `http://localhost:3000`. */
  readonly url: string;
  /** Settles once the server has shut down, whatever started it (a signal, `close()`, an abort). */
  readonly closed: Promise<ShutdownResult>;
  /** Shut down: stop accepting, drain within the timeout, tear the app down. Idempotent. */
  close(): Promise<ShutdownResult>;
}

/** Default bound of a shutdown: 30 s, the SIGKILL window of ECS and Kubernetes by default. */
export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 30_000;
