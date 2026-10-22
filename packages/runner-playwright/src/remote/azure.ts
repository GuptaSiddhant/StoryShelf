/** Microsoft Azure Playwright Workspaces (Azure App Testing). */
import type { BrowserName, RemoteBrowser } from "@storyshelf/core/adapter/capture-runner";
import { remote } from "./remote.ts";

/** Options of {@link azurePlaywright}. */
export interface AzurePlaywrightOptions {
  /** The target name half; default `azure`. */
  name?: string;
  /** The workspace's browser endpoint (`PLAYWRIGHT_SERVICE_URL`): `wss://<region>.api.playwright.microsoft.com/playwrightworkspaces/<id>/browsers`. */
  endpoint: string;
  /** Access token (`PLAYWRIGHT_SERVICE_ACCESS_TOKEN`). */
  token: string;
  /** OS of the cloud browsers (default `linux`). */
  os?: "linux" | "windows";
  /** API version the service is called with (default `2025-09-01`). */
  apiVersion?: string;
  /** Parallel pages (the workspace's parallel-worker limit; default 1). */
  sessions?: number;
  /** Engines to offer (default all three). */
  engines?: readonly BrowserName[];
}

/** Targets on a workspace: `chromium@azure`, `firefox@azure`, `webkit@azure`. */
export function azurePlaywright(options: AzurePlaywrightOptions): RemoteBrowser {
  const os = options.os ?? "linux";
  return remote({
    name: options.name ?? "azure",
    engines: options.engines ?? ["chromium", "firefox", "webkit"],
    connect: () => ({
      protocol: "playwright",
      endpoint: withParams(options.endpoint, {
        os,
        "api-version": options.apiVersion ?? "2025-09-01",
      }),
      headers: { authorization: `Bearer ${options.token}` },
      // The service routes requests for the host's loopback back through the connection.
      exposeNetwork: "<loopback>",
    }),
    sessions: options.sessions ?? 1,
    platform: os,
  });
}

function withParams(endpoint: string, params: Record<string, string>): string {
  const url = new URL(endpoint);
  for (const [key, value] of Object.entries(params)) {
    if (!url.searchParams.has(key)) url.searchParams.set(key, value);
  }
  return url.toString();
}
