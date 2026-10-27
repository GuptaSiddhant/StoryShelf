/**
 * Remote browsers (ADR 0007, decisions 1 and 3): one service a runner connects to instead of
 * launching a browser, expanding to one `<engine>@<name>` target per engine. Presets are plain
 * configuration over {@link defineRemote}; the runners add only what they can drive.
 */
import {
  TARGET_NAME_PATTERN,
  isBrowserName,
  type BrowserName,
  type CaptureTarget,
  type TargetReach,
} from "./capture-target.ts";

/** How a runner talks to the service: Playwright's own protocol, or the Chrome DevTools Protocol. */
export type RemoteProtocol = "playwright" | "cdp";

/** Where and how to connect for one engine. Re-evaluated on every connect, so a token can be fresh. */
export interface RemoteConnection {
  protocol: RemoteProtocol;
  /** `ws(s)://…` (CDP also accepts `http(s)://…`). May carry credentials: it is never logged. */
  endpoint: string;
  /** Request headers for the handshake, such as `authorization`. Never logged. */
  headers?: Record<string, string>;
  /**
   * Playwright `connect` only: `"<loopback>"` routes the remote browser's requests for `127.0.0.1`
   * back through the connection, so the loopback Storybook server works unchanged (decision 5).
   */
  exposeNetwork?: string;
}

/** Which render a connection is for, handed to {@link RemoteOptions.acquire}. */
export interface RemoteLeaseContext {
  engine: BrowserName;
  buildId: string;
  /** The shard's 1-based position in the build's plan; absent outside a sharded render. */
  shardIndex?: number | undefined;
}

/** How a leased connection ended, handed to {@link RemoteOptions.release}. */
export type RemoteLeaseOutcome = "finished" | "failed" | "cancelled";

/** A connection together with whatever the provider needs back to release it. */
export interface RemoteLeasedConnection extends RemoteConnection {
  /** Opaque to the runner, passed to `release` once and never logged (it may carry credentials). */
  lease?: unknown;
}

/** What {@link defineRemote} takes: what `remote()` exposes to operators. */
export interface RemoteOptions {
  /** The target name half (`chromium@<name>`): lowercase letters, digits and hyphens, at most 32. */
  name: string;
  /** The engines to offer (a subset of what the service has). */
  engines: readonly BrowserName[];
  /**
   * The connection for an engine. Pure: it is called once at creation to validate it and to tell
   * whether the browser reaches this host (`exposeNetwork`). Without `acquire` it is also what every
   * render connects with; with `acquire` it only describes the shape of what `acquire` returns.
   */
  connect: (engine: BrowserName) => RemoteConnection;
  /**
   * Called before each connection (one per render, shard or browser recycle; concurrent calls are
   * allowed) and may be async: wake a server, start a pod, pick one per shard. Returns the
   * connection to use in place of `connect`'s, and a `lease` handed back to `release`. A throw is
   * retried like a failed handshake (`connectRetries`, `connectBackoffMs`) and ends as a
   * transient `TargetLaunchError`, unless the error has `transient: false`. It must keep the
   * reach of `connect`'s connection (`exposeNetwork` set or not), or the render fails.
   */
  acquire?: ((context: RemoteLeaseContext) => Promise<RemoteLeasedConnection>) | undefined;
  /**
   * Called exactly once for every successful `acquire`, when the connection's render finished,
   * failed or was cancelled, and for leases still held when the runner shuts down (`cancelled`).
   * A throw is logged, never fails the render. Only valid together with `acquire`.
   */
  release?: ((lease: unknown, outcome: RemoteLeaseOutcome) => Promise<void> | void) | undefined;
  /**
   * Parallel sessions the plan allows: the page cap of the target, per process (decision 4). A
   * function is read each time a page is about to start, for a provider that scales.
   */
  sessions: number | (() => number);
  /** OS the service renders on, reported when the page cannot tell (`linux-x64`, `windows`, …). */
  platform?: string | undefined;
  /** Connect retries before the render fails (default 3). */
  connectRetries?: number | undefined;
  /** First backoff between connect attempts in ms, doubling each time (default 500). */
  connectBackoffMs?: number | undefined;
  /**
   * How long one connect attempt waits in ms (default 30 000). A farm with a client cap queues
   * extra connections instead of refusing them, so a busy farm shows up as this timeout.
   */
  connectTimeoutMs?: number | undefined;
  /** How long one `acquire` call waits in ms (default `connectTimeoutMs`); the handshake has its own. */
  acquireTimeoutMs?: number | undefined;
}

/** One remote service, validated: an entry of a runner's `browsers`. */
export interface RemoteBrowser extends Required<
  Pick<RemoteOptions, "name" | "engines" | "connect" | "sessions">
> {
  readonly kind: "remote";
  readonly acquire: RemoteOptions["acquire"];
  readonly release: RemoteOptions["release"];
  readonly acquireTimeoutMs: number;
  readonly platform: string | undefined;
  readonly connectRetries: number;
  readonly connectBackoffMs: number;
  readonly connectTimeoutMs: number;
}

/** What a runner supports, which {@link defineRemote} checks the service against. */
export interface RemoteSupport {
  /** Engines the runner can drive. */
  engines: readonly BrowserName[];
  /** Protocols the runner can speak. */
  protocols: readonly RemoteProtocol[];
  /** Shown in errors, for example `remote()`. */
  label: string;
}

/** One target a remote service offers. */
export interface RemoteTarget {
  kind: "remote";
  target: CaptureTarget;
  engine: BrowserName;
  remote: RemoteBrowser;
  /** How the browser reaches the Storybook. */
  reach: TargetReach;
}

const CDP_ENGINES = new Set<BrowserName>(["chromium", "chrome"]);
const SCHEMES: Record<RemoteProtocol, readonly string[]> = {
  playwright: ["ws:", "wss:"],
  cdp: ["ws:", "wss:", "http:", "https:"],
};

/**
 * Validate a remote service eagerly, so a mistake fails when the runner is created and not when the
 * first build runs: the name, the sessions, the engines against what the runner drives, and the
 * connection of every engine (protocol, endpoint scheme, CDP being Chromium only).
 */
export function defineRemote(options: RemoteOptions, support: RemoteSupport): RemoteBrowser {
  checkOptions(options, support);
  checkEngines(options, support);
  for (const engine of options.engines) {
    checkConnection(support.label, options, engine, support);
  }
  return {
    kind: "remote",
    name: options.name,
    engines: [...options.engines],
    connect: options.connect,
    sessions: options.sessions,
    platform: options.platform,
    connectRetries: options.connectRetries ?? 3,
    connectBackoffMs: options.connectBackoffMs ?? 500,
    connectTimeoutMs: options.connectTimeoutMs ?? 30_000,
    acquire: options.acquire,
    release: options.release,
    acquireTimeoutMs: options.acquireTimeoutMs ?? options.connectTimeoutMs ?? 30_000,
  };
}

function checkOptions(options: RemoteOptions, { label }: RemoteSupport): void {
  if (!TARGET_NAME_PATTERN.test(options.name)) {
    throw new Error(
      `${label}: name "${options.name}" must be lowercase letters, digits and hyphens, start with a letter or digit and be at most 32 characters`,
    );
  }
  const sessions = typeof options.sessions === "function" ? options.sessions() : options.sessions;
  if (!Number.isInteger(sessions) || sessions < 1) {
    throw new Error(`${label} "${options.name}": sessions must be a positive integer`);
  }
  if (options.release !== undefined && options.acquire === undefined) {
    throw new Error(`${label} "${options.name}": release needs acquire`);
  }
}

/** The targets a service offers, in the order of its `engines`. */
export function remoteTargetsOf(remote: RemoteBrowser): RemoteTarget[] {
  return remote.engines.map((engine) => ({
    kind: "remote",
    target: `${engine}@${remote.name}`,
    engine,
    remote,
    reach: reachOf(remote.connect(engine)),
  }));
}

/** `loopback` when the remote browser can route back to this host, else it needs a URL (decision 5). */
export function reachOf(connection: RemoteConnection): TargetReach {
  return connection.protocol === "playwright" && connection.exposeNetwork !== undefined
    ? "loopback"
    : "url";
}

/** Whether a value is a remote service entry. */
export function isRemoteBrowser(value: unknown): value is RemoteBrowser {
  return typeof value === "object" && value !== null && (value as RemoteBrowser).kind === "remote";
}

/**
 * Remove what identifies the connection from text surfaced to operators: the endpoint (it can carry
 * a key in its path or query), its host and path, its query values and every header value.
 */
export function scrubConnection(text: string, connection: RemoteConnection): string {
  const secrets = [
    connection.endpoint,
    ...Object.values(connection.headers ?? {}),
    ...leaseSecrets((connection as RemoteLeasedConnection).lease),
  ];
  try {
    const url = new URL(connection.endpoint);
    // Drivers echo the endpoint without its query; the host and a path that acts as a key stay hidden.
    secrets.push(
      url.password,
      ...url.searchParams.values(),
      decodeURIComponent(url.search),
      `${url.protocol}//${url.host}${url.pathname}`,
      url.host,
      url.pathname,
    );
  } catch {
    // An unparsable endpoint is scrubbed whole above.
  }
  let scrubbed = text;
  // Longest first: the endpoint goes before the fragments it contains.
  for (const secret of secrets
    .filter((value) => value.length >= 4)
    .toSorted((a, b) => b.length - a.length)) {
    scrubbed = scrubbed.replaceAll(secret, "[redacted]");
  }
  return scrubbed;
}

/** Strings of a lease that may carry credentials: its own text, or every string it holds. */
function leaseSecrets(lease: unknown, depth = 0): string[] {
  if (typeof lease === "string") {
    return [lease];
  }
  if (typeof lease !== "object" || lease === null || depth > 3) {
    return [];
  }
  return Object.values(lease).flatMap((value) => leaseSecrets(value, depth + 1));
}

function checkEngines(options: RemoteOptions, support: RemoteSupport): void {
  const where = `${support.label} "${options.name}"`;
  if (options.engines.length === 0) {
    throw new Error(`${where}: engines must list at least one engine`);
  }
  for (const [index, engine] of options.engines.entries()) {
    if (!isBrowserName(engine)) {
      throw new Error(`${where}: unknown engine "${String(engine)}"`);
    }
    if (!support.engines.includes(engine)) {
      throw new Error(
        `${where}: this runner cannot drive "${engine}" (it drives ${support.engines.join(", ")})`,
      );
    }
    if (options.engines.indexOf(engine) !== index) {
      throw new Error(`${where}: engine "${engine}" is listed twice`);
    }
  }
}

function checkConnection(
  label: string,
  options: RemoteOptions,
  engine: BrowserName,
  support: RemoteSupport,
): void {
  const where = `${label} "${options.name}" (${engine})`;
  const connection = options.connect(engine);
  if (!support.protocols.includes(connection.protocol)) {
    throw new Error(
      `${where}: protocol "${connection.protocol}" is not supported by this runner (it speaks ${support.protocols.join(", ")})`,
    );
  }
  if (connection.protocol === "cdp" && !CDP_ENGINES.has(engine)) {
    throw new Error(`${where}: the CDP protocol drives Chromium only, not "${engine}"`);
  }
  if (connection.protocol === "cdp" && connection.exposeNetwork !== undefined) {
    throw new Error(`${where}: exposeNetwork needs the "playwright" protocol`);
  }
  if (!SCHEMES[connection.protocol].some((scheme) => isScheme(connection.endpoint, scheme))) {
    throw new Error(
      `${where}: the endpoint must be a ${SCHEMES[connection.protocol].join(" or ")} URL`,
    );
  }
}

function isScheme(endpoint: string, scheme: string): boolean {
  try {
    return new URL(endpoint).protocol === scheme;
  } catch {
    return false;
  }
}
