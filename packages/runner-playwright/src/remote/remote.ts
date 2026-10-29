/** The generic remote browser entry: every preset is sugar over it (ADR 0007, decision 1). */
import {
  defineRemote,
  type BrowserName,
  type RemoteBrowser,
  type RemoteConnection,
  type RemoteOptions,
  type RemoteSupport,
} from "@storyshelf/core/adapter/capture-runner";

/** What the Playwright runner can drive: every engine, over its own protocol or CDP (Chromium only). */
const SUPPORT: RemoteSupport = {
  engines: ["chromium", "firefox", "webkit", "chrome"],
  protocols: ["playwright", "cdp"],
  label: "remote()",
};

/**
 * A browser service the runner connects to instead of launching, for `browsers`. It offers one
 * target per engine, `<engine>@<name>`, each with its own baselines (ADR 0007, decision 3), and
 * throws when the runner is created for a bad name, engine, protocol or endpoint.
 *
 * ```ts
 * // A fixed service:
 * remote({
 *   name: "mygrid",
 *   engines: ["chromium", "firefox", "webkit"],
 *   protocol: "playwright",
 *   reach: "loopback", // its browser can route back to this host
 *   connect: { endpoint: "wss://grid.example/" },
 *   sessions: 4,
 *   maxPagesPerConnection: 2,
 * });
 *
 * // A service that must be woken first, with a lease handed back to `release`:
 * remote<{ id: string }>({
 *   name: "pool",
 *   engines: ["chromium"],
 *   protocol: "playwright",
 *   reach: "loopback",
 *   sessions: 4,
 *   connect: async ({ shardIndex, signal }) => {
 *     const server = await wake(shardIndex, signal);
 *     return { endpoint: server.endpoint, lease: { id: server.id } };
 *   },
 *   release: async (lease, { outcome }) => await suspend(lease.id, outcome),
 * });
 * ```
 */
export function remote<TLease = unknown>(options: RemoteOptions<TLease>): RemoteBrowser {
  return defineRemote(options, SUPPORT);
}

export type { BrowserName, RemoteBrowser, RemoteConnection, RemoteOptions };
