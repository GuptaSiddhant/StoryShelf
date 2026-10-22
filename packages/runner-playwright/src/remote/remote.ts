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
 * remote({
 *   name: "mygrid",
 *   engines: ["chromium", "firefox", "webkit"],
 *   connect: () => ({ protocol: "playwright", endpoint: "wss://grid.example/", exposeNetwork: "<loopback>" }),
 *   sessions: 4,
 * });
 * ```
 */
export function remote(options: RemoteOptions): RemoteBrowser {
  return defineRemote(options, SUPPORT);
}

export type { BrowserName, RemoteBrowser, RemoteConnection, RemoteOptions };
