/** Remote browsers for `browsers` (`@storyshelf/runner-playwright/remote`, ADR 0007). */
export { remote } from "./remote.ts";
export type { BrowserName, RemoteBrowser, RemoteConnection, RemoteOptions } from "./remote.ts";
export { playwrightServer, type PlaywrightServerOptions } from "./playwright-server.ts";
export { azurePlaywright, type AzurePlaywrightOptions } from "./azure.ts";
export { browserstack, type BrowserStackOptions } from "./browserstack.ts";
