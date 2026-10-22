/** A self-hosted Playwright server (`playwright run-server`), or anything speaking its protocol. */
import type { BrowserName, RemoteBrowser } from "@storyshelf/core/adapter/capture-runner";
import { remote } from "./remote.ts";

/** Options of {@link playwrightServer}. */
export interface PlaywrightServerOptions {
  /** The target name half (`chromium@<name>`); default `grid`. */
  name?: string;
  /** `ws://host:3000/` or `wss://…`: the server's address and `--path`. */
  endpoint: string;
  /**
   * Bearer token for a reverse proxy in front of the server: a bare `run-server` has no
   * authentication of its own. Sent as `authorization: Bearer …`.
   */
  token?: string;
  /** Further handshake headers. */
  headers?: Record<string, string>;
  /**
   * Route the remote browser's requests for the loopback Storybook server back through the
   * connection (default `"<loopback>"`). `false` when the server cannot, which makes every target
   * need a signed Storybook URL.
   */
  exposeNetwork?: string | false;
  /** Parallel pages the farm should take from this runner (default 1: set it to the farm's cap). */
  sessions?: number;
  /** Engines to offer (default all three; the server must have them installed). */
  engines?: readonly BrowserName[];
  /** OS the server runs on, reported when the page cannot tell. */
  platform?: string;
  /**
   * How long one connect attempt waits in ms (default 30 000). A server started with
   * `--max-clients` queues extra connections: raise this when renders outnumber its clients.
   */
  connectTimeoutMs?: number;
}

/** Targets on a Playwright server: `chromium@grid`, `firefox@grid`, `webkit@grid`. */
export function playwrightServer(options: PlaywrightServerOptions): RemoteBrowser {
  const headers = {
    ...(options.token === undefined ? {} : { authorization: `Bearer ${options.token}` }),
    ...options.headers,
  };
  const exposeNetwork = options.exposeNetwork ?? "<loopback>";
  return remote({
    name: options.name ?? "grid",
    engines: options.engines ?? ["chromium", "firefox", "webkit"],
    connect: () => ({
      protocol: "playwright",
      endpoint: options.endpoint,
      headers,
      ...(exposeNetwork === false ? {} : { exposeNetwork }),
    }),
    sessions: options.sessions ?? 1,
    platform: options.platform,
    connectTimeoutMs: options.connectTimeoutMs,
  });
}
