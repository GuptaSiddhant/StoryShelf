/** BrowserStack Automate over Playwright's protocol. */
import type { BrowserName, RemoteBrowser } from "@storyshelf/core/adapter/capture-runner";
import { playwrightVersion } from "../version.ts";
import { remote } from "./remote.ts";

/** Options of {@link browserstack}. */
export interface BrowserStackOptions {
  /** The target name half; default `browserstack`. A second entry needs its own. */
  name?: string;
  username: string;
  accessKey: string;
  /** OS the browsers run on, as BrowserStack names it (`{ name: "Windows", version: "11" }`). */
  os?: { name: string; version: string };
  /** Browser version (default `latest`). Pin it: a moving build is a baseline migration. */
  browserVersion?: string;
  /** Engines to offer (default `chromium`, `firefox`, `webkit`; `chrome` is real Chrome). */
  engines?: readonly BrowserName[];
  /** Parallel sessions of the plan (default 1). */
  sessions?: number;
  /** Build name shown in BrowserStack's dashboard. */
  build?: string;
}

/** BrowserStack's `browser` capability per engine. */
const BROWSER: Record<BrowserName, string> = {
  chromium: "playwright-chromium",
  firefox: "playwright-firefox",
  webkit: "playwright-webkit",
  chrome: "chrome",
};

/**
 * Targets on BrowserStack, for example `chromium@browserstack`. BrowserStack cannot route back to
 * this host, so each target needs a signed Storybook URL (ADR 0007, decision 5). The credentials
 * travel in the endpoint's capabilities and are scrubbed from every message and log.
 */
export function browserstack(options: BrowserStackOptions): RemoteBrowser {
  return remote({
    name: options.name ?? "browserstack",
    engines: options.engines ?? ["chromium", "firefox", "webkit"],
    connect: (engine) => ({
      protocol: "playwright",
      endpoint: `wss://cdp.browserstack.com/playwright?caps=${encodeURIComponent(
        JSON.stringify(capabilities(options, engine)),
      )}`,
    }),
    sessions: options.sessions ?? 1,
    platform: options.os?.name.toLowerCase().replace(/^os x$/u, "macos"),
  });
}

function capabilities(options: BrowserStackOptions, engine: BrowserName): Record<string, unknown> {
  return {
    browser: BROWSER[engine],
    browser_version: options.browserVersion ?? "latest",
    ...(options.os === undefined ? {} : { os: options.os.name, os_version: options.os.version }),
    "browserstack.username": options.username,
    "browserstack.accessKey": options.accessKey,
    "client.playwrightVersion": playwrightVersion(),
    ...(options.build === undefined ? {} : { build: options.build }),
  };
}
