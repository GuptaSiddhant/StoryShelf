/** A Chrome DevTools Protocol endpoint: Browserless, Cloudflare Browser Rendering, a bare Chrome, … */
import {
  defineRemote,
  type BrowserName,
  type RemoteBrowser,
  type RemoteSupport,
} from "@storyshelf/core/adapter/capture-runner";

/** Puppeteer drives the Chromium family, over CDP only (ADR 0007, decision 1). */
const SUPPORT: RemoteSupport = {
  engines: ["chromium", "chrome"],
  protocols: ["cdp"],
  label: "cdp()",
};

/** Options of {@link cdp}. */
export interface CdpOptions {
  /** The target name half (`chromium@<name>`): lowercase letters, digits and hyphens, at most 32. */
  name: string;
  /** `ws(s)://…`, or `http(s)://…` of a Chrome with remote debugging (its WebSocket is looked up). May carry a key: it is never logged. */
  endpoint: string;
  /** Handshake headers, such as `authorization`. Never logged. */
  headers?: Record<string, string>;
  /** Parallel pages the service allows (default 1: set it to the plan's cap). */
  sessions?: number;
  /** Engines to offer (default `chromium`; `chrome` when the service is real Chrome). */
  engines?: readonly BrowserName[];
  /** OS the service runs on, reported when the page cannot tell. */
  platform?: string;
  /** How long one connect attempt waits in ms (default 30 000). */
  connectTimeoutMs?: number;
}

/**
 * Targets on a CDP service, for example `chromium@cloudflare`. The browser cannot route back to
 * this host, so every target needs a signed Storybook URL (ADR 0007, decision 5).
 */
export function cdp(options: CdpOptions): RemoteBrowser {
  return defineRemote(
    {
      name: options.name,
      engines: options.engines ?? ["chromium"],
      connect: () => ({
        protocol: "cdp",
        endpoint: options.endpoint,
        ...(options.headers === undefined ? {} : { headers: options.headers }),
      }),
      sessions: options.sessions ?? 1,
      platform: options.platform,
      connectTimeoutMs: options.connectTimeoutMs,
    },
    SUPPORT,
  );
}
