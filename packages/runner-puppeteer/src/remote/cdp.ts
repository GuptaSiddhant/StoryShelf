/** A Chrome DevTools Protocol endpoint: Browserless, Cloudflare Browser Rendering, a bare Chrome, … */
import {
  defineRemote,
  type BrowserName,
  type RemoteBrowser,
  type RemoteOptions,
  type RemoteSupport,
} from "@storyshelf/core/adapter/capture-runner";

/** Puppeteer drives the Chromium family, over CDP only (ADR 0007, decision 1). */
const SUPPORT: RemoteSupport = {
  engines: ["chromium", "chrome"],
  protocols: ["cdp"],
  label: "cdp()",
};

/** What both forms of {@link cdp} share. */
interface CdpBase {
  /** The target name half (`chromium@<name>`): lowercase letters, digits and hyphens, at most 32. */
  name: string;
  /** Parallel pages the service allows (default 1: set it to the plan's cap). A function is read live. */
  sessions?: number | (() => number);
  /** Engines to offer (default `chromium`; `chrome` when the service is real Chrome). */
  engines?: readonly BrowserName[];
  /** OS the service runs on, reported when the page cannot tell. */
  platform?: string;
  /** How long one connect attempt waits in ms (default 30 000). */
  connectTimeoutMs?: number;
}

/** A service at a fixed address. */
export interface CdpFixedOptions extends CdpBase {
  /** `ws(s)://…`, or `http(s)://…` of a Chrome with remote debugging (its WebSocket is looked up). May carry a key: it is never logged. */
  endpoint: string;
  /** Handshake headers, such as `authorization`. Never logged. */
  headers?: Record<string, string>;
  connect?: undefined;
  release?: undefined;
}

/**
 * A service that must be woken, started or chosen per connection: `connect` receives the run's
 * context (`buildId`, `runId`, `shardIndex`, `purpose`, `attempt`, `signal`) and returns
 * `{ endpoint, headers, lease }`; `release` gets the lease back once, when the render ends.
 */
export interface CdpLeasedOptions<TLease> extends CdpBase {
  connect: Extract<RemoteOptions<TLease>["connect"], (...args: never[]) => unknown>;
  release?: RemoteOptions<TLease>["release"];
  /** Retries after the first connect attempt (default 3) and the first backoff in ms (default 500). */
  retry?: RemoteOptions<TLease>["retry"];
  /** `acquireMs` bounds `connect`, `connectMs` the handshake, `releaseMs` `release` (all default 30 000). */
  timeouts?: RemoteOptions<TLease>["timeouts"];
  endpoint?: undefined;
  headers?: undefined;
}

/** Options of {@link cdp}. */
export type CdpOptions<TLease = unknown> = CdpFixedOptions | CdpLeasedOptions<TLease>;

/**
 * Targets on a CDP service, for example `chromium@cloudflare`. The browser cannot route back to
 * this host, so every target needs a signed Storybook URL (ADR 0007, decision 5).
 */
export function cdp<TLease = unknown>(options: CdpOptions<TLease>): RemoteBrowser {
  const base = {
    name: options.name,
    engines: options.engines ?? ["chromium"],
    protocol: "cdp",
    reach: "url",
    sessions: options.sessions ?? 1,
    platform: options.platform,
  } as const;
  if (typeof options.connect === "function") {
    return defineRemote<TLease>(
      {
        ...base,
        connect: options.connect,
        release: options.release,
        retry: options.retry,
        timeouts: {
          ...options.timeouts,
          connectMs: options.timeouts?.connectMs ?? options.connectTimeoutMs,
        },
      },
      SUPPORT,
    );
  }
  return defineRemote(
    {
      ...base,
      connect: {
        endpoint: options.endpoint,
        ...(options.headers === undefined ? {} : { headers: options.headers }),
      },
      timeouts: { connectMs: options.connectTimeoutMs },
    },
    SUPPORT,
  );
}
