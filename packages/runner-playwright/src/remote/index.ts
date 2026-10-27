/** Remote browsers for `browsers` (`@storyshelf/runner-playwright/remote`, ADR 0007). */
export { remote } from "./remote.ts";
export type { BrowserName, RemoteBrowser, RemoteConnection, RemoteOptions } from "./remote.ts";
export { RemoteConnectError, refCounted } from "@storyshelf/core/adapter/capture-runner";
export type {
  PoolLease,
  RefCounted,
  RefCountedOptions,
  RemoteConnectContext,
  RemoteReleaseInfo,
} from "@storyshelf/core/adapter/capture-runner";
export { playwrightServer, type PlaywrightServerOptions } from "./playwright-server.ts";
export { azurePlaywright, type AzurePlaywrightOptions } from "./azure.ts";
export { browserstack, type BrowserStackOptions } from "./browserstack.ts";
